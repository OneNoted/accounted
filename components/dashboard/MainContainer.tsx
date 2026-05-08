'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/**
 * Picks the dashboard chrome container based on route. Extension workspaces
 * (/e/*) want the full viewport for file viewers and dashboards; everything
 * else gets the centered max-w-5xl card.
 *
 * Lives in a client component because the parent (dashboard) layout is
 * shared across all dashboard routes. Server-side pathname checks done in
 * the layout don't re-evaluate reliably on soft navigation between sibling
 * routes, so the wrapper class would otherwise stick on whichever branch
 * the first render picked.
 */
export function MainContainer({
  companyId,
  children,
}: {
  companyId: string | null
  children: ReactNode
}) {
  const pathname = usePathname()
  const isExtensionWorkspace = pathname.startsWith('/e/')

  return isExtensionWorkspace ? (
    <div key={companyId ?? ''} className="h-full">{children}</div>
  ) : (
    <div
      key={companyId ?? ''}
      className="max-w-5xl mx-auto px-5 py-8 md:px-8 md:py-10"
    >
      {children}
    </div>
  )
}
