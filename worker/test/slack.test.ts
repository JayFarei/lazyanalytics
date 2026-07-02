import { afterEach, describe, expect, it, vi } from 'vitest';
import { digestDay, formatDigest, sendSlackDigest } from '../src/lib/slack';
import type { DailyRollup } from '../src/lib/rollup';
import type { Env } from '../src/index';

afterEach(() => {
  vi.unstubAllGlobals();
});

function rollup(site: string, over: Partial<DailyRollup> = {}): DailyRollup {
  return {
    date: '2026-06-16',
    site,
    sampled: false,
    totals: { views: 1234, approx_daily_visitors: 567, avg_screen_width: 1440 },
    pages: [
      { name: '/', views: 800, approx_visitors: 400 },
      { name: '/pricing', views: 200, approx_visitors: 120 },
    ],
    referrers: [{ name: 'google.com', views: 300, approx_visitors: 150 }],
    geo: [],
    browsers: [],
    os: [],
    device: [],
    ...over,
  };
}

describe('digestDay', () => {
  it('returns the UTC day before now', () => {
    expect(digestDay(new Date('2026-06-17T06:00:00Z'))).toBe('2026-06-16');
    // Just after UTC midnight still reports the prior calendar day.
    expect(digestDay(new Date('2026-06-17T00:01:00Z'))).toBe('2026-06-16');
  });
});

describe('formatDigest', () => {
  it('summarizes each site with thousands separators and top lists', () => {
    const msg = formatDigest('2026-06-16', [rollup('farei.me')]);
    expect(msg.text).toContain('Analytics for 2026-06-16');
    expect(msg.text).toContain('farei.me: 567 visitors');

    const json = JSON.stringify(msg.blocks);
    expect(json).toContain('📊 Analytics — 2026-06-16');
    expect(json).toContain('1,234 views');
    expect(json).toContain('567 visitors');
    expect(json).toContain('Top pages: / (800), /pricing (200)');
    expect(json).toContain('Top referrers: google.com (300)');
  });

  it('marks sampled sites and omits empty top lists', () => {
    const msg = formatDigest('2026-06-16', [
      rollup('a.com', { sampled: true, pages: [], referrers: [] }),
    ]);
    const json = JSON.stringify(msg.blocks);
    expect(json).toContain('_(sampled)_');
    expect(json).not.toContain('Top pages');
    expect(json).not.toContain('Top referrers');
  });
});

describe('sendSlackDigest', () => {
  it('does nothing when SLACK_WEBHOOK_URL is unset', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await sendSlackDigest({ ALLOWED_SITES: 'a.com' } as unknown as Env, new Date('2026-06-17T06:00:00Z'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('digest: SLACK_WEBHOOK_URL not set, skipping digest');
    warnSpy.mockRestore();
  });

  it('reads yesterday from R2 and POSTs the digest to the webhook', async () => {
    // b.com's live-fallback failure (no CF creds) is expected and logged; keep output clean.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const gets: string[] = [];
    const env = {
      ALLOWED_SITES: 'a.com,b.com',
      SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T/B/x',
      ARCHIVE: {
        get: async (key: string) => {
          gets.push(key);
          if (key === 'rollups/a.com/2026-06-16.json') {
            return { text: async () => JSON.stringify(rollup('a.com')) };
          }
          return null; // b.com missing in R2
        },
      },
    } as unknown as Env;

    await sendSlackDigest(env, new Date('2026-06-17T06:00:00Z'));

    expect(gets).toContain('rollups/a.com/2026-06-16.json');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hooks.slack.com/services/T/B/x');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.text).toContain('a.com: 567 visitors');
    errSpy.mockRestore();
  });

  it('skips the POST entirely when no site has data', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const env = {
      ALLOWED_SITES: 'a.com',
      SLACK_WEBHOOK_URL: 'https://hooks.slack.com/x',
      ARCHIVE: { get: async () => null },
      // No CF creds, so the live-build fallback returns null too.
    } as unknown as Env;
    await sendSlackDigest(env, new Date('2026-06-17T06:00:00Z'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes('no rollups buildable for 2026-06-16'))).toBe(true);
    errSpy.mockRestore();
  });

  it('throws when the Slack webhook responds non-2xx, without leaking the URL', async () => {
    const fetchMock = vi.fn(async () => new Response('rate limited', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    const env = {
      ALLOWED_SITES: 'a.com',
      SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T/B/x',
      ARCHIVE: {
        get: async () => ({ text: async () => JSON.stringify(rollup('a.com')) }),
      },
    } as unknown as Env;

    await expect(sendSlackDigest(env, new Date('2026-06-17T06:00:00Z'))).rejects.toThrow(
      'slack webhook returned 429',
    );
    // No retry: exactly one POST per cron firing.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(sendSlackDigest(env, new Date('2026-06-17T06:00:00Z'))).rejects.not.toThrow(
      /hooks\.slack\.com/,
    );
  });

  it('replaces a throwing webhook fetch with a constant-message error (no URL leak)', async () => {
    // fetch TypeErrors embed the target URL, e.g. workerd's "Invalid URL: <url>".
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Invalid URL: https://hooks.slack.com/services/SENTINEL_HOOK');
    });
    vi.stubGlobal('fetch', fetchMock);
    const env = {
      ALLOWED_SITES: 'a.com',
      SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/SENTINEL_HOOK',
      ARCHIVE: {
        get: async () => ({ text: async () => JSON.stringify(rollup('a.com')) }),
      },
    } as unknown as Env;

    const rejection = await sendSlackDigest(env, new Date('2026-06-17T06:00:00Z')).then(
      () => null,
      (e: Error) => e,
    );
    expect(rejection).toBeInstanceOf(Error);
    expect(rejection!.message).toBe('slack webhook fetch failed');
    expect(String(rejection)).not.toContain('SENTINEL_HOOK');
    expect((rejection as Error & { cause?: unknown }).cause).toBeUndefined();
  });

  it('uses prebuilt rollups from the rollup phase without touching R2', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const gets: string[] = [];
    const env = {
      ALLOWED_SITES: 'a.com',
      SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T/B/x',
      ARCHIVE: { get: async (key: string) => { gets.push(key); return null; } },
    } as unknown as Env;
    const prebuilt = new Map([['a.com', rollup('a.com')]]);

    const status = await sendSlackDigest(env, new Date('2026-06-17T06:00:00Z'), prebuilt);

    expect(status).toBe('posted');
    // The prebuilt rollup short-circuits the archive read entirely.
    expect(gets).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toContain('a.com: 567 visitors');
  });

  it('degrades one site to the live fallback when its ARCHIVE read throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const env = {
      ALLOWED_SITES: 'a.com,b.com',
      SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T/B/x',
      ARCHIVE: {
        get: async (key: string) => {
          if (key === 'rollups/a.com/2026-06-16.json') throw new Error('r2 transient');
          return { text: async () => JSON.stringify(rollup('b.com')) };
        },
      },
      // No CF creds, so a.com's live-build fallback returns null.
    } as unknown as Env;

    await sendSlackDigest(env, new Date('2026-06-17T06:00:00Z'));

    // The digest still posts, carrying the healthy site only.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toContain('b.com: 567 visitors');
    expect(body.text).not.toContain('a.com:');
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes('site=a.com'))).toBe(true);
    errSpy.mockRestore();
  });
});
