# Privacy

lazyanalytics is designed to answer "how is my site doing?" without building profiles of the people visiting it. This document describes exactly what is processed, what is stored, and the honest limits of the design.

## What is processed

When a page on a tracked site loads, the tracking script sends a beacon to your worker. The worker processes:

| Data | How it is handled |
| ---- | ----------------- |
| IP address + User-Agent | Used **transiently** to compute a visitor hash: `SHA-256(site \| ip \| ua \| date \| HASH_SALT)`. The raw IP and UA string are never written to storage. Because the current UTC date is part of the hash input, the identifier rotates every day. `HASH_SALT` is a per-deployment secret generated at setup. |
| Page URL | Reduced to the **path only**. Query strings and fragments are stripped in the browser before the beacon is sent, and stripped again server-side as defense in depth. |
| Referrer | Reduced to the **domain only** (e.g. `google.com`), never the full URL. Visits referred from your own tracked sites are dropped. |
| Country | Two-letter country code from Cloudflare's `CF-IPCountry` header. No city or coordinates. |
| Browser, OS, device type | Coarse values derived from the User-Agent (e.g. `Chrome`, `macOS`, `desktop`). The UA string itself is not stored. |
| Screen width | A single number (e.g. `1440`), used for responsive-design insight. |
| UTM source / medium | Only `utm_source` and `utm_medium`, if present in the URL when the page loaded. |

## What is NOT collected

- **No cookies** and no localStorage identifiers. Nothing is written to the visitor's browser.
- **No cross-site identifiers.** The site ID is part of the hash input, so the same person on two of your sites produces unrelated hashes.
- **No raw IP addresses** are ever stored.
- **No full URLs.** Query strings (tokens, search terms, email addresses in params) never leave the visitor's browser.
- **No fingerprinting**: no canvas, fonts, hardware enumeration, or behavioral signals.
- Known bots and crawlers are filtered out and not recorded.

## Retention and deletion

Data is stored in Cloudflare Analytics Engine, which retains data points for **90 days** and then deletes them automatically. There is no per-visitor deletion mechanism: stored visitor hashes are not linkable back to a person without the secret salt, so there is no way to find (and therefore selectively delete) one visitor's rows. Deleting the whole dataset is the only deletion granularity.

## Data processor

All data is stored and processed in **your own Cloudflare account**. Cloudflare, Inc. acts as the data processor (Workers handle the beacon; Analytics Engine stores the data points). No data is sent to the authors of this project or to any other third party.

## For site owners

You are the data controller for your deployment. Even though this tool is designed to avoid personal data at rest, the transient processing of IP addresses may still fall under privacy regulations in your jurisdiction (e.g. GDPR). You should mention your use of self-hosted analytics in your site's privacy policy, including the 90-day retention period and Cloudflare's role as processor.

## Honest framing: hash reversibility

The visitor hash is *not* magic anonymization, and we want to be precise about its limits:

- The hash input space (IP + UA) is small enough to brute-force **if** an attacker knows the salt. The protection comes from `HASH_SALT` being a 256-bit secret that exists only as a worker secret and in the operator's `0600` config file.
- Someone with access to the stored hashes but **not** the salt cannot recover IPs or correlate visitors across days or sites.
- An operator (or attacker) with **both** dataset access **and** the salt could test candidate IP+UA combinations against stored hashes for a given day. Treat the salt accordingly: never print it, never commit it, and rotate it (`lazyanalytics setup --rotate-secrets`) if you suspect exposure. Rotating the salt unlinks all past hashes permanently.
- Daily rotation bounds the damage: even a fully reversed hash only ties a visitor to pageviews within a single UTC day on a single site.
