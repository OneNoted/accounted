/**
 * Builds the journal-entry lines for the clearing entry that closes (fully
 * or partially) a customer invoice against an actual bank transaction.
 *
 * The lines built here are the "Inbetalning kundfaktura" path under
 * faktureringsmetoden (accrual) — Dr 1930 / Cr 1510, with a 3960/7960
 * FX-diff line when the invoice and the bank tx are in different currencies.
 *
 * Shared between:
 *   - GET /api/transactions/[id]/match-invoice/preview (read-only, drives
 *     the dialog the user confirms against)
 *   - POST /api/transactions/[id]/match-invoice (the commit path)
 *
 * Single source of truth so the preview and the committed verifikat are
 * byte-identical. Earlier the two diverged on the cross-currency math —
 * the preview ran `resolveSekAmount(tx.amount, null, INV.currency, INV.rate)`,
 * treating the SEK tx number as if it were in the invoice's currency and
 * multiplying by the invoice's stored rate. That produced a fictitious
 * bank-leg amount and silently dropped the FX gain/loss.
 *
 * # Customer-invoice only
 *
 * This helper is the CUSTOMER side (kundfaktura): AR account 1510, FX gain
 * 3960 (valutakursvinster rörelsefordringar), FX loss 7960
 * (valutakursförluster rörelsefordringar), bank-leg = Dr. Supplier-side
 * settlement has the opposite DR/CR polarity (Cr 1930 / Dr 2440-series) and
 * a different account taxonomy; it lives in the match_batch_allocate RPC,
 * not here. Do not call this helper from supplier-invoice flows.
 *
 * # Currency model
 *
 *   tx.currency       — currency of the bank tx (almost always SEK)
 *   tx.amount         — amount in tx.currency
 *   tx.exchange_rate  — populated at ingest only when tx.currency != SEK
 *   tx.amount_sek     — pre-computed SEK at ingest for non-SEK tx
 *   invoice.currency  — currency the invoice was issued in
 *   invoice.exchange_rate — the rate at which AR was originally booked on 1510
 *
 *   Bank-leg (1930) = always the actual SEK that hit the bank.
 *   AR-leg (1510)   = the SEK value of the customer-debt reduction at the
 *                     INVOICE's stored rate (capped to bankSek on partials
 *                     to keep 1510 in sync with invoice.remaining_amount).
 *   FX diff         = (AR-leg SEK − Bank-leg SEK); sign drives 3960 vs 7960.
 *                     Per BFL 5 kap 4–5§ every verifikat must balance to the
 *                     öre; the FX diff line is what makes the cross-currency
 *                     verifikat balance. Only emitted when the bank tx fully
 *                     clears the invoice's remaining — partials defer the
 *                     FX adjustment to the final settlement to avoid
 *                     prematurely zeroing 1510 while the AR row still says
 *                     partially_paid.
 */
import type { CreateJournalEntryLineInput } from '@/types'
import { resolveSekAmount } from './currency-utils'

const TWO_DP = (n: number): number => Math.round(n * 100) / 100

export interface PaymentClearingTx {
  amount: number
  amount_sek: number | null
  currency: string
  exchange_rate: number | null
}

export interface PaymentClearingInvoice {
  currency: string
  exchange_rate: number | null
  remaining_amount: number | null
  total: number
  paid_amount: number | null
}

export interface PaymentClearingLines {
  /** Actual SEK that hit the bank. The 1930 debit. */
  bankSek: number
  /** SEK value of the AR reduction at the invoice's stored rate. The 1510 credit. */
  arSek: number
  /**
   * fxDiffSek = arSek − bankSek (this orientation matches what's needed to
   * make the verifikat balance: positive value goes Dr 7960, negative
   * value goes Cr 3960).
   *
   * Sign reading (note this is the OPPOSITE of an intuitive "profit"
   * orientation — the value here is a balance-adjustment magnitude, not a
   * P&L number, because AR is the side being cleared):
   *   positive → bank received FEWER SEK than AR was booked at → kursförlust → 7960 Dr
   *   negative → bank received MORE  SEK than AR was booked at → kursvinst   → 3960 Cr
   *   |value| ≤ 0.005 → no FX diff line emitted (floating-point tolerance,
   *                     NOT a rounding allowance per BFL 5 kap 4–5§)
   *
   * If you want an intuitive "gain" number for UI display, use
   * `bankSek - arSek` (negate this field). Do not consume the raw sign
   * in caller logic without reading this paragraph.
   */
  fxDiffSek: number
  lines: CreateJournalEntryLineInput[]
}

