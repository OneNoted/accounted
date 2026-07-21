import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { createMockRequest, createMockRouteParams } from '@/tests/helpers'

const requireAuthMock = vi.fn()
vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: (...args: unknown[]) => requireAuthMock(...args),
}))

vi.mock('@/lib/company/context', () => ({
  getActiveCompanyId: vi.fn().mockResolvedValue('company-1'),
  requireCompanyId: vi.fn().mockResolvedValue('company-1'),
}))

import { GET } from '../route'

interface SupabaseShape {
  from: ReturnType<typeof vi.fn>
  rpc: ReturnType<typeof vi.fn>
}

function buildSupabase(
  linesResult: { data: unknown; error: unknown }
): SupabaseShape {
  return {
    rpc: vi.fn().mockResolvedValue(linesResult),
    from: vi.fn().mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      range: vi.fn().mockResolvedValue(linesResult),
      then: (resolve: (v: unknown) => void) => resolve(linesResult),
    })),
  }
}

function authOk(supabase: SupabaseShape) {
  requireAuthMock.mockResolvedValue({ user: { id: 'user-1' }, supabase, error: null })
}

function authFail(supabase: SupabaseShape) {
  requireAuthMock.mockResolvedValue({
    user: null,
    supabase,
    error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/reports/vat-declaration/ruta/[ruta]/sources', () => {
  it('returns 401 when not authenticated', async () => {
    authFail(buildSupabase({ data: [], error: null }))
    const req = createMockRequest(
      '/api/reports/vat-declaration/ruta/10/sources',
      { searchParams: { periodType: 'monthly', year: '2026', period: '5' } }
    )
    const res = await GET(req, createMockRouteParams({ ruta: '10' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when period params are missing', async () => {
    authOk(buildSupabase({ data: [], error: null }))
    const req = createMockRequest(
      '/api/reports/vat-declaration/ruta/10/sources'
    )
    const res = await GET(req, createMockRouteParams({ ruta: '10' }))
    expect(res.status).toBe(400)
  })

  it('returns 404 when ruta has no underlying BAS accounts', async () => {
    authOk(buildSupabase({ data: [], error: null }))
    const req = createMockRequest(
      '/api/reports/vat-declaration/ruta/99/sources',
      { searchParams: { periodType: 'monthly', year: '2026', period: '5' } }
    )
    const res = await GET(req, createMockRouteParams({ ruta: '99' }))
    expect(res.status).toBe(404)
  })

  it('happy path: returns mapped lines for ruta10', async () => {
    const linesData = [
      {
        line_id: 'line-1',
        journal_entry_id: 'je-1',
        voucher_number: 12,
        voucher_series: 'A',
        entry_date: '2026-05-12',
        description: 'Faktura 1001',
        debit_amount: 0,
        credit_amount: 250,
      },
    ]
    authOk(buildSupabase({ data: linesData, error: null }))

    const req = createMockRequest(
      '/api/reports/vat-declaration/ruta/10/sources',
      { searchParams: { periodType: 'monthly', year: '2026', period: '5' } }
    )
    const res = await GET(req, createMockRouteParams({ ruta: '10' }))
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      data: {
        ruta: string
        lines: Array<{ voucher_number: number; credit: number }>
      }
    }

    expect(body.data.ruta).toBe('ruta10')
    expect(body.data.lines).toHaveLength(1)
    expect(body.data.lines[0].voucher_number).toBe(12)
    expect(body.data.lines[0].credit).toBe(250)
  })

  it('returns 400 when the cursor date component is not a structural ISO date', async () => {
    // Defense-in-depth (ASVS V1.2): the cursor is applied in JS, but a
    // malformed date component must still be rejected structurally.
    authOk(buildSupabase({ data: [], error: null }))
    const req = createMockRequest(
      '/api/reports/vat-declaration/ruta/10/sources',
      {
        searchParams: {
          periodType: 'monthly',
          year: '2026',
          period: '5',
          cursor: 'notadate|5',
        },
      }
    )
    const res = await GET(req, createMockRouteParams({ ruta: '10' }))
    expect(res.status).toBe(400)
  })

  it('preserves the stable chronological order returned by the paged RPC', async () => {
    const linesData = [
      {
        line_id: 'line-early',
        journal_entry_id: 'je-early',
        voucher_number: 4,
        voucher_series: 'A',
        entry_date: '2026-05-02',
        description: 'Early',
        debit_amount: 0,
        credit_amount: 100,
      },
      {
        line_id: 'line-mid',
        journal_entry_id: 'je-mid',
        voucher_number: 18,
        voucher_series: 'A',
        entry_date: '2026-05-11',
        description: 'Mid',
        debit_amount: 0,
        credit_amount: 250,
      },
      {
        line_id: 'line-late',
        journal_entry_id: 'je-late',
        voucher_number: 30,
        voucher_series: 'A',
        entry_date: '2026-05-20',
        description: 'Late',
        debit_amount: 0,
        credit_amount: 500,
      },
    ]
    authOk(buildSupabase({ data: linesData, error: null }))

    const req = createMockRequest(
      '/api/reports/vat-declaration/ruta/10/sources',
      { searchParams: { periodType: 'monthly', year: '2026', period: '5' } }
    )
    const res = await GET(req, createMockRouteParams({ ruta: '10' }))
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      data: { lines: Array<{ journal_entry_id: string }> }
    }

    expect(body.data.lines.map((l) => l.journal_entry_id)).toEqual([
      'je-early',
      'je-mid',
      'je-late',
    ])
  })
})
