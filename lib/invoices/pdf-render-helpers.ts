/**
 * Shared helpers for invoice PDF render call sites.
 *
 * Pulled out of the various route handlers so the QR-code generation rule
 * lives in one place: every place that asks for a faktura PDF (download,
 * preview, send pipeline, mark-as-sent archival, recurring schedule, pending
 * operations commit, dashboard, public API v1) goes through here and gets the
 * same Swish QR behavior.
 *
 * QR rule:
 *   - Only generated for `document_type === 'invoice'` (not credit notes,
 *     proformas, delivery notes — those don't carry a "please pay X SEK"
 *     payment intent that a QR represents).
 *   - Only when the company has a `swish` number AND `invoice_show_swish` is
 *     not explicitly disabled.
 *   - Only when the total is positive (the QR encodes the amount; zero or
 *     negative would be invalid Swish input).
 *   - Encodes the invoice_number as the Swish message; if the invoice has no
 *     number yet (draft preview render), we still encode using a placeholder
 *     so the QR doesn't disappear from previews.
 */

import type { CompanySettings, Invoice } from '@/types'
import { brandingFromCompanySettings, type InvoiceBranding } from '@/lib/invoices/pdf-template'
import { buildSwishQrDataUrl } from '@/lib/invoices/swish-qr'
import { getDisplayTotal } from '@/lib/invoices/rounding'

export interface InvoicePdfRenderExtras {
  branding: InvoiceBranding
  swishQrDataUrl: string | null
}

/**
 * Resolves the optional render extras (branding object + Swish QR data URL).
 * Safe to call on every code path — returns `swishQrDataUrl: null` when the
 * QR shouldn't appear, which the PDF template treats as "skip the QR block".
 */
export async function prepareInvoicePdfRender(
  invoice: Invoice,
  company: CompanySettings,
): Promise<InvoicePdfRenderExtras> {
  const branding = brandingFromCompanySettings(company)

  // Doc-type and payment-rules guard: same logic as the existing payment
  // section in pdf-template.tsx. We mirror it here so the QR code never out-
  // lives the payment block it lives in.
  const isCreditNote = !!invoice.credited_invoice_id
  const docType = invoice.document_type || 'invoice'
  const isRealInvoice = docType === 'invoice' && !isCreditNote

  if (!isRealInvoice) return { branding, swishQrDataUrl: null }
  if (!company.swish) return { branding, swishQrDataUrl: null }
  if (company.invoice_show_swish === false) return { branding, swishQrDataUrl: null }

  // The QR encodes the displayed total (post öresavrundning + post ROT/RUT-
  // deduction). That's what the customer is actually expected to pay — and
  // it has to match the "Att betala" line on the invoice. We re-compute the
  // same way the template does to stay consistent if the rounding rules
  // change in one place.
  const rounding = getDisplayTotal(invoice, company)
  const deduction = invoice.deduction_total ?? 0
  const payable = Math.round((rounding.displayed - deduction) * 100) / 100
  if (payable <= 0) return { branding, swishQrDataUrl: null }

  // Use the F-series number as the Swish message. For draft previews the
  // number is null — fall back to a short placeholder so the QR still
  // renders (preview UX), but real invoices always have a number by the
  // time they reach a send path.
  const message = invoice.invoice_number ?? 'PREVIEW'

  const dataUrl = await buildSwishQrDataUrl({
    swishNumber: company.swish,
    amount: payable,
    message,
  })

  return { branding, swishQrDataUrl: dataUrl }
}
