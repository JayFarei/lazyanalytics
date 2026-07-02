import type { Env } from './index';
import { rollupYesterday } from './lib/rollup';
import { sendSlackDigest, type DigestStatus } from './lib/slack';
import type { DailyRollup } from './lib/rollup';

/**
 * Daily cron: archive yesterday's rollups to R2 first, then post the Slack
 * digest, reusing the rollups this invocation just built so the digest costs
 * one webhook POST instead of N extra R2 reads. Each phase is guarded
 * independently so a rollup failure cannot mask the digest (and vice versa),
 * and every invocation emits exactly one JSON status line to Workers Logs with
 * truthful per-phase outcomes.
 *
 * Pre-agreed escalation (do NOT implement unless a second cron miss occurs
 * within a month, see issue #1): a digests/<day>.json R2 sent-marker written
 * only after the Slack webhook responds ok, plus a "0 12 * * *" same-day
 * catch-up cron; the known duplicate window to accept then is a crash between
 * the Slack 200 and the marker put.
 */
export async function scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
  ctx.waitUntil(runDaily(env, new Date(event.scheduledTime), event.cron));
}

/** Exported so tests can await the full run directly (waitUntil is fire-and-forget). */
export async function runDaily(env: Env, now: Date, cron = ''): Promise<void> {
  const started = Date.now();
  let rollup = 'ok';
  let built = 0;
  let failed = 0;
  let prebuilt: Map<string, DailyRollup> | undefined;
  try {
    const r = await rollupYesterday(env, now);
    built = r.built;
    failed = r.failed;
    prebuilt = r.yesterdayRollups;
    if (r.failed > 0) rollup = 'partial';
  } catch (e) {
    rollup = 'error';
    console.error('cron: rollup failed', e);
  }
  let digest: DigestStatus | 'error' = 'posted';
  try {
    digest = await sendSlackDigest(env, now, prebuilt);
  } catch (e) {
    digest = 'error';
    console.error('cron: digest failed', e);
  }
  console.log(
    JSON.stringify({ event: 'cron-daily', cron, rollup, built, failed, digest, ms: Date.now() - started }),
  );
}
