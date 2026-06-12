import { describe, it, expect, vi, beforeEach } from 'vitest'
import { eventBus } from '@/lib/events/bus'
import { createQueuedMockSupabase } from '@/tests/helpers'
import {
  applyHandelse,
  handleWebhook,
  hashPnr,
  normalizeOrgnr,
} from '../lib/submission-service'
import type { HandelseMeddelande } from '../types'

function message(overrides: Partial<HandelseMeddelande> = {}): HandelseMeddelande {
  return {
    typ: 'AR-v2',
    id: '5560001111',
    nr: 3,
    tid: '2026-06-01T10:00:00.000+02:00',
    data: {
      version: '2.0',
      handlingsinfo: [{ handling: 'arsredovisning', idnummer: '49679' }],
      status: 'arsred_inkommen',
    },
    ...overrides,
  }
}

describe('normalizeOrgnr / hashPnr', () => {
  it('normalizes 12-digit and dashed org numbers to the 10-digit API form', () => {
    expect(normalizeOrgnr('556000-1111')).toBe('5560001111')
    expect(normalizeOrgnr('165560001111')).toBe('5560001111')
    expect(normalizeOrgnr('5560001111')).toBe('5560001111')
  })

  it('hashes personnummer with company salt — never the raw value', () => {
    const hash = hashPnr('company-1', '19830101-9876')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain('9876')
    expect(hashPnr('company-2', '198301019876')).not.toBe(hash)
    // Same pnr + company → stable.
    expect(hashPnr('company-1', '198301019876')).toBe(hash)
  })
})

describe('handleWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eventBus.clear()
  })

  it('rejects messages without a matching auth header (401)', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ data: [{ company_id: 'company-1', auth_secret: 'right-secret' }], error: null })

    const result = await handleWebhook(supabase as never, message(), 'wrong-secret')
    expect(result.status).toBe(401)
  })

  it('rejects messages for unknown orgnr (401)', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ data: [], error: null })

    const result = await handleWebhook(supabase as never, message(), 'any')
    expect(result.status).toBe(401)
  })

  it('acks the subscription test message without touching submissions', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ data: [{ company_id: 'company-1', auth_secret: 's3cret' }], error: null })

    const result = await handleWebhook(
      supabase as never,
      message({ nr: -1, data: { version: '2.0', status: 'test' } }),
      's3cret',
    )
    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
  })

  it('applies a real status event to the matching submission and emits events', async () => {
    const emitted: string[] = []
    eventBus.on('arsredovisning.status_changed', (payload) => {
      emitted.push(`changed:${payload.status}`)
    })
    eventBus.on('arsredovisning.registered', () => {
      emitted.push('registered')
    })

    const { supabase, enqueue } = createQueuedMockSupabase()
    // 1) subscription lookup
    enqueue({ data: [{ company_id: 'company-1', auth_secret: 's3cret' }], error: null })
    // 2) submission lookup by idnummer
    enqueue({
      data: [
        {
          id: 'sub-1',
          status: 'uploaded',
          fiscal_period_id: 'period-1',
          user_id: 'user-1',
          company_id: 'company-1',
        },
      ],
      error: null,
    })
    // 3) update
    enqueue({ data: null, error: null })

    const result = await handleWebhook(
      supabase as never,
      message({ data: { version: '2.0', handlingsinfo: [{ handling: 'arsredovisning', idnummer: '49679' }], status: 'arsred_registrerad' } }),
      's3cret',
    )
    expect(result.status).toBe(200)
    expect(emitted).toContain('changed:registrerad')
    expect(emitted).toContain('registered')
  })

  it('rejects malformed payloads (400)', async () => {
    const { supabase } = createQueuedMockSupabase()
    const result = await handleWebhook(
      supabase as never,
      {} as never,
      's3cret',
    )
    expect(result.status).toBe(400)
  })
})

describe('applyHandelse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eventBus.clear()
  })

  it('emits forelagd event on föreläggande and skips unknown statuses', async () => {
    const emitted: string[] = []
    eventBus.on('arsredovisning.forelagd', () => {
      emitted.push('forelagd')
    })

    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({
      data: [
        {
          id: 'sub-1',
          status: 'inkommen',
          fiscal_period_id: 'period-1',
          user_id: 'user-1',
          company_id: 'company-1',
        },
      ],
      error: null,
    })
    enqueue({ data: null, error: null })

    await applyHandelse(
      supabase as never,
      message({ data: { version: '2.0', handlingsinfo: [{ handling: 'arsredovisning', idnummer: '49679' }], status: 'arsred_forelaggande_skickat' } }),
      ['company-1'],
    )
    expect(emitted).toEqual(['forelagd'])

    // Unknown status: nothing should be queried or emitted.
    await applyHandelse(
      supabase as never,
      message({ data: { version: '2.0', status: 'test' } }),
      ['company-1'],
    )
    expect(emitted).toEqual(['forelagd'])
  })

  it('does not emit when the stored status already matches', async () => {
    const emitted: string[] = []
    eventBus.on('arsredovisning.status_changed', () => {
      emitted.push('changed')
    })
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({
      data: [
        {
          id: 'sub-1',
          status: 'inkommen',
          fiscal_period_id: 'period-1',
          user_id: 'user-1',
          company_id: 'company-1',
        },
      ],
      error: null,
    })

    await applyHandelse(supabase as never, message(), ['company-1'])
    expect(emitted).toEqual([])
  })
})
