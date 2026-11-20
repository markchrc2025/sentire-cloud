# Sentire Cloud runbook

## New client site (Frappe-based product, e.g. Ledger)
1. In the product container: `bench new-site <client>.<domain> --install-app erpnext --install-app ph_cas`
   (Ledger: use ph_cas.hosting, which also applies the tier limits).
2. Add the client's domain in Dokploy and point its A record at the server.
3. Record the client in the product's subscription record (Ledger: PH Subscription).

## Backups
Each product backs up nightly with restic to RustFS (BACKUP_S3_* variables in Dokploy).
Keep the restic password outside the server (password manager), never in chat.

## Monthly restore drill
1. Pick one client site at random. 2. Restore last night's backup to a scratch site.
3. Open it, check the latest posted document and the audit chain. 4. Delete the scratch site.
5. Log the date and result in Sentire Projects (CLD).

## Incident
1. The console shows the service down or slow. 2. Check Dokploy: deployment status and
runtime logs. 3. If the last deploy broke it, redeploy the previous commit. 4. Tell
affected clients within one hour; log the incident in Sentire Projects.
