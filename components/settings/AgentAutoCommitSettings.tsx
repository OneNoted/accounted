'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { Loader2, Sparkles } from 'lucide-react'

export function AgentAutoCommitSettings() {
  const { toast } = useToast()
  const [enabled, setEnabled] = useState(false)
  const [maxAmount, setMaxAmount] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/settings')
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return
        const data = body?.data ?? {}
        setEnabled(Boolean(data.agent_auto_commit_enabled))
        setMaxAmount(
          data.agent_auto_commit_max_amount != null
            ? String(data.agent_auto_commit_max_amount)
            : ''
        )
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function save() {
    setSaving(true)
    const parsedMax = maxAmount.trim() === '' ? null : Number(maxAmount)
    if (parsedMax !== null && (Number.isNaN(parsedMax) || parsedMax < 0)) {
      toast({ title: 'Ogiltigt belopp', description: 'Ange ett positivt tal eller lämna fältet tomt.', variant: 'destructive' })
      setSaving(false)
      return
    }

    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_auto_commit_enabled: enabled,
        agent_auto_commit_max_amount: parsedMax,
      }),
    })

    setSaving(false)

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast({
        title: 'Kunde inte spara',
        description: body?.error ?? 'Försök igen.',
        variant: 'destructive',
      })
      return
    }

    toast({ title: 'Sparat', description: 'Inställningar för auto-godkännande uppdaterade.' })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          Auto-godkännande för agenter
        </CardTitle>
        <CardDescription>
          När detta är aktivt får betrodda agenter (API-nycklar och Claude Desktop via OAuth)
          köra åtgärder med låg risk utan din godkännande. Hög-risk-åtgärder (periodlåsning,
          bokslut, fakturautskick m.m.) kräver alltid manuell granskning oavsett inställning.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Laddar…
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <Switch
                id="agent_auto_commit_enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
              <div className="space-y-1">
                <Label htmlFor="agent_auto_commit_enabled">Aktivera auto-godkännande</Label>
                <p className="text-xs text-muted-foreground max-w-prose">
                  Endast åtgärder klassificerade som <em>låg risk</em> (t.ex. skapa kund) körs
                  automatiskt. Hög-risk är alltid stoppad och hamnar i kön för granskning.
                </p>
              </div>
            </div>

            <div className="space-y-2 max-w-xs">
              <Label htmlFor="agent_auto_commit_max_amount">
                Maxbelopp per åtgärd (SEK)
              </Label>
              <Input
                id="agent_auto_commit_max_amount"
                type="number"
                inputMode="decimal"
                min={0}
                step={1}
                placeholder="Ingen gräns"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
                disabled={!enabled}
              />
              <p className="text-xs text-muted-foreground">
                Lämna tomt för ingen gräns. Åtgärder över beloppet faller tillbaka till manuell
                granskning.
              </p>
            </div>

            <div className="pt-2">
              <Button onClick={save} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Spara
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
