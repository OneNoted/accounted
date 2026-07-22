# DPIA screening: invoice delivery history

Date: 2026-07-22
Owner: Accounted controller
Status: Screening completed

## Processing

The service records each customer-invoice delivery attempt, its recipient and
message payload, delivery result, and the exact attached PDF. The purpose is to
provide operational delivery history and evidence that accounting information
was sent. The lawful bases are contract performance under GDPR Article 6(1)(b)
and legal obligations under Article 6(1)(c) and BFL 7 kap.

## Necessity and proportionality

The exact payload is needed server-side to resolve delivery disputes and retain
the sent accounting document. It is not necessary in the routine browser list.
The list therefore exposes only status, timestamps, masked recipient domains,
provider name, error code, and an active-company-scoped link to the archived
PDF. Subjects, bodies, full addresses, reply-to addresses, provider message IDs,
and checksums are excluded.

## Risks and controls

- Cross-tenant disclosure: route context, explicit `company_id` filters, RLS,
  and active-company document authorization.
- Excess browser disclosure: allow-listed response fields, domain masking, and
  `private, no-store` caching.
- Undocumented mutation: immutable status transitions plus a metadata-only
  audit trigger. Audit state excludes recipients and message content.
- Excess retention: fiscal-period-derived `retention_expires_at` and daily PII
  redaction after the statutory minimum expires.
- Misleading failed evidence: a provider failure detaches and deletes the
  unsent archived PDF while retaining attempt metadata.

## Screening conclusion

The processing is limited to ordinary invoice contact and communication data,
does not involve systematic monitoring, special-category data, automated legal
decisions, or large-scale combination of datasets. With the controls above it
does not meet the GDPR Article 35 high-risk threshold, so a full DPIA is not
required. Re-screen before adding message search, analytics, special-category
content, or cross-customer profiling.
