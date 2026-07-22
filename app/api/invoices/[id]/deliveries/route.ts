import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withRouteContext } from '@/lib/api/with-route-context'
import { errorResponseFromCode } from '@/lib/errors/get-structured-error'
import type { InvoiceDelivery } from '@/types'

type DeliveryListRow = Pick<
  InvoiceDelivery,
  | 'id'
  | 'channel'
  | 'status'
  | 'to_addresses'
  | 'cc_addresses'
  | 'bcc_addresses'
  | 'reply_to'
  | 'from_name'
  | 'subject'
  | 'body_text'
  | 'provider'
  | 'error_code'
  | 'document_attachment_id'
  | 'attachment_filename'
  | 'sent_at'
  | 'failed_at'
  | 'created_at'
>

const DELIVERY_COLUMNS = [
  'id',
  'channel',
  'status',
  'to_addresses',
  'cc_addresses',
  'bcc_addresses',
  'reply_to',
  'from_name',
  'subject',
  'body_text',
  'provider',
  'error_code',
  'document_attachment_id',
  'attachment_filename',
  'sent_at',
  'failed_at',
  'created_at',
].join(', ')

/**
 * GET /api/invoices/[id]/deliveries
 *
 * Returns delivery evidence needed on the active company's invoice page.
 * Provider identifiers, HTML content, and checksums stay server-side.
 */
export const GET = withRouteContext<{ params: Promise<{ id: string }> }>(
  'invoice.deliveries.list',
  async (_request, { supabase, companyId, log, requestId }, { params }) => {
    const { id } = await params
    if (!z.string().uuid().safeParse(id).success) {
      return errorResponseFromCode('VALIDATION_ERROR', log, {
        requestId,
        details: { field: 'id', message: 'Invoice id must be a UUID.' },
      })
    }

    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('id')
      .eq('id', id)
      .eq('company_id', companyId)
      .maybeSingle()

    if (invoiceError || !invoice) {
      return errorResponseFromCode('INVOICE_NOT_FOUND', log, { requestId })
    }

    const { data: deliveries, error } = await supabase
      .from('invoice_deliveries')
      .select(DELIVERY_COLUMNS)
      .eq('invoice_id', id)
      .eq('company_id', companyId)
      .neq('status', 'preparing')
      .order('created_at', { ascending: false })

    if (error) {
      log.error('failed to list invoice deliveries', error, { invoiceId: id })
      throw error
    }

    const visibleDeliveries = ((deliveries || []) as unknown as DeliveryListRow[]).map((delivery) => ({
      id: delivery.id,
      channel: delivery.channel,
      status: delivery.status,
      to_addresses: delivery.to_addresses,
      cc_addresses: delivery.cc_addresses,
      bcc_addresses: delivery.bcc_addresses,
      reply_to: delivery.reply_to,
      from_name: delivery.from_name,
      subject: delivery.subject,
      body_text: delivery.body_text,
      provider: delivery.provider,
      error_code: delivery.error_code,
      document_attachment_id: delivery.document_attachment_id,
      attachment_filename: delivery.attachment_filename,
      sent_at: delivery.sent_at,
      failed_at: delivery.failed_at,
      created_at: delivery.created_at,
    }))

    return NextResponse.json(
      { data: visibleDeliveries },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  },
)
