import { Command } from 'commander';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONFIG_ENV_PATH,
  WORKER_SCAFFOLD_DIR,
  loadEnv,
  readEnvFile,
  writeEnvFile,
} from '../lib/env.js';
import { packagedWorkerBundle, packagedWranglerTemplate } from '../lib/paths.js';
import { isValidDomain, prompt, promptHidden, trackingSnippet } from '../lib/prompt.js';
import { readAllowedSites } from '../lib/scaffold.js';
import { parseWorkersDevUrl, wranglerDeploy, wranglerSecretPut } from '../lib/wrangler.js';

function fail(message: string): never {
  console.error(`Error: ${message}`);
  // Exit 3 = missing/invalid configuration, matching the other commands.
  process.exit(3);
}

function parseSites(raw: string): string[] {
  const sites = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (sites.length === 0) fail('At least one site is required');
  for (const site of sites) {
    if (!isValidDomain(site)) {
      fail(`Invalid site domain: "${site}" (expected a bare domain like example.com)`);
    }
  }
  return [...new Set(sites)];
}

export function setupCommand(): Command {
  const cmd = new Command('setup');
  cmd
    .description(
      'Deploy the analytics worker to your Cloudflare account and configure the CLI. ' +
        'Requires CLOUDFLARE_API_TOKEN (env) and a Cloudflare account ID. ' +
        'Idempotent: re-running reuses existing secrets unless --rotate-secrets is passed.',
    )
    .option('--sites <sites>', 'Comma-separated list of site domains to track')
    .option('--account-id <id>', 'Cloudflare account ID (32-char hex)')
    .option('--name <name>', 'Worker name', 'lazyanalytics')
    .option('--rotate-secrets', 'Regenerate API_SECRET and HASH_SALT instead of reusing them')
    .option('-y, --yes', 'Non-interactive mode: never prompt, fail if input is missing')
    .action(async (opts) => {
      loadEnv();
      const nonInteractive = !!opts.yes;

      // --- Cloudflare API token (env only, optionally prompted; never printed) ---
      let apiToken = process.env.CLOUDFLARE_API_TOKEN || '';
      if (!apiToken) {
        if (nonInteractive) {
          fail('CLOUDFLARE_API_TOKEN env var is required (create one at dash.cloudflare.com with Workers Scripts:Edit + Account Analytics:Read)');
        }
        apiToken = await promptHidden('Cloudflare API token (input hidden): ');
        if (!apiToken) fail('A Cloudflare API token is required');
      }

      // --- Account ID ---
      let accountId =
        opts.accountId || process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || '';
      if (!accountId) {
        if (nonInteractive) fail('Account ID required: pass --account-id or set CF_ACCOUNT_ID');
        accountId = await prompt('Cloudflare account ID (dash.cloudflare.com > Workers & Pages sidebar): ');
      }
      if (!/^[a-f0-9]{32}$/i.test(accountId)) {
        fail('Account ID must be a 32-character hex string');
      }

      // --- Sites (flag > existing scaffold > prompt) ---
      const wranglerTomlPath = join(WORKER_SCAFFOLD_DIR, 'wrangler.toml');
      let sitesRaw: string = opts.sites || '';
      if (!sitesRaw) {
        const existing = readAllowedSites(wranglerTomlPath);
        if (existing.length > 0) {
          sitesRaw = existing.join(',');
          console.log(`Reusing existing site list: ${sitesRaw}`);
        }
      }
      if (!sitesRaw) {
        if (nonInteractive) fail('Site list required: pass --sites example.com,blog.example.com');
        sitesRaw = await prompt('Sites to track (comma-separated, e.g. mysite.com,blog.example.com): ');
      }
      const sites = parseSites(sitesRaw);

      // --- Scaffold ~/.config/lazyanalytics/worker/ ---
      mkdirSync(WORKER_SCAFFOLD_DIR, { recursive: true });

      const bundlePath = packagedWorkerBundle();
      if (!existsSync(bundlePath)) {
        fail(
          `Worker bundle not found at ${bundlePath}. ` +
            'If running from a repo clone, run "npm run build" at the repo root first.',
        );
      }
      copyFileSync(bundlePath, join(WORKER_SCAFFOLD_DIR, 'worker.js'));

      const templatePath = packagedWranglerTemplate();
      if (!existsSync(templatePath)) fail(`wrangler.toml template not found at ${templatePath}`);
      const toml = readFileSync(templatePath, 'utf-8')
        .replace(/__WORKER_NAME__/g, opts.name)
        .replace(/__ALLOWED_SITES__/g, sites.join(','));
      writeFileSync(wranglerTomlPath, toml);
      console.log(`Scaffolded worker in ${WORKER_SCAFFOLD_DIR}`);

      // --- Deploy ---
      const wranglerEnv = { CLOUDFLARE_API_TOKEN: apiToken, CLOUDFLARE_ACCOUNT_ID: accountId };
      console.log('\nDeploying worker with wrangler...');
      const deployOutput = await wranglerDeploy(WORKER_SCAFFOLD_DIR, wranglerEnv);

      let workerUrl = parseWorkersDevUrl(deployOutput);
      if (!workerUrl) {
        console.error('\nError: could not parse the workers.dev URL from wrangler output.');
        if (nonInteractive) {
          fail('Re-run interactively, or check "npx wrangler deployments list" for the URL');
        }
        const entered = await prompt('Paste the deployed worker URL (https://...workers.dev): ');
        if (!/^https:\/\/.+/.test(entered)) fail('A valid https:// worker URL is required');
        workerUrl = entered.replace(/\/$/, '');
      }

      // --- Secrets (reused across runs unless --rotate-secrets) ---
      const existingConfig = readEnvFile(CONFIG_ENV_PATH);
      const rotate = !!opts.rotateSecrets;
      const apiSecret =
        !rotate && existingConfig.ANALYTICS_API_TOKEN
          ? existingConfig.ANALYTICS_API_TOKEN
          : randomBytes(32).toString('hex');
      const hashSalt =
        !rotate && existingConfig.HASH_SALT
          ? existingConfig.HASH_SALT
          : randomBytes(32).toString('hex');

      console.log('\nSetting worker secrets (values are never printed)...');
      await wranglerSecretPut(WORKER_SCAFFOLD_DIR, wranglerEnv, 'API_SECRET', apiSecret);
      await wranglerSecretPut(WORKER_SCAFFOLD_DIR, wranglerEnv, 'HASH_SALT', hashSalt);
      // The /api/* query endpoints read Analytics Engine through Cloudflare's
      // SQL REST API, which needs account credentials on the worker. A token
      // with Account Analytics:Read suffices; pass a narrower token here via
      // setup if you don't want the deploy token stored on the worker.
      await wranglerSecretPut(WORKER_SCAFFOLD_DIR, wranglerEnv, 'CF_ACCOUNT_ID', accountId);
      await wranglerSecretPut(WORKER_SCAFFOLD_DIR, wranglerEnv, 'CF_API_TOKEN', apiToken);

      // --- Persist CLI config (0600) ---
      writeEnvFile(CONFIG_ENV_PATH, {
        ...existingConfig,
        ANALYTICS_API_URL: workerUrl,
        ANALYTICS_API_TOKEN: apiSecret,
        CF_ACCOUNT_ID: accountId,
        HASH_SALT: hashSalt,
      });
      console.log(`Config written to ${CONFIG_ENV_PATH} (mode 0600)`);

      // --- Health check ---
      try {
        const res = await fetch(`${workerUrl}/health`);
        console.log(`\nHealth check: ${res.ok ? 'ok' : `failed (HTTP ${res.status})`}`);
      } catch (e) {
        console.log(
          `\nHealth check: unreachable (${e instanceof Error ? e.message : 'unknown error'}). ` +
            'The worker may take a few seconds to become available.',
        );
      }

      // --- Tracking snippets ---
      console.log('\nSetup complete. Add this snippet to each site:');
      for (const site of sites) {
        console.log(`\n  ${site}:`);
        console.log(`    ${trackingSnippet(workerUrl, site)}`);
      }
      console.log('\nThen query with: lazyanalytics stats --site ' + sites[0]);
    });

  return cmd;
}
