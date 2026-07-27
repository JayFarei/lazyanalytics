# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Optional `DIGEST_JOURNEY_PREFIX` worker variable: paths under the configured prefix (comma-separated for several) get their own ordered section in the daily Slack digest, listed by path rather than by views so a funnel or a deck reads in sequence, with average time on page.
- Per-page average engagement in daily rollups (`RollupRow.avg_engagement_ms`). Omitted when nothing reported engagement, so "not measured" stays distinct from "left instantly". Rollups archived before this change simply lack the field.

## [0.3.0] - 2026-06-13

### Added

- Bounce rate and average session duration endpoints/CLI commands backed by salted fixed-window session hashes and best-effort dwell beacons.
- Scheduled R2 aggregate rollups and blended `/api/history` / `lazyanalytics history` reads for ranges beyond Analytics Engine's live retention.
- Setup flags for archive configuration, including `--no-archive` and `--archive-bucket`.

### Changed

- Tracker now sends one pagehide/hidden dwell beacon while staying below 2KB.
- Query responses document sampled bounce as unreliable by returning `bounce_rate: null` plus a warning.

### Fixed

- `/api/history` queried the live (≤90d) window with one Analytics Engine subrequest per day, exceeding the Workers per-invocation subrequest limit on large ranges; it now aggregates the whole live span in a single query.
- The scheduled rollup backfilled 88 days oldest-first in one run (far over the subrequest limit); it now rolls up newest-first within a bounded window, capped per invocation, and self-heals across daily runs.

## [0.2.0] - 2026-06-13

### Added

- `/api/active` and `lazyanalytics active` for current active visitors.
- `/api/crawlers` and `lazyanalytics crawlers` for opt-in JS-executing AI crawler/agent analytics.
- `/api/channels` and `lazyanalytics channels` for pageview-scoped acquisition channels.
- Shared `traffic_class` and `event_type` filters in `buildWhereClause`, so existing human pageview endpoints exclude AI crawler rows and dwell rows.

### Changed

- Beacon writes now include the 16-blob slot map for traffic class, channel, session, crawler metadata, and event type.
- CLI API fetching/table formatting is shared across base commands and dedicated commands.

## [0.1.0] - 2026-06-12

Initial public release.

### Added

- `lazyanalytics` CLI: `setup`, `sites list/add/remove`, `snippet`, `skill install`,
  `config`, plus query commands `stats`, `pages`, `referrers`, `geo`, `browsers`,
  `timeseries`, and `usage`.
- One-command deploy: `npx @jayfarei/lazyanalytics setup` scaffolds wrangler config into
  `~/.config/lazyanalytics/`, deploys the prebundled worker to your Cloudflare
  account, and generates/stores all secrets without printing them.
- Cloudflare Worker with `/collect` beacon ingest, `/tracker.js`, authenticated
  `/api/*` query endpoints (sampling-aware Analytics Engine SQL), `/api/sites`,
  a built-in `/dashboard`, and `/health`.
- Claude Code skill (`skill/SKILL.md`) covering the full lifecycle, installable
  via `lazyanalytics skill install [--project]`.
- Privacy design: salted daily-rotating visitor hashes (`HASH_SALT` secret),
  no cookies, no raw IPs, query strings stripped, referrer domain only.
  See PRIVACY.md.
- Vitest suite for the worker and GitHub Actions CI.
