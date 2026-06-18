/**
 * Shared helpers for invoice PDF render call sites.
 *
 * Wraps `brandingFromCompanySettings` so every PDF-rendering route gets a
 * consistent branding object, and builds the optional Swish payment QR.
 */

import QRCode from 'qrcode'
import type { CompanySettings, Invoice } from '@/types'
import { brandingFromCompanySettings, type InvoiceBranding } from '@/lib/invoices/pdf-template'
import { buildSwishQrPayload } from '@/lib/payments/swish'
import { getDisplayTotal } from '@/lib/invoices/rounding'

export interface InvoicePdfRenderExtras {
  branding: InvoiceBranding
}

export function prepareInvoicePdfRender(company: CompanySettings): InvoicePdfRenderExtras {
  return { branding: brandingFromCompanySettings(company) }
}

/**
 * Build the Swish payment QR for an invoice as a PNG data URL, or null when:
 * Swish display is off, there's no/invalid Swish number, the invoice isn't in
 * SEK (Swish is SEK-only), or the amount is not positive. Generated locally with
 * the `qrcode` lib — no call to any Swish API. Pass the result to InvoicePDF's
 * `swishQrDataUrl` prop; the template gates rendering on the same payment box
 * that already shows the Swish number.
 */
export async function buildSwishQrDataUrl(
  company: CompanySettings,
  invoice: Invoice,
): Promise<string | null> {
  if (!(company.invoice_show_swish ?? false)) return null
  if ((invoice.currency ?? 'SEK') !== 'SEK') return null
  const amount = getDisplayTotal(invoice, company).displayed
  const payload = buildSwishQrPayload(company.swish, amount, invoice.invoice_number ?? '')
  if (!payload) return null
  try {
    return await QRCode.toDataURL(payload, { margin: 1, width: 240, errorCorrectionLevel: 'M' })
  } catch {
    return null
  }
}
