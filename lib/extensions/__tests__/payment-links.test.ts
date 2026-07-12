import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { extensionRegistry } from '@/lib/extensions/registry'
import { maybeCreatePaymentLinkForInvoice } from '@/lib/extensions/payment-links'
import { makeInvoice } from '@/tests/helpers'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Invoice } from '@/types'

const supabase = {} as SupabaseClient
const log = { warn: vi.fn() }

function eligibleInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return makeInvoice({
    payment_link_url: null,
    document_type: 'invoice',
    credited_invoice_id: null,
    ...overrides,
  })
}

function registerProvider(create: (...args: unknown[]) => Promise<unknown>) {
  extensionRegistry.register({
    id: 'fake-psp',
    name: 'Fake PSP',
    version: '1.0.0',
    services: { createInvoicePaymentLink: create as (...args: unknown[]) => Promise<unknown> },
  })
}

describe('maybeCreatePaymentLinkForInvoice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    extensionRegistry.unregister('fake-psp')
  })

  it('returns null when no provider extension is registered', async () => {
    const result = await maybeCreatePaymentLinkForInvoice(
      supabase, 'company-1', 'user-1', eligibleInvoice(), log,
    )
    expect(result).toBeNull()
  })

  it.each([
    ['a manually pasted link exists', { payment_link_url: 'https://buy.stripe.com/x' }],
    ['the per-invoice toggle is off', { payment_link_auto: false }],
    ['the document is a proforma', { document_type: 'proforma' as const }],
    ['the document is a credit note', { credited_invoice_id: 'orig-1' }],
  ])('skips the provider when %s', async (_label, overrides) => {
    const create = vi.fn()
    registerProvider(create)
    const result = await maybeCreatePaymentLinkForInvoice(
      supabase, 'company-1', 'user-1', eligibleInvoice(overrides as Partial<Invoice>), log,
    )
    expect(result).toBeNull()
    expect(create).not.toHaveBeenCalled()
  })

  it('returns the provider link on success', async () => {
    const create = vi.fn().mockResolvedValue({
      url: 'https://buy.stripe.com/test_abc',
      externalId: 'plink_1',
    })
    registerProvider(create)
    const invoice = eligibleInvoice()
    const result = await maybeCreatePaymentLinkForInvoice(
      supabase, 'company-1', 'user-1', invoice, log,
    )
    expect(result).toEqual({
      ok: true,
      url: 'https://buy.stripe.com/test_abc',
      externalId: 'plink_1',
    })
    expect(create).toHaveBeenCalledWith(supabase, 'company-1', 'user-1', invoice)
  })

  it('treats a provider null (not eligible) as no link', async () => {
    registerProvider(vi.fn().mockResolvedValue(null))
    const result = await maybeCreatePaymentLinkForInvoice(
      supabase, 'company-1', 'user-1', eligibleInvoice(), log,
    )
    expect(result).toBeNull()
  })

  it('never throws: a provider failure becomes { ok: false, reason }', async () => {
    registerProvider(vi.fn().mockRejectedValue(new Error('stripe down')))
    const result = await maybeCreatePaymentLinkForInvoice(
      supabase, 'company-1', 'user-1', eligibleInvoice(), log,
    )
    expect(result).toEqual({ ok: false, reason: 'stripe down' })
    expect(log.warn).toHaveBeenCalled()
  })
})
