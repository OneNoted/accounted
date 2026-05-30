/**
 * Link a bank transaction to an already-posted journal entry without creating
 * new bookkeeping. Optionally settle a customer invoice in the same call by
 * inserting an invoice_payments row pointing at the existing JE and flipping
 * the invoice status with an optimistic-lock pattern.
 *
 * Shared between two callers:
 *   - REST: app/api/transactions/[id]/link-journal-entry/route.ts
 *     (duplicate-payment UI: user confirms the suggested existing voucher)
 *   - MCP commit handler: lib/pending-operations/commit.ts
 *     (gnubok_link_transaction_to_journal_entry — agent-staged operation)
 *
 * NEVER creates a new journal entry. The match log records
 * 'linked_to_existing_voucher' for audit on success.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { eventBus } from '@/lib/events/bus'
import { logMatchEvent } from '@/lib/invoices/match-log'
import { createLogger } from '@/lib/logger'
import type { Invoice, Transaction } from '@/types'

const log = createLogger('transactions/link-journal-entry')

// Codes returned by linkTransactionToJournalEntry. All map to entries in
// lib/errors/structured-errors.ts so both callers (REST route, MCP commit
// handler) can surface the right HTTP status and the localized message.
// The TX-not-found case reuses the shared TX_CATEGORIZE_TX_NOT_FOUND code
// rather than a link-specific one — it predates this route and is the
// canonical "bank tx not found in this company" envelope.
export type LinkTransactionJournalEntryErrorCode =
  | 'TX_CATEGORIZE_TX_NOT_FOUND'
  | 'LINK_TX_TX_ALREADY_LINKED'
  | 'LINK_TX_JE_NOT_FOUND'
  | 'LINK_TX_JE_NOT_POSTED'
  | 'LINK_TX_INVOICE_NOT_FOUND'
  | 'LINK_TX_INVOICE_NOT_OPEN'
  | 'LINK_TX_INVOICE_RACE'
  | 'MATCH_INVOICE_RECORD_PAYMENT_FAILED'
  | 'LINK_TX_DB_ERROR'

export interface LinkTransactionJournalEntryParams {
  transactionId: string
  journalEntryId: string
  invoiceId?: string
}

export interface LinkTransactionJournalEntryResult {
  transactionId: string
  journalEntryId: string
  voucherLabel: string
  invoiceId: string | null
  invoiceStatus: 'paid' | 'partially_paid' | null
  paidAmount: number | null
  remainingAmount: number | null
}

export type LinkTransactionJournalEntryOutcome =
  | { ok: true; result: LinkTransactionJournalEntryResult }
  | { ok: false; code: LinkTransactionJournalEntryErrorCode; details?: Record<string, unknown> }

/**
 * Canonical verifikat-label format: `${series}-${number}` (e.g. "A-12").
 * Centralised so the MCP staging preview and the committed result can't
 * diverge — divergence is a BFL 5 kap 7§ traceability hazard because the
 * verifikationsserie label that ends up in the audit trail must match the
 * label the user saw at approval time.
 *
 * Fallbacks ('A' series, empty number) are defensive only; in practice a
 * posted verifikat always has both. Callers should never construct this
 * string inline — import this helper instead.
 */
export function formatVoucherLabel(
  voucherSeries: string | null | undefined,
  voucherNumber: number | string | null | undefined,
): string {
  const series = voucherSeries ?? 'A'
  const num = voucherNumber ?? ''
  return num === '' ? series : `${series}-${num}`
}

