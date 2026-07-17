import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createQueuedMockSupabase } from '@/tests/helpers'
import { getBureauEligibility } from '../gate'

function makeMembershipRow(overrides: {
  companyId: string
  name?: string
  role?: string
  archivedAt?: string | null
  orgNumber?: string | null
}) {
  return {
    id: `member-${overrides.companyId}`,
    company_id: overrides.companyId,
    role: overrides.role ?? 'admin',
    joined_at: '2026-01-01T00:00:00Z',
    companies: {
      id: overrides.companyId,
      name: overrides.name ?? `Company ${overrides.companyId}`,
      org_number: overrides.orgNumber ?? null,
      entity_type: 'aktiebolag',
      archived_at: overrides.archivedAt ?? null,
      created_at: '2026-01-01T00:00:00Z',
    },
  }
}

describe('getBureauEligibility', () => {
  let mock: ReturnType<typeof createQueuedMockSupabase>

  beforeEach(() => {
    vi.clearAllMocks()
    mock = createQueuedMockSupabase()
  })

  function run() {
    return getBureauEligibility(mock.supabase as unknown as SupabaseClient, 'user-1')
  }

  it('a single live company is not eligible but still resolves the client', async () => {
    mock.enqueue({ data: [makeMembershipRow({ companyId: 'a' })] })
    mock.enqueue({ data: [] }) // settings

    const result = await run()
    expect(result.eligible).toBe(false)
    expect(result.clients).toHaveLength(1)
  })

  it('archived companies are dropped before the threshold', async () => {
    mock.enqueue({
      data: [
        makeMembershipRow({ companyId: 'a' }),
        makeMembershipRow({ companyId: 'b', archivedAt: '2026-06-01T00:00:00Z' }),
      ],
    })
    mock.enqueue({ data: [] })

    const result = await run()
    expect(result.eligible).toBe(false)
    expect(result.clients.map((c) => c.companyId)).toEqual(['a'])
  })

  it('sandbox companies are dropped via company_settings', async () => {
    mock.enqueue({
      data: [
        makeMembershipRow({ companyId: 'a', name: 'Alfa AB' }),
        makeMembershipRow({ companyId: 'b', name: 'Beta AB' }),
        makeMembershipRow({ companyId: 'sandbox', name: 'Sandbox AB' }),
      ],
    })
    mock.enqueue({
      data: [
        { company_id: 'sandbox', is_sandbox: true, company_name: null },
        { company_id: 'a', is_sandbox: false, company_name: null },
      ],
    })

    const result = await run()
    expect(result.eligible).toBe(true)
    expect(result.clients.map((c) => c.companyId)).toEqual(['a', 'b'])
  })

  it('prefers company_settings.company_name, keeps role, sorts by Swedish name', async () => {
    mock.enqueue({
      data: [
        makeMembershipRow({ companyId: 'a', name: 'Stale Name AB', role: 'viewer' }),
        makeMembershipRow({ companyId: 'b', name: 'Beta AB', role: 'owner' }),
      ],
    })
    mock.enqueue({
      data: [{ company_id: 'a', is_sandbox: false, company_name: 'Ängen Redovisning AB' }],
    })

    const result = await run()
    // sv locale: Ä sorts after Z, so Beta first.
    expect(result.clients.map((c) => c.name)).toEqual(['Beta AB', 'Ängen Redovisning AB'])
    expect(result.clients[1]).toMatchObject({ companyId: 'a', role: 'viewer' })
    expect(result.clients[0]).toMatchObject({ companyId: 'b', role: 'owner' })
  })

  it('soft-fails to ineligible on a membership query error', async () => {
    mock.enqueue({ data: null, error: { message: 'boom' } })

    const result = await run()
    expect(result).toEqual({ eligible: false, clients: [] })
  })

  it('soft-fails to ineligible on a settings query error', async () => {
    mock.enqueue({
      data: [makeMembershipRow({ companyId: 'a' }), makeMembershipRow({ companyId: 'b' })],
    })
    mock.enqueue({ data: null, error: { message: 'boom' } })

    const result = await run()
    expect(result).toEqual({ eligible: false, clients: [] })
  })
})
