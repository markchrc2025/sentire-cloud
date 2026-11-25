---
title: "Sentire Cloud: Build Plan"
subtitle: "Version 1.2, 25 November 2026"
---

# Sentire Cloud: Build Plan

**Version 1.2, 25 November 2026.** Version 1.1 added the paywall tasks (about 1.5 weeks). Version 1.2 removes the client migration task (no existing clients) and records the owner's decisions. Companion documents: Blueprint, System Design, CLAUDE.md, README.md. Requirement IDs (FR, NFR, CR) refer to the System Design. Work is tracked in Sentire Projects, project CLD.

## 1. Summary

| Phase | Goal | Estimate | Ends with |
|---|---|---|---|
| 0 | Foundations: repo, database, deploy, CI, current console kept | 1 week | Empty Next.js app live on staging, console moved inside it |
| 1 | Sentire Account and organizations | 2 weeks | Sign-up, sign-in, two-factor, organizations, members, OIDC provider |
| 2 | Catalog and billing | 3.5 weeks | Ledger plans and features on sale; checkout, statements, renewals, dunning, 2307s |
| 3 | Entitlements, paywall, status and admin console | 2 weeks | Feature entitlements, upgrade flow and requests, limit paywalls, status page, staff console, audit log |
| 4 | Ledger adopts Sentire Cloud | 2 weeks | Ledger signs in through Sentire Cloud, enforces its paywall, is provisioned and offboarded by it |
| 5 | Connections and event hub; Payroll adopts | 2.5 weeks | Payroll to Ledger link running for one pilot client |
| 6 | Hosting automation | 2 weeks | Dedicated instances on ALC Hosting servers created from Sentire Cloud |
| Later | Growth features | n/a | Business figures, metered AI billing and overage, feature trials, paywall figures, Google and Microsoft sign-in, accountant firm links |

**Total to the end of Phase 4: about 10.5 weeks of focused work; to the end of Phase 6: about 15 weeks.** These are estimates for one developer with Claude Code, assuming no other product work in the same weeks. They are not measured.

### 1.1 Honest timing note

Ledger's launch milestone (M6) is due 15 December 2026. Sentire Cloud billing cannot be ready by then. Recommended: Ledger launches with its existing PH Subscription record and manual billing, and moves to Sentire Cloud in Phase 4. There are no existing clients, so no migration is needed. Building Sentire Cloud is infrastructure, not revenue; Phases 5 and 6 should wait until Ledger has paying clients on Phase 4.

## 2. Working rules

- One branch and one pull request per issue; CI (lint, type-check, unit and integration tests) must pass before merge; Claude opens, merges and closes pull requests.
- `main` deploys to staging (`cloud-staging.apps.sentire.solutions`) on every merge. Production (`cloud.sentire.solutions`) deploys at the end of each phase after UAT passes, and every production deployment is watched until it succeeds.
- Every phase ships with a UAT workbook per the Sentire UAT Standard; Claude runs it as the UAT tester; failures are fixed and retested before the phase closes.
- Sentire Projects (CLD) is updated as each item finishes; each report ends with the decisions the owner needs to make, each with a recommended action.
- Secrets never go through chat. They are set in Dokploy (Environment tab) by the owner or created with the Dokploy connector's secret generator.

## 3. Phase 0: Foundations (1 week)

| # | Task | Requirements | Estimate |
|---|---|---|---|
| 0.1 | Replace the console code in `sentire-cloud` with a Next.js 16 app (TypeScript strict, Tailwind, Sentire tokens); keep the status checks as a module | NFR-15 | 1 day |
| 0.2 | Drizzle schema and migration runner (applied on boot); `sentire_cloud` database on the shared Postgres via the Dokploy connector | NFR-10 | 0.5 day |
| 0.3 | pg-boss worker entry point; second Dokploy app `sentire-cloud-worker` | n/a | 0.5 day |
| 0.4 | Data-access layer that requires an organization context; ULID ids; money and time helpers | NFR-06, NFR-07, NFR-13 | 1 day |
| 0.5 | CI workflow (lint, type-check, Vitest with a Postgres service); staging app with auto-deploy | NFR-15 | 0.5 day |
| 0.6 | Audit log table with append-only trigger | NFR-09, FR-41 | 0.5 day |
| 0.7 | Health endpoint, structured logs, error tracking | NFR-12 | 0.5 day |
| 0.8 | Move the current status checks into the new app at `/status`; keep `cloud.apps.sentire.solutions` working | FR-35 | 0.5 day |

