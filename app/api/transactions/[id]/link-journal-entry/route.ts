/**
 * POST /api/transactions/[id]/link-journal-entry
 *
 * Link a bank transaction to an already-posted journal entry without
 * creating new bookkeeping. Used by the duplicate-payment UI when the user
 * confirms the suggested candidate already books this receipt — typically
 * a manual verifikation made outside the match-invoice flow.
 *
 * Body:
 *   - journal_entry_id (required): the existing posted JE to link to.
 *   - invoice_id (optional): when supplied, also inserts an
 *     invoice_payments row pointing at the existing JE and flips the
 *     invoice status to 'paid' / 'partially_paid'. Same optimistic-lock
 *     pattern as match-invoice. Omit when linking against a JE that
 *     doesn't relate to a customer invoice (uncommon but supported).
 *
 * Effects:
 *   - transactions.journal_entry_id = je_id
 *   - transactions.is_business = true
 *   - transactions.potential_invoice_id = null
 *   - transactions.potential_supplier_invoice_id = null
 *   - if invoice_id provided:
 *     - invoice_payments row inserted (transaction_id, amount, journal_entry_id)
 *     - invoice.status / paid_amount / remaining_amount updated
 *
 * NEVER creates a new journal entry; the underlying double-entry already
 * exists. The match log records 'linked_to_existing_voucher' for audit.
 */
import { NextResponse } from 'next/server'
import { withRouteContext } from '@/lib/api/with-route-context'
import { errorResponse, errorResponseFromCode } from '@/lib/errors/get-structured-error'
import { validateBody } from '@/lib/api/validate'
import { LinkTransactionJournalEntrySchema } from '@/lib/api/schemas'
import { logMatchEvent } from '@/lib/invoices/match-log'
import { eventBus } from '@/lib/events/bus'
import { ensureInitialized } from '@/lib/init'
import type { Invoice, Transaction } from '@/types'

ensureInitialized()

