import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createQueuedMockSupabase } from '@/tests/helpers'

vi.mock('../gate', () => ({ getBureauEligibility: vi.fn() }))
import { getBureauEligibility } from '../gate'
import { getBulkPendingReview, getBureauReviewData, compareReviewGroups } from '../review'
import type { ResolvedBureauClient } from '../types'

const mockGate = vi.mocked(getBureauEligibility)

function makeClient(companyId: string, name?: string): ResolvedBureauClient {
  return {
    companyId,
    name: name ?? `Company ${companyId}`,
    orgNumber: null,
    entityType: 'aktiebolag',
    role: 'admin',
  }
}

function makeOpRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'op-1',
    company_id: 'a',
    title: 'Kategorisera transaktion',
    operation_type: 'categorize_transaction',
    actor_type: 'api_key',
    risk_level: 'medium',
    created_at: '2026-07-15T10:00:00Z',
    ...overrides,
  }
}

describe('getBulkPendingReview', () => {
  let mock: ReturnType<typeof createQueuedMockSupabase>

  beforeEach(() => {
    vi.clearAllMocks()
    mock = createQueuedMockSupabase()
  })

  it('groups per company and sorts items risk-first then oldest-first', async () => {
    mock.enqueue({
      data: [
        makeOpRow({ id: 'op-low', risk_level: 'low', created_at: '2026-07-10T00:00:00Z' }),
        makeOpRow({ id: 'op-high', risk_level: 'high', created_at: '2026-07-16T00:00:00Z' }),
        makeOpRow({ id: 'op-med-old', risk_level: 'medium', created_at: '2026-07-01T00:00:00Z' }),
        makeOpRow({ id: 'op-b', company_id: 'b' }),
      ],
    })

    const result = await getBulkPendingReview(mock.supabase as unknown as SupabaseClient, [
      makeClient('a'),
      makeClient('b'),
    ])

    expect(result.get('a')?.map((i) => i.id)).toEqual(['op-high', 'op-med-old', 'op-low'])
    expect(result.get('b')).toHaveLength(1)
  })

  it('coerces unknown risk levels to high (fail-safe)', async () => {
    mock.enqueue({ data: [makeOpRow({ risk_level: 'weird' })] })
    const result = await getBulkPendingReview(mock.supabase as unknown as SupabaseClient, [
      makeClient('a'),
    ])
    expect(result.get('a')?.[0].riskLevel).toBe('high')
  })

  it('soft-fails to an empty map on query error', async () => {
    mock.enqueue({ data: null, error: { message: 'boom' } })
    const result = await getBulkPendingReview(mock.supabase as unknown as SupabaseClient, [
      makeClient('a'),
    ])
    expect(result.size).toBe(0)
  })

  it('skips the query for an empty client set', async () => {
    const result = await getBulkPendingReview(mock.supabase as unknown as SupabaseClient, [])
    expect(result.size).toBe(0)
    expect(mock.supabase.from).not.toHaveBeenCalled()
  })
})

describe('getBureauReviewData', () => {
  let mock: ReturnType<typeof createQueuedMockSupabase>

  beforeEach(() => {
    vi.clearAllMocks()
    mock = createQueuedMockSupabase()
  })

  it('returns null groups when ineligible', async () => {
    mockGate.mockResolvedValue({ eligible: false, clients: [] })
    const result = await getBureauReviewData(
      {} as SupabaseClient,
      mock.supabase as unknown as SupabaseClient,
      'user-1',
    )
    expect(result.groups).toBeNull()
    expect(mock.supabase.from).not.toHaveBeenCalled()
  })

  it('builds urgency-sorted groups with totals, dropping clean clients', async () => {
    mockGate.mockResolvedValue({
      eligible: true,
      clients: [makeClient('clean'), makeClient('busy'), makeClient('risky')],
    })
    mock.enqueue({
      data: [
        makeOpRow({ id: 'b1', company_id: 'busy' }),
        makeOpRow({ id: 'b2', company_id: 'busy', created_at: '2026-06-01T00:00:00Z' }),
        makeOpRow({ id: 'r1', company_id: 'risky', risk_level: 'high' }),
      ],
    })

    const result = await getBureauReviewData(
      {} as SupabaseClient,
      mock.supabase as unknown as SupabaseClient,
      'user-1',
    )

    expect(result.groups?.map((g) => g.companyId)).toEqual(['risky', 'busy'])
    expect(result.totals).toEqual({ items: 3, highRisk: 1, clients: 2 })
    expect(result.groups?.[1].oldestCreatedAt).toBe('2026-06-01T00:00:00Z')
  })
})

describe('compareReviewGroups', () => {
  it('ranks high-risk count, then oldest backlog, then volume', () => {
    const base = { ...makeClient('x'), items: [], totalPending: 1, highRiskCount: 0 }
    const risky = { ...base, companyId: 'risky', highRiskCount: 2, oldestCreatedAt: '2026-07-16' }
    const aged = { ...base, companyId: 'aged', oldestCreatedAt: '2026-05-01' }
    const busy = {
      ...base,
      companyId: 'busy',
      totalPending: 9,
      oldestCreatedAt: '2026-07-01',
    }
    const quiet = { ...base, companyId: 'quiet', oldestCreatedAt: '2026-07-01' }

    const sorted = [quiet, busy, aged, risky].sort(compareReviewGroups)
    expect(sorted.map((g) => g.companyId)).toEqual(['risky', 'aged', 'busy', 'quiet'])
  })
})
