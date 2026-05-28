import { NextResponse } from 'next/server'
import { withRouteContext } from '@/lib/api/with-route-context'
import { errorResponseFromCode } from '@/lib/errors/get-structured-error'
import { findMatchingVouchersForInvoice } from '@/lib/invoices/voucher-matching'
import type { Invoice, Customer } from '@/types'

/**
 * GET /api/invoices/[id]/voucher-candidates
 *
 * Returns posted verifikat candidates that could be linked as payment for
 * this invoice. Used by the "Befintlig verifikation" tab in
 * PaymentBookingDialog to auto-suggest matches.
 */
export const GET = withRouteContext(
  'invoice.voucher_candidates',
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const { supabase, companyId, log, requestId } = ctx

    const { data: invoice, error } = await supabase
      .from('invoices')
      .select('*, customer:customers(*)')
      .eq('id', id)
      .eq('company_id', companyId)
      .single()

    if (error || !invoice) {
      return errorResponseFromCode('LINK_VOUCHER_INVOICE_NOT_FOUND', log, { requestId })
    }

    if (!['sent', 'overdue', 'partially_paid'].includes(invoice.status)) {
      return NextResponse.json({ data: { candidates: [], invoice_status: invoice.status } })
    }

    const candidates = await findMatchingVouchersForInvoice(
      supabase,
      companyId,
      invoice as Invoice & { customer?: Customer }
    )

    return NextResponse.json({ data: { candidates } })
  },
)
