/**
 * Lightweight bot detection using common crawler/bot patterns.
 * Returns true if the user agent looks like a bot, crawler, or non-human traffic.
 */
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
  /gptbot/i,
  /claudebot/i,
  /anthropic/i,
  /chatgpt/i,
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

export function isBot(ua: string): boolean {
  if (!ua || ua.length < 10) return true;
  return BOT_PATTERNS.some((pattern) => pattern.test(ua));
}
