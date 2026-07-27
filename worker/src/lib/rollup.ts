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
  /**
   * Mean engagement in ms for this row, over the beacons that carried one.
   * Optional: rollups archived before this field existed simply omit it, and
   * every consumer must treat `undefined` as "not measured", not as zero.
   */
  avg_engagement_ms?: number;
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
  // Views-weighted mean, so folding the tail does not let a single rarely-seen
  // page dominate the bucket's average.
  const tailViews = tail.reduce((sum, row) => sum + row.views, 0);
  const tailEngaged = tail.reduce(
    (sum, row) => sum + (row.avg_engagement_ms ?? 0) * row.views,
    0,
  );
  head.push({
    name: 'other',
    views: tailViews,
    approx_visitors: tail.reduce((sum, row) => sum + row.approx_visitors, 0),
    ...(tailEngaged > 0 ? { avg_engagement_ms: tailEngaged / (tailViews || 1) } : {}),
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
      SUM(IF(blob16 = 'eng', double4 * _sample_interval, 0)) as engagement_ms_total,
      SUM(IF(blob16 = 'eng', _sample_interval, 0)) as engagement_events,
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
    rows: capRows(rows.map((row) => {
      const engagedEvents = asNumber(row.engagement_events);
      return {
        name: String(row.name || ''),
        views: asNumber(row.views),
        approx_visitors: asNumber(row.approx_visitors),
        // Omitted rather than zeroed when nothing reported engagement: zero
        // would read as "they left instantly", which is a different claim.
        ...(engagedEvents > 0
          ? { avg_engagement_ms: asNumber(row.engagement_ms_total) / engagedEvents }
          : {}),
      };
    })),
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

// Subrequest budget: R2 binding calls (head/get/put) and AE REST fetches all
// count toward the Workers per-invocation subrequest cap (50 on the free plan).
// One fresh site/day build costs 9 subrequests (1 head + 7 AE queries + 1 put),
// so a steady-state cron run with N sites costs ~9N for the rollup phase plus 1
// webhook POST for the digest (which reuses this run's freshly built rollups
// instead of re-reading R2): the free plan fits at most 5 sites. The effective
// budget is max(MAX_BUILDS_PER_RUN, sites.length) so one run always covers
// yesterday for every configured site (issue #2: a fixed cap of 4 with 5 sites
// permanently starved the last site's archive). ATTEMPTS count toward the
// budget, successful or not, so a systemic AE/R2 failure stays bounded. With
// sites >= the fixed cap the whole budget goes to yesterday, so older gaps
// (e.g. from a skipped cron) heal on the next same-day invocation, such as the
// manual re-fire that is the documented recovery for a skipped cron (issue #1).
const ROLLUP_BACKFILL_WINDOW_DAYS = 5;
const MAX_BUILDS_PER_RUN = 4;

export interface RollupRunResult {
  built: number;
  failed: number;
  /** Rollups built for yesterday this run, keyed by site (the digest reuses them to skip R2 reads). */
  yesterdayRollups: Map<string, DailyRollup>;
}

export async function rollupYesterday(env: Env, now: Date = new Date()): Promise<RollupRunResult> {
  const result: RollupRunResult = { built: 0, failed: 0, yesterdayRollups: new Map() };
  if (!env.ARCHIVE || !env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
    console.warn('rollup: ARCHIVE binding or CF credentials missing, skipping rollup');
    return result;
  }

  const sites = parseAllowedSites(env.ALLOWED_SITES);
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const oldest = new Date(yesterday.getTime() - (ROLLUP_BACKFILL_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000);

  const maxBuilds = Math.max(MAX_BUILDS_PER_RUN, sites.length);
  // Newest day first, every site within a day: yesterday is archived for ALL
  // configured sites before any older backfill day, so the build budget can
  // never starve a site's current-day rollup.
  const days = dayKeys(oldest, yesterday).reverse();
  const yesterdayKey = days[0];
  let attempts = 0;
  for (const day of days) {
    for (const site of sites) {
      // Bound on failures too: a throwing ARCHIVE.head never reaches the
      // attempts increment below, and a systemic failure must not scan the
      // whole window at subrequest cost.
      if (attempts >= maxBuilds || result.failed >= maxBuilds) return result;
      const key = `rollups/${site}/${day}.json`;
      try {
        const existing = await env.ARCHIVE.head(key);
        if (existing) continue;
        attempts += 1;
        const rollup = await buildDailyRollup(env, site, day);
        await env.ARCHIVE.put(key, JSON.stringify(rollup));
        result.built += 1;
        if (day === yesterdayKey) result.yesterdayRollups.set(site, rollup);
      } catch (e) {
        // One site/day failure should not prevent later days or sites from rolling up.
        result.failed += 1;
        console.error(`rollup: build failed site=${site} day=${day}`, e);
      }
    }
  }
  return result;
}

export function isLiveRetentionDay(day: string, now: Date = new Date()): boolean {
  const { startAt } = utcDayBounds(day);
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 90));
  return startAt >= cutoff && day <= utcDayKey(now);
}
