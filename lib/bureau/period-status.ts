import type { SupabaseClient } from '@supabase/supabase-js'
import { createLogger } from '@/lib/logger'
import type { BureauPeriodStatus } from './types'

const log = createLogger('bureau')

/** Max ids per PostgREST .in() filter (mirrors lib/worklist/categories.ts). */
const IN_CLAUSE_CHUNK = 150

interface SettingsRow {
  company_id: string
  bookkeeping_locked_through: string | null
}

interface PeriodRow {
  id: string
  company_id: string
  is_closed: boolean
  locked_at: string | null
}

/**
 * Batched port of resolvePeriodStatusForDate for the bureau roster: the same
 * two-layer precedence (company-wide bookkeeping_locked_through, then the
 * covering fiscal_period's is_closed/locked_at) evaluated for N companies in
 * two query bursts instead of 2N round-trips.
 *
 * Mirrors lib/core/bookkeeping/period-service.ts resolvePeriodStatusForDate
 * and lib/api/v1/check-period-lock.ts: the three share the same query
 * pattern and precedence; if any changes, update all three.
 *
 * Cheap flags only, deliberately NOT validateYearEndReadiness (which builds a
 * full trial balance per company and cannot be fanned out across a roster).
 *
 * Soft-fails to an empty map: a broken period column must never take down the
 * cockpit page.
 */
export async function getBulkPeriodStatus(
  supabase: SupabaseClient,
  companyIds: string[],
  today: string,
): Promise<Map<string, BureauPeriodStatus>> {
  const result = new Map<string, BureauPeriodStatus>()
  if (companyIds.length === 0) return result

  try {
    const lockedThroughByCompany = new Map<string, string | null>()
    const periodByCompany = new Map<string, PeriodRow>()

    for (let i = 0; i < companyIds.length; i += IN_CLAUSE_CHUNK) {
      const chunk = companyIds.slice(i, i + IN_CLAUSE_CHUNK)

      const [settingsRes, periodsRes] = await Promise.all([
        supabase
          .from('company_settings')
          .select('company_id, bookkeeping_locked_through')
          .in('company_id', chunk),
        supabase
          .from('fiscal_periods')
          .select('id, company_id, is_closed, locked_at')
          .in('company_id', chunk)
          .lte('period_start', today)
          .gte('period_end', today),
      ])

      if (settingsRes.error) throw new Error(settingsRes.error.message)
      if (periodsRes.error) throw new Error(periodsRes.error.message)

      for (const row of (settingsRes.data ?? []) as SettingsRow[]) {
        lockedThroughByCompany.set(row.company_id, row.bookkeeping_locked_through)
      }
      for (const row of (periodsRes.data ?? []) as PeriodRow[]) {
        // Periods are non-overlapping fiscal years, so at most one row covers
        // today; if data drift ever produces duplicates, first wins.
        if (!periodByCompany.has(row.company_id)) periodByCompany.set(row.company_id, row)
      }
    }

    for (const companyId of companyIds) {
      const lockedThrough = lockedThroughByCompany.get(companyId) ?? null
      const period = periodByCompany.get(companyId) ?? null

      let status: BureauPeriodStatus['status'] = 'open'
      if (lockedThrough && today <= lockedThrough) {
        status = 'locked'
      } else if (period?.is_closed) {
        status = 'closed'
      } else if (period?.locked_at) {
        status = 'locked'
      }

      result.set(companyId, {
        periodId: period?.id ?? null,
        status,
        lockedThrough,
      })
    }
  } catch (error) {
    log.error('bulk period-status query failed', {
      reason: error instanceof Error ? error.message : String(error),
    })
    result.clear()
  }

  return result
}
