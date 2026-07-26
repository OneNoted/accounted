/**
 * PII redaction primitives.
 *
 * This module is the single source of truth for what must never leave the
 * process in clear text. It lives under `lib/observability/` rather than
 * inside `lib/logger.ts` so that the logger AND the observability sink share
 * one implementation: if the denylist lived in the logger only, a direct
 * `captureException()` call would reach a third-party provider unredacted.
 * Keeping one copy makes drift between the two paths impossible.
 *
 * The logs this guards carry personnummer, bank account numbers and financial
 * data. Under GDPR that data must not be shipped to an error-tracking vendor,
 * so redaction runs on every path into the sink, not just on the log path.
 *
 * Two mechanisms:
 *   1. A key denylist (`REDACT_KEYS`): any object key matching case-insensitively
 *      has its whole value replaced, however deeply nested.
 *   2. A personnummer regex applied to every string. UUIDs are stripped first,
 *      because a UUID's hex runs can otherwise look like a 10/12-digit
 *      personnummer and would nuke useful ids.
 *
 * `redact()` is idempotent: running it twice is safe and produces the same
 * result, which is what lets the sink re-redact records the logger already
 * cleaned without changing them.
 *
 * This module must not import anything (least of all the logger): it sits at
 * the bottom of the import graph so nothing can create a cycle through it.
 */

export const REDACTED = '[REDACTED]'

export const REDACT_KEYS = new Set([
  'password',
  'token',
  'access_token',
  'refresh_token',
  'apikey',
  'api_key',
  'secret',
  'authorization',
  'cookie',
  'bank_account',
  'bankaccount',
  'iban',
  'personnummer',
  'ssn',
  'credentials',
])

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const PERSONNUMMER_PATTERN = /\b\d{6}-?\d{4}\b|\b\d{8}-?\d{4}\b/

export function redactString(value: string): string {
  // Strip UUIDs first to avoid false-positive personnummer matches
  const stripped = value.replace(UUID_PATTERN, '')
  if (PERSONNUMMER_PATTERN.test(stripped)) {
    return REDACTED
  }
  return value
}

export function redact(value: unknown, keyPath = ''): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return redactString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: process.env.NODE_ENV === 'production' ? undefined : value.stack,
      code: (value as Error & { code?: unknown }).code,
    }
  }
  if (Array.isArray(value)) return value.map((v, i) => redact(v, `${keyPath}[${i}]`))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT_KEYS.has(k.toLowerCase())) {
        out[k] = REDACTED
      } else {
        out[k] = redact(v, keyPath ? `${keyPath}.${k}` : k)
      }
    }
    return out
  }
  return value
}
