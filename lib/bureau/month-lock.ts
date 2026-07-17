/**
 * Month-lock derivation for the roster's close-progress strip (the Fortnox
 * "Mina klienter" month-grid pattern, reduced to the one signal we store:
 * company_settings.bookkeeping_locked_through). A month counts as locked
 * when its last day is on or before the locked-through date.
 */

export interface MonthLockState {
  /** ISO year-month, e.g. "2026-07". */
  month: string
  locked: boolean
  /** True for the last cell (the month containing `today`). */
  isCurrent: boolean
}

/**
 * The `count` calendar months ending with the month of `today`, oldest
 * first, each flagged locked/unlocked against `lockedThrough` (ISO date or
 * null). Pure: `today` is injected so callers own the clock.
 */
export function monthLockStates(
  lockedThrough: string | null,
  today: string,
  count: number = 12,
): MonthLockState[] {
  const [year, month] = today.split('-').map(Number)
  const states: MonthLockState[] = []
  for (let i = count - 1; i >= 0; i--) {
    // Date handles negative/overflow months; day 0 = last day of previous
    // month, so (year, month - i, 0) is the last day of the target month.
    const lastDay = new Date(Date.UTC(year, month - i, 0))
    const iso = lastDay.toISOString().slice(0, 10)
    states.push({
      month: iso.slice(0, 7),
      locked: lockedThrough !== null && iso <= lockedThrough,
      isCurrent: i === 0,
    })
  }
  return states
}
