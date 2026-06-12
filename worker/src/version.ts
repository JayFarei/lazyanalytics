/**
 * Package version, surfaced on /health.
 * __PKG_VERSION__ is injected from the root package.json by
 * scripts/build-worker.mjs (esbuild define); the literal fallback applies
 * when running from source via `wrangler dev`.
 */
declare const __PKG_VERSION__: string | undefined;
export const VERSION = typeof __PKG_VERSION__ !== 'undefined' ? __PKG_VERSION__ : '0.1.0';
