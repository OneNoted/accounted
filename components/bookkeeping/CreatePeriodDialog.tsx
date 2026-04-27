'use client'

import { useState, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { Loader2 } from 'lucide-react'
import type { FiscalPeriod } from '@/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  entryDate: string
  periods: FiscalPeriod[]
  onCreated: () => void
}

function computeSuggestedPeriod(entryDate: string, periods: FiscalPeriod[]) {
  if (periods.length === 0) {
    // No periods at all — suggest a calendar year period around the entry date
    const year = entryDate.split('-')[0]
    return {
      name: `FY ${year}`,
      period_start: `${year}-01-01`,
      period_end: `${year}-12-31`,
    }
  }

  const sorted = [...periods].sort((a, b) => a.period_start.localeCompare(b.period_start))
  const earliest = sorted[0]
  const latest = sorted[sorted.length - 1]

  if (entryDate < earliest.period_start) {
    // Backward: end = day before earliest start, start = 12 months back, 1st of month
    // Use UTC throughout — local-time Date math + toISOString() shifts dates by
    // the timezone offset (e.g. CET produces 2024-12-31 → 2025-12-30).
    const end = new Date(earliest.period_start + 'T00:00:00Z')
    end.setUTCDate(end.getUTCDate() - 1)

    const start = new Date(end)
    start.setUTCMonth(start.getUTCMonth() - 11)
    start.setUTCDate(1)

    const startStr = start.toISOString().split('T')[0]
    const endStr = end.toISOString().split('T')[0]
    const startYear = start.getUTCFullYear()
    const endYear = end.getUTCFullYear()
    const name = startYear === endYear ? `FY ${startYear}` : `FY ${startYear}/${endYear}`

    return { name, period_start: startStr, period_end: endStr }
  }

  // Forward: start = day after latest end, end = 12 months later (last day of month)
  const start = new Date(latest.period_end + 'T00:00:00Z')
  start.setUTCDate(start.getUTCDate() + 1)

  const end = new Date(start)
  end.setUTCMonth(end.getUTCMonth() + 12)
  end.setUTCDate(0) // Last day of previous month

  const startStr = start.toISOString().split('T')[0]
  const endStr = end.toISOString().split('T')[0]
  const startYear = start.getUTCFullYear()
  const endYear = end.getUTCFullYear()
  const name = startYear === endYear ? `FY ${startYear}` : `FY ${startYear}/${endYear}`

  return { name, period_start: startStr, period_end: endStr }
}

export default function CreatePeriodDialog({ open, onOpenChange, entryDate, periods, onCreated }: Props) {
  const { toast } = useToast()
  const suggested = useMemo(() => computeSuggestedPeriod(entryDate, periods), [entryDate, periods])

  const [name, setName] = useState(suggested.name)
  const [periodStart, setPeriodStart] = useState(suggested.period_start)
  const [periodEnd, setPeriodEnd] = useState(suggested.period_end)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Reset form when suggested values change (dialog reopened with new date)
  const [lastSuggested, setLastSuggested] = useState(suggested)
  if (suggested.name !== lastSuggested.name || suggested.period_start !== lastSuggested.period_start) {
    setName(suggested.name)
    setPeriodStart(suggested.period_start)
    setPeriodEnd(suggested.period_end)
    setLastSuggested(suggested)
  }

  const handleCreate = async () => {
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/bookkeeping/fiscal-periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, period_start: periodStart, period_end: periodEnd }),
      })

      const result = await res.json()

      if (!res.ok) {
        toast({
          title: 'Kunde inte skapa räkenskapsår',
          description: result.error || 'Ett oväntat fel uppstod.',
          variant: 'destructive',
        })
        return
      }

      toast({ title: 'Räkenskapsår skapat', description: `${name} har skapats.` })
      onOpenChange(false)
      onCreated()
    } catch {
      toast({
        title: 'Kunde inte skapa räkenskapsår',
        description: 'Ett nätverksfel uppstod. Försök igen.',
        variant: 'destructive',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Skapa räkenskapsår</DialogTitle>
          <DialogDescription>
            Det finns inget räkenskapsår som täcker datumet {entryDate}. Skapa ett nytt nedan.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Namn</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Startdatum</Label>
              <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Slutdatum</Label>
              <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="mt-1" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Avbryt
          </Button>
          <Button onClick={handleCreate} disabled={isSubmitting || !name || !periodStart || !periodEnd}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Skapa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
