import type { SupabaseClient } from '@supabase/supabase-js'
import type { JournalEntry } from '@/types'

export const PAYMENT_SOURCE_TYPES = [
  'invoice_paid',
  'invoice_cash_payment',
  'supplier_invoice_paid',
  'supplier_invoice_cash_payment',
] as const

export function isPaymentSourceType(sourceType: string | null | undefined): boolean {
  if (!sourceType) return false
  return (PAYMENT_SOURCE_TYPES as readonly string[]).includes(sourceType)
}

/**
 * Revert the business-level paid status on the invoice or supplier invoice
 * that a payment journal entry was attached to. Used by both reverseEntry()
 * (storno) and the DELETE journal entry route — both paths leave the GL in a
 * consistent state but the invoice's status/paid_amount/paid_at would otherwise
 * stay stuck on "paid".
 *
 * Safe to call with any entry — returns early if source_type is not a payment.
 */
export async function syncInvoiceStatusFromPaymentEntry(
  supabase: SupabaseClient,
  companyId: string,
  entry: Pick<JournalEntry, 'id' | 'source_type' | 'source_id'>
): Promise<void> {
  if (!isPaymentSourceType(entry.source_type) || !entry.source_id) return

  const entryId = entry.id

  if (entry.source_type.startsWith('supplier_invoice')) {
    const { data: payment } = await supabase
      .from('supplier_invoice_payments')
      .select('amount')
      .eq('journal_entry_id', entryId)
      .single()

    const { data: supplierInvoice } = await supabase
      .from('supplier_invoices')
      .select('paid_amount, total_amount, due_date')
      .eq('id', entry.source_id)
      .eq('company_id', companyId)
      .single()

    if (supplierInvoice && payment) {
      const newPaidAmount = Math.round((supplierInvoice.paid_amount - payment.amount) * 100) / 100
      const newRemaining = Math.round((supplierInvoice.total_amount - Math.max(0, newPaidAmount)) * 100) / 100
      let newStatus: string
      if (newPaidAmount > 0) {
        newStatus = 'partially_paid'
      } else if (supplierInvoice.due_date && new Date(supplierInvoice.due_date) < new Date()) {
        newStatus = 'overdue'
      } else {
        newStatus = 'approved'
      }

      await supabase
        .from('supplier_invoices')
        .update({
          status: newStatus,
          paid_amount: Math.max(0, newPaidAmount),
          remaining_amount: newRemaining,
          paid_at: null,
          payment_journal_entry_id: null,
        })
        .eq('id', entry.source_id)
        .eq('company_id', companyId)
    }

    // Remove the payment row(s) tied to the reversed voucher so a re-match of
    // the same bank line doesn't double-count or trip the unique index on
    // supplier_invoice_payments. Capture the linked transaction id first so the
    // bank line can be released back to the inbox.
    const { data: spRows } = await supabase
      .from('supplier_invoice_payments')
      .select('transaction_id')
      .eq('journal_entry_id', entryId)
      .eq('company_id', companyId)

    await supabase
      .from('supplier_invoice_payments')
      .delete()
      .eq('journal_entry_id', entryId)
      .eq('company_id', companyId)

    await releaseLinkedTransactions(
      supabase,
      companyId,
      entryId,
      (spRows ?? []).map((r) => (r as { transaction_id: string | null }).transaction_id),
      'supplier_invoice_id',
    )
  } else {
    const { data: payment } = await supabase
      .from('invoice_payments')
      .select('amount')
      .eq('journal_entry_id', entryId)
      .single()

    const { data: customerInvoice } = await supabase
      .from('invoices')
      .select('paid_amount, total, due_date')
      .eq('id', entry.source_id)
      .eq('company_id', companyId)
      .single()

    if (customerInvoice) {
      // For a partial reversal we take the exact amount from the payment row.
      // The fallback (full paid_amount) only applies when no payment row exists
      // — true for invoice_cash_payment, which is only ever booked on a FULL
      // payment, so reverting the whole paid_amount is correct there. Guarding
      // this keeps a future partial-cash path from over-reverting.
      const paymentAmount = payment?.amount ?? customerInvoice.paid_amount
      const newPaidAmount = Math.round((customerInvoice.paid_amount - paymentAmount) * 100) / 100
      const safePaidAmount = Math.max(0, newPaidAmount)
      // The supplier branch already resets remaining_amount; the customer branch
      // never did, leaving it stale (= total) after a reversal so the invoice
      // showed fully unpaid yet stuck on 'paid'. Recompute from total. (The
      // .in('status', …) guard below can leave status/remaining un-updated if
      // the invoice isn't paid/partially_paid — only reachable on a non-storno
      // path; the payment-row delete + tx release still run, freeing the line.)
      const newRemaining = Math.round((customerInvoice.total - safePaidAmount) * 100) / 100
      const revertStatus = newPaidAmount > 0
        ? 'partially_paid'
        : customerInvoice.due_date && new Date(customerInvoice.due_date) < new Date()
          ? 'overdue'
          : 'sent'

      await supabase
        .from('invoices')
        .update({
          status: revertStatus,
          paid_at: null,
          paid_amount: safePaidAmount,
          remaining_amount: newRemaining,
        })
        .eq('id', entry.source_id)
        .eq('company_id', companyId)
        .in('status', ['paid', 'partially_paid'])
    }

    // Remove the payment row(s) tied to the reversed voucher so a re-match of
    // the same bank line doesn't trip the (transaction_id, invoice_id) /
    // (journal_entry_id, invoice_id) unique indexes on invoice_payments.
    const { data: ipRows } = await supabase
      .from('invoice_payments')
      .select('transaction_id')
      .eq('journal_entry_id', entryId)
      .eq('company_id', companyId)

    await supabase
      .from('invoice_payments')
      .delete()
      .eq('journal_entry_id', entryId)
      .eq('company_id', companyId)

    await releaseLinkedTransactions(
      supabase,
      companyId,
      entryId,
      (ipRows ?? []).map((r) => (r as { transaction_id: string | null }).transaction_id),
      'invoice_id',
    )
  }
}

/**
 * Detach any bank transactions still pointing at a reversed payment voucher so
 * the bank line returns to the inbox and becomes re-matchable. Without this, a
 * standalone storno (the reverse route / MCP reverse tool / delete-last-voucher)
 * leaves transactions.journal_entry_id pointing at a reversed JE — the match
 * POST refuses (invoice no longer matchable once we also fix its status) and the
 * line can't be re-booked or deleted. The match-invoice route already clears the
 * tx when IT stornos a conflicting auto-categorization JE; this covers every
 * other reversal path.
 *
 * Clears by journal_entry_id (covers the link even when the payment row was
 * missing) and by the captured payment-row transaction ids (covers a partial
 * match that cleared journal_entry_id but left invoice_id/category set). Only
 * the link/categorization columns are reset; the transaction row is preserved.
 */
async function releaseLinkedTransactions(
  supabase: SupabaseClient,
  companyId: string,
  entryId: string,
  paymentTransactionIds: Array<string | null>,
  invoiceColumn: 'invoice_id' | 'supplier_invoice_id',
): Promise<void> {
  const resetFields = {
    journal_entry_id: null,
    [invoiceColumn]: null,
    is_business: null,
    category: null,
  }

  await supabase
    .from('transactions')
    .update(resetFields)
    .eq('company_id', companyId)
    .eq('journal_entry_id', entryId)

  const txIds = paymentTransactionIds.filter((id): id is string => !!id)
  if (txIds.length > 0) {
    await supabase
      .from('transactions')
      .update(resetFields)
      .eq('company_id', companyId)
      .in('id', txIds)
  }
}
