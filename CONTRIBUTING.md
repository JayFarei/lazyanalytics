# Contributing

Thanks for considering a contribution. This document covers the dev setup, the repo layout, and the invariants every change must preserve.

## Dev setup

Requirements: Node.js 20+ and a Cloudflare account if you want to test deploys.

```bash
git clone https://github.com/JayFarei/lazyanalytics.git
cd lazyanalytics
npm install        # installs all workspaces
npm run build      # bundles dist/worker.js (esbuild) + compiles cli/dist (tsc)
npm test           # vitest, worker workspace
```

Run the worker locally:

```bash
cd worker
# Local secrets (never commit this file):
printf 'API_SECRET=dev-secret\nHASH_SALT=dev-salt\n' > .dev.vars
npx wrangler dev
```

`ALLOWED_SITES` is a plain var in `worker/wrangler.toml`. To exercise the worker-side `/api/*` query endpoints locally you also need `CF_ACCOUNT_ID` and `CF_API_TOKEN` in `.dev.vars` (Analytics Engine reads go through Cloudflare's REST API).

Run the CLI from source:

```bash
npx tsx cli/src/index.ts stats --site example.com
```

Typecheck both workspaces before opening a PR:

```bash
cd worker && npx tsc --noEmit
cd ../cli && npx tsc --noEmit
```

## Repository layout

- `worker/` — Cloudflare Worker source (Hono, TypeScript). npm workspace, private.
- `cli/` — CLI source (Commander, TypeScript). npm workspace, private.
- `scripts/build-worker.mjs` — esbuild step that produces the dependency-free `dist/worker.js` shipped in the npm package.
- `templates/wrangler.toml` — the wrangler config `lazyanalytics setup` scaffolds for users.
- `skill/SKILL.md` — the Claude Code skill installed by `lazyanalytics skill install`.
- Only the **root** package (`lazyanalytics`) is published; `npm pack --dry-run` shows exactly what ships.

## Non-negotiable invariants

These are correctness and privacy requirements, not style preferences. PRs that violate them will be rejected.

### Analytics Engine query rules

- Every count MUST use `SUM(_sample_interval)`, never `COUNT(*)`. Analytics Engine samples data; `COUNT(*)` silently undercounts.
- Every query in `worker/src/api/` must filter by `blob1` (site_id). Use `buildWhereClause` from `worker/src/lib/query.ts`; it enforces this plus the time range.
- Queries that feed `meta.sampled` must include `MAX(_sample_interval) AS max_interval` and pass rows through `extractSampled()` so the flag stays honest.
- The dataset name comes from the `DATASET` constant in `worker/src/lib/query.ts`; do not hardcode it elsewhere.

### Privacy invariants

- Never store raw IP addresses or raw User-Agent strings. They may only be used transiently as input to the salted visitor hash (`worker/src/lib/visitor.ts`).
- Never store full URLs with query strings or fragments; only the path.
- Never store full referrer URLs; only the referrer domain.
- Never write a data point without a configured `HASH_SALT` (unsalted hashes are reversible).
- Never print or log secret values (`API_SECRET`, `HASH_SALT`, `CLOUDFLARE_API_TOKEN`, `ANALYTICS_API_TOKEN`) in worker code, CLI output, or tests.

### General

- No new runtime dependencies without prior discussion. The CLI depends on `commander` only; the worker on `hono` only. The shipped `dist/worker.js` must remain dependency-free after bundling.
- Match the existing TypeScript style; no reformatting drive-bys.

## Tests

Worker tests live in `worker/test/` and run with vitest (`npm test` from the root). The suite currently passes with `--passWithNoTests`; new behavior should come with tests, especially anything touching query building, sampling, hashing, or auth.

## Pull request expectations

- Keep PRs focused: one logical change per PR.
- Explain *why* in the description, not just what.
- Run `npm run build`, `npm test`, and both `tsc --noEmit` checks before submitting.
- If you change worker source, remember the published `dist/worker.js` is rebuilt by `prepublishOnly`; do not hand-edit files in `dist/`.
- Security issues should NOT be reported as PRs or public issues; see [SECURITY.md](SECURITY.md).
