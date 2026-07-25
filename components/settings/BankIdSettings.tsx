'use client'

import { useTranslations } from 'next-intl'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { BankIdAuth } from '@/components/auth/BankIdAuth'
import type { BankIdResult } from '@/components/auth/BankIdAuth'
import { Button } from '@/components/ui/button'
import { SettingsFieldRow } from '@/components/settings/sheet/SettingsFieldRow'
import { Shield, ShieldCheck, Loader2 } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { useFormat } from '@/lib/hooks/use-format'

interface BankIdIdentity {
  given_name: string | null
  surname: string | null
  linked_at: string
}

export function BankIdSettings() {
  const t = useTranslations('settings_bankid')
  const [identity, setIdentity] = useState<BankIdIdentity | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLinking, setIsLinking] = useState(false)
  const [isUnlinking, setIsUnlinking] = useState(false)
  const { toast } = useToast()
  const { formatDateLong } = useFormat()

  const fetchIdentity = useCallback(async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setIsLoading(false); return }

    const { data } = await supabase
      .from('bankid_identities')
      .select('given_name, surname, linked_at')
      .eq('user_id', user.id)
      .maybeSingle()

    setIdentity(data)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    fetchIdentity()
  }, [fetchIdentity])

  const handleLinkComplete = async (result: BankIdResult) => {
    if (result.error) {
      const message = result.error === 'already_linked'
        ? t('toast_already_linked')
        : t('toast_link_failed')
      toast({ title: message, variant: 'destructive' })
      setIsLinking(false)
      return
    }

    toast({ title: t('toast_linked') })
    setIsLinking(false)
    fetchIdentity()
  }

  const handleUnlink = async () => {
    if (!confirm(t('confirm_unlink'))) return

    setIsUnlinking(true)
    try {
      const res = await fetch('/api/extensions/ext/tic/bankid/unlink', { method: 'POST' })
      if (!res.ok) throw new Error('Unlink failed')

      setIdentity(null)
      toast({ title: t('toast_unlinked') })
    } catch {
      toast({ title: t('toast_unlink_failed'), variant: 'destructive' })
    } finally {
      setIsUnlinking(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (isLinking) {
    return (
      <div className="space-y-3 py-2">
        <div>
          <p className="text-sm">{t('link_bankid_title')}</p>
          <p className="text-xs text-muted-foreground">{t('link_bankid_description')}</p>
        </div>
        <div className="flex flex-col items-center">
          <BankIdAuth mode="link" onComplete={handleLinkComplete} />
        </div>
      </div>
    )
  }

  // Either name part can be absent in the BankID payload; joining blindly
  // renders "null null" in the row. Whatever is present carries the line, and
  // with neither the linked-on date stands alone.
  const linkedDescription = identity
    ? [
        [identity.given_name, identity.surname].filter(Boolean).join(' '),
        t('linked_on', { date: formatDateLong(identity.linked_at) }),
      ]
        .filter(Boolean)
        .join(' · ')
    : null

  return (
    <SettingsFieldRow
      label={
        <span className="flex items-center gap-2">
          {identity ? (
            <ShieldCheck className="h-4 w-4 text-success" />
          ) : (
            <Shield className="h-4 w-4 text-muted-foreground" />
          )}
          {t('title')}
        </span>
      }
      description={linkedDescription ?? t('not_linked_description')}
    >
      {identity ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleUnlink}
          disabled={isUnlinking}
          className="text-destructive hover:text-destructive"
        >
          {isUnlinking ? t('unlinking') : t('unlink_button')}
        </Button>
      ) : (
        <Button variant="outline" onClick={() => setIsLinking(true)}>
          {t('link_button')}
        </Button>
      )}
    </SettingsFieldRow>
  )
}
