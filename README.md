# lazyanalytics

Self-hosted, **agent-first** web analytics on Cloudflare Workers + Analytics Engine.

- **Yours** — deploys into your own Cloudflare account; traffic data never leaves it.
- **Agent-first** — a CLI that returns JSON by default, with semantic exit codes and a Claude Code skill so an agent can deploy, instrument, and query it end to end.
- **Private** — no cookies, no fingerprinting, no raw IPs, no query strings. See [PRIVACY.md](PRIVACY.md).
- **Cheap** — a small site fits in the Cloudflare free tier (`lazyanalytics usage` shows headroom).

Three things to do, in order: **[deploy](#1-deploy)** → **[install on a site](#2-install-on-a-site)** → **[query from an agent](#3-query-from-an-agent)**.

---

## 1. Deploy

You need a [Cloudflare API token](https://dash.cloudflare.com/profile/api-tokens) scoped to **Workers Scripts: Edit** + **Account Analytics: Read** + **Workers R2 Storage: Edit** (the last is for the daily history archive — drop it and pass `--no-archive` if you don't want long-term rollups), and your 32-hex account ID.

```bash
CLOUDFLARE_API_TOKEN=<token> CF_ACCOUNT_ID=<account-id> \
  npx @jayfarei/lazyanalytics setup --sites example.com --yes
```

`setup` scaffolds `~/.config/lazyanalytics/worker/`, deploys via `wrangler`, generates `API_SECRET` and `HASH_SALT` (never printed), stores worker secrets, writes `~/.config/lazyanalytics/.env` (mode 0600), health-checks the deployment, and prints a tracking snippet per site. It's **idempotent** — re-run anytime; pass `--rotate-secrets` only to regenerate credentials. Drop `--yes` for an interactive run.

> The token is also stored on the worker as `CF_API_TOKEN` so the worker can read Analytics Engine. For least privilege, deploy first, then overwrite that secret with a token scoped to **Account Analytics: Read** only — see [Secrets](#secrets).

---

## 2. Install on a site

Add the snippet once to your site's global `<head>`:

```html
<script defer id="analytics" data-site-id="example.com"
  src="https://lazyanalytics.YOUR-SUBDOMAIN.workers.dev/tracker.js"></script>
```

It's <2KB, sets no cookies, strips query strings and fragments in the browser, sends only the referrer *domain*, and tracks SPA navigations. `data-site-id` must match a site in the worker's `ALLOWED_SITES`. Print the exact tag anytime with `lazyanalytics snippet --site example.com`.

**Let an agent install it.** Paste this into the coding agent for the site you want to track (it prints the exact tag for you):

```text
Add the lazyanalytics tracking snippet to this site so it loads on every page.

Run `npx @jayfarei/lazyanalytics snippet --site YOUR_SITE` to get the exact
<script> tag, then insert it exactly once into the global <head> (Astro: the
base layout's <head>; Next.js App Router: app/layout.tsx; Next.js Pages:
pages/_document.tsx <Head>; plain HTML: the shared header/partial).

Rules:
- Once per page, site-wide. If a script with id="analytics" already exists, leave it.
- Do NOT add a cookie/consent banner — it sets no cookies and collects no personal data.
- data-site-id must exactly match the site in the worker's ALLOWED_SITES.

After it ships, confirm a page load was recorded:
  npx @jayfarei/lazyanalytics stats --site YOUR_SITE --period 1d
```

---

## 3. Query from an agent

The CLI returns JSON by default and reads `ANALYTICS_API_URL` + `ANALYTICS_API_TOKEN` from `~/.config/lazyanalytics/.env` (written by `setup`). For Claude Code, install the bundled skill so the agent knows the whole workflow:

```bash
npx @jayfarei/lazyanalytics skill install            # ~/.claude/skills/
npx @jayfarei/lazyanalytics skill install --project  # ./.claude/skills/
```

Then just ask: *"how is example.com doing this week?"* Or call the commands directly:

```bash
lazyanalytics stats      --site example.com --period 7d
lazyanalytics active     --site example.com --window 5
lazyanalytics pages      --site example.com --period 30d --limit 5
lazyanalytics referrers  --site example.com
lazyanalytics geo        --site example.com --period 30d
lazyanalytics channels   --site example.com
lazyanalytics crawlers   --site example.com --type operator   # JS-executing AI agents
lazyanalytics browsers   --site example.com --type os         # browser | os | device
lazyanalytics timeseries --site example.com --unit day        # hour | day
lazyanalytics bounce     --site example.com --period 30d
lazyanalytics duration   --site example.com --period 30d
lazyanalytics history    --site example.com --dimension pages --days 180
```

**Output**: `{ "data": [...], "meta": { "site", "period", "sampled" } }`. When `meta.sampled` is `true`, the numbers are extrapolated estimates — say so when reporting them.

**Exit codes** (what makes it scriptable): `0` data returned · `1` error · `2` success but empty · `3` config/auth missing. `active` returns `0` even when `active_visitors` is `0`.

**Common flags**: `-s/--site` (required), `-p/--period` (`1d`–`90d`, default `7d`), `-l/--limit` (1–100, default `10`), `--table` for a human-readable table instead of JSON.

---

## CLI reference

| Command | What it does |
| ------- | ------------ |
| `setup` | Deploy the worker and configure the CLI. Flags: `--sites <csv>`, `--account-id <id>`, `--name <worker-name>` (default `lazyanalytics`), `--track-ai-crawlers`, `--no-archive`, `--rotate-secrets`, `-y/--yes`. Needs `CLOUDFLARE_API_TOKEN`. |
| `sites list` | List tracked sites (worker `/api/sites`). |
| `sites add <domain>` | Add to `ALLOWED_SITES` and redeploy. Needs `CLOUDFLARE_API_TOKEN`. |
| `sites remove <domain>` | Remove and redeploy (refuses to remove the last site). |
| `snippet [--site X]` | Print the tracking `<script>` for one or all sites. |
| `skill install [--project]` | Install the Claude Code skill. |
| `config path` / `config get <key>` / `config set <key> <value>` | Inspect/edit `~/.config/lazyanalytics/.env`. Secrets are masked on `get`. |
| `usage` | Worker request usage, free-plan headroom, cost estimate. Flags: `-p today\|7d\|30d`, `-w/--worker <name>`. Needs `CF_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`. |

Plus the query commands above. Run any command with `--help` for full flags.

## HTTP API

Every `/api/*` endpoint takes `Authorization: Bearer <API_SECRET>` and returns `{ "data": ..., "meta": { "site", "period", "sampled" } }`.

```bash
curl -H "Authorization: Bearer $ANALYTICS_API_TOKEN" \
  "https://lazyanalytics.YOUR-SUBDOMAIN.workers.dev/api/stats?site=example.com&period=7d"
```

Endpoints mirror the query commands: `stats`, `active`, `pages`, `referrers`, `geo`, `channels`, `crawlers`, `bounce`, `duration`, `history`, `browsers`, `timeseries`, and `sites`. Unauthenticated: `POST /collect` (beacon ingest, returns 204), `GET /tracker.js`, `GET /dashboard` (token entered in-page, kept in `sessionStorage`), `GET /health`.

## How it works

```
  Your sites  ──<script src=".../tracker.js">──▶  beacon POST /collect
                                                        │
                              ┌─────────────────────────▼──────────────────────┐
                              │   Cloudflare Worker (your account)              │
                              │   /tracker.js · /collect · /api/* · /dashboard  │
                              └─────────────────────────┬──────────────────────┘
                                       writeDataPoint()  │  SQL via CF REST API
                              ┌─────────────────────────▼──────────────────────┐
                              │   Analytics Engine (ClickHouse, 90-day)         │
                              │   → optional daily rollups to R2 archive        │
                              └─────────────────────────┬──────────────────────┘
                                            HTTPS + bearer │
                              ┌─────────────────────────▼──────────────────────┐
                              │   lazyanalytics CLI / skill / any HTTP client   │
                              └────────────────────────────────────────────────┘
```

One Analytics Engine data point per pageview. The tracker beacons the (already stripped) path, referrer domain, screen width, and UTM source/medium; the worker filters bots, classifies channel and AI agents server-side, computes salted daily-visitor and 30-minute session hashes, and writes the row. Queries translate to **sampling-aware SQL** (`SUM(_sample_interval)`, never `COUNT(*)`). Full schema and metric caveats live in [CLAUDE.md](CLAUDE.md) and [PRIVACY.md](PRIVACY.md).

## Secrets

| Secret | Lives where | Purpose |
| ------ | ----------- | ------- |
| `API_SECRET` | Worker + CLI config (as `ANALYTICS_API_TOKEN`) | Bearer token for `/api/*` and the dashboard. Reads analytics only — no power over your CF account. |
| `HASH_SALT` | Worker + CLI config | Salts visitor hashes; never printed. |
| `CLOUDFLARE_API_TOKEN` | Your shell, at deploy time only | Used by `setup` / `sites add\|remove` / `usage`. Never stored by the CLI. |
| `CF_ACCOUNT_ID` / `CF_API_TOKEN` | Worker secrets | Let the worker read Analytics Engine via the CF REST API. For least privilege, scope `CF_API_TOKEN` to **Account Analytics: Read** only. |

The CLI config is `0600`; `config get` masks sensitive values. Never print `API_SECRET`, `HASH_SALT`, or any token.

## Privacy & limitations

No cookies, no fingerprinting, no cross-site tracking. IPs and user agents are hashed transiently (per-deployment salt, rotated daily) and never stored. Visitor counts are approximations; Analytics Engine retains data points for 90 days (optional R2 keeps daily rollups); new data points can take seconds to minutes to become queryable. Full details in [PRIVACY.md](PRIVACY.md).

## Development

```bash
git clone https://github.com/JayFarei/lazyanalytics.git && cd lazyanalytics
npm install            # worker/ + cli/ workspaces
npm run build          # bundle dist/worker.js + compile cli/dist
npm test               # vitest (worker workspace)
npx tsx cli/src/index.ts stats --site example.com   # run CLI from source
```

The npm package ships `cli/dist/`, the prebundled `dist/worker.js`, `templates/wrangler.toml`, and `skill/SKILL.md`; `worker/` source is development-only.

## Contributing & license

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). MIT licensed — see [LICENSE](LICENSE).
