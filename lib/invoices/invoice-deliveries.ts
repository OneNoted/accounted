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
  to: string | string[]
  cc?: string | string[]
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
  trackingWarning?: 'finalize_failed' | 'failure_record_failed'
}

function addresses(value?: string | string[]): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
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
    to,
    cc,
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
    .insert({
      company_id: companyId,
      user_id: userId,
      invoice_id: invoiceId,
      channel: 'email',
      status: 'pending',
      to_addresses: addresses(to),
      cc_addresses: addresses(cc),
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
        provider_message_id: result.messageId || null,
        error_code: 'provider_failed',
        failed_at: new Date().toISOString(),
      })
      .eq('id', delivery.id)
      .eq('company_id', companyId)
      .eq('status', 'pending')

    return {
      ...result,
      deliveryId: delivery.id,
      documentId: document.id,
      ...(failureRecordError ? { trackingWarning: 'failure_record_failed' as const } : {}),
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
