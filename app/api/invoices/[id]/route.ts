import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { requireCompanyId } from '@/lib/company/context'
import { requireWritePermission } from '@/lib/auth/require-write'
import { errorResponseFromCode } from '@/lib/errors/get-structured-error'
import { createLogger } from '@/lib/logger'

const log = createLogger('api.invoices.cancel')

/**
 * DELETE /api/invoices/[id]
 *
 * Cancels (makulerar) a draft invoice. The row and its F-series number are
 * retained — the invoice transitions to status='cancelled'. Keeping the row
 * preserves the invoice-number sequence per ML 17 kap 24§ and BFNAR 2013:2,
 * so the F-series stays gap-free without any voucher_gap_explanations entry.
 *
 * Only drafts may be cancelled this way. Sent / paid invoices are immutable
 * per BFL and must be reversed via a credit note instead.
 *
 * Old drafts predating allocate-on-save may have invoice_number = NULL; those
 * still cancel (status flip) without consuming a number — no special-case path.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const writeCheck = await requireWritePermission(supabase, user.id)
  if (!writeCheck.ok) return writeCheck.response

  const companyId = await requireCompanyId(supabase, user.id)

  const { data: invoice, error: fetchError } = await supabase
    .from('invoices')
    .select('id, status, invoice_number, user_id')
    .eq('id', id)
    .eq('company_id', companyId)
    .single()

  if (fetchError || !invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }

  if (invoice.status !== 'draft') {
    return errorResponseFromCode('INVOICE_DELETE_NOT_DRAFT', log)
  }

  const { error: cancelError } = await supabase
    .from('invoices')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', companyId)
    .eq('status', 'draft')

  if (cancelError) {
    return NextResponse.json({ error: cancelError.message }, { status: 500 })
  }

  return NextResponse.json({ data: { cancelled: true, invoice_number: invoice.invoice_number } })
}
