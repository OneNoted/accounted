'use client'

import { ApiKeysSettings, ApiOAuthClientsSettings } from './ApiSubsections'

/**
 * Legacy stacked layout for the API section. The settings sheet renders the
 * same subsections as accordion panels via the sheet registry
 * (components/settings/sheet/subsections.tsx); this component only stacks
 * them for surfaces that still show the whole section.
 */
export function ApiSettingsContent() {
  return (
    <div className="space-y-8">
      <ApiKeysSettings />
      <ApiOAuthClientsSettings />
    </div>
  )
}
