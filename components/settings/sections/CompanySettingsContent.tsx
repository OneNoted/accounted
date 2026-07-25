'use client'

import { CompanyDangerZone } from '@/components/settings/CompanyDangerZone'
import { CompanyMembersSection } from '@/components/settings/CompanyMembersSection'
import { CompanyProfileSection } from '@/components/settings/CompanyProfileSection'
import { FiscalPeriodEditor } from '@/components/settings/FiscalPeriodEditor'
import { SettingsLoadError } from '@/components/settings/SettingsLoadError'
import { SettingsLoadingSkeleton } from '@/components/settings/SettingsLoadingSkeleton'
import { useSettings } from '@/components/settings/useSettings'
import { CompanyInfoSettings, CompanyLogoSettings } from './CompanySubsections'

/**
 * Legacy stacked layout for the Företag section. The settings sheet renders
 * the same subsections as accordion panels via the sheet registry
 * (components/settings/sheet/subsections.tsx); this component only stacks them
 * with hairline separators for surfaces that still show the whole section.
 *
 * The top-level loading/error gate stays here so the whole section keeps
 * showing a single skeleton until settings resolve (the subsections carry
 * their own guards for standalone accordion use, but they settle instantly
 * against the already-loaded shared settings state).
 */
export function CompanySettingsContent() {
  const { settings, isLoading, refetch } = useSettings()

  if (isLoading) return <SettingsLoadingSkeleton />
  if (!settings) return <SettingsLoadError onRetry={refetch} />

  return (
    <div className="space-y-8">
      {/* Company info + share capital (one form, one save) */}
      <CompanyInfoSettings />

      {/* Logo */}
      <div className="border-t border-border pt-8">
        <CompanyLogoSettings />
      </div>

      {/* Members */}
      <div className="border-t border-border pt-8">
        <CompanyMembersSection />
      </div>

      {/* First fiscal period: renders its own separator, owner/admin only */}
      <FiscalPeriodEditor />

      {/* Företagsprofil (Bolagsverket snapshot) */}
      <CompanyProfileSection />

      {/* Danger zone: renders its own separator, owner only */}
      <CompanyDangerZone />
    </div>
  )
}
