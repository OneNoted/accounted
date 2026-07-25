import { ColdLoadSettingsSheet } from '@/components/settings/ColdLoadSettingsSheet'

// Parallel-slot fallback. Next.js renders this for the `@settingsModal` slot on
// every route where the intercepting route beside it does NOT match: every page
// other than settings, and every hard load of /settings (interception only
// applies to soft navigation).
//
// On non-settings routes ColdLoadSettingsSheet renders nothing. On a hard load
// of a settings section it renders the sheet, so a refresh or a pasted deep
// link gets the same surface as opening settings from inside the app.
export default function SettingsSlotDefault() {
  return <ColdLoadSettingsSheet />
}
