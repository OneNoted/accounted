'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { switchCompany } from '@/lib/company/actions'
import { performCompanySwitch } from '@/lib/company/switch-client'
import { CATEGORY_ROUTES, rankedWorklistCategories } from '@/lib/bureau/category-routes'
import type { WorklistCounts } from '@/lib/worklist/types'

/**
 * Deliberate jump-in control for a roster row. Switching the active company
 * rewrites user_preferences.active_company_id (the RLS-authoritative value)
 * and hard-reloads every open tab via CompanyTabSync, so it gets an explicit
 * button rather than a row click. The caret menu deep-links into the
 * category surfaces (a second deliberate click, so the destination is never
 * a surprise); the main button lands on Hem.
 */
export function OpenClientButton({
  companyId,
  name,
  worklist,
  className,
  buttonClassName,
}: {
  companyId: string
  name: string
  worklist?: WorklistCounts | null
  className?: string
  buttonClassName?: string
}) {
  const t = useTranslations('bureau')
  const ts = useTranslations('company_switcher')
  const { toast } = useToast()
  const [pending, setPending] = useState(false)

  const categories = worklist ? rankedWorklistCategories(worklist) : []

  async function handleOpen(target?: string) {
    setPending(true)
    try {
      const result = await switchCompany(companyId)
      if (result.error) {
        setPending(false)
        toast({
          title: ts(result.error === 'not_member' ? 'error_no_access' : 'error_switch_failed'),
          variant: 'destructive',
        })
        return
      }
      performCompanySwitch(companyId, target ?? '/')
    } catch {
      // Server-action transport failure (network, server error): the action
      // itself returns error codes, so anything thrown is infrastructure.
      setPending(false)
      toast({ title: ts('error_switch_failed'), variant: 'destructive' })
    }
  }

  const mainButton = (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      aria-busy={pending}
      aria-label={t('action.open_aria', { name })}
      onClick={() => handleOpen()}
      className={cn(categories.length > 0 && 'flex-1 rounded-r-none border-r-0', buttonClassName)}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        t('action.open')
      )}
    </Button>
  )

  if (categories.length === 0) {
    return <span className={cn('inline-flex', className)}>{mainButton}</span>
  }

  return (
    <span className={cn('inline-flex', className)}>
      {mainButton}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            aria-label={t('action.open_menu_aria', { name })}
            className={cn('rounded-l-none px-2', buttonClassName)}
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {categories.map(({ category, count }) => (
            <DropdownMenuItem
              key={category}
              onSelect={() => handleOpen(CATEGORY_ROUTES[category])}
              className="tabular-nums"
            >
              {count} {t(`cat.${category}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
}
