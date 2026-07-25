'use client'

import { BookingTemplatesPanel } from '@/components/settings/BookingTemplatesPanel'
import { CounterpartyTemplatesPanel } from '@/components/settings/CounterpartyTemplatesPanel'

/**
 * Legacy stacked layout for the Mallar section. Both panels are fully
 * self-contained (no props), so the settings sheet registry renders
 * BookingTemplatesPanel and CounterpartyTemplatesPanel directly as accordion
 * panels; no subsection wrappers exist for this section.
 */
export function TemplatesSettingsContent() {
  return (
    <div className="space-y-8">
      <BookingTemplatesPanel />
      <CounterpartyTemplatesPanel />
    </div>
  )
}
