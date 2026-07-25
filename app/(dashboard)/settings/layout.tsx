'use client'

import { useEffect } from 'react'
import { usePathname, useSearchParams, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { PageHeader } from '@/components/ui/page-header'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { isSheetSection } from '@/components/settings/useSettingsNavItems'
import { ActiveCompanyBadge } from '@/components/settings/ActiveCompanyBadge'

const TAB_TO_ROUTE: Record<string, string> = {
  company: '/settings/company',
  invoicing: '/settings/invoicing',
  payments: '/import?mode=stripe',
  bookkeeping: '/settings/bookkeeping',
  tax: '/settings/tax',
  team: '/settings/team',
  banking: '/settings/banking',
  templates: '/settings/templates',
  'agent-memory': '/settings/assistant',
  assistant: '/settings/assistant',
  account: '/settings/account',
  api: '/settings/api',
}

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const t = useTranslations('settings_nav')

  // Handle legacy ?tab= URLs
  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab && TAB_TO_ROUTE[tab]) {
      router.replace(TAB_TO_ROUTE[tab])
    }
  }, [searchParams, router])

  // Sections in the nav registry are drawn by the sheet, not by this layout:
  // the intercepting route on soft navigation, `@settingsModal/default.tsx` on
  // a cold load. Both cover the panel exactly, so drawing the surface here as
  // well would stack a second copy behind the sheet and run every section's
  // fetches twice. Their page components are route stubs, so this renders
  // nothing. That covers every registry route, including one hidden by a
  // visibility rule but reached via deep link: the stub still renders null, so
  // the sheet has to be the surface that answers for it. Everything else under
  // /settings (team, backup, skatteverket, company-profile, ...) keeps the
  // legacy header + rail layout.
  if (isSheetSection(pathname)) {
    return <>{children}</>
  }

  return (
    <div className="space-y-8">
      <PageHeader title={t('aria_label')} action={<ActiveCompanyBadge />} />
      <SettingsShell variant="page">{children}</SettingsShell>
    </div>
  )
}
