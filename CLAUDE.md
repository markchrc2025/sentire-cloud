# CLAUDE.md: Sentire Cloud

Instructions for Claude Code working in this repository (`markchrc2025/sentire-cloud`). Read this first, then `docs/01_Build_Plan.md`, `docs/02_Blueprint.md` and `docs/03_System_Design.md`.

## What this repo is

Sentire Cloud is the centre of every Sentire app: one Sentire Account (sign-in and organizations), billing (catalog, subscriptions, statements, payments, entitlements), the paywall (feature gating, upgrades, upgrade requests, limits), connections (app registry, event hub, machine credentials) and hosting (instances, provisioning, status, backups). It is multi-tenant (one tenant per organization) and multi-user (one account, many organizations). It never stores a client's business data; that stays in each app.

## Session workflow

1. At the start, call Sentire Projects `start_session` with project key `CLD`, then `get_project_context`.
2. Give the owner your plan first, before taking actions.
3. Work one issue per branch and pull request. Reference the issue key in commits and the PR title (`fixes CLD-12`).
4. Post a short status update after each step of multi-step work; keep working, an update is not a reason to wait.
5. When a test fails, fix the cause and rerun until it passes. Do not stop to ask unless a decision is the owner's.
6. Open, merge and close pull requests yourself when CI is green. Watch every production deployment until it succeeds.
7. Update Sentire Projects as each item finishes. At the end, call `end_session` with a summary and next steps.
8. End every report with an enumerated list of the decisions the owner needs to make, each with a recommended action.
9. Every process ships with a UAT workbook per the Sentire UAT Standard; you run it as the UAT tester.

## Commands

