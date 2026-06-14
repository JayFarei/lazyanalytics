import { loadEnv } from './env.js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import tls from 'node:tls';

// Advanced/experimental: trust an extra proxy CA cert at runtime.
// Opt-in only via ANALYTICS_PROXY_CA=<path>.
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
  } catch {
    /* ignore */
  }
}

if (process.env.HTTPS_PROXY && process.env.ANALYTICS_PROXY_CA) {
  loadProxyCA(resolve(process.env.ANALYTICS_PROXY_CA));
}

export interface ApiConfig {
  apiUrl: string;
  apiToken: string;
  proxyMode: boolean;
}

export interface ApiResponse {
  data: unknown;
  meta: { site: string; period: string; sampled: boolean };
}

/** Resolve API URL + token from env/config. Returns null if not configured. */
export function getApiConfig(): ApiConfig | null {
  loadEnv();
  const apiUrl = process.env.ANALYTICS_API_URL;
  const apiToken = process.env.ANALYTICS_API_TOKEN || '';
  const proxyMode = !!process.env.HTTPS_PROXY;
  if (!apiUrl || (!apiToken && !proxyMode)) return null;
  return { apiUrl: apiUrl.replace(/\/$/, ''), apiToken, proxyMode };
}

function requireApiConfig(): ApiConfig {
  const config = getApiConfig();
  if (!config) {
    console.error('Error: ANALYTICS_API_URL is not configured.');
    console.error('Example: https://lazyanalytics.YOUR-SUBDOMAIN.workers.dev');
    console.error('');
    console.error('Run "lazyanalytics setup" to deploy and configure, or set');
    console.error('ANALYTICS_API_URL and ANALYTICS_API_TOKEN in the environment.');
    process.exit(3);
  }
  return config;
}

function authHeaders(config: ApiConfig): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!config.proxyMode && config.apiToken) {
    headers.Authorization = `Bearer ${config.apiToken}`;
  }
  return headers;
}

export async function fetchApi(endpoint: string, params: Record<string, string>): Promise<ApiResponse> {
  const config = requireApiConfig();
  if (!config.apiToken && !config.proxyMode) {
    console.error('Error: No authentication configured.');
    console.error('');
    console.error('Set ANALYTICS_API_TOKEN in the environment, or run');
    console.error('"lazyanalytics setup" to write it to ~/.config/lazyanalytics/.env.');
    process.exit(3);
  }

  const url = new URL(`${config.apiUrl}/api/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }

  const response = await fetch(url.toString(), { headers: authHeaders(config) });

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

export function formatTable(data: Record<string, unknown>[]): string {
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

/** Fetch the list of tracked sites from the worker's /api/sites endpoint. */
export async function fetchSites(config: ApiConfig): Promise<string[]> {
  const res = await fetch(`${config.apiUrl}/api/sites`, { headers: authHeaders(config) });
  if (res.status === 401) {
    throw new Error('Authentication failed. Check your ANALYTICS_API_TOKEN.');
  }
  if (!res.ok) {
    throw new Error(`API returned ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { data?: Array<{ site?: string }> };
  return (body.data ?? []).map((row) => row.site ?? '').filter(Boolean);
}
