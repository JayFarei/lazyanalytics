---
name: lazyanalytics
description: |
  Set up, manage, and query self-hosted web analytics on Cloudflare Workers — deploy the
  analytics worker, add or list tracked sites, install tracking snippets, rotate secrets,
  and query pageviews, visitors, referrers, geo, browsers, and timeseries. Use when the
  user asks about website traffic ("how is my site doing", "pageviews for"), wants to set
  up or deploy analytics, add/remove a tracked site, get a tracking snippet, or check
  analytics usage and cost.
version: 0.1.0
---

# lazyanalytics

Self-hosted, privacy-friendly web analytics (Cloudflare Workers + Analytics Engine).
Run every command as `npx @jayfarei/lazyanalytics ...` (works globally installed or not).

## 1. Prerequisites & config discovery

Query commands need `ANALYTICS_API_URL` (e.g. `https://lazyanalytics.YOUR-SUBDOMAIN.workers.dev`)
and `ANALYTICS_API_TOKEN`. The CLI auto-loads them from `./.env` or `~/.config/lazyanalytics/.env`.

Check setup state with `npx @jayfarei/lazyanalytics config get ANALYTICS_API_URL` (exit 2 if unset).
If neither env vars nor the config file exist, the service is not set up — go to section 2.

## 2. Setup (deploy the worker)

Non-interactive (preferred for agents):

```bash
CLOUDFLARE_API_TOKEN=<cf-token> CF_ACCOUNT_ID=<32-hex-account-id> \
  npx @jayfarei/lazyanalytics setup --sites example.com,blog.example.com --yes
```

- The Cloudflare API token needs only: **Workers Scripts: Edit** and **Account Analytics: Read**.
- Flags: `--sites <csv>`, `--account-id <id>`, `--name <worker-name>` (default `lazyanalytics`),
  `--rotate-secrets`, `-y/--yes` (never prompt, fail on missing input).
- Setup scaffolds `~/.config/lazyanalytics/worker/`, deploys via wrangler, generates
  `API_SECRET` and `HASH_SALT` automatically, sets them as worker secrets without echoing
  them, writes `~/.config/lazyanalytics/.env` (mode 0600), health-checks `/health`, and
  prints the tracking snippet for each site.
- Idempotent: re-running reuses the existing secrets and site list. Only pass
  `--rotate-secrets` if the user explicitly asks to rotate credentials.

**NEVER print `ANALYTICS_API_TOKEN`, `API_SECRET`, `HASH_SALT`, or `CLOUDFLARE_API_TOKEN`
values.** Do not `cat` the config file; `config get <KEY>` masks sensitive values.

## 3. Site management

| Command | What it does | Needs |
|---|---|---|
| `sites list` | List tracked sites (worker `/api/sites`) | API URL + token |
| `sites add example.com` | Add to ALLOWED_SITES and redeploy worker | `CLOUDFLARE_API_TOKEN` + setup scaffold |
| `sites remove example.com` | Remove and redeploy (refuses to remove the last site) | `CLOUDFLARE_API_TOKEN` + setup scaffold |
| `snippet [-s example.com]` | Print tracking `<script>` tag(s); omit `-s` for all sites | API URL |

Tracking snippet shape (place in the site's `<head>`):

```html
<script defer id="analytics" data-site-id="example.com" src="https://lazyanalytics.YOUR-SUBDOMAIN.workers.dev/tracker.js"></script>
```

## 4. Querying

All query commands: `npx @jayfarei/lazyanalytics <command> -s example.com [options]`

| Command | Returns | Extra options |
|---|---|---|
| `stats` | Pageviews, approx visitors, avg screen width | — |
| `pages` | Top pages by view count | — |
| `referrers` | Top referrer domains | — |
| `geo` | Breakdown by country | — |
| `browsers` | Browser/OS/device breakdown | `--type browser\|os\|device` (default `browser`) |
| `timeseries` | Pageviews over time | `--unit hour\|day` (default `day`) |
| `usage` | Worker request usage, free-plan headroom, est. cost | `-p today\|7d\|30d` (default `today`), `-w/--worker <name>`; needs `CF_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`, not the analytics token |

Common options (stats/pages/referrers/geo/browsers/timeseries):

- `-s, --site <site>` — required, e.g. `example.com`
- `-p, --period <period>` — `Nd` format (`7d`, `30d`, `90d`), default `7d`
- `-l, --limit <n>` — max rows, default `10`
- `--table` — human-readable table; default output is JSON

Example: `npx @jayfarei/lazyanalytics pages -s example.com -p 30d -l 5`

## 5. Reading results

JSON shape: `{ "data": [...], "meta": { "site", "period", "sampled" } }`

Exit codes:

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Error (bad request, API failure) |
| 2 | Success but no data for the query |
| 3 | Config missing (URL/token/credentials not set) |

Sampling: Analytics Engine samples data under load. If `meta.sampled` is `true`,
numbers are extrapolated estimates — say so when reporting them to the user.

## 6. Error handling

| Symptom | Cause | Fix |
|---|---|---|
| Exit 3 / HTTP 401 "Authentication failed" | Missing or wrong `ANALYTICS_API_URL`/`ANALYTICS_API_TOKEN` | Check `config get`, or re-run `setup` |
| 400 "Unknown site: X" | Site not in worker's ALLOWED_SITES | `npx @jayfarei/lazyanalytics sites add X` |
| 500 "Server not configured" | Worker secrets missing | Re-run `npx @jayfarei/lazyanalytics setup` |
| "worker scaffold not found" | `sites add/remove` before setup on this machine | Run `npx @jayfarei/lazyanalytics setup` first |
| "Invalid period format" | Period not in `Nd` form | Use `7d`, `30d`, `90d` |
| Exit 2, empty data | No traffic recorded yet | Verify the snippet is installed; data appears within minutes |
