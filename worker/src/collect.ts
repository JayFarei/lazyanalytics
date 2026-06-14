import type { Context } from 'hono';
import type { Env } from './index';
import { parseUA } from './lib/parse-ua';
import { hashVisitor, sessionWindow, todayUTC } from './lib/visitor';
import { classifyCrawler } from './lib/crawlers';
import { classifyChannel } from './lib/channels';

interface BeaconPayload {
  sid: string;   // site_id
  url: string;   // page URL
  ref?: string;  // referrer
  sw?: number;   // screen width
  us?: string;   // utm_source
  um?: string;   // utm_medium
  t?: 'pv' | 'eng'; // event type
  em?: number;   // engagement_ms
}

export async function collect(c: Context<{ Bindings: Env }>) {
  // Only accept POST
  if (c.req.method !== 'POST') {
    return c.text('Method not allowed', 405);
  }

  const ua = c.req.header('User-Agent') || '';

  const cls = classifyCrawler(ua);
  if (cls.kind === 'bot') {
    return c.newResponse(null, 204);
  }
  if (cls.kind === 'ai' && c.env.TRACK_AI_CRAWLERS !== 'true') {
    return c.newResponse(null, 204);
  }

  let payload: BeaconPayload;
  try {
    payload = await c.req.json<BeaconPayload>();
  } catch {
    return c.json({ error: 'Invalid JSON payload' }, 400);
  }

  // Validate required fields
  if (!payload.sid || !payload.url) {
    return c.json({ error: 'Missing required fields: sid, url' }, 400);
  }

  // Validate site_id against allowed list.
  // If ALLOWED_SITES is unset/empty the worker isn't configured yet:
  // silently drop the beacon rather than crash or store unattributed data.
  const allowedSites = (c.env.ALLOWED_SITES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowedSites.length === 0) {
    return c.newResponse(null, 204);
  }
  if (!allowedSites.includes(payload.sid)) {
    return c.json({ error: 'Unknown site' }, 400);
  }

  // HASH_SALT is required to produce salted visitor hashes. If it isn't set,
  // drop the beacon rather than store unsalted (reversible) hashes.
  if (!c.env.HASH_SALT) {
    return c.newResponse(null, 204);
  }

  // Strip query string and fragment from URL for privacy
  let pagePath: string;
  try {
    const parsed = new URL(payload.url);
    pagePath = parsed.pathname;
  } catch {
    pagePath = payload.url.split('?')[0].split('#')[0];
  }

  // Extract referrer domain only (strip path/query for privacy).
  // The tracker sends a bare hostname; full URLs are also accepted.
  let referrerDomain = '';
  if (payload.ref) {
    try {
      const host = new URL(payload.ref.includes('://') ? payload.ref : `https://${payload.ref}`).hostname;
      // Skip self/cross-property referrals (exact domain or subdomain match)
      const isOwnSite = allowedSites.some((s) => host === s || host.endsWith(`.${s}`));
      if (!isOwnSite && host.includes('.')) {
        referrerDomain = host;
      }
    } catch {
      // Invalid referrer, ignore
    }
  }

  // Get IP and country from Cloudflare headers
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  const country = c.req.header('CF-IPCountry') || 'XX';

  // Parse user agent
  const parsed = parseUA(ua);
  const channel = classifyChannel(referrerDomain, payload.us || '', payload.um || '');

  // Generate visitor hash (salted with the per-deployment HASH_SALT secret)
  const now = Date.now();
  const visitorHash = await hashVisitor(payload.sid, ip, ua, todayUTC(), c.env.HASH_SALT);
  const sessionHash = await hashVisitor(payload.sid, ip, ua, sessionWindow(now), c.env.HASH_SALT);
  const eventType = payload.t === 'eng' ? 'eng' : 'pv';
  const engagementMs = Math.max(0, Math.round(Number(payload.em) || 0));

  // Write to Analytics Engine (non-blocking)
  c.env.ANALYTICS.writeDataPoint({
    indexes: [visitorHash],
    blobs: [
      payload.sid,                         // blob1: site_id
      pagePath,                            // blob2: page path (no query string)
      referrerDomain,                      // blob3: referrer domain
      country,                             // blob4: country
      parsed.browser,                      // blob5: browser
      parsed.os,                           // blob6: OS
      parsed.device,                       // blob7: device type
      payload.us || '',                    // blob8: utm_source
      payload.um || '',                    // blob9: utm_medium
      cls.kind === 'ai' ? 'ai' : '',       // blob10: traffic_class
      channel,                             // blob11: channel
      sessionHash,                         // blob12: session_id
      cls.name || '',                      // blob13: crawler_name
      cls.operator || '',                  // blob14: crawler_operator
      cls.type || '',                      // blob15: crawler_type
      eventType,                           // blob16: event_type
    ],
    doubles: [
      1,                        // double1: count
      payload.sw || 0,          // double2: screen width
      0,                        // double3: reserved
      engagementMs,             // double4: engagement_ms
    ],
  });

  return c.newResponse(null, 204);
}