export const POST = withRouteContext(
  'transaction.link_journal_entry',
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id: transactionId } = await params
    const { user, supabase, companyId, log, requestId } = ctx

    const validation = await validateBody(request, LinkTransactionJournalEntrySchema, {
      log,
      operation: 'transaction.link_journal_entry',
    })
    if (!validation.success) return validation.response
    const { journal_entry_id, invoice_id } = validation.data

    const txLog = log.child({ transactionId, journalEntryId: journal_entry_id, invoiceId: invoice_id })

    const { data: transaction, error: fetchTxError } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', transactionId)
      .eq('company_id', companyId)
      .single()

    if (fetchTxError || !transaction) {
      return errorResponseFromCode('TX_CATEGORIZE_TX_NOT_FOUND', txLog, { requestId })
    }

    if (transaction.journal_entry_id) {
      return errorResponseFromCode('LINK_TX_TX_ALREADY_LINKED', txLog, {
        requestId,
        details: { existingJournalEntryId: transaction.journal_entry_id },
      })
    }

    const { data: journalEntry, error: fetchJeError } = await supabase
      .from('journal_entries')
      .select('id, status, voucher_series, voucher_number, entry_date')
      .eq('id', journal_entry_id)
      .eq('company_id', companyId)
      .single()

    if (fetchJeError || !journalEntry) {
      return errorResponseFromCode('LINK_TX_JE_NOT_FOUND', txLog, { requestId })
    }

    if (journalEntry.status !== 'posted') {
      return errorResponseFromCode('LINK_TX_JE_NOT_POSTED', txLog, {
        requestId,
        details: { currentStatus: journalEntry.status },
      })
    }

    // If invoice_id supplied, validate + prepare invoice update.
    let invoice: (Invoice & { customer?: { name?: string } | null }) | null = null
    let newPaidAmount = 0
    let newRemaining = 0
    let isFullyPaid = false
    let newStatus: 'paid' | 'partially_paid' = 'paid'

    if (invoice_id) {
      const { data: invoiceRow, error: fetchInvError } = await supabase
        .from('invoices')
        .select('*, customer:customers(name)')
        .eq('id', invoice_id)
        .eq('company_id', companyId)
        .single()

      if (fetchInvError || !invoiceRow) {
        return errorResponseFromCode('LINK_TX_INVOICE_NOT_FOUND', txLog, { requestId })
      }

      if (
        invoiceRow.status !== 'sent' &&
        invoiceRow.status !== 'overdue' &&
        invoiceRow.status !== 'partially_paid'
      ) {
        return errorResponseFromCode('LINK_TX_INVOICE_NOT_OPEN', txLog, {
          requestId,
          details: { currentStatus: invoiceRow.status },
        })
      }

      invoice = invoiceRow as Invoice & { customer?: { name?: string } | null }

      const paidAmount = transaction.amount
      newPaidAmount = Math.round(((invoice.paid_amount || 0) + paidAmount) * 100) / 100
      const currentRemaining = invoice.remaining_amount ?? (invoice.total - (invoice.paid_amount || 0))
      newRemaining = Math.max(0, Math.round((currentRemaining - paidAmount) * 100) / 100)
      isFullyPaid = newRemaining <= 0
      newStatus = isFullyPaid ? 'paid' : 'partially_paid'
    }

    // Link the transaction first. If a subsequent step fails we'll surface
    // an error; the link itself is reversible via unlink-journal-entry (or
    // by setting potential_invoice_id back from the match log). Doing the
    // tx update before the invoice update preserves the "transaction
    // disappears from inbox" UX even if invoice update races.
    const { error: updateTxError } = await supabase
      .from('transactions')
      .update({
        journal_entry_id,
        invoice_id: invoice_id ?? null,
        potential_invoice_id: null,
        potential_supplier_invoice_id: null,
        is_business: true,
      })
      .eq('id', transactionId)
      .eq('company_id', companyId)
      .is('journal_entry_id', null)

    if (updateTxError) {
      txLog.error('failed to link transaction to journal entry', updateTxError)
      return errorResponse(updateTxError, txLog, { requestId })
    }

    const now = new Date().toISOString()

    if (invoice && invoice_id) {
      // Optimistic lock: only flip status if invoice is still matchable.
      const { data: updatedRows, error: updateInvError } = await supabase
        .from('invoices')
        .update({
          status: newStatus,
          paid_at: isFullyPaid ? now : null,
          paid_amount: newPaidAmount,
          remaining_amount: newRemaining,
        })
        .eq('id', invoice_id)
        .eq('company_id', companyId)
        .in('status', ['sent', 'overdue', 'partially_paid'])
        .select('id')

      if (updateInvError) {
        txLog.error('failed to update invoice status', updateInvError)
        return errorResponse(updateInvError, txLog, { requestId })
      }

      if (!updatedRows || updatedRows.length === 0) {
        return errorResponseFromCode('LINK_TX_INVOICE_RACE', txLog, { requestId })
      }

      const { error: paymentInsertError } = await supabase
        .from('invoice_payments')
        .insert({
          user_id: user.id,
          company_id: companyId,
          invoice_id,
          payment_date: transaction.date,
          amount: transaction.amount,
          currency: invoice.currency,
          exchange_rate: invoice.exchange_rate,
          journal_entry_id,
          transaction_id: transactionId,
          notes: 'Kopplad till befintlig verifikation (ingen ny bokföring skapad)',
        })

      if (paymentInsertError && paymentInsertError.code !== '23505') {
        // Don't roll back the tx link — surface the partial state. The
        // invoice ledger may now be inconsistent with paid_amount; the user
        // can correct via the invoice page if needed.
        txLog.error('failed to record invoice payment (link succeeded)', paymentInsertError)
        return errorResponseFromCode('MATCH_INVOICE_RECORD_PAYMENT_FAILED', txLog, { requestId })
      }
    }

    logMatchEvent(supabase, user.id, transactionId, 'linked_to_existing_voucher', {
      invoiceId: invoice_id,
      newState: {
        journal_entry_id,
        invoice_id: invoice_id ?? null,
        invoice_status: invoice ? newStatus : null,
      },
    })

    if (invoice && invoice_id) {
      try {
        eventBus.emit({
          type: 'invoice.match_confirmed',
          payload: {
            invoice: invoice as Invoice,
            transaction: transaction as Transaction,
            userId: user.id,
            companyId,
          },
        })
      } catch (err) {
        txLog.warn('invoice.match_confirmed event emission failed', err as Error)
      }
    }

    return NextResponse.json({
      success: true,
      journal_entry_id,
      voucher_label: `${journalEntry.voucher_series ?? 'A'}${journalEntry.voucher_number ?? ''}`,
      invoice_id: invoice_id ?? null,
      invoice_status: invoice ? newStatus : null,
      paid_amount: invoice ? newPaidAmount : null,
      remaining_amount: invoice ? newRemaining : null,
    })
  },
  { requireWrite: true },
)
