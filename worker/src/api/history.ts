import type { Context } from 'hono';
import type { Env } from '../index';
import type { DailyRollup, RollupRow } from '../lib/rollup';
import { isLiveRetentionDay } from '../lib/rollup';
import {
  buildWhereClause,
  DATASET,
  dayKeys,
  envelope,
  extractSampled,
  parseLongPeriod,
  queryAE,
  utcDayBounds,
  validateSite,
} from '../lib/query';

type HistoryDimension = 'totals' | 'pages' | 'referrers' | 'geo' | 'browsers';

const LIVE_DIMENSIONS: Record<Exclude<HistoryDimension, 'totals'>, { column: string; alias: string }> = {
  pages: { column: 'blob2', alias: 'page' },
  referrers: { column: 'blob3', alias: 'referrer' },
  geo: { column: 'blob4', alias: 'country' },
  browsers: { column: 'blob5', alias: 'browser' },
};

function asNumber(value: unknown): number {
  return Number(value) || 0;
}

async function readRollup(env: Env, site: string, day: string): Promise<DailyRollup | null> {
  if (!env.ARCHIVE) return null;
  const object = await env.ARCHIVE.get(`rollups/${site}/${day}.json`);
  if (!object) return null;
  return object.json<DailyRollup>();
}

async function readRollups(env: Env, site: string, days: string[]): Promise<Map<string, DailyRollup>> {
  const found = new Map<string, DailyRollup>();
  const chunkSize = 40;

  for (let i = 0; i < days.length; i += chunkSize) {
    const chunk = days.slice(i, i + chunkSize);
    const results = await Promise.all(chunk.map(async (day) => [day, await readRollup(env, site, day)] as const));
    for (const [day, rollup] of results) {
      if (rollup) found.set(day, rollup);
    }
  }

  return found;
}

async function fetchLiveRange(env: Env, site: string, startAt: Date, endAt: Date, dimension: HistoryDimension) {
  const where = buildWhereClause({ site, startAt, endAt });

  if (dimension === 'totals') {
    const sql = `
      SELECT
        SUM(_sample_interval) as views,
        COUNT(DISTINCT index1) as approx_daily_visitors,
        SUM(_sample_interval * double2) / (SUM(_sample_interval) + 0.0001) as avg_screen_width,
        MAX(_sample_interval) as max_interval
      FROM ${DATASET}
      ${where}
    `;
    const result = await queryAE(env, sql);
    const { rows, sampled } = extractSampled(result.data);
    const row = rows[0] || {};
    return {
      sampled,
      totals: {
        views: asNumber(row.views),
        approx_daily_visitors: asNumber(row.approx_daily_visitors),
        avg_screen_width: asNumber(row.avg_screen_width),
      },
      rows: [],
    };
  }

  const selected = LIVE_DIMENSIONS[dimension];
  const sql = `
    SELECT
      ${selected.column} as name,
      SUM(_sample_interval) as views,
      COUNT(DISTINCT index1) as approx_visitors,
      MAX(_sample_interval) as max_interval
    FROM ${DATASET}
    ${where}
      AND ${selected.column} != ''
    GROUP BY ${selected.column}
    ORDER BY views DESC
    LIMIT 1000
  `;
  const result = await queryAE(env, sql);
  const { rows, sampled } = extractSampled(result.data);
  return {
    sampled,
    totals: null,
    rows: rows.map((row) => ({
      name: String(row.name || ''),
      views: asNumber(row.views),
      approx_visitors: asNumber(row.approx_visitors),
    })),
  };
}

function mergeRows(target: Map<string, RollupRow>, rows: RollupRow[]) {
  for (const row of rows) {
    const key = row.name || 'unknown';
    const existing = target.get(key) || { name: key, views: 0, approx_visitors: 0 };
    existing.views += row.views;
    existing.approx_visitors += row.approx_visitors;
    target.set(key, existing);
  }
}

export async function historyHandler(c: Context<{ Bindings: Env }>) {
  try {
    const site = c.req.query('site');
    if (!site) throw new Error('Missing required parameter: site');
    if (!validateSite(site, c.env.ALLOWED_SITES)) throw new Error(`Unknown site: ${site}`);

    const dimension = (c.req.query('dimension') || 'totals') as HistoryDimension;
    if (!['totals', 'pages', 'referrers', 'geo', 'browsers'].includes(dimension)) {
      throw new Error('Invalid dimension. Supported: totals, pages, referrers, geo, browsers');
    }

    const { startAt, endAt, period } = parseLongPeriod({
      days: c.req.query('days'),
      from: c.req.query('from'),
      to: c.req.query('to'),
    });

    const days = dayKeys(startAt, endAt);
    const liveDays = days.filter((day) => isLiveRetentionDay(day));
    const archiveDayList = days.filter((day) => !isLiveRetentionDay(day));
    const rollups = await readRollups(c.env, site, archiveDayList);

    const rows = new Map<string, RollupRow>();
    const totals = { views: 0, approx_daily_visitors: 0, avg_screen_width: 0 };
    let screenWeight = 0;
    let sampled = false;
    let archivedDaysMissing = 0;
    let archiveDays = 0;

    // Archived (>90d) days come from R2 rollups, one object per day.
    for (const day of archiveDayList) {
      const rollup = rollups.get(day) || null;
      if (!rollup) {
        archivedDaysMissing += 1;
        continue;
      }
      archiveDays += 1;
      sampled ||= !!rollup.sampled;
      if (dimension === 'totals') {
        totals.views += rollup.totals.views;
        totals.approx_daily_visitors += rollup.totals.approx_daily_visitors;
        screenWeight += rollup.totals.avg_screen_width * rollup.totals.views;
      } else {
        mergeRows(rows, rollup[dimension]);
      }
    }

    // Live (<=90d) span is queried in a SINGLE AE request, not one per day:
    // the daily-rotating visitor_hash already dedupes visitors per day, so a
    // range aggregate equals the sum of the per-day aggregates. This keeps the
    // live portion at exactly one subrequest regardless of how many days.
    if (liveDays.length > 0) {
      const liveStart = utcDayBounds(liveDays[0]).startAt;
      const liveEnd = utcDayBounds(liveDays[liveDays.length - 1]).endAt;
      const live = await fetchLiveRange(c.env, site, liveStart, liveEnd, dimension);
      sampled ||= live.sampled;
      if (dimension === 'totals' && live.totals) {
        totals.views += live.totals.views;
        totals.approx_daily_visitors += live.totals.approx_daily_visitors;
        screenWeight += live.totals.avg_screen_width * live.totals.views;
      } else {
        mergeRows(rows, live.rows);
      }
    }

    const source = liveDays.length > 0 && archiveDays > 0 ? 'blended' : archiveDays > 0 ? 'archive' : 'live';
    const data = dimension === 'totals'
      ? {
          views: totals.views,
          approx_daily_visitors: totals.approx_daily_visitors,
          avg_screen_width: totals.views > 0 ? screenWeight / totals.views : 0,
        }
      : Array.from(rows.values()).sort((a, b) => b.views - a.views).slice(0, 100);

    return c.json(envelope(data, site, period, sampled, {
      source,
      archived_days_missing: archivedDaysMissing,
    }));
  } catch (e) {
    const msg = e instanceof Error && !e.message.includes('Analytics Engine') ? e.message : 'Internal query error';
    return c.json({ error: msg }, 400);
  }
}
