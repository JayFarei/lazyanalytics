const SEARCH_DOMAINS = [
  'google.',
  'bing.com',
  'duckduckgo.com',
  'yahoo.',
  'baidu.com',
  'yandex.',
  'ecosia.org',
  'brave.com',
  'search.aol.',
  'naver.com',
  'seznam.',
  'qwant.com',
];

const SOCIAL_DOMAINS = [
  'facebook.com',
  'instagram.com',
  'threads.net',
  'twitter.com',
  'x.com',
  'linkedin.com',
  't.co',
  'reddit.com',
  'pinterest.',
  'youtube.com',
  'tiktok.com',
  'bsky.app',
  'mastodon.',
];

const AI_DOMAINS = [
  'chatgpt.com',
  'openai.com',
  'claude.ai',
  'anthropic.com',
  'perplexity.ai',
  'gemini.google.com',
  'copilot.microsoft.com',
];

const EMAIL_SOURCES = ['mailchimp', 'sendgrid', 'postmark', 'customer.io', 'convertkit', 'substack'];
const PAID_MEDIUM_RE = /^(.*cp.*|ppc|retargeting|paid.*)$/i;

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

export function classifyChannel(referrerDomain: string, utmSource: string = '', utmMedium: string = ''): string {
  try {
    const ref = String(referrerDomain || '').toLowerCase();
    const source = String(utmSource || '').toLowerCase();
    const medium = String(utmMedium || '').toLowerCase();
    const joined = `${ref} ${source}`;

    if (includesAny(joined, AI_DOMAINS)) return 'AI Assistants';
    if (medium === 'email' || includesAny(source, EMAIL_SOURCES)) return 'Email';
    if (PAID_MEDIUM_RE.test(medium) && (includesAny(joined, SEARCH_DOMAINS) || medium.includes('search'))) {
      return 'Paid Search';
    }
    if (includesAny(joined, SEARCH_DOMAINS)) return 'Organic Search';
    if (PAID_MEDIUM_RE.test(medium) && includesAny(joined, SOCIAL_DOMAINS)) return 'Paid Social';
    if (includesAny(joined, SOCIAL_DOMAINS)) return 'Organic Social';
    if (ref || medium === 'referral' || medium === 'link') return 'Referral';
    return 'Direct';
  } catch {
    return 'Direct';
  }
}
