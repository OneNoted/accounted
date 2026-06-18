/**
 * Shared helpers for invoice PDF render call sites.
 *
 * Wraps `brandingFromCompanySettings` so every PDF-rendering route gets a
 * consistent branding object, and builds the optional Swish payment QR.
 */

import QRCode from 'qrcode'
import type { CompanySettings, Invoice } from '@/types'
import { brandingFromCompanySettings, SHOW_SWISH_ON_INVOICE, type InvoiceBranding } from '@/lib/invoices/pdf-template'
import { buildSwishQrPayload } from '@/lib/payments/swish'
import { getDisplayTotal } from '@/lib/invoices/rounding'
import { createLogger } from '@/lib/logger'

const log = createLogger('invoice.swish-qr')

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
  // Swish on invoices is "coming soon" — gated off in pdf-template. Bail before
  // any work while the feature is disabled.
  if (!SHOW_SWISH_ON_INVOICE) return null
  // Swish display off is the normal "no QR" case — stay quiet. Every other
  // skip is logged so a missing QR is diagnosable instead of silent.
  if (!(company.invoice_show_swish ?? false)) return null
  if ((invoice.currency ?? 'SEK') !== 'SEK') {
    log.info('swish QR skipped: invoice not in SEK', { invoiceId: invoice.id, currency: invoice.currency })
    return null
  }
  const amount = getDisplayTotal(invoice, company).displayed
  const payload = buildSwishQrPayload(company.swish, amount, invoice.invoice_number ?? '')
  if (!payload) {
    log.warn('swish QR skipped: invalid number or non-positive amount', {
      invoiceId: invoice.id,
      hasSwish: !!company.swish,
      amount,
    })
    return null
  }
  try {
    return await QRCode.toDataURL(payload, { margin: 1, width: 240, errorCorrectionLevel: 'M' })
  } catch (err) {
    log.warn('swish QR generation failed', {
      invoiceId: invoice.id,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
