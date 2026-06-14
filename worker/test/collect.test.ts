import { describe, it, expect } from 'vitest';
import app from '../src/index';
import type { Env } from '../src/index';

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

interface DataPoint {
  indexes: string[];
  blobs: string[];
  doubles: number[];
}

/** Build a fake Env with a capturing ANALYTICS binding. */
function makeEnv(overrides: Partial<Record<keyof Env, string>> = {}) {
  const written: DataPoint[] = [];
  const env = {
    ANALYTICS: {
      writeDataPoint: (point: DataPoint) => {
        written.push(point);
      },
    },
    API_SECRET: 'test-secret',
    HASH_SALT: 'test-salt',
    ALLOWED_SITES: 'example.com,other.com',
    ...overrides,
  } as unknown as Env;
  return { env, written };
}

function beacon(payload: unknown, env: Env, ua: string = CHROME_UA) {
  return app.request(
    '/collect',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': ua },
      body: JSON.stringify(payload),
    },
    env,
  );
}

describe('POST /collect', () => {
  it('accepts a valid beacon and writes a data point', async () => {
    const { env, written } = makeEnv();
    const res = await beacon({ sid: 'example.com', url: 'https://example.com/about', sw: 1440 }, env);
    expect(res.status).toBe(204);
    expect(written).toHaveLength(1);
    expect(written[0].blobs[0]).toBe('example.com'); // blob1: site_id
    expect(written[0].blobs[1]).toBe('/about'); // blob2: page path
    expect(written[0].blobs).toHaveLength(16);
    expect(written[0].blobs[9]).toBe(''); // blob10: human traffic_class
    expect(written[0].blobs[10]).toBe('Direct'); // blob11: channel
    expect(written[0].blobs[11]).toMatch(/^[0-9a-f]{32}$/); // blob12: session_id
    expect(written[0].blobs[15]).toBe('pv'); // blob16: event_type
    expect(written[0].doubles).toEqual([1, 1440, 0, 0]);
    expect(written[0].indexes[0]).toMatch(/^[0-9a-f]{32}$/); // salted visitor hash
  });

  it('strips query strings and fragments from the URL', async () => {
    const { env, written } = makeEnv();
    await beacon({ sid: 'example.com', url: 'https://example.com/search?q=secret&user=1#frag' }, env);
    expect(written[0].blobs[1]).toBe('/search');
    expect(JSON.stringify(written[0])).not.toContain('secret');
  });

  it('stores only the referrer domain, accepting full URLs and bare hostnames', async () => {
    const { env, written } = makeEnv();
    await beacon(
      { sid: 'example.com', url: 'https://example.com/', ref: 'https://news.ycombinator.com/item?id=42' },
      env,
    );
    await beacon({ sid: 'example.com', url: 'https://example.com/', ref: 'news.ycombinator.com' }, env);
    expect(written[0].blobs[2]).toBe('news.ycombinator.com');
    expect(written[1].blobs[2]).toBe('news.ycombinator.com');
  });

  it('drops self-referrals, including subdomains and other allowed sites', async () => {
    const { env, written } = makeEnv();
    await beacon({ sid: 'example.com', url: 'https://example.com/', ref: 'example.com' }, env);
    await beacon({ sid: 'example.com', url: 'https://example.com/', ref: 'https://blog.example.com/post' }, env);
    await beacon({ sid: 'example.com', url: 'https://example.com/', ref: 'other.com' }, env);
    for (const point of written) {
      expect(point.blobs[2]).toBe('');
    }
  });

  it('ignores invalid referrers without failing the beacon', async () => {
    const { env, written } = makeEnv();
    const res = await beacon({ sid: 'example.com', url: 'https://example.com/', ref: 'not a url' }, env);
    expect(res.status).toBe(204);
    expect(written[0].blobs[2]).toBe('');
  });

  it('rejects beacons for unknown sites with 400', async () => {
    const { env, written } = makeEnv();
    const res = await beacon({ sid: 'evil.com', url: 'https://evil.com/' }, env);
    expect(res.status).toBe(400);
    expect(written).toHaveLength(0);
  });

  it('silently drops beacons when ALLOWED_SITES is unset (204, no write)', async () => {
    const { env, written } = makeEnv({ ALLOWED_SITES: '' });
    const res = await beacon({ sid: 'example.com', url: 'https://example.com/' }, env);
    expect(res.status).toBe(204);
    expect(written).toHaveLength(0);
  });

  it('silently drops beacons when HASH_SALT is unset (no unsalted hashes)', async () => {
    const { env, written } = makeEnv({ HASH_SALT: '' });
    const res = await beacon({ sid: 'example.com', url: 'https://example.com/' }, env);
    expect(res.status).toBe(204);
    expect(written).toHaveLength(0);
  });

  it('drops bot traffic with 204 and no write', async () => {
    const { env, written } = makeEnv();
    const res = await beacon(
      { sid: 'example.com', url: 'https://example.com/' },
      env,
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    );
    expect(res.status).toBe(204);
    expect(written).toHaveLength(0);
  });

  it('rejects invalid JSON and missing fields with 400', async () => {
    const { env, written } = makeEnv();
    const bad = await app.request(
      '/collect',
      { method: 'POST', headers: { 'User-Agent': CHROME_UA }, body: 'not-json' },
      env,
    );
    expect(bad.status).toBe(400);
    const missing = await beacon({ sid: 'example.com' }, env);
    expect(missing.status).toBe(400);
    expect(written).toHaveLength(0);
  });

  it('stores JS-executing AI crawler beacons only when explicitly enabled', async () => {
    const ua = 'Mozilla/5.0 AppleWebKit/537.36 ChatGPT-User/1.0';
    const disabled = makeEnv({ TRACK_AI_CRAWLERS: 'false' });
    const drop = await beacon({ sid: 'example.com', url: 'https://example.com/' }, disabled.env, ua);
    expect(drop.status).toBe(204);
    expect(disabled.written).toHaveLength(0);

    const enabled = makeEnv({ TRACK_AI_CRAWLERS: 'true' });
    const res = await beacon({ sid: 'example.com', url: 'https://example.com/' }, enabled.env, ua);
    expect(res.status).toBe(204);
    expect(enabled.written).toHaveLength(1);
    expect(enabled.written[0].blobs[9]).toBe('ai');
    expect(enabled.written[0].blobs[12]).toBe('ChatGPT-User');
    expect(enabled.written[0].blobs[13]).toBe('OpenAI');
    expect(enabled.written[0].blobs[14]).toBe('user');
  });

  it('writes engagement events with event_type=eng and double4 engagement_ms', async () => {
    const { env, written } = makeEnv();
    const res = await beacon({ sid: 'example.com', url: 'https://example.com/', t: 'eng', em: 1234 }, env);
    expect(res.status).toBe(204);
    expect(written[0].blobs[15]).toBe('eng');
    expect(written[0].doubles).toEqual([1, 0, 0, 1234]);
  });
});
