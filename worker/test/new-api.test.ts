import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import type { Env } from '../src/index';

function makeEnv(overrides: Partial<Env> = {}) {
  return {
    ANALYTICS: { writeDataPoint: () => {} },
    API_SECRET: 'test-secret',
    HASH_SALT: 'test-salt',
    ALLOWED_SITES: 'example.com',
    CF_ACCOUNT_ID: 'a'.repeat(32),
    CF_API_TOKEN: 'token',
    ...overrides,
  } as unknown as Env;
}

function api(path: string, env = makeEnv()) {
  return app.request(path, { headers: { Authorization: 'Bearer test-secret' } }, env);
}

function mockAE(data: Record<string, unknown>[]) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    calls.push(String(init.body));
    return new Response(JSON.stringify({ data, meta: [], rows: data.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('new API handlers', () => {
  it('active clamps the window and returns zero-active as a 200 response', async () => {
    const calls = mockAE([{ active_visitors: 0, recent_pageviews: 0, max_interval: 1 }]);
    const res = await api('/api/active?site=example.com&window=999');
    expect(res.status).toBe(200);
    expect(calls[0]).toContain("(blob10 = '' OR blob10 IS NULL)");
    expect(calls[0]).toContain("(blob16 = 'pv' OR blob16 = '' OR blob16 IS NULL)");
    const body = await res.json() as { data: { active_visitors: number; window_minutes: number } };
    expect(body.data.active_visitors).toBe(0);
    expect(body.data.window_minutes).toBe(60);
  });

  it('crawlers queries AI traffic by selected dimension', async () => {
    const calls = mockAE([{ operator: 'OpenAI', hits: 3, approx_instances: 1, max_interval: 1 }]);
    const res = await api('/api/crawlers?site=example.com&type=operator');
    expect(res.status).toBe(200);
    expect(calls[0]).toContain("blob10 = 'ai'");
    expect(calls[0]).toContain('blob14 as operator');
  });

  it('channels maps legacy empty buckets to unknown', async () => {
    mockAE([{ channel: '', pageviews: 2, approx_visitors: 1, max_interval: 1 }]);
    const res = await api('/api/channels?site=example.com');
    const body = await res.json() as { data: Array<{ channel: string }> };
    expect(body.data[0].channel).toBe('unknown');
  });

  it('bounce returns null with a warning when sampled', async () => {
    mockAE([{ session_key: 'secret', pv_weight: 10, pv_rows: 1, max_interval: 2 }]);
    const res = await api('/api/bounce?site=example.com');
    const body = await res.json() as { data: { bounce_rate: number | null; warning?: string } };
    expect(body.data.bounce_rate).toBeNull();
    expect(body.data.warning).toMatch(/sampled/);
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('duration reads all event rows so dwell beacons contribute', async () => {
    const calls = mockAE([{ session_key: 's', span_s: 0, dwell_ms: 2500, w: 1, max_interval: 1 }]);
    const res = await api('/api/duration?site=example.com');
    const body = await res.json() as { data: { avg_session_seconds: number } };
    expect(calls[0]).not.toContain("blob16 = 'pv'");
    expect(body.data.avg_session_seconds).toBe(2.5);
  });

  it('history serves >90d days from R2 rollups, not live AE', async () => {
    // Days older than the 90-day live-retention window must come from R2.
    // Use dates relative to now so the test does not rot.
    const dayKey = (offsetDays: number) => new Date(Date.now() - offsetDays * 86400000).toISOString().slice(0, 10);
    const d1 = dayKey(120);
    const d2 = dayKey(119);
    const rollup = (date: string, views: number, visitors: number) => ({
      date,
      site: 'example.com',
      sampled: false,
      totals: { views, approx_daily_visitors: visitors, avg_screen_width: 1000 },
      pages: [{ name: '/', views, approx_visitors: visitors }],
      referrers: [],
      geo: [],
      browsers: [],
      os: [],
      device: [],
    });
    const objects: Record<string, unknown> = {
      [`rollups/example.com/${d1}.json`]: rollup(d1, 2, 1),
      [`rollups/example.com/${d2}.json`]: rollup(d2, 3, 2),
    };
    const archive = {
      get: vi.fn(async (key: string) => (objects[key] ? { json: async () => objects[key] } : null)),
    } as unknown as R2Bucket;
    const res = await api(`/api/history?site=example.com&dimension=pages&from=${d1}&to=${d2}`, makeEnv({ ARCHIVE: archive }));
    const body = await res.json() as { data: Array<{ name: string; views: number }>; meta: { source: string } };
    // Merged across both archive days; no live AE subrequest was made.
    expect(body.data).toEqual([{ name: '/', views: 5, approx_visitors: 3 }]);
    expect(body.meta.source).toBe('archive');
    expect(archive.get).toHaveBeenCalledTimes(2);
  });
});
