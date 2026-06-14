import type { Context } from 'hono';
import type { Env } from '../index';
import { buildWhereClause, DATASET, envelope, extractParams, extractSampled, queryAE } from '../lib/query';

const COLUMNS: Record<string, { column: string; alias: string }> = {
  name: { column: 'blob13', alias: 'name' },
  operator: { column: 'blob14', alias: 'operator' },
  class: { column: 'blob15', alias: 'class' },
};

export async function crawlersHandler(c: Context<{ Bindings: Env }>) {
  try {
    const { site, period, limit, opts } = extractParams(c, c.env);
    const requested = c.req.query('type') || 'name';
    const selected = COLUMNS[requested] || COLUMNS.name;
    const where = buildWhereClause(opts, { trafficClass: 'ai' });

    const sql = `
      SELECT
        ${selected.column} as ${selected.alias},
        SUM(_sample_interval) as hits,
        COUNT(DISTINCT index1) as approx_instances,
        MAX(_sample_interval) as max_interval
      FROM ${DATASET}
      ${where}
        AND ${selected.column} != ''
      GROUP BY ${selected.column}
      ORDER BY hits DESC
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
