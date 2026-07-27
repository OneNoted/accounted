# Data Classification and Handling

Classification: Confidential

## Restricted data

Swedish personal identity numbers are Restricted personal data. They are not an
Article 9 special category by themselves, but their stable government identifier
role requires heightened protection.

Controls:

- Customer personal numbers are accepted only for individual customers.
- Values are encrypted with AES-256-GCM before database storage.
- API and UI output exposes only the last four digits.
- Writes require an authenticated company member with write permission.
- RLS and explicit `company_id` filters enforce tenant isolation.
- There is no endpoint that returns the full value.
- Logs and audit event payloads must never contain the full value.

## Internal business data

Article master records are Internal business data. An unused article may be
deleted because issued invoice lines, archived invoice PDFs, journal entries,
and audit events retain the accounting evidence independently. Any article that
is referenced by an invoice line is protected by the application check and the
database foreign key.

## Invoice delivery history

Invoice recipient addresses, subjects, and message bodies are Confidential
personal and business data. Exact payloads are retained server-side as delivery
evidence until `invoice_deliveries.retention_expires_at`. Browser list responses
contain masked recipient domains and operational metadata only. After the BFL
retention date, the daily redaction control removes recipients, message content,
provider message IDs, filenames, and attachment checksums. BCC recipients are
never returned by the browser delivery-list endpoint, and direct table selection
of the exact payload is limited to the sending user. Exact company evidence is
included only in owner/admin server-side statutory archives. Delivery writes use
service-only functions so browser clients cannot forge or mutate the evidence.
Selective audit rows must contain delivery IDs, tenant IDs, status transitions,
actors, timestamps, and document linkage only, never email payload content.

The statutory archive's `data/invoice_deliveries.json` is Confidential and may
contain full To, CC, and BCC addresses, reply-to, sender name, subject, plain and
HTML message bodies, provider identifiers, error details, attachment metadata
and checksum, actor and tenant identifiers, status, timestamps, retention data,
and the exact sent PDF. It is not a minimized delivery-list response. Only an
owner or admin may generate it, authorization is independently rechecked with
explicit user and company predicates before the service-role export starts, and
all archive queries remain explicitly scoped to that company.

## Full statutory archive

The complete ZIP is Confidential and can contain personal data beyond invoice
delivery history: customer and supplier names, personal or organization
identifiers, email addresses, phone numbers, postal addresses, bank accounts,
IBAN and BIC values, invoice references and free-text notes; employee identity,
employment, absence, benefit, payroll and declaration records; transaction
descriptions, counterparties, account references and notes; company contact and
tax-contact details; user and actor identifiers in accounting and audit records;
and the contents and metadata of uploaded documents. Encrypted source fields
remain encrypted in structured dumps, while rendered PDFs and source documents
may contain their readable business content.

The export is a data-portability and statutory-retention operation, not a
routine UI disclosure. It is available only to an active-company owner or
admin, is served with a private response, and is never written to application
logs. The authenticated RLS authorization is repeated through a stateless
service-role client with explicit `user_id` and `company_id` predicates. Export
queries filter by that company directly or use parent IDs fetched under the
same filter. Recipients must store and transfer the ZIP as Confidential data.

## Client-side storage inventory

Everything this application persists on a user's device. It is inventoried here
because the analytics posture is "no analytics data and no cookies on the
device" (`persistence: 'memory'`), and the exceptions are only defensible if
they are known, enumerated and reviewed rather than discovered in production.

Application-owned keys:

- `Accounted:chat-sidebar-collapsed` — assistant sidebar UI state.
- `gnubok.inbox.onboarding.dismissed` — one-time onboarding hint dismissal.

PostHog-owned keys. Both are written by PostHog's own modules straight to
`localStorage`, bypassing the `persistence: 'memory'` setting, so neither is
prevented by the SDK configuration:

- `seenSurvey_<survey_id>` — `"true"`. Suppresses a survey the user already
  answered or dismissed. Without it every survey re-prompts on each page load
  under memory persistence.
- `ph_conv_<project_token>` — `{"widgetSessionId": "<uuid>"}`. Lets a user
  return to their own support ticket in the same browser. Created at page
  load, before the user contacts support.

Classification: neither PostHog key is personal data. Both are functional UI
state: a random identifier and a boolean marker, with no name, address, email
or accounting content, and neither is readable across origins. They are the
basis for treating this storage as strictly necessary rather than requiring
consent, so a change in their content changes that assessment.

Controls:

- `lib/analytics/purge-legacy-storage.ts` removes storage from the retired
  Recapt processor (`recapt` / `glimt` substrings) on every boot. It
  deliberately does NOT touch `seenSurvey_*` or `ph_conv_*`: clearing those
  would re-prompt surveys and orphan the user's own ticket.
- No cookies are set by the application or by PostHog under this configuration.

Review trigger: **enabling any new PostHog product may silently add device
storage**, because the products write directly to `localStorage` rather than
through the SDK's persistence setting. After enabling one, inspect
`localStorage` on production and update this section, `.compliance/ropa.yaml`
and `app/(public)/privacy/page.tsx` together. The Support product was caught
this way; the assumption that `persistence: 'memory'` was sufficient was wrong.
