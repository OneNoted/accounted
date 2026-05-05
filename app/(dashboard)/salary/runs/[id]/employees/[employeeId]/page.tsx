'use client'

import { use, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AbsenceCalendar } from '@/components/salary/AbsenceCalendar'
import { formatCurrency } from '@/lib/utils'
import type { SalaryRun, SalaryRunEmployee, SalaryLineItem, Employee } from '@/types'

interface DetailResponse {
  run: SalaryRun
  runEmployee: SalaryRunEmployee & { employee: Employee; line_items: SalaryLineItem[] }
}

export default function SalaryRunEmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string; employeeId: string }>
}) {
  const { id: runId, employeeId } = use(params)
  const [data, setData] = useState<DetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [runRes, sreRes] = await Promise.all([
        fetch(`/api/salary/runs/${runId}`),
        fetch(`/api/salary/runs/${runId}/employees/${employeeId}`),
      ])
      const runJson = await runRes.json()
      const sreJson = await sreRes.json()
      if (!runRes.ok) throw new Error(runJson.error || 'Kunde inte ladda lönekörning')
      if (!sreRes.ok) throw new Error(sreJson.error || 'Kunde inte ladda anställd')
      setData({ run: runJson.data, runEmployee: sreJson.data })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Okänt fel')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, employeeId])

  const periodStart = useMemo(() => {
    if (!data) return ''
    const y = data.run.period_year
    const m = data.run.period_month
    return `${y}-${String(m).padStart(2, '0')}-01`
  }, [data])

  const periodEnd = useMemo(() => {
    if (!data) return ''
    const y = data.run.period_year
    const m = data.run.period_month
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
    return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
  }, [data])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Laddar...
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="space-y-3">
        <Link
          href={`/salary/runs/${runId}`}
          className="inline-flex items-center text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Tillbaka till lönekörning
        </Link>
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error ?? 'Kunde inte ladda anställd'}
        </div>
      </div>
    )
  }

  const { run, runEmployee } = data
  const employee = runEmployee.employee
  const lineItems = runEmployee.line_items ?? []
  const periodLabel = `${run.period_year}-${String(run.period_month).padStart(2, '0')}`
  const readOnly = run.status !== 'draft' && run.status !== 'review'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <Link
          href={`/salary/runs/${runId}`}
          className="inline-flex items-center text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Tillbaka till lönekörning
        </Link>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="font-serif text-2xl font-medium tracking-tight">
              {employee.first_name} {employee.last_name}
            </h1>
            <p className="text-sm text-muted-foreground tabular-nums">
              {employee.personnummer} · Lönespecifikation {periodLabel}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load}>
            Uppdatera
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Brutto" value={runEmployee.gross_salary} />
        <SummaryCard label="Skatt" value={runEmployee.tax_withheld} />
        <SummaryCard label="Netto" value={runEmployee.net_salary} accent />
        <SummaryCard label="Avgifter" value={runEmployee.avgifter_amount} />
      </div>

      {/* Absence calendar */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Frånvaro</CardTitle>
          <p className="text-xs text-muted-foreground">
            Markera sjukdom, VAB, föräldraledighet och annan frånvaro per dag.
            Karensavdrag, sjuklön och AGI-rapportering räknas ut automatiskt.
          </p>
        </CardHeader>
        <CardContent>
          <AbsenceCalendar
            employeeId={employee.id}
            periodStart={periodStart}
            periodEnd={periodEnd}
            salaryRunEmployeeId={runEmployee.id}
            readOnly={readOnly}
            onChange={load}
          />
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <AbsenceCount label="Sjukdagar" days={runEmployee.sick_days} />
            <AbsenceCount label="VAB-dagar" days={runEmployee.vab_days} />
            <AbsenceCount label="Föräldraledig" days={runEmployee.parental_days} />
          </div>
        </CardContent>
      </Card>

      {/* Line items */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lönerader ({lineItems.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {lineItems.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Inga lönerader. Kör beräkning på lönekörningen för att skapa standardrader.
            </p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Typ</th>
                  <th className="px-4 py-2 font-medium">Beskrivning</th>
                  <th className="px-4 py-2 font-medium text-right">Antal</th>
                  <th className="px-4 py-2 font-medium text-right">Belopp</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map(li => (
                  <tr key={li.id} className="border-b last:border-0">
                    <td className="px-4 py-2 text-xs text-muted-foreground">{li.item_type}</td>
                    <td className="px-4 py-2 text-sm">{li.description}</td>
                    <td className="px-4 py-2 text-sm text-right tabular-nums">{li.quantity ?? '—'}</td>
                    <td className="px-4 py-2 text-sm text-right tabular-nums">{formatCurrency(li.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function SummaryCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`rounded-md border bg-card p-3 ${accent ? 'ring-1 ring-primary/40' : ''}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-medium tabular-nums">{formatCurrency(value)}</div>
    </div>
  )
}

function AbsenceCount({ label, days }: { label: string; days: number }) {
  return (
    <div className="rounded-md border bg-muted/30 px-2.5 py-1.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm font-medium tabular-nums">{days} dagar</div>
    </div>
  )
}