/**
 * Build the verifikat lines for a customer-invoice payment matched against
 * a bank tx. Pure — no DB calls. Caller decides how to persist.
 *
 * For same-currency invoices the FX diff is always 0 and only the two
 * bank/AR lines are returned. For cross-currency, a 3960 or 7960 line is
 * appended to balance the verifikat. Per the contract documented in this
 * file, when the tx is cross-currency we assume the bank tx fully clears
 * the invoice's remaining amount and book the full FX diff to one
 * verifikat — same pattern as the match_batch_allocate RPC, which is the
 * only other code path that posts FX diffs on customer-invoice
 * settlements.
 */
export function buildInvoicePaymentClearingLines(
  tx: PaymentClearingTx,
  invoice: PaymentClearingInvoice,
  description: string,
): PaymentClearingLines {
  // Bank-leg: actual SEK that hit the bank. resolveSekAmount returns the
  // raw amount for SEK txs and amount * exchange_rate for foreign txs
  // (preferring the pre-computed amount_sek when set).
  const bankSek = TWO_DP(
    resolveSekAmount(
      Math.abs(tx.amount),
      tx.amount_sek != null ? Math.abs(tx.amount_sek) : null,
      tx.currency,
      tx.exchange_rate,
    ),
  )

  const sameCurrency = tx.currency === invoice.currency
  const invoiceIsForeign = invoice.currency !== 'SEK'

  let arSek: number
  let fxDiffSek: number

  if (sameCurrency || !invoiceIsForeign) {
    // Same currency (or SEK invoice paid by SEK tx): the customer-debt
    // reduction equals what hit the bank. No FX diff possible.
    arSek = bankSek
    fxDiffSek = 0
  } else {
    // Cross-currency: AR is denominated in invoice.currency and was
    // booked on 1510 at invoice.exchange_rate. The remaining-amount × rate
    // is the SEK currently sitting on 1510 for this invoice.
    const invRemainingForeign = invoice.remaining_amount ?? invoice.total - (invoice.paid_amount ?? 0)
    const invRate = invoice.exchange_rate ?? 1
    const arSekFullRemaining = TWO_DP(invRemainingForeign * invRate)

    // Branch on whether the bank tx fully clears (or over-pays) the
    // remaining 1510 balance. Partial cross-currency must NOT credit the
    // full remaining — that would zero 1510 in the GL while the invoice
    // row stays at status=partially_paid, leaving the ledger inconsistent
    // with the AR sub-ledger and over-stating FX gain/loss for the period.
    // Defer the FX adjustment to the final settlement (when bank-SEK
    // covers the full remaining), per BFL 5 kap 4–5§ "verifikat must
    // reflect the actual affärshändelse".
    if (bankSek >= arSekFullRemaining - 0.005) {
      // Full payment of remaining (or overpay): clear AR and book FX diff.
      arSek = arSekFullRemaining
      fxDiffSek = TWO_DP(arSek - bankSek)
    } else {
      // Partial cross-currency: book 1930 / 1510 at bankSek (the actual
      // SEK that moved), no FX line. The deferred FX diff lands on the
      // verifikat that finally closes the invoice.
      arSek = bankSek
      fxDiffSek = 0
    }
  }

  const lines: CreateJournalEntryLineInput[] = [
    {
      account_number: '1930',
      debit_amount: bankSek,
      credit_amount: 0,
      line_description: description,
    },
    {
      account_number: '1510',
      debit_amount: 0,
      credit_amount: arSek,
      line_description: description,
    },
  ]

  // Tolerance of 0.005 SEK is for floating-point equalisation only, not a
  // rounding allowance per BFL 5 kap 4–5§. Same rationale as the balance
  // pre-check in gnubok_bulk_book_transactions.
  if (Math.abs(fxDiffSek) > 0.005) {
    if (fxDiffSek > 0) {
      // arSek > bankSek → bank received fewer SEK than booked. Loss → 7960 debit.
      lines.push({
        account_number: '7960',
        debit_amount: Math.abs(fxDiffSek),
        credit_amount: 0,
        line_description: 'Valutakursförlust',
      })
    } else {
      // bankSek > arSek → bank received more SEK than booked. Gain → 3960 credit.
      lines.push({
        account_number: '3960',
        debit_amount: 0,
        credit_amount: Math.abs(fxDiffSek),
        line_description: 'Valutakursvinst',
      })
    }
  }

  return { bankSek, arSek, fxDiffSek, lines }
}
