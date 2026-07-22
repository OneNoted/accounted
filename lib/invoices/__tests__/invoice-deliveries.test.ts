import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EmailService } from '@/lib/email/service'

const mockUploadDocument = vi.fn()
const mockDeleteDocument = vi.fn()
vi.mock('@/lib/core/documents/document-service', () => ({
  uploadDocument: (...args: unknown[]) => mockUploadDocument(...args),
  deleteDocument: (...args: unknown[]) => mockDeleteDocument(...args),
}))

import {
  InvoiceDeliverySnapshotError,
  recordManualInvoiceDelivery,
  reserveInvoiceDelivery,
  sendTrackedInvoiceEmail,
} from '../invoice-deliveries'

function makeSupabase(options?: {
  insertData?: Record<string, unknown> | null
  insertError?: { message: string; code?: string } | null
  existingData?: Record<string, unknown> | null
  snapshotData?: Record<string, unknown> | null
  snapshotError?: { message: string } | null
  terminalError?: { message: string } | null
}) {
  const insertResult = {
    data: options?.insertData === undefined ? { id: 'delivery-1' } : options.insertData,
    error: options?.insertError ?? null,
  }
  const updateResults = [
    {
      data: options?.snapshotData === undefined ? { id: 'delivery-1' } : options.snapshotData,
      error: options?.snapshotError ?? null,
    },
    { data: null, error: options?.terminalError ?? null },
  ]

  const insertSpy = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn().mockResolvedValue(insertResult),
    })),
  }))
  const updateSpy = vi.fn(() => {
    const result = updateResults.shift() ?? { data: null, error: null }
    const chain: Record<string, unknown> & {
      eq: ReturnType<typeof vi.fn>
      select: ReturnType<typeof vi.fn>
      single: ReturnType<typeof vi.fn>
      then: (resolve: (value: typeof result) => void) => void
    } = {
      eq: vi.fn(),
      select: vi.fn(),
      single: vi.fn().mockResolvedValue(result),
      then: (resolve) => resolve(result),
    }
    chain.eq.mockReturnValue(chain)
    chain.select.mockReturnValue(chain)
    return chain
  })
  const existingResult = { data: options?.existingData ?? null, error: null }
  const selectChain: Record<string, unknown> & {
    eq: ReturnType<typeof vi.fn>
    maybeSingle: ReturnType<typeof vi.fn>
  } = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(existingResult),
  }
  selectChain.eq.mockReturnValue(selectChain)
  const selectSpy = vi.fn(() => selectChain)
  const from = vi.fn(() => ({ insert: insertSpy, update: updateSpy, select: selectSpy }))

  return {
    supabase: { from } as unknown as SupabaseClient,
    insertSpy,
    updateSpy,
  }
}

function makeInput(supabase: SupabaseClient, emailService: EmailService) {
  return {
    supabase,
    emailService,
    companyId: 'company-1',
    userId: 'user-1',
    invoiceId: 'invoice-1',
    deliveryId: 'delivery-1',
    to: 'customer@example.com',
    cc: ['accounting@example.com'],
    bcc: ['archive@example.com'],
    replyTo: 'sender@example.com',
    fromName: 'Example AB',
    subject: 'Faktura F-1001',
    html: '<p>Hej!</p>',
    text: 'Hej!',
    filename: 'faktura-f-1001.pdf',
    pdfBuffer: Buffer.from('exact-pdf'),
  }
}

function makeEmailService(sendEmail: EmailService['sendEmail']): EmailService {
  return { isConfigured: () => true, sendEmail }
}

