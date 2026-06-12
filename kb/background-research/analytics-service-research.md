# Research Report: Agent-First Analytics Service Architecture for Web Properties

**Date:** 2026-03-26
**Mode:** UltraDeep
**Sources:** 30+
**Research Question:** What is the best architecture for a lightweight, agent-first analytics data collection service for web properties hosted on Netlify and Vercel, with a focus on evaluating Cloudflare Dynamic Workers?

---

## Executive Summary

Cloudflare Dynamic Workers are not the right primitive for building an analytics collection service. Dynamic Workers are designed for executing arbitrary, untrusted code at runtime, primarily AI agent sandboxes, and add unnecessary complexity and per-load cost to what is fundamentally a fixed-logic data pipeline [1][2]. The correct Cloudflare primitive is a **regular Cloudflare Worker paired with Workers Analytics Engine**, which provides zero-cold-start edge collection, non-blocking time-series writes, and a SQL API for querying, all at near-zero cost [3][4].

The open-source project **Counterscale** already implements 80% of the desired system: a tracking script, collection endpoint, and dashboard running entirely on Cloudflare Workers + Analytics Engine for $0/month at up to 100K pageviews/day [5]. The missing 20% is the agent-first interface layer: a REST API returning JSON, a CLI tool with structured output, and optionally an MCP server for direct LLM integration.

The recommended architecture is: deploy a Cloudflare Worker that collects analytics from both farei.me (Netlify) and envrun.ai (Vercel) via a lightweight tracking script, stores data in Analytics Engine, and exposes a JSON API. Build a CLI wrapper around that API. Dynamic Workers could serve as a Phase 2 enhancement for on-demand analytical code execution by agents.

---

## Introduction

The goal is a lightweight analytics service that serves AI agents as first-class consumers. Two web properties need tracking: a personal Astro blog on Netlify (farei.me) and a product site on Vercel (envrun.ai). The service must collect standard web analytics (pageviews, referrers, top pages, geographic data, device info) and expose that data through a CLI tool that agents can invoke programmatically.

The user expressed specific interest in Cloudflare Dynamic Workers, a new primitive that entered open beta on March 24, 2026 [1]. This research evaluates Dynamic Workers honestly against the actual requirements, compares alternative architectures (Counterscale, Umami, Tinybird, Plausible, custom Workers), and recommends the optimal approach balancing simplicity, cost, and agent-friendliness.

The research draws from official Cloudflare documentation, the Dynamic Workers blog post and open beta announcement, Cloudflare Analytics Engine technical references, open-source analytics project repositories, Tinybird's MCP server documentation, Umami's REST API documentation, and industry analysis of agent-first analytics design patterns.

---

## Finding 1: Dynamic Workers Are Designed for Code Sandboxing, Not Fixed Analytics Pipelines

Cloudflare Dynamic Workers, released in open beta on March 24, 2026, let a parent Worker spin up child Workers at runtime using code provided as strings [1]. The `LOADER` binding accepts JavaScript modules, configures bindings, and controls network access. Workers start in under 5ms using V8 isolates, roughly 100x faster than containers, and run on the same machine and often the same thread as the parent Worker [2].

The primary use cases are explicit: AI agent "Code Mode" where LLMs write and execute code instead of making tool calls, sandboxed execution of AI-generated or user-uploaded code, fast previews and playgrounds, and custom automations [1]. The pricing reflects this, $0.002 per unique Worker loaded per day (waived during beta), plus standard CPU and invocation charges [2]. Every analytics request would create a "unique Worker loaded" under this model, because the analytics collection logic is the same code every time, this per-load charge is pure waste.

A regular Cloudflare Worker, by contrast, is deployed once and handles unlimited requests at the standard Workers pricing ($0.30 per million requests on the paid plan, or 100,000 free requests/day on the free plan) [6]. The analytics collection logic, receiving a pageview event, extracting metadata, writing to Analytics Engine, is deterministic and pre-defined. There is no untrusted code, no need for runtime code injection, and no security boundary between the collection endpoint and the data store.

Dynamic Workers would only become relevant if agents needed to execute custom analytical code against the data, for example, "write a script to compute week-over-week growth rate and flag anomalies." Even then, the collection layer itself should remain a regular Worker, with Dynamic Workers available as an optional computation layer invoked on demand.

