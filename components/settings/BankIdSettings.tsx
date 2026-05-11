'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { BankIdAuth } from '@/components/auth/BankIdAuth'
import type { BankIdResult } from '@/components/auth/BankIdAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Shield, ShieldCheck, Loader2 } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { formatDateLong } from '@/lib/utils'

interface BankIdIdentity {
  given_name: string | null
  surname: string | null
  linked_at: string
}

export function BankIdSettings() {
  const [identity, setIdentity] = useState<BankIdIdentity | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLinking, setIsLinking] = useState(false)
  const [isUnlinking, setIsUnlinking] = useState(false)
  const { toast } = useToast()

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
        ? 'Detta BankID ar redan kopplat till ett annat konto.'
        : 'Kunde inte koppla BankID.'
      toast({ title: message, variant: 'destructive' })
      setIsLinking(false)
      return
    }

    toast({ title: 'BankID kopplat till ditt konto' })
    setIsLinking(false)
    fetchIdentity()
  }

  const handleUnlink = async () => {
    if (!confirm('Vill du koppla bort BankID fran ditt konto?')) return

    setIsUnlinking(true)
    try {
      const res = await fetch('/api/extensions/ext/tic/bankid/unlink', { method: 'POST' })
      if (!res.ok) throw new Error('Unlink failed')

      setIdentity(null)
      toast({ title: 'BankID bortkopplat' })
    } catch {
      toast({ title: 'Kunde inte koppla bort BankID', variant: 'destructive' })
    } finally {
      setIsUnlinking(false)
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  if (isLinking) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Koppla BankID</CardTitle>
          <CardDescription>Skanna QR-koden med BankID-appen</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center">
          <BankIdAuth mode="link" onComplete={handleLinkComplete} />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {identity ? (
            <ShieldCheck className="h-4 w-4 text-green-600" />
          ) : (
            <Shield className="h-4 w-4 text-muted-foreground" />
          )}
          BankID
        </CardTitle>
        <CardDescription>
          {identity
            ? 'Ditt konto ar kopplat till BankID.'
            : 'Koppla BankID for sakrare inloggning.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {identity ? (
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {identity.given_name} {identity.surname}
              </span>
              <span className="ml-2">
                Kopplat {formatDateLong(identity.linked_at)}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleUnlink}
              disabled={isUnlinking}
              className="text-destructive hover:text-destructive"
            >
              {isUnlinking ? 'Kopplar bort...' : 'Koppla bort'}
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            onClick={() => setIsLinking(true)}
          >
            Koppla BankID
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
