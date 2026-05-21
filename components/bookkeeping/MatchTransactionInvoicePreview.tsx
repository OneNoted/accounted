'use client'

import { ArrowDown } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'

interface MatchTransactionInvoicePreviewProps {
  data: Record<string, unknown>
}

/**
 * Two-card preview for `match_transaction_invoice` operations. Mirrors
 * AttachDocumentPreview's layout so reviewers learn one matching idiom.
 */
export function MatchTransactionInvoicePreview({ data }: MatchTransactionInvoicePreviewProps) {
  const txDescription = (data.transaction_description as string) || '—'
  const txAmount = data.transaction_amount as number | undefined
  const txCurrency = (data.transaction_currency as string) || 'SEK'

  const invoiceNumber = (data.invoice_number as string) || '—'
  const invoiceTotal = data.invoice_total as number | undefined
  const invoiceCurrency = (data.invoice_currency as string) || txCurrency
  const customerName = data.customer_name as string | undefined

  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <PreviewCard label="Transaktion">
          <Row label="Beskrivning" value={txDescription} />
          <Row
            label="Belopp"
            value={typeof txAmount === 'number' ? formatCurrency(txAmount, txCurrency) : '—'}
            tabular
          />
        </PreviewCard>

        <PreviewCard label="Faktura">
          <Row label="Nummer" value={invoiceNumber} tabular />
          {customerName && <Row label="Kund" value={customerName} />}
          {typeof invoiceTotal === 'number' && (
            <Row label="Totalt" value={formatCurrency(invoiceTotal, invoiceCurrency)} tabular />
          )}
        </PreviewCard>
      </div>

      <div className="flex items-center justify-center text-xs text-muted-foreground">
        <ArrowDown className="h-3.5 w-3.5 mr-1" />
        matchas mot fakturan
      </div>
    </div>
  )
}

function PreviewCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-3 space-y-1.5">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  )
}

function Row({ label, value, tabular }: { label: string; value: string; tabular?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className={`text-sm ${tabular ? 'tabular-nums' : ''} text-right truncate`}>{value}</span>
    </div>
  )
}
