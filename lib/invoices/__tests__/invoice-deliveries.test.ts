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
  sendTrackedInvoiceEmail,
} from '../invoice-deliveries'

function makeSupabase(options?: {
  insertData?: Record<string, unknown> | null
  insertError?: { message: string } | null
  updateError?: { message: string } | null
}) {
  const insertResult = {
    data: options?.insertData === undefined ? { id: 'delivery-1' } : options.insertData,
    error: options?.insertError ?? null,
  }
  const updateResult = { data: null, error: options?.updateError ?? null }

  const insertSpy = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn().mockResolvedValue(insertResult),
    })),
  }))
  const updateChain: {
    eq: ReturnType<typeof vi.fn>
    then: (resolve: (value: typeof updateResult) => void) => void
  } = {
    eq: vi.fn(),
    then: (resolve) => resolve(updateResult),
  }
  updateChain.eq.mockReturnValue(updateChain)
  const updateSpy = vi.fn(() => updateChain)
  const from = vi.fn(() => ({ insert: insertSpy, update: updateSpy }))

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
    to: 'customer@example.com',
    cc: ['accounting@example.com'],
    replyTo: 'sender@example.com',
    fromName: 'Example AB',
    subject: 'Faktura F-1001',
    html: '<p>Hej!</p>',
    text: 'Hej!',
    filename: 'faktura-f-1001.pdf',
    pdfBuffer: Buffer.from('exact-pdf'),
  }
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
    const { supabase, insertSpy, updateSpy } = makeSupabase()
    const sendEmail = vi.fn().mockResolvedValue({
      success: true,
      provider: 'resend',
      messageId: 'provider-message-1',
    })

    const result = await sendTrackedInvoiceEmail(
      makeInput(supabase, { sendEmail } as EmailService),
    )

    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({
      company_id: 'company-1',
      invoice_id: 'invoice-1',
      channel: 'email',
      status: 'pending',
      to_addresses: ['customer@example.com'],
      cc_addresses: ['accounting@example.com'],
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
      attachments: [expect.objectContaining({
        filename: 'faktura-f-1001.pdf',
        content: Buffer.from('exact-pdf'),
      })],
    }))
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
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
      insertData: null,
      insertError: { message: 'insert failed' },
    })
    const sendEmail = vi.fn()

    await expect(
      sendTrackedInvoiceEmail(makeInput(supabase, { sendEmail } as EmailService)),
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
      error: 'provider rejected the request',
    })

    const result = await sendTrackedInvoiceEmail(
      makeInput(supabase, { sendEmail } as EmailService),
    )

    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      provider: 'resend',
      error_code: 'provider_failed',
    }))
    expect(result.success).toBe(false)
  })

  it('surfaces a warning if a successful provider result cannot be finalized', async () => {
    const { supabase } = makeSupabase({ updateError: { message: 'update failed' } })
    const sendEmail = vi.fn().mockResolvedValue({ success: true })

    const result = await sendTrackedInvoiceEmail(
      makeInput(supabase, { sendEmail } as EmailService),
    )

    expect(result.trackingWarning).toBe('finalize_failed')
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
