import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const mockSupabase = {
  auth: { getUser: vi.fn() },
  from: vi.fn(),
  rpc: vi.fn(),
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => Promise.resolve(mockSupabase),
}))

vi.mock('@/lib/company/context', () => ({
  getActiveCompanyId: vi.fn().mockResolvedValue('company-1'),
}))

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: vi.fn(),
}))

// Deliberately NOT mocking @/lib/reports/vat-declaration: the test drives the
// real calculateVatDeclaration -> fetchVatAccountTotals path off the rpc mock,
// so the ruta assertions below prove the öre-exact projection end to end.

import { GET } from '../route'
import { requireAuth } from '@/lib/auth/require-auth'

const mockUser = { id: 'user-1', email: 'test@test.se' }

/** Wire payload as returned by the get_vat_declaration_totals RPC. */
function rpcPayload() {
  return {
    totals: [
      { account_number: '3001', debit: 0, credit: 100000 },
      { account_number: '2611', debit: 0, credit: 25000 },
      { account_number: '2641', debit: 3200, credit: 0 },
    ],
    settlement_shaped_entries: [],
    source_type_counts: { invoice_created: 2, bank_transaction: 3, manual: 1 },
  }
}

function makeRequest(query: string) {
  return new Request(`http://localhost/api/reports/vat-declaration${query}`)
}

describe('GET /api/reports/vat-declaration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue({
      user: mockUser as never,
      supabase: mockSupabase as never,
      error: null,
    })
    mockSupabase.rpc.mockResolvedValue({ data: rpcPayload(), error: null })
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      user: null as never,
      supabase: mockSupabase as never,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    })
    const res = await GET(
      makeRequest('?periodType=quarterly&year=2026&period=3'),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(401)
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it('returns 400 when required params are missing', async () => {
    const res = await GET(makeRequest(''), { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VAT_REPORT_MISSING_PARAMS')
  })

  it('returns 400 for an invalid periodType', async () => {
    const res = await GET(
      makeRequest('?periodType=weekly&year=2026&period=1'),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VAT_REPORT_INVALID_PERIOD_TYPE')
  })

  it('returns 400 for an invalid year', async () => {
    const res = await GET(
      makeRequest('?periodType=monthly&year=1999&period=1'),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VAT_REPORT_INVALID_YEAR')
  })

  it('returns 400 for out-of-range periods per period type', async () => {
    for (const query of [
      '?periodType=monthly&year=2026&period=13',
      '?periodType=quarterly&year=2026&period=5',
      '?periodType=yearly&year=2026&period=2',
    ]) {
      const res = await GET(makeRequest(query), { params: Promise.resolve({}) })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error.code).toBe('VAT_REPORT_INVALID_PERIOD')
    }
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it('happy path quarterly: öre-exact rutor from a single RPC round trip', async () => {
    const res = await GET(
      makeRequest('?periodType=quarterly&year=2026&period=3'),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.data.rutor.ruta05).toBe(100000)
    expect(body.data.rutor.ruta10).toBe(25000)
    expect(body.data.rutor.ruta48).toBe(3200)
    expect(body.data.rutor.ruta49).toBe(21800)
    expect(body.data.breakdown.invoices.base25).toBe(100000)
    expect(body.data.invoiceCount).toBe(2)
    expect(body.data.transactionCount).toBe(3)
    expect(body.data.periodLabel).toBe('Kvartal 3 2026')

    // Regression guard: the dead company_settings round trip is gone and
    // resolvePeriodDates makes no DB call for calendar quarters, so the
    // handler issues exactly one PostgREST call: the totals RPC.
    expect(mockSupabase.from).not.toHaveBeenCalled()
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(1)
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'get_vat_declaration_totals',
      expect.objectContaining({
        p_company_id: 'company-1',
        p_start: '2026-07-01',
        p_end: '2026-09-30',
      }),
    )
  })

  it('happy path monthly: no table queries, one RPC', async () => {
    const res = await GET(
      makeRequest('?periodType=monthly&year=2026&period=7'),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.rutor.ruta49).toBe(21800)
    expect(body.data.periodLabel).toBe('Juli 2026')

    expect(mockSupabase.from).not.toHaveBeenCalled()
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(1)
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'get_vat_declaration_totals',
      expect.objectContaining({ p_start: '2026-07-01', p_end: '2026-07-31' }),
    )
  })

  it('returns the VAT_REPORT_GENERATION_FAILED envelope when the RPC errors', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'connection reset' },
    })
    const res = await GET(
      makeRequest('?periodType=quarterly&year=2026&period=3'),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error.code).toBe('VAT_REPORT_GENERATION_FAILED')
  })
})
