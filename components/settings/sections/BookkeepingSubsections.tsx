'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { AccountingFrameworkForm } from '@/components/settings/AccountingFrameworkForm'
import { useCompany } from '@/contexts/CompanyContext'
import { SettingsFormWrapper } from '@/components/settings/SettingsFormWrapper'
import { SettingsLoadError } from '@/components/settings/SettingsLoadError'
import { SettingsLoadingSkeleton } from '@/components/settings/SettingsLoadingSkeleton'
import { PeriodLockingSettings } from '@/components/settings/PeriodLockingSettings'
import { VoucherSeriesManager } from '@/components/settings/VoucherSeriesManager'
import { VoucherSeriesPerSourceTypeForm } from '@/components/settings/VoucherSeriesPerSourceTypeForm'
import { applyDefaultSeriesToMap } from '@/lib/bookkeeping/voucher-series-resolver'
import { PeriodiseringAutoDetectToggle } from '@/components/settings/PeriodiseringAutoDetectToggle'
import { DimensionsToggle } from '@/components/settings/DimensionsToggle'
import { useSettings } from '@/components/settings/useSettings'
import {
  SettingsFieldRow,
  settingsSelectClassName,
} from '@/components/settings/sheet/SettingsFieldRow'
import { cn } from '@/lib/utils'
import { ExternalLink } from 'lucide-react'
import type { AccountingFramework, CompanySettings } from '@/types'

const SERIES_OPTIONS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

/** K2/K3 framework selector. Renders nothing for enskild firma: the framework
 *  choice only exists for aktiebolag. */
export function BookkeepingFrameworkSettings() {
  const { company } = useCompany()
  // Local mirror of the company-level accounting_framework so the selector can
  // reflect its own saves without waiting for the layout to re-render through
  // the server. Falls back to k2 (matches the column default).
  const [framework, setFramework] = useState<AccountingFramework>(
    company?.accounting_framework ?? 'k2',
  )

  if (company?.entity_type !== 'aktiebolag') return null

  return (
    <AccountingFrameworkForm
      current={framework}
      onSaved={(next) => setFramework(next)}
    />
  )
}

/**
 * Bookkeeping settings decomposed into standalone subsections so the settings
 * sheet can render them as accordion panels (Dragspelet) while the legacy
 * full-section component composes the same pieces. One implementation, two
 * layouts: the sheet and the section view can never drift.
 */

/** Accounting method + default voucher series + period locking: one form,
 *  one save, exactly the fields that live on /api/settings. */
