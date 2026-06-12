import type { Env } from '../index';

/** Analytics Engine dataset name. Keep in sync with wrangler.toml. */
export const DATASET = 'agent_analytics';

/**
 * Analytics Engine SQL reads go through the Cloudflare REST API, which needs
 * account-scoped credentials. These are deliberately NOT part of the core Env:
 * deployments that only collect (and query from elsewhere) don't need them.
 * If set (via `wrangler secret put`), worker-side /api/* queries work.
 */
type QueryCredentials = {
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
};

export interface QueryOptions {
  site: string;
  startAt: Date;
  endAt: Date;
}

export interface ApiResponse<T> {
  data: T;
  meta: {
    site: string;
    period: string;
    sampled: boolean;
  };
}

/** Parse period string like "7d", "30d", "90d" into start/end dates */
export function parsePeriod(period: string): { startAt: Date; endAt: Date } {
  const match = period.match(/^(\d+)d$/);
  if (!match) {
    throw new Error(`Invalid period format: "${period}". Expected format: Nd (e.g., 7d, 30d, 90d)`);
  }

  const days = parseInt(match[1], 10);
  if (days < 1 || days > 90) {
    throw new Error(`Period must be between 1d and 90d. Got: ${days}d`);
  }

  const endAt = new Date();
  const startAt = new Date(endAt.getTime() - days * 24 * 60 * 60 * 1000);
  return { startAt, endAt };
}

/** Parse the ALLOWED_SITES var into a clean list (unset/empty treated as empty list) */
export function parseAllowedSites(allowedSites: string | undefined): string[] {
  return (allowedSites || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Validate site_id against allowed sites whitelist */
export function validateSite(site: string, allowedSites: string | undefined): boolean {
  return parseAllowedSites(allowedSites).includes(site);
}

/** Execute a SQL query against Analytics Engine */
export async function queryAE(
  env: Env & QueryCredentials,
  sql: string,
): Promise<{ data: Record<string, unknown>[]; meta: string[]; rows: number }> {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
    throw new Error(
      'Server not configured: CF_ACCOUNT_ID and CF_API_TOKEN secrets are not set on the worker, so it cannot run queries',
    );
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
      'Content-Type': 'text/plain',
    },
    body: sql,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Analytics Engine query failed (${response.status}): ${text}`);
  }

  const result = await response.json() as { data: Record<string, unknown>[]; meta: { name: string }[]; rows: number };
  return {
    data: result.data || [],
    meta: (result.meta || []).map((m: { name: string }) => m.name),
    rows: result.rows || 0,
  };
}

/** Format a Date to Analytics Engine SQL timestamp format */
export function formatTimestamp(d: Date): string {
  return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

/** Build the WHERE clause for site filtering + time range */
export function buildWhereClause(opts: QueryOptions): string {
  const site = opts.site.replace(/'/g, "''"); // escape single quotes
  const start = formatTimestamp(opts.startAt);
  const end = formatTimestamp(opts.endAt);
  return `WHERE blob1 = '${site}' AND timestamp >= toDateTime('${start}') AND timestamp <= toDateTime('${end}')`;
}

/** Wrap response in standard API envelope */
export function envelope<T>(data: T, site: string, period: string, sampled: boolean): ApiResponse<T> {
  return { data, meta: { site, period, sampled } };
}

/**
 * Compute an honest `sampled` flag from a `MAX(_sample_interval) as max_interval`
 * column included in the query, then strip that helper column from the rows.
 * A sample interval > 1 on any row means Analytics Engine sampled the data.
 */
export function extractSampled(rows: Record<string, unknown>[]): {
  rows: Record<string, unknown>[];
  sampled: boolean;
} {
  let sampled = false;
  const cleaned = rows.map((row) => {
    const { max_interval, ...rest } = row;
    if (Number(max_interval) > 1) sampled = true;
    return rest;
  });
  return { rows: cleaned, sampled };
}

/** Extract common query params from request */
export function extractParams(c: { req: { query: (key: string) => string | undefined } }, env: Env): {
  site: string;
  period: string;
  limit: number;
  opts: QueryOptions;
} {
  const site = c.req.query('site');
  const period = c.req.query('period') || '7d';
  const limitStr = c.req.query('limit');
  const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 10, 1), 100) : 10;

  if (!site) throw new Error('Missing required parameter: site');
  if (!validateSite(site, env.ALLOWED_SITES)) throw new Error(`Unknown site: ${site}`);

  const { startAt, endAt } = parsePeriod(period);
  return { site, period, limit, opts: { site, startAt, endAt } };
}
