import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveSekAmount } from '@/lib/bookkeeping/currency-utils'

export interface ReconciliationResult {
  supplier_ledger_total: number
  account_2440_balance: number
  difference: number
  is_reconciled: boolean
}

/**
 * Compare sum of open supplier invoices against account 2440 balance
 */
export async function generateReconciliation(
  supabase: SupabaseClient,
  companyId: string,
  periodId: string
): Promise<ReconciliationResult> {

  // Get total outstanding from supplier invoices.
  // remaining_amount is stored in invoice currency; account 2440 is in SEK
  // (booked at invoice-date rate), so convert each row before summing.
  const { data: invoices } = await supabase
    .from('supplier_invoices')
    .select('remaining_amount, currency, exchange_rate')
    .eq('company_id', companyId)
    .in('status', ['registered', 'approved', 'partially_paid', 'overdue'])

  const supplierLedgerTotal = (invoices || [])
    .reduce((sum, inv) => {
      const sek = resolveSekAmount(
        Number(inv.remaining_amount) || 0,
        null,
        inv.currency,
        inv.exchange_rate
      )
      return Math.round((sum + sek) * 100) / 100
    }, 0)

  // Get account 2440 balance from posted journal entry lines in this period
  const { data: journalLines } = await supabase
    .from('journal_entry_lines')
    .select(`
      debit_amount,
      credit_amount,
      journal_entry:journal_entries!inner(
        status,
        company_id,
        fiscal_period_id
      )
    `)
    .eq('account_number', '2440')
    .eq('journal_entries.company_id', companyId)
    .eq('journal_entries.fiscal_period_id', periodId)
    .eq('journal_entries.status', 'posted')

  // Account 2440 is a liability: credit normal balance
  // Balance = credits - debits
  let account2440Balance = 0
  if (journalLines) {
    for (const line of journalLines) {
      account2440Balance = Math.round((account2440Balance + (line.credit_amount || 0) - (line.debit_amount || 0)) * 100) / 100
    }
  }

  const difference = Math.round((supplierLedgerTotal - account2440Balance) * 100) / 100

  return {
    supplier_ledger_total: Math.round(supplierLedgerTotal * 100) / 100,
    account_2440_balance: Math.round(account2440Balance * 100) / 100,
    difference,
    is_reconciled: Math.abs(difference) < 0.01,
  }
}
