'use client'

import { InvoiceSettingsForm } from '@/components/settings/InvoiceSettingsForm'
import { InvoicePaymentLinkSettings } from '@/components/settings/InvoicePaymentLinkSettings'
import { InvoicePaymentAccountsSettings } from '@/components/settings/InvoicePaymentAccountsSettings'
import { InvoiceEmailTextsSettings } from '@/components/settings/InvoiceEmailTextsSettings'
import { InvoiceEmailRecipientsSettings } from '@/components/settings/InvoiceEmailRecipientsSettings'
import { InvoicePreviewCard } from '@/components/settings/InvoicePreviewCard'
import { PdfPrintSettings } from '@/components/settings/PdfPrintSettings'
import { SettingsFormWrapper } from '@/components/settings/SettingsFormWrapper'
import { SettingsLoadError } from '@/components/settings/SettingsLoadError'
import { SettingsLoadingSkeleton } from '@/components/settings/SettingsLoadingSkeleton'
import { useSettings } from '@/components/settings/useSettings'
import type { CompanySettings } from '@/types'

/**
 * Invoicing settings decomposed into standalone subsections so the settings
 * sheet can render them as accordion panels (Dragspelet) while the legacy
 * full-section component composes the same pieces. One implementation, two
 * layouts: the sheet and the section view can never drift.
 */

/** Live invoice preview card, right-aligned in the legacy stacked layout. */
export function InvoicingPreviewSettings() {
  const { settings, isLoading, refetch } = useSettings()

  if (isLoading) return <SettingsLoadingSkeleton />
  if (!settings) return <SettingsLoadError onRetry={refetch} />

  return (
    <div className="flex justify-end">
      <InvoicePreviewCard settings={settings} />
    </div>
  )
}

/** Payment accounts per currency: the invoice shows the account matching its
 *  currency. Saves individually. */
export function InvoicingPaymentAccountsSettings() {
  const { settings, isLoading, updateSettings, refetch } = useSettings()

  if (isLoading) return <SettingsLoadingSkeleton />
  if (!settings) return <SettingsLoadError onRetry={refetch} />

  return <InvoicePaymentAccountsSettings settings={settings} onUpdate={updateSettings} />
}

/** Invoice numbering, defaults and the reminder ladder: one form, one save. */
export function InvoicingGeneralSettings() {
  const { settings, isLoading, updateSettings, refetch } = useSettings()

  if (isLoading) return <SettingsLoadingSkeleton />
  if (!settings) return <SettingsLoadError onRetry={refetch} />

  function handleSave(formData: FormData) {
    const updates: Record<string, unknown> = {
      invoice_prefix: (formData.get('invoice_prefix') as string) || null,
      next_invoice_number: parseInt(formData.get('next_invoice_number') as string) || 1,
      next_arrival_number: parseInt(formData.get('next_arrival_number') as string) || 1,
      invoice_default_days: parseInt(formData.get('invoice_default_days') as string) || 30,
      invoice_default_notes: (formData.get('invoice_default_notes') as string) || null,
      default_our_reference: (formData.get('default_our_reference') as string) || null,
      reminder_days_level_1:
        Number.parseInt(formData.get('reminder_days_level_1') as string) || 15,
      reminder_days_level_2:
        Number.parseInt(formData.get('reminder_days_level_2') as string) || 30,
      reminder_days_level_3:
        Number.parseInt(formData.get('reminder_days_level_3') as string) || 45,
    }
    return {
      updates,
      onSuccess: (data: Record<string, unknown>) => {
        updateSettings(data as Partial<CompanySettings>)
      },
    }
  }

  return (
    <SettingsFormWrapper onSave={handleSave}>
      <InvoiceSettingsForm settings={settings} />
    </SettingsFormWrapper>
  )
}

/** Payment link opt-in: saves individually via toggle switch. */
export function InvoicingPaymentLinkSettings() {
  const { settings, isLoading, updateSettings, refetch } = useSettings()

  if (isLoading) return <SettingsLoadingSkeleton />
  if (!settings) return <SettingsLoadError onRetry={refetch} />

  return <InvoicePaymentLinkSettings settings={settings} onUpdate={updateSettings} />
}

/** PDF settings: saves individually via toggle switches. */
export function InvoicingPdfPrintSettings() {
  const { settings, isLoading, updateSettings, refetch } = useSettings()

  if (isLoading) return <SettingsLoadingSkeleton />
  if (!settings) return <SettingsLoadError onRetry={refetch} />

  return <PdfPrintSettings settings={settings} onUpdate={updateSettings} />
}

/** Fixed invoice email recipients: explicit save. */
export function InvoicingEmailRecipientsSettings() {
  const { settings, isLoading, updateSettings, refetch } = useSettings()

  if (isLoading) return <SettingsLoadingSkeleton />
  if (!settings) return <SettingsLoadError onRetry={refetch} />

  return <InvoiceEmailRecipientsSettings settings={settings} onUpdate={updateSettings} />
}

/** Invoice email texts: autosaves on blur. */
export function InvoicingEmailTextsSettings() {
  const { settings, isLoading, updateSettings, refetch } = useSettings()

  if (isLoading) return <SettingsLoadingSkeleton />
  if (!settings) return <SettingsLoadError onRetry={refetch} />

  return <InvoiceEmailTextsSettings settings={settings} onUpdate={updateSettings} />
}
