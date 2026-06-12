import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { fetchSites, getApiConfig } from '../lib/api.js';
import { WORKER_SCAFFOLD_DIR, loadEnv } from '../lib/env.js';
import { isValidDomain, trackingSnippet } from '../lib/prompt.js';
import { SCAFFOLD_WRANGLER_TOML, readAllowedSites, writeAllowedSites } from '../lib/scaffold.js';
import { wranglerDeploy } from '../lib/wrangler.js';

function requireApiConfig() {
  const config = getApiConfig();
  if (!config) {
    console.error('Error: ANALYTICS_API_URL and ANALYTICS_API_TOKEN are required.');
    console.error('Run "lazyanalytics setup" first, or set them in the environment.');
    process.exit(3);
  }
  return config;
}

function requireScaffold(): void {
  if (!existsSync(SCAFFOLD_WRANGLER_TOML)) {
    console.error(`Error: worker scaffold not found at ${WORKER_SCAFFOLD_DIR}.`);
    console.error('Run "lazyanalytics setup" first to deploy the worker.');
    process.exit(3);
  }
}

function requireWranglerEnv() {
  loadEnv();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!apiToken) {
    console.error('Error: CLOUDFLARE_API_TOKEN env var is required to redeploy the worker.');
    process.exit(3);
  }
  if (!accountId) {
    console.error('Error: CF_ACCOUNT_ID is required (set during "lazyanalytics setup").');
    process.exit(3);
  }
  return { CLOUDFLARE_API_TOKEN: apiToken, CLOUDFLARE_ACCOUNT_ID: accountId };
}

async function redeployAndReport(verb: string, domain: string, sites: string[]): Promise<void> {
  // Resolve credentials before mutating the scaffold, so a missing token
  // can't leave wrangler.toml out of sync with the deployed worker.
  const wranglerEnv = requireWranglerEnv();
  writeAllowedSites(sites);
  console.error(`Redeploying worker with updated site list...`);
  await wranglerDeploy(WORKER_SCAFFOLD_DIR, wranglerEnv);
  console.log(JSON.stringify({ data: sites.map((site) => ({ site })), [verb]: domain }, null, 2));
}

export function sitesCommand(): Command {
  const cmd = new Command('sites');
  cmd.description('Manage the list of tracked sites (list, add, remove)');

  cmd
    .command('list')
    .description('List tracked sites (queries the worker /api/sites endpoint)')
    .option('--json', 'Output as JSON (default)', true)
    .option('--table', 'Output as human-readable list')
    .action(async (opts) => {
      try {
        const sites = await fetchSites(requireApiConfig());
        if (opts.table) {
          if (sites.length === 0) console.log('(no sites configured)');
          for (const site of sites) console.log(site);
        } else {
          console.log(JSON.stringify({ data: sites.map((site) => ({ site })) }, null, 2));
        }
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
        process.exit(1);
      }
    });

  cmd
    .command('add <domain>')
    .description('Add a site to ALLOWED_SITES and redeploy the worker')
    .action(async (domain: string) => {
      try {
        requireScaffold();
        const site = domain.trim().toLowerCase();
        if (!isValidDomain(site)) {
          console.error(`Error: invalid domain "${domain}" (expected e.g. example.com)`);
          process.exit(1);
        }
        const sites = readAllowedSites();
        if (sites.includes(site)) {
          console.error(`Site ${site} is already tracked.`);
          process.exit(0);
        }
        sites.push(site);
        await redeployAndReport('added', site, sites);
        const apiUrl = process.env.ANALYTICS_API_URL;
        if (apiUrl) {
          console.error(`\nAdd this snippet to ${site}:`);
          console.error(`  ${trackingSnippet(apiUrl, site)}`);
        }
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
        process.exit(1);
      }
    });

  cmd
    .command('remove <domain>')
    .description('Remove a site from ALLOWED_SITES and redeploy the worker')
    .action(async (domain: string) => {
      try {
        requireScaffold();
        const site = domain.trim().toLowerCase();
        const sites = readAllowedSites();
        if (!sites.includes(site)) {
          console.error(`Error: site ${site} is not in the tracked list.`);
          process.exit(1);
        }
        const remaining = sites.filter((s) => s !== site);
        if (remaining.length === 0) {
          console.error('Error: cannot remove the last tracked site.');
          process.exit(1);
        }
        await redeployAndReport('removed', site, remaining);
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
        process.exit(1);
      }
    });

  return cmd;
}
