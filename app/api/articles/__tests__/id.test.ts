/**
 * Tests for GET/PATCH/DELETE /api/articles/[id] (artikelregister).
 *
 * DELETE soft-deactivates (active = false) rather than hard-deleting, so the
 * article and its number survive for history. PATCH is a sparse update.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createQueuedMockSupabase, createMockRequest, createMockRouteParams, parseJsonResponse } from '@/tests/helpers'

const { supabase, enqueue, reset } = createQueuedMockSupabase()

const requireAuthMock = vi.fn()
vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: (...args: unknown[]) => requireAuthMock(...args),
}))

vi.mock('@/lib/company/context', () => ({
  getActiveCompanyId: vi.fn().mockResolvedValue('company-1'),
  requireCompanyId: vi.fn().mockResolvedValue('company-1'),
}))

const requireWriteMock = vi.fn()
vi.mock('@/lib/auth/require-write', () => ({
  requireWritePermission: (...args: unknown[]) => requireWriteMock(...args),
}))

vi.mock('@/lib/init', () => ({ ensureInitialized: vi.fn() }))

import { GET, PATCH, DELETE } from '../[id]/route'

describe('GET/PATCH/DELETE /api/articles/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
    requireAuthMock.mockResolvedValue({ user: { id: 'user-1' }, supabase })
    requireWriteMock.mockResolvedValue({ ok: true })
  })

  it('GET returns 404 when the article is not found', async () => {
    enqueue({ data: null, error: { code: 'PGRST116', message: 'not found' } })

    const response = await GET(createMockRequest('/api/articles/a1'), createMockRouteParams({ id: 'a1' }))
    const { status, body } = await parseJsonResponse<{ error: { code: string } }>(response)

    expect(status).toBe(404)
    expect(body.error.code).toBe('ARTICLE_NOT_FOUND')
  })

  it('PATCH updates a field and returns the row', async () => {
    enqueue({ data: { id: 'a1', name: 'Konsulttimme', price_excl_vat: 1500 } })

    const request = createMockRequest('/api/articles/a1', {
      method: 'PATCH',
      body: { price_excl_vat: 1500 },
    })

    const response = await PATCH(request, createMockRouteParams({ id: 'a1' }))
    const { status, body } = await parseJsonResponse<{ data: { price_excl_vat: number } }>(response)

    expect(status).toBe(200)
    expect(body.data.price_excl_vat).toBe(1500)
  })

  it('DELETE soft-deactivates and returns success', async () => {
    enqueue({ data: { id: 'a1', active: false } })

    const response = await DELETE(createMockRequest('/api/articles/a1', { method: 'DELETE' }), createMockRouteParams({ id: 'a1' }))
    const { status, body } = await parseJsonResponse<{ success: boolean }>(response)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
  })
})
