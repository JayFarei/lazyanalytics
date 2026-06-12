import { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import tls from 'node:tls';
import { loadEnv } from '../lib/env.js';

// Advanced/experimental: trust an extra proxy CA cert at runtime.
// Opt-in only via ANALYTICS_PROXY_CA=<path> — never loaded implicitly from
// the working directory. NODE_EXTRA_CA_CERTS must be set before Node boots,
// so we patch the secure context here instead.
function loadProxyCA(path: string) {
  if (!existsSync(path)) return;
  try {
    const cert = readFileSync(path, 'utf-8');
    const origCreateSecureContext = tls.createSecureContext;
    tls.createSecureContext = function (options = {}) {
      const ctx = origCreateSecureContext.call(this, options);
      ctx.context.addCACert(cert);
      return ctx;
    };
  } catch { /* ignore */ }
}

if (process.env.HTTPS_PROXY && process.env.ANALYTICS_PROXY_CA) {
  loadProxyCA(resolve(process.env.ANALYTICS_PROXY_CA));
}

interface ApiResponse {
  data: unknown;
  meta: { site: string; period: string; sampled: boolean };
}

function getConfig() {
  loadEnv();
  const apiUrl = process.env.ANALYTICS_API_URL;
  const apiToken = process.env.ANALYTICS_API_TOKEN;
  const proxyMode = !!process.env.HTTPS_PROXY;

  if (!apiUrl) {
    console.error('Error: ANALYTICS_API_URL is not configured.');
    console.error('Example: https://lazyanalytics.YOUR-SUBDOMAIN.workers.dev');
    console.error('');
    console.error('Run "lazyanalytics setup" to deploy and configure, or set');
    console.error('ANALYTICS_API_URL and ANALYTICS_API_TOKEN in the environment.');
    process.exit(3);
  }

  // In proxy mode (HTTPS_PROXY set), the proxy injects the Authorization header.
  if (!apiToken && !proxyMode) {
    console.error('Error: No authentication configured.');
    console.error('');
    console.error('Set ANALYTICS_API_TOKEN in the environment, or run');
    console.error('"lazyanalytics setup" to write it to ~/.config/lazyanalytics/.env.');
    process.exit(3);
  }

  return { apiUrl: apiUrl.replace(/\/$/, ''), apiToken: apiToken || '', proxyMode };
}

async function fetchApi(endpoint: string, params: Record<string, string>): Promise<ApiResponse> {
  const { apiUrl, apiToken, proxyMode } = getConfig();
  const url = new URL(`${apiUrl}/api/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }

  // In proxy mode, the credential proxy injects the Authorization header.
  // In direct mode, we add it ourselves.
  const headers: Record<string, string> = {};
  if (!proxyMode && apiToken) {
    headers.Authorization = `Bearer ${apiToken}`;
  }

  const response = await fetch(url.toString(), { headers });

  if (response.status === 401) {
    console.error('Error: Authentication failed. Check your ANALYTICS_API_TOKEN.');
    process.exit(3);
  }

  if (!response.ok) {
    const body = await response.text();
    console.error(`Error: API returned ${response.status}: ${body}`);
    process.exit(1);
  }

  return response.json() as Promise<ApiResponse>;
}

function formatTable(data: Record<string, unknown>[]): string {
  if (data.length === 0) return '(no data)';

  const keys = Object.keys(data[0]);
  const widths = keys.map((k) =>
    Math.max(k.length, ...data.map((row) => String(row[k] ?? '').length)),
  );

  const header = keys.map((k, i) => k.padEnd(widths[i])).join('  ');
  const sep = widths.map((w) => '-'.repeat(w)).join('  ');
  const rows = data.map((row) =>
    keys.map((k, i) => String(row[k] ?? '').padEnd(widths[i])).join('  '),
  );

  return [header, sep, ...rows].join('\n');
}

export function makeCommand(name: string, description: string): Command {
  const cmd = new Command(name);
  cmd
    .description(description)
    .requiredOption('-s, --site <site>', 'Site to query (e.g., example.com)')
    .option('-p, --period <period>', 'Time period (e.g., 7d, 30d)', '7d')
    .option('-l, --limit <limit>', 'Max results to return', '10')
    .option('--json', 'Output as JSON (default)', true)
    .option('--table', 'Output as human-readable table')
    .action(async (opts) => {
      try {
        const params: Record<string, string> = {
          site: opts.site,
          period: opts.period,
          limit: opts.limit,
        };

        // Add extra params from the command (type, unit)
        if (opts.type) params.type = opts.type;
        if (opts.unit) params.unit = opts.unit;

        const result = await fetchApi(name, params);

        if (opts.table) {
          const arr = Array.isArray(result.data) ? result.data : [result.data];
          console.log(formatTable(arr as Record<string, unknown>[]));
          if (result.meta.sampled) {
            console.log('\n(data may be sampled)');
          }
        } else {
          console.log(JSON.stringify(result, null, 2));
        }

        // Exit code 2 if no data
        const dataArr = Array.isArray(result.data) ? result.data : [result.data];
        const isEmpty = dataArr.length === 0 || (dataArr.length === 1 && Object.values(dataArr[0] as Record<string, unknown>).every((v) => v === 0 || v === null));
        if (isEmpty) process.exit(2);
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
        process.exit(1);
      }
    });

  return cmd;
}
