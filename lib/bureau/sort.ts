import type { BureauClientRow } from './types'

/**
 * Urgency rank for the roster sort: overdue deadlines first, then deadlines
 * needing action, then everything else (ordered by open work volume).
 */
export function urgencyRank(row: BureauClientRow): 0 | 1 | 2 {
  if (row.nextDeadline?.isOverdue) return 0
  if (row.nextDeadline?.status === 'action_needed') return 1
  return 2
}

/**
 * Worklist total for sorting. Unresolved counts (null) sort below a clean
 * zero so a failed fan-out sinks to the bottom instead of faking urgency.
 */
function sortableTotal(row: BureauClientRow): number {
  return row.worklist?.total ?? -1
}

/**
 * Urgency-first roster comparator: the top row is always the client the
 * accountant should enter next.
 */
export function compareBureauClients(a: BureauClientRow, b: BureauClientRow): number {
  const rankA = urgencyRank(a)
  const rankB = urgencyRank(b)
  if (rankA !== rankB) return rankA - rankB

  // Within overdue/action_needed: oldest deadline first.
  if (rankA < 2 && a.nextDeadline && b.nextDeadline) {
    const byDue = a.nextDeadline.dueDate.localeCompare(b.nextDeadline.dueDate)
    if (byDue !== 0) return byDue
  }

  const byTotal = sortableTotal(b) - sortableTotal(a)
  if (byTotal !== 0) return byTotal

  const byName = a.name.localeCompare(b.name, 'sv', { sensitivity: 'base' })
  if (byName !== 0) return byName

  return a.companyId.localeCompare(b.companyId)
}
