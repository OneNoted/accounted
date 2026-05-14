import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/lib/company/context', () => ({
  requireCompanyId: vi.fn().mockResolvedValue('company-1'),
}))
vi.mock('@/lib/auth/require-write', () => ({
  requireWritePermission: vi.fn().mockResolvedValue({ ok: true }),
}))

import { createClient } from '@/lib/supabase/server'
import { PATCH } from '../route'

function createMockRequest(body: unknown): Request {
  return new Request('http://localhost/api/bookkeeping/fiscal-periods/period-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function mockRouteParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

/**
 * Mocks the chain of supabase calls the PATCH route makes:
 *   1. from('fiscal_periods').select('*').eq.eq.single()        → existing period
 *   2. from('journal_entries').select(count, head).eq.eq.in()   → posted entry count
 *   3. from('fiscal_periods').select(count, head).eq.neq.lt()   → earlier-period count
 *   4. from('companies').select('entity_type').eq.single()      → entity type
 *   5. from('fiscal_periods').select('id, name').eq.neq.lte.gte.limit() → overlap
 *   6. from('fiscal_periods').update().eq.eq.select.single()    → updated row
 */
function buildMockSupabase(options: {
  period: { id: string; period_start: string; period_end: string; locked_at: string | null; is_closed: boolean }
  entityType: 'aktiebolag' | 'enskild_firma'
  postedEntryCount?: number
  earlierPeriodCount?: number
  overlapping?: Array<{ id: string; name: string }>
}) {
  const {
    period,
    entityType,
    postedEntryCount = 0,
    earlierPeriodCount = 0,
    overlapping = [],
  } = options

  let fiscalPeriodsCall = 0

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'journal_entries') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ count: postedEntryCount, error: null }),
              }),
            }),
          }),
        }
      }

      if (table === 'companies') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { entity_type: entityType }, error: null }),
            }),
          }),
        }
      }

      if (table === 'fiscal_periods') {
        fiscalPeriodsCall++
        const callNum = fiscalPeriodsCall

        return {
          // First call: fetch the period (.select('*').eq.eq.single())
          // Second call: count earlier periods (.select('id', count/head).eq.neq.lt())
          // Third call: overlap check (.select('id, name').eq.neq.lte.gte.limit())
          select: vi.fn().mockImplementation((_sel: string, opts?: { count?: string; head?: boolean }) => {
            if (callNum === 1) {
              return {
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({ data: period, error: null }),
                  }),
                }),
              }
            }
            if (opts?.head) {
              // earlier-period count
              return {
                eq: vi.fn().mockReturnValue({
                  neq: vi.fn().mockReturnValue({
                    lt: vi.fn().mockResolvedValue({ count: earlierPeriodCount, error: null }),
                  }),
                }),
              }
            }
            // overlap check
            return {
              eq: vi.fn().mockReturnValue({
                neq: vi.fn().mockReturnValue({
                  lte: vi.fn().mockReturnValue({
                    gte: vi.fn().mockReturnValue({
                      limit: vi.fn().mockResolvedValue({ data: overlapping, error: null }),
                    }),
                  }),
                }),
              }),
            }
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { ...period, ...{} },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }
      }

      return {}
    }),
  }

  ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase)
  return supabase
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PATCH /api/bookkeeping/fiscal-periods/[id] — enskild firma', () => {
  it('allows förlängt räkenskapsår (15 mån, 4 okt 2020 → 31 dec 2021) on the first period', async () => {
    buildMockSupabase({
      period: { id: 'p1', period_start: '2020-01-01', period_end: '2020-12-31', locked_at: null, is_closed: false },
      entityType: 'enskild_firma',
      earlierPeriodCount: 0,
    })
    const req = createMockRequest({ period_start: '2020-10-04', period_end: '2021-12-31' })
    const res = await PATCH(req, mockRouteParams('p1'))
    expect(res.status).toBe(200)
  })

  it('rejects EF first period when slutdatum is not 31 december', async () => {
    buildMockSupabase({
      period: { id: 'p1', period_start: '2020-01-01', period_end: '2020-12-31', locked_at: null, is_closed: false },
      entityType: 'enskild_firma',
      earlierPeriodCount: 0,
    })
    const req = createMockRequest({ period_start: '2020-10-04', period_end: '2021-11-30' })
    const res = await PATCH(req, mockRouteParams('p1'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/31 december/)
  })

  it('rejects EF subsequent period with mid-month startdatum', async () => {
    buildMockSupabase({
      period: { id: 'p2', period_start: '2026-01-01', period_end: '2026-12-31', locked_at: null, is_closed: false },
      entityType: 'enskild_firma',
      earlierPeriodCount: 1,
    })
    const req = createMockRequest({ period_start: '2026-02-01', period_end: '2026-12-31' })
    const res = await PATCH(req, mockRouteParams('p2'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/kalenderår/)
  })

  it('accepts EF subsequent period running 1 jan – 31 dec', async () => {
    buildMockSupabase({
      period: { id: 'p2', period_start: '2026-01-01', period_end: '2026-12-31', locked_at: null, is_closed: false },
      entityType: 'enskild_firma',
      earlierPeriodCount: 1,
    })
    const req = createMockRequest({ period_start: '2026-01-01', period_end: '2026-12-31' })
    const res = await PATCH(req, mockRouteParams('p2'))
    expect(res.status).toBe(200)
  })
})