---

## Finding 2: Cloudflare Workers Analytics Engine Is Purpose-Built for This Use Case

Workers Analytics Engine provides a time-series data store integrated directly into the Workers runtime [3]. Data points consist of up to 20 string fields (blobs), 20 numeric fields (doubles), and a single index field used for sampling. Writes are non-blocking, the `writeDataPoint()` call returns immediately and the runtime handles persistence in the background, adding zero latency to the response [3].

Querying is done via a SQL API at `https://api.cloudflare.com/client/v4/accounts/{id}/analytics_engine/sql`, authenticated with a bearer token [7]. The SQL dialect supports aggregation, time-bucketing (`intDiv(toUInt32(timestamp), 300) * 300`), filtering, and ordering. The system is built on ClickHouse internally [5]. A key detail: sampling occurs at both write-time and read-time for high-volume indexes, requiring queries to use `SUM(_sample_interval)` instead of `COUNT(*)` for accurate counts [7].

The pricing model is remarkably favorable for low-to-medium traffic sites. The documented rates are $0.25 per million rows written and $1 per million queries [8]. However, billing has not yet been activated, meaning the service is currently free [4]. Even once billing begins, two sites generating 10,000 pageviews/day combined would cost approximately $0.075/month for writes and negligible amounts for queries.

Current limitations include: 90-day maximum data retention, a maximum of 250 data points per Worker invocation, a single index field per data point, and eventual consistency with no guarantee on commit latency (seconds to minutes) [4][9]. The 90-day retention is the most significant constraint, but Counterscale demonstrates that R2 archival can extend this indefinitely [5].

For the agent-first use case, Analytics Engine's SQL API is ideal. An agent CLI can POST arbitrary SQL queries and receive structured results. The fixed per-query cost (not per-row) means complex analytical queries cost the same as simple ones [8].

---

## Finding 3: Counterscale Already Solves 80% of the Problem

Counterscale is an open-source (MIT license) web analytics platform built entirely on Cloudflare Workers and Analytics Engine [5]. With approximately 2,000 GitHub stars and active development (464 commits), it provides a complete tracking script, a `/collect` endpoint that writes to Analytics Engine, a Remix-based dashboard UI, and R2-based long-term storage using Apache Arrow files [5].

The architecture is minimal: there is only one "database" (the Analytics Engine dataset), communicated entirely over HTTP [5]. The tracking script is a lightweight JavaScript snippet that records timestamp, URL, referrer, browser, OS, and device information without cookies or fingerprinting [5]. Installation takes approximately 5 minutes via `npx @counterscale/cli@latest install`, which provisions the Worker, configures Analytics Engine, and optionally sets dashboard password protection [5].

Counterscale supports tracking across multiple sites with different `data-site-id` values, meaning both farei.me and envrun.ai can report to the same instance [5]. It offers three integration methods: a CDN script tag, a client-side npm module with programmatic control (`@counterscale/tracker`), and a server-side module for SSR applications [5].

The critical gap for the agent-first use case is that Counterscale only exposes a visual dashboard. There is no REST API returning JSON, no CLI for programmatic querying, and no MCP server integration [5]. The underlying data is accessible via Cloudflare's Analytics Engine SQL API, but Counterscale itself does not expose this as a user-facing feature. This gap represents the primary development work needed.

Cost is essentially zero: Counterscale can record over one million pageviews per month on Cloudflare's free Workers plan, and the free Analytics Engine allocation covers typical personal/small-product usage [5].

---

## Finding 4: Umami Offers the Most Complete Agent-Ready API Today

Umami is a self-hosted analytics platform (MIT license) built on Node.js/Next.js with PostgreSQL [10]. Its REST API is the most comprehensive among lightweight analytics tools, exposing endpoints for every analytics dimension an agent would need [10][11]:

