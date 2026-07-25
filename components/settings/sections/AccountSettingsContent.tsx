'use client'

import { InstallAppSection } from '@/components/settings/InstallAppSection'
import { SecuritySettings } from '@/components/settings/SecuritySettings'
import {
  AccountNameSettings,
  AccountAppearanceSettings,
  AccountCalendarSettings,
  AccountLogoutSettings,
  AccountLegalLinks,
  AccountDangerSettings,
} from './AccountSubsections'

/**
 * Legacy stacked layout for the Konto section. The settings sheet renders
 * the same subsections as accordion panels via the sheet registry
 * (components/settings/sheet/subsections.tsx); this component only stacks them
 * with hairline separators for surfaces that still show the whole section.
 */
export function AccountSettingsContent() {
  return (
    <div className="space-y-8">
      {/* Name */}
      <AccountNameSettings />

      {/* Appearance + language */}
      <div className="border-t border-border pt-8">
        <AccountAppearanceSettings />
      </div>

      {/* Install as app: renders nothing when already running installed */}
      <InstallAppSection />

      {/* Security */}
      <div className="border-t border-border pt-8">
        <SecuritySettings />
      </div>

      {/* Calendar feed: renders nothing without the calendar extension */}
      <AccountCalendarSettings />

      {/* Logout */}
      <div className="border-t border-border pt-8">
        <AccountLogoutSettings />
      </div>

      {/* Privacy & agreements */}
      <div className="border-t border-border pt-8">
        <AccountLegalLinks />
      </div>

      {/* Delete account: only for non-sandbox */}
      <AccountDangerSettings />
    </div>
  )
}