| Command | Does |
|---|---|
| `pnpm dev` | Web app on http://localhost:3000 |
| `pnpm worker` | Job worker (renewals, dunning, events, status checks) |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:seed` | Drizzle migrations and demo data (Ledger plans, a demo organization) |
| `pnpm lint` / `pnpm typecheck` | Checks |
| `pnpm test` | Vitest unit and integration (needs local Postgres) |
| `pnpm test:e2e` | Playwright (sign-up, SSO, checkout, dunning) |

Run `pnpm lint && pnpm typecheck && pnpm test` before every push.

## Project structure

```
src/app/(public)/        sign-up, sign-in, pricing, status page
src/app/(portal)/        client portal: organization, members, billing, connections
src/app/(admin)/         staff console
src/app/oidc/            OpenID Connect provider mount
src/app/api/v1/          entitlements, usage, events, webhooks, provisioning callbacks
src/server/account/      users, sessions, two-factor, organizations, members
src/server/billing/      catalog, subscriptions, statements, payments, dunning, withholding
src/server/entitlements/ computation and publishing
src/server/paywall/      features, upgrade flow, upgrade requests, trials, paywall events
src/server/hub/          event intake, routing, delivery, retries
src/server/hosting/      instances, provisioning, status checks, backups, Dokploy client
src/server/db/           Drizzle schema, migrations, data-access layer
src/worker/              pg-boss job handlers
docs/                    build plan, blueprint, system design, UAT workbooks
tests/                   unit, integration, e2e
```

## Rules that must never be broken

1. **Never store client business data.** No books, payroll, tickets or bookings. Only identity, organization, billing, entitlement, connection and hosting data.
2. **Organization isolation.** Every query on organization-owned data goes through the data-access layer with the current `organizationId`. Never query those tables directly. Add an isolation test for every new table.
3. **Money is integer centavos** (`bigint`), currency PHP, half-up rounding at line level. Never use floating point for money.
4. **Ledgers are append-only.** Statements, payments, credit notes, withholdings and the audit log are never updated in place or deleted; corrections are new rows (credit notes, reversals). A database trigger enforces this; do not remove it.
5. **Idempotency.** Payment webhooks are keyed by provider event ID, events by `eventId`, provisioning by job ID, usage by idempotency key. A repeat returns success and does nothing.
6. **Billing statements are not BIR invoices.** Do not label anything "Invoice" or "Official Receipt" in Sentire Cloud. The invoice number comes back from Sentire's registered system (System Design CR-01).
7. **Seller tax status comes from the seller profile.** Never hard-code VAT or non-VAT wording.
8. **Identity code uses the libraries.** OIDC through node-oidc-provider, passwords through argon2id, TOTP through otplib, passkeys through SimpleWebAuthn. Do not write token, hash or crypto logic by hand.
9. **Apps must fail safe.** Any change to tokens, claims or entitlement shape stays backward compatible for at least one release; bump the entitlement `version` and keep old fields.
10. **No card data.** Use the providers' hosted checkout and tokens only.
11. **Secrets.** Never put secrets in code, tests, logs or chat. Real values live in Dokploy. Use the Dokploy connector's `generate_secret` for internal secrets; ask the owner to paste third-party keys in Dokploy.
12. **Audit everything a person changes**, and every staff action, with actor, before and after.
13. **Times:** store UTC, show Asia/Manila; billing dates are Manila calendar dates.
14. **IDs are ULIDs.**
15. **The paywall is enforced on the server.** Every gated action checks `hasFeature` or `withinLimit` on the server and answers HTTP 402 `PAYMENT_REQUIRED` with the feature key and upgrade address. Hiding UI is never enough; add a test that calls the locked endpoint directly.
16. **Feature keys are permanent.** Never rename or reuse a key; move features between plans through grants.
17. **Never take data hostage.** A locked feature or a reached limit stops new work only; existing records stay readable and exportable.

## Domain notes

- Organization roles: OWNER, ADMIN, BILLING, MEMBER. App roles live in each app.
- Subscription states: PENDING, ACTIVE, PAST_DUE, SUSPENDED, CANCELLED, EXPIRED. Entitlement states: ACTIVE, READ_ONLY, OFF. Mapping in System Design 6.2.
- Dunning: reminders day 0, 3, 7; suspended day 8; cancelled day 30; payment reactivates at once.
- Withholding: a payment may be net of creditable withholding; the withheld amount stays PENDING until a 2307 is accepted.
- Events use sentire.event.v1 from sentire-kit; header `X-Sentire-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>">`; reject anything older than 300 s.
- Retry schedule for deliveries: 1 min, 5 min, 30 min, 2 h, 12 h, then FAILED.
- Paywall: upgrade card shows **Upgrade** to Owner and Billing, **Ask my Owner** to everyone else; limits warn at 80% (at most once a day) and act at 100% by mode: SOFT warns, HARD blocks, OVERAGE records billable usage.
- Upgrade address: `/upgrade?org={orgId}&feature={key}&return={appUrl}`; after payment redirect to `return` with `?entitlement=refresh`.

## Testing expectations

- Unit tests for every money, proration, dunning and entitlement rule, including boundary dates (month ends, leap years, Manila midnight).
- Integration tests per use case (UC-01 to UC-14) against a real Postgres.
- Paywall tests: every gated endpoint refused with 402 when the feature is off; feature on within 60 seconds after upgrade; request approve and decline paths; each limit mode at 79%, 80%, 100% and over.
- Webhook tests replay real provider sample payloads, including duplicates and bad signatures.
- Playwright: sign-up and verification, SSO into a test app, checkout in sandbox, dunning with a fake clock.

## Deployment

- Dokploy project "Sentire Cloud": `sentire-cloud` (web) and `sentire-cloud-worker` (worker) from the same image; `sentire-cloud-staging` deploys on every merge to `main`.
- Production deploys at the end of a phase after UAT passes; watch it until it succeeds, then check `/api/health`, sign-in and the status page.
- Database `sentire_cloud` on the shared Postgres; migrations run on boot.

## When to stop and ask the owner

- Prices, plans, the selling entity, tax wording or anything that changes what a client is charged.
- Anything touching BIR compliance (invoices, withholding treatment) not already in the System Design.
- Changes to another Sentire product's repo beyond the agreed integration contract.
- Deleting data or resources, or changing domains.
