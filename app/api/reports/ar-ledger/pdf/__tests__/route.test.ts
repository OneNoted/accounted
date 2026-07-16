import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const mockSupabase = {
  auth: { getUser: vi.fn() },
  from: vi.fn(),
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

// Stub the PDF renderer so the test never spins up real PDF layout. Provide the
// primitives the template imports at module load (StyleSheet.create runs then).
vi.mock('@react-pdf/renderer', () => ({
  renderToBuffer: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test')),
  StyleSheet: { create: (s: unknown) => s },
  Document: (p: unknown) => p,
  Page: (p: unknown) => p,
  Text: (p: unknown) => p,
  View: (p: unknown) => p,
}))

vi.mock('@/lib/reports/ar-ledger', () => ({
  generateARLedger: vi.fn(),
}))

import { GET } from '../route'
import { requireAuth } from '@/lib/auth/require-auth'
import { generateARLedger } from '@/lib/reports/ar-ledger'

const mockUser = { id: 'user-1', email: 'test@test.se' }

function companySettingsQuery(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error: null }),
  }
}

function makeLedger() {
  return {
    entries: [
      {
        customer_id: 'cust-1',
        customer_name: 'Acme AB',
        invoices: [
          {
            invoice_id: 'inv-1',
            invoice_number: 'F001',
            invoice_date: '2026-05-01',
            due_date: '2026-06-01',
            total: 1000,
            paid_amount: 0,
            outstanding: 1000,
            outstanding_sek: 1000,
            days_overdue: 14,
            currency: 'SEK',
          },
        ],
        current: 0,
        days_1_30: 1000,
        days_31_60: 0,
        days_61_90: 0,
        days_90_plus: 0,
        total_outstanding: 1000,
      },
    ],
    total_outstanding: 1000,
    total_current: 0,
    total_overdue: 1000,
    unpaid_count: 1,
    unconverted_fx_count: 0,
  }
}

function makeRequest(query = '') {
  return new Request(`http://localhost/api/reports/ar-ledger/pdf${query}`)
}

describe('GET /api/reports/ar-ledger/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue({
      user: mockUser as never,
      supabase: mockSupabase as never,
      error: null,
    })
    mockSupabase.from.mockReturnValue(
      companySettingsQuery({ company_name: 'Testbolaget AB', org_number: '5566778899' }),
    )
    vi.mocked(generateARLedger).mockResolvedValue(makeLedger() as never)
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      user: null as never,
      supabase: mockSupabase as never,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    })

    const res = await GET(makeRequest(), { params: Promise.resolve({}) } as never)
    expect(res.status).toBe(401)
  })

  it('returns 400 for a malformed as_of_date', async () => {
    const res = await GET(makeRequest('?as_of_date=not-a-date'), { params: Promise.resolve({}) } as never)
    expect(res.status).toBe(400)
    expect(generateARLedger).not.toHaveBeenCalled()
  })

  it('returns 404 when company settings are missing', async () => {
    mockSupabase.from.mockReturnValue(companySettingsQuery(null))

    const res = await GET(makeRequest('?as_of_date=2026-06-30'), { params: Promise.resolve({}) } as never)
    expect(res.status).toBe(404)
  })

  it('renders a PDF for the requested as-of date', async () => {
    const res = await GET(makeRequest('?as_of_date=2026-06-30'), { params: Promise.resolve({}) } as never)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toContain('kundreskontra')
    expect(res.headers.get('Content-Disposition')).toContain('20260630')
    expect(generateARLedger).toHaveBeenCalledWith(mockSupabase, 'company-1', '2026-06-30')
  })

  it('defaults to today when no as_of_date is given', async () => {
    const res = await GET(makeRequest(), { params: Promise.resolve({}) } as never)

    expect(res.status).toBe(200)
    const calledWith = vi.mocked(generateARLedger).mock.calls[0][2]
    expect(calledWith).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('returns 500 when the generator throws', async () => {
    vi.mocked(generateARLedger).mockRejectedValue(new Error('boom'))

    const res = await GET(makeRequest('?as_of_date=2026-06-30'), { params: Promise.resolve({}) } as never)
    expect(res.status).toBe(500)
  })
})
