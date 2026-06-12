import type { Context } from 'hono';
import type { Env } from '../index';
import { extractParams, buildWhereClause, queryAE, envelope, extractSampled, DATASET } from '../lib/query';

export async function browsersHandler(c: Context<{ Bindings: Env }>) {
  try {
    const { site, period, limit, opts } = extractParams(c, c.env);
    const where = buildWhereClause(opts);
    const type = c.req.query('type') || 'browser'; // browser, os, device

    let groupCol: string;
    switch (type) {
      case 'os':
        groupCol = 'blob6';
        break;
      case 'device':
        groupCol = 'blob7';
        break;
      default:
        groupCol = 'blob5'; // browser
    }

    const sql = `
      SELECT
        ${groupCol} as name,
        SUM(_sample_interval) as views,
        COUNT(DISTINCT index1) as approx_visitors,
        MAX(_sample_interval) as max_interval
      FROM ${DATASET}
      ${where}
        AND ${groupCol} != ''
      GROUP BY ${groupCol}
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
