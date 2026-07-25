'use client'

import { TaxAssessmentNoticesPanel } from '@/components/settings/TaxAssessmentNoticesPanel'
import {
  TaxSkatteverketConnectionSettings,
  TaxDetailsSettings,
} from './TaxSubsections'

/**
 * Legacy stacked layout for the Skatt section. The settings sheet renders
 * the same subsections as accordion panels via the sheet registry
 * (components/settings/sheet/subsections.tsx); this component only stacks
 * them for surfaces that still show the whole section.
 */
export function TaxSettingsContent() {
  return (
    <div className="space-y-8">
      {/* Connection panel first: the skattekonto and momsdeklaration pages
          send users here specifically to (re)connect; below the long tax
          form it sat out of view. */}
      <TaxSkatteverketConnectionSettings />

      <TaxDetailsSettings />

      <TaxAssessmentNoticesPanel />
    </div>
  )
}
