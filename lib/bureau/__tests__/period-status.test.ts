import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createQueuedMockSupabase } from '@/tests/helpers'
import { getBulkPeriodStatus } from '../period-status'

const TODAY = '2026-07-17'

describe('getBulkPeriodStatus', () => {
  let mock: ReturnType<typeof createQueuedMockSupabase>

  beforeEach(() => {
    vi.clearAllMocks()
    mock = createQueuedMockSupabase()
  })

  function run(companyIds: string[]) {
    return getBulkPeriodStatus(mock.supabase as unknown as SupabaseClient, companyIds, TODAY)
  }

  it('bookkeeping_locked_through covering today wins over an open period', async () => {
    mock.enqueue({
      data: [{ company_id: 'a', bookkeeping_locked_through: '2026-07-31' }],
    })
    mock.enqueue({
      data: [{ id: 'p-1', company_id: 'a', is_closed: false, locked_at: null }],
    })

    const result = await run(['a'])
    expect(result.get('a')).toEqual({
      periodId: 'p-1',
      status: 'locked',
      lockedThrough: '2026-07-31',
    })
  })

  it('closed period reports closed when the lock date is in the past', async () => {
    mock.enqueue({
      data: [{ company_id: 'a', bookkeeping_locked_through: '2026-05-31' }],
    })
    mock.enqueue({
      data: [{ id: 'p-1', company_id: 'a', is_closed: true, locked_at: null }],
    })

    const result = await run(['a'])
    expect(result.get('a')?.status).toBe('closed')
    expect(result.get('a')?.lockedThrough).toBe('2026-05-31')
  })

  it('locked_at on the covering period reports locked', async () => {
    mock.enqueue({ data: [{ company_id: 'a', bookkeeping_locked_through: null }] })
    mock.enqueue({
      data: [{ id: 'p-1', company_id: 'a', is_closed: false, locked_at: '2026-07-01T00:00:00Z' }],
    })

    const result = await run(['a'])
    expect(result.get('a')?.status).toBe('locked')
  })

  it('open period with no locks reports open', async () => {
    mock.enqueue({ data: [{ company_id: 'a', bookkeeping_locked_through: null }] })
    mock.enqueue({
      data: [{ id: 'p-1', company_id: 'a', is_closed: false, locked_at: null }],
    })

    const result = await run(['a'])
    expect(result.get('a')).toEqual({ periodId: 'p-1', status: 'open', lockedThrough: null })
  })

  it('no covering period reports open with null periodId, keeping lockedThrough', async () => {
    mock.enqueue({
      data: [{ company_id: 'a', bookkeeping_locked_through: '2026-05-31' }],
    })
    mock.enqueue({ data: [] })

    const result = await run(['a'])
    expect(result.get('a')).toEqual({
      periodId: null,
      status: 'open',
      lockedThrough: '2026-05-31',
    })
  })

  it('every requested company gets an entry even without settings rows', async () => {
    mock.enqueue({ data: [] })
    mock.enqueue({ data: [] })

    const result = await run(['a', 'b'])
    expect(result.size).toBe(2)
    expect(result.get('b')?.status).toBe('open')
  })

  it('soft-fails to an empty map on query error', async () => {
    mock.enqueue({ data: null, error: { message: 'boom' } })
    mock.enqueue({ data: [] })

    const result = await run(['a'])
    expect(result.size).toBe(0)
  })
})
