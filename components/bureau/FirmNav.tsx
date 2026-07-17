'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

const TABS = [
  { href: '/companies', key: 'companies' },
  { href: '/team', key: 'team' },
] as const

/**
 * Firm-altitude tab row. Grows with the firm dashboard: workflow runs and
 * firm settings become new tabs here, never new top-level regions.
 */
export function FirmNav() {
  const pathname = usePathname()
  const t = useTranslations('bureau')
  return (
    <nav className="flex gap-6" aria-label={t('title')}>
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'pb-3 -mb-px border-b-2 text-sm transition-colors duration-150',
              active
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`nav.${tab.key}`)}
          </Link>
        )
      })}
    </nav>
  )
}
