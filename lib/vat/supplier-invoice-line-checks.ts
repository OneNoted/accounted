// Pure submit-time checks for supplier invoice line items (issue #863).
// Kept free of React so the rules can be unit-tested and reused.

// Only 25/12/6/0 % are legal Swedish VAT rates (ML 2023:200). The supplier
// invoice form stores rates as decimal fractions (0.25 = 25 %); this list is
// also the preset dropdown in the form's VAT rate cell.
// Note on the food rate: livsmedel moved from 12 % to 6 % on 1 April 2026
// (Prop. 2025/26:55, ML 2023:200), and the reduction is currently legislated
// to revert after 31 December 2027; 6 % then remains legal (books, transport)
// but stops being the food rate. This static allow-list cannot express
// per-category temporal validity, so revisit at the reversion date.
export const LEGAL_VAT_RATES: readonly number[] = [0.25, 0.12, 0.06, 0]

export function isLegalVatRate(rate: number): boolean {
  return LEGAL_VAT_RATES.includes(rate)
}

/**
 * Index of the first line whose VAT rate falls outside the legal Swedish set,
 * or -1 when every line is legal. Reverse charge invoices should skip this
 * check: their line vat_rate is forced to 0 and the self-assessed rate comes
 * from a fixed select that only offers legal rates.
 */
export function findIllegalVatRateRow(
  items: ReadonlyArray<{ vat_rate: number }>,
): number {
  return items.findIndex((item) => !isLegalVatRate(item.vat_rate))
}

/**
 * Indices of lines that look mis-accounted for a reverse charge invoice:
 * omvand skattskyldighet purchases are normally booked on cost accounts
 * (4xxx/5xxx), so a line on a class 1 (assets) or class 6 account is worth a
 * second look. Advisory only, never blocking: class 6 has legitimate reverse
 * charge uses (e.g. 6540 IT-tjanster for EU cloud services).
 *
 * Account numbers are strings (identifiers, not quantities); rows without an
 * account yet are skipped, the separate account-missing check owns those.
 */
export function findReverseChargeAccountWarningRows(
  items: ReadonlyArray<{ account_number: string }>,
): number[] {
  const rows: number[] = []
  items.forEach((item, index) => {
    const account = item.account_number
    if (account && (account.startsWith('1') || account.startsWith('6'))) {
      rows.push(index)
    }
  })
  return rows
}
