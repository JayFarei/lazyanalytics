# lazyanalytics

Agent-first, self-hosted web analytics on Cloudflare Workers + Analytics Engine.

- **Self-hosted**: deploys into *your* Cloudflare account. Your traffic data never leaves it.
- **Agent-first**: a CLI that returns JSON by default, with semantic exit codes and `--help` text written for AI agents. Ships a Claude Code skill.
- **Privacy-respecting**: no cookies, no fingerprinting, no raw IPs, no query strings. See [PRIVACY.md](PRIVACY.md).
- **Cheap**: a small site fits comfortably in the Cloudflare free tier (`lazyanalytics usage` shows your headroom).

## Quick start

```bash
# 1. Deploy the worker into your Cloudflare account
CLOUDFLARE_API_TOKEN=<token> npx @jayfarei/lazyanalytics setup \
  --sites example.com --account-id <32-hex-account-id>

# 2. Add the printed snippet to each site's <head>
# 3. Query
npx @jayfarei/lazyanalytics stats --site example.com --period 7d
```

`setup` is interactive if you omit flags, and non-interactive with `--yes`. It scaffolds `~/.config/lazyanalytics/worker/`, deploys via `wrangler`, generates `API_SECRET` and `HASH_SALT` (never printed), sets the worker secrets (including `CF_ACCOUNT_ID`/`CF_API_TOKEN`, which Analytics Engine reads require — see [Secrets model](#secrets-model)), writes `~/.config/lazyanalytics/.env` (mode 0600), health-checks the deployment, and prints the tracking snippet per site. Re-running is idempotent; pass `--rotate-secrets` to regenerate credentials.

By default the token you give `setup` is also stored on the worker as `CF_API_TOKEN` for Analytics Engine reads. To keep the deploy-capable token off the worker, re-run with a token scoped to **Account Analytics: Read** only after the first deploy, or overwrite the secret manually:

```bash
cd ~/.config/lazyanalytics/worker
echo "<read-only-token>" | CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<account-id> npx wrangler@4 secret put CF_API_TOKEN
```

## The tracking snippet

```html
<script defer id="analytics" data-site-id="example.com"
  src="https://lazyanalytics.YOUR-SUBDOMAIN.workers.dev/tracker.js"></script>
```

The script is <2KB, sets no cookies, strips query strings and fragments in the browser, sends only the referrer *domain*, and tracks SPA navigations. `data-site-id` must match a site in the worker's `ALLOWED_SITES`. Print snippets anytime with `lazyanalytics snippet [--site example.com]`.

### Installing it (prompt for a coding agent)

Copy this into the coding agent for the site you want to track (replace `YOUR_SITE` and the worker URL — `lazyanalytics snippet --site YOUR_SITE` prints the exact tag):

```text
Add the lazyanalytics tracking snippet to this site so it loads on every page.

Insert this tag, exactly once, into the global <head> (Astro: the base layout's
<head>; Next.js App Router: app/layout.tsx; Next.js Pages: pages/_document.tsx
<Head>; plain HTML: the shared header/partial):

  <script defer id="analytics" data-site-id="YOUR_SITE"
    src="https://lazyanalytics.YOUR-SUBDOMAIN.workers.dev/tracker.js"></script>

Rules:
- It must appear once per page, site-wide. If a script with id="analytics"
  already exists, leave it as-is.
- Do NOT add a cookie/consent banner for it — it sets no cookies and collects
  no personal data.
- data-site-id must exactly match the site registered in the worker's
  ALLOWED_SITES (otherwise beacons are rejected).
- The script is async/defer, <2KB, and tracks SPA route changes automatically.

After it ships, confirm a page load was recorded:
  npx @jayfarei/lazyanalytics stats --site YOUR_SITE --period today
```

## CLI reference

Install globally (`npm i -g @jayfarei/lazyanalytics`) or use `npx @jayfarei/lazyanalytics`.

### Lifecycle commands

| Command | What it does |
| ------- | ------------ |
| `setup` | Deploy the worker and configure the CLI. Flags: `--sites <csv>`, `--account-id <id>`, `--name <worker-name>` (default `lazyanalytics`), `--track-ai-crawlers`, `--no-archive`, `--rotate-secrets`, `-y/--yes`. Needs `CLOUDFLARE_API_TOKEN` (env or hidden prompt). |
| `sites list` | List tracked sites via the worker's `/api/sites` endpoint. |
| `sites add <domain>` | Add a site to `ALLOWED_SITES` in the scaffolded `wrangler.toml` and redeploy. Needs `CLOUDFLARE_API_TOKEN`. |
| `sites remove <domain>` | Remove a site and redeploy (refuses to remove the last site). |
| `snippet [--site X]` | Print the tracking `<script>` tag for one site, or all tracked sites. |
| `skill install [--project]` | Install the Claude Code skill to `~/.claude/skills/lazyanalytics/` (or `./.claude/skills/lazyanalytics/` with `--project`). |
| `config path` / `config get <key>` / `config set <key> <value>` | Inspect/edit `~/.config/lazyanalytics/.env`. Sensitive values (`TOKEN`/`SECRET`/`SALT`/`PASSWORD`) are masked on `get`. |
| `usage` | Worker request usage, free-plan headroom, and cost estimate via the Cloudflare GraphQL API. Flags: `-p today\|7d\|30d`, `-w/--worker <name>`. Needs `CF_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`. |

### Query commands

```bash
lazyanalytics stats      --site example.com --period 7d
lazyanalytics active     --site example.com --window 5
lazyanalytics pages      --site example.com --period 30d --limit 5
lazyanalytics referrers  --site example.com
lazyanalytics geo        --site example.com --period 30d
lazyanalytics channels   --site example.com
lazyanalytics crawlers   --site example.com --type operator
lazyanalytics bounce     --site example.com --period 30d
lazyanalytics duration   --site example.com --period 30d
lazyanalytics history    --site example.com --dimension pages --days 180
lazyanalytics browsers   --site example.com --type os        # browser | os | device
lazyanalytics timeseries --site example.com --unit day       # hour | day
```

| Flag | Short | Default | Description |
| ---- | ----- | ------- | ----------- |
| `--site` | `-s` | required | Site to query |
| `--period` | `-p` | `7d` | `1d` to `90d` |
| `--limit` | `-l` | `10` | Max results (1-100) |
| `--json` | | default | JSON output (for agents) |
| `--table` | | | Human-readable table |

Exit codes: `0` data returned, `1` error, `2` success but empty, `3` config/auth error. `active` returns `0` on a successful 200 even when `active_visitors` is `0`.

## HTTP API reference

All `/api/*` endpoints require `Authorization: Bearer <API_SECRET>` (constant-time compared). Responses use the envelope `{ "data": ..., "meta": { "site", "period", "sampled" } }`; `sampled` is true only when Analytics Engine actually sampled the underlying rows.

| Endpoint | Auth | Description |
| -------- | ---- | ----------- |
| `GET /api/stats` | yes | Pageviews, approximate daily visitors, avg screen width. Params: `site` (required), `period`. |
| `GET /api/active` | yes | Active visitors and recent pageviews in the last N minutes. Params: `site`, `window` (1-60, default 5). |
| `GET /api/pages` | yes | Top pages. Params: `site`, `period`, `limit`. |
| `GET /api/referrers` | yes | Top external referrer domains. Params: `site`, `period`, `limit`. |
| `GET /api/geo` | yes | Country breakdown. Params: `site`, `period`, `limit`. |
| `GET /api/channels` | yes | Pageview-scoped acquisition channels. Params: `site`, `period`. |
| `GET /api/crawlers` | yes | JS-executing AI crawler/agent breakdown. Params: `site`, `period`, `limit`, `type` (`name`\|`operator`\|`class`). Requires `TRACK_AI_CRAWLERS=true` to collect rows. |
| `GET /api/bounce` | yes | Approximate session bounce rate. Params: `site`, `period`. Returns `bounce_rate: null` with a warning when sampled. |
| `GET /api/duration` | yes | Average session duration in seconds. Params: `site`, `period`. Uses best-effort pagehide dwell beacons. |
| `GET /api/history` | yes | Long-term stats from live AE plus R2 daily rollups. Params: `site`, `dimension`, `days` or `from`+`to`. |
| `GET /api/browsers` | yes | Browser/OS/device breakdown. Params: `site`, `period`, `limit`, `type` (`browser`\|`os`\|`device`). |
| `GET /api/timeseries` | yes | Pageviews over time. Params: `site`, `period`, `unit` (`hour`\|`day`). |
| `GET /api/sites` | yes | Tracked sites: `{ "data": [{"site": "example.com"}], "meta": {"count": 1} }`. |
| `POST /collect` | no | Beacon ingest. Body: `{ "sid", "url", "ref?", "sw?", "us?", "um?", "t?", "em?" }`. Returns 204. Bots get 204 but are not recorded; AI crawler beacons are recorded only when enabled; beacons are dropped (204) if the worker has no `ALLOWED_SITES` or `HASH_SALT` configured; unknown `sid` returns 400. CORS-enabled. |
| `GET /tracker.js` | no | Serves the tracking script. |
| `GET /dashboard` | no (page) | Built-in dashboard UI. The page is public, but data loads only after you enter the API token in-page; the token is kept in `sessionStorage` (cleared when the tab closes). You can hand off a session via `https://.../dashboard#token=<API_SECRET>`; the fragment is consumed and immediately stripped from the URL. |
| `GET /health` | no | `{ "status": "ok", "version": "0.3.0", "timestamp": "..." }`. |

Example:

```bash
curl -H "Authorization: Bearer $ANALYTICS_API_TOKEN" \
  "https://lazyanalytics.YOUR-SUBDOMAIN.workers.dev/api/stats?site=example.com&period=7d"
```

## Architecture

```
  Your sites (example.com, blog.example.com, ...)
        │  <script data-site-id="..." src=".../tracker.js">
        │
        ▼  beacon POST to /collect
  ┌──────────────────────────────────────┐
  │   Cloudflare Worker (your account)   │
  │                                      │
  │  /tracker.js   serves tracking JS    │
  │  /collect      ingests pageviews     │
  │  /api/*        query endpoints       │
  │  /dashboard    built-in UI           │
  │  /health       health check          │
  └──────────┬───────────────────────────┘
             │  writeDataPoint() / SQL API
  ┌──────────▼───────────────────────────┐
  │     Cloudflare Analytics Engine      │
  │     (ClickHouse-backed, 90-day)      │
  └──────────────────────────────────────┘
        │  daily aggregate rollups
        ▼
  ┌──────────────────────────────────────┐
  │       R2 archive (optional)          │
  └──────────────────────────────────────┘
        ▲
        │  HTTPS + bearer token
  ┌─────┴──────────────────┐
  │   lazyanalytics CLI    │  → JSON for agents, --table for humans
  │  (or any HTTP client)  │  → Claude Code skill, cron reports, alerting
  └────────────────────────┘
```

1. **Collection**: the tracker sends a beacon on page load and SPA navigations with the page URL (already stripped), referrer domain, screen width, and UTM source/medium; it also sends one best-effort dwell beacon when the page is hidden or unloaded.
2. **Processing**: the worker filters generic bots, optionally classifies JS-executing AI agents, classifies acquisition channel server-side, computes salted daily visitor and 30-minute session hashes, and writes one data point to Analytics Engine.
3. **Querying**: `/api/*` translates HTTP params into sampling-aware SQL (`SUM(_sample_interval)`, never `COUNT(*)`).
4. **Archiving**: the scheduled handler writes daily aggregate JSON rollups to R2 so `/api/history` can blend archive days with live Analytics Engine days.

## Data model

One Analytics Engine data point per pageview:

| Field | Contents | Example |
| ----- | -------- | ------- |
| `index1` | Visitor hash: SHA-256 of `site\|ip\|ua\|date\|HASH_SALT`, truncated to 32 hex chars | `a3f8c9...` |
| `blob1` | Site ID | `example.com` |
| `blob2` | Page path (no query string) | `/blog/my-post` |
| `blob3` | Referrer domain (external only) | `google.com` |
| `blob4` | Country code (`CF-IPCountry`) | `US` |
| `blob5` / `blob6` / `blob7` | Browser / OS / device | `Chrome` / `macOS` / `desktop` |
| `blob8` / `blob9` | UTM source / medium | `twitter` / `social` |
| `blob10` | Traffic class: empty string for human, `ai` for tracked AI agents | `ai` |
| `blob11` | Pageview-scoped channel | `Organic Search` |
| `blob12` | Session hash: salted 30-minute fixed-window hash | `8bd4...` |
| `blob13` / `blob14` / `blob15` | AI crawler name / operator / class | `ChatGPT-User` / `OpenAI` / `user` |
| `blob16` | Event type: `pv` pageview or `eng` dwell beacon | `pv` |
| `double1` | Count (always 1) | `1` |
| `double2` | Screen width | `1440` |
| `double4` | Engagement milliseconds from the dwell beacon | `2500` |

**Sampling note**: Analytics Engine downsamples high-volume data. All count queries use `SUM(_sample_interval)` for correct estimates, and `meta.sampled` tells you when an answer is an estimate rather than an exact count. Bounce rate returns `null` when sampled because single-page session detection becomes biased.

**Metric caveats**:

- Active visitors can lag by seconds to minutes because Analytics Engine is eventually consistent.
- Channels are pageview-scoped, not session-scoped. SPA navigations without an external referrer can inflate Direct compared with GA4/Plausible.
- AI crawler analytics only covers agents that execute JavaScript and send `/collect` beacons. Raw non-JS crawlers such as many training bots are invisible.
- Sessions use fixed 30-minute slots, not sliding inactivity windows. A long visit crossing a slot boundary can split into two sessions and inflate bounce rate.
- Long-range history sums daily approximate visitors from archived rollups; it is not a cross-day unique visitor count.

## Privacy

No cookies, no fingerprinting, no cross-site tracking. Raw IPs and user agents are only hashed transiently (with a per-deployment secret salt, rotated into the hash daily) and never stored. URLs are stripped of query strings client-side; referrers are reduced to a domain. Full details, including honest caveats about hash reversibility, in [PRIVACY.md](PRIVACY.md).

## Secrets model

| Secret | Lives where | Purpose |
| ------ | ----------- | ------- |
| `API_SECRET` | Worker secret + `~/.config/lazyanalytics/.env` (as `ANALYTICS_API_TOKEN`) | Bearer token for `/api/*` and the dashboard |
| `HASH_SALT` | Worker secret + CLI config (so re-runs keep hashes stable) | Salts visitor hashes; never printed |
| `CLOUDFLARE_API_TOKEN` | Your shell env only, at deploy time | Used by `setup` / `sites add\|remove` / `usage`. Never stored by the CLI, never sent to the worker |
| `CF_ACCOUNT_ID` / `CF_API_TOKEN` | Worker secrets (set by `setup`) | Used by worker-side `/api/*` queries (Analytics Engine reads go through Cloudflare's REST API) |

Guidance:

- The CLI config file is written with mode `0600`. `config get` masks sensitive values.
- Use a **least-privilege deploy token**: `Workers Scripts: Edit` + `Account Analytics: Read`. Treat it as setup-time only; the deploy token itself is never stored on the worker.
- `setup` stores the token it was given as the worker-side `CF_API_TOKEN`. For least privilege, give it (or later overwrite the secret with) a *separate* token scoped to `Account Analytics: Read` only, so a worker compromise cannot touch your Workers.
- The analytics bearer token (`API_SECRET`) can only read analytics; it has no power over your Cloudflare account.

## Development

```bash
git clone https://github.com/JayFarei/lazyanalytics.git
cd lazyanalytics
npm install            # installs worker/ and cli/ workspaces
npm run build          # esbuild-bundles dist/worker.js + compiles cli/dist
npm test               # vitest (worker workspace)

# Run the worker locally
cd worker
cat > .dev.vars <<'EOF'
API_SECRET=dev-secret
HASH_SALT=dev-salt
EOF
npx wrangler dev       # ALLOWED_SITES comes from worker/wrangler.toml [vars]

# Run the CLI from source
npx tsx cli/src/index.ts stats --site example.com
```

The npm package ships `cli/dist/`, the prebundled `dist/worker.js`, `templates/wrangler.toml`, and `skill/SKILL.md`; the `worker/` source is only used for development.

### Advanced: credential proxies

The repo contains a `cli/bin/analytics` bash wrapper that routes requests through a OneCLI credential proxy. It is experimental, unsupported, and not part of the npm package. Direct mode (`ANALYTICS_API_URL` + `ANALYTICS_API_TOKEN`) is the supported path.

## Limitations

- Analytics Engine data point retention is 90 days; optional R2 history stores daily aggregate rollups only.
- Visitor counts are approximations (NAT/VPN undercounts, shared devices overcount).
- Data points can take seconds to minutes to become queryable.

## Contributing & license

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md) for how to report vulnerabilities. MIT licensed, see [LICENSE](LICENSE).
