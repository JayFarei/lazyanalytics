# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.x (latest release) | Yes |
| Older 0.x releases | No, upgrade to the latest |

During the 0.x series, only the most recent published version receives security fixes.

## Reporting a vulnerability

Please report vulnerabilities **privately** via GitHub Security Advisories:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability** and fill in the advisory form.

Do not open public issues or pull requests for security problems. You should receive an acknowledgment within a few days; please allow a reasonable window for a fix and release before public disclosure.

## Scope

In scope (please report):

- Authentication bypass on `/api/*` or the dashboard (e.g. defeating the bearer token check).
- Data leaks: any way to read analytics data, the site list, or configuration without a valid token.
- Secret exposure: `API_SECRET`, `HASH_SALT`, or Cloudflare credentials being printed, logged, stored insecurely, or otherwise leaked by the worker, the CLI, or the setup flow.
- Visitor re-identification: practical attacks that recover IPs or link visitor hashes across days/sites *without* possessing the salt.
- Injection issues (e.g. SQL injection into Analytics Engine queries via API parameters).
- Supply-chain issues in the published npm package.

Accepted by design (please do not report):

- **Beacon spoofing.** `POST /collect` is intentionally unauthenticated, like every web analytics beacon. Anyone can send fake pageviews for a site in `ALLOWED_SITES`; this can pollute statistics but cannot read data or escalate access.
- Beacon flooding / stats inflation (rate limiting is a deployment concern; Cloudflare-level mitigations apply).
- The dashboard page being publicly reachable: it renders no data without a valid token.
- An operator who possesses both the dataset and the `HASH_SALT` testing candidate IPs against stored hashes; this is documented in [PRIVACY.md](PRIVACY.md).
