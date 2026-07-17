import type { SupabaseClient } from '@supabase/supabase-js'
import { createLogger } from '@/lib/logger'
import { getUserCompanies } from '@/lib/company/context'
import type { CompanyRole, EntityType } from '@/types'
import type { ResolvedBureauClient } from './types'

const log = createLogger('bureau')

/** Max ids per PostgREST .in() filter (mirrors lib/worklist/categories.ts). */
const IN_CLAUSE_CHUNK = 150

export interface BureauEligibility {
  /**
   * True when the user has at least two live client companies. Membership
   * count is the real bureau signal: every user has an auto-created
   * 'Personal' team (ensure_user_team), so team presence alone means nothing,
   * and team invites are disabled, so the roster is membership-derived
   * (companies the user created AND companies they were invited into).
   */
  eligible: boolean
  clients: ResolvedBureauClient[]
}

interface MembershipCompany {
  id: string
  name: string
  org_number: string | null
  entity_type: EntityType
  archived_at: string | null
}

/**
 * Resolve the caller's client roster: every non-archived, non-sandbox company
 * they are a member of. This is the SECURITY BOUNDARY for the cockpit: the
 * returned set is the only sanctioned input to getBureauOverview's
 * service-role aggregation, so it must always be derived from the
 * authenticated user's own company_members rows (RLS-scoped user client),
 * never from client input.
 *
 * Soft-fails to ineligible: a failed roster query renders the empty state,
 * never a crash.
 */
export async function getBureauEligibility(
  supabase: SupabaseClient,
  userId: string,
): Promise<BureauEligibility> {
  try {
    const memberships = await getUserCompanies(supabase, userId)

    const live = memberships.flatMap((m) => {
      const company = m.companies as unknown as MembershipCompany | null
      if (!company || company.archived_at) return []
      return [{ membership: m, company }]
    })

    if (live.length === 0) return { eligible: false, clients: [] }

    // Sandbox exclusion + display-name enrichment (company_settings.company_name
    // is the read-primary name; companies.name goes stale after a rename).
    const settingsByCompany = new Map<
      string,
      { is_sandbox: boolean | null; company_name: string | null }
    >()
    const ids = live.map((entry) => entry.company.id)
    for (let i = 0; i < ids.length; i += IN_CLAUSE_CHUNK) {
      const { data, error } = await supabase
        .from('company_settings')
        .select('company_id, is_sandbox, company_name')
        .in('company_id', ids.slice(i, i + IN_CLAUSE_CHUNK))
      if (error) throw new Error(error.message)
      for (const row of data ?? []) {
        settingsByCompany.set(row.company_id, {
          is_sandbox: row.is_sandbox,
          company_name: row.company_name,
        })
      }
    }

    const clients: ResolvedBureauClient[] = live
      .filter((entry) => settingsByCompany.get(entry.company.id)?.is_sandbox !== true)
      .map((entry) => ({
        companyId: entry.company.id,
        name: settingsByCompany.get(entry.company.id)?.company_name || entry.company.name,
        orgNumber: entry.company.org_number,
        entityType: entry.company.entity_type,
        role: entry.membership.role as CompanyRole,
      }))
      // Stable name order so downstream truncation (MAX_FANOUT_CLIENTS) is
      // deterministic; the overview re-sorts final rows by urgency.
      .sort((a, b) => a.name.localeCompare(b.name, 'sv', { sensitivity: 'base' }))

    return { eligible: clients.length >= 2, clients }
  } catch (error) {
    log.error('bureau eligibility resolution failed', {
      userId,
      reason: error instanceof Error ? error.message : String(error),
    })
    return { eligible: false, clients: [] }
  }
}
