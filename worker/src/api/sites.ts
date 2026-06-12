import type { Context } from 'hono';
import type { Env } from '../index';
import { parseAllowedSites } from '../lib/query';

/** List the sites this deployment is configured to track (from ALLOWED_SITES). */
export async function sitesHandler(c: Context<{ Bindings: Env }>) {
  const sites = parseAllowedSites(c.env.ALLOWED_SITES);

  const meta: { count: number; hint?: string } = { count: sites.length };
  if (sites.length === 0) {
    meta.hint =
      'No sites configured. Run: lazyanalytics sites add <domain> (or set ALLOWED_SITES in wrangler.toml and redeploy).';
  }

  return c.json({
    data: sites.map((site) => ({ site })),
    meta,
  });
}
