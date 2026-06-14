export type CrawlerType = 'train' | 'search' | 'user' | 'agent' | 'coding';

export interface CrawlerClassification {
  kind: 'human' | 'ai' | 'bot';
  name: string;
  operator: string;
  type: CrawlerType | '';
}

type AiRule = {
  pattern: RegExp;
  name: string;
  operator: string;
  type: CrawlerType;
};

const AI_RULES: AiRule[] = [
  { pattern: /chatgpt-user/i, name: 'ChatGPT-User', operator: 'OpenAI', type: 'user' },
  { pattern: /oai-searchbot/i, name: 'OAI-SearchBot', operator: 'OpenAI', type: 'search' },
  { pattern: /gptbot/i, name: 'GPTBot', operator: 'OpenAI', type: 'train' },
  { pattern: /claude-user/i, name: 'Claude-User', operator: 'Anthropic', type: 'user' },
  { pattern: /claude-searchbot/i, name: 'Claude-SearchBot', operator: 'Anthropic', type: 'search' },
  { pattern: /claude-web/i, name: 'Claude-Web', operator: 'Anthropic', type: 'agent' },
  { pattern: /claudebot/i, name: 'ClaudeBot', operator: 'Anthropic', type: 'train' },
  { pattern: /anthropic-ai/i, name: 'Anthropic-AI', operator: 'Anthropic', type: 'train' },
  { pattern: /perplexity-user/i, name: 'Perplexity-User', operator: 'Perplexity', type: 'user' },
  { pattern: /perplexitybot/i, name: 'PerplexityBot', operator: 'Perplexity', type: 'search' },
  { pattern: /meta-externalfetcher/i, name: 'meta-externalfetcher', operator: 'Meta', type: 'user' },
  { pattern: /meta-externalagent/i, name: 'meta-externalagent', operator: 'Meta', type: 'agent' },
  { pattern: /google-extended/i, name: 'Google-Extended', operator: 'Google', type: 'train' },
  { pattern: /googleother/i, name: 'GoogleOther', operator: 'Google', type: 'train' },
  { pattern: /gemini/i, name: 'Gemini', operator: 'Google', type: 'agent' },
  { pattern: /copilot/i, name: 'Copilot', operator: 'Microsoft', type: 'coding' },
  { pattern: /bytespider/i, name: 'Bytespider', operator: 'ByteDance', type: 'train' },
  { pattern: /ccbot/i, name: 'CCBot', operator: 'Common Crawl', type: 'train' },
];

const BOT_PATTERNS = [
  /bot/i,
  /crawl/i,
  /spider/i,
  /slurp/i,
  /mediapartners/i,
  /googlebot/i,
  /bingbot/i,
  /yandex/i,
  /baidu/i,
  /duckduckbot/i,
  /facebookexternalhit/i,
  /twitterbot/i,
  /linkedinbot/i,
  /whatsapp/i,
  /telegrambot/i,
  /discordbot/i,
  /slackbot/i,
  /pingdom/i,
  /uptimerobot/i,
  /headlesschrome/i,
  /phantomjs/i,
  /selenium/i,
  /puppeteer/i,
  /lighthouse/i,
  /pagespeed/i,
  /prerender/i,
  /preview/i,
  /wget/i,
  /curl/i,
  /httpie/i,
  /python-requests/i,
  /axios/i,
  /node-fetch/i,
  /go-http-client/i,
];

const BOT: CrawlerClassification = { kind: 'bot', name: '', operator: '', type: '' };
const HUMAN: CrawlerClassification = { kind: 'human', name: '', operator: '', type: '' };

export function classifyCrawler(ua: string): CrawlerClassification {
  try {
    const value = typeof ua === 'string' ? ua : String(ua);
    if (!value || value.length < 10) return BOT;

    for (const rule of AI_RULES) {
      if (rule.pattern.test(value)) {
        return { kind: 'ai', name: rule.name, operator: rule.operator, type: rule.type };
      }
    }

    if (BOT_PATTERNS.some((pattern) => pattern.test(value))) return BOT;
    return HUMAN;
  } catch {
    return BOT;
  }
}
