import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { createMockRequest, parseJsonResponse, createQueuedMockSupabase } from '@/tests/helpers'

const { supabase, enqueue, enqueueMany, reset } = createQueuedMockSupabase()

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

const deadlineMocks = vi.hoisted(() => ({
  regenerate: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/tax/deadline-generator', () => ({
  DEADLINE_SETTINGS_SELECT: 'company_id, entity_type, moms_period',
  hasTaxRelevantFields: vi.fn((body: Record<string, unknown>) =>
    ['entity_type', 'moms_period', 'f_skatt', 'vat_registered'].some((field) => field in body)),
  regenerateTaxDeadlinesForUser: deadlineMocks.regenerate,
  toDeadlineSettings: vi.fn((settings: Record<string, unknown>) => settings),
}))

import { PUT } from '../route'

describe('PUT /api/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
    requireAuthMock.mockResolvedValue({ user: { id: 'user-1' }, supabase, error: null })
    requireWriteMock.mockResolvedValue({ ok: true })
  })

  it('returns 401 when not authenticated', async () => {
    requireAuthMock.mockResolvedValue({
      user: null,
      supabase,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    })

    const request = createMockRequest('/api/settings', {
      method: 'PUT',
      body: { company_name: 'New Name' },
    })
    const response = await PUT(request, { params: Promise.resolve({}) })
    const { status } = await parseJsonResponse(response)

    expect(status).toBe(401)
  })

  it('returns 403 for a viewer without write permission', async () => {
    requireWriteMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    })

    const request = createMockRequest('/api/settings', {
      method: 'PUT',
      body: { company_name: 'New Name' },
    })
    const response = await PUT(request, { params: Promise.resolve({}) })
    const { status } = await parseJsonResponse(response)

    expect(status).toBe(403)
  })

  it('updates the settings on the happy path', async () => {
    enqueueMany([
      { data: { entity_type: 'enskild_firma', onboarding_complete: false } }, // fetch oldSettings
      { data: { id: 's1', company_name: 'New Name' } },                        // update ... returning
    ])

    const request = createMockRequest('/api/settings', {
      method: 'PUT',
      body: { company_name: 'New Name' },
    })
    const response = await PUT(request, { params: Promise.resolve({}) })
    const { status, body } = await parseJsonResponse<{ data: { company_name: string } }>(response)

    expect(status).toBe(200)
    expect(body.data.company_name).toBe('New Name')
    expect(deadlineMocks.regenerate).not.toHaveBeenCalled()
  })

  it('regenerates deadlines when unchanged tax settings are saved', async () => {
    const settings = {
      company_id: 'company-1',
      entity_type: 'aktiebolag',
      moms_period: 'monthly',
      f_skatt: true,
      vat_registered: false,
      pays_salaries: false,
      fiscal_year_start_month: 1,
      onboarding_complete: true,
    }
    enqueueMany([
      { data: settings },
      { data: { id: 's1', ...settings } },
    ])

    const request = createMockRequest('/api/settings', {
      method: 'PUT',
      body: { f_skatt: true, vat_registered: false },
    })
    const response = await PUT(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(deadlineMocks.regenerate).toHaveBeenCalledWith(
      supabase,
      'company-1',
      expect.objectContaining({ entity_type: 'aktiebolag', f_skatt: true }),
    )
  })

  it('updates all three reminder thresholds', async () => {
    enqueueMany([
      {
        data: {
          entity_type: 'aktiebolag',
          onboarding_complete: true,
          reminder_days_level_1: 15,
          reminder_days_level_2: 30,
          reminder_days_level_3: 45,
        },
      },
      {
        data: {
          id: 's1',
          reminder_days_level_1: 7,
          reminder_days_level_2: 21,
          reminder_days_level_3: 35,
        },
      },
    ])

    const request = createMockRequest('/api/settings', {
      method: 'PUT',
      body: {
        reminder_days_level_1: 7,
        reminder_days_level_2: 21,
        reminder_days_level_3: 35,
      },
    })
    const response = await PUT(request, { params: Promise.resolve({}) })
    const { status, body } = await parseJsonResponse<{
      data: { reminder_days_level_1: number; reminder_days_level_2: number; reminder_days_level_3: number }
    }>(response)

    expect(status).toBe(200)
    expect(body.data).toMatchObject({
      reminder_days_level_1: 7,
      reminder_days_level_2: 21,
      reminder_days_level_3: 35,
    })
  })

  it('returns 400 when reminder thresholds are not increasing', async () => {
    enqueue({
      data: {
        reminder_days_level_1: 15,
        reminder_days_level_2: 30,
        reminder_days_level_3: 45,
      },
    })

    const request = createMockRequest('/api/settings', {
      method: 'PUT',
      body: {
        reminder_days_level_1: 30,
        reminder_days_level_2: 20,
        reminder_days_level_3: 45,
      },
    })
    const response = await PUT(request, { params: Promise.resolve({}) })
    const { status } = await parseJsonResponse(response)

    expect(status).toBe(400)
    expect(supabase.from).toHaveBeenCalledTimes(1)
  })

  it('rejects quarterly VAT when taxable turnover is above SEK 40 million', async () => {
    enqueue({
      data: {
        entity_type: 'aktiebolag',
        vat_registered: true,
        vat_number: 'SE556012579001',
        moms_period: 'quarterly',
        tax_turnover_over_40m: false,
        onboarding_complete: true,
      },
    })

    const request = createMockRequest('/api/settings', {
      method: 'PUT',
      body: { tax_turnover_over_40m: true },
    })
    const response = await PUT(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    expect(supabase.from).toHaveBeenCalledTimes(1)
  })

  it('returns 404 when the settings row does not exist', async () => {
    enqueueMany([
      { data: { onboarding_complete: false } },
      { data: null, error: { code: 'PGRST116', message: 'No rows returned' } },
    ])

    const request = createMockRequest('/api/settings', {
      method: 'PUT',
      body: { reminder_days_level_1: 10 },
    })
    const response = await PUT(request, { params: Promise.resolve({}) })
    const { status } = await parseJsonResponse(response)

    expect(status).toBe(404)
  })

  it('blocks a vacation-year basis change while open balances exist', async () => {
    enqueueMany([
      { data: { salary_vacation_year_basis: 'calendar', onboarding_complete: true } }, // oldSettings
      { data: null, count: 2 },                                                            // open-rows count
    ])

    const request = createMockRequest('/api/settings', {
      method: 'PUT',
      body: { salary_vacation_year_basis: 'statutory_apr_mar' },
    })
    const response = await PUT(request, { params: Promise.resolve({}) })
    const { status } = await parseJsonResponse(response)

    expect(status).toBe(400)
    // The guard consumed the count result and the update never ran.
    expect(supabase.from.mock.calls.map(([table]) => table)).toEqual([
      'company_settings',
      'employee_vacation_balances',
    ])
  })

  it('fails closed when the open-balances guard query errors', async () => {
    enqueueMany([
      { data: { salary_vacation_year_basis: 'calendar', onboarding_complete: true } }, // oldSettings
      { data: null, count: null, error: { message: 'connection reset' } },                 // guard query fails
    ])

    const request = createMockRequest('/api/settings', {
      method: 'PUT',
      body: { salary_vacation_year_basis: 'statutory_apr_mar' },
    })
    const response = await PUT(request, { params: Promise.resolve({}) })
    const { status } = await parseJsonResponse(response)

    expect(status).toBe(500)
    // The 500 must come from the guard, not from company_settings.update()
    // swallowing the queued error: the guard query ran and no second
    // company_settings query followed it.
    expect(supabase.from.mock.calls.map(([table]) => table)).toEqual([
      'company_settings',
      'employee_vacation_balances',
    ])
  })
})
