'use client'

import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  SettingsFieldRow,
  settingsInputClassName,
} from '@/components/settings/sheet/SettingsFieldRow'
import { cn } from '@/lib/utils'
import type { CompanySettings } from '@/types'

interface InvoiceSettingsFormProps {
  settings: CompanySettings
}

export function InvoiceSettingsForm({ settings }: InvoiceSettingsFormProps) {
  const t = useTranslations('settings_invoice_form')
  return (
    <>
      <div className="divide-y divide-border">
        <SettingsFieldRow label={t('prefix_label')} htmlFor="invoice_prefix">
          <Input
            id="invoice_prefix"
            name="invoice_prefix"
            placeholder={t('prefix_placeholder')}
            defaultValue={settings.invoice_prefix || ''}
            className={cn(settingsInputClassName, 'w-32')}
          />
        </SettingsFieldRow>

        <SettingsFieldRow label={t('next_number_label')} htmlFor="next_invoice_number">
          <Input
            id="next_invoice_number"
            name="next_invoice_number"
            type="number"
            min="1"
            defaultValue={settings.next_invoice_number || 1}
            className={cn(settingsInputClassName, 'w-24 tabular-nums')}
          />
        </SettingsFieldRow>

        <SettingsFieldRow label={t('default_days_label')} htmlFor="invoice_default_days">
          <Input
            id="invoice_default_days"
            name="invoice_default_days"
            type="number"
            min="0"
            defaultValue={settings.invoice_default_days || 30}
            className={cn(settingsInputClassName, 'w-24 tabular-nums')}
          />
        </SettingsFieldRow>

        <SettingsFieldRow
          label={t('arrival_start_label')}
          htmlFor="next_arrival_number"
          help={t('arrival_start_help')}
        >
          <Input
            id="next_arrival_number"
            name="next_arrival_number"
            type="number"
            min="1"
            defaultValue={settings.next_arrival_number || 1}
            className={cn(settingsInputClassName, 'w-24 tabular-nums')}
          />
        </SettingsFieldRow>

        <SettingsFieldRow
          stacked
          label={t('default_notes_label')}
          htmlFor="invoice_default_notes"
          description={t('default_notes_help')}
        >
          <Textarea
            id="invoice_default_notes"
            name="invoice_default_notes"
            rows={3}
            placeholder={t('default_notes_placeholder')}
            defaultValue={settings.invoice_default_notes || ''}
          />
        </SettingsFieldRow>

        <SettingsFieldRow
          label={t('default_our_reference_label')}
          htmlFor="default_our_reference"
          description={t('default_our_reference_help')}
        >
          <Input
            id="default_our_reference"
            name="default_our_reference"
            placeholder={t('default_our_reference_placeholder')}
            defaultValue={settings.default_our_reference || ''}
            className={cn(settingsInputClassName, 'w-56')}
          />
        </SettingsFieldRow>
      </div>

      <h3 className="text-sm font-medium text-muted-foreground pt-2">
        {t('reminder_days_heading')}
      </h3>
      <p className="text-xs text-muted-foreground">{t('reminder_days_help')}</p>

      <div className="divide-y divide-border">
        <SettingsFieldRow label={t('reminder_days_level_1')} htmlFor="reminder_days_level_1">
          <Input
            id="reminder_days_level_1"
            name="reminder_days_level_1"
            type="number"
            min="1"
            max="365"
            defaultValue={settings.reminder_days_level_1 ?? 15}
            className={cn(settingsInputClassName, 'w-24 tabular-nums')}
          />
        </SettingsFieldRow>

        <SettingsFieldRow label={t('reminder_days_level_2')} htmlFor="reminder_days_level_2">
          <Input
            id="reminder_days_level_2"
            name="reminder_days_level_2"
            type="number"
            min="1"
            max="365"
            defaultValue={settings.reminder_days_level_2 ?? 30}
            className={cn(settingsInputClassName, 'w-24 tabular-nums')}
          />
        </SettingsFieldRow>

        <SettingsFieldRow label={t('reminder_days_level_3')} htmlFor="reminder_days_level_3">
          <Input
            id="reminder_days_level_3"
            name="reminder_days_level_3"
            type="number"
            min="1"
            max="365"
            defaultValue={settings.reminder_days_level_3 ?? 45}
            className={cn(settingsInputClassName, 'w-24 tabular-nums')}
          />
        </SettingsFieldRow>
      </div>
    </>
  )
}
