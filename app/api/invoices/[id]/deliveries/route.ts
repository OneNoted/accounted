import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withRouteContext } from '@/lib/api/with-route-context'
import { errorResponseFromCode } from '@/lib/errors/get-structured-error'

const DELIVERY_COLUMNS = [
  'id',
  'channel',
  'status',
  'to_addresses',
  'cc_addresses',
  'reply_to',
  'from_name',
  'subject',
  'body_text',
  'provider',
  'provider_message_id',
  'error_code',
  'document_attachment_id',
  'attachment_filename',
  'attachment_content_type',
  'attachment_sha256',
  'sent_at',
  'failed_at',
  'created_at',
].join(', ')

/**
 * GET /api/invoices/[id]/deliveries
 *
 * Returns immutable delivery attempts for an invoice. The HTML body is
 * deliberately excluded so the UI never needs to render stored HTML.
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
      .order('created_at', { ascending: false })

    if (error) {
      log.error('failed to list invoice deliveries', error, { invoiceId: id })
      throw error
    }

    return NextResponse.json({ data: deliveries || [] })
  },
)
