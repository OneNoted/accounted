import type { WorklistCategory } from '@/lib/worklist/types'
import type { WorklistCounts } from '@/lib/worklist/types'

/**
 * Where each worklist category is worked, used by the roster's jump-in menu
 * to land the accountant on the right surface after the company switch.
 * MIRRORS the per-category hrefs in components/dashboard/AttGoraSection.tsx:
 * if a surface moves there, update both.
 */
export const CATEGORY_ROUTES: Record<Exclude<WorklistCategory, 'suggested_match'>, string> = {
  book_transaction: '/transactions',
  inbox_document: '/e/general/invoice-inbox',
  supplier_invoice_approval: '/supplier-invoices',
  verifikat_missing_document: '/bookkeeping?missingUnderlag=true',
  overdue_invoice: '/invoices?status=unpaid',
  deadline_action: '/deadlines',
  pending_operations: '/pending',
}

export type RoutableWorklistCategory = keyof typeof CATEGORY_ROUTES

/**
 * Non-zero routable categories, largest first. suggested_match is excluded
 * everywhere in the roster (subset of book_transaction, see lib/worklist).
 */
export function rankedWorklistCategories(
  worklist: WorklistCounts,
): Array<{ category: RoutableWorklistCategory; count: number }> {
  return (Object.keys(CATEGORY_ROUTES) as RoutableWorklistCategory[])
    .map((category) => ({ category, count: worklist.counts[category] ?? 0 }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count)
}
