import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createQueuedMockSupabase } from '@/tests/helpers'
import { getBulkNextDeadlines, isDeadlineOverdue } from '../deadlines'

const TODAY = '2026-07-17'

function makeDeadlineRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'd-1',
    company_id: 'company-1',
    title: 'Momsdeklaration',
    due_date: '2026-08-12',
    status: 'upcoming',
    tax_deadline_type: 'vat',
    ...overrides,
  }
}

describe('isDeadlineOverdue', () => {
  it('status overdue is always overdue', () => {
    expect(isDeadlineOverdue('overdue', '2099-01-01', TODAY)).toBe(true)
  })

  it('past-due upcoming/action_needed are overdue despite cron lag', () => {
    expect(isDeadlineOverdue('upcoming', '2026-07-16', TODAY)).toBe(true)
    expect(isDeadlineOverdue('action_needed', '2026-07-16', TODAY)).toBe(true)
  })

  it('past-due submitted/confirmed/in_progress are NOT overdue', () => {
    expect(isDeadlineOverdue('submitted', '2026-07-01', TODAY)).toBe(false)
    expect(isDeadlineOverdue('confirmed', '2026-07-01', TODAY)).toBe(false)
    expect(isDeadlineOverdue('in_progress', '2026-07-01', TODAY)).toBe(false)
  })

  it('future deadlines are not overdue', () => {
    expect(isDeadlineOverdue('upcoming', '2026-07-18', TODAY)).toBe(false)
  })
})

describe('getBulkNextDeadlines', () => {
  let mock: ReturnType<typeof createQueuedMockSupabase>

  beforeEach(() => {
    vi.clearAllMocks()
    mock = createQueuedMockSupabase()
  })

  it('returns the earliest incomplete deadline per company with mapped fields', async () => {
    // Rows arrive due_date-ascending (query-side order), companies interleaved.
    mock.enqueue({
      data: [
        makeDeadlineRow({ id: 'd-a1', company_id: 'a', due_date: '2026-07-01', status: 'overdue' }),
        makeDeadlineRow({ id: 'd-b1', company_id: 'b', due_date: '2026-07-20' }),
        makeDeadlineRow({ id: 'd-a2', company_id: 'a', due_date: '2026-08-12' }),
      ],
    })

    const result = await getBulkNextDeadlines(
      mock.supabase as unknown as SupabaseClient,
      ['a', 'b'],
      TODAY,
    )

    expect(result.size).toBe(2)
    expect(result.get('a')).toEqual({
      id: 'd-a1',
      title: 'Momsdeklaration',
      dueDate: '2026-07-01',
      status: 'overdue',
      isOverdue: true,
      taxDeadlineType: 'vat',
    })
    expect(result.get('b')?.isOverdue).toBe(false)
  })

  it('computes isOverdue from the date even when the cron has not flipped status yet', async () => {
    mock.enqueue({
      data: [makeDeadlineRow({ company_id: 'a', due_date: '2026-07-10', status: 'upcoming' })],
    })

    const result = await getBulkNextDeadlines(
      mock.supabase as unknown as SupabaseClient,
      ['a'],
      TODAY,
    )
    expect(result.get('a')?.isOverdue).toBe(true)
  })

  it('chunks company ids beyond 150 into separate queries', async () => {
    const ids = Array.from({ length: 151 }, (_, i) => `company-${i}`)
    mock.enqueue({ data: [makeDeadlineRow({ company_id: 'company-0' })] })
    mock.enqueue({ data: [makeDeadlineRow({ id: 'd-150', company_id: 'company-150' })] })

    const result = await getBulkNextDeadlines(
      mock.supabase as unknown as SupabaseClient,
      ids,
      TODAY,
    )

    expect(mock.supabase.from).toHaveBeenCalledTimes(2)
    expect(result.get('company-0')?.id).toBe('d-1')
    expect(result.get('company-150')?.id).toBe('d-150')
  })

  it('soft-fails to an empty map on query error', async () => {
    mock.enqueue({ data: null, error: { message: 'boom' } })

    const result = await getBulkNextDeadlines(
      mock.supabase as unknown as SupabaseClient,
      ['a'],
      TODAY,
    )
    expect(result.size).toBe(0)
  })

  it('skips the query entirely for an empty id set', async () => {
    const result = await getBulkNextDeadlines(
      mock.supabase as unknown as SupabaseClient,
      [],
      TODAY,
    )
    expect(result.size).toBe(0)
    expect(mock.supabase.from).not.toHaveBeenCalled()
  })
})