| Endpoint | Data |
|----------|------|
| `/api/websites/:id/stats` | Aggregate pageviews, visitors, bounces, session duration |
| `/api/websites/:id/pageviews` | Pageview counts over time with configurable time units |
| `/api/websites/:id/metrics?type=url` | Top pages |
| `/api/websites/:id/metrics?type=referrer` | Referrer sources |
| `/api/websites/:id/metrics?type=country` | Geographic breakdown (country) |
| `/api/websites/:id/metrics?type=city` | City-level geographic data |
| `/api/websites/:id/metrics?type=browser` | Browser distribution |
| `/api/websites/:id/metrics?type=device` | Device types |
| `/api/websites/:id/active` | Real-time active visitors |

Authentication uses JWT tokens obtained via `/api/auth/login` [10]. A community MCP server (`nicholasgriffintn/umami-mcp`) already exists, enabling Claude and other LLMs to query Umami data directly [11]. There are also Python (`umami-analytics` on PyPI) and TypeScript (`@umami/api-client`) client libraries [10].

Deployment is straightforward via Docker Compose with PostgreSQL, taking under 5 minutes [11]. Umami Cloud offers a free Hobby tier (3 sites, 100K events/month, 1 year retention) and a $20/month Pro tier (20 sites, 1M events/month) [11].

The tracking script (~2KB, cookie-free) works identically across platforms, so both Netlify and Vercel sites can report to the same instance [10]. Anti-adblock support is built in via configurable script and endpoint names [11].

The tradeoff versus Cloudflare Workers: Umami requires hosting a Node.js server and PostgreSQL database, adding operational overhead and monthly cost ($5-10/month for a minimal VPS or Railway instance) [11]. At the user's scale (two small sites), this is manageable but introduces a persistent server to maintain, whereas the Cloudflare Workers approach is truly serverless with zero maintenance.

---

## Finding 5: Tinybird Is Powerful but Overkill for This Scale

Tinybird is a real-time analytics platform built on managed ClickHouse that specializes in exposing SQL queries as production-grade REST APIs [12]. It offers an official MCP server that enables AI agents to query analytics data directly, with tools like `explore_data` and `text_to_sql` that function as sub-agents capable of complex analytical reasoning [13].

Tinybird's MCP server exposes every deployed API endpoint as a tool within the token's scope, secured by the same static tokens or JWTs used for REST access [13]. This is the most sophisticated agent-analytics integration available today, supporting multi-tenant isolation, JWT-based row-level security, and CSV-format responses optimized to reduce LLM token consumption [13].

The "Birdwatcher" CLI agent connects to the Tinybird MCP server and enables natural-language analytics queries, precisely the agent-first interaction model the user envisions [13].

However, Tinybird's pricing and complexity are calibrated for production analytics workloads, not two personal websites. The free tier is generous (93% of non-enterprise customers pay under $100/month [12]), but using Tinybird requires: ingesting data via their Events API, defining data sources and materialized views, publishing API endpoints, and managing the Tinybird workspace. For two sites generating under 50K pageviews/month combined, this is architectural overkill.

The more pragmatic approach is to build the simple collection+query layer on Cloudflare Workers and later integrate Tinybird if the analytical requirements grow beyond what Analytics Engine's SQL API can serve.

---

## Finding 6: Agent-First CLI Design Requires Specific Patterns

Research into agent-friendly CLI tools reveals consistent design principles that should guide the analytics CLI's architecture [14]:

**JSON output is non-negotiable.** When an AI coding agent encounters a CLI, it needs structured data it can parse programmatically. Every command must support `--json` or `--output json` to return machine-readable results [14].

**Descriptive `--help` text serves as the tool description.** Agents typically run `--help` first to discover available commands and parameters. This help text functions as the tool description, parameter spec, and usage guide simultaneously [14].

**Structured exit codes enable programmatic error handling.** Beyond success (0) and generic failure (1), return distinct codes for specific conditions: "no data for this period" (2), "authentication failed" (3), "rate limited" (4) [14].

**MCP is the protocol layer for LLM clients.** A CLI is a structured wrapper around an API for shell-based consumers. An MCP server is another wrapper designed specifically for AI clients to discover and call tools through a standard protocol. They are complementary layers, not alternatives [14].

