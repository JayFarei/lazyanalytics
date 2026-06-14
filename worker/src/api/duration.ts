import type { Context } from 'hono';
import type { Env } from '../index';
import { buildWhereClause, DATASET, envelope, extractParams, queryAE } from '../lib/query';

export async function durationHandler(c: Context<{ Bindings: Env }>) {
  try {
    const { site, period, opts } = extractParams(c, c.env);
    const where = buildWhereClause(opts, { eventType: 'all' });

    const sql = `
      SELECT
        blob12 as session_key,
        toUInt32(MAX(timestamp)) - toUInt32(MIN(timestamp)) as span_s,
        MAX(double4) as dwell_ms,
        MAX(_sample_interval) as w,
        MAX(_sample_interval) as max_interval
      FROM ${DATASET}
      ${where}
        AND blob12 != ''
      GROUP BY blob12
      ORDER BY w DESC
      LIMIT 100000
    `;

    const result = await queryAE(c.env, sql);
    const sampled = result.data.some((row) => Number(row.max_interval) > 1);
    let weightedSeconds = 0;
    let totalWeight = 0;

    for (const row of result.data) {
      const weight = Number(row.w) || 1;
      const spanSeconds = Number(row.span_s) || 0;
      const dwellSeconds = (Number(row.dwell_ms) || 0) / 1000;
      weightedSeconds += Math.max(spanSeconds, dwellSeconds) * weight;
      totalWeight += weight;
    }

    const data = {
      avg_session_seconds: totalWeight > 0 ? weightedSeconds / totalWeight : 0,
      approx_sessions: result.data.length,
    };

    return c.json(envelope(data, site, period, sampled));
  } catch (e) {
    const msg = e instanceof Error && !e.message.includes('Analytics Engine') ? e.message : 'Internal query error';
    return c.json({ error: msg }, 400);
  }
}
