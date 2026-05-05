import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveSekAmount } from '@/lib/bookkeeping/currency-utils'

export interface ARReconciliationResult {
  ar_ledger_total: number
  account_1510_balance: number
  difference: number
  is_reconciled: boolean
  /**
   * Number of foreign-currency invoices that lacked an exchange_rate, so their
   * outstanding amount could not be converted to SEK. When > 0 the difference
   * field may be misleading: any reported gap could be missing-data rather
   * than a true reconciliation break.
   */
  unconverted_fx_count: number
}

/**
 * Compare sum of open customer invoices against account 1510 balance.
 * Account 1510 is debit-normal (asset): balance = debits - credits.
 *
 * Conversion uses each invoice's stored exchange_rate (the invoice-date rate),
 * which matches what was originally posted to 1510. This means the report will
 * diverge from the GL once partial payments settle at a different rate (the
 * delta is correctly booked as valutakursvinst/-förlust to 3960/7960 per
 * ML 8 kap 21–23 §). A subledger-derived total would reconcile through that
 * difference; deferred to a follow-up.
 */
export async function generateARReconciliation(
  supabase: SupabaseClient,
  companyId: string,
  periodId: string
): Promise<ARReconciliationResult> {

  // total/paid_amount are stored in invoice currency; account 1510 is in SEK
  // (booked at invoice-date rate), so convert each row before summing.
  const { data: invoices } = await supabase
    .from('invoices')
    .select('total, paid_amount, currency, exchange_rate')
    .eq('company_id', companyId)
    .in('status', ['sent', 'overdue'])

  let unconvertedFxCount = 0
  const arLedgerTotal = (invoices || [])
    .reduce((sum, inv) => {
      const isFx = inv.currency && inv.currency !== 'SEK'
      const hasRate = inv.exchange_rate != null && Number(inv.exchange_rate) > 0
      // Skip unconvertible FX rows from the sum — adding raw foreign amounts
      // to a SEK total is arithmetically unsound. Counted instead.
      if (isFx && !hasRate) {
        unconvertedFxCount += 1
        return sum
      }
      const outstanding = (Number(inv.total) || 0) - (Number(inv.paid_amount) || 0)
      const sek = resolveSekAmount(outstanding, null, inv.currency, inv.exchange_rate)
      return Math.round((sum + sek) * 100) / 100
    }, 0)

  // Get account 1510 balance from posted journal entry lines in this period
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
    .eq('account_number', '1510')
    .eq('journal_entries.company_id', companyId)
    .eq('journal_entries.fiscal_period_id', periodId)
    .eq('journal_entries.status', 'posted')

  // Account 1510 is an asset: debit normal balance
  // Balance = debits - credits
  let account1510Balance = 0
  if (journalLines) {
    for (const line of journalLines) {
      account1510Balance = Math.round((account1510Balance + (Number(line.debit_amount) || 0) - (Number(line.credit_amount) || 0)) * 100) / 100
    }
  }

  const difference = Math.round((arLedgerTotal - account1510Balance) * 100) / 100

  return {
    ar_ledger_total: Math.round(arLedgerTotal * 100) / 100,
    account_1510_balance: Math.round(account1510Balance * 100) / 100,
    difference,
    is_reconciled: Math.abs(difference) < 0.01,
    unconverted_fx_count: unconvertedFxCount,
  }
}
