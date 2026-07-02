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
  it('caps builds per run and covers every site newest-day-first', async () => {
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

    // Bounded to max(MAX_BUILDS_PER_RUN, sites) to stay under the per-invocation
    // subrequest cap, iterating day-outer so both sites get yesterday first.
    expect(puts.length).toBe(4);
    expect(puts).toEqual([
      'rollups/a.com/2026-06-12.json',
      'rollups/b.com/2026-06-12.json',
      'rollups/a.com/2026-06-11.json',
      'rollups/b.com/2026-06-11.json',
    ]);
  });

  it('builds yesterday for every configured site before any backfill day (no starvation)', async () => {
    mockAE();
    const puts: string[] = [];
    const env = {
      ALLOWED_SITES: 's1.com,s2.com,s3.com,s4.com,s5.com',
      CF_ACCOUNT_ID: 'a'.repeat(32),
      CF_API_TOKEN: 'token',
      ARCHIVE: {
        head: async () => null, // every day is missing
        put: async (key: string) => { puts.push(key); },
      },
    } as unknown as Env;

    const result = await rollupYesterday(env, new Date('2026-06-13T12:00:00Z'));

    // 5 sites > MAX_BUILDS_PER_RUN (4): the budget expands so no site is starved.
    expect(puts).toEqual([
      'rollups/s1.com/2026-06-12.json',
      'rollups/s2.com/2026-06-12.json',
      'rollups/s3.com/2026-06-12.json',
      'rollups/s4.com/2026-06-12.json',
      'rollups/s5.com/2026-06-12.json',
    ]);
    // The run reports what it built and hands yesterday's rollups to the digest.
    expect(result.built).toBe(5);
    expect(result.failed).toBe(0);
    expect([...result.yesterdayRollups.keys()].sort()).toEqual([
      's1.com', 's2.com', 's3.com', 's4.com', 's5.com',
    ]);
  });

  it('does nothing when the R2 archive binding or AE credentials are absent', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockAE();
    const puts: string[] = [];
    const archive = { head: async () => null, put: async (k: string) => { puts.push(k); } };
    // Missing CF_API_TOKEN → guard returns early.
    const env = { ALLOWED_SITES: 'a.com', CF_ACCOUNT_ID: 'a'.repeat(32), ARCHIVE: archive } as unknown as Env;
    await rollupYesterday(env, new Date('2026-06-13T12:00:00Z'));
    expect(puts.length).toBe(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('skipping rollup');
    warnSpy.mockRestore();
  });

  it('logs and continues when one site/day build fails', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // AE queries for a.com fail (site name is embedded in the SQL body);
    // b.com gets the standard row.
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: string }) => {
      if (String(init?.body).includes("'a.com'")) throw new Error('ae down');
      return new Response(
        JSON.stringify({
          data: [{ views: 1, approx_daily_visitors: 1, avg_screen_width: 1000, name: '/', approx_visitors: 1, max_interval: 1 }],
          meta: [],
          rows: 1,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }));

    const puts: string[] = [];
    const env = {
      ALLOWED_SITES: 'a.com,b.com',
      CF_ACCOUNT_ID: 'a'.repeat(32),
      CF_API_TOKEN: 'token',
      ARCHIVE: {
        head: async () => null,
        put: async (key: string) => { puts.push(key); },
      },
    } as unknown as Env;

    const result = await rollupYesterday(env, new Date('2026-06-13T12:00:00Z'));

    // a.com's failures are logged but do not stop b.com from rolling up, and
    // failed ATTEMPTS still consume the bounded build budget.
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes('site=a.com'))).toBe(true);
    expect(puts).toContain('rollups/b.com/2026-06-12.json');
    expect(result.failed).toBeGreaterThan(0);
    expect(result.built).toBeGreaterThan(0);
    expect(result.built + result.failed).toBeLessThanOrEqual(4); // max(MAX_BUILDS_PER_RUN, 2 sites)
    errSpy.mockRestore();
  });
});
