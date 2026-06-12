import { loadEnv } from './env.js';

export interface ApiConfig {
  apiUrl: string;
  apiToken: string;
  proxyMode: boolean;
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

/** Fetch the list of tracked sites from the worker's /api/sites endpoint. */
export async function fetchSites(config: ApiConfig): Promise<string[]> {
  const headers: Record<string, string> = {};
  if (!config.proxyMode && config.apiToken) {
    headers.Authorization = `Bearer ${config.apiToken}`;
  }
  const res = await fetch(`${config.apiUrl}/api/sites`, { headers });
  if (res.status === 401) {
    throw new Error('Authentication failed. Check your ANALYTICS_API_TOKEN.');
  }
  if (!res.ok) {
    throw new Error(`API returned ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { data?: Array<{ site?: string }> };
  return (body.data ?? []).map((row) => row.site ?? '').filter(Boolean);
}