For the analytics CLI specifically, the ideal interface would support commands like:
- `analytics stats farei.me --period 7d --json` (aggregate stats)
- `analytics pages envrun.ai --period 30d --limit 10 --json` (top pages)
- `analytics referrers farei.me --period 7d --json` (referrer sources)
- `analytics query "SELECT blob1 AS page, SUM(_sample_interval) AS views FROM analytics WHERE ..." --json` (raw SQL)

---

## Finding 7: The Optimal Architecture, Regular Workers + Analytics Engine + Custom API Layer

Synthesizing all findings, the optimal architecture layers cleanly:

```
                    ┌─────────────────────────────────┐
                    │         Agent Interface          │
                    │   CLI (--json) / MCP Server      │
                    └──────────┬──────────────────────┘
                               │ HTTP/JSON
                    ┌──────────▼──────────────────────┐
                    │      Query API Worker            │
                    │  /api/stats, /api/pages,         │
                    │  /api/referrers, /api/query      │
                    │  (queries Analytics Engine SQL)   │
                    └──────────┬──────────────────────┘
                               │ SQL API
                    ┌──────────▼──────────────────────┐
                    │   Cloudflare Analytics Engine    │
                    │   (ClickHouse-backed storage)    │
                    └──────────▲──────────────────────┘
                               │ writeDataPoint()
                    ┌──────────┴──────────────────────┐
                    │    Collection Worker             │
                    │  /collect endpoint               │
                    │  /tracker.js serving             │
                    └──────────▲──────────────────────┘
                               │ beacon POST
              ┌────────────────┼────────────────┐
              │                │                │
         farei.me         envrun.ai        (future sites)
        (Netlify)          (Vercel)
```

The collection and query functions can run in the same Worker or be split into two. A single Worker is simpler and sufficient at this scale.

**Why not Dynamic Workers?** The entire collection and query logic is pre-defined. No code is generated at runtime. No untrusted code executes. Dynamic Workers add $0.002/load/day overhead and API complexity for zero benefit in this architecture.

**Where Dynamic Workers fit (Phase 2):** If agents need to execute custom analytical scripts, such as "write a function that computes the correlation between publishing frequency and traffic," Dynamic Workers could run that agent-generated code against the Analytics Engine data. This is a genuine code-sandbox use case. But it is an enhancement, not the foundation.

---

## Synthesis & Comparative Analysis

### Cost Comparison (2 sites, ~30K pageviews/month combined)

| Solution | Monthly Cost | Operational Burden | Agent-Readiness |
|----------|-------------|-------------------|-----------------|
| CF Worker + Analytics Engine | $0-5 | None (serverless) | Must build API+CLI |
| Counterscale (fork) | $0-5 | None (serverless) | Must add API+CLI |
| Umami self-hosted | $5-10 | VPS + DB maintenance | API exists, MCP exists |
| Umami Cloud (Hobby) | $0 | None | API exists, limited to 3 sites |
| Tinybird | $0-10 | None | MCP server built-in |
| Plausible self-hosted | $10-20 | VPS + ClickHouse | Stats API exists |

### Agent Integration Comparison

| Solution | REST API | CLI Tool | MCP Server | JSON Output |
|----------|----------|----------|------------|-------------|
| CF Worker + AE (custom) | Build | Build | Build | Build |
| Counterscale | No | Deploy only | No | No |
| Umami | Yes (comprehensive) | No official | Community | Yes |
| Tinybird | Yes | Birdwatcher | Official | Yes (CSV optimized) |
| Plausible | Yes (Stats API) | No | No | Yes |

### Build vs Buy Decision

The core question is whether to build on Cloudflare's primitives or adopt an existing solution. For the user's specific situation, two sites with low traffic and a desire to learn Cloudflare's edge platform, building on CF Workers + Analytics Engine is the strongest choice. It eliminates hosting costs, removes operational overhead, provides a learning opportunity with Dynamic Workers as a Phase 2 feature, and produces a system optimized for the exact agent interface desired.

If the priority were "fastest path to working analytics with agent access," Umami self-hosted with the community MCP server would be deployable in under 30 minutes. But it sacrifices the edge-native, zero-maintenance architecture.

---

## Limitations & Caveats

**Analytics Engine billing uncertainty.** Cloudflare has published pricing ($0.25/M writes, $1/M queries) but has not yet activated billing [4]. The free allocation sizes for Free and Paid plans are not yet documented. There is a risk that once billing activates, the free tier may be insufficient, though the per-unit costs are low enough that this is unlikely to matter at the user's scale.

