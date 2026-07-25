'use client'

import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  SettingsFieldRow,
  settingsInputClassName,
} from '@/components/settings/sheet/SettingsFieldRow'
import { cn } from '@/lib/utils'
import type { CompanySettings } from '@/types'

interface PeriodLockingSettingsProps {
  settings: CompanySettings
}

export function PeriodLockingSettings({ settings }: PeriodLockingSettingsProps) {
  const t = useTranslations('settings_period_locking')
  return (
    <>
      <SettingsFieldRow
        label={t('locked_through_label')}
        htmlFor="bookkeeping_locked_through"
        description={t('locked_through_help')}
      >
        <Input
          id="bookkeeping_locked_through"
          name="bookkeeping_locked_through"
          type="date"
          defaultValue={settings.bookkeeping_locked_through || ''}
          className={cn(settingsInputClassName, 'w-40 tabular-nums')}
        />
      </SettingsFieldRow>

      <SettingsFieldRow
        label={t('auto_lock_label')}
        htmlFor="auto_lock_period_days"
        description={t('auto_lock_help')}
      >
        <Select
          name="auto_lock_period_days"
          defaultValue={settings.auto_lock_period_days?.toString() || 'none'}
        >
          <SelectTrigger id="auto_lock_period_days" className="h-9 w-56 rounded-lg">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t('auto_lock_none')}</SelectItem>
            <SelectItem value="30">{t('auto_lock_30')}</SelectItem>
            <SelectItem value="60">{t('auto_lock_60')}</SelectItem>
            <SelectItem value="90">{t('auto_lock_90')}</SelectItem>
          </SelectContent>
        </Select>
      </SettingsFieldRow>
    </>
  )
}
