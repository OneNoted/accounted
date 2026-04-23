import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { eventBus } from '@/lib/events'
import { ensureInitialized } from '@/lib/init'
import { reverseEntry } from '@/lib/bookkeeping/engine'
import { AccountsNotInChartError, accountsNotInChartResponse } from '@/lib/bookkeeping/errors'
import { getErrorMessage } from '@/lib/errors/get-error-message'
import { requireCompanyId } from '@/lib/company/context'
import { requireWritePermission } from '@/lib/auth/require-write'
import type { SupplierInvoice, SupplierInvoicePayment } from '@/types'

ensureInitialized()

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { id } = await params

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const writeCheck = await requireWritePermission(supabase, user.id)
  if (!writeCheck.ok) return writeCheck.response

  const companyId = await requireCompanyId(supabase, user.id)

  const { data: original, error: fetchError } = await supabase
    .from('supplier_invoices')
    .select('*, payments:supplier_invoice_payments(*)')
    .eq('id', id)
    .eq('company_id', companyId)
    .single()

  if (fetchError || !original) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Idempotent no-op: an already-uncredited or never-credited invoice just returns the row.
  // Friendlier than a 409 — the client retry path can blindly call this without checking first.
  if (original.status !== 'credited') {
    return NextResponse.json({ data: original })
  }

  const { data: creditNote } = await supabase
    .from('supplier_invoices')
    .select('id, registration_journal_entry_id')
    .eq('company_id', companyId)
    .eq('credited_invoice_id', id)
    .eq('is_credit_note', true)
    .maybeSingle()

  let reversalEntryId: string | null = null

  if (creditNote?.registration_journal_entry_id) {
    try {
      const reversal = await reverseEntry(
        supabase,
        companyId,
        user.id,
        creditNote.registration_journal_entry_id
      )
      reversalEntryId = reversal.id
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Already reversed (manually or by another concurrent uncredit) — fine, continue.
      if (
        /Can only reverse posted entries/i.test(msg) ||
        /already reversed by a concurrent operation/i.test(msg)
      ) {
        // proceed to row cleanup
      } else if (err instanceof AccountsNotInChartError) {
        return accountsNotInChartResponse(err)
      } else {
        // Period lock and similar trigger errors — surface a clear Swedish message
        // so the user knows WHY the action failed (per project's error-UX guidelines).
        return NextResponse.json(
          { error: getErrorMessage(err, { context: 'supplier_invoice' }) },
          { status: 400 }
        )
      }
    }
  }

  if (creditNote) {
    await supabase.from('supplier_invoice_items').delete().eq('supplier_invoice_id', creditNote.id)
    const { error: deleteError } = await supabase
      .from('supplier_invoices')
      .delete()
      .eq('id', creditNote.id)
      .eq('company_id', companyId)

    if (deleteError) {
      return NextResponse.json(
        { error: getErrorMessage(deleteError, { context: 'supplier_invoice' }) },
        { status: 500 }
      )
    }
  }

  // Recompute original status from payments. The credit had reduced remaining_amount
  // to 0 and bumped status to 'credited' — undo both based on what's actually paid.
  const payments = (original.payments as SupplierInvoicePayment[]) || []
  const paidSum = payments.reduce((sum, p) => sum + (p.amount || 0), 0)
  const total = original.total || 0
  const remaining = Math.round((total - paidSum) * 100) / 100

  let newStatus: SupplierInvoice['status']
  if (paidSum >= total && total > 0) {
    newStatus = 'paid'
  } else if (paidSum > 0) {
    newStatus = 'partially_paid'
  } else if (original.due_date && new Date(original.due_date) < new Date()) {
    newStatus = 'overdue'
  } else {
    // Original had a registration JE (or it could not have been credited),
    // so 'approved' is the safe restoration target.
    newStatus = 'approved'
  }

  const { data: restored, error: updateError } = await supabase
    .from('supplier_invoices')
    .update({
      status: newStatus,
      remaining_amount: remaining,
    })
    .eq('id', id)
    .eq('company_id', companyId)
    .select()
    .single()

  if (updateError || !restored) {
    return NextResponse.json(
      { error: getErrorMessage(updateError, { context: 'supplier_invoice' }) },
      { status: 500 }
    )
  }

  try {
    await eventBus.emit({
      type: 'supplier_invoice.uncredited',
      payload: {
        supplierInvoice: restored as SupplierInvoice,
        deletedCreditNoteId: creditNote?.id ?? '',
        reversalEntryId,
        userId: user.id,
        companyId,
      },
    })
  } catch {
    // Non-blocking
  }

  return NextResponse.json({
    data: restored,
    reversal_entry_id: reversalEntryId,
  })
}
