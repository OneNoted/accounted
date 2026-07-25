'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  SettingsFieldRow,
  settingsInputClassName,
} from '@/components/settings/sheet/SettingsFieldRow'
import { cn } from '@/lib/utils'
import type { CompanySettings } from '@/types'

interface TaxSettingsFormProps {
  settings: CompanySettings
  /** Ledger-derived signal: EU sales postings exist (3108/3308/3107). */
  euSalesDetected?: boolean
  /** Ledger-derived signal: utdelning/ägarlån postings exist (2898/2393/2893). */
  kuSignalDetected?: boolean
  /** Invoice-derived signal: invoices with ROT/RUT deductions exist. */
  rotRutSignalDetected?: boolean
}

/** Group heading inside the panel: this one form legitimately covers several
 *  distinct obligations, so the groups keep a quiet sub-heading. */
const groupHeadingClassName = 'text-sm font-medium text-muted-foreground pt-2'

export function TaxSettingsForm({
  settings,
  euSalesDetected = false,
  kuSignalDetected = false,
  rotRutSignalDetected = false,
}: TaxSettingsFormProps) {
  const t = useTranslations('settings_tax_form')
  const [vatRegistered, setVatRegistered] = useState(settings.vat_registered ?? false)
  const [fSkatt, setFSkatt] = useState(settings.f_skatt ?? true)
  const [paysSalaries, setPaysSalaries] = useState(settings.pays_salaries ?? false)
  // Fall back to pays_salaries for rows saved before the registration flag
  // existed; saving attests the shown value.
  const [employerRegistered, setEmployerRegistered] = useState(
    settings.employer_registered ?? settings.pays_salaries ?? false,
  )
  const [employerSeasonal, setEmployerSeasonal] = useState(settings.employer_seasonal ?? false)
  const [momsPeriod, setMomsPeriod] = useState(settings.moms_period || '')
  const [vatTaxableBaseOver40m, setVatTaxableBaseOver40m] = useState(
    settings.vat_taxable_base_over_40m ?? false,
  )
  const [hasEuTrade, setHasEuTrade] = useState(settings.vat_has_eu_trade ?? false)
  const [psEnabled, setPsEnabled] = useState(settings.periodisk_sammanstallning_enabled ?? false)
  const [kuEnabled, setKuEnabled] = useState(settings.kontrolluppgifter_enabled ?? false)
  const [rotRutEnabled, setRotRutEnabled] = useState(settings.rot_rut_enabled ?? false)
  const [ossEnabled, setOssEnabled] = useState(settings.oss_enabled ?? false)
  const [iossEnabled, setIossEnabled] = useState(settings.ioss_enabled ?? false)
  const [intrastatEnabled, setIntrastatEnabled] = useState(settings.intrastat_enabled ?? false)
  const [punktskattEnabled, setPunktskattEnabled] = useState(settings.punktskatt_enabled ?? false)
  const [fyllnadEnabled, setFyllnadEnabled] = useState(
    settings.fyllnadsinbetalning_enabled ?? false,
  )

  const isEnskildFirma = settings.entity_type === 'enskild_firma'

  const months = [
    t('month_jan'), t('month_feb'), t('month_mar'), t('month_apr'),
    t('month_may'), t('month_jun'), t('month_jul'), t('month_aug'),
    t('month_sep'), t('month_oct'), t('month_nov'), t('month_dec'),
  ]

  return (
    <div className="space-y-6">
      {/* Entity type: read-only. The heading doubles as the row label, so this
          one-field group needs no separate sub-heading. */}
      <SettingsFieldRow
        label={t('entity_form_heading')}
        description={t('entity_form_help')}
      >
        <span className="text-sm">
          {settings.entity_type === 'aktiebolag' ? t('entity_aktiebolag') : t('entity_enskild_firma')}
        </span>
      </SettingsFieldRow>

      {/* F-skatt */}
      <section className="space-y-3">
        <h3 className={groupHeadingClassName}>{t('tax_vat_heading')}</h3>

        <div className="divide-y divide-border">
          <SettingsFieldRow
            label={t('f_skatt_label')}
            htmlFor="f_skatt"
            description={t('f_skatt_help')}
          >
            <Checkbox
              id="f_skatt"
              checked={fSkatt}
              onCheckedChange={(v) => setFSkatt(v === true)}
              className="mt-1"
            />
            <input type="hidden" name="f_skatt" value={fSkatt ? 'true' : 'false'} />
          </SettingsFieldRow>

          <SettingsFieldRow
            label={t('vat_registered_label')}
            htmlFor="vat_registered"
            description={t('vat_registered_help')}
          >
            <Checkbox
              id="vat_registered"
              checked={vatRegistered}
              onCheckedChange={(value) => {
                const checked = value === true
                setVatRegistered(checked)
                if (checked && vatTaxableBaseOver40m) setMomsPeriod('monthly')
              }}
              className="mt-1"
            />
            <input type="hidden" name="vat_registered" value={vatRegistered ? 'true' : 'false'} />
          </SettingsFieldRow>
        </div>

        {euSalesDetected && vatRegistered && (!hasEuTrade || !psEnabled) && (
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm">{t('eu_trade_suggestion_title')}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('eu_trade_suggestion_help')}
            </p>
          </div>
        )}

        {vatRegistered && (
          <div className="divide-y divide-border">
            <SettingsFieldRow
              label={t('vat_number_label')}
              htmlFor="vat_number"
              description={t('vat_number_help')}
            >
              <Input
                id="vat_number"
                name="vat_number"
                placeholder="SE123456789001"
                defaultValue={settings.vat_number || ''}
                className={cn(settingsInputClassName, 'w-56')}
              />
            </SettingsFieldRow>

            <SettingsFieldRow
              label={t('moms_period_label')}
              htmlFor="moms_period"
              description={t('moms_period_help')}
            >
              <Select
                name="moms_period"
                value={momsPeriod || undefined}
                onValueChange={setMomsPeriod}
              >
                <SelectTrigger id="moms_period" className="h-9 w-56 rounded-lg">
                  <SelectValue placeholder={t('select_period_placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">{t('period_monthly')}</SelectItem>
                  <SelectItem value="quarterly" disabled={vatTaxableBaseOver40m}>
                    {t('period_quarterly')}
                  </SelectItem>
                  <SelectItem value="yearly" disabled={vatTaxableBaseOver40m}>
                    {t('period_yearly')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </SettingsFieldRow>

            <SettingsFieldRow
              label={t('vat_taxable_base_over_40m_label')}
              htmlFor="vat_taxable_base_over_40m"
              description={t('vat_taxable_base_over_40m_help')}
            >
              <Checkbox
                id="vat_taxable_base_over_40m"
                checked={vatTaxableBaseOver40m}
                onCheckedChange={(value) => {
                  const checked = value === true
                  setVatTaxableBaseOver40m(checked)
                  if (checked) setMomsPeriod('monthly')
                }}
                className="mt-1"
              />
              <input
                type="hidden"
                name="vat_taxable_base_over_40m"
                value={vatTaxableBaseOver40m ? 'true' : 'false'}
              />
            </SettingsFieldRow>

            <SettingsFieldRow
              label={t('vat_has_eu_trade_label')}
              htmlFor="vat_has_eu_trade"
              description={t('vat_has_eu_trade_help')}
            >
              <Checkbox
                id="vat_has_eu_trade"
                checked={hasEuTrade}
                onCheckedChange={(value) => {
                  const checked = value === true
                  setHasEuTrade(checked)
                  if (!checked) setPsEnabled(false)
                }}
                className="mt-1"
              />
              <input type="hidden" name="vat_has_eu_trade" value={hasEuTrade ? 'true' : 'false'} />
            </SettingsFieldRow>

            {momsPeriod === 'yearly' && !hasEuTrade && !isEnskildFirma && (
              <SettingsFieldRow
                label={t('vat_filing_method_label')}
                htmlFor="vat_filing_method"
                description={t('vat_filing_method_help')}
              >
                <Select
                  name="vat_filing_method"
                  defaultValue={settings.vat_filing_method || 'electronic'}
                >
                  <SelectTrigger id="vat_filing_method" className="h-9 w-56 rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="electronic">{t('filing_method_electronic')}</SelectItem>
                    <SelectItem value="paper">{t('filing_method_paper')}</SelectItem>
                  </SelectContent>
                </Select>
              </SettingsFieldRow>
            )}

            {hasEuTrade && (
              <>
                <SettingsFieldRow
                  label={t('periodisk_enabled_label')}
                  htmlFor="periodisk_sammanstallning_enabled"
                  description={t('periodisk_enabled_help')}
                >
                  <Checkbox
                    id="periodisk_sammanstallning_enabled"
                    checked={psEnabled}
                    onCheckedChange={(value) => setPsEnabled(value === true)}
                    className="mt-1"
                  />
                  <input
                    type="hidden"
                    name="periodisk_sammanstallning_enabled"
                    value={psEnabled ? 'true' : 'false'}
                  />
                </SettingsFieldRow>

                {psEnabled && (
                  <>
                    <SettingsFieldRow
                      label={t('periodisk_label')}
                      htmlFor="periodisk_sammanstallning_period"
                      description={t('periodisk_help')}
                    >
                      <Select
                        name="periodisk_sammanstallning_period"
                        defaultValue={settings.periodisk_sammanstallning_period || 'monthly'}
                      >
                        <SelectTrigger
                          id="periodisk_sammanstallning_period"
                          className="h-9 w-56 rounded-lg"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="monthly">{t('period_monthly')}</SelectItem>
                          <SelectItem value="quarterly">{t('period_quarterly')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </SettingsFieldRow>

                    <SettingsFieldRow
                      label={t('periodisk_filing_method_label')}
                      htmlFor="periodisk_sammanstallning_filing_method"
                      description={t('periodisk_filing_method_help')}
                    >
                      <Select
                        name="periodisk_sammanstallning_filing_method"
                        defaultValue={settings.periodisk_sammanstallning_filing_method || 'electronic'}
                      >
                        <SelectTrigger
                          id="periodisk_sammanstallning_filing_method"
                          className="h-9 w-56 rounded-lg"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="electronic">{t('filing_method_electronic')}</SelectItem>
                          <SelectItem value="paper">{t('filing_method_paper')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </SettingsFieldRow>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {/* Tax contact: required for SKV-filings */}
      <section className="space-y-3">
        <h3 className={groupHeadingClassName}>{t('tax_contact_heading')}</h3>
        <p className="text-xs text-muted-foreground">
          {t('tax_contact_help')}
        </p>

        <div className="divide-y divide-border">
          <SettingsFieldRow label={t('tax_contact_name_label')} htmlFor="tax_contact_name">
            <Input
              id="tax_contact_name"
              name="tax_contact_name"
              defaultValue={settings.tax_contact_name || ''}
              placeholder={t('tax_contact_name_placeholder')}
              className={cn(settingsInputClassName, 'w-56')}
            />
          </SettingsFieldRow>

          <SettingsFieldRow label={t('tax_contact_phone_label')} htmlFor="tax_contact_phone">
            <Input
              id="tax_contact_phone"
              name="tax_contact_phone"
              defaultValue={settings.tax_contact_phone || ''}
              placeholder="08-123 45 67"
              className={cn(settingsInputClassName, 'w-56')}
            />
          </SettingsFieldRow>

          <SettingsFieldRow label={t('tax_contact_email_label')} htmlFor="tax_contact_email">
            <Input
              id="tax_contact_email"
              name="tax_contact_email"
              type="email"
              defaultValue={settings.tax_contact_email || ''}
              placeholder="anna@foretaget.se"
              className={cn(settingsInputClassName, 'w-56')}
            />
          </SettingsFieldRow>
        </div>
      </section>

      {/* Fiscal year & salaries */}
      <section className="space-y-3">
        <h3 className={groupHeadingClassName}>{t('fiscal_year_salaries_heading')}</h3>

        <div className="divide-y divide-border">
          <SettingsFieldRow
            label={t('fiscal_year_start_label')}
            htmlFor="fiscal_year_start_month"
            description={isEnskildFirma ? t('fiscal_year_ef_help') : t('fiscal_year_change_help')}
          >
            {isEnskildFirma ? (
              <>
                <Input
                  id="fiscal_year_start_month"
                  value={t('month_jan')}
                  disabled
                  className={cn(settingsInputClassName, 'w-56')}
                />
                <input type="hidden" name="fiscal_year_start_month" value="1" />
              </>
            ) : (
              <Select
                name="fiscal_year_start_month"
                defaultValue={String(settings.fiscal_year_start_month || 1)}
              >
                <SelectTrigger id="fiscal_year_start_month" className="h-9 w-56 rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {months.map((month, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>{month}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </SettingsFieldRow>

          <SettingsFieldRow
            label={t('pays_salaries_label')}
            htmlFor="pays_salaries"
            description={t('pays_salaries_help')}
          >
            <Checkbox
              id="pays_salaries"
              checked={paysSalaries}
              onCheckedChange={(v) => {
                const checked = v === true
                setPaysSalaries(checked)
                // Paying out salary obliges employer registration (SFL 7 kap. 1 §).
                if (checked) setEmployerRegistered(true)
              }}
              className="mt-1"
            />
            <input type="hidden" name="pays_salaries" value={paysSalaries ? 'true' : 'false'} />
          </SettingsFieldRow>

          <SettingsFieldRow
            label={t('employer_registered_label')}
            htmlFor="employer_registered"
            description={t('employer_registered_help')}
          >
            <Checkbox
              id="employer_registered"
              checked={employerRegistered}
              onCheckedChange={(v) => {
                const checked = v === true
                setEmployerRegistered(checked)
                if (!checked) setEmployerSeasonal(false)
              }}
              className="mt-1"
            />
            <input
              type="hidden"
              name="employer_registered"
              value={employerRegistered ? 'true' : 'false'}
            />
          </SettingsFieldRow>

          {employerRegistered && (
            <SettingsFieldRow
              label={t('employer_seasonal_label')}
              htmlFor="employer_seasonal"
              description={t('employer_seasonal_help')}
            >
              <Checkbox
                id="employer_seasonal"
                checked={employerSeasonal}
                onCheckedChange={(v) => setEmployerSeasonal(v === true)}
                className="mt-1"
              />
              <input
                type="hidden"
                name="employer_seasonal"
                value={employerSeasonal ? 'true' : 'false'}
              />
            </SettingsFieldRow>
          )}
        </div>
      </section>

      {/* Kontrolluppgifter (KU) */}
      <section className="space-y-3">
        <h3 className={groupHeadingClassName}>{t('kontrolluppgifter_heading')}</h3>

        {kuSignalDetected && !kuEnabled && (
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm">{t('ku_suggestion_title')}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('ku_suggestion_help')}
            </p>
          </div>
        )}

        <div className="divide-y divide-border">
          <SettingsFieldRow
            label={t('kontrolluppgifter_label')}
            htmlFor="kontrolluppgifter_enabled"
            description={t('kontrolluppgifter_help')}
          >
            <Checkbox
              id="kontrolluppgifter_enabled"
              checked={kuEnabled}
              onCheckedChange={(v) => setKuEnabled(v === true)}
              className="mt-1"
            />
            <input
              type="hidden"
              name="kontrolluppgifter_enabled"
              value={kuEnabled ? 'true' : 'false'}
            />
          </SettingsFieldRow>
        </div>
      </section>

      {/* ROT/RUT */}
      <section className="space-y-3">
        <h3 className={groupHeadingClassName}>{t('rot_rut_heading')}</h3>

        {rotRutSignalDetected && !rotRutEnabled && (
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm">{t('rot_rut_suggestion_title')}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('rot_rut_suggestion_help')}
            </p>
          </div>
        )}

        <div className="divide-y divide-border">
          <SettingsFieldRow
            label={t('rot_rut_label')}
            htmlFor="rot_rut_enabled"
            description={t('rot_rut_help')}
          >
            <Checkbox
              id="rot_rut_enabled"
              checked={rotRutEnabled}
              onCheckedChange={(v) => setRotRutEnabled(v === true)}
              className="mt-1"
            />
            <input
              type="hidden"
              name="rot_rut_enabled"
              value={rotRutEnabled ? 'true' : 'false'}
            />
          </SettingsFieldRow>
        </div>
      </section>

      {/* Preliminary tax */}
      <section className="space-y-3">
        <h3 className={groupHeadingClassName}>{t('preliminary_tax_heading')}</h3>

        <div className="divide-y divide-border">
          <SettingsFieldRow
            label={t('preliminary_tax_monthly_label')}
            htmlFor="preliminary_tax_monthly"
            description={t('preliminary_tax_monthly_help')}
          >
            <Input
              id="preliminary_tax_monthly"
              name="preliminary_tax_monthly"
              type="number"
              defaultValue={settings.preliminary_tax_monthly || ''}
              className={cn(settingsInputClassName, 'w-32 tabular-nums')}
            />
          </SettingsFieldRow>
        </div>
      </section>

      {/* Long-tail deadlines: explicit opt-in only */}
      <section className="space-y-3">
        <h3 className={groupHeadingClassName}>{t('more_deadlines_heading')}</h3>
        <p className="text-xs text-muted-foreground">
          {t('more_deadlines_help')}
        </p>

        <div className="divide-y divide-border">
          {vatRegistered && (
            <>
              <SettingsFieldRow
                label={t('oss_label')}
                htmlFor="oss_enabled"
                description={t('oss_help')}
              >
                <Checkbox
                  id="oss_enabled"
                  checked={ossEnabled}
                  onCheckedChange={(v) => setOssEnabled(v === true)}
                  className="mt-1"
                />
                <input type="hidden" name="oss_enabled" value={ossEnabled ? 'true' : 'false'} />
              </SettingsFieldRow>

              <SettingsFieldRow
                label={t('ioss_label')}
                htmlFor="ioss_enabled"
                description={t('ioss_help')}
              >
                <Checkbox
                  id="ioss_enabled"
                  checked={iossEnabled}
                  onCheckedChange={(v) => setIossEnabled(v === true)}
                  className="mt-1"
                />
                <input type="hidden" name="ioss_enabled" value={iossEnabled ? 'true' : 'false'} />
              </SettingsFieldRow>

              <SettingsFieldRow
                label={t('intrastat_label')}
                htmlFor="intrastat_enabled"
                description={t('intrastat_help')}
              >
                <Checkbox
                  id="intrastat_enabled"
                  checked={intrastatEnabled}
                  onCheckedChange={(v) => setIntrastatEnabled(v === true)}
                  className="mt-1"
                />
                <input
                  type="hidden"
                  name="intrastat_enabled"
                  value={intrastatEnabled ? 'true' : 'false'}
                />
              </SettingsFieldRow>
            </>
          )}

          <SettingsFieldRow
            label={t('punktskatt_label')}
            htmlFor="punktskatt_enabled"
            description={t('punktskatt_help')}
          >
            <Checkbox
              id="punktskatt_enabled"
              checked={punktskattEnabled}
              onCheckedChange={(v) => setPunktskattEnabled(v === true)}
              className="mt-1"
            />
            <input
              type="hidden"
              name="punktskatt_enabled"
              value={punktskattEnabled ? 'true' : 'false'}
            />
          </SettingsFieldRow>

          <SettingsFieldRow
            label={t('fyllnadsinbetalning_label')}
            htmlFor="fyllnadsinbetalning_enabled"
            description={t('fyllnadsinbetalning_help')}
          >
            <Checkbox
              id="fyllnadsinbetalning_enabled"
              checked={fyllnadEnabled}
              onCheckedChange={(v) => setFyllnadEnabled(v === true)}
              className="mt-1"
            />
            <input
              type="hidden"
              name="fyllnadsinbetalning_enabled"
              value={fyllnadEnabled ? 'true' : 'false'}
            />
          </SettingsFieldRow>
        </div>
      </section>
    </div>
  )
}