**Exit:** staging app live, status page unchanged for users, CI green, migrations applied on boot.

## 4. Phase 1: Sentire Account and organizations (2 weeks)

| # | Task | Requirements | Estimate |
|---|---|---|---|
| 1.1 | Users, sessions, sign-up, email verification, sign-in, sign-out, password reset (argon2id, breached-password check, rate limits, lockout) | FR-01, FR-04, NFR-04 | 2 days |
| 1.2 | Two-factor: TOTP, passkeys, recovery codes; required for Owners and staff | FR-02 | 1.5 days |
| 1.3 | Organizations: create, profile with TIN, branch and VAT status, switcher | FR-07, FR-08 | 1 day |
| 1.4 | Members, roles, per-app access, invitations, removal, ownership transfer | FR-09 to FR-11 | 2 days |
| 1.5 | OIDC provider at `/oidc`: discovery, JWKS, authorization code with PKCE, refresh rotation, end-session, back-channel logout; organization picker in the authorize step; custom claims | FR-03, NFR-17 | 2.5 days |
| 1.6 | Signing key storage, encryption and 90-day rotation job | NFR-04 | 0.5 day |
| 1.7 | App launcher data endpoint for the sentire-kit app switcher | FR-05 | 0.5 day |
| 1.8 | Transactional emails through Postal (verify, reset, invite, new sign-in) | FR-42 | 0.5 day |
| 1.9 | Privacy notice, terms acceptance, marketing consent record; account deletion request | CR-04 | 0.5 day |
| 1.10 | Tests: isolation tests, OIDC conformance basics (a test client completes the code flow), Playwright sign-up and sign-in; UAT workbook "Account and organizations" | NFR-06, NFR-15 | 1 day |

**Exit:** a test app signs in through Sentire Cloud with PKCE and receives organization claims; UAT passes; production deployed at `cloud.sentire.solutions` (needs the A record).

## 5. Phase 2: Catalog and billing (3.5 weeks)

| # | Task | Requirements | Estimate |
|---|---|---|---|
| 2.1 | **Spike:** confirm PayMongo and Maya features in sandbox (hosted checkout, payment links, saved cards and recurring charges, refunds, webhook signatures); write the findings | FR-14, FR-16 | 1 day |
| 2.2 | Catalog: products, plans, versioned prices, setup fees, add-ons with minimum plan rank, bundles, limits; staff screens; seed Ledger's plans | FR-13 | 2 days |
| 2.2b | Feature catalog: feature keys, benefits, grants per plan and add-on, limits with mode (soft, hard, overage); staff screens; seed Ledger's limits and the `ai.assistant` add-on | FR-44, FR-45 | 1.5 days |
| 2.3 | Seller profiles (non-VAT default, VAT switch), statement numbering per seller | CR-02 | 0.5 day |
| 2.4 | Subscriptions and statements: checkout flow, Pending to Active, statement lines, PDF generation, statement emails | FR-14, FR-15, FR-22 | 3 days |
| 2.5 | Payment webhooks for both providers, idempotent, signature-checked; bank transfer recording and matching | FR-14, FR-20, NFR-08 | 2 days |
| 2.6 | Renewals: statement 7 days before period end, saved-method charge or payment link, scheduled plan changes | FR-16, FR-18 | 1.5 days |
| 2.7 | Dunning schedule and state machine (past due, suspended, cancelled, reactivated); staff grace extension | FR-17 | 1.5 days |
| 2.8 | Upgrades with proration, downgrades and cancellation at period end | FR-18 | 1 day |
| 2.9 | Withholding: net payments, 2307 upload, staff review, quarterly 2307 report | FR-19, CR-03 | 1 day |
| 2.10 | Credit notes, refunds, adjustments with reasons | FR-20 | 1 day |
| 2.11 | Invoice bridge: `billing.statement.paid` to Sentire's own Ledger company; invoice number written back to the statement (manual entry fallback) | CR-01 | 1 day |
| 2.12 | Billing page for Owners and Billing Contacts, showing which features are on and why | FR-22, FR-45 | 1 day |
| 2.13 | Tests: money and proration unit tests, webhook replay tests, dunning time-travel tests, Playwright checkout in sandbox; UAT workbook "Billing" | NFR-07, NFR-08 | 1.5 days |

