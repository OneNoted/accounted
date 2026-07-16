/**
 * #967 "Registrera men bokför inte": whether issuing an invoice (registering
 * a supplier invoice, sending a customer invoice) books it inline.
 *
 * Inline booking happens only under faktureringsmetoden (accrual) with
 * defer_invoice_booking off. Kontantmetoden companies never book at issue
 * (they book at payment), and deferred companies book via the explicit
 * "Bokför" routes (POST /api/supplier-invoices/[id]/book,
 * POST /api/invoices/[id]/book) instead.
 *
 * The payment flows need no gate of their own: both mark-paid paths already
 * route on whether a live journal-entry link exists, so an invoice that is
 * still unbooked when paid gets the full cash-style entry at payment.
 */
export function booksInvoicesOnIssue(
  settings:
    | { accounting_method?: string | null; defer_invoice_booking?: boolean | null }
    | null
    | undefined
): boolean {
  // No settings row: match the historical default (accrual, book at issue).
  if (!settings) return true
  return (settings.accounting_method || 'accrual') === 'accrual' && !settings.defer_invoice_booking
}
