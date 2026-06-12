import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the lazyanalytics package root relative to this module.
 *
 * Installed layout: <root>/cli/dist/lib/paths.js  -> root is 3 levels up.
 * Dev layout (tsx): <root>/cli/src/lib/paths.ts   -> root is 3 levels up.
 * As a fallback, walk up until we find the package.json named "lazyanalytics".
 */
export function findPackageRoot(): string {
  let dir = moduleDir;
  for (let i = 0; i < 6; i++) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string };
        if (pkg.name === '@jayfarei/lazyanalytics') return dir;
      } catch {
        /* ignore malformed package.json */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(moduleDir, '..', '..', '..');
}

/** Path to the prebundled worker script shipped in the package (dist/worker.js). */
export function packagedWorkerBundle(): string {
  return join(findPackageRoot(), 'dist', 'worker.js');
}

/** Path to the wrangler.toml template shipped in the package. */
export function packagedWranglerTemplate(): string {
  return join(findPackageRoot(), 'templates', 'wrangler.toml');
}

/** Path to the packaged Claude skill file. */
export function packagedSkill(): string {
  return join(findPackageRoot(), 'skill', 'SKILL.md');
}

/** Read the package version (falls back to 0.0.0 if unresolvable). */
export function packageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(findPackageRoot(), 'package.json'), 'utf-8'),
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
