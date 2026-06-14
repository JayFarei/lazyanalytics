import type { Context } from 'hono';
import type { Env } from '../index';
import { buildWhereClause, DATASET, envelope, extractSampled, queryAE, validateSite } from '../lib/query';

function parseWindow(raw: string | undefined): number {
  const parsed = raw ? parseInt(raw, 10) : 5;
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(Math.max(parsed, 1), 60);
}

export async function activeHandler(c: Context<{ Bindings: Env }>) {
  try {
    const site = c.req.query('site');
    if (!site) throw new Error('Missing required parameter: site');
    if (!validateSite(site, c.env.ALLOWED_SITES)) throw new Error(`Unknown site: ${site}`);

    const windowMinutes = parseWindow(c.req.query('window'));
    const endAt = new Date();
    const startAt = new Date(endAt.getTime() - windowMinutes * 60 * 1000);
    const where = buildWhereClause({ site, startAt, endAt });

    const sql = `
      SELECT
        COUNT(DISTINCT index1) as active_visitors,
        SUM(_sample_interval) as recent_pageviews,
        MAX(_sample_interval) as max_interval
      FROM ${DATASET}
      ${where}
    `;

    const result = await queryAE(c.env, sql);
    const { rows, sampled } = extractSampled(result.data);
    const row = rows[0] || { active_visitors: 0, recent_pageviews: 0 };

    return c.json(envelope({ ...row, window_minutes: windowMinutes }, site, `${windowMinutes}m`, sampled));
  } catch (e) {
    const msg = e instanceof Error && !e.message.includes('Analytics Engine') ? e.message : 'Internal query error';
    return c.json({ error: msg }, 400);
  }
}
