'use client'

import { useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/use-toast'
import { SkatteverketConnectPanel } from '@/components/settings/SkatteverketConnectPanel'

export default function SkatteverketSettingsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    const connected = searchParams.get('skv_connected')
    const error = searchParams.get('skv_error')

    if (connected === 'true') {
      toast({
        title: 'Skatteverket anslutet',
        description: 'Du kan nu skicka deklarationer och hämta skattekonto-saldot.',
      })
      router.replace('/settings/skatteverket')
    } else if (error) {
      let msg: string
      try { msg = decodeURIComponent(error) } catch { msg = error }
      toast({
        title: 'Anslutning misslyckades',
        description: msg,
        variant: 'destructive',
      })
      router.replace('/settings/skatteverket')
    }
  }, [searchParams, router, toast])

  return (
    <div className="space-y-8">
      <SkatteverketConnectPanel />
    </div>
  )
}
