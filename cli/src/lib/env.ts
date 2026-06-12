import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { homedir } from 'node:os';

/** Config locations shared by all commands. */
export const CONFIG_DIR = join(homedir(), '.config', 'lazyanalytics');
export const CONFIG_ENV_PATH = join(CONFIG_DIR, '.env');
export const WORKER_SCAFFOLD_DIR = join(CONFIG_DIR, 'worker');

/**
 * Parse a single .env value: strip surrounding quotes, or strip an
 * unquoted inline comment (everything from the first `#`).
 */
function parseEnvValue(raw: string): string {
  let val = raw.trim();
  if (val.startsWith('"') || val.startsWith("'")) {
    const quote = val[0];
    const end = val.indexOf(quote, 1);
    return end === -1 ? val.slice(1) : val.slice(1, end);
  }
  const hash = val.indexOf('#');
  if (hash !== -1) val = val.slice(0, hash);
  return val.trim();
}

/** Parse .env file content into a key/value map. */
export function parseEnvContent(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!key) continue;
    vars[key] = parseEnvValue(trimmed.slice(eqIdx + 1));
  }
  return vars;
}

/** Read a .env file into a key/value map (empty map if missing/unreadable). */
export function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  try {
    return parseEnvContent(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

/** Quote a value if it would otherwise be mangled by the parser. */
function formatEnvValue(value: string): string {
  if (/[#\s]/.test(value)) {
    return value.includes('"') ? `'${value}'` : `"${value}"`;
  }
  return value;
}

/** Write a key/value map to a .env file with mode 0600. */
export function writeEnvFile(path: string, vars: Record<string, string>): void {
  mkdirSync(dirname(path), { recursive: true });
  const content =
    Object.entries(vars)
      .map(([k, v]) => `${k}=${formatEnvValue(v)}`)
      .join('\n') + '\n';
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600); // in case the file already existed with looser perms
}

/**
 * Load vars from .env files (cwd .env, then ~/.config/lazyanalytics/.env).
 * Existing env vars take precedence.
 */
export function loadEnv(): void {
  const candidates = [resolve(process.cwd(), '.env'), CONFIG_ENV_PATH];
  for (const path of candidates) {
    const vars = readEnvFile(path);
    for (const [key, val] of Object.entries(vars)) {
      if (!process.env[key]) process.env[key] = val;
    }
  }
}
