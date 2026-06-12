import { describe, it, expect } from 'vitest';
import app from '../src/index';
import type { Env } from '../src/index';

function makeEnv(overrides: Partial<Record<keyof Env, string>> = {}) {
  return {
    ANALYTICS: { writeDataPoint: () => {} },
    API_SECRET: 'test-secret',
    HASH_SALT: 'test-salt',
    ALLOWED_SITES: 'example.com, other.com',
    ...overrides,
  } as unknown as Env;
}

function getSites(env: Env, token?: string) {
  return app.request(
    '/api/sites',
    { headers: token !== undefined ? { Authorization: `Bearer ${token}` } : {} },
    env,
  );
}

describe('GET /api/sites', () => {
  it('returns the parsed site list when authenticated', async () => {
    const res = await getSites(makeEnv(), 'test-secret');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { site: string }[]; meta: { count: number; hint?: string } };
    expect(body.data).toEqual([{ site: 'example.com' }, { site: 'other.com' }]);
    expect(body.meta.count).toBe(2);
    expect(body.meta.hint).toBeUndefined();
  });

  it('handles empty ALLOWED_SITES with an empty list and a setup hint', async () => {
    const res = await getSites(makeEnv({ ALLOWED_SITES: '' }), 'test-secret');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; meta: { count: number; hint?: string } };
    expect(body.data).toEqual([]);
    expect(body.meta.count).toBe(0);
    expect(body.meta.hint).toMatch(/No sites configured/);
  });

  it('rejects missing or wrong tokens with 401', async () => {
    expect((await getSites(makeEnv())).status).toBe(401);
    expect((await getSites(makeEnv(), 'wrong-token')).status).toBe(401);
    expect((await getSites(makeEnv(), '')).status).toBe(401);
  });

  it('returns 500 with a setup hint when API_SECRET is unset (empty token can never pass)', async () => {
    const res = await getSites(makeEnv({ API_SECRET: '' }), '');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Server not configured/);
  });
});

describe('GET /health', () => {
  it('is public and reports status + version', async () => {
    const res = await app.request('/health', {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; version: string };
    expect(body.status).toBe('ok');
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
