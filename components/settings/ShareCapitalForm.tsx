'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import {
  SettingsFieldRow,
  settingsInputClassName,
} from '@/components/settings/sheet/SettingsFieldRow'
import { roundOre } from '@/lib/money'
import { cn, formatCurrency } from '@/lib/utils'

// Deliberately narrow (data minimisation): the form only ever needs the two
// share-capital fields, not the whole CompanySettings object.
interface ShareCapitalFormProps {
  settings: {
    aktiekapital?: number | null
    antal_aktier?: number | null
  }
}

/**
 * Registered share capital per Bolagsverket, feeding the statutory
 * aktiekapital note in the annual report. Kvotvärde (ABL 1 kap 6 §:
 * aktiekapital / antal aktier) is derived, never entered.
 */
export function ShareCapitalForm({ settings }: ShareCapitalFormProps) {
  const t = useTranslations('settings_company')
  const [aktiekapital, setAktiekapital] = useState(
    settings.aktiekapital != null ? String(settings.aktiekapital) : '',
  )
  const [antalAktier, setAntalAktier] = useState(
    settings.antal_aktier != null ? String(settings.antal_aktier) : '',
  )

  const capital = Number(aktiekapital)
  const shares = Number(antalAktier)
  // Mirror UpdateSettingsSchema: whole-krona capital > 0, positive integer
  // share count. No preview for values the server would reject.
  const kvotvarde =
    Number.isSafeInteger(capital) && capital > 0 && Number.isSafeInteger(shares) && shares > 0
      ? roundOre(capital / shares)
      : null

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground pt-2">
        {t('share_capital_heading')}
      </h3>

      <div className="divide-y divide-border">
        <SettingsFieldRow
          label={t('aktiekapital_label')}
          htmlFor="aktiekapital"
          help={t('aktiekapital_help')}
        >
          <Input
            id="aktiekapital"
            name="aktiekapital"
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            value={aktiekapital}
            onChange={(e) => setAktiekapital(e.target.value)}
            required={antalAktier.trim() !== ''}
            className={cn(settingsInputClassName, 'w-32 tabular-nums')}
          />
        </SettingsFieldRow>

        <SettingsFieldRow
          label={t('antal_aktier_label')}
          htmlFor="antal_aktier"
          description={t('antal_aktier_help')}
        >
          <Input
            id="antal_aktier"
            name="antal_aktier"
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            value={antalAktier}
            onChange={(e) => setAntalAktier(e.target.value)}
            required={aktiekapital.trim() !== ''}
            className={cn(settingsInputClassName, 'w-32 tabular-nums')}
          />
        </SettingsFieldRow>
      </div>

      {kvotvarde !== null && (
        <p className="text-xs text-muted-foreground tabular-nums">
          {t('kvotvarde_display', { value: formatCurrency(kvotvarde) })}
        </p>
      )}
    </div>
  )
}