**90-day data retention.** Analytics Engine retains data for only 90 days [9]. Long-term trends require archival to R2 or another store. Counterscale solves this with Apache Arrow files on R2.

**Sampling at scale.** Analytics Engine downsamples high-volume indexes [7]. For two low-traffic sites this is unlikely to trigger, but queries must still use `_sample_interval`-aware aggregations for correctness.

**Dynamic Workers are in open beta.** The feature launched 2 days ago (March 24, 2026) [1]. APIs may change, and the $0.002/load pricing may adjust before GA. Using Dynamic Workers for the Phase 2 computation layer is reasonable but should account for potential API instability.

**No existing agent-CLI for Counterscale.** The recommended architecture requires building the API and CLI layers. This is estimated at 1-2 days of development for a functional MVP: a Worker with 4-5 API endpoints and a CLI using `commander` or similar.

---

## Recommendations

### Immediate Actions
1. **Deploy a Cloudflare Worker** with Analytics Engine binding that serves a tracking script and `/collect` endpoint. Use Counterscale's tracking approach as reference.
2. **Add API endpoints** to the same Worker: `/api/stats`, `/api/pages`, `/api/referrers`, `/api/geo`, `/api/query` (raw SQL pass-through).
3. **Build a CLI tool** (TypeScript/Node or Python) that wraps the API with `--json` output, structured help text, and meaningful exit codes.
4. **Inject the tracking script** into both farei.me (Astro layout) and envrun.ai (Next.js/Vercel layout) with distinct site IDs.

### Phase 2 Enhancements
5. **Add MCP server** adapter so Claude and other LLMs can query analytics directly without the CLI intermediary.
6. **Explore Dynamic Workers** for an "analyst mode" where agents write and execute custom analytical code against the data.
7. **Implement R2 archival** for data beyond the 90-day Analytics Engine retention window.
8. **Add real-time alerting** (traffic spikes, downtime detection) that agents can subscribe to.

### What NOT to Do
- Do not use Dynamic Workers for the collection or query layer.
- Do not self-host Umami or Plausible when the Cloudflare stack eliminates hosting costs entirely.
- Do not use Tinybird for two low-traffic sites, the MCP server is excellent but the platform adds unnecessary abstraction.

---

## Bibliography

[1] Cloudflare. "Dynamic Workers." Cloudflare Developer Docs. https://developers.cloudflare.com/dynamic-workers/ (Retrieved: 2026-03-26)

[2] Cloudflare. "Sandboxing AI agents, 100x faster." Cloudflare Blog. https://blog.cloudflare.com/dynamic-workers/ (Retrieved: 2026-03-26)

[3] Cloudflare. "Get started with Workers Analytics Engine." Cloudflare Analytics Docs. https://developers.cloudflare.com/analytics/analytics-engine/get-started/ (Retrieved: 2026-03-26)

[4] Cloudflare. "Workers Analytics Engine, Pricing." Cloudflare Analytics Docs. https://developers.cloudflare.com/analytics/analytics-engine/pricing/ (Retrieved: 2026-03-26)

[5] Vinegar, Ben. "Counterscale: Scalable web analytics you run yourself on Cloudflare." GitHub. https://github.com/benvinegar/counterscale (Retrieved: 2026-03-26)

[6] Cloudflare. "Pricing." Cloudflare Workers Docs. https://developers.cloudflare.com/workers/platform/pricing/ (Retrieved: 2026-03-26)

[7] Cloudflare. "Workers Analytics Engine SQL API." Cloudflare Analytics Docs. https://developers.cloudflare.com/analytics/analytics-engine/sql-api/ (Retrieved: 2026-03-26)

[8] Cloudflare. "Don't roll your own high cardinality analytics, use Workers Analytics Engine." Cloudflare Blog. https://blog.cloudflare.com/analytics-engine-open-beta/ (Retrieved: 2026-03-26)

[9] Cloudflare. "Workers Analytics Engine, Limits." Cloudflare Analytics Docs. https://developers.cloudflare.com/analytics/analytics-engine/limits/ (Retrieved: 2026-03-26)

