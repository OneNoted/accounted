'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useToast } from '@/components/ui/use-toast'
import { formatCurrency } from '@/lib/utils'
import type { StoredSkattekontoTransaction } from '@/types/skatteverket'

interface MatchCandidate {
  journal_entry_id: string
  voucher_number: number | null
  voucher_series: string | null
  entry_date: string
  description: string
  status: 'draft' | 'posted' | 'reversed'
  matched_amount: number
  matched_side: 'debit' | 'credit'
}

/**
 * Shared dialog for linking a skattekonto_transactions row to an existing
 * journal entry. Used by both /skattekonto and /transactions so we don't
 * have two copies of the same dialog drifting apart.
 *
 * The dialog owns its own data fetch — pass the row + open flag and it
 * handles the rest. On successful match it calls onMatched(), letting the
 * caller refresh its data.
 */
export function SkattekontoMatchDialog({
  row,
  open,
  onClose,
  onMatched,
}: {
  row: StoredSkattekontoTransaction | null
  open: boolean
  onClose: () => void
  onMatched: () => void
}) {
  const { toast } = useToast()
  const [candidates, setCandidates] = useState<MatchCandidate[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [submittingId, setSubmittingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !row) {
      setCandidates(null)
      return
    }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch(
          `/api/extensions/ext/skatteverket/skattekonto/transaktioner/${row.id}/match-candidates`,
        )
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) {
          throw new Error(json.error || 'Kunde inte söka kandidater')
        }
        setCandidates(json.data.candidates as MatchCandidate[])
      } catch (err) {
        if (cancelled) return
        toast({
          title: 'Kunde inte hämta kandidater',
          description: err instanceof Error ? err.message : undefined,
          variant: 'destructive',
        })
        onClose()
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, row, toast, onClose])

  async function confirmMatch(journalEntryId: string) {
    if (!row) return
    setSubmittingId(journalEntryId)
    try {
      const res = await fetch(
        `/api/extensions/ext/skatteverket/skattekonto/transaktioner/${row.id}/match`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ journal_entry_id: journalEntryId }),
        },
      )
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || 'Matchning misslyckades')
      }
      toast({ title: 'Transaktion kopplad till verifikat' })
      onMatched()
      onClose()
    } catch (err) {
      toast({
        title: 'Kunde inte koppla transaktionen',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      })
    } finally {
      setSubmittingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Matcha mot befintligt verifikat</DialogTitle>
          <DialogDescription>
            {row && (
              <>
                {row.transaktionsdatum} • {row.transaktionstext} •{' '}
                <span className="tabular-nums">
                  {formatCurrency(Number(row.belopp_skatteverket))}
                </span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Söker kandidater…
          </p>
        )}

        {!loading && candidates && candidates.length === 0 && (
          <div className="space-y-2 py-4 text-sm">
            <p>Hittade inga verifikat med en matchande rad på konto 1630.</p>
            <p className="text-muted-foreground">
              Kandidaten måste ha samma belopp och sida på 1630 inom ±14 dagar
              från transaktionsdatumet, och får inte redan vara kopplad till en
              annan skattekonto-transaktion. Använd <strong>Bokför</strong> för
              att skapa ett nytt verifikat istället.
            </p>
          </div>
        )}

        {!loading && candidates && candidates.length > 0 && (
          <div className="max-h-[420px] overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Datum</TableHead>
                  <TableHead>Verifikat</TableHead>
                  <TableHead>Beskrivning</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.map(c => (
                  <TableRow key={c.journal_entry_id}>
                    <TableCell className="tabular-nums">{c.entry_date}</TableCell>
                    <TableCell className="tabular-nums">
                      {c.voucher_series && c.voucher_number
                        ? `${c.voucher_series}${c.voucher_number}`
                        : '–'}
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate">
                      {c.description}
                    </TableCell>
                    <TableCell>
                      {c.status === 'posted' ? (
                        <Badge variant="secondary">Bokförd</Badge>
                      ) : c.status === 'draft' ? (
                        <Badge variant="outline">Utkast</Badge>
                      ) : (
                        <Badge variant="destructive">Makulerad</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        onClick={() => confirmMatch(c.journal_entry_id)}
                        disabled={submittingId === c.journal_entry_id}
                      >
                        {submittingId === c.journal_entry_id ? 'Kopplar…' : 'Koppla'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Avbryt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
