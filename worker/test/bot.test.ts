import { describe, it, expect } from 'vitest';
import { isBot } from '../src/lib/bot';

describe('isBot', () => {
  it('flags known crawlers and tools', () => {
    const bots = [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      'Mozilla/5.0 AppleWebKit/537.36 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
      'GPTBot/1.0 (+https://openai.com/gptbot)',
      'curl/8.4.0 (x86_64-apple-darwin)',
      'python-requests/2.31.0 something',
      'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.0.0 Safari/537.36',
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    ];
    for (const ua of bots) {
      expect(isBot(ua), ua).toBe(true);
    }
  });

  it('passes common real browser user agents', () => {
    const humans = [
      // Chrome on macOS
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      // Safari on iPhone
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      // Firefox on Windows
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
      // Edge on Windows
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
    ];
    for (const ua of humans) {
      expect(isBot(ua), ua).toBe(false);
    }
  });

  it('treats empty or suspiciously short UAs as bots', () => {
    expect(isBot('')).toBe(true);
    expect(isBot('Mozilla')).toBe(true);
  });
});
