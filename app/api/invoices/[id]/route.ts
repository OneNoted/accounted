import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { requireCompanyId } from '@/lib/company/context'
import { requireWritePermission } from '@/lib/auth/require-write'
import { errorResponseFromCode } from '@/lib/errors/get-structured-error'
import { createLogger } from '@/lib/logger'

const log = createLogger('api.invoices.delete')

/**
 * DELETE /api/invoices/[id]
 *
 * Permanently deletes a draft invoice and its items.
 *
 * Two preconditions:
 *   1. status === 'draft' — committed invoices are immutable per BFL and
 *      must be reversed via credit note.
 *   2. invoice_number IS NULL — a draft that already holds an F-series
 *      number is a side effect of an interrupted send/convert/mark-sent.
 *      Destroying it would orphan the number and create a permanent gap
 *      in the verifications series. Refuse and let the user retry the
 *      send instead (ensureInvoiceNumber is idempotent).
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

  if (invoice.invoice_number !== null) {
    return errorResponseFromCode('INVOICE_DELETE_NUMBERED', log, {
      details: { invoice_number: invoice.invoice_number },
    })
  }

  const { error: itemsError } = await supabase
    .from('invoice_items')
    .delete()
    .eq('invoice_id', id)

  if (itemsError) {
    return NextResponse.json({ error: itemsError.message }, { status: 500 })
  }

  const { error: deleteError } = await supabase
    .from('invoices')
    .delete()
    .eq('id', id)
    .eq('company_id', companyId)

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ data: { deleted: true } })
}
