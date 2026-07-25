'use client'

import { useRouter } from 'next/navigation'
import { CompanyInfoForm } from '@/components/settings/CompanyInfoForm'
import { LogoUpload } from '@/components/settings/LogoUpload'
import { SettingsFormWrapper } from '@/components/settings/SettingsFormWrapper'
import { SettingsLoadError } from '@/components/settings/SettingsLoadError'
import { SettingsLoadingSkeleton } from '@/components/settings/SettingsLoadingSkeleton'
import { ShareCapitalForm } from '@/components/settings/ShareCapitalForm'
import { useSettings } from '@/components/settings/useSettings'
import type { CompanySettings } from '@/types'

/**
 * Company settings decomposed into standalone subsections so the settings
 * sheet can render them as accordion panels (Dragspelet) while the legacy
 * full-section component composes the same pieces. One implementation, two
 * layouts: the sheet and the section view can never drift.
 *
 * Subsections that already exist as standalone no-prop components are used
 * directly rather than wrapped: CompanyMembersSection, FiscalPeriodEditor,
 * CompanyProfileSection and CompanyDangerZone (all under
 * components/settings/). Only pieces whose wiring lived inline in
 * CompanySettingsContent get a component here.
 */

/** Company info + share capital: one form, one save, exactly the fields that
 *  live on /api/settings. Share capital (the statutory aktiekapital note per
 *  Bolagsverket) only exists for aktiebolag, so that half renders
 *  conditionally inside the same form. */
export function CompanyInfoSettings() {
  const router = useRouter()
  const { settings, isLoading, updateSettings, refetch } = useSettings()

  if (isLoading) return <SettingsLoadingSkeleton />
  if (!settings) return <SettingsLoadError onRetry={refetch} />

  function handleSave(formData: FormData) {
    // Empty string clears the value (schema accepts null, not '').
    const numberOrNull = (name: string) => {
      const raw = String(formData.get(name) ?? '').trim()
      if (raw === '') return null
      const parsed = Number(raw)
      // NaN would serialize to null in JSON and silently clear the value.
      return Number.isFinite(parsed) ? parsed : null
    }
    const updates: Record<string, unknown> = {
      ...(formData.has('company_name') && { company_name: formData.get('company_name') as string }),
      ...(formData.has('org_number') && { org_number: formData.get('org_number') as string }),
      address_line1: formData.get('address_line1') as string,
      postal_code: formData.get('postal_code') as string,
      city: formData.get('city') as string,
      phone: (formData.get('phone') as string) || '',
      email: (formData.get('email') as string) || '',
      website: (formData.get('website') as string) || '',
      ...(formData.has('aktiekapital') && { aktiekapital: numberOrNull('aktiekapital') }),
      ...(formData.has('antal_aktier') && { antal_aktier: numberOrNull('antal_aktier') }),
    }
    return {
      updates,
      onSuccess: (data: Record<string, unknown>) => {
        updateSettings(data as Partial<CompanySettings>)
        // Refresh server components so the company switcher and DashboardNav
        // pick up the new company_name (rendered from server in the dashboard layout).
        if ('company_name' in updates) {
          router.refresh()
        }
      },
    }
  }

  return (
    <SettingsFormWrapper onSave={handleSave} className="space-y-6">
      <CompanyInfoForm settings={settings} />
      {settings.entity_type === 'aktiebolag' && (
        <ShareCapitalForm
          settings={{ aktiekapital: settings.aktiekapital, antal_aktier: settings.antal_aktier }}
        />
      )}
    </SettingsFormWrapper>
  )
}

/** Invoice/PDF logo upload, bound to the shared settings state. */
export function CompanyLogoSettings() {
  const { settings, isLoading, updateSettings, refetch } = useSettings()

  if (isLoading) return <SettingsLoadingSkeleton />
  if (!settings) return <SettingsLoadError onRetry={refetch} />

  return (
    <LogoUpload
      logoUrl={settings.logo_url}
      onUpdate={(url) => updateSettings({ logo_url: url })}
    />
  )
}