describe('invoice delivery tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUploadDocument.mockResolvedValue({
      id: 'document-1',
      sha256_hash: 'sha256-exact-pdf',
    })
    mockDeleteDocument.mockResolvedValue({ ok: true })
  })

  it('persists the exact payload before sending and records provider success', async () => {
    const { supabase, updateSpy } = makeSupabase()
    const sendEmail = vi.fn().mockResolvedValue({
      success: true,
      provider: 'resend',
      messageId: 'provider-message-1',
    })

    const result = await sendTrackedInvoiceEmail(
      makeInput(supabase, makeEmailService(sendEmail)),
    )

    expect(updateSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({
      status: 'pending',
      to_addresses: ['customer@example.com'],
      cc_addresses: ['accounting@example.com'],
      bcc_addresses: ['archive@example.com'],
      subject: 'Faktura F-1001',
      body_text: 'Hej!',
      body_html: '<p>Hej!</p>',
      document_attachment_id: 'document-1',
      attachment_filename: 'faktura-f-1001.pdf',
      attachment_sha256: 'sha256-exact-pdf',
    }))
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Faktura F-1001',
      text: 'Hej!',
      html: '<p>Hej!</p>',
      bcc: ['archive@example.com'],
      attachments: [expect.objectContaining({
        filename: 'faktura-f-1001.pdf',
        content: Buffer.from('exact-pdf'),
      })],
    }))
    expect(updateSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({
      status: 'sent',
      provider: 'resend',
      provider_message_id: 'provider-message-1',
    }))
    expect(result).toMatchObject({
      success: true,
      deliveryId: 'delivery-1',
      documentId: 'document-1',
    })
  })

  it('does not call the provider when the immutable snapshot cannot be saved', async () => {
    const { supabase } = makeSupabase({
      snapshotData: null,
      snapshotError: { message: 'update failed' },
    })
    const sendEmail = vi.fn()

    await expect(
      sendTrackedInvoiceEmail(makeInput(supabase, makeEmailService(sendEmail))),
    ).rejects.toBeInstanceOf(InvoiceDeliverySnapshotError)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(mockDeleteDocument).toHaveBeenCalledWith(
      supabase,
      'company-1',
      'document-1',
    )
  })

  it('records a failed provider attempt without changing the saved payload', async () => {
    const { supabase, updateSpy } = makeSupabase()
    const sendEmail = vi.fn().mockResolvedValue({
      success: false,
      provider: 'resend',
      messageId: 'provider-returned-on-failure',
      error: 'provider rejected the request',
    })

    const result = await sendTrackedInvoiceEmail(
      makeInput(supabase, makeEmailService(sendEmail)),
    )

    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      provider: 'resend',
      provider_message_id: null,
      error_code: 'provider_failed',
      document_attachment_id: null,
    }))
    expect(mockDeleteDocument).toHaveBeenCalledWith(supabase, 'company-1', 'document-1')
    expect(result.success).toBe(false)
  })

  it('surfaces a warning if a successful provider result cannot be finalized', async () => {
    const { supabase } = makeSupabase({ terminalError: { message: 'update failed' } })
    const sendEmail = vi.fn().mockResolvedValue({ success: true })

    const result = await sendTrackedInvoiceEmail(
      makeInput(supabase, makeEmailService(sendEmail)),
    )

    expect(result.trackingWarning).toBe('finalize_failed')
  })

  it('reuses an existing preparing reservation after a unique conflict', async () => {
    const { supabase } = makeSupabase({
      insertData: null,
      insertError: { message: 'duplicate', code: '23505' },
      existingData: { id: 'delivery-existing' },
    })

    await expect(reserveInvoiceDelivery({
      supabase,
      companyId: 'company-1',
      userId: 'user-1',
      invoiceId: 'invoice-1',
    })).resolves.toBe('delivery-existing')
  })

  it('records manual delivery without inventing recipient or content details', async () => {
    const manualDelivery = {
      id: 'delivery-1',
      channel: 'manual',
      status: 'marked_sent',
    }
    const { supabase, insertSpy } = makeSupabase({ insertData: manualDelivery })

    await recordManualInvoiceDelivery({
      supabase,
      companyId: 'company-1',
      userId: 'user-1',
      invoiceId: 'invoice-1',
      sentAt: '2026-07-22T10:30:00.000Z',
    })

    expect(insertSpy).toHaveBeenCalledWith({
      company_id: 'company-1',
      user_id: 'user-1',
      invoice_id: 'invoice-1',
      channel: 'manual',
      status: 'marked_sent',
      sent_at: '2026-07-22T10:30:00.000Z',
    })
  })
})
