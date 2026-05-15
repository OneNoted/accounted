import { API_V1_VERSION } from '@/lib/api/v1/version'

export const CHANGELOG_MD = `# Changelog

> Reverse-chronological release notes for the gnubok REST API. Versions follow Stripe's dated format (\`YYYY-MM-DD\`). The current version is **\`${API_V1_VERSION}\`**.

---

## ${API_V1_VERSION} *(current)*

The first stable release of the public REST API. Six phases of development covering the full agent-native surface: authentication + discovery, invoicing vertical, transactions vertical, bookkeeping engine + suppliers + compliance check, payroll + reports + import, webhooks.

### Authentication + discovery (Phase 1)

- API key auth via \`Authorization: Bearer gnubok_sk_<live|test>_<random>\`. 100 RPM rate limit per key.
- \`gnubok_sk_test_*\` keys bound to deterministic sandbox companies.
- Scope-based authorisation per endpoint (\`invoices:read\`, \`payroll:write\`, \`webhooks:manage\`, ...).
- Discovery: \`GET /llms.txt\`, \`GET /api/v1/openapi.json\`, \`GET /.well-known/skills/index.json\`.
- Health: \`GET /api/v1/health\`.
- Response envelope: \`{ data, meta: { request_id, api_version, audit, next_cursor } }\`.
- \`X-Request-Id\` on every response; idempotency on every write.

### Invoices vertical (Phase 2)

- **Customers**: GET list + detail, POST create + bulk-create, PATCH, DELETE.
- **Invoices**: GET list + detail, POST create, PATCH, lifecycle verbs \`/mark-sent\`, \`/mark-paid\`, \`/credit\`, \`/send\`, \`/bulk-create\`. PDF download at \`/{id}/pdf\`.
- VIES validation runs on commit for EU-business customers with a VAT number.
- Mixed-rate invoices supported — per-item \`vat_rate\` overrides the header rate.
- ROT/RUT-avdrag flow and supplier-invoice fakturamodellen on the AP side.

### Transactions vertical (Phase 3)

- **Transactions**: cursor-paginated GET list + detail. Single-tx verbs \`/categorize\`, \`/uncategorize\`, \`/match-invoice\`, \`/match-supplier-invoice\`. Bulk \`/ingest\` (up to 500), \`/batch-categorize\` (up to 100).
- **Reconciliation**: \`POST /reconciliation/bank/run\`, \`GET /reconciliation/bank/status\`.
- **Reads**: \`GET /accounts\`, \`GET /fiscal-periods\`.
- All write surfaces honour strict-mode (commit fully or error with no side effects).

### Bookkeeping primitives + AP + compliance (Phase 4)

- **Suppliers + supplier-invoices** vertical (mirror of Phase 2 invoices on the AP side).
- **Journal entries** primitives: \`POST /journal-entries\` (draft+commit), \`/{id}/commit\`, \`/{id}/reverse\` (storno per BFL 5 kap 5 §), \`/{id}/correct\` (rättelse), \`/batch-create\`.
- **Voucher gap explanations**: \`POST /voucher-gap-explanations\` per BFNAR 2013:2.
- **Fiscal-periods async ops**: \`/lock\`, \`/close\`, \`/year-end\`, \`/opening-balances\`, \`/currency-revaluation\`. All return 202 with operation_id; poll at \`GET /api/v1/operations/{id}\`.
- **Compliance check**: \`GET /compliance/check?type={year_end_readiness|voucher_gaps}\` — pre-flight findings before submission.
- **Documents**: \`POST /documents\` (multipart upload, magic-number-checked), \`GET /{id}/download\` (15-min signed URL), \`POST /{id}/link\` (attach to journal entry).

### Payroll + reports + import (Phase 5)

- **Employees**: full CRUD with personnummer masking on list/create per GDPR Art.5(1)(c). Soft-delete via \`is_active\`.
- **Salary runs**: CRUD + lifecycle verbs \`/calculate\`, \`/approve\`, \`/mark-paid\`, \`/book\`, \`/generate-agi\`. State machine: draft → review → approved → paid → booked.
- **JSON reports** (14): trial-balance, balance-sheet, income-statement, general-ledger, journal-register, vat-declaration, monthly-breakdown, ar-ledger, supplier-ledger, continuity-check, salary-journal, avgifter-basis, vacation-liability.
- **Binary report**: \`GET /reports/sie-export\` (text/plain SIE4 file).
- **Async imports**: \`POST /imports/sie\` (multipart, 50 MB), \`POST /imports/bank\` (multipart, 10 MB, auto-format detection across 11 bank formats). Both async via \`operations\` substrate.

### Webhooks (Phase 6 PR-1) *— shipped 2026-05-15*

- **Subscriptions**: \`POST /webhooks\` (HMAC secret returned exactly once), GET list + detail, PATCH, DELETE. Per-event-type elevated scope check (\`salary_run.*\` and \`agi.generated\` require \`payroll:read\`).
- **Delivery substrate**: per-minute Vercel cron at \`/api/webhooks/dispatch/cron\`. Exponential backoff \`1m / 5m / 30m / 2h / 12h / 24h / 48h\` (7 retries, ~72h total). HTTP 410 from receiver auto-disables the webhook.
- **Signature**: \`X-Gnubok-Signature: t=<unix>,v1=<hex-HMAC-SHA256>\`. Stripe-format. Sample receivers in [Node + Python](/docs/api/webhooks#verifying-signatures).
- **SSRF protection**: webhook_url must be HTTPS; resolved IPs in private/loopback/link-local/CGNAT/cloud-metadata ranges are rejected at create AND dispatch time. \`redirect: 'error'\` on every outbound POST.
- **Audit + retention**: terminal-state delivery rows for accounting events are immutable per BFNAR 2013:2 kap 8 § + retained 7 years per BFL 7 kap 1 §. Webhook DELETE preserves the delivery audit trail (\`ON DELETE SET NULL\` on \`webhook_id\`).
- **Verbs**: \`POST /webhooks/{id}/test\` enqueues a synthetic event; \`POST /webhook-deliveries/{id}/retry\` re-enqueues a dead/delivered delivery.

### Coming soon (Phase 6 PR-2 hardening)

- 90-day TTL cleanup cron for non-accounting webhook deliveries
- Per-route rate limits on \`:test\`, \`:retry\`, and webhook \`:create\`
- V16 audit-log entries on webhook lifecycle events
- DNS-rebinding pinned-IP HTTPS agent
- Integration tests + \`*.pg.test.ts\` for webhook triggers
- \`claim_due_webhook_deliveries\` SQL function with \`FOR UPDATE SKIP LOCKED\`
- Populated \`previous_attributes\` for update-style webhook events
`
