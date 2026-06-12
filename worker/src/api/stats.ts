import type { Context } from 'hono';
import type { Env } from '../index';
import { extractParams, buildWhereClause, queryAE, envelope, extractSampled, DATASET } from '../lib/query';

export async function statsHandler(c: Context<{ Bindings: Env }>) {
  try {
    const { site, period, opts } = extractParams(c, c.env);
    const where = buildWhereClause(opts);

    const sql = `
      SELECT
        SUM(_sample_interval) as pageviews,
        COUNT(DISTINCT index1) as approx_daily_visitors,
        SUM(_sample_interval * double2) / (SUM(_sample_interval) + 0.0001) as avg_screen_width,
        MAX(_sample_interval) as max_interval
      FROM ${DATASET}
      ${where}
    `;

    const result = await queryAE(c.env, sql);
    const { rows, sampled } = extractSampled(result.data);
    const row = rows[0] || { pageviews: 0, approx_daily_visitors: 0, avg_screen_width: 0 };

    return c.json(envelope(row, site, period, sampled));
  } catch (e) {
    const msg = e instanceof Error && !e.message.includes('Analytics Engine') ? e.message : 'Internal query error';
    return c.json({ error: msg }, 400);
  }
}
