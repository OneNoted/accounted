'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { SettingsFormWrapper } from '@/components/settings/SettingsFormWrapper'
import { SettingsLoadError } from '@/components/settings/SettingsLoadError'
import { SettingsLoadingSkeleton } from '@/components/settings/SettingsLoadingSkeleton'
import { TaxTableStatus } from '@/components/salary/TaxTableStatus'
import { useSettings } from '@/components/settings/useSettings'
import {
  SettingsFieldRow,
  settingsInputClassName,
  settingsSelectClassName,
} from '@/components/settings/sheet/SettingsFieldRow'
import { resolveDefaultSeriesForSource } from '@/lib/bookkeeping/voucher-series-resolver'
import { cn } from '@/lib/utils'
import { AlertTriangle } from 'lucide-react'
import type { CompanySettings } from '@/types'

const SERIES_OPTIONS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
const BANK_OPTIONS = ['swedbank', 'seb', 'handelsbanken', 'nordea'] as const

const BANK_LABEL: Record<(typeof BANK_OPTIONS)[number], string> = {
  swedbank: 'Swedbank',
  seb: 'SEB',
  handelsbanken: 'Handelsbanken',
  nordea: 'Nordea',
}

/**
 * Salary settings decomposed into standalone subsections for the settings
 * sheet's accordion (Dragspelet). The legacy SalarySettingsContent composes
 * the same pieces so both layouts share one implementation.
 */

/** Pay day, payment file format, bank and voucher series: one form, one save. */
export function SalaryPaymentSettings() {
  const t = useTranslations('settings_salary')
  const { settings, isLoading, updateSettings, refetch } = useSettings()
  // Controlled so the LB sunset note reacts to the selection before save.
  const [format, setFormat] = useState<'bg_lb' | 'pain001' | null>(null)

  if (isLoading) return <SettingsLoadingSkeleton />
  if (!settings) return <SettingsLoadError onRetry={refetch} />

  const effectiveFormat = format ?? settings.preferred_payment_format ?? 'pain001'
  const currentSeries = resolveDefaultSeriesForSource(settings, 'salary_payment')

  function handleSave(formData: FormData) {
    const payDayRaw = parseInt((formData.get('salary_pay_day') as string) || '25', 10)
    const payDay = Number.isFinite(payDayRaw) ? Math.min(28, Math.max(1, payDayRaw)) : 25
    const paymentFormat = (formData.get('preferred_payment_format') as string) || 'pain001'
    const bank = (formData.get('salary_default_bank') as string) || 'none'
    const series = (formData.get('salary_voucher_series') as string) || 'A'

    const updates: Record<string, unknown> = {
      salary_pay_day: payDay,
      preferred_payment_format: paymentFormat,
      salary_default_bank: bank === 'none' ? null : bank,
    }

    // The booking engine resolves the series from the per-source-type map;
    // salary entries pass run.voucher_series explicitly, seeded from this
    // entry at run creation. Merge — never replace — the map so other
    // source-type overrides survive.
    if (series !== currentSeries) {
      updates.default_voucher_series_per_source_type = {
        ...(settings?.default_voucher_series_per_source_type || {}),
        salary_payment: series,
      }
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
          label={t('pay_day_label')}
          htmlFor="salary_pay_day"
          help={t('pay_day_help')}
        >
          <Input
            id="salary_pay_day"
            name="salary_pay_day"
            type="number"
            min={1}
            max={28}
            defaultValue={settings.salary_pay_day ?? 25}
            className={cn(settingsInputClassName, 'w-24 tabular-nums')}
          />
        </SettingsFieldRow>

        {/* Format row plus the LB sunset note as one divide-y child: the
            warning sits under its own row without earning a hairline. */}
        <div>
          <SettingsFieldRow
            label={t('format_label')}
            htmlFor="preferred_payment_format"
            help={t('format_help')}
          >
            <select
              id="preferred_payment_format"
              name="preferred_payment_format"
              value={effectiveFormat}
              onChange={(e) => setFormat(e.target.value as 'bg_lb' | 'pain001')}
              className={settingsSelectClassName}
            >
              <option value="pain001">{t('format_pain001')}</option>
              <option value="bg_lb">{t('format_bg_lb')}</option>
            </select>
          </SettingsFieldRow>
          {effectiveFormat === 'bg_lb' && (
            <p className="flex items-start gap-2 pb-2 text-[12.5px] leading-5 text-attn">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              <span>{t('sunset_warning')}</span>
            </p>
          )}
        </div>

        <SettingsFieldRow
          label={t('bank_label')}
          htmlFor="salary_default_bank"
          description={t('bank_help')}
        >
          <select
            id="salary_default_bank"
            name="salary_default_bank"
            defaultValue={settings.salary_default_bank ?? 'none'}
            className={settingsSelectClassName}
          >
            <option value="none">{t('bank_none')}</option>
            {BANK_OPTIONS.map((key) => (
              <option key={key} value={key}>{BANK_LABEL[key]}</option>
            ))}
            <option value="other">{t('bank_other')}</option>
          </select>
        </SettingsFieldRow>

        <SettingsFieldRow
          label={t('voucher_series_label')}
          htmlFor="salary_voucher_series"
          description={t('voucher_series_help')}
        >
          <select
            id="salary_voucher_series"
            name="salary_voucher_series"
            defaultValue={currentSeries}
            className={cn(settingsSelectClassName, 'w-16 font-mono')}
          >
            {SERIES_OPTIONS.map((letter) => (
              <option key={letter} value={letter}>{letter}</option>
            ))}
          </select>
        </SettingsFieldRow>
      </div>
    </SettingsFormWrapper>
  )
}

/** Tax table status (read-only). */
export function SalaryTaxTables() {
  // The explanation lives on the accordion header's "?"
  // (settings_sheet.sub_salary_tax_tables_help), so this panel is just status.
  return (
    <section className="space-y-3">
      <TaxTableStatus />
    </section>
  )
}

/** Vacation rule pointer: the rule itself is per-employee. */
export function SalaryVacationInfo() {
  const t = useTranslations('settings_salary')
  return (
    <p className="text-sm text-muted-foreground">
      {t('vacation_info')}{' '}
      <Link href="/salary/employees" className="underline underline-offset-2 hover:text-foreground">
        {t('vacation_info_link')}
      </Link>
    </p>
  )
}

/** Informational scope notes for the payroll module. */
export function SalaryInfoNotes() {
  const t = useTranslations('settings_salary')
  return (
    <div className="text-sm text-muted-foreground space-y-2">
      <p>{t('info_payroll_scope')}</p>
      <p>
        {t.rich('info_current_year', {
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
      </p>
    </div>
  )
}
