#!/usr/bin/env node
// Bundle the worker into a single dependency-free file (dist/worker.js)
// that wrangler can deploy with `main = "worker.js"`.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));

await build({
  entryPoints: [join(root, 'worker', 'src', 'index.ts')],
  outfile: join(root, 'dist', 'worker.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  conditions: ['workerd', 'worker', 'browser'],
  target: 'es2022',
  minify: false,
  logLevel: 'info',
  define: { __PKG_VERSION__: JSON.stringify(version) },
});
