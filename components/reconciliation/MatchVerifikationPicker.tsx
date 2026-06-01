'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Search, X } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { formatVoucher } from '@/lib/bookkeeping/voucher-series-resolver'

/**
 * A posted journal entry line on a cash account (e.g. 1930) not yet linked to
 * any bank transaction — a candidate for manual reconciliation. Mirrors the
 * `UnlinkedGLLine` returned by GET /api/reconciliation/bank/unmatched-entries.
 *
 * Defined here (not imported from lib/reconciliation/bank-reconciliation) so the
 * client bundle never pulls in that module's server-only dependencies (event
 * bus, match-log). The optional `confidence` is attached when the endpoint
 * ranks candidates for a specific transaction.
 */
export interface UnlinkedGLLine {
  line_id: string
  journal_entry_id: string
  debit_amount: number
  credit_amount: number
  line_description: string | null
  entry_date: string
  voucher_number: number
  voucher_series: string
  entry_description: string
  source_type: string
  confidence?: number
}

interface MatchPickerProps {
  glLines: UnlinkedGLLine[]
  value: string
  onChange: (journalEntryId: string) => void
  disabled?: boolean
  placeholder?: string
}

/**
 * Inline combobox for choosing a journal entry to match a bank transaction
 * against. The native <select> couldn't be searched, and the unmatched-GL list
 * routinely runs to hundreds of rows (historical SIE imports), so the old UX
 * forced users to scroll a giant unsorted dropdown. This picker filters by
 * voucher number, date, amount or description as the user types, and renders
 * the selected verifikation as a removable chip.
 *
 * Extracted from BankReconciliationView so the Transactions-page
 * MatchVoucherDialog can reuse the exact same picker.
 */
export function MatchVerifikationPicker({
  glLines,
  value,
  onChange,
  disabled,
  placeholder = 'Sök ver.nr, datum, belopp eller beskrivning…',
}: MatchPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  const selected = glLines.find((l) => l.journal_entry_id === value) || null

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const base = q.length === 0
      ? glLines
      : glLines.filter((line) => {
          const amt = (line.debit_amount > 0 ? line.debit_amount : line.credit_amount).toString()
          return (
            formatVoucher(line).toLowerCase().includes(q) ||
            line.entry_date.toLowerCase().includes(q) ||
            amt.includes(q) ||
            (line.entry_description || '').toLowerCase().includes(q) ||
            (line.line_description || '').toLowerCase().includes(q)
          )
        })
    return base.slice(0, 25)
  }, [search, glLines])

  if (selected) {
    const amount = selected.debit_amount > 0 ? selected.debit_amount : -selected.credit_amount
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm">
        <span className="font-mono text-xs shrink-0">{formatVoucher(selected)}</span>
        <span className="text-muted-foreground shrink-0 tabular-nums">{formatDate(selected.entry_date)}</span>
        <span className="font-mono tabular-nums shrink-0">{formatCurrency(amount)}</span>
        <span className="truncate text-muted-foreground">{selected.entry_description}</span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="ml-auto h-6 w-6 shrink-0"
          onClick={() => onChange('')}
          disabled={disabled}
          aria-label="Avmarkera verifikation"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          className="pl-9"
        />
      </div>
      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-[var(--shadow-md)]">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
              Inga verifikationer matchar &quot;{search}&quot;
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              {filtered.map((line) => {
                const amount = line.debit_amount > 0 ? line.debit_amount : -line.credit_amount
                return (
                  <button
                    key={line.line_id}
                    type="button"
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary/60 focus:bg-secondary/60 focus:outline-none"
                    onMouseDown={(e) => {
                      // mousedown beats blur — without this the popover closes
                      // before the click registers when the user has tabbed
                      // through and uses keyboard.
                      e.preventDefault()
                    }}
                    onClick={() => {
                      onChange(line.journal_entry_id)
                      setSearch('')
                      setOpen(false)
                    }}
                  >
                    <span className="font-mono text-xs shrink-0 w-12">{formatVoucher(line)}</span>
                    <span className="text-muted-foreground shrink-0 tabular-nums w-24">{formatDate(line.entry_date)}</span>
                    <span className="font-mono tabular-nums shrink-0 w-24 text-right">{formatCurrency(amount)}</span>
                    <span className="truncate text-muted-foreground flex-1">
                      {line.line_description || line.entry_description}
                    </span>
                  </button>
                )
              })}
              {glLines.length > filtered.length && (
                <div className="px-3 py-2 text-[11px] text-muted-foreground border-t border-border bg-secondary/30">
                  Visar {filtered.length} av {glLines.length} — sök för att filtrera fler.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
