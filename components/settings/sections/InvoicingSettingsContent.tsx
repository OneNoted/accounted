'use client'

import {
  InvoicingPreviewSettings,
  InvoicingPaymentAccountsSettings,
  InvoicingGeneralSettings,
  InvoicingPaymentLinkSettings,
  InvoicingPdfPrintSettings,
  InvoicingEmailRecipientsSettings,
  InvoicingEmailTextsSettings,
} from './InvoicingSubsections'

/**
 * Legacy stacked layout for the Fakturering section. The settings sheet
 * renders the same subsections as accordion panels via the sheet registry
 * (components/settings/sheet/subsections.tsx); this component only stacks
 * them with hairline separators for surfaces that still show the whole
 * section.
 */
export function InvoicingSettingsContent() {
  return (
    <div className="space-y-8">
      <InvoicingPreviewSettings />

      <InvoicingPaymentAccountsSettings />

      <InvoicingGeneralSettings />

      {/* Payment link opt-in: saves individually via toggle switch */}
      <div className="border-t border-border pt-8">
        <InvoicingPaymentLinkSettings />
      </div>

      {/* PDF settings: saves individually via toggle switches */}
      <div className="border-t border-border pt-8">
        <InvoicingPdfPrintSettings />
      </div>

      {/* Fixed invoice email recipients: explicit save */}
      <div className="border-t border-border pt-8">
        <InvoicingEmailRecipientsSettings />
      </div>

      {/* Invoice email texts: autosaves on blur */}
      <div className="border-t border-border pt-8">
        <InvoicingEmailTextsSettings />
      </div>
    </div>
  )
}
