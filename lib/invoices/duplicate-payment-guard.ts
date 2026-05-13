/**
 * Shared constants and helpers for the duplicate-payment / SI-match guards
 * used by `/api/supplier-invoices/[id]/mark-paid` and
 * `/api/transactions/[id]/categorize`. Both guards look for a likely-matching
 * counterparty within a fuzzy amount + date window; keeping the thresholds in
 * one place makes them tunable as we learn from real false-positive rates.
 */

/** Acceptable amount drift (±) when matching a bank tx to an invoice amount. */
export const DUPLICATE_AMOUNT_TOLERANCE_PCT = 0.02

/** Date window (±days) around the payment / invoice date. */
export const DUPLICATE_DATE_WINDOW_DAYS = 60

/**
 * Escape LIKE/ILIKE wildcards (`%`, `_`) in a user/data-supplied string before
 * embedding it in a pattern. Without this, a supplier called "50% Off AB" or
 * "Repair_Co" would over-match. Not a SQL-injection guard — Supabase already
 * parameterizes the value — purely to avoid silent over-matching.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}
