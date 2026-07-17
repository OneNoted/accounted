'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { switchCompany } from '@/lib/company/actions'
import { performCompanySwitch } from '@/lib/company/switch-client'

/**
 * Deliberate jump-in control for a roster row. Switching the active company
 * rewrites user_preferences.active_company_id (the RLS-authoritative value)
 * and hard-reloads every open tab via CompanyTabSync, so it gets an explicit
 * button rather than a row click.
 */
export function OpenClientButton({
  companyId,
  name,
  className,
}: {
  companyId: string
  name: string
  className?: string
}) {
  const t = useTranslations('bureau')
  const ts = useTranslations('company_switcher')
  const { toast } = useToast()
  const [pending, setPending] = useState(false)

  async function handleOpen() {
    setPending(true)
    const result = await switchCompany(companyId)
    if (result.error) {
      setPending(false)
      toast({
        title: ts(result.error === 'not_member' ? 'error_no_access' : 'error_switch_failed'),
        variant: 'destructive',
      })
      return
    }
    performCompanySwitch(companyId)
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      aria-busy={pending}
      aria-label={t('action.open_aria', { name })}
      onClick={handleOpen}
      className={className}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        t('action.open')
      )}
    </Button>
  )
}
