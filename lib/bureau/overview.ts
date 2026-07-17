import type { SupabaseClient } from '@supabase/supabase-js'
import { getWorklistCounts } from '@/lib/worklist'
import type { WorklistCounts } from '@/lib/worklist'
import { getSwedishLocalDate } from '@/lib/bookkeeping/engine'
import { getBureauEligibility, type BureauEligibility } from './gate'
import { getBulkNextDeadlines } from './deadlines'
import { getBulkPeriodStatus } from './period-status'
import { compareBureauClients } from './sort'
import type { BureauClientRow, BureauOverview, ResolvedBureauClient } from './types'

/**
 * Fan-out limits. Each client costs ~8-9 head-only PostgREST round-trips
 * (getWorklistCounts), so a roster render is bounded at roughly
 * MAX_FANOUT_CLIENTS * 9 requests spread over CONCURRENCY-wide waves.
 * Beyond the cap, rows still render (name, jump-in) but without counts.
 * The bureau_worklist_counts aggregate RPC is the planned replacement once
 * real firms cross ~25-30 clients; raise the cap only after it exists.
 */
export const MAX_FANOUT_CLIENTS = 60
const CONCURRENCY = 4
const PER_CLIENT_TIMEOUT_MS = 8_000
const GLOBAL_DEADLINE_MS = 20_000

export interface BureauFanoutOptions {
  concurrency?: number
  perClientTimeoutMs?: number
  globalDeadlineMs?: number
  /** ISO date override for tests; defaults to today in Europe/Stockholm. */
  today?: string
}

/**
 * Sliding-window concurrency pool: at most `limit` calls in flight, next item
 * starts as soon as any slot frees (no wave barrier, so one slow client does
 * not stall its neighbours).
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = nextIndex++
      if (index >= items.length) break
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * Race a promise against a timeout, resolving null on expiry (never
 * rejecting). getWorklistCounts soft-fails internally, so the only failure
 * mode left is a hung fetch: this hedge keeps one stuck client from holding
 * the whole page render open.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms)
      }),
    ])
  } catch {
    return null
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Cross-company aggregation for the roster. SECURITY CONTRACT: `clients`
 * must come from getBureauEligibility (the caller's own validated
 * memberships) and nowhere else: with the service client, this filter set is
 * the only tenant boundary. Call through getBureauPageData, which composes
 * gate and overview so the contract holds by construction.
 */
export async function getBureauOverview(
  service: SupabaseClient,
  clients: ResolvedBureauClient[],
  options: BureauFanoutOptions = {},
): Promise<BureauOverview> {
  const concurrency = options.concurrency ?? CONCURRENCY
  const perClientTimeoutMs = options.perClientTimeoutMs ?? PER_CLIENT_TIMEOUT_MS
  const globalDeadlineMs = options.globalDeadlineMs ?? GLOBAL_DEADLINE_MS
  const today = options.today ?? getSwedishLocalDate()

  const truncated = clients.length > MAX_FANOUT_CLIENTS
  // gate.ts returns clients name-sorted, so the cap is deterministic.
  const inScope = clients.slice(0, MAX_FANOUT_CLIENTS)
  const inScopeIds = inScope.map((c) => c.companyId)

  const deadlineAt = Date.now() + globalDeadlineMs
  const [worklists, deadlines, periods] = await Promise.all([
    mapWithConcurrency(inScopeIds, concurrency, async (companyId) => {
      const remaining = deadlineAt - Date.now()
      if (remaining <= 0) return null
      return withTimeout<WorklistCounts>(
        getWorklistCounts(service, companyId),
        Math.min(perClientTimeoutMs, remaining),
      )
    }),
    getBulkNextDeadlines(service, inScopeIds, today),
    getBulkPeriodStatus(service, inScopeIds, today),
  ])

  const worklistByCompany = new Map<string, WorklistCounts | null>()
  inScopeIds.forEach((id, i) => worklistByCompany.set(id, worklists[i]))

  const failedCompanyIds: string[] = []
  const rows: BureauClientRow[] = clients.map((client) => {
    const inFanout = worklistByCompany.has(client.companyId)
    const worklist = inFanout ? (worklistByCompany.get(client.companyId) ?? null) : null
    if (inFanout && worklist === null) failedCompanyIds.push(client.companyId)
    return {
      ...client,
      worklist,
      nextDeadline: deadlines.get(client.companyId) ?? null,
      periodStatus: periods.get(client.companyId) ?? null,
    }
  })

  rows.sort(compareBureauClients)

  return {
    clients: rows,
    failedCompanyIds,
    truncated,
    totals: {
      clients: rows.length,
      worklistTotal: rows.reduce((sum, row) => sum + (row.worklist?.total ?? 0), 0),
      overdueDeadlines: rows.filter((row) => row.nextDeadline?.isOverdue).length,
    },
  }
}

export interface BureauPageData {
  eligibility: BureauEligibility
  /** null when ineligible: the page renders the empty state instead. */
  overview: BureauOverview | null
}

/**
 * The composed cockpit read: membership gate (user client, RLS on) followed
 * by the aggregation (service client, filtered to the gated set). The only
 * public entry point for the /byra page.
 */
export async function getBureauPageData(
  supabase: SupabaseClient,
  service: SupabaseClient,
  userId: string,
  options: BureauFanoutOptions = {},
): Promise<BureauPageData> {
  const eligibility = await getBureauEligibility(supabase, userId)
  if (!eligibility.eligible) return { eligibility, overview: null }
  const overview = await getBureauOverview(service, eligibility.clients, options)
  return { eligibility, overview }
}
