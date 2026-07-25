'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sun, Moon, Monitor, LogOut, Languages, ExternalLink } from 'lucide-react'
import { useTheme } from 'next-themes'
import { createClient } from '@/lib/supabase/client'
import { CalendarFeedSettings } from '@/components/settings/CalendarFeedSettings'
import { AccountDangerZone } from '@/components/settings/AccountDangerZone'
import { ENABLED_EXTENSION_IDS } from '@/lib/extensions/_generated/enabled-extensions'
import { useSettings } from '@/components/settings/useSettings'
import { clearRecaptIdentity } from '@/lib/recapt'
import { useToast } from '@/components/ui/use-toast'
import {
  SettingsFieldRow,
  settingsInputClassName,
} from '@/components/settings/sheet/SettingsFieldRow'
import { cn } from '@/lib/utils'
import { SUPPORTED_LOCALES, type Locale } from '@/i18n/config'

/**
 * Account settings decomposed into standalone subsections so the settings
 * sheet can render them as accordion panels (Dragspelet) while the legacy
 * full-section component composes the same pieces. One implementation, two
 * layouts: the sheet and the section view can never drift.
 *
 * Subsections that already exist as standalone no-prop components are used
 * directly rather than wrapped: SecuritySettings and InstallAppSection (both
 * under components/settings/). Only pieces whose wiring lived inline in
 * AccountSettingsContent get a component here.
 */

/** Display name, persisted to profiles.full_name. */
export function AccountNameSettings() {
  const router = useRouter()
  const supabase = createClient()
  const { toast } = useToast()
  const tCommon = useTranslations('common')
  const tSettings = useTranslations('settings')
  const [fullName, setFullName] = useState('')
  const [initialName, setInitialName] = useState('')
  const [nameLoading, setNameLoading] = useState(true)
  const [savingName, setSavingName] = useState(false)

  // Pre-fill the name field from profiles.full_name. Self-contained client
  // fetch: mirrors BankIdSettings.
  useEffect(() => {
    let active = true
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { if (active) setNameLoading(false); return }
      const { data } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .maybeSingle()
      if (!active) return
      setFullName(data?.full_name ?? '')
      setInitialName(data?.full_name ?? '')
      setNameLoading(false)
    })()
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSaveName() {
    const trimmed = fullName.trim()
    if (!trimmed || trimmed === initialName || savingName) return
    setSavingName(true)
    try {
      const res = await fetch('/api/user/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: trimmed }),
      })
      if (!res.ok) throw new Error('Could not save')
      setFullName(trimmed)
      setInitialName(trimmed)
      toast({ title: tSettings('name_saved') })
      router.refresh()
    } catch {
      toast({ title: tSettings('name_save_failed'), variant: 'destructive' })
    } finally {
      setSavingName(false)
    }
  }

  return (
    <div className="divide-y divide-border">
      <SettingsFieldRow
        label={tSettings('name_label')}
        htmlFor="full_name"
        description={tSettings('name_description')}
      >
        <div className="flex items-center gap-2">
          <Input
            id="full_name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder={tSettings('name_placeholder')}
            disabled={nameLoading || savingName}
            maxLength={100}
            className={cn(settingsInputClassName, 'w-56')}
          />
          <Button
            size="sm"
            onClick={handleSaveName}
            disabled={
              nameLoading || savingName || !fullName.trim() || fullName.trim() === initialName
            }
          >
            {savingName ? tCommon('saving') : tCommon('save')}
          </Button>
        </div>
      </SettingsFieldRow>
    </div>
  )
}

/** Theme choice + interface language: the two personal presentation
 *  preferences, one row each with the hairline between them. */
