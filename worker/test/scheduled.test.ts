import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { runDaily, scheduled } from '../src/scheduled';
import { rollupYesterday, type DailyRollup, type RollupRunResult } from '../src/lib/rollup';
import { sendSlackDigest } from '../src/lib/slack';
import type { Env } from '../src/index';

vi.mock('../src/lib/rollup', () => ({ rollupYesterday: vi.fn() }));
vi.mock('../src/lib/slack', () => ({ sendSlackDigest: vi.fn() }));

const rollupMock = vi.mocked(rollupYesterday);
const digestMock = vi.mocked(sendSlackDigest);

function runResult(over: Partial<RollupRunResult> = {}): RollupRunResult {
  return { built: 0, failed: 0, yesterdayRollups: new Map(), ...over };
}

let errSpy: MockInstance;
let logSpy: MockInstance;
let warnSpy: MockInstance;

beforeEach(() => {
  vi.clearAllMocks();
  rollupMock.mockResolvedValue(runResult());
  digestMock.mockResolvedValue('posted');
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  errSpy.mockRestore();
  logSpy.mockRestore();
  warnSpy.mockRestore();
});

const env = {} as unknown as Env;

describe('runDaily', () => {
  it('runs the digest even when rollupYesterday rejects', async () => {
    rollupMock.mockRejectedValue(new Error('ae down'));
    await expect(runDaily(env, new Date('2026-07-02T06:00:00Z'), '0 6 * * *')).resolves.toBeUndefined();
    expect(digestMock).toHaveBeenCalledTimes(1);
    // No prebuilt rollups survive a rollup-phase throw.
    expect(digestMock.mock.calls[0][2]).toBeUndefined();
  });

  it('passes the freshly built yesterday rollups to the digest', async () => {
    const prebuilt = new Map<string, DailyRollup>([['a.com', { date: '2026-07-01' } as DailyRollup]]);
    rollupMock.mockResolvedValue(runResult({ built: 1, yesterdayRollups: prebuilt }));
    await runDaily(env, new Date('2026-07-02T06:00:00Z'));
    expect(digestMock.mock.calls[0][2]).toBe(prebuilt);
  });

  it('logs each phase failure independently and never rejects', async () => {
    rollupMock.mockRejectedValue(new Error('rollup boom'));
    digestMock.mockRejectedValue(new Error('digest boom'));
    await expect(runDaily(env, new Date('2026-07-02T06:00:00Z'))).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledTimes(2);
    expect(errSpy.mock.calls[0][0]).toBe('cron: rollup failed');
    expect(errSpy.mock.calls[1][0]).toBe('cron: digest failed');
  });

  it('emits one truthful JSON status line with phase outcomes and cron expression', async () => {
    rollupMock.mockResolvedValue(runResult({ built: 3, failed: 2 }));
    digestMock.mockResolvedValue('skipped-no-rollups');
    await runDaily(env, new Date('2026-07-02T06:00:00Z'), '0 6 * * *');
    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(logSpy.mock.calls[0][0]);
    expect(line).toEqual({
      event: 'cron-daily',
      cron: '0 6 * * *',
      rollup: 'partial',
      built: 3,
      failed: 2,
      digest: 'skipped-no-rollups',
      ms: expect.any(Number),
    });
  });

  it('reports rollup=error and digest=error in the status line when both phases throw', async () => {
    rollupMock.mockRejectedValue(new Error('rollup boom'));
    digestMock.mockRejectedValue(new Error('digest boom'));
    await runDaily(env, new Date('2026-07-02T06:00:00Z'), '0 6 * * *');
    const line = JSON.parse(logSpy.mock.calls[0][0]);
    expect(line.rollup).toBe('error');
    expect(line.digest).toBe('error');
  });

  it('never logs secret values even when both phases fail', async () => {
    const secretEnv = {
      API_SECRET: 'SENTINEL_API',
      HASH_SALT: 'SENTINEL_SALT',
      CF_API_TOKEN: 'SENTINEL_TOKEN',
      SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/SENTINEL_HOOK',
    } as unknown as Env;
    rollupMock.mockRejectedValue(new Error('rollup boom'));
    digestMock.mockRejectedValue(new Error('digest boom'));
    await runDaily(secretEnv, new Date('2026-07-02T06:00:00Z'), '0 6 * * *');
    const allArgs = [...errSpy.mock.calls, ...logSpy.mock.calls, ...warnSpy.mock.calls].flat();
    for (const sentinel of ['SENTINEL_API', 'SENTINEL_SALT', 'SENTINEL_TOKEN', 'SENTINEL_HOOK']) {
      expect(allArgs.some((a) => String(a).includes(sentinel))).toBe(false);
    }
  });
});

describe('scheduled', () => {
  it('passes new Date(event.scheduledTime) and the cron expression to both phases', async () => {
    let captured: Promise<unknown> | undefined;
    const ctx = { waitUntil: (p: Promise<unknown>) => { captured = p; } } as unknown as ExecutionContext;
    const event = {
      scheduledTime: Date.parse('2026-07-02T06:00:00Z'),
      cron: '0 6 * * *',
    } as ScheduledEvent;

    await scheduled(event, env, ctx);
    await captured;

    expect(rollupMock).toHaveBeenCalledTimes(1);
    expect(digestMock).toHaveBeenCalledTimes(1);
    expect((rollupMock.mock.calls[0][1] as Date).toISOString()).toBe('2026-07-02T06:00:00.000Z');
    expect((digestMock.mock.calls[0][1] as Date).toISOString()).toBe('2026-07-02T06:00:00.000Z');
    const line = JSON.parse(logSpy.mock.calls[0][0]);
    expect(line.cron).toBe('0 6 * * *');
  });
});
