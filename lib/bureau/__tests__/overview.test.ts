import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorklistCounts } from '@/lib/worklist'

vi.mock('@/lib/worklist', () => ({
  getWorklistCounts: vi.fn(),
}))
vi.mock('@/lib/bookkeeping/engine', () => ({
  getSwedishLocalDate: () => '2026-07-17',
}))
vi.mock('../gate', () => ({
  getBureauEligibility: vi.fn(),
}))
vi.mock('../deadlines', () => ({
  getBulkNextDeadlines: vi.fn(),
}))
vi.mock('../period-status', () => ({
  getBulkPeriodStatus: vi.fn(),
}))

import { getWorklistCounts } from '@/lib/worklist'
import { getBureauEligibility } from '../gate'
import { getBulkNextDeadlines } from '../deadlines'
import { getBulkPeriodStatus } from '../period-status'
import { getBureauOverview, getBureauPageData, MAX_FANOUT_CLIENTS } from '../overview'
import type { BureauDeadline, ResolvedBureauClient } from '../types'

const mockGetWorklistCounts = vi.mocked(getWorklistCounts)
const mockGetBureauEligibility = vi.mocked(getBureauEligibility)
const mockGetBulkNextDeadlines = vi.mocked(getBulkNextDeadlines)
const mockGetBulkPeriodStatus = vi.mocked(getBulkPeriodStatus)

const service = {} as SupabaseClient
const userClient = {} as SupabaseClient

function makeClient(companyId: string, name?: string): ResolvedBureauClient {
  return {
    companyId,
    name: name ?? `Company ${companyId}`,
    orgNumber: null,
    entityType: 'aktiebolag',
    role: 'admin',
  }
}

function makeCounts(total: number): WorklistCounts {
  return {
    counts: {
      book_transaction: total,
      inbox_document: 0,
      suggested_match: 0,
      supplier_invoice_approval: 0,
      verifikat_missing_document: 0,
      overdue_invoice: 0,
      deadline_action: 0,
      pending_operations: 0,
    },
    total,
  }
}

function makeDeadline(overrides: Partial<BureauDeadline> = {}): BureauDeadline {
  return {
    id: 'd-1',
    title: 'Momsdeklaration',
    dueDate: '2026-07-12',
    status: 'upcoming',
    isOverdue: false,
    taxDeadlineType: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetBulkNextDeadlines.mockResolvedValue(new Map())
  mockGetBulkPeriodStatus.mockResolvedValue(new Map())
  mockGetWorklistCounts.mockResolvedValue(makeCounts(0))
})

describe('getBureauOverview', () => {
  it('assembles rows from all three sources, sorted urgency-first, with totals', async () => {
    const clients = [makeClient('a'), makeClient('b'), makeClient('c')]
    mockGetWorklistCounts.mockImplementation(async (_s, companyId) => {
      if (companyId === 'a') return makeCounts(2)
      if (companyId === 'c') return makeCounts(5)
      return makeCounts(0)
    })
    mockGetBulkNextDeadlines.mockResolvedValue(
      new Map([['b', makeDeadline({ status: 'overdue', isOverdue: true, dueDate: '2026-07-01' })]]),
    )
    mockGetBulkPeriodStatus.mockResolvedValue(
      new Map([['a', { periodId: 'p-a', status: 'open' as const, lockedThrough: '2026-05-31' }]]),
    )

    const overview = await getBureauOverview(service, clients)

    expect(overview.clients.map((r) => r.companyId)).toEqual(['b', 'c', 'a'])
    expect(overview.clients[0].nextDeadline?.isOverdue).toBe(true)
    expect(overview.clients[2].periodStatus?.lockedThrough).toBe('2026-05-31')
    expect(overview.totals).toEqual({ clients: 3, worklistTotal: 7, overdueDeadlines: 1 })
    expect(overview.failedCompanyIds).toEqual([])
    expect(overview.truncated).toBe(false)
  })

  it('a hung client times out to null counts without breaking the others', async () => {
    const clients = [makeClient('hung'), makeClient('ok')]
    mockGetWorklistCounts.mockImplementation((_s, companyId) => {
      if (companyId === 'hung') return new Promise<WorklistCounts>(() => {})
      return Promise.resolve(makeCounts(3))
    })

    const overview = await getBureauOverview(service, clients, { perClientTimeoutMs: 25 })

    const hung = overview.clients.find((r) => r.companyId === 'hung')
    const ok = overview.clients.find((r) => r.companyId === 'ok')
    expect(hung?.worklist).toBeNull()
    expect(ok?.worklist?.total).toBe(3)
    expect(overview.failedCompanyIds).toEqual(['hung'])
    // Failed rows sink below resolved ones.
    expect(overview.clients[0].companyId).toBe('ok')
  })

  it('never exceeds the concurrency limit', async () => {
    const clients = Array.from({ length: 9 }, (_, i) => makeClient(`c-${i}`))
    let inFlight = 0
    let maxInFlight = 0
    mockGetWorklistCounts.mockImplementation(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 10))
      inFlight -= 1
      return makeCounts(1)
    })

    await getBureauOverview(service, clients, { concurrency: 3 })

    expect(maxInFlight).toBe(3)
    expect(mockGetWorklistCounts).toHaveBeenCalledTimes(9)
  })

  it('truncates deterministically beyond MAX_FANOUT_CLIENTS', async () => {
    const clients = Array.from({ length: MAX_FANOUT_CLIENTS + 1 }, (_, i) =>
      makeClient(`c-${String(i).padStart(3, '0')}`),
    )

    const overview = await getBureauOverview(service, clients)

    expect(overview.truncated).toBe(true)
    expect(mockGetWorklistCounts).toHaveBeenCalledTimes(MAX_FANOUT_CLIENTS)
    // The client beyond the cap keeps its row but has no counts and is not a failure.
    const beyondCap = overview.clients.find(
      (r) => r.companyId === `c-${String(MAX_FANOUT_CLIENTS).padStart(3, '0')}`,
    )
    expect(beyondCap?.worklist).toBeNull()
    expect(overview.failedCompanyIds).toEqual([])
  })

  it('an exhausted global deadline nulls remaining clients without calling the fan-out', async () => {
    const clients = [makeClient('a'), makeClient('b')]

    const overview = await getBureauOverview(service, clients, { globalDeadlineMs: 0 })

    expect(mockGetWorklistCounts).not.toHaveBeenCalled()
    expect(overview.clients.every((r) => r.worklist === null)).toBe(true)
    expect(overview.failedCompanyIds.sort()).toEqual(['a', 'b'])
  })
})

describe('getBureauPageData', () => {
  it('returns a null overview when the gate says ineligible', async () => {
    mockGetBureauEligibility.mockResolvedValue({ eligible: false, clients: [] })

    const result = await getBureauPageData(userClient, service, 'user-1')

    expect(mockGetBureauEligibility).toHaveBeenCalledWith(userClient, 'user-1')
    expect(result.overview).toBeNull()
    expect(mockGetWorklistCounts).not.toHaveBeenCalled()
  })

  it('runs the aggregation over exactly the gated client set', async () => {
    const clients = [makeClient('a'), makeClient('b')]
    mockGetBureauEligibility.mockResolvedValue({ eligible: true, clients })

    const result = await getBureauPageData(userClient, service, 'user-1')

    expect(result.overview?.totals.clients).toBe(2)
    expect(mockGetWorklistCounts).toHaveBeenCalledTimes(2)
    expect(mockGetWorklistCounts).toHaveBeenCalledWith(service, 'a')
    expect(mockGetWorklistCounts).toHaveBeenCalledWith(service, 'b')
  })
})
