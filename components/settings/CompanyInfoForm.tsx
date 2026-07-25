'use client'

import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import {
  SettingsFieldRow,
  settingsInputClassName,
} from '@/components/settings/sheet/SettingsFieldRow'
import { cn } from '@/lib/utils'
import type { CompanySettings } from '@/types'

interface CompanyInfoFormProps {
  settings: CompanySettings
}

export function CompanyInfoForm({ settings }: CompanyInfoFormProps) {
  const t = useTranslations('settings_company')
  return (
    <div className="divide-y divide-border">
      <SettingsFieldRow
        label={t('company_name_label')}
        htmlFor="company_name"
        description={t('company_name_help')}
      >
        <Input
          id="company_name"
          name="company_name"
          defaultValue={settings.company_name || ''}
          className={cn(settingsInputClassName, 'w-64')}
        />
      </SettingsFieldRow>

      <SettingsFieldRow
        label={t('org_number_label')}
        htmlFor="org_number"
        description={settings.onboarding_complete ? t('org_number_locked') : undefined}
      >
        <Input
          id="org_number"
          name="org_number"
          defaultValue={settings.org_number || ''}
          disabled={settings.onboarding_complete === true}
          className={cn(settingsInputClassName, 'w-48 tabular-nums')}
        />
      </SettingsFieldRow>

      <SettingsFieldRow label={t('address_label')} htmlFor="address_line1">
        <Input
          id="address_line1"
          name="address_line1"
          defaultValue={settings.address_line1 || ''}
          className={cn(settingsInputClassName, 'w-64')}
        />
      </SettingsFieldRow>

      <SettingsFieldRow label={t('postal_code_label')} htmlFor="postal_code">
        <Input
          id="postal_code"
          name="postal_code"
          defaultValue={settings.postal_code || ''}
          className={cn(settingsInputClassName, 'w-24 tabular-nums')}
        />
      </SettingsFieldRow>

      <SettingsFieldRow label={t('city_label')} htmlFor="city">
        <Input
          id="city"
          name="city"
          defaultValue={settings.city || ''}
          className={cn(settingsInputClassName, 'w-48')}
        />
      </SettingsFieldRow>

      <SettingsFieldRow label={t('phone_label')} htmlFor="phone">
        <Input
          id="phone"
          name="phone"
          type="tel"
          defaultValue={settings.phone || ''}
          className={cn(settingsInputClassName, 'w-48')}
        />
      </SettingsFieldRow>

      <SettingsFieldRow label={t('email_label')} htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          defaultValue={settings.email || ''}
          className={cn(settingsInputClassName, 'w-64')}
        />
      </SettingsFieldRow>

      <SettingsFieldRow label={t('website_label')} htmlFor="website">
        <Input
          id="website"
          name="website"
          defaultValue={settings.website || ''}
          placeholder="https://"
          className={cn(settingsInputClassName, 'w-64')}
        />
      </SettingsFieldRow>
    </div>
  )
}
