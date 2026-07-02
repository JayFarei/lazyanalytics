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
    try {
      const obj = await env.ARCHIVE.get(`rollups/${site}/${day}.json`);
      if (obj) return JSON.parse(await obj.text()) as DailyRollup;
    } catch (e) {
      // A throwing R2 read (or corrupt JSON) degrades this one site to the
      // live rebuild below instead of rejecting the whole digest.
      console.error(`digest: archive read failed site=${site} day=${day}`, e);
    }
  }
  try {
    return await buildDailyRollup(env, site, day);
  } catch (e) {
    console.error(`digest: live rollup failed site=${site} day=${day}`, e);
    return null;
  }
}

/** Outcome of one digest attempt; runDaily folds it into the cron status line. */
export type DigestStatus = 'posted' | 'skipped-no-webhook' | 'skipped-no-rollups';

/**
 * Post yesterday's per-site digest to Slack. No-op when SLACK_WEBHOOK_URL is
 * unset. `prebuilt` carries the rollups the same cron invocation just built
 * (keyed by site), so the digest reuses them instead of re-reading R2: that
 * keeps the whole run inside the Workers free-plan subrequest cap at 5 sites.
 */
export async function sendSlackDigest(
  env: Env,
  now: Date = new Date(),
  prebuilt?: Map<string, DailyRollup>,
): Promise<DigestStatus> {
  const webhook = env.SLACK_WEBHOOK_URL;
  if (!webhook) {
    console.warn('digest: SLACK_WEBHOOK_URL not set, skipping digest');
    return 'skipped-no-webhook';
  }

  const day = digestDay(now);
  const sites = parseAllowedSites(env.ALLOWED_SITES);
  const rollups = (
    await Promise.all(
      sites.map((s) => {
        const pre = prebuilt?.get(s);
        return pre && pre.date === day ? Promise.resolve(pre) : loadRollup(env, s, day);
      }),
    )
  ).filter((r): r is DailyRollup => r !== null);
  if (!rollups.length) {
    console.error(`digest: no rollups buildable for ${day}, skipping post`);
    return 'skipped-no-rollups';
  }

  // The webhook URL embeds a secret token and must never appear in any log or
  // thrown message: a fetch rejection is replaced with a constant-message error
  // (fetch TypeErrors embed the target URL), and the non-2xx path carries the
  // status code only. No retries either, so at most one POST per cron firing
  // and double-posting stays impossible.
  let res: Response;
  try {
    res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formatDigest(day, rollups)),
    });
  } catch {
    throw new Error('slack webhook fetch failed');
  }
  if (!res.ok) throw new Error(`slack webhook returned ${res.status}`);
  return 'posted';
}
