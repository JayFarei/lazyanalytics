import type { Env } from './index';
import { rollupYesterday } from './lib/rollup';
import { sendSlackDigest } from './lib/slack';

export async function scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
  // Archive yesterday to R2 first, then post the Slack digest (which reads those
  // freshly-written archives). Both are best-effort; a digest failure must not
  // mask a successful rollup, and vice versa.
  ctx.waitUntil(
    (async () => {
      await rollupYesterday(env);
      try {
        await sendSlackDigest(env);
      } catch {
        // Slack delivery is best-effort; never throw out of the cron handler.
      }
    })(),
  );
}