export function BookkeepingMethodSettings() {
  const t = useTranslations('settings_bookkeeping')
  const { settings, isLoading, updateSettings, refetch } = useSettings()

  if (isLoading) return <SettingsLoadingSkeleton />
  if (!settings) return <SettingsLoadError onRetry={refetch} />

  function handleSave(formData: FormData) {
    const autoLockValue = formData.get('auto_lock_period_days') as string
    const lockedThrough = (formData.get('bookkeeping_locked_through') as string) || null
    const accountingMethod = (formData.get('accounting_method') as string) || 'accrual'
    const defaultVoucherSeries = (formData.get('default_voucher_series') as string) || 'A'
    // Deferred booking is an accrual-only concept (#967): normalize to false
    // under kontantmetoden so switching back to accrual can never re-activate
    // a stale flag the user set in a mode where it had no effect.
    const deferInvoiceBooking =
      accountingMethod === 'accrual' && formData.get('defer_invoice_booking') === 'true'

    const updates: Record<string, unknown> = {
      bookkeeping_locked_through: lockedThrough,
      auto_lock_period_days: autoLockValue === 'none' ? null : parseInt(autoLockValue),
      accounting_method: accountingMethod,
      default_voucher_series: defaultVoucherSeries,
      defer_invoice_booking: deferInvoiceBooking,
    }

    // Write-through: the booking engine resolves the series from the
    // per-source-type map, NOT from default_voucher_series. So when the user
    // changes the global default, propagate it across the map, but only for
    // types that were still following the previous default, leaving explicit
    // per-type overrides (set via VoucherSeriesPerSourceTypeForm) untouched.
    // Without this the "Standardserie" dropdown is a no-op for bookkeeping.
    // Only runs when the series actually changed, so saving the form for an
    // unrelated reason (e.g. the lock date) never rewrites the map.
    const prevDefault = settings?.default_voucher_series || 'A'
    const currentMap = settings?.default_voucher_series_per_source_type
    if (currentMap && defaultVoucherSeries !== prevDefault) {
      updates.default_voucher_series_per_source_type = applyDefaultSeriesToMap(
        currentMap,
        prevDefault,
        defaultVoucherSeries,
      )
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
      <div className="divide-y divide-border">
        <SettingsFieldRow
          label={t('method_label')}
          htmlFor="accounting_method"
          help={t('method_help')}
        >
          <select
            id="accounting_method"
            name="accounting_method"
            defaultValue={settings.accounting_method || 'accrual'}
            className={settingsSelectClassName}
          >
            <option value="accrual">{t('method_accrual')}</option>
            <option value="cash">{t('method_cash')}</option>
          </select>
        </SettingsFieldRow>

        {/* #967: register/send without booking; ekonomi books in a separate
            explicit step. Only meaningful under faktureringsmetoden. */}
        <SettingsFieldRow
          label={t('defer_booking_label')}
          htmlFor="defer_invoice_booking"
          help={t('defer_booking_help')}
        >
          <select
            id="defer_invoice_booking"
            name="defer_invoice_booking"
            defaultValue={settings.defer_invoice_booking ? 'true' : 'false'}
            className={settingsSelectClassName}
          >
            <option value="false">{t('defer_booking_off')}</option>
            <option value="true">{t('defer_booking_on')}</option>
          </select>
        </SettingsFieldRow>

        <SettingsFieldRow
          label={t('series_label')}
          htmlFor="default_voucher_series"
          description={t('series_help')}
        >
          <select
            id="default_voucher_series"
            name="default_voucher_series"
            defaultValue={settings.default_voucher_series || 'A'}
            className={cn(settingsSelectClassName, 'w-16 font-mono')}
          >
            {SERIES_OPTIONS.map((letter) => (
              <option key={letter} value={letter}>{letter}</option>
            ))}
          </select>
        </SettingsFieldRow>

        <PeriodLockingSettings settings={settings} />
      </div>
    </SettingsFormWrapper>
  )
}

/** Per-source-type voucher series map, bound to the shared settings state. */
export function BookkeepingSeriesMapSettings() {
  const { settings, isLoading, updateSettings, refetch } = useSettings()

  if (isLoading) return <SettingsLoadingSkeleton />
  if (!settings) return <SettingsLoadError onRetry={refetch} />

  return (
    <VoucherSeriesPerSourceTypeForm
      settings={settings}
      onSettingsUpdated={updateSettings}
    />
  )
}

/** Read-only list of active voucher series and their latest numbers. */
export function BookkeepingSeriesStatus() {
  const { settings, isLoading, refetch } = useSettings()

  if (isLoading) return <SettingsLoadingSkeleton />
  if (!settings) return <SettingsLoadError onRetry={refetch} />

  return <VoucherSeriesManager defaultSeries={settings.default_voucher_series || 'A'} />
}

/** Periodisering auto-detect + dimensions: the two feature toggles. */
export function BookkeepingAutomationSettings() {
  return (
    <div className="divide-y divide-border">
      <PeriodiseringAutoDetectToggle />
      <DimensionsToggle />
    </div>
  )
}

/** Cross-links to related non-settings surfaces (kontoplan). */
export function BookkeepingRelatedLinks() {
  const t = useTranslations('settings_bookkeeping')
  return (
    <div className="flex flex-col gap-2">
      <Link
        href="/bookkeeping?tab=accounts"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        {t('related_chart_of_accounts')}
      </Link>
    </div>
  )
}
