# Sentire Cloud

Sentire Cloud is where Sentire products run: Sentire's own hosting on Dokploy, today on
Contabo, and Philippine-hosted servers rented from ALC Hosting for clients who need them
(project CLD). It is not Frappe Cloud: it hosts every Sentire product, Python and Next.js.

## What is in this repo
| Path | What |
|---|---|
| src/, public/ | the Sentire Cloud console: live status of every product and platform service |
| services.json | the services the console checks (public URLs only, no keys) |
| docs/OFFER.md | what a client buys |
| docs/RUNBOOK.md | new client site, backups, restore drill, incidents |
| Dockerfile | the console image (Node 22, port 8080, no dependencies) |

## Deploy on Dokploy
Project "Shared Services", app "Sentire Cloud", source GitHub markchrc2025/sentire-cloud,
branch main, build type Dockerfile, port 8080, domain cloud.sentire.solutions (A record to
91.90.80.4) or cloud.apps.sentire.solutions. No environment variables are required.
