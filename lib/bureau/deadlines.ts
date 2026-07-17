import type { SupabaseClient } from '@supabase/supabase-js'
import { createLogger } from '@/lib/logger'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import type { BureauDeadline } from './types'

const log = createLogger('bureau')

/** Max ids per PostgREST .in() filter (mirrors lib/worklist/categories.ts). */
const IN_CLAUSE_CHUNK = 150

interface DeadlineRow {
  id: string
  company_id: string
  title: string
  due_date: string
  status: string
  tax_deadline_type: string | null
}

/**
 * Whether a deadline is actionably late. The daily cron only transitions
 * upcoming/action_needed to 'overdue' (lib/deadlines/status-engine.ts:
 * a submitted VAT declaration past its due date is awaiting confirmation,
 * not late) and can lag up to a day, so the date comparison is restricted
 * to the same two source states.
 */
export function isDeadlineOverdue(status: string, dueDate: string, today: string): boolean {
  if (status === 'overdue') return true
  return dueDate < today && (status === 'upcoming' || status === 'action_needed')
}

/**
 * Earliest actionable incomplete deadline per company, in one query burst.
 * submitted/confirmed deadlines are excluded: they are not the accountant's
 * next action. Soft-fails: a failed chunk stops the scan but results from
 * chunks that already resolved are kept (partial data beats none for a
 * per-company map), and the column degrades rather than taking down the
 * cockpit page.
 */
export async function getBulkNextDeadlines(
  supabase: SupabaseClient,
  companyIds: string[],
  today: string,
): Promise<Map<string, BureauDeadline>> {
  const next = new Map<string, BureauDeadline>()
  if (companyIds.length === 0) return next

  try {
    for (let i = 0; i < companyIds.length; i += IN_CLAUSE_CHUNK) {
      const chunk = companyIds.slice(i, i + IN_CLAUSE_CHUNK)
      // Ordered by due_date with unique id as the tiebreaker, satisfying the
      // fetchAllRows paging invariant; the first row seen per company is its
      // earliest deadline.
      const rows = await fetchAllRows<DeadlineRow>(({ from, to }) =>
        supabase
          .from('deadlines')
          .select('id, company_id, title, due_date, status, tax_deadline_type')
          .in('company_id', chunk)
          .eq('is_completed', false)
          .not('status', 'in', '(submitted,confirmed)')
          .order('due_date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      )
      for (const row of rows) {
        if (next.has(row.company_id)) continue
        next.set(row.company_id, {
          id: row.id,
          title: row.title,
          dueDate: row.due_date,
          status: row.status,
          isOverdue: isDeadlineOverdue(row.status, row.due_date, today),
          taxDeadlineType: row.tax_deadline_type,
        })
      }
    }
  } catch (error) {
    log.error('bulk next-deadline query failed', {
      reason: error instanceof Error ? error.message : String(error),
    })
  }

  return next
}
