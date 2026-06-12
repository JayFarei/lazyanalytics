# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
