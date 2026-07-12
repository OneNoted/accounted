import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createQueuedMockSupabase } from '@/tests/helpers'
import { encryptPersonnummer } from '@/lib/salary/personnummer'
import { importRotRutBeslutFile, type RotRutBeslutFile } from '../rot-rut-beslut-import'
import type { SupabaseClient } from '@supabase/supabase-js'

const { supabase, enqueue, reset } = createQueuedMockSupabase()
const db = supabase as unknown as SupabaseClient

const REQUEST_ID = '22222222-2222-4222-8222-222222222222'
// Skatteverket official example personnummer (synthetic).
const PNR = '193610058590'
const PNR2 = '193204029064'

const ORG_SETTINGS = { data: { org_number: '878000-3656' } }

function makeRequestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    name: 'ROT 2026-07-02',
    status: 'submitted',
    requested_total: 3000,
    decided_total: null,
    decided_at: null,
    skv_referensnummer: null,
    ...overrides,
  }
}

function makeItemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    invoice_id: 'inv-1',
    requested_amount: 3000,
    invoice: {
      invoice_number: '96458',
      deduction_personnummer_encrypted: encryptPersonnummer(PNR),
    },
    ...overrides,
  }
}

function makeFile(overrides: Partial<RotRutBeslutFile> = {}): RotRutBeslutFile {
  return {
    version: '1',
    utforare: '168780003656',
    beslut: [
      {
        namn: 'ROT 2026-07-02',
        referensnummer: '20260000185-01',
        arenden: [{ personnummer: PNR, fakturanummer: '96458', godkantBelopp: 2000 }],
      },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  reset()
})

describe('importRotRutBeslutFile', () => {
  it('rejects a file whose utforare is another company', async () => {
    enqueue({ data: { org_number: '556123-4567' } })

    const result = await importRotRutBeslutFile(db, 'company-1', makeFile())

    expect(result).toEqual({ ok: false, code: 'ROT_RUT_BESLUT_WRONG_COMPANY' })
  })

  it('records the beslut on a name-matched request (fakturanummer match)', async () => {
    enqueue(ORG_SETTINGS)
    enqueue({ data: [makeRequestRow()] })
    enqueue({ data: [makeItemRow()] })
    enqueue({ data: null }) // item update
    enqueue({ data: null }) // request update

    const result = await importRotRutBeslutFile(db, 'company-1', makeFile())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.imported).toBe(1)
    expect(result.results[0]).toMatchObject({
      status: 'imported',
      request_id: REQUEST_ID,
      decided_total: 2000,
      items_updated: 1,
      rejected: false,
    })
    expect(result.results[0].next).toContain(`/api/rot-rut/payout-requests/${REQUEST_ID}/settle`)
  })

  it('matches by personnummer when fakturanummer is absent', async () => {
    enqueue(ORG_SETTINGS)
    enqueue({ data: [makeRequestRow()] })
    enqueue({ data: [makeItemRow()] })
    enqueue({ data: null })
    enqueue({ data: null })

    const file = makeFile()
    file.beslut[0].arenden = [{ personnummer: PNR, godkantBelopp: 1500 }]
    const result = await importRotRutBeslutFile(db, 'company-1', file)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.results[0]).toMatchObject({ status: 'imported', decided_total: 1500 })
  })

  it('flags a 0-kr beslut as rejected (avslag)', async () => {
    enqueue(ORG_SETTINGS)
    enqueue({ data: [makeRequestRow()] })
    enqueue({ data: [makeItemRow()] })
    enqueue({ data: null })
    enqueue({ data: null })

    const file = makeFile()
    file.beslut[0].arenden = [{ personnummer: PNR, fakturanummer: '96458', godkantBelopp: 0 }]
    const result = await importRotRutBeslutFile(db, 'company-1', file)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.results[0]).toMatchObject({
      status: 'imported',
      decided_total: 0,
      rejected: true,
    })
    expect(result.results[0].next).toBeUndefined()
  })

  it('is idempotent: a request with the same referensnummer already decided reports already_imported', async () => {
    enqueue(ORG_SETTINGS)
    enqueue({
      data: [
        makeRequestRow({
          skv_referensnummer: '20260000185-01',
          decided_at: '2026-07-10T00:00:00Z',
          decided_total: 2000,
        }),
      ],
    })

    const result = await importRotRutBeslutFile(db, 'company-1', makeFile())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.already_imported).toBe(1)
    expect(result.results[0]).toMatchObject({ status: 'already_imported', request_id: REQUEST_ID })
  })

  it('errors on ambiguous names instead of guessing', async () => {
    enqueue(ORG_SETTINGS)
    enqueue({ data: [makeRequestRow(), makeRequestRow({ id: 'other-request' })] })

    const result = await importRotRutBeslutFile(db, 'company-1', makeFile())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.errors).toBe(1)
    expect(result.results[0].status).toBe('error')
    expect(result.results[0].error).toContain('entydigt')
  })

  it('errors when no active request carries the name', async () => {
    enqueue(ORG_SETTINGS)
    enqueue({ data: [makeRequestRow({ name: 'Annat namn' })] })

    const result = await importRotRutBeslutFile(db, 'company-1', makeFile())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.results[0]).toMatchObject({ status: 'error' })
    expect(result.results[0].error).toContain('Ingen aktiv begäran')
  })

  it('applies nothing when an ärende matches no item (all-or-nothing)', async () => {
    enqueue(ORG_SETTINGS)
    enqueue({ data: [makeRequestRow()] })
    enqueue({ data: [makeItemRow()] })

    const file = makeFile()
    file.beslut[0].arenden = [
      { personnummer: PNR, fakturanummer: '96458', godkantBelopp: 2000 },
      // Second ärende matches nothing in the single-item request.
      { personnummer: PNR2, fakturanummer: '9265412', godkantBelopp: 2000 },
    ]
    const result = await importRotRutBeslutFile(db, 'company-1', file)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.results[0].status).toBe('error')
    // Only the three reads happened: settings, requests, items. No writes.
    expect((supabase.from as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3)
  })
})
