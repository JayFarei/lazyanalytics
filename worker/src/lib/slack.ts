import type { Env } from '../index';
import { buildDailyRollup, type DailyRollup, type RollupRow } from './rollup';
import { parseAllowedSites, utcDayKey } from './query';

/**
 * Slack daily digest. The cron (see scheduled.ts) first archives yesterday's
 * rollups to R2, then this reads those archives and posts a per-site summary to
 * SLACK_WEBHOOK_URL. Reading the freshly-written R2 objects keeps this cheap (one
 * GET per site) instead of re-issuing ~8 Analytics Engine subrequests per site,
 * which would blow the per-invocation subrequest budget alongside the rollup.
 */

/** Slack Block Kit message payload (only the bits we use). */
export interface SlackMessage {
  text: string;
  blocks: Array<Record<string, unknown>>;
}

/** Thousands-separated integer, locale-independent so tests are stable. */
function fmt(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "/path (1,234)" style top-N list, blank if no rows. */
function topList(rows: RollupRow[], limit = 3): string {
  return rows
    .slice(0, limit)
    .map((r) => `${r.name || '(none)'} (${fmt(r.views)})`)
    .join(', ');
}

/** The UTC day key for "yesterday" relative to `now` (the digest covers this day). */
export function digestDay(now: Date): string {
  return utcDayKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)));
}

/** Build the Slack message from per-site rollups. Pure: no IO, fully testable. */
export function formatDigest(day: string, rollups: DailyRollup[]): SlackMessage {
  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📊 Analytics — ${day}`, emoji: true },
    },
  ];

  const summaryParts: string[] = [];

  for (const r of rollups) {
    const visitors = r.totals.approx_daily_visitors;
    const views = r.totals.views;
    summaryParts.push(`${r.site}: ${fmt(visitors)} visitors`);

    const lines = [`*${r.site}*  ${fmt(visitors)} visitors · ${fmt(views)} views${r.sampled ? ' _(sampled)_' : ''}`];
    const pages = topList(r.pages);
    const refs = topList(r.referrers);
    if (pages) lines.push(`Top pages: ${pages}`);
    if (refs) lines.push(`Top referrers: ${refs}`);

    blocks.push({ type: 'divider' });
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } });
  }

  return {
    text: `Analytics for ${day} — ${summaryParts.join(' · ') || 'no data'}`,
    blocks,
  };
}

/** Load a day's rollup for a site: prefer the R2 archive, fall back to a live build. */
async function loadRollup(env: Env, site: string, day: string): Promise<DailyRollup | null> {
  if (env.ARCHIVE) {
    const obj = await env.ARCHIVE.get(`rollups/${site}/${day}.json`);
    if (obj) {
      try {
        return JSON.parse(await obj.text()) as DailyRollup;
      } catch {
        // Corrupt archive object: fall through to a live rebuild below.
      }
    }
  }
  try {
    return await buildDailyRollup(env, site, day);
  } catch {
    return null;
  }
}

/** Post yesterday's per-site digest to Slack. No-op when SLACK_WEBHOOK_URL is unset. */
export async function sendSlackDigest(env: Env, now: Date = new Date()): Promise<void> {
  const webhook = env.SLACK_WEBHOOK_URL;
  if (!webhook) return;

  const day = digestDay(now);
  const sites = parseAllowedSites(env.ALLOWED_SITES);
  const rollups = (await Promise.all(sites.map((s) => loadRollup(env, s, day)))).filter(
    (r): r is DailyRollup => r !== null,
  );
  if (!rollups.length) return;

  await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(formatDigest(day, rollups)),
  });
}
