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
  | 'provider'
  | 'error_code'
  | 'document_attachment_id'
  | 'sent_at'
  | 'failed_at'
  | 'created_at'
>

/**
 * GET /api/invoices/[id]/deliveries
 *
 * Returns minimized delivery metadata for an invoice. Exact message content,
 * BCC recipients, provider identifiers, checksums, and full recipient
 * addresses stay server-side. The database allow-list and masking boundary is
 * defined by list_invoice_delivery_summaries in migration 20260723003000; this
 * route masks returned addresses again as defense in depth.
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

    const { data: deliveries, error } = await supabase.rpc(
      'list_invoice_delivery_summaries',
      { p_company_id: companyId, p_invoice_id: id },
    )

    if (error) {
      log.error('failed to list invoice deliveries', error, { invoiceId: id })
      throw error
    }

    const minimized = ((deliveries || []) as unknown as DeliveryListRow[]).map((delivery) => ({
      id: delivery.id,
      channel: delivery.channel,
      status: delivery.status,
      to_addresses: delivery.to_addresses.map(maskRecipientDomain),
      cc_addresses: delivery.cc_addresses.map(maskRecipientDomain),
      provider: delivery.provider,
      error_code: delivery.error_code,
      document_attachment_id: delivery.document_attachment_id,
      sent_at: delivery.sent_at,
      failed_at: delivery.failed_at,
      created_at: delivery.created_at,
    }))

    return NextResponse.json(
      { data: minimized },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  },
)

function maskRecipientDomain(address: string): string {
  const separator = address.lastIndexOf('@')
  if (separator <= 0 || separator === address.length - 1) return '***'
  return `***@${address.slice(separator + 1)}`
}
