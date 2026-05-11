'use client'

import { useState, useEffect, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { AlertTriangle, CreditCard, ExternalLink } from 'lucide-react'
import { getSettingsPanel } from '@/lib/extensions/settings-panel-registry'
import { ENABLED_EXTENSION_IDS } from '@/lib/extensions/_generated/enabled-extensions'

const BankingPanel = getSettingsPanel('enable-banking')

export default function BankingSettingsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { toast } = useToast()
  const [bankConnectionError, setBankConnectionError] = useState<string | null>(null)
  const [failedBankName, setFailedBankName] = useState<string | null>(null)
  const [isAccessDenied, setIsAccessDenied] = useState(false)
  const syncInitiatedRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const unmountedRef = useRef(false)
  const hasBankingExtension = ENABLED_EXTENSION_IDS.has('enable-banking')

  useEffect(() => {
    return () => {
      unmountedRef.current = true
      if (abortControllerRef.current) abortControllerRef.current.abort()
    }
  }, [])

  useEffect(() => {
    const bankConnected = searchParams.get('bank_connected')
    const bankError = searchParams.get('bank_error')

    if (bankConnected === 'true' && !syncInitiatedRef.current) {
      syncInitiatedRef.current = true
      const connectionId = searchParams.get('connection_id')
      router.replace('/settings/banking')

      if (connectionId) {
        toast({
          title: 'Synkroniserar transaktioner...',
          description: 'Hämtar transaktioner från din bank i bakgrunden.',
        })
        const controller = new AbortController()
        abortControllerRef.current = controller
        const syncTimeout = setTimeout(() => controller.abort(), 120_000)

        ;(async () => {
          try {
            const res = await fetch('/api/extensions/ext/enable-banking/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ connection_id: connectionId, days_back: 120 }),
              signal: controller.signal,
            })
            clearTimeout(syncTimeout)
            const data = await res.json()
            if (res.ok) {
              if (!unmountedRef.current) {
                toast({
                  title: 'Bank ansluten!',
                  description: `${data.imported ?? 0} transaktioner importerade`,
                })
              }
            } else {
              throw new Error(data.error || 'Sync failed')
            }
          } catch (err) {
            clearTimeout(syncTimeout)
            if (unmountedRef.current) return
            if (controller.signal.aborted) {
              toast({
                title: 'Synkronisering tog för lång tid',
                description: 'Transaktionerna hämtas i bakgrunden. Ladda om sidan om en stund.',
              })
            } else {
              toast({
                title: 'Synkronisering misslyckades',
                description: err instanceof Error ? err.message : 'Kunde inte hämta transaktioner',
                variant: 'destructive',
              })
            }
          }
        })()
      } else {
        toast({
          title: 'Bank ansluten!',
          description: 'Din bank är nu kopplad.',
        })
      }
    }

    if (bankError) {
      let errorMsg: string
      try { errorMsg = decodeURIComponent(bankError) } catch { errorMsg = bankError }
      const bankName = searchParams.get('bank_name')
      const errorCode = searchParams.get('bank_error_code')
      toast({
        title: 'Anslutning misslyckades',
        description: errorMsg,
        variant: 'destructive',
      })
      setBankConnectionError(errorMsg)
      if (bankName) setFailedBankName(bankName)
      if (errorCode === 'access_denied') setIsAccessDenied(true)
      router.replace('/settings/banking')
    }
  }, [searchParams, router, toast])

  return (
    <div className="space-y-8">
      {bankConnectionError && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div className="flex-1">
            <p className="text-sm font-medium text-destructive">{bankConnectionError}</p>
            {isAccessDenied && failedBankName && (
              <p className="mt-1 text-sm text-muted-foreground">
                {failedBankName} nekade åtkomst. Om du använder ett privatkonto kan du prova att ansluta med kontotypen &quot;Privatkonto&quot; i bankväljaren nedan.
              </p>
            )}
            <p className="mt-1 text-sm text-muted-foreground">
              Du kan också <Link href="/import?mode=bank" className="underline hover:text-foreground">importera transaktioner via bankfil</Link> istället.
            </p>
          </div>
          <button
            onClick={() => {
              setBankConnectionError(null)
              setFailedBankName(null)
              setIsAccessDenied(false)
            }}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground"
            aria-label="Stäng"
          >
            <span className="text-lg leading-none">&times;</span>
          </button>
        </div>
      )}

      {hasBankingExtension && BankingPanel ? (
        <BankingPanel />
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <CreditCard className="h-10 w-10 text-muted-foreground/40 mb-4" />
            <p className="font-medium mb-1">Bankintegration (PSD2) är inte aktiverad</p>
            <p className="text-sm text-muted-foreground mb-4 max-w-md">
              Aktivera tillägget Enable Banking för att koppla ditt bankkonto och automatiskt hämta transaktioner.
            </p>
            <Button variant="outline" asChild>
              <Link href="/extensions">
                <ExternalLink className="mr-2 h-4 w-4" />
                Gå till Tillägg
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
