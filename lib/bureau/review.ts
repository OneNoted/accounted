import type { SupabaseClient } from '@supabase/supabase-js'
import { createLogger } from '@/lib/logger'
import { getBureauEligibility, type BureauEligibility } from './gate'
import type { ResolvedBureauClient } from './types'

const log = createLogger('bureau')

/** Max ids per PostgREST .in() filter (mirrors lib/worklist/categories.ts). */
const IN_CLAUSE_CHUNK = 150

export type ReviewRiskLevel = 'low' | 'medium' | 'high'

export interface ReviewItem {
  id: string
  title: string
  operationType: string
  /** pending_operations.actor_type: user | api_key | mcp_oauth | cron. */
  actorType: string
  riskLevel: ReviewRiskLevel
  createdAt: string
}

export interface ClientReviewGroup extends ResolvedBureauClient {
  /** Risk-then-age sorted (high first, oldest first within a tier). */
  items: ReviewItem[]
  totalPending: number
  highRiskCount: number
  /** ISO timestamp of the oldest pending item (backlog-aging signal). */
  oldestCreatedAt: string
}

export interface BureauReviewData {
  eligibility: BureauEligibility
  /** Clients WITH pending items, most urgent first; null when ineligible. */
  groups: ClientReviewGroup[] | null
  totals: { items: number; highRisk: number; clients: number }
}

const RISK_RANK: Record<ReviewRiskLevel, number> = { high: 0, medium: 1, low: 2 }

function compareItems(a: ReviewItem, b: ReviewItem): number {
  const byRisk = RISK_RANK[a.riskLevel] - RISK_RANK[b.riskLevel]
  if (byRisk !== 0) return byRisk
  return a.createdAt.localeCompare(b.createdAt)
}

export function compareReviewGroups(a: ClientReviewGroup, b: ClientReviewGroup): number {
  const byHigh = b.highRiskCount - a.highRiskCount
  if (byHigh !== 0) return byHigh
  // Oldest backlog first: a silently aging queue is the failure mode
  // (the Bench lesson); recency must never hide it.
  const byAge = a.oldestCreatedAt.localeCompare(b.oldestCreatedAt)
  if (byAge !== 0) return byAge
  return b.totalPending - a.totalPending
}

interface PendingOpRow {
  id: string
  company_id: string
  title: string
  operation_type: string
  actor_type: string
  risk_level: string
  created_at: string
}

/**
 * All pending staged operations for the gated client set, grouped per
 * client. Practical volumes are small (pending ops resolve continuously);
 * a 1000-row cap per chunk bounds the pathological case, and the UI shows
 * per-client overflow counts. Soft-fails to empty groups.
 */
export async function getBulkPendingReview(
  service: SupabaseClient,
  clients: ResolvedBureauClient[],
): Promise<Map<string, ReviewItem[]>> {
  const byCompany = new Map<string, ReviewItem[]>()
  if (clients.length === 0) return byCompany

  try {
    const ids = clients.map((c) => c.companyId)
    for (let i = 0; i < ids.length; i += IN_CLAUSE_CHUNK) {
      const { data, error } = await service
        .from('pending_operations')
        .select('id, company_id, title, operation_type, actor_type, risk_level, created_at')
        .in('company_id', ids.slice(i, i + IN_CLAUSE_CHUNK))
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1000)
      if (error) throw new Error(error.message)
      for (const row of (data ?? []) as PendingOpRow[]) {
        const items = byCompany.get(row.company_id) ?? []
        items.push({
          id: row.id,
          title: row.title,
          operationType: row.operation_type,
          actorType: row.actor_type,
          riskLevel: (['low', 'medium', 'high'].includes(row.risk_level)
            ? row.risk_level
            : 'high') as ReviewRiskLevel,
          createdAt: row.created_at,
        })
        byCompany.set(row.company_id, items)
      }
    }
    for (const items of byCompany.values()) items.sort(compareItems)
  } catch (error) {
    log.error('bulk pending-review query failed', {
      reason: error instanceof Error ? error.message : String(error),
    })
    byCompany.clear()
  }

  return byCompany
}

/**
 * The composed firm review read: membership gate (user client, RLS on)
 * followed by the pending-operations aggregation (service client, filtered
 * to the gated set). Same security contract as getBureauPageData.
 */
export async function getBureauReviewData(
  supabase: SupabaseClient,
  service: SupabaseClient,
  userId: string,
): Promise<BureauReviewData> {
  const eligibility = await getBureauEligibility(supabase, userId)
  if (!eligibility.eligible) {
    return { eligibility, groups: null, totals: { items: 0, highRisk: 0, clients: 0 } }
  }

  const byCompany = await getBulkPendingReview(service, eligibility.clients)

  const groups: ClientReviewGroup[] = eligibility.clients
    .flatMap((client) => {
      const items = byCompany.get(client.companyId)
      if (!items || items.length === 0) return []
      return [
        {
          ...client,
          items,
          totalPending: items.length,
          highRiskCount: items.filter((i) => i.riskLevel === 'high').length,
          oldestCreatedAt: items.reduce(
            (oldest, i) => (i.createdAt < oldest ? i.createdAt : oldest),
            items[0].createdAt,
          ),
        },
      ]
    })
    .sort(compareReviewGroups)

  return {
    eligibility,
    groups,
    totals: {
      items: groups.reduce((sum, g) => sum + g.totalPending, 0),
      highRisk: groups.reduce((sum, g) => sum + g.highRiskCount, 0),
      clients: groups.length,
    },
  }
}
