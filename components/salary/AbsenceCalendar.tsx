'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  addDays,
  endOfMonth,
  format,
  isSameDay,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { sv } from 'date-fns/locale'
import {
  Activity,
  Baby,
  ChevronLeft,
  ChevronRight,
  Heart,
  HeartPulse,
  Loader2,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

// ─── Types ─────────────────────────────────────────────────────────

type AbsenceType =
  | 'sick'
  | 'vab'
  | 'parental'
  | 'pregnancy'
  | 'care_relative'
  | 'study'
  | 'other_leave'

interface AbsenceDay {
  id: string
  absence_date: string
  absence_type: AbsenceType
  hours: number
  notes: string | null
}

interface AbsenceTypeMeta {
  label: string
  shortLabel: string
  icon: LucideIcon
  // Background dot color tokens — paired with icons so color isn't sole indicator (WCAG AA).
  dotClass: string
}

const TYPE_META: Record<AbsenceType, AbsenceTypeMeta> = {
  sick: { label: 'Sjukfrånvaro', shortLabel: 'Sjuk', icon: HeartPulse, dotClass: 'bg-red-400' },
  vab: { label: 'VAB', shortLabel: 'VAB', icon: Baby, dotClass: 'bg-amber-400' },
  parental: { label: 'Föräldraledighet', shortLabel: 'Förä.', icon: Heart, dotClass: 'bg-emerald-400' },
  pregnancy: { label: 'Graviditetspenning', shortLabel: 'Grav.', icon: Heart, dotClass: 'bg-pink-400' },
  care_relative: { label: 'Närståendepenning', shortLabel: 'Närst.', icon: Heart, dotClass: 'bg-blue-400' },
  study: { label: 'Studieledig', shortLabel: 'Studie', icon: Activity, dotClass: 'bg-indigo-400' },
  other_leave: { label: 'Övrig ledighet', shortLabel: 'Övrigt', icon: Activity, dotClass: 'bg-zinc-400' },
}

const TYPE_ORDER: AbsenceType[] = ['sick', 'vab', 'parental', 'pregnancy', 'care_relative', 'study', 'other_leave']

// ─── Component ─────────────────────────────────────────────────────

export interface AbsenceCalendarProps {
  employeeId: string
  /** Pay period start (YYYY-MM-DD). The calendar opens on this month. */
  periodStart: string
  /** Pay period end (YYYY-MM-DD). Days outside the period are still
   *  visible (and editable, since absence is per-employee not per-run)
   *  but visually muted. */
  periodEnd: string
  /** Optional: link new absence rows to a specific salary run. */
  salaryRunEmployeeId?: string
  /** When true, calendar is read-only (e.g. for booked runs). */
  readOnly?: boolean
  /** Called after a successful create/delete so the parent can refresh
   *  derived totals. */
  onChange?: () => void
}

export function AbsenceCalendar({
  employeeId,
  periodStart,
  periodEnd,
  salaryRunEmployeeId,
  readOnly = false,
  onChange,
}: AbsenceCalendarProps) {
  const periodStartDate = useMemo(() => parseISO(periodStart), [periodStart])
  const periodEndDate = useMemo(() => parseISO(periodEnd), [periodEnd])

  const [visibleMonth, setVisibleMonth] = useState<Date>(() => startOfMonth(periodStartDate))
  const [days, setDays] = useState<AbsenceDay[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<{ date: string; existing?: AbsenceDay } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Pad to a 6-week grid starting on Monday (Swedish week).
  const gridStart = startOfWeek(startOfMonth(visibleMonth), { weekStartsOn: 1 })

  const loadAbsences = async () => {
    setLoading(true)
    setError(null)
    try {
      const from = format(gridStart, 'yyyy-MM-dd')
      const to = format(addDays(gridStart, 41), 'yyyy-MM-dd')
      const res = await fetch(
        `/api/salary/employees/${employeeId}/absence?from=${from}&to=${to}`,
      )
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || 'Kunde inte ladda frånvaro')
      }
      setDays(json.data ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Okänt fel')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAbsences()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, visibleMonth.getFullYear(), visibleMonth.getMonth()])

  const dayMap = useMemo(() => {
    const m = new Map<string, AbsenceDay[]>()
    for (const d of days) {
      const key = d.absence_date
      const list = m.get(key) ?? []
      list.push(d)
      m.set(key, list)
    }
    return m
  }, [days])

  const cells = useMemo(() => {
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  }, [gridStart])

  const handleCellClick = (date: Date) => {
    if (readOnly) return
    const key = format(date, 'yyyy-MM-dd')
    const existing = dayMap.get(key)?.[0] // edit first if multiple types same day
    setEditing({ date: key, existing })
  }

  return (
    <div className="rounded-md border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setVisibleMonth(prev => addDays(startOfMonth(prev), -1))}
            aria-label="Föregående månad"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium tabular-nums">
            {format(visibleMonth, 'MMMM yyyy', { locale: sv })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setVisibleMonth(prev => addDays(endOfMonth(prev), 1))}
            aria-label="Nästa månad"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b bg-muted/40 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'].map(d => (
          <div key={d} className="px-2 py-1.5 text-center">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7">
        {cells.map((date, i) => {
          const key = format(date, 'yyyy-MM-dd')
          const inMonth = date.getMonth() === visibleMonth.getMonth()
          const inPeriod = date >= periodStartDate && date <= periodEndDate
          const today = isSameDay(date, new Date())
          const dayAbsences = dayMap.get(key) ?? []

          return (
            <button
              type="button"
              key={i}
              onClick={() => handleCellClick(date)}
              disabled={readOnly}
              className={cn(
                'relative flex h-20 flex-col items-start gap-0.5 border-b border-r p-1.5 text-left text-xs transition-colors',
                !readOnly && 'hover:bg-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                readOnly && 'cursor-default',
                !inMonth && 'bg-muted/30 text-muted-foreground/60',
                !inPeriod && inMonth && 'bg-muted/10',
                today && 'ring-1 ring-inset ring-primary/40',
              )}
            >
              <span className={cn('tabular-nums', today && 'font-semibold')}>
                {format(date, 'd')}
              </span>
              {dayAbsences.length > 0 && (
                <div className="mt-auto flex flex-wrap items-center gap-0.5">
                  {dayAbsences.map(a => {
                    const meta = TYPE_META[a.absence_type]
                    const Icon = meta.icon
                    return (
                      <span
                        key={a.id}
                        className={cn(
                          'inline-flex items-center gap-0.5 rounded-full px-1 py-px text-[10px] font-medium text-foreground',
                          meta.dotClass,
                        )}
                        title={`${meta.label} (${a.hours}h)`}
                      >
                        <Icon className="h-2.5 w-2.5" aria-hidden />
                        <span>{meta.shortLabel}</span>
                      </span>
                    )
                  })}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t px-3 py-2 text-[11px] text-muted-foreground">
        {TYPE_ORDER.map(t => {
          const meta = TYPE_META[t]
          const Icon = meta.icon
          return (
            <span key={t} className="inline-flex items-center gap-1">
              <span className={cn('inline-flex h-3 w-3 items-center justify-center rounded-full', meta.dotClass)}>
                <Icon className="h-2 w-2" aria-hidden />
              </span>
              <span>{meta.label}</span>
            </span>
          )
        })}
      </div>

      {error && (
        <div className="border-t bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Edit dialog */}
      {editing && (
        <AbsenceDayDialog
          employeeId={employeeId}
          salaryRunEmployeeId={salaryRunEmployeeId}
          date={editing.date}
          existing={editing.existing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            loadAbsences()
            onChange?.()
          }}
        />
      )}
    </div>
  )
}

// ─── Dialog ────────────────────────────────────────────────────────

interface AbsenceDayDialogProps {
  employeeId: string
  salaryRunEmployeeId?: string
  date: string
  existing?: AbsenceDay
  onClose: () => void
  onSaved: () => void
}

function AbsenceDayDialog({
  employeeId,
  salaryRunEmployeeId,
  date,
  existing,
  onClose,
  onSaved,
}: AbsenceDayDialogProps) {
  const [absenceType, setAbsenceType] = useState<AbsenceType>(existing?.absence_type ?? 'sick')
  const [hours, setHours] = useState<string>(existing?.hours?.toString() ?? '8')
  const [notes, setNotes] = useState<string>(existing?.notes ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const hoursNum = parseFloat(hours)
      if (!isFinite(hoursNum) || hoursNum <= 0 || hoursNum > 24) {
        throw new Error('Timmar måste vara mellan 0 och 24')
      }
      const res = await fetch(`/api/salary/employees/${employeeId}/absence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          absence_date: date,
          absence_type: absenceType,
          hours: hoursNum,
          notes: notes.trim() || undefined,
          salary_run_employee_id: salaryRunEmployeeId,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Kunde inte spara frånvaro')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Okänt fel')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!existing) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/salary/employees/${employeeId}/absence?date=${date}&type=${existing.absence_type}`,
        { method: 'DELETE' },
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Kunde inte radera frånvaro')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Okänt fel')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Frånvaro {format(parseISO(date), 'd MMMM yyyy', { locale: sv })}
          </DialogTitle>
          <DialogDescription>
            Välj typ av frånvaro. Sjuklöneberäkning, karensavdrag och AGI-rapportering härleds automatiskt.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Typ</label>
            <Select value={absenceType} onValueChange={v => setAbsenceType(v as AbsenceType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_ORDER.map(t => (
                  <SelectItem key={t} value={t}>{TYPE_META[t].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium" htmlFor="absence-hours">Timmar</label>
            <input
              id="absence-hours"
              type="number"
              min={0.5}
              max={24}
              step={0.5}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm tabular-nums shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium" htmlFor="absence-notes">Anteckning (valfri)</label>
            <textarea
              id="absence-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={2000}
              className="flex w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {existing && (
              <Button variant="outline" size="sm" onClick={handleDelete} disabled={submitting}>
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                Ta bort
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
              Avbryt
            </Button>
            <Button size="sm" onClick={handleSave} disabled={submitting}>
              {submitting && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {existing ? 'Uppdatera' : 'Lägg till'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
