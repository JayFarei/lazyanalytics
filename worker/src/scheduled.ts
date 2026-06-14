import type { Env } from './index';
import { rollupYesterday } from './lib/rollup';

export async function scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
  ctx.waitUntil(rollupYesterday(env));
}
