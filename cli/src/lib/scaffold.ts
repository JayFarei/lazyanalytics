import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORKER_SCAFFOLD_DIR } from './env.js';

export const SCAFFOLD_WRANGLER_TOML = join(WORKER_SCAFFOLD_DIR, 'wrangler.toml');

/** Read ALLOWED_SITES back out of a scaffolded wrangler.toml, if present. */
export function readAllowedSites(path: string = SCAFFOLD_WRANGLER_TOML): string[] {
  if (!existsSync(path)) return [];
  const match = readFileSync(path, 'utf-8').match(/^ALLOWED_SITES\s*=\s*"([^"]*)"/m);
  if (!match || !match[1]) return [];
  return match[1].split(',').map((s) => s.trim()).filter(Boolean);
}

/** Rewrite the ALLOWED_SITES line in a scaffolded wrangler.toml. */
export function writeAllowedSites(sites: string[], path: string = SCAFFOLD_WRANGLER_TOML): void {
  const content = readFileSync(path, 'utf-8');
  if (!/^ALLOWED_SITES\s*=/m.test(content)) {
    throw new Error(`No ALLOWED_SITES line found in ${path}`);
  }
  writeFileSync(
    path,
    content.replace(/^ALLOWED_SITES\s*=\s*"[^"]*"/m, `ALLOWED_SITES = "${sites.join(',')}"`),
  );
}
