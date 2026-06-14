import type { Env } from '../index';
import {
  buildWhereClause,
  DATASET,
  dayKeys,
  extractSampled,
  parseAllowedSites,
  queryAE,
  utcDayBounds,
  utcDayKey,
} from './query';

export type RollupDimension = 'pages' | 'referrers' | 'geo' | 'browsers' | 'os' | 'device';

export interface RollupRow {
  name: string;
  views: number;
  approx_visitors: number;
}

export interface DailyRollup {
  date: string;
  site: string;
  sampled: boolean;
  totals: {
    views: number;
    approx_daily_visitors: number;
    avg_screen_width: number;
  };
  pages: RollupRow[];
  referrers: RollupRow[];
  geo: RollupRow[];
  browsers: RollupRow[];
  os: RollupRow[];
  device: RollupRow[];
}

const DIMENSION_COLUMNS: Record<RollupDimension, string> = {
  pages: 'blob2',
  referrers: 'blob3',
  geo: 'blob4',
  browsers: 'blob5',
  os: 'blob6',
  device: 'blob7',
};

function asNumber(value: unknown): number {
  return Number(value) || 0;
}

function capRows(rows: RollupRow[], cap = 100): RollupRow[] {
  if (rows.length <= cap) return rows;
  const head = rows.slice(0, cap);
  const tail = rows.slice(cap);
  head.push({
    name: 'other',
    views: tail.reduce((sum, row) => sum + row.views, 0),
    approx_visitors: tail.reduce((sum, row) => sum + row.approx_visitors, 0),
  });
  return head;
}

async function rollupDimension(env: Env, site: string, day: string, dimension: RollupDimension) {
  const { startAt, endAt } = utcDayBounds(day);
  const where = buildWhereClause({ site, startAt, endAt });
  const column = DIMENSION_COLUMNS[dimension];
  const sql = `
    SELECT
      ${column} as name,
      SUM(_sample_interval) as views,
      COUNT(DISTINCT index1) as approx_visitors,
      MAX(_sample_interval) as max_interval
    FROM ${DATASET}
    ${where}
      AND ${column} != ''
    GROUP BY ${column}
    ORDER BY views DESC
    LIMIT 1000
  `;

  const result = await queryAE(env, sql);
  const { rows, sampled } = extractSampled(result.data);
  return {
    rows: capRows(rows.map((row) => ({
      name: String(row.name || ''),
      views: asNumber(row.views),
      approx_visitors: asNumber(row.approx_visitors),
    }))),
    sampled,
  };
}

export async function buildDailyRollup(env: Env, site: string, day: string): Promise<DailyRollup> {
  const { startAt, endAt } = utcDayBounds(day);
  const where = buildWhereClause({ site, startAt, endAt });
  const totalsSql = `
    SELECT
      SUM(_sample_interval) as views,
      COUNT(DISTINCT index1) as approx_daily_visitors,
      SUM(_sample_interval * double2) / (SUM(_sample_interval) + 0.0001) as avg_screen_width,
      MAX(_sample_interval) as max_interval
    FROM ${DATASET}
    ${where}
  `;

  const totalsResult = await queryAE(env, totalsSql);
  const totalsSampled = extractSampled(totalsResult.data);
  const totalsRow = totalsSampled.rows[0] || {};
  const dimensions = await Promise.all(
    (Object.keys(DIMENSION_COLUMNS) as RollupDimension[]).map(async (dimension) => [
      dimension,
      await rollupDimension(env, site, day, dimension),
    ] as const),
  );

  const rollup = {
    date: day,
    site,
    sampled: totalsSampled.sampled || dimensions.some(([, value]) => value.sampled),
    totals: {
      views: asNumber(totalsRow.views),
      approx_daily_visitors: asNumber(totalsRow.approx_daily_visitors),
      avg_screen_width: asNumber(totalsRow.avg_screen_width),
    },
    pages: [],
    referrers: [],
    geo: [],
    browsers: [],
    os: [],
    device: [],
  } as DailyRollup;

  for (const [dimension, value] of dimensions) {
    rollup[dimension] = value.rows;
  }
  return rollup;
}

// Each buildDailyRollup issues ~8 Analytics Engine subrequests (1 totals + 6
// dimensions + 1 R2 put), and Workers cap subrequests per invocation (50 on the
// free plan). So a single cron run rolls up at most MAX_BUILDS_PER_RUN missing
// days, scanning a short recent window newest-first. Daily runs keep R2 current
// going forward and self-heal short gaps; we intentionally do NOT backfill the
// full 90-day window in one invocation (it blows the subrequest budget).
const ROLLUP_BACKFILL_WINDOW_DAYS = 5;
const MAX_BUILDS_PER_RUN = 4;

export async function rollupYesterday(env: Env, now: Date = new Date()): Promise<void> {
  if (!env.ARCHIVE || !env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return;

  const sites = parseAllowedSites(env.ALLOWED_SITES);
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const oldest = new Date(yesterday.getTime() - (ROLLUP_BACKFILL_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000);

  let builds = 0;
  for (const site of sites) {
    // Newest day first so the most-queried recent days are archived before older ones.
    const days = dayKeys(oldest, yesterday).reverse();
    for (const day of days) {
      if (builds >= MAX_BUILDS_PER_RUN) return;
      const key = `rollups/${site}/${day}.json`;
      try {
        const existing = await env.ARCHIVE.head(key);
        if (existing) continue;
        const rollup = await buildDailyRollup(env, site, day);
        await env.ARCHIVE.put(key, JSON.stringify(rollup));
        builds += 1;
      } catch {
        // One site/day failure should not prevent later days or sites from rolling up.
      }
    }
  }
}

export function isLiveRetentionDay(day: string, now: Date = new Date()): boolean {
  const { startAt } = utcDayBounds(day);
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 90));
  return startAt >= cutoff && day <= utcDayKey(now);
}
