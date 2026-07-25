'use client'

import { useTranslations } from 'next-intl'
import {
  SalaryPaymentSettings,
  SalaryTaxTables,
  SalaryVacationInfo,
  SalaryInfoNotes,
} from './SalarySubsections'

/**
 * Legacy stacked layout for the Löner section. The settings sheet renders the
 * same subsections as accordion panels via the sheet registry
 * (components/settings/sheet/subsections.tsx).
 */
export function SalarySettingsContent() {
  const t = useTranslations('settings_salary')

  return (
    <div className="space-y-8">
      <SalaryPaymentSettings />

      {/* Tax tables (read-only status) */}
      <div className="border-t border-border pt-8">
        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            {t('tax_tables_heading')}
          </h2>
          <SalaryTaxTables />
        </section>
      </div>

      {/* Vacation (informational — the rule is per-employee) */}
      <div className="border-t border-border pt-8">
        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            {t('vacation_heading')}
          </h2>
          <SalaryVacationInfo />
        </section>
      </div>

      {/* Info */}
      <div className="border-t border-border pt-8">
        <section className="space-y-2">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            {t('info_heading')}
          </h2>
          <SalaryInfoNotes />
        </section>
      </div>
    </div>
  )
}