export async function linkTransactionToJournalEntry(
  supabase: SupabaseClient,
  userId: string,
  companyId: string,
  params: LinkTransactionJournalEntryParams
): Promise<LinkTransactionJournalEntryOutcome> {
  const { transactionId, journalEntryId, invoiceId } = params

  // Data minimization (GDPR Art.5(1)(c)): pull only the columns needed for
  // validation, optimistic-lock invoice update, invoice_payments insert, and
  // the compensating-rollback path. No select('*').
  const { data: transaction, error: fetchTxError } = await supabase
    .from('transactions')
    .select(
      'id, date, amount, currency, exchange_rate, journal_entry_id, invoice_id, is_business, potential_invoice_id, potential_supplier_invoice_id'
    )
    .eq('id', transactionId)
    .eq('company_id', companyId)
    .single()

  if (fetchTxError || !transaction) {
    return { ok: false, code: 'TX_CATEGORIZE_TX_NOT_FOUND' }
  }

  if (transaction.journal_entry_id) {
    return {
      ok: false,
      code: 'LINK_TX_TX_ALREADY_LINKED',
      details: { existingJournalEntryId: transaction.journal_entry_id as string },
    }
  }

  const { data: journalEntry, error: fetchJeError } = await supabase
    .from('journal_entries')
    .select('id, status, voucher_series, voucher_number, entry_date')
    .eq('id', journalEntryId)
    .eq('company_id', companyId)
    .single()

  if (fetchJeError || !journalEntry) {
    return { ok: false, code: 'LINK_TX_JE_NOT_FOUND' }
  }

  if (journalEntry.status !== 'posted') {
    return {
      ok: false,
      code: 'LINK_TX_JE_NOT_POSTED',
      details: { currentStatus: journalEntry.status as string },
    }
  }

  let invoice:
    | (Pick<
        Invoice,
        | 'id'
        | 'status'
        | 'total'
        | 'paid_amount'
        | 'remaining_amount'
        | 'currency'
        | 'exchange_rate'
        | 'paid_at'
        | 'invoice_number'
      > & { customer?: { name?: string } | null })
    | null = null
  let newPaidAmount = 0
  let newRemaining = 0
  let isFullyPaid = false
  let newStatus: 'paid' | 'partially_paid' = 'paid'

  if (invoiceId) {
    // Data minimization (GDPR Art.5(1)(c) / SOC 2 CC6.1): explicit column
    // list rather than select('*, customer:customers(name)'). Adding new
    // PII columns to invoices won't silently widen this fetch.
    const { data: invoiceRow, error: fetchInvError } = await supabase
      .from('invoices')
      .select(
        'id, status, total, paid_amount, remaining_amount, currency, exchange_rate, paid_at, invoice_number, customer:customers(name)'
      )
      .eq('id', invoiceId)
      .eq('company_id', companyId)
      .single()

    if (fetchInvError || !invoiceRow) {
      return { ok: false, code: 'LINK_TX_INVOICE_NOT_FOUND' }
    }

    if (
      invoiceRow.status !== 'sent' &&
      invoiceRow.status !== 'overdue' &&
      invoiceRow.status !== 'partially_paid'
    ) {
      return {
        ok: false,
        code: 'LINK_TX_INVOICE_NOT_OPEN',
        details: { currentStatus: invoiceRow.status as string },
      }
    }

    invoice = invoiceRow as typeof invoice

    const paidAmount = transaction.amount as number
    newPaidAmount = Math.round(((invoice!.paid_amount || 0) + paidAmount) * 100) / 100
    const currentRemaining =
      invoice!.remaining_amount ?? invoice!.total - (invoice!.paid_amount || 0)
    newRemaining = Math.max(0, Math.round((currentRemaining - paidAmount) * 100) / 100)
    isFullyPaid = newRemaining <= 0
    newStatus = isFullyPaid ? 'paid' : 'partially_paid'
  }

  // Snapshot tx state so the compensating-rollback path can restore the row
  // if a subsequent step fails — otherwise a partial state would persist
  // (tx linked, invoice unchanged, no payment row).
  const priorTxState = {
    journal_entry_id: transaction.journal_entry_id, // validated null above
    invoice_id: transaction.invoice_id,
    potential_invoice_id: transaction.potential_invoice_id,
    potential_supplier_invoice_id: transaction.potential_supplier_invoice_id,
    is_business: transaction.is_business,
  }

  const { error: updateTxError } = await supabase
    .from('transactions')
    .update({
      journal_entry_id: journalEntryId,
      invoice_id: invoiceId ?? null,
      potential_invoice_id: null,
      potential_supplier_invoice_id: null,
      is_business: true,
    })
    .eq('id', transactionId)
    .eq('company_id', companyId)
    .is('journal_entry_id', null)

  if (updateTxError) {
    return { ok: false, code: 'LINK_TX_DB_ERROR', details: { reason: updateTxError.message } }
  }

  async function rollbackTxLink(reason: string): Promise<void> {
    const { error: rollbackErr } = await supabase
      .from('transactions')
      .update(priorTxState)
      .eq('id', transactionId)
      .eq('company_id', companyId)
    if (rollbackErr) {
      // GDPR Art.5(1)(f) / SOC 2 CC7.2: surface partial-state gaps so a
      // reconciliation job can pick them up. ID-only payload — no amounts,
      // no counterparty names — keeps the log within data-minimization
      // bounds while still being actionable.
      log.warn('failed to roll back transaction link after subsequent step failed', {
        companyId,
        transactionId,
        journalEntryId,
        reason,
        rollbackError: rollbackErr.message,
      })
    }
  }

  const now = new Date().toISOString()

  if (invoice && invoiceId) {
    const { data: updatedRows, error: updateInvError } = await supabase
      .from('invoices')
      .update({
        status: newStatus,
        paid_at: isFullyPaid ? now : null,
        paid_amount: newPaidAmount,
        remaining_amount: newRemaining,
      })
      .eq('id', invoiceId)
      .eq('company_id', companyId)
      .in('status', ['sent', 'overdue', 'partially_paid'])
      .select('id')

    if (updateInvError) {
      await rollbackTxLink('invoice update errored')
      return { ok: false, code: 'LINK_TX_DB_ERROR', details: { reason: updateInvError.message } }
    }

    if (!updatedRows || updatedRows.length === 0) {
      await rollbackTxLink('invoice optimistic lock returned 0 rows')
      return { ok: false, code: 'LINK_TX_INVOICE_RACE' }
    }

    // BFL 5 kap 2§ + ML 8 kap 21–23§: the payment row must record the rate
    // effective on the PAYMENT date, not the invoice-creation date. Using
    // transaction.exchange_rate (set by the bank-feed/import pipeline at the
    // tx date) means a foreign-currency invoice's payment row carries the
    // correct rate for downstream FX-diff reporting. The full 3960/7960
    // posting still lives in createInvoicePaymentJournalEntry — link-to-
    // existing-voucher never creates new lines by contract.
    const paymentExchangeRate =
      transaction.exchange_rate ?? invoice.exchange_rate ?? null

    const { error: paymentInsertError } = await supabase
      .from('invoice_payments')
      .insert({
        user_id: userId,
        company_id: companyId,
        invoice_id: invoiceId,
        payment_date: transaction.date,
        amount: transaction.amount,
        currency: invoice.currency,
        exchange_rate: paymentExchangeRate,
        journal_entry_id: journalEntryId,
        transaction_id: transactionId,
        notes: 'Kopplad till befintlig verifikation (ingen ny bokföring skapad)',
      })

    if (paymentInsertError && paymentInsertError.code !== '23505') {
      const { error: invRevertErr } = await supabase
        .from('invoices')
        .update({
          status: invoice.status,
          paid_at: invoice.paid_at ?? null,
          paid_amount: invoice.paid_amount ?? 0,
          remaining_amount: invoice.remaining_amount ?? invoice.total,
        })
        .eq('id', invoiceId)
        .eq('company_id', companyId)
      if (invRevertErr) {
        log.warn('failed to revert invoice status after payment insert failed', {
          companyId,
          invoiceId,
          rollbackError: invRevertErr.message,
        })
      }
      await rollbackTxLink('invoice_payments insert failed')
      return { ok: false, code: 'MATCH_INVOICE_RECORD_PAYMENT_FAILED' }
    }
  }

  logMatchEvent(supabase, userId, transactionId, 'linked_to_existing_voucher', {
    invoiceId,
    newState: {
      journal_entry_id: journalEntryId,
      invoice_id: invoiceId ?? null,
      invoice_status: invoice ? newStatus : null,
    },
  })

  if (invoice && invoiceId) {
    try {
      eventBus.emit({
        type: 'invoice.match_confirmed',
        payload: {
          invoice: invoice as Invoice,
          transaction: transaction as Transaction,
          userId,
          companyId,
        },
      })
    } catch {
      /* non-critical */
    }
  }

  const voucherLabel = formatVoucherLabel(
    journalEntry.voucher_series as string | null,
    journalEntry.voucher_number as number | null,
  )

  return {
    ok: true,
    result: {
      transactionId,
      journalEntryId,
      voucherLabel,
      invoiceId: invoiceId ?? null,
      invoiceStatus: invoice ? newStatus : null,
      paidAmount: invoice ? newPaidAmount : null,
      remainingAmount: invoice ? newRemaining : null,
    },
  }
}
