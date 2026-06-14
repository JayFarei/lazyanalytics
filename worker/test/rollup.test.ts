import { afterEach, describe, expect, it, vi } from 'vitest';
import { rollupYesterday } from '../src/lib/rollup';
import type { Env } from '../src/index';

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockAE() {
  // One generic row serves both the totals query and every dimension query.
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(
      JSON.stringify({
        data: [{ views: 1, approx_daily_visitors: 1, avg_screen_width: 1000, name: '/', approx_visitors: 1, max_interval: 1 }],
        meta: [],
        rows: 1,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  ));
}

describe('rollupYesterday', () => {
  it('caps builds per run and writes newest-day-first', async () => {
    mockAE();
    const puts: string[] = [];
    const env = {
      ALLOWED_SITES: 'a.com,b.com',
      CF_ACCOUNT_ID: 'a'.repeat(32),
      CF_API_TOKEN: 'token',
      ARCHIVE: {
        head: async () => null, // every day is missing
        put: async (key: string) => { puts.push(key); },
      },
    } as unknown as Env;

    await rollupYesterday(env, new Date('2026-06-13T12:00:00Z'));

    // Bounded to MAX_BUILDS_PER_RUN (4) to stay under the per-invocation subrequest cap.
    expect(puts.length).toBe(4);
    // Newest-first within the first site; second site not reached this run.
    expect(puts).toEqual([
      'rollups/a.com/2026-06-12.json',
      'rollups/a.com/2026-06-11.json',
      'rollups/a.com/2026-06-10.json',
      'rollups/a.com/2026-06-09.json',
    ]);
  });

  it('does nothing when the R2 archive binding or AE credentials are absent', async () => {
    mockAE();
    const puts: string[] = [];
    const archive = { head: async () => null, put: async (k: string) => { puts.push(k); } };
    // Missing CF_API_TOKEN → guard returns early.
    const env = { ALLOWED_SITES: 'a.com', CF_ACCOUNT_ID: 'a'.repeat(32), ARCHIVE: archive } as unknown as Env;
    await rollupYesterday(env, new Date('2026-06-13T12:00:00Z'));
    expect(puts.length).toBe(0);
  });
});
