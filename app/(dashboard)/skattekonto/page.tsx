'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/components/ui/use-toast'
import { formatCurrency } from '@/lib/utils'
import {
  Copy,
  ExternalLink,
  FileCheck,
  Landmark,
  RefreshCw,
} from 'lucide-react'
import type {
  SkatteverketSaldoResponse,
  StoredSkattekontoTransaction,
} from '@/extensions/general/skatteverket/types'

interface SaldoEnvelope {
  data: SkatteverketSaldoResponse | null
  fetchedAt: string | null
  lastSyncedAt: string | null
}

interface TransaktionerEnvelope {
  data: {
    booked: StoredSkattekontoTransaction[]
    upcoming: StoredSkattekontoTransaction[]
  }
}

export default function SkattekontoPage() {
  const { toast } = useToast()
  const [saldo, setSaldo] = useState<SaldoEnvelope | null>(null)
  const [tx, setTx] = useState<TransaktionerEnvelope['data'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [bookingId, setBookingId] = useState<string | null>(null)
  const [notConnected, setNotConnected] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [saldoRes, txRes] = await Promise.all([
        fetch('/api/extensions/ext/skatteverket/skattekonto/saldo'),
        fetch('/api/extensions/ext/skatteverket/skattekonto/transaktioner'),
      ])

      if (saldoRes.status === 401) {
        setNotConnected(true)
        return
      }

      const saldoJson = (await saldoRes.json()) as SaldoEnvelope
      setSaldo(saldoJson)

      if (txRes.ok) {
        const txJson = (await txRes.json()) as TransaktionerEnvelope
        setTx(txJson.data)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function syncNow() {
    setSyncing(true)
    try {
      const res = await fetch('/api/extensions/ext/skatteverket/skattekonto/sync', {
        method: 'POST',
      })
      const json = await res.json()
      if (!res.ok) {
        if (res.status === 401) {
          setNotConnected(true)
          return
        }
        throw new Error(json.error || 'Synk misslyckades')
      }
      toast({
        title: 'Skattekonto synkroniserat',
        description: `${json.data.booked} bokförda, ${json.data.upcoming} kommande`,
      })
      await reload()
    } catch (err) {
      toast({
        title: 'Synk misslyckades',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      })
    } finally {
      setSyncing(false)
    }
  }

  async function bokfor(id: string) {
    setBookingId(id)
    try {
      const res = await fetch(
        `/api/extensions/ext/skatteverket/skattekonto/transaktioner/${id}/bokfor`,
        { method: 'POST' },
      )
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || 'Bokföring misslyckades')
      }
      toast({
        title: 'Utkast skapat',
        description: 'Granska och bokför verifikatet i Bokföring.',
      })
      // Take the user to the draft so they can review.
      window.location.href = `/bookkeeping/${json.data.entry.id}`
    } catch (err) {
      toast({
        title: 'Kunde inte bokföra',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      })
    } finally {
      setBookingId(null)
    }
  }

  function copyOcr(ocr: string) {
    navigator.clipboard
      .writeText(ocr)
      .then(() => toast({ title: 'OCR kopierat' }))
      .catch(() => {})
  }

  if (notConnected) {
    return (
      <div className="space-y-6">
        <PageHeading />
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <Landmark className="mb-4 h-10 w-10 text-muted-foreground/40" />
            <p className="mb-1 font-medium">Skatteverket är inte anslutet</p>
            <p className="mb-4 max-w-md text-sm text-muted-foreground">
              För att se saldo och transaktioner på skattekontot behöver du
              ansluta med BankID i inställningarna.
            </p>
            <Button asChild>
              <Link href="/settings/skatteverket">
                <ExternalLink className="mr-2 h-4 w-4" />
                Anslut Skatteverket
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeading
        right={
          <Button onClick={syncNow} disabled={syncing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Synkroniserar…' : 'Synkronisera nu'}
          </Button>
        }
      />

      <BalanceHero saldo={saldo} loading={loading} onCopyOcr={copyOcr} />

      <Card>
        <CardHeader>
          <CardTitle>Transaktioner</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="booked">
            <TabsList>
              <TabsTrigger value="booked">
                Bokförda {tx?.booked ? `(${tx.booked.length})` : ''}
              </TabsTrigger>
              <TabsTrigger value="upcoming">
                Kommande {tx?.upcoming ? `(${tx.upcoming.length})` : ''}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="booked" className="mt-4">
              <TransactionTable
                rows={tx?.booked ?? []}
                onBokfor={bokfor}
                bookingId={bookingId}
                emptyText="Inga bokförda transaktioner än."
              />
            </TabsContent>
            <TabsContent value="upcoming" className="mt-4">
              <TransactionTable
                rows={tx?.upcoming ?? []}
                onBokfor={bokfor}
                bookingId={bookingId}
                emptyText="Inga kommande transaktioner."
                showForfallodatum
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}

function PageHeading({ right }: { right?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h1 className="font-serif text-3xl">Skattekonto</h1>
        <p className="text-sm text-muted-foreground">
          Saldo och transaktioner från Skatteverket
        </p>
      </div>
      {right}
    </div>
  )
}

function BalanceHero({
  saldo,
  loading,
  onCopyOcr,
}: {
  saldo: SaldoEnvelope | null
  loading: boolean
  onCopyOcr: (ocr: string) => void
}) {
  if (loading && !saldo?.data) {
    return (
      <Card>
        <CardContent className="py-12 text-sm text-muted-foreground">
          Hämtar saldo…
        </CardContent>
      </Card>
    )
  }

  if (!saldo?.data) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Inget saldo hämtat ännu — klicka på &quot;Synkronisera nu&quot;.
        </CardContent>
      </Card>
    )
  }

  const { data } = saldo
  const skvNegative = data.saldoSkatteverket < 0
  const kfmNegative = data.saldoKronofogden < 0

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Skatteverket
            </p>
            <p
              className={`font-serif text-4xl tabular-nums ${
                skvNegative ? 'text-destructive' : 'text-foreground'
              }`}
            >
              {formatCurrency(data.saldoSkatteverket)}
            </p>
            {data.rantaSkatteverket !== 0 && (
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                Preliminär ränta: {formatCurrency(data.rantaSkatteverket)}
              </p>
            )}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Kronofogden
            </p>
            <p
              className={`font-serif text-4xl tabular-nums ${
                kfmNegative ? 'text-destructive' : 'text-foreground'
              }`}
            >
              {formatCurrency(data.saldoKronofogden)}
            </p>
            {data.rantaKronofogden !== 0 && (
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                Preliminär ränta: {formatCurrency(data.rantaKronofogden)}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 border-t pt-4 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              OCR
            </p>
            <p className="flex items-center gap-2 font-medium tabular-nums">
              {data.ocrNummer}
              <button
                onClick={() => onCopyOcr(data.ocrNummer)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Kopiera OCR"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Nästa avstämning
            </p>
            <p className="font-medium tabular-nums">{data.nastaAvstamningsdatum}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Senast uppdaterad
            </p>
            <p className="font-medium tabular-nums">
              {new Date(data.senastUppdaterad).toLocaleString('sv-SE')}
            </p>
          </div>
        </div>

        {data.informationstext.length > 0 && (
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide">
              Information från Skatteverket
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {data.informationstext.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function TransactionTable({
  rows,
  onBokfor,
  bookingId,
  emptyText,
  showForfallodatum = false,
}: {
  rows: StoredSkattekontoTransaction[]
  onBokfor: (id: string) => void
  bookingId: string | null
  emptyText: string
  showForfallodatum?: boolean
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{emptyText}</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Datum</TableHead>
          {showForfallodatum && <TableHead>Förfallodatum</TableHead>}
          <TableHead>Beskrivning</TableHead>
          <TableHead className="text-right">Belopp</TableHead>
          <TableHead>Status</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(row => {
          const negative = Number(row.belopp_skatteverket) < 0
          const isBooked = !!row.journal_entry_id
          return (
            <TableRow key={row.id}>
              <TableCell className="tabular-nums">{row.transaktionsdatum}</TableCell>
              {showForfallodatum && (
                <TableCell className="tabular-nums">{row.forfallodatum ?? '–'}</TableCell>
              )}
              <TableCell>{row.transaktionstext}</TableCell>
              <TableCell
                className={`text-right tabular-nums ${negative ? 'text-destructive' : ''}`}
              >
                {formatCurrency(Number(row.belopp_skatteverket))}
              </TableCell>
              <TableCell>
                {isBooked ? (
                  <Badge variant="secondary" className="gap-1">
                    <FileCheck className="h-3 w-3" />
                    Bokförd
                  </Badge>
                ) : (
                  <Badge variant="outline">Ej bokförd</Badge>
                )}
              </TableCell>
              <TableCell className="text-right">
                {isBooked ? (
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/bookkeeping/${row.journal_entry_id}`}>
                      Visa verifikat
                    </Link>
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onBokfor(row.id)}
                    disabled={bookingId === row.id}
                  >
                    {bookingId === row.id ? 'Bokför…' : 'Bokför'}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
