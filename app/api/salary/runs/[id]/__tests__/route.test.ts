import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createQueuedMockSupabase,
  createMockRequest,
  parseJsonResponse,
  createMockRouteParams,
} from '@/tests/helpers'

// ── Mocks ────────────────────────────────────────────────────

const mockCreateClient = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockCreateClient(),
}))

vi.mock('@/lib/init', () => ({
  ensureInitialized: vi.fn(),
}))

vi.mock('@/lib/auth/require-write', () => ({
  requireWritePermission: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('@/lib/company/context', () => ({
  requireCompanyId: vi.fn().mockResolvedValue('company-1'),
}))

import { DELETE } from '../route'

// ── Test data ────────────────────────────────────────────────

const mockUser = { id: 'user-1', email: 'test@test.se' }

// ── Tests ────────────────────────────────────────────────────

describe('DELETE /api/salary/runs/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    })

    const request = createMockRequest('/api/salary/runs/run-1', { method: 'DELETE' })
    const response = await DELETE(request, createMockRouteParams({ id: 'run-1' }))
    const { status, body } = await parseJsonResponse(response)

    expect(status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('returns 404 when salary run not found', async () => {
    const { supabase, enqueueMany } = createQueuedMockSupabase()
    supabase.auth = { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) }
    mockCreateClient.mockResolvedValue(supabase)

    enqueueMany([
      { data: null, error: { message: 'Not found' } }, // salary_runs lookup
    ])

    const request = createMockRequest('/api/salary/runs/run-1', { method: 'DELETE' })
    const response = await DELETE(request, createMockRouteParams({ id: 'run-1' }))
    const { status, body } = await parseJsonResponse<{ error: string }>(response)

    expect(status).toBe(404)
    expect(body.error).toContain('hittades inte')
  })

  it('returns 400 when the run is not a draft (booked must be storno-reversed)', async () => {
    const { supabase, enqueueMany } = createQueuedMockSupabase()
    supabase.auth = { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) }
    mockCreateClient.mockResolvedValue(supabase)

    enqueueMany([
      { data: { id: 'run-1', status: 'booked' } }, // salary_runs lookup
    ])

    const request = createMockRequest('/api/salary/runs/run-1', { method: 'DELETE' })
    const response = await DELETE(request, createMockRouteParams({ id: 'run-1' }))
    const { status, body } = await parseJsonResponse<{ error: string }>(response)

    expect(status).toBe(400)
    expect(body.error).toContain('utkast')
  })

  it('deletes a draft run and returns success', async () => {
    const { supabase, enqueueMany } = createQueuedMockSupabase()
    supabase.auth = { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) }
    mockCreateClient.mockResolvedValue(supabase)

    enqueueMany([
      { data: { id: 'run-1', status: 'draft' } }, // salary_runs lookup
      { data: null },                              // salary_runs delete (cascade handles children)
    ])

    const request = createMockRequest('/api/salary/runs/run-1', { method: 'DELETE' })
    const response = await DELETE(request, createMockRouteParams({ id: 'run-1' }))
    const { status, body } = await parseJsonResponse<{ data: { id: string; deleted: boolean } }>(response)

    expect(status).toBe(200)
    expect(body.data).toEqual({ id: 'run-1', deleted: true })
  })
})
