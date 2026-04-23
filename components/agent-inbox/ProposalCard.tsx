'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { AgentInboxItemView } from '@/app/(dashboard)/agent-inbox/page'
import type { BookingProposalPayload, MatchProposalPayload } from '@/types'

interface ProposalCardProps {
  item: AgentInboxItemView
  isSelected: boolean
  isBusy: boolean
  onToggleSelect: () => void
  onAccept: () => void
  onReject: () => void
  onEdit: () => void
}

function confidenceLabel(c: number | null): string {
  if (c === null) return 'Ingen säkerhet'
  const pct = Math.round(c * 100)
  return `${pct}% säkerhet`
}

function confidenceColor(c: number | null): string {
  if (c === null) return 'bg-muted'
  if (c >= 0.9) return 'bg-success/15 text-success-foreground'
  if (c >= 0.6) return 'bg-warning/15 text-warning-foreground'
  return 'bg-destructive/15 text-destructive-foreground'
}

export default function ProposalCard({
  item,
  isSelected,
  isBusy,
  onToggleSelect,
  onAccept,
  onReject,
  onEdit,
}: ProposalCardProps) {
  const proposal = item.proposal!
  const inbox = item.inbox_item
  const tx = item.transaction
  const isMatch = proposal.step_type === 'match'

  const matchPayload = isMatch ? (proposal.proposal_json as MatchProposalPayload) : null
  const bookingPayload = !isMatch ? (proposal.proposal_json as BookingProposalPayload) : null

  return (
    <Card className="transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="pt-1">
            <Checkbox checked={isSelected} onCheckedChange={onToggleSelect} aria-label="Markera" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <Badge variant="outline">{isMatch ? 'Match' : 'Bokföring'}</Badge>
              <Badge className={confidenceColor(proposal.confidence)}>
                {confidenceLabel(proposal.confidence)}
              </Badge>
              {inbox.document && (
                <span className="text-xs text-muted-foreground truncate">
                  {inbox.document.file_name}
                </span>
              )}
            </div>

            {isMatch && matchPayload && (
              <MatchProposalBody
                payload={matchPayload}
                reasoning={proposal.reasoning}
                transaction={tx}
              />
            )}

            {!isMatch && bookingPayload && (
              <BookingProposalBody payload={bookingPayload} reasoning={proposal.reasoning} />
            )}

            <div className="flex gap-2 mt-4 flex-wrap">
              <Button size="sm" onClick={onAccept} disabled={isBusy}>
                {isBusy ? '…' : 'Godkänn'}
              </Button>
              {!isMatch && (
                <Button size="sm" variant="outline" onClick={onEdit} disabled={isBusy}>
                  Redigera
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={onReject} disabled={isBusy}>
                Avvisa
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function MatchProposalBody({
  payload,
  reasoning,
  transaction,
}: {
  payload: MatchProposalPayload
  reasoning: string | null
  transaction: AgentInboxItemView['transaction']
}) {
  const proposedTx = transaction && transaction.id === payload.matched_transaction_id ? transaction : null
  return (
    <div>
      {proposedTx ? (
        <div className="rounded border bg-muted/40 p-3 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate">{proposedTx.description || 'Okänd'}</span>
            <span className="tabular-nums font-medium">
              {formatCurrency(proposedTx.amount, proposedTx.currency)}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {formatDate(proposedTx.date)}
          </div>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">
          Föreslagen transaktion: {payload.matched_transaction_id}
        </div>
      )}
      {reasoning && (
        <p className="text-xs text-muted-foreground mt-2 italic">&ldquo;{reasoning}&rdquo;</p>
      )}
      {payload.alternatives.length > 0 && (
        <details className="mt-2">
          <summary className="text-xs text-muted-foreground cursor-pointer">
            {payload.alternatives.length} alternativ
          </summary>
          <ul className="mt-1 space-y-1 text-xs">
            {payload.alternatives.map((alt) => (
              <li key={alt.transaction_id} className="text-muted-foreground">
                {Math.round(alt.confidence * 100)}% — {alt.reasoning}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function BookingProposalBody({
  payload,
  reasoning,
}: {
  payload: BookingProposalPayload
  reasoning: string | null
}) {
  const totalDebit = payload.lines.reduce((s, l) => s + l.debit_amount, 0)
  return (
    <div>
      <div className="rounded border bg-muted/40 p-3 text-sm">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left font-normal pb-1">Konto</th>
              <th className="text-right font-normal pb-1">Debet</th>
              <th className="text-right font-normal pb-1">Kredit</th>
            </tr>
          </thead>
          <tbody>
            {payload.lines.map((line, i) => (
              <tr key={i} className="border-t border-border/40">
                <td className="py-1">
                  <span className="font-mono">{line.account_number}</span>{' '}
                  <span className="text-muted-foreground">{line.description}</span>
                </td>
                <td className="py-1 text-right tabular-nums">
                  {line.debit_amount > 0 ? line.debit_amount.toFixed(2) : ''}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {line.credit_amount > 0 ? line.credit_amount.toFixed(2) : ''}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="text-xs text-muted-foreground">
            <tr className="border-t">
              <td className="pt-1">
                {payload.vat_treatment && <span>Moms: {payload.vat_treatment}</span>}
                {payload.default_private && <span className="ml-2">Privat uttag</span>}
              </td>
              <td className="pt-1 text-right tabular-nums">{totalDebit.toFixed(2)}</td>
              <td className="pt-1 text-right tabular-nums">{totalDebit.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {reasoning && (
        <p className="text-xs text-muted-foreground mt-2 italic">&ldquo;{reasoning}&rdquo;</p>
      )}
    </div>
  )
}