export function AccountAppearanceSettings() {
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const { toast } = useToast()
  const activeLocale = useLocale() as Locale
  const tCommon = useTranslations('common')
  const tSettings = useTranslations('settings')
  const [savingLocale, setSavingLocale] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  async function handleLocaleChange(next: Locale) {
    if (next === activeLocale || savingLocale) return
    setSavingLocale(true)
    try {
      const res = await fetch('/api/user/locale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: next }),
      })
      if (!res.ok) throw new Error('Could not save')
      toast({ title: tSettings('language_saved') })
      router.refresh()
    } catch {
      toast({
        title: tSettings('language_save_failed'),
        variant: 'destructive',
      })
    } finally {
      setSavingLocale(false)
    }
  }

  const localeLabels: Record<Locale, string> = {
    sv: tCommon('language_swedish'),
    en: tCommon('language_english'),
  }

  return (
    <div className="divide-y divide-border">
      {/* Appearance */}
      <SettingsFieldRow label={tSettings('section_appearance')}>
        {mounted && (
          <div className="flex gap-2">
            {([
              { value: 'light', labelKey: 'theme_light', icon: Sun },
              { value: 'dark', labelKey: 'theme_dark', icon: Moon },
              { value: 'system', labelKey: 'theme_system', icon: Monitor },
            ] as const).map(({ value, labelKey, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setTheme(value)}
                className={`flex h-9 items-center gap-2 rounded-lg border px-3 text-sm transition-colors ${
                  theme === value
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40'
                }`}
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                {tCommon(labelKey)}
              </button>
            ))}
          </div>
        )}
      </SettingsFieldRow>

      {/* Language */}
      <SettingsFieldRow
        label={tSettings('section_language')}
        description={tSettings('language_description')}
      >
        <div className="flex gap-2">
          {SUPPORTED_LOCALES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => handleLocaleChange(value)}
              disabled={savingLocale}
              className={`flex h-9 items-center gap-2 rounded-lg border px-3 text-sm transition-colors disabled:opacity-50 ${
                activeLocale === value
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/40'
              }`}
            >
              <Languages className="h-4 w-4 text-muted-foreground" />
              {localeLabels[value]}
            </button>
          ))}
        </div>
      </SettingsFieldRow>
    </div>
  )
}

/** Calendar feed: only when the calendar extension is enabled in this build.
 *  Carries its own hairline separator (like InstallAppSection) so hiding it
 *  leaves no stray border behind. */
export function AccountCalendarSettings() {
  const hasCalendarExtension = ENABLED_EXTENSION_IDS.has('calendar')
  if (!hasCalendarExtension) return null
  return (
    <div className="border-t border-border pt-8">
      <CalendarFeedSettings />
    </div>
  )
}

/** Sign out of this device. */
export function AccountLogoutSettings() {
  const router = useRouter()
  const supabase = createClient()
  const tCommon = useTranslations('common')

  async function handleLogout() {
    clearRecaptIdentity()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="divide-y divide-border">
      <SettingsFieldRow
        label={tCommon('logout')}
        description={tCommon('logout_description')}
      >
        <Button variant="outline" size="sm" onClick={handleLogout}>
          <LogOut className="mr-2 h-4 w-4" />
          {tCommon('logout')}
        </Button>
      </SettingsFieldRow>
    </div>
  )
}

/** Privacy & agreements: surface the otherwise-unlinked DPA + privacy policy. */
export function AccountLegalLinks() {
  const tSettings = useTranslations('settings')
  return (
    <div className="divide-y divide-border">
      <Link
        href="/privacy"
        target="_blank"
        rel="noopener noreferrer"
        className="group flex min-h-10 items-center justify-between gap-6 py-3 text-sm"
      >
        <span>{tSettings('legal_privacy')}</span>
        <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
      </Link>
      <Link
        href="/dpa"
        target="_blank"
        rel="noopener noreferrer"
        className="group flex min-h-10 items-center justify-between gap-6 py-3 text-sm"
      >
        <span>{tSettings('legal_dpa')}</span>
        <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
      </Link>
    </div>
  )
}

/** Delete account: only for non-sandbox. */
export function AccountDangerSettings() {
  const { settings } = useSettings()
  if (settings?.is_sandbox) return null
  return <AccountDangerZone />
}
