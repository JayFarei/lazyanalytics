import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DATASET,
  buildWhereClause,
  parsePeriod,
  parseAllowedSites,
  validateSite,
  formatTimestamp,
  extractSampled,
  extractParams,
} from '../src/lib/query';
import type { Env } from '../src/index';

const API_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'api');

describe('buildWhereClause', () => {
  const startAt = new Date('2026-06-01T00:00:00Z');
  const endAt = new Date('2026-06-08T12:30:45Z');

  it('always filters by blob1 (site_id)', () => {
    const where = buildWhereClause({ site: 'example.com', startAt, endAt });
    expect(where).toContain("blob1 = 'example.com'");
    expect(where.startsWith('WHERE ')).toBe(true);
  });

  it('includes the time range bounds', () => {
    const where = buildWhereClause({ site: 'example.com', startAt, endAt });
    expect(where).toContain("timestamp >= toDateTime('2026-06-01 00:00:00')");
    expect(where).toContain("timestamp <= toDateTime('2026-06-08 12:30:45')");
  });

  it('escapes single quotes in the site value', () => {
    const where = buildWhereClause({ site: "evil' OR '1'='1", startAt, endAt });
    expect(where).toContain("blob1 = 'evil'' OR ''1''=''1'");
    // No lone (unescaped) quote sequence should let the value terminate early
    expect(where).not.toContain("blob1 = 'evil' ");
  });
});

describe('parsePeriod', () => {
  it('accepts Nd periods and returns a window of N days', () => {
    const { startAt, endAt } = parsePeriod('7d');
    const days = (endAt.getTime() - startAt.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(7, 5);
  });

  it('accepts the 1d and 90d boundaries', () => {
    expect(() => parsePeriod('1d')).not.toThrow();
    expect(() => parsePeriod('90d')).not.toThrow();
  });

  it('rejects junk formats', () => {
    for (const junk of ['7', 'd7', '7days', 'last-week', '', '7w', '7.5d', '-7d']) {
      expect(() => parsePeriod(junk), `period ${JSON.stringify(junk)}`).toThrow(/Invalid period format/);
    }
  });

  it('rejects out-of-range day counts', () => {
    expect(() => parsePeriod('0d')).toThrow(/between 1d and 90d/);
    expect(() => parsePeriod('91d')).toThrow(/between 1d and 90d/);
  });
});

describe('parseAllowedSites / validateSite', () => {
  it('parses a comma-separated list with whitespace', () => {
    expect(parseAllowedSites(' a.com , b.com,c.com ')).toEqual(['a.com', 'b.com', 'c.com']);
  });

  it('treats unset/empty as an empty list', () => {
    expect(parseAllowedSites(undefined)).toEqual([]);
    expect(parseAllowedSites('')).toEqual([]);
    expect(parseAllowedSites(' , ,')).toEqual([]);
  });

  it('validates membership exactly', () => {
    expect(validateSite('a.com', 'a.com,b.com')).toBe(true);
    expect(validateSite('c.com', 'a.com,b.com')).toBe(false);
    expect(validateSite('a.com', undefined)).toBe(false);
  });
});

describe('extractParams', () => {
  const env = { ALLOWED_SITES: 'example.com' } as Env;
  const fakeCtx = (params: Record<string, string>) => ({
    req: { query: (key: string) => params[key] },
  });

  it('clamps limit to [1, 100] and defaults to 10', () => {
    expect(extractParams(fakeCtx({ site: 'example.com', limit: '500' }), env).limit).toBe(100);
    expect(extractParams(fakeCtx({ site: 'example.com', limit: '0' }), env).limit).toBe(10); // 0 is falsy -> default
    expect(extractParams(fakeCtx({ site: 'example.com', limit: '-5' }), env).limit).toBe(1);
    expect(extractParams(fakeCtx({ site: 'example.com', limit: 'abc' }), env).limit).toBe(10);
    expect(extractParams(fakeCtx({ site: 'example.com' }), env).limit).toBe(10);
  });

  it('requires a known site', () => {
    expect(() => extractParams(fakeCtx({}), env)).toThrow(/Missing required parameter: site/);
    expect(() => extractParams(fakeCtx({ site: 'other.com' }), env)).toThrow(/Unknown site/);
  });
});

describe('formatTimestamp', () => {
  it('formats as AE SQL timestamp (no T, no millis, no Z)', () => {
    expect(formatTimestamp(new Date('2026-06-12T08:09:10.123Z'))).toBe('2026-06-12 08:09:10');
  });
});

describe('extractSampled', () => {
  it('reports sampled when any row has max_interval > 1 and strips the column', () => {
    const { rows, sampled } = extractSampled([
      { page: '/a', views: 10, max_interval: 1 },
      { page: '/b', views: 20, max_interval: 4 },
    ]);
    expect(sampled).toBe(true);
    expect(rows).toEqual([
      { page: '/a', views: 10 },
      { page: '/b', views: 20 },
    ]);
  });

  it('reports unsampled when all intervals are 1 (or no rows)', () => {
    expect(extractSampled([{ views: 1, max_interval: 1 }]).sampled).toBe(false);
    expect(extractSampled([]).sampled).toBe(false);
  });
});

describe('SQL source invariants (api/*.ts)', () => {
  const apiFiles = readdirSync(API_DIR).filter((f) => f.endsWith('.ts'));

  it('DATASET constant matches the wrangler dataset name', () => {
    expect(DATASET).toBe('agent_analytics');
  });

  it('every SQL query selects FROM ${DATASET}, never a hardcoded table', () => {
    for (const file of apiFiles) {
      const src = readFileSync(join(API_DIR, file), 'utf8');
      if (src.includes('FROM ')) {
        expect(src, `${file} must use the DATASET constant`).toContain('FROM ${DATASET}');
      }
    }
  });

  it('no query uses COUNT(*) (must be sampling-aware via SUM(_sample_interval))', () => {
    for (const file of apiFiles) {
      const src = readFileSync(join(API_DIR, file), 'utf8');
      expect(src, `${file} must not use COUNT(*)`).not.toMatch(/COUNT\(\s*\*\s*\)/i);
      if (src.includes('FROM ${DATASET}')) {
        expect(src, `${file} must select MAX(_sample_interval) for the sampled flag`).toContain(
          'MAX(_sample_interval)',
        );
      }
    }
  });
});
