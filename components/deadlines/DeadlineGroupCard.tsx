'use client'

import { useState, useRef, useEffect } from 'react'
import { Deadline } from '@/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isDeadlineOverdue, parseDate } from '@/lib/calendar/utils'
import { Check, Pencil } from 'lucide-react'

/**
 * System tax deadlines that legally share the skattekonto date ("den 12:e"):
 * for a small monthly-moms employer, moms + AGI (+ debiterad preliminärskatt)
 * all fall due the same day. Rendering them as one grouped card instead of
 * 2-3 identical-date rows keeps the list scannable.
 */
export const SKATTEKONTO_GROUP_TYPES = new Set([
  'moms_monthly',
  'moms_quarterly',
  'moms_yearly',
  'f_skatt',
  'arbetsgivardeklaration',
  'skatteinbetalning',
])

export function isSkattekontoDeadline(d: Deadline): boolean {
  return (
    !d.is_completed &&
    d.source === 'system' &&
    d.tax_deadline_type !== null &&
    SKATTEKONTO_GROUP_TYPES.has(d.tax_deadline_type)
  )
}

const SWEDISH_MONTHS_SHORT = [
  'jan', 'feb', 'mar', 'apr', 'maj', 'jun',
  'jul', 'aug', 'sep', 'okt', 'nov', 'dec',
]

interface DeadlineGroupCardProps {
  /** Two or more skattekonto deadlines sharing the same due_date. */
  deadlines: Deadline[]
  onToggle: (deadline: Deadline) => void
  onEdit?: (deadline: Deadline) => void
}

/**
 * One card for all skattekonto obligations on a shared due date, with the
 * date block rendered once and each obligation as a sub-row that keeps its
 * own "Markera klar" confirmation. Visual language mirrors DeadlineCard.
 */
export function DeadlineGroupCard({ deadlines, onToggle, onEdit }: DeadlineGroupCardProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const confirmRef = useRef<HTMLDivElement>(null)

  const first = deadlines[0]
  const dueDate = parseDate(first.due_date)
  const dayNum = dueDate.getDate()
  const monthStr = SWEDISH_MONTHS_SHORT[dueDate.getMonth()]
  const overdue = deadlines.some(isDeadlineOverdue)

  useEffect(() => {
    if (!confirmingId) return
    function handleClickOutside(e: MouseEvent) {
      if (confirmRef.current && !confirmRef.current.contains(e.target as Node)) {
        setConfirmingId(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [confirmingId])

  const confirming = deadlines.find((d) => d.id === confirmingId) ?? null

  return (
    <div ref={confirmRef}>
      <div
        className={cn(
          'rounded-lg border bg-card transition-all duration-150',
          confirmingId && 'ring-2 ring-ring ring-offset-1',
        )}
      >
        <div className="flex items-start gap-4 py-3 px-4">
          {/* Shared date block */}
          <div className="flex-shrink-0 w-12 text-center pt-0.5">
            <span className="block text-lg font-display leading-none tabular-nums">
              {dayNum}
            </span>
            <span className="block text-[11px] uppercase tracking-wider text-muted-foreground mt-0.5">
              {monthStr}
            </span>
          </div>

          <div className="w-px self-stretch bg-border flex-shrink-0" />

          {/* Group content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <p className="text-sm font-medium">Skattekonto</p>
              <span
                className={cn(
                  'text-[11px] flex-shrink-0',
                  overdue ? 'text-destructive font-medium' : 'text-muted-foreground/60',
                )}
              >
                {deadlines.length} deadlines samma dag
              </span>
            </div>

            <div className="mt-2 space-y-1">
              {deadlines.map((deadline) => (
                <div
                  key={deadline.id}
                  onClick={() => {
                    if (!confirmingId && onEdit) onEdit(deadline)
                  }}
                  className={cn(
                    'group flex items-center gap-3 rounded-md py-1.5 -mx-2 px-2 transition-colors',
                    onEdit && !confirmingId && 'cursor-pointer hover:bg-accent/40',
                  )}
                >
                  <p className="text-sm truncate flex-1 min-w-0">{deadline.title}</p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setConfirmingId(deadline.id)
                    }}
                    className={cn(
                      'text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md border border-border hover:border-foreground/30 hover:bg-accent flex-shrink-0',
                      confirmingId && 'invisible',
                    )}
                  >
                    Markera klar
                  </button>
                  {onEdit && !confirmingId && (
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground/0 group-hover:text-muted-foreground/50 transition-colors flex-shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Inline confirmation bar (one at a time, mirrors DeadlineCard) */}
        <div
          className={cn(
            'grid transition-all duration-200 ease-out',
            confirming ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
          )}
        >
          <div className="overflow-hidden">
            {confirming && (
              <div className="border-t px-4 py-3 flex items-center justify-between gap-4">
                <p className="text-sm text-muted-foreground">
                  Markera{' '}
                  <span className="font-medium text-foreground">{confirming.title}</span> som
                  klar?
                </p>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-3 text-xs"
                    onClick={() => setConfirmingId(null)}
                  >
                    Avbryt
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 px-3 text-xs"
                    onClick={() => {
                      setConfirmingId(null)
                      onToggle(confirming)
                    }}
                  >
                    <Check className="h-3.5 w-3.5 mr-1.5" />
                    Bekräfta
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
