/**
 * Tests for /api/salary/employees/[id]/worked-hours/batch (POST).
 *
 * Runs the route through the real withRouteContext wrapper; mocks auth/company/
 * write and injects a recording Supabase mock via requireAuth. Covers 401, 403
 * (viewer), 400, 404 and the happy path.
 *
 * The rest of the file guards the delete-and-reinsert. The batch carries one
 * shared body for N dates, so anything it omits (per-day notes, per-day shift
 * windows, per-day run links) has to survive the replace. It used to write the
 * shared value or NULL over every day, which wiped notes the user had written
 * and shift windows that made OB-tillägg computable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { createMockRequest, parseJsonResponse } from '@/tests/helpers'
import { createRecordingSupabase } from '../../__tests__/recording-supabase'

const { supabase, enqueue, reset, insertedRows, ops } = createRecordingSupabase()

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

import { POST } from '../route'

const params = { params: Promise.resolve({ id: 'emp-1' }) } as never

function post(body: unknown) {
  return createMockRequest('/api/salary/employees/emp-1/worked-hours/batch', {
    method: 'POST',
    body,
  })
}

const validBatch = { dates: ['2026-07-01', '2026-07-02'], hours: 8 }

/** Queue the reads the route does before its inserts: employee, prefetch, delete. */
function enqueuePreamble(existing: unknown[] = []) {
  enqueue({ data: { id: 'emp-1' } }) // employee ownership check
  enqueue({ data: existing }) // prefetch of rows about to be replaced
  enqueue({ data: null }) // bulk delete
}

