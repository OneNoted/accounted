/**
 * Cross-company roster ("/companies", the firm-altitude "Alla företag"
 * surface) for anyone who is a member of several companies: bureaus, holding
 * structures, serial founders. Read-only aggregation over lib/worklist,
 * deadlines and fiscal-period state; writes always happen by switching into
 * the client company (see components/bureau/OpenClientButton.tsx). The
 * byrå-branded version of this surface arrives later behind a team-scoped
 * capability; this module is its substrate, hence the lib/bureau name.
 */

import type { WorklistCounts } from '@/lib/worklist'
import type { CompanyRole, EntityType } from '@/types'
import type { PeriodStatusValue } from '@/lib/core/bookkeeping/period-service'

/**
 * A client company the caller is verified to be a member of. Produced ONLY by
 * getBureauEligibility (lib/bureau/gate.ts): it is the security boundary for
 * the service-role aggregation in getBureauOverview, so rows must never be
 * constructed from user input or any other source.
 */
export interface ResolvedBureauClient {
  companyId: string
  name: string
  orgNumber: string | null
  entityType: EntityType
  role: CompanyRole
}

export interface BureauDeadline {
  id: string
  title: string
  /** ISO date (deadlines.due_date). */
  dueDate: string
  /** deadlines.status: upcoming|action_needed|in_progress|submitted|confirmed|overdue */
  status: string
  /**
   * True when actionably late. The daily status cron only moves
   * upcoming/action_needed to 'overdue' (lib/deadlines/status-engine.ts) and
   * can lag ~24h, so a date comparison backs it up; in_progress past due is
   * deliberately NOT overdue, matching the cron's own transition rule.
   */
  isOverdue: boolean
  taxDeadlineType: string | null
}

export interface BureauPeriodStatus {
  periodId: string | null
  /** Same enum and precedence as resolvePeriodStatusForDate (period-service). */
  status: PeriodStatusValue
  /**
   * company_settings.bookkeeping_locked_through. Fiscal periods are whole
   * years, so `status` for today is almost always 'open'; this date is the
   * signal that actually shows month-close progress ("Låst t.o.m. …").
   */
  lockedThrough: string | null
}

export interface BureauClientRow extends ResolvedBureauClient {
  /** null = counts unresolved (timeout/truncation), rendered as "-", never 0. */
  worklist: WorklistCounts | null
  nextDeadline: BureauDeadline | null
  periodStatus: BureauPeriodStatus | null
}

export interface BureauOverview {
  /** Sorted urgency-first (lib/bureau/sort.ts). */
  clients: BureauClientRow[]
  /** Within-cap clients whose worklist fan-out timed out or failed. */
  failedCompanyIds: string[]
  /** True when the client set exceeded MAX_FANOUT_CLIENTS. */
  truncated: boolean
  totals: {
    clients: number
    worklistTotal: number
    overdueDeadlines: number
  }
}

/**
 * The single status vocabulary of the roster (one badge per row): deadline
 * urgency outranks work volume.
 */
export type BureauRowStatus = 'forsenad' | 'nara_deadline' | 'pagar' | 'klart'

export function bureauRowStatus(
  row: Pick<BureauClientRow, 'worklist' | 'nextDeadline'>,
): BureauRowStatus {
  if (row.nextDeadline?.isOverdue) return 'forsenad'
  if (row.nextDeadline?.status === 'action_needed') return 'nara_deadline'
  if ((row.worklist?.total ?? 0) > 0) return 'pagar'
  return 'klart'
}
