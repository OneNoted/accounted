import type { SupabaseClient } from '@supabase/supabase-js'
import type { EmailService, SendEmailOptions, SendEmailResult } from '@/lib/email/service'
import { deleteDocument, uploadDocument } from '@/lib/core/documents/document-service'
import type { InvoiceDelivery } from '@/types'

const PDF_CONTENT_TYPE = 'application/pdf'

export class InvoiceDeliverySnapshotError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvoiceDeliverySnapshotError'
  }
}

export interface TrackedInvoiceEmailInput {
  supabase: SupabaseClient
  emailService: EmailService
  companyId: string
  userId: string
  invoiceId: string
  deliveryId: string
  to: string | string[]
  cc?: string | string[]
  bcc?: string | string[]
  replyTo?: string
  fromName?: string
  subject: string
  html: string
  text: string
  filename: string
  pdfBuffer: Buffer
}

export interface TrackedInvoiceEmailResult extends SendEmailResult {
  deliveryId: string
  documentId: string
  trackingWarning?: 'finalize_failed' | 'failure_record_failed' | 'failure_cleanup_failed'
}

function addresses(value?: string | string[]): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * Persist a reusable delivery attempt before allocating an invoice number.
 * The unique preparing row is also the concurrency lock for one invoice send.
 */
export async function reserveInvoiceDelivery(args: {
  supabase: SupabaseClient
  companyId: string
  userId: string
  invoiceId: string
}): Promise<string> {
  const { data, error } = await args.supabase
    .from('invoice_deliveries')
    .insert({
      company_id: args.companyId,
      user_id: args.userId,
      invoice_id: args.invoiceId,
      channel: 'email',
      status: 'preparing',
    })
    .select('id')
    .single()

  if (data?.id) return data.id

  if ((error as { code?: string } | null)?.code === '23505') {
    const { data: existing, error: existingError } = await args.supabase
      .from('invoice_deliveries')
      .select('id')
      .eq('company_id', args.companyId)
      .eq('invoice_id', args.invoiceId)
      .eq('status', 'preparing')
      .maybeSingle()

    if (!existingError && existing?.id) return existing.id
  }

  throw new InvoiceDeliverySnapshotError(
    `Failed to reserve invoice delivery: ${error?.message || 'unknown error'}`,
  )
}

export async function sendTrackedInvoiceEmail(
  input: TrackedInvoiceEmailInput,
): Promise<TrackedInvoiceEmailResult> {
  const {
    supabase,
    emailService,
    companyId,
    userId,
    invoiceId,
    deliveryId,
    to,
    cc,
    bcc,
    replyTo,
    fromName,
    subject,
    html,
    text,
    filename,
    pdfBuffer,
  } = input

  const pdfArrayBuffer = new Uint8Array(pdfBuffer).buffer as ArrayBuffer
  const document = await uploadDocument(
    supabase,
    userId,
    companyId,
    {
      name: filename,
      buffer: pdfArrayBuffer,
      type: PDF_CONTENT_TYPE,
    },
    { upload_source: 'system' },
  )

  const { data: delivery, error: deliveryError } = await supabase
    .from('invoice_deliveries')
    .update({
      status: 'pending',
      to_addresses: addresses(to),
      cc_addresses: addresses(cc),
      bcc_addresses: addresses(bcc),
      reply_to: replyTo || null,
      from_name: fromName || null,
      subject,
      body_text: text,
      body_html: html,
      document_attachment_id: document.id,
      attachment_filename: filename,
      attachment_content_type: PDF_CONTENT_TYPE,
      attachment_sha256: document.sha256_hash,
    })
    .eq('id', deliveryId)
    .eq('company_id', companyId)
    .eq('invoice_id', invoiceId)
    .eq('status', 'preparing')
    .select('*')
    .single()

  if (deliveryError || !delivery) {
    try {
      await deleteDocument(supabase, companyId, document.id)
    } catch {
      // Best-effort cleanup only. The send must remain blocked even if the
      // unlinked archive cannot be removed after a snapshot insert failure.
    }
    throw new InvoiceDeliverySnapshotError(
      `Failed to persist invoice delivery snapshot: ${deliveryError?.message || 'unknown error'}`,
    )
  }

  const emailOptions: SendEmailOptions = {
    to,
    cc,
    bcc,
    subject,
    html,
    text,
    replyTo,
    fromName,
    attachments: [
      {
        filename,
        content: pdfBuffer,
        contentType: PDF_CONTENT_TYPE,
      },
    ],
  }
  const result = await emailService.sendEmail(emailOptions)

  if (!result.success) {
    const { error: failureRecordError } = await supabase
      .from('invoice_deliveries')
      .update({
        status: 'failed',
        provider: result.provider || null,
        provider_message_id: null,
        error_code: 'provider_failed',
        document_attachment_id: null,
        failed_at: new Date().toISOString(),
      })
      .eq('id', delivery.id)
      .eq('company_id', companyId)
      .eq('status', 'pending')

    let cleanupFailed = false
    if (!failureRecordError) {
      try {
        const cleanup = await deleteDocument(supabase, companyId, document.id)
        cleanupFailed = !cleanup.ok
      } catch {
        cleanupFailed = true
      }
    }

    return {
      ...result,
      deliveryId: delivery.id,
      documentId: document.id,
      ...(failureRecordError
        ? { trackingWarning: 'failure_record_failed' as const }
        : cleanupFailed
          ? { trackingWarning: 'failure_cleanup_failed' as const }
          : {}),
    }
  }

  const { error: finalizeError } = await supabase
    .from('invoice_deliveries')
    .update({
      status: 'sent',
      provider: result.provider || null,
      provider_message_id: result.messageId || null,
      sent_at: new Date().toISOString(),
    })
    .eq('id', delivery.id)
    .eq('company_id', companyId)
    .eq('status', 'pending')

  return {
    ...result,
    deliveryId: delivery.id,
    documentId: document.id,
    ...(finalizeError ? { trackingWarning: 'finalize_failed' as const } : {}),
  }
}

export async function recordManualInvoiceDelivery(args: {
  supabase: SupabaseClient
  companyId: string
  userId: string
  invoiceId: string
  sentAt?: string
}): Promise<InvoiceDelivery> {
  const { data, error } = await args.supabase
    .from('invoice_deliveries')
    .insert({
      company_id: args.companyId,
      user_id: args.userId,
      invoice_id: args.invoiceId,
      channel: 'manual',
      status: 'marked_sent',
      sent_at: args.sentAt || new Date().toISOString(),
    })
    .select('*')
    .single()

  if (error || !data) {
    throw new InvoiceDeliverySnapshotError(
      `Failed to persist manual invoice delivery: ${error?.message || 'unknown error'}`,
    )
  }

  return data as InvoiceDelivery
}
