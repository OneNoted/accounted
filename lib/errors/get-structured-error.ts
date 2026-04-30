/**
 * Structured error shape designed for agents (MCP, automation) that need to
 * dispatch on error programmatically rather than read the Swedish prose.
 *
 * Key design decisions:
 *   - code is machine-readable and stable; agents pattern-match on it
 *   - message_sv is the existing UI string from getErrorMessage()
 *   - message_en gives the agent a translation it can act on without parsing
 *     Swedish tokens
 *   - remediation, when present, points the agent at a tool/args/resource
 *     that fixes the problem. Optional — only set when there's a clear
 *     mechanical next step
 *
 * Used by the MCP server's tool error wrapper. UI callers continue to use the
 * string-only getErrorMessage() — this is additive.
 */
import { getErrorMessage } from './get-error-message'

export interface StructuredErrorRemediation {
  description: string
  tool?: string
  args?: Record<string, unknown>
  resource?: string
}

export interface StructuredError {
  code: string
  message_sv: string
  message_en: string
  remediation?: StructuredErrorRemediation
}

interface StructuredErrorOptions {
  /**
   * Optional: scope the agent attempted to use, for INSUFFICIENT_SCOPE remediation.
   */
  attemptedScope?: string
  /**
   * Optional: tool name being called, used in fallback remediation hints.
   */
  toolName?: string
}

const ERROR_CODE_REMEDIATION: Record<string, StructuredErrorRemediation> = {
  ACCOUNTS_NOT_IN_CHART: {
    description: 'One or more BAS accounts referenced are not active in the chart of accounts. Activate them via the bookkeeping settings, or use a different category.',
    resource: 'gnubok://chart-of-accounts',
  },
  JOURNAL_ENTRY_NOT_BALANCED: {
    description: 'Debits and credits do not match. Recalculate the lines so totals are equal before retrying.',
  },
  FISCAL_PERIOD_NOT_FOUND: {
    description: 'No fiscal period covers the entry date. Create or extend the relevant period before retrying.',
    resource: 'gnubok://period/active',
  },
  ENTRY_DATE_OUTSIDE_FISCAL_PERIOD: {
    description: 'The entry date is outside the active fiscal period. Use a date inside an open period or create one that covers it.',
    resource: 'gnubok://period/active',
  },
  CANNOT_REVERSE_NON_POSTED: {
    description: 'Only posted entries can be reversed. Commit the draft first or pick a posted entry.',
  },
  CANNOT_CORRECT_NON_POSTED: {
    description: 'Only posted entries can be corrected. Commit the draft first or pick a posted entry.',
  },
  ENTRY_ALREADY_REVERSED: {
    description: 'Another caller reversed this entry concurrently. Re-fetch the entry list and pick a different one.',
  },
  PERIOD_NOT_LOCKED: {
    description: 'The period must be locked before it can be closed. Call gnubok_lock_period first.',
    tool: 'gnubok_lock_period',
  },
  PERIOD_HAS_UNBOOKED_TRANSACTIONS: {
    description: 'The period contains uncategorized business transactions. Categorize or mark them private before locking.',
    tool: 'gnubok_list_uncategorized_transactions',
  },
  YEAR_END_NOT_RUN: {
    description: 'Year-end closing must be executed before the period can be closed. Run the year-end procedure first.',
  },
  INSUFFICIENT_SCOPE: {
    description: 'The current API key does not have the required scope. Mint a new key with the missing scope or grant it through the API key settings.',
    resource: 'gnubok://capabilities',
  },
  TRANSACTION_ALREADY_CATEGORIZED: {
    description: 'The transaction already has a journal entry. Use gnubok_uncategorize_transaction first if you need to recategorize.',
    tool: 'gnubok_uncategorize_transaction',
  },
  INVOICE_ALREADY_SENT: {
    description: 'The invoice is already sent or paid; sending again would create a duplicate.',
  },
  IDEMPOTENCY_KEY_REUSE: {
    description: 'This idempotency_key was previously used with a different request body. Use a fresh UUID for a new operation, or send the original request body to replay.',
  },
}

/**
 * Pull a stable code out of various error shapes.
 */
function extractCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null

  const obj = error as Record<string, unknown>

  // Typed bookkeeping error: { code: 'JOURNAL_ENTRY_NOT_BALANCED', ... }
  if (typeof obj.code === 'string' && /^[A-Z_]+$/.test(obj.code)) {
    return obj.code
  }

  // Wrapped error: { error: { code: '...' } }
  if (typeof obj.error === 'object' && obj.error !== null) {
    const inner = obj.error as Record<string, unknown>
    if (typeof inner.code === 'string' && /^[A-Z_]+$/.test(inner.code)) {
      return inner.code
    }
  }

  return null
}

/**
 * Heuristically infer a code from the message text when nothing structured
 * is available. Keeps known-error patterns programmatically dispatchable.
 */
function inferCode(message: string): string | null {
  if (/Period must be locked before closing/i.test(message)) return 'PERIOD_NOT_LOCKED'
  if (/Year-end closing must be executed/i.test(message)) return 'YEAR_END_NOT_RUN'
  if (/Kan inte låsa period:.*affärstransaktion/i.test(message)) return 'PERIOD_HAS_UNBOOKED_TRANSACTIONS'
  if (/Insufficient scope/i.test(message)) return 'INSUFFICIENT_SCOPE'
  if (/already has a journal entry/i.test(message)) return 'TRANSACTION_ALREADY_CATEGORIZED'
  if (/already been sent/i.test(message) || /already sent/i.test(message)) return 'INVOICE_ALREADY_SENT'
  if (/locked\/closed fiscal period/i.test(message)) return 'PERIOD_LOCKED'
  if (/Bokföringen är låst/i.test(message)) return 'PERIOD_LOCKED'
  if (/Transaction not found/i.test(message)) return 'NOT_FOUND'
  if (/Invoice not found/i.test(message)) return 'NOT_FOUND'
  return null
}

function extractEnglishMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>
    if (typeof obj.error === 'string') return obj.error
    if (typeof obj.message === 'string') return obj.message
    if (typeof obj.error === 'object' && obj.error !== null) {
      const inner = obj.error as Record<string, unknown>
      if (typeof inner.message === 'string') return inner.message
    }
  }
  return 'Unknown error'
}

/**
 * Build a StructuredError for an arbitrary thrown value.
 *
 * Always returns a valid StructuredError; never throws.
 */
export function getStructuredError(
  error: unknown,
  options: StructuredErrorOptions = {}
): StructuredError {
  const message_en = extractEnglishMessage(error)
  const message_sv = getErrorMessage(error)

  const code = extractCode(error) ?? inferCode(message_en) ?? 'UNKNOWN_ERROR'

  let remediation = ERROR_CODE_REMEDIATION[code]

  // Specialize INSUFFICIENT_SCOPE with the actual scope name when known.
  if (code === 'INSUFFICIENT_SCOPE' && options.attemptedScope && remediation) {
    remediation = {
      ...remediation,
      description: `The current API key does not have the "${options.attemptedScope}" scope. Mint a new key with that scope or add it to the existing key in API settings.`,
    }
  }

  return {
    code,
    message_sv,
    message_en,
    ...(remediation ? { remediation } : {}),
  }
}
