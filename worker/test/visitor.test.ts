import { describe, it, expect } from 'vitest';
import { hashVisitor, sessionWindow, todayUTC } from '../src/lib/visitor';

const SITE = 'example.com';
const IP = '203.0.113.7';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36';
const DATE = '2026-06-12';
const SALT = 'a'.repeat(64);

describe('hashVisitor', () => {
  it('is stable for identical inputs + salt', async () => {
    const h1 = await hashVisitor(SITE, IP, UA, DATE, SALT);
    const h2 = await hashVisitor(SITE, IP, UA, DATE, SALT);
    expect(h1).toBe(h2);
  });

  it('produces a 32-char lowercase hex identifier', async () => {
    const h = await hashVisitor(SITE, IP, UA, DATE, SALT);
    expect(h).toMatch(/^[0-9a-f]{32}$/);
  });

  it('incorporates the salt (different salts -> different hashes)', async () => {
    const h1 = await hashVisitor(SITE, IP, UA, DATE, SALT);
    const h2 = await hashVisitor(SITE, IP, UA, DATE, 'b'.repeat(64));
    expect(h1).not.toBe(h2);
  });

  it('rotates with the date (same visitor, different day -> different hash)', async () => {
    const h1 = await hashVisitor(SITE, IP, UA, '2026-06-12', SALT);
    const h2 = await hashVisitor(SITE, IP, UA, '2026-06-13', SALT);
    expect(h1).not.toBe(h2);
  });

  it('separates visitors across sites (no cross-site correlation)', async () => {
    const h1 = await hashVisitor('a.com', IP, UA, DATE, SALT);
    const h2 = await hashVisitor('b.com', IP, UA, DATE, SALT);
    expect(h1).not.toBe(h2);
  });
});

describe('todayUTC', () => {
  it('returns YYYY-MM-DD', () => {
    expect(todayUTC()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('sessionWindow', () => {
  it('keeps hits inside a 30-minute slot together and splits later hits', () => {
    const base = Date.UTC(2026, 5, 13, 12, 0, 0);
    expect(sessionWindow(base)).toBe(sessionWindow(base + 5 * 60 * 1000));
    expect(sessionWindow(base)).not.toBe(sessionWindow(base + 31 * 60 * 1000));
  });
});
