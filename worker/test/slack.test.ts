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
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await sendSlackDigest({ ALLOWED_SITES: 'a.com' } as unknown as Env, new Date('2026-06-17T06:00:00Z'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads yesterday from R2 and POSTs the digest to the webhook', async () => {
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
  });

  it('skips the POST entirely when no site has data', async () => {
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
  });
});
