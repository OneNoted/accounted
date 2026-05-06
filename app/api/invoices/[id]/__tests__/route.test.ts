import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createMockRequest,
  createMockRouteParams,
  parseJsonResponse,
  createQueuedMockSupabase,
} from '@/tests/helpers'

const { supabase: mockSupabase, enqueue, reset } = createQueuedMockSupabase()
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => Promise.resolve(mockSupabase),
}))

vi.mock('@/lib/company/context', () => ({
  requireCompanyId: vi.fn().mockResolvedValue('company-1'),
}))

vi.mock('@/lib/auth/require-write', () => ({
  requireWritePermission: vi.fn().mockResolvedValue({ ok: true }),
}))

import { DELETE } from '../route'

describe('DELETE /api/invoices/[id]', () => {
  const mockUser = { id: 'user-1', email: 'test@test.se' }

  beforeEach(() => {
    vi.clearAllMocks()
    reset()
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser } })
  })

  it('returns 401 when not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

    const response = await DELETE(
      createMockRequest('/api/invoices/inv-1', { method: 'DELETE' }),
      createMockRouteParams({ id: 'inv-1' })
    )
    const { status, body } = await parseJsonResponse<{ error: string }>(response)

    expect(status).toBe(401)
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 404 when invoice not found', async () => {
    enqueue({ data: null, error: { message: 'not found' } })

    const response = await DELETE(
      createMockRequest('/api/invoices/inv-1', { method: 'DELETE' }),
      createMockRouteParams({ id: 'inv-1' })
    )
    const { status } = await parseJsonResponse(response)

    expect(status).toBe(404)
  })

  it('rejects deletion of a non-draft invoice with INVOICE_DELETE_NOT_DRAFT', async () => {
    enqueue({
      data: { id: 'inv-1', status: 'sent', invoice_number: 'F-2026099', user_id: 'user-1' },
      error: null,
    })

    const response = await DELETE(
      createMockRequest('/api/invoices/inv-1', { method: 'DELETE' }),
      createMockRouteParams({ id: 'inv-1' })
    )
    const { status, body } = await parseJsonResponse<{ error: { code: string } }>(response)

    expect(status).toBe(400)
    expect(body.error.code).toBe('INVOICE_DELETE_NOT_DRAFT')
  })

  it('rejects deletion of a draft that already has an invoice_number', async () => {
    enqueue({
      data: { id: 'inv-1', status: 'draft', invoice_number: 'F-2026001', user_id: 'user-1' },
      error: null,
    })

    const response = await DELETE(
      createMockRequest('/api/invoices/inv-1', { method: 'DELETE' }),
      createMockRouteParams({ id: 'inv-1' })
    )
    const { status, body } = await parseJsonResponse<{
      error: { code: string; details?: { invoice_number?: string } }
    }>(response)

    expect(status).toBe(400)
    expect(body.error.code).toBe('INVOICE_DELETE_NUMBERED')
    expect(body.error.details?.invoice_number).toBe('F-2026001')
  })

  it('deletes a draft with no invoice_number', async () => {
    enqueue({
      data: { id: 'inv-1', status: 'draft', invoice_number: null, user_id: 'user-1' },
      error: null,
    })
    enqueue({ data: null, error: null })
    enqueue({ data: null, error: null })

    const response = await DELETE(
      createMockRequest('/api/invoices/inv-1', { method: 'DELETE' }),
      createMockRouteParams({ id: 'inv-1' })
    )
    const { status, body } = await parseJsonResponse<{ data: { deleted: boolean } }>(response)

    expect(status).toBe(200)
    expect(body.data.deleted).toBe(true)
  })

  it('returns 500 when items delete fails', async () => {
    enqueue({
      data: { id: 'inv-1', status: 'draft', invoice_number: null, user_id: 'user-1' },
      error: null,
    })
    enqueue({ data: null, error: { message: 'items delete failed' } })

    const response = await DELETE(
      createMockRequest('/api/invoices/inv-1', { method: 'DELETE' }),
      createMockRouteParams({ id: 'inv-1' })
    )
    const { status } = await parseJsonResponse(response)

    expect(status).toBe(500)
  })
})
