import type { Context } from 'hono';
import type { Env } from '../index';
import { extractParams, buildWhereClause, queryAE, envelope, extractSampled, DATASET } from '../lib/query';

export async function timeseriesHandler(c: Context<{ Bindings: Env }>) {
  try {
    const { site, period, opts } = extractParams(c, c.env);
    const unit = c.req.query('unit') || 'day';
    const where = buildWhereClause(opts);

    let bucketSeconds: number;
    switch (unit) {
      case 'hour':
        bucketSeconds = 3600;
        break;
      case 'day':
        bucketSeconds = 86400;
        break;
      default:
        return c.json({ error: 'Invalid unit. Supported: hour, day' }, 400);
    }

    const sql = `
      SELECT
        intDiv(toUInt32(timestamp), ${bucketSeconds}) * ${bucketSeconds} as t,
        SUM(_sample_interval) as views,
        COUNT(DISTINCT index1) as approx_visitors,
        MAX(_sample_interval) as max_interval
      FROM ${DATASET}
      ${where}
      GROUP BY t
      ORDER BY t ASC
    `;

    const result = await queryAE(c.env, sql);
    const { rows, sampled } = extractSampled(result.data);

    // Convert epoch timestamps to ISO strings
    const data = rows.map((row: Record<string, unknown>) => ({
      timestamp: new Date((row.t as number) * 1000).toISOString(),
      views: row.views,
      approx_visitors: row.approx_visitors,
    }));

    return c.json(envelope(data, site, period, sampled));
  } catch (e) {
    const msg = e instanceof Error && !e.message.includes('Analytics Engine') ? e.message : 'Internal query error';
    return c.json({ error: msg }, 400);
  }
}
