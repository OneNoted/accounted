'use client'

import { useTranslations } from 'next-intl'
import { FiscalYearsManager } from '@/components/settings/FiscalYearsManager'
import {
  BookkeepingFrameworkSettings,
  BookkeepingMethodSettings,
  BookkeepingSeriesMapSettings,
  BookkeepingSeriesStatus,
  BookkeepingAutomationSettings,
  BookkeepingRelatedLinks,
} from './BookkeepingSubsections'

/**
 * Legacy stacked layout for the Bokföring section. The settings sheet renders
 * the same subsections as accordion panels via the sheet registry
 * (components/settings/sheet/subsections.tsx); this component only stacks them
 * with hairline separators for surfaces that still show the whole section.
 */
export function BookkeepingSettingsContent() {
  const t = useTranslations('settings_bookkeeping')

  return (
    <div className="space-y-8">
      <BookkeepingFrameworkSettings />
      <BookkeepingMethodSettings />

      {/* Fiscal years */}
      <div className="border-t border-border pt-8">
        <FiscalYearsManager />
      </div>

      {/* Voucher series: per-source-type mapping */}
      <div className="border-t border-border pt-8">
        <BookkeepingSeriesMapSettings />
      </div>

      {/* Voucher series: read-only display */}
      <div className="border-t border-border pt-8">
        <BookkeepingSeriesStatus />
      </div>

      {/* Feature toggles */}
      <div className="border-t border-border pt-8">
        <BookkeepingAutomationSettings />
      </div>

      {/* Cross-links */}
      <div className="border-t border-border pt-8 space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {t('related_heading')}
        </h2>
        <BookkeepingRelatedLinks />
      </div>
    </div>
  )
}
