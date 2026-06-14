import type { Context } from 'hono';
import type { Env } from '../index';
import { buildWhereClause, DATASET, envelope, extractParams, queryAE } from '../lib/query';

export async function bounceHandler(c: Context<{ Bindings: Env }>) {
  try {
    const { site, period, opts } = extractParams(c, c.env);
    const where = buildWhereClause(opts);

    const sql = `
      SELECT
        blob12 as session_key,
        SUM(_sample_interval) as pv_weight,
        SUM(double1) as pv_rows,
        MAX(_sample_interval) as max_interval
      FROM ${DATASET}
      ${where}
        AND blob12 != ''
      GROUP BY blob12
      ORDER BY pv_weight DESC
      LIMIT 100000
    `;

    const result = await queryAE(c.env, sql);
    const sampled = result.data.some((row) => Number(row.max_interval) > 1);
    const approxSessions = result.data.length;
    const bouncedSessions = result.data.filter((row) => Number(row.pv_rows) === 1).length;

    const data: {
      bounce_rate: number | null;
      approx_sessions: number;
      bounced_sessions: number;
      warning?: string;
    } = {
      bounce_rate: approxSessions > 0 && !sampled ? bouncedSessions / approxSessions : null,
      approx_sessions: approxSessions,
      bounced_sessions: bouncedSessions,
    };
    if (sampled) data.warning = 'bounce rate unreliable when sampled';

    return c.json(envelope(data, site, period, sampled));
  } catch (e) {
    const msg = e instanceof Error && !e.message.includes('Analytics Engine') ? e.message : 'Internal query error';
    return c.json({ error: msg }, 400);
  }
}
