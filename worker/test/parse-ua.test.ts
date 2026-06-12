import { describe, it, expect } from 'vitest';
import { parseUA } from '../src/lib/parse-ua';

describe('parseUA', () => {
  it('Chrome on macOS desktop', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
    expect(parseUA(ua)).toEqual({ browser: 'Chrome', os: 'macOS', device: 'desktop' });
  });

  it('Safari on iPhone (mobile)', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    expect(parseUA(ua)).toEqual({ browser: 'Safari', os: 'iOS', device: 'mobile' });
  });

  it('Firefox on Windows desktop', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0';
    expect(parseUA(ua)).toEqual({ browser: 'Firefox', os: 'Windows', device: 'desktop' });
  });

  it('Edge on Windows (Edg/ token wins over Chrome)', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0';
    expect(parseUA(ua).browser).toBe('Edge');
  });

  it('Chrome on Android phone (mobile)', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';
    expect(parseUA(ua)).toEqual({ browser: 'Chrome', os: 'Android', device: 'mobile' });
  });

  it('Safari on iPad (tablet)', () => {
    const ua = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    expect(parseUA(ua)).toEqual({ browser: 'Safari', os: 'iOS', device: 'tablet' });
  });

  it('unknown UA falls back to Other/desktop', () => {
    expect(parseUA('SomeStrangeAgent/1.0')).toEqual({ browser: 'Other', os: 'Other', device: 'desktop' });
  });
});
