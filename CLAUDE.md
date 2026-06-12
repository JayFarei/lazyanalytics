# lazyanalytics

Agent-first web analytics on Cloudflare Workers + Analytics Engine. Published to npm as a single root package (`lazyanalytics`) with `worker/` and `cli/` as private workspaces.

## Project structure

- `package.json` — the only publishable package (bin: `lazyanalytics` -> `cli/dist/index.js`; ships `cli/dist/`, `dist/worker.js`, `templates/`, `skill/SKILL.md`)
- `worker/` — Cloudflare Worker source (Hono router, TypeScript; private workspace)
- `cli/` — CLI source (Commander, TypeScript; private workspace)
- `scripts/build-worker.mjs` — esbuild step producing the dependency-free `dist/worker.js`
- `templates/wrangler.toml` — wrangler config scaffolded by `lazyanalytics setup` (placeholders `__WORKER_NAME__`, `__ALLOWED_SITES__`; no account_id, account comes from `CLOUDFLARE_ACCOUNT_ID` env)
- `skill/SKILL.md` — Claude Code skill installed by `lazyanalytics skill install [--project]`

## Key commands

```bash
npm install                        # root install, covers both workspaces
npm run build                      # bundle dist/worker.js + compile cli/dist
npm test                           # vitest in worker workspace (worker/test/, ~49 tests)

npx @jayfarei/lazyanalytics setup --sites example.com --yes   # deploy (needs CLOUDFLARE_API_TOKEN + CF_ACCOUNT_ID)
npx @jayfarei/lazyanalytics stats --site example.com          # query
npx tsx cli/src/index.ts <cmd>                        # run CLI from source

cd worker && npx wrangler dev      # local worker dev (.dev.vars: API_SECRET, HASH_SALT)
```

## Configuration & secrets model

- Worker secrets (set by setup, never printed): `API_SECRET` (bearer auth), `HASH_SALT` (visitor hash salt), and `CF_ACCOUNT_ID` + `CF_API_TOKEN` (needed by the worker-side `/api/*` query endpoints — AE SQL reads go through the Cloudflare REST API; without them queries return "Server not configured")
- CLI config: `~/.config/lazyanalytics/.env` (mode 0600, written by setup), plus `./.env`; real env vars win
- User deployments are scaffolded into `~/.config/lazyanalytics/worker/` (worker.js + wrangler.toml); `sites add/remove` edit `ALLOWED_SITES` there and redeploy
- `worker/wrangler.toml` is the repo dev config only; the shipped template is `templates/wrangler.toml`
- The OneCLI wrapper `cli/bin/analytics` is the author's personal tooling: not shipped in the npm package, not the documented path

## Architecture decisions

- Regular Workers, NOT Dynamic Workers (fixed logic, no runtime code gen)
- Analytics Engine for storage (ClickHouse-backed, 90-day retention, sampling-aware)
- Visitor hash as AE index (higher cardinality = better sampling behavior)
- Visitor hash is salted: SHA-256 of `site|ip|ua|date|HASH_SALT` (per-deployment secret salt)
- Custom bearer token for API auth (not CF API token, limits blast radius); constant-time comparison
- `GET /api/sites` (authenticated) returns `{data:[{site}],meta:{count}}` parsed from `ALLOWED_SITES`; the CLI and dashboard use it
- `/collect` drops beacons (204) when `ALLOWED_SITES` or `HASH_SALT` is unset
- Bot filtering via UA pattern matching (lightweight, no heavy deps)
- URLs stripped of query strings before storage (privacy)
- `meta.sampled` is computed honestly via `MAX(_sample_interval) AS max_interval` + `extractSampled()` in `worker/src/lib/query.ts`

## Data model (Analytics Engine)

- `index1`: visitor_hash (SHA-256 of site|ip|ua|date|HASH_SALT, truncated to 32 hex)
- `blob1`: site_id, `blob2`: page path, `blob3`: referrer domain
- `blob4`: country, `blob5`: browser, `blob6`: OS, `blob7`: device
- `blob8`: utm_source, `blob9`: utm_medium
- `double1`: count (1), `double2`: screen_width

All queries MUST use `SUM(_sample_interval)` instead of `COUNT(*)`.

## When editing

- Every query in `worker/src/api/` must be sampling-aware and go through helpers in `worker/src/lib/query.ts`
- `buildWhereClause` always filters by `blob1` (site_id); the dataset name is the `DATASET` constant, do not hardcode it
- Never store raw IPs, full URLs with query strings, or full referrer paths
- Never print or log secret values (API_SECRET, HASH_SALT, tokens) anywhere
- `worker/src/version.ts` gets `__PKG_VERSION__` injected from the root package.json by `scripts/build-worker.mjs`; the literal fallback only applies under `wrangler dev`
- After editing worker source, re-run `npm run build` so `dist/worker.js` stays current (prepublishOnly also does this)
