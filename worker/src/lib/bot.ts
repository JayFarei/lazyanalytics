import { classifyCrawler } from './crawlers';

/** Returns true for non-human traffic that should not enter human analytics. */
export function isBot(ua: string): boolean {
  return classifyCrawler(ua).kind === 'bot';
}