describe('POST /api/salary/employees/[id]/worked-hours/batch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
    requireAuthMock.mockResolvedValue({ user: { id: 'user-1' }, supabase })
    requireWriteMock.mockResolvedValue({ ok: true })
  })

  it('returns 401 when unauthenticated', async () => {
    requireAuthMock.mockResolvedValue({
      user: null,
      supabase,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    })

    const response = await POST(post(validBatch), params)
    expect(response.status).toBe(401)
  })

  it('returns 403 for a viewer (no write permission)', async () => {
    requireWriteMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    })

    const response = await POST(post(validBatch), params)
    expect(response.status).toBe(403)
  })

  it('returns 400 for an empty date list', async () => {
    enqueue({ data: { id: 'emp-1' } }) // employee ownership check

    const response = await POST(post({ dates: [], hours: 8 }), params)
    expect(response.status).toBe(400)
    expect(insertedRows()).toHaveLength(0)
  })

  it('returns 400 when only one half of the shift window is given', async () => {
    enqueue({ data: { id: 'emp-1' } }) // employee ownership check

    const response = await POST(post({ ...validBatch, end_time: '06:00' }), params)
    expect(response.status).toBe(400)
    expect(insertedRows()).toHaveLength(0)
  })

  it('bulk-inserts worked days (happy path)', async () => {
    enqueuePreamble()
    enqueue({ data: null }) // insert date 1
    enqueue({ data: null }) // insert date 2

    const response = await POST(post(validBatch), params)
    const { status, body } = await parseJsonResponse<{
      data: { inserted: number; conflicts: unknown[] }
    }>(response)

    expect(status).toBe(201)
    expect(body.data.inserted).toBe(2)
    expect(body.data.conflicts).toEqual([])
  })

  it('returns 404 when the employee is not in the company', async () => {
    enqueue({ data: null }) // employee ownership check → not found

    const response = await POST(post(validBatch), params)
    expect(response.status).toBe(404)
  })

  it('keeps each day its own note when the batch carries none', async () => {
    enqueuePreamble([
      {
        work_date: '2026-07-01',
        notes: 'Inventering lager',
        salary_run_employee_id: null,
        start_time: null,
        end_time: null,
      },
      {
        work_date: '2026-07-02',
        notes: 'Kundbesök Göteborg',
        salary_run_employee_id: null,
        start_time: null,
        end_time: null,
      },
    ])
    enqueue({ data: null })
    enqueue({ data: null })

    const response = await POST(post(validBatch), params)
    expect(response.status).toBe(201)

    const rows = insertedRows()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ work_date: '2026-07-01', notes: 'Inventering lager' })
    expect(rows[1]).toMatchObject({ work_date: '2026-07-02', notes: 'Kundbesök Göteborg' })
  })

  it('lets an explicit batch note override the stored per-day notes', async () => {
    enqueuePreamble([
      {
        work_date: '2026-07-01',
        notes: 'Inventering lager',
        salary_run_employee_id: null,
        start_time: null,
        end_time: null,
      },
    ])
    enqueue({ data: null })
    enqueue({ data: null })

    await POST(post({ ...validBatch, notes: 'Projektvecka' }), params)

    const rows = insertedRows()
    expect(rows[0]).toMatchObject({ work_date: '2026-07-01', notes: 'Projektvecka' })
    expect(rows[1]).toMatchObject({ work_date: '2026-07-02', notes: 'Projektvecka' })
  })

  it('writes the shift window when the batch supplies one', async () => {
    enqueuePreamble()
    enqueue({ data: null })
    enqueue({ data: null })

    await POST(post({ ...validBatch, start_time: '22:00', end_time: '06:00' }), params)

    for (const row of insertedRows()) {
      expect(row).toMatchObject({ start_time: '22:00', end_time: '06:00' })
    }
  })

  it('keeps a stored shift window when the batch supplies none', async () => {
    // Re-marking hours must not silently erase the times: that would send the
    // day back to the engine's 08:00-17:00 fallback and drop the OB-tillägg.
    enqueuePreamble([
      {
        work_date: '2026-07-01',
        notes: null,
        salary_run_employee_id: null,
        start_time: '22:00:00',
        end_time: '06:00:00',
      },
    ])
    enqueue({ data: null })
    enqueue({ data: null })

    await POST(post(validBatch), params)

    const rows = insertedRows()
    expect(rows[0]).toMatchObject({ start_time: '22:00:00', end_time: '06:00:00' })
    // The untouched day has no stored window, so it stays NULL.
    expect(rows[1]).toMatchObject({ start_time: null, end_time: null })
  })

  it('keeps a stored salary_run_employee_id when the batch supplies none', async () => {
    enqueuePreamble([
      {
        work_date: '2026-07-01',
        notes: null,
        salary_run_employee_id: 'sre-1',
        start_time: null,
        end_time: null,
      },
    ])
    enqueue({ data: null })
    enqueue({ data: null })

    await POST(post(validBatch), params)

    const rows = insertedRows()
    expect(rows[0]).toMatchObject({ salary_run_employee_id: 'sre-1' })
    expect(rows[1]).toMatchObject({ salary_run_employee_id: null })
  })

  it('reads the existing rows before deleting them', async () => {
    enqueuePreamble()
    enqueue({ data: null })
    enqueue({ data: null })

    await POST(post(validBatch), params)

    const workedDayOps = ops.filter((op) => op.table === 'salary_worked_days')
    expect(workedDayOps[0].verb).toBe('select')
    expect(workedDayOps[0].columns).toContain('notes')
    expect(workedDayOps[0].columns).toContain('start_time')
    expect(workedDayOps[1].verb).toBe('delete')
  })

  it('aborts without deleting anything when the prefetch fails', async () => {
    enqueue({ data: { id: 'emp-1' } }) // employee ownership check
    enqueue({ error: { message: 'connection reset', code: '08006' } }) // prefetch fails

    const response = await POST(post(validBatch), params)

    expect(response.status).toBe(500)
    expect(insertedRows()).toHaveLength(0)
    // The only salary_worked_days query issued was the failed read: had the
    // delete run first, the batch would have destroyed rows it never replaced.
    const workedDayOps = ops.filter((op) => op.table === 'salary_worked_days')
    expect(workedDayOps).toHaveLength(1)
    expect(workedDayOps[0].verb).toBe('select')
  })
})
