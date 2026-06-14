import type { Context } from 'hono';
import type { Env } from '../index';
import { buildWhereClause, DATASET, envelope, extractParams, extractSampled, queryAE } from '../lib/query';

export async function channelsHandler(c: Context<{ Bindings: Env }>) {
  try {
    const { site, period, opts } = extractParams(c, c.env);
    const where = buildWhereClause(opts);

    const sql = `
      SELECT
        blob11 as channel,
        SUM(_sample_interval) as pageviews,
        COUNT(DISTINCT index1) as approx_visitors,
        MAX(_sample_interval) as max_interval
      FROM ${DATASET}
      ${where}
      GROUP BY blob11
      ORDER BY pageviews DESC
      LIMIT 50
    `;

    const result = await queryAE(c.env, sql);
    const { rows, sampled } = extractSampled(result.data);
    const data = rows.map((row) => ({
      ...row,
      channel: row.channel === '' || row.channel == null ? 'unknown' : row.channel,
    }));
    return c.json(envelope(data, site, period, sampled));
  } catch (e) {
    const msg = e instanceof Error && !e.message.includes('Analytics Engine') ? e.message : 'Internal query error';
    return c.json({ error: msg }, 400);
  }
}
