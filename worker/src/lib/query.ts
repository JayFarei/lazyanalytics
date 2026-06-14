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

export type TrafficClassFilter = 'human' | 'ai' | 'all';
export type EventTypeFilter = 'pv' | 'all';

export interface WhereClauseFilters {
  trafficClass?: TrafficClassFilter;
  eventType?: EventTypeFilter;
}

export interface ApiResponse<T, M extends Record<string, unknown> = Record<string, never>> {
  data: T;
  meta: {
    site: string;
    period: string;
    sampled: boolean;
  } & M;
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

/**
 * Empty Analytics Engine blobs have been observed as deployment-sensitive; this
 * predicate intentionally matches both representations until the live probe
 * can narrow it for the release deployment.
 */
export const HUMAN_TRAFFIC_PREDICATE = "(blob10 = '' OR blob10 IS NULL)";
export const PAGEVIEW_EVENT_PREDICATE = "(blob16 = 'pv' OR blob16 = '' OR blob16 IS NULL)";

/** Build the WHERE clause for site filtering + time range + shared row filters */
export function buildWhereClause(opts: QueryOptions, filters: WhereClauseFilters = {}): string {
  const site = opts.site.replace(/'/g, "''"); // escape single quotes
  const start = formatTimestamp(opts.startAt);
  const end = formatTimestamp(opts.endAt);

  const trafficClass = filters.trafficClass ?? 'human';
  const trafficClause =
    trafficClass === 'human'
      ? ` AND ${HUMAN_TRAFFIC_PREDICATE}`
      : trafficClass === 'ai'
        ? " AND blob10 = 'ai'"
        : '';

  const eventType = filters.eventType ?? 'pv';
  const eventClause = eventType === 'pv' ? ` AND ${PAGEVIEW_EVENT_PREDICATE}` : '';

  return `WHERE blob1 = '${site}' AND timestamp >= toDateTime('${start}') AND timestamp <= toDateTime('${end}')${trafficClause}${eventClause}`;
}

/** Wrap response in standard API envelope */
export function envelope<T, M extends Record<string, unknown> = Record<string, never>>(
  data: T,
  site: string,
  period: string,
  sampled: boolean,
  extraMeta?: M,
): ApiResponse<T, M> {
  return { data, meta: { site, period, sampled, ...(extraMeta || {}) } as ApiResponse<T, M>['meta'] };
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

/** Parse history periods; unlike parsePeriod this intentionally allows >90d. */
export function parseLongPeriod(params: {
  days?: string;
  from?: string;
  to?: string;
}, now: Date = new Date()): { startAt: Date; endAt: Date; period: string } {
  if (params.from || params.to) {
    if (!params.from || !params.to) {
      throw new Error('History requires both from and to when either is provided');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.from) || !/^\d{4}-\d{2}-\d{2}$/.test(params.to)) {
      throw new Error('History from/to must be YYYY-MM-DD');
    }
    const startAt = new Date(`${params.from}T00:00:00.000Z`);
    const endAt = new Date(`${params.to}T23:59:59.999Z`);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || startAt > endAt) {
      throw new Error('Invalid history date range');
    }
    return { startAt, endAt, period: `${params.from}..${params.to}` };
  }

  const days = params.days ? parseInt(params.days, 10) : 90;
  if (!Number.isFinite(days) || days < 1 || days > 3650) {
    throw new Error(`History days must be between 1 and 3650. Got: ${params.days}`);
  }
  const endAt = now;
  const startAt = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - days + 1,
  ));
  return { startAt, endAt, period: `${days}d` };
}

export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function utcDayBounds(day: string): { startAt: Date; endAt: Date } {
  return {
    startAt: new Date(`${day}T00:00:00.000Z`),
    endAt: new Date(`${day}T23:59:59.999Z`),
  };
}

export function dayKeys(startAt: Date, endAt: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(Date.UTC(startAt.getUTCFullYear(), startAt.getUTCMonth(), startAt.getUTCDate()));
  const last = new Date(Date.UTC(endAt.getUTCFullYear(), endAt.getUTCMonth(), endAt.getUTCDate()));
  while (cursor <= last) {
    keys.push(utcDayKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}
