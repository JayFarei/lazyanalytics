import type { Context } from 'hono';
import type { Env } from '../index';
import { extractParams, buildWhereClause, queryAE, envelope, extractSampled, DATASET } from '../lib/query';

export async function geoHandler(c: Context<{ Bindings: Env }>) {
  try {
    const { site, period, limit, opts } = extractParams(c, c.env);
    const where = buildWhereClause(opts);

    const sql = `
      SELECT
        blob4 as country,
        SUM(_sample_interval) as views,
        COUNT(DISTINCT index1) as approx_visitors,
        MAX(_sample_interval) as max_interval
      FROM ${DATASET}
      ${where}
        AND blob4 != '' AND blob4 != 'XX'
      GROUP BY blob4
      ORDER BY views DESC
      LIMIT ${limit}
    `;

    const result = await queryAE(c.env, sql);
    const { rows, sampled } = extractSampled(result.data);
    return c.json(envelope(rows, site, period, sampled));
  } catch (e) {
    const msg = e instanceof Error && !e.message.includes('Analytics Engine') ? e.message : 'Internal query error';
    return c.json({ error: msg }, 400);
  }
}
