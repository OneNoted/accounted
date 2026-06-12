import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/cron', () => ({
  verifyCronSecret: vi.fn(() => null),
}))

vi.mock('@/lib/init', () => ({
  ensureInitialized: vi.fn(),
}))

let installmentsResult: { data: unknown; error: unknown } = { data: [], error: null }

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => {
      const chain: Record<string, unknown> = {}
      chain.select = vi.fn(() => chain)
      chain.eq = vi.fn(() => chain)
      chain.lte = vi.fn(() => chain)
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(installmentsResult).then(resolve)
      return chain
    }),
  })),
}))

const mockPostDueInstallments = vi.fn()
vi.mock('@/lib/bookkeeping/accruals/service', () => ({
  postDueInstallments: (...args: unknown[]) => mockPostDueInstallments(...args),
}))

import { GET } from '../route'

function cronRequest(): Request {
  return new Request('http://localhost:3000/api/bookkeeping/accruals/post-due/cron')
}

beforeEach(() => {
  vi.clearAllMocks()
  installmentsResult = { data: [], error: null }
})

describe('GET /api/bookkeeping/accruals/post-due/cron', () => {
  it('runs once per distinct company and aggregates results', async () => {
    installmentsResult = {
      data: [
        { company_id: 'company-1' },
        { company_id: 'company-1' },
        { company_id: 'company-2' },
      ],
      error: null,
    }
    mockPostDueInstallments
      .mockResolvedValueOnce({ posted: 2, failed: 0, skipped: 0, errors: [] })
      .mockResolvedValueOnce({ posted: 1, failed: 0, skipped: 0, errors: [] })

    const response = await GET(cronRequest())
    const json = await response.json()

    expect(mockPostDueInstallments).toHaveBeenCalledTimes(2)
    expect(mockPostDueInstallments.mock.calls.map((c) => c[1])).toEqual([
      'company-1',
      'company-2',
    ])
    expect(json.success).toBe(true)
    expect(json.total).toBe(2)
    expect(json.succeeded).toBe(2)
    expect(json.results).toEqual([
      { companyId: 'company-1', posted: 2, failed: 0, skipped: 0 },
      { companyId: 'company-2', posted: 1, failed: 0, skipped: 0 },
    ])
  })

  it('isolates a failing company so the rest still run', async () => {
    installmentsResult = {
      data: [{ company_id: 'company-1' }, { company_id: 'company-2' }],
      error: null,
    }
    mockPostDueInstallments
      .mockRejectedValueOnce(new Error('database exploded'))
      .mockResolvedValueOnce({ posted: 1, failed: 0, skipped: 0, errors: [] })

    const response = await GET(cronRequest())
    const json = await response.json()

    expect(json.success).toBe(true)
    expect(json.succeeded).toBe(1)
    expect(json.failed).toBe(1)
    expect(json.failures).toEqual([{ index: 0, error: 'database exploded' }])
    expect(mockPostDueInstallments).toHaveBeenCalledTimes(2)
  })

  it('returns 500 when the due query fails', async () => {
    installmentsResult = { data: null, error: { message: 'boom' } }

    const response = await GET(cronRequest())

    expect(response.status).toBe(500)
    expect(mockPostDueInstallments).not.toHaveBeenCalled()
  })

  it('rejects unauthorized callers', async () => {
    const { verifyCronSecret } = await import('@/lib/auth/cron')
    const { NextResponse } = await import('next/server')
    vi.mocked(verifyCronSecret).mockReturnValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    )

    const response = await GET(cronRequest())

    expect(response.status).toBe(401)
    expect(mockPostDueInstallments).not.toHaveBeenCalled()
  })
})