**Exit:** a test organization buys Ledger Solo in sandbox, renews, falls into dunning, is suspended, pays and is reactivated; statements and PDFs are correct to the centavo; UAT passes.

## 6. Phase 3: Entitlements, paywall, status and admin console (2 weeks)

| # | Task | Requirements | Estimate |
|---|---|---|---|
| 3.1 | Entitlement computation from subscription, plan, add-ons, feature grants, trials and staff overrides; `features` and `limits` with modes; versioning | FR-24, FR-45 | 1.5 days |
| 3.2 | Entitlement API, machine clients (client credentials), signed entitlement claim in ID tokens | FR-25, FR-31 | 1 day |
| 3.3 | Account events (organization, member, entitlement) signed with sentire-kit; delivery with retries (the core of the event hub, reused in Phase 5) | FR-32, FR-25 | 1.5 days |
| 3.4 | Usage reporting endpoint and the usage-against-plan view | FR-26 | 0.5 day |
| 3.4b | Upgrade address and flow: pick the cheapest unlocking option, prefilled checkout, return with refresh flag | FR-47 | 1 day |
| 3.4c | Upgrade requests: create, merge repeats, notify Owners and Billing, approve or decline, tell the requester; paywall events | FR-48 | 1 day |
| 3.4d | sentire-kit paywall helpers (`hasFeature`, `withinLimit`, 402 answer helper) and the shared upgrade card for Next.js apps | FR-46, NFR-18 to NFR-20 | 1 day |
| 3.5 | Status page with uptime history, incidents and the public view at `status.sentire.solutions` | FR-35 | 1 day |
| 3.6 | Admin console: search, organization detail, subscriptions, statements, payments, 2307 queue, audit log | FR-39, FR-41 | 2 days |
| 3.7 | Tests (including direct calls to locked endpoints) and UAT workbook "Entitlements, paywall and admin" | NFR-15, NFR-18 | 1 day |

**Exit:** changing a plan in staging changes the entitlement, and a test app receives the change event within 60 seconds; in the test app, a Member's request and an Owner's upgrade both unlock a locked feature end to end; UAT passes; production deployed.

## 7. Phase 4: Ledger adopts Sentire Cloud (2 weeks)

This phase changes Sentire Ledger (repo ph-cas) and is tracked as LDG work linked to CLD.

| # | Task | Requirements | Estimate |
|---|---|---|---|
| 4.1 | Register Ledger as an app with its OIDC client, event endpoint and provisioning URL | FR-27 | 0.5 day |
| 4.2 | Ledger sign-in through Sentire Cloud (Frappe Social Login Key and a ph_cas hook mapping `org_id` to the site and `org_role` to a default role set); local sign-in kept only for the site Administrator (operations) | FR-03 | 2 days |
| 4.3 | Ledger reads the entitlement claim and API; its tier limits come from Sentire Cloud; the PH Subscription record becomes a mirror | FR-24, FR-25 | 2 days |
| 4.4 | Ledger provisioning, suspend, resume, export and delete endpoints wrapping its existing site creation, export and deletion certificate | FR-34, FR-38 | 2 days |
| 4.5 | Ledger usage reports (users, branches, invoices this month) | FR-26 | 0.5 day |
| 4.5b | Ledger paywall: Frappe paywall helpers and upgrade card include, server-side 402 checks on gated actions, limit warnings and blocks replacing Ledger's own tier checks | FR-46, FR-49, NFR-18 | 2.5 days |
| 4.7 | End-to-end UAT: sign up, buy, open Ledger, invite an Accountant, downgrade, suspend, reactivate, cancel and export; UAT workbook "Ledger on Sentire Cloud" | NFR-15 | 1.5 days |

