# Sentire Cloud

The centre of every Sentire app: one Sentire Account, one bill, and the connections between apps.

> Status: in build (Phases 0 to 4, November 2026). Staging: https://cloud-staging.apps.sentire.solutions. Proprietary software of Sentire Solutions; all rights reserved.

## What it does

- **Sentire Account:** one sign-in for every Sentire app (OpenID Connect), two-factor sign-in, organizations (client companies) with members, roles and per-app access
- **Billing:** product catalog, subscriptions, billing statements, online payments (card, GCash, Maya through PayMongo and Maya for Business), bank transfers, renewals, dunning, withholding and BIR Form 2307 tracking
- **Entitlements:** tells each app what the organization has paid for, down to single features and limits, through tokens, an API and change events
- **Paywall:** a shared upgrade card in every app; Owners upgrade on the spot and return to the feature; members ask their Owner; usage limits warn, block or bill overage; optional feature trials
- **Connections:** app registry and an event hub that carries signed messages between apps (for example Payroll to Ledger)
- **Hosting:** each organization's app instances, provisioning, status page, incidents and backup records
- **Admin console:** for Sentire staff, with a full audit log

Multi-tenant (one tenant per client organization, isolated) and multi-user (one Sentire Account can belong to many organizations, with a role in each). Sentire Cloud never stores a client's business data. Books, payroll, tickets and bookings stay in each app.

## Apps that use it

| App | Engine | Joins in |
|---|---|---|
| Sentire Ledger | Sentire Framework (Python) | Phase 4 |
| Sentire Payroll | Next.js with sentire-kit | Phase 5 |
| Sentire Projects, Helpdesk, LMS, PMS | Next.js or Sentire Framework | Later |

## Tech stack

Next.js 16 (App Router) and TypeScript, Postgres 18 with Drizzle ORM, pg-boss jobs, node-oidc-provider, argon2id, otplib and SimpleWebAuthn, Tailwind CSS with Sentire Designs tokens, sentire-kit events, PayMongo and Maya for Business, Postal email, Semaphore SMS, RustFS storage, Vitest and Playwright. Deployed on Dokploy.

## Getting started (development)

Requirements: Node.js 22+, pnpm 9+, Docker.

```bash
git clone https://github.com/markchrc2025/sentire-cloud.git
cd sentire-cloud
pnpm install
cp .env.example .env.local        # fill in local values
docker compose up -d              # local Postgres with sentire_cloud_dev
pnpm db:migrate
pnpm db:seed                      # Ledger plans and a demo organization
pnpm dev                          # http://localhost:3000
pnpm worker                       # second terminal
```

### Environment variables

| Name | Purpose |
|---|---|
| `APP_URL` | Public base URL, for example https://cloud.sentire.solutions |
| `OIDC_ISSUER` | Issuer URL (permanent once apps trust it) |
| `DATABASE_URL` | Postgres connection string |
| `SESSION_SECRET` | Signs session cookies |
| `KEY_ENCRYPTION_KEY` | Encrypts OIDC signing keys and app secrets at rest |
| `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET` | PayMongo |
| `MAYA_PUBLIC_KEY`, `MAYA_SECRET_KEY`, `MAYA_WEBHOOK_SECRET` | Maya for Business |
| `POSTAL_URL`, `POSTAL_API_KEY`, `MAIL_FROM` | Email |
| `SEMAPHORE_API_KEY`, `SEMAPHORE_SENDER` | SMS (P2) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | RustFS files |
| `DOKPLOY_URL`, `DOKPLOY_API_KEY` | Provisioning (Phase 6) |
| `CHECK_INTERVAL_SECONDS` | Status check interval (default 60) |
| `SENTRY_DSN` | Error tracking (optional) |

Never commit real values. Production values are set in Dokploy.

## Scripts

| Command | Does |
|---|---|
| `pnpm dev` / `pnpm worker` | Web app / job worker |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:seed` | Migrations and demo data |
| `pnpm lint` / `pnpm typecheck` | Checks |
| `pnpm test` / `pnpm test:e2e` | Unit and integration / Playwright |

## For app developers: joining Sentire Cloud

Every Sentire app implements six contracts (Blueprint section 5):

1. **Sign-in:** OpenID Connect code flow with PKCE against `https://cloud.sentire.solutions`; claims include `org_id`, `org_role` and the entitlement summary.
2. **Entitlements:** read the claim, call `GET /api/v1/entitlements/{orgId}/{appId}`, refresh on `account.entitlement.changed`, cache for 24 hours.
3. **Usage:** `POST /api/v1/usage` daily.
4. **Events:** send and receive sentire.event.v1 through `POST /api/v1/events`.
5. **Provisioning:** expose `/sentire/provision`, `/sentire/suspend`, `/sentire/resume`, `/sentire/export`, `/sentire/delete` and `/sentire/health`.
6. **Paywall:** check `hasFeature` and `withinLimit` on the server, answer HTTP 402 `PAYMENT_REQUIRED` for locked actions, and show the shared upgrade card.

## Deployment

Dokploy project "Sentire Cloud":

- `sentire-cloud-staging` deploys on every push to `main` (https://cloud-staging.apps.sentire.solutions)
- `sentire-cloud` (production, https://cloud.sentire.solutions) and `sentire-cloud-worker` deploy at the end of each phase after UAT passes
- Status page: https://status.sentire.solutions
- Health check: `GET /api/health`
- Database `sentire_cloud` on the shared Postgres, nightly encrypted backups

## Documentation

- `docs/01_Build_Plan.md`: phases, tasks, estimates
- `docs/02_Blueprint.md`: scope, architecture, contracts, billing model, decisions
- `docs/03_System_Design.md`: requirements, actors, use cases, class and activity diagrams
- `CLAUDE.md`: how Claude Code works in this repo

## Contributing

Work is tracked in Sentire Projects (project CLD). One branch and one pull request per issue; CI must pass before merge. See `CLAUDE.md` for the workflow and rules.