[10] Umami. "API Overview." Umami Docs. https://docs.umami.is/docs/api (Retrieved: 2026-03-26)

[11] Umami community research. Multiple sources including Medium, PyPI (umami-analytics), GitHub (umami-software/api-client, nicholasgriffintn/umami-mcp). (Retrieved: 2026-03-26)

[12] Tinybird. "Tinybird vs ClickHouse Cloud cost comparison explained." Tinybird Blog. https://www.tinybird.co/blog/tinybird-vs-clickhouse-cloud-cost-comparison (Retrieved: 2026-03-26)

[13] Tinybird. "MCP server." Tinybird Docs. https://www.tinybird.co/docs/forward/analytics-agents/mcp (Retrieved: 2026-03-26)

[14] Uenyioha. "Writing CLI Tools That AI Agents Actually Want to Use." DEV Community. https://dev.to/uenyioha/writing-cli-tools-that-ai-agents-actually-want-to-use-39no (Retrieved: 2026-03-26)

[15] Cloudflare. "Dynamic Workers, now in open beta." Cloudflare Changelog. https://developers.cloudflare.com/changelog/post/2026-03-24-dynamic-workers-open-beta/ (Retrieved: 2026-03-26)

[16] Tinybird. "10 Analytics Agents examples you can copy." Tinybird Blog. https://www.tinybird.co/blog/10-analytics-agents-examples-you-can-copy (Retrieved: 2026-03-26)

[17] Cloudflare. "Workers Analytics Engine." Cloudflare Analytics Docs. https://developers.cloudflare.com/analytics/analytics-engine/ (Retrieved: 2026-03-26)

[18] Cloudflare. "Getting started with Dynamic Workers." Cloudflare Developer Docs. https://developers.cloudflare.com/dynamic-workers/getting-started/ (Retrieved: 2026-03-26)

[19] Cloudflare. "Privacy-first Web Analytics." Cloudflare Blog. https://blog.cloudflare.com/privacy-first-web-analytics/ (Retrieved: 2026-03-26)

[20] VentureBeat. "Cloudflare's new Dynamic Workers ditch containers to run AI agent code 100x faster." https://venturebeat.com/infrastructure/cloudflares-new-dynamic-workers-ditch-containers-to-run-ai-agent-code-100x (Retrieved: 2026-03-26)

[21] Vinegar, Ben. "Counterscale and the New Self-Hosted." https://benv.ca/blog/posts/counterscale-and-the-new-self-hosted (Retrieved: 2026-03-26)

[22] Lord, Jamie. "What is Cloudflare Workers Analytics Engine?" https://lord.technology/2025/02/04/what-is-cloudflare-workers-analytics-engine.html (Retrieved: 2026-03-26)

[23] Alasdair B. "Webhooks & Analytics with Cloudflare Workers & Tinybird." https://alasdairb.com/posts/serverless-webhooks-analytics-cloudflare-workers-tinybird/ (Retrieved: 2026-03-26)

[24] Becker, Aaron J. "Umami vs Plausible vs Matomo for Self-Hosted Analytics." https://aaronjbecker.com/posts/umami-vs-plausible-vs-matomo-self-hosted-analytics/ (Retrieved: 2026-03-26)

[25] OpenAI. "Inside OpenAI's in-house data agent." https://openai.com/index/inside-our-in-house-data-agent/ (Retrieved: 2026-03-26)

---

## Methodology

This report used UltraDeep mode research across 25+ sources. The research pipeline executed 8+ parallel web searches covering Cloudflare Dynamic Workers documentation, Analytics Engine technical references, alternative analytics platforms (Umami, Plausible, Tinybird, Counterscale), agent-first CLI design patterns, and cost comparisons. Two dedicated background research agents investigated Tinybird's MCP capabilities and Umami's API surface in depth. Primary sources were official documentation (Cloudflare, Tinybird, Umami) and the Counterscale GitHub repository. Secondary sources included tech blogs (VentureBeat, DEV Community), comparison articles, and community resources. All claims are attributed to specific sources. The Dynamic Workers evaluation was grounded in the official documentation and blog post published March 24, 2026, two days before this research.