**Exit:** a new client buys Ledger at cloud.sentire.solutions and is working in Ledger without staff help; UAT passes.

## 8. Phase 5: Connections and event hub; Payroll adopts (2.5 weeks)

| # | Task | Requirements | Estimate |
|---|---|---|---|
| 5.1 | App registry screens; per-instance event secrets with two-secret rotation | FR-27 | 1 day |
| 5.2 | Connections per organization: enable, choose event types, disable; account.connection events | FR-28 | 1.5 days |
| 5.3 | Event hub routing for app-to-app events: verify, store, route by connection and entitlement, deliver with the retry schedule, delivery log, resend | FR-29, FR-30 | 2 days |
| 5.4 | sentire-kit update: sign-in helpers point at Sentire Cloud as the issuer; entitlement and usage helpers (part of the Sentire Framework enhancement) | FR-03, FR-25 | 1.5 days |
| 5.5 | Payroll signs in through Sentire Cloud and reads entitlements | FR-03, FR-24 | 2 days |
| 5.6 | Payroll to Ledger: `payroll.run.approved` creates a draft journal entry in Ledger; `payroll.run.paid` back (LDG-119, FWK-4) | FR-29 | 3 days |
| 5.7 | UAT workbook "Connections" with one pilot client | NFR-15 | 1 day |

**Exit:** for one pilot client, an approved payroll run appears in Ledger as a draft journal entry within 60 seconds, and a failed delivery is retried and visible in the delivery log.

## 9. Phase 6: Hosting automation (2 weeks)

| # | Task | Requirements | Estimate |
|---|---|---|---|
| 6.1 | Servers registry (Contabo, ALC Hosting MNL, MNL2, CRK) linked to Dokploy remote servers | FR-37 | 1 day |
| 6.2 | Dedicated provisioning: create the app on a chosen server through the Dokploy API, set environment, add domain, deploy, wait for health | FR-34 | 3 days |
| 6.3 | Backup records reported by apps and backup jobs; missing-backup alerts; monthly restore-test log | FR-36 | 1.5 days |
| 6.4 | Hosting products in the catalog (after the ALC quote and test, CLD-2 to CLD-6) | FR-13 | 0.5 day |
| 6.5 | Monitoring of instances on remote servers (Beszel link for server load and disk) | FR-35 | 1 day |
| 6.6 | UAT workbook "Hosting" | NFR-15 | 1 day |

**Exit:** staff create a dedicated Ledger instance on an ALC server from the admin console; it is monitored and backed up.

## 10. Later

| Item | Requirements |
|---|---|
| Business figures: MRR, ARR, churn, ARPU, overdue, AI cost against AI revenue | FR-43 |
| Metered usage billing (AI tokens, SMS, storage) | FR-21 |
| Sign in with Google or Microsoft | FR-06 |
| Accountant firm links across client organizations | FR-12 |
| Consent-based staff access to client data inside apps | FR-40 |
| Trials, pilots and promo codes; feature trials | FR-23, FR-50 |
| Paywall figures per feature | FR-51 |
| Overage billing for metered limits | FR-49 |
| Remaining apps adopt: Projects, Helpdesk, LMS, PMS | FR-03, FR-24 |
| Registration of Sentire Cloud with the BIR as an invoicing system, if chosen | CR-01 |

## 11. Owner actions

| When | Action |
|---|---|
| Before Phase 1 production | A records for `cloud.sentire.solutions` and `status.sentire.solutions` to 91.90.80.4 (Claude adds them in GoDaddy) |
| Before Phase 2 | Create PayMongo and Maya sandbox and live API keys and paste them in Dokploy |
| Before Phase 2 exit | Confirm with your RDO the billing statement and invoice route (CR-01) |
| Before Phase 6 | ALC Hosting test server results (CLD-3 to CLD-5) |

## 12. Definition of done (every task)

1. Code merged through a pull request with CI green.
2. Unit and integration tests for the rule it adds; isolation test if it touches organization data.
3. Audit entries for any state change a person makes.
4. UAT cases added to the phase workbook.
5. Sentire Projects issue updated with the pull request number.
6. Docs updated (README environment variables, this plan's status).
