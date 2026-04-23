'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { PageHeader } from '@/components/ui/page-header'
import { Sparkles, PlayCircle, XCircle } from 'lucide-react'
import ProposalCard from './ProposalCard'
import RequestCard from './RequestCard'
import EditBookingDialog from './EditBookingDialog'
import LearningPromptDialog from './LearningPromptDialog'
import type { AgentInboxItemView } from '@/app/(dashboard)/agent-inbox/page'
import type { AIProposal, BookingProposalPayload } from '@/types'

interface AgentInboxProps {
  initialItems: AgentInboxItemView[]
}

interface LearningPromptState {
  proposalId: string
  counterparty_name: string
  debit_account: string
  credit_account: string
  vat_treatment: string | null
}

export default function AgentInbox({ initialItems }: AgentInboxProps) {
  const [items, setItems] = useState(initialItems)

  // After router.refresh() the server re-runs and passes a new initialItems
  // prop. useState only reads its arg on mount, so sync explicitly — otherwise
  // newly-chained booking proposals stay invisible after a match accept.
  useEffect(() => {
    setItems(initialItems)
  }, [initialItems])

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null)
  const [editProposal, setEditProposal] = useState<AIProposal | null>(null)
  const [learningPrompt, setLearningPrompt] = useState<LearningPromptState | null>(null)
  const [backfillRunning, setBackfillRunning] = useState(false)
  const [batchRunning, setBatchRunning] = useState(false)
  const { toast } = useToast()
  const router = useRouter()

  const selectableProposalIds = useMemo(
    () =>
      items
        .filter((i) => i.proposal && i.proposal.status === 'pending')
        .map((i) => i.proposal!.id),
    [items]
  )

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(selectableProposalIds))
  }, [selectableProposalIds])

  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

  const removeItem = useCallback((proposalId: string | null, requestId: string | null) => {
    setItems((prev) =>
      prev.filter((i) => {
        if (proposalId && i.proposal?.id === proposalId) return false
        if (requestId && i.request?.id === requestId) return false
        return true
      })
    )
    if (proposalId) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(proposalId)
        return next
      })
    }
  }, [])

  // ── Accept ─────────────────────────────────────────────────────────
  const handleAccept = async (
    proposal: AIProposal,
    edits?: BookingProposalPayload | { matched_transaction_id: string }
  ) => {
    setBusyProposalId(proposal.id)
    try {
      const res = await fetch(`/api/ai/proposals/${proposal.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: proposal.version, edits }),
      })
      const body = await res.json()
      if (!res.ok) {
        toast({ title: 'Kunde inte godkänna', description: body.error, variant: 'destructive' })
        return
      }
      toast({ title: proposal.step_type === 'match' ? 'Matchning godkänd' : 'Bokförd' })

      if (body.data?.learning_prompt) {
        setLearningPrompt({
          proposalId: proposal.id,
          counterparty_name: body.data.learning_prompt.counterparty_name,
          debit_account: body.data.learning_prompt.debit_account,
          credit_account: body.data.learning_prompt.credit_account,
          vat_treatment: body.data.learning_prompt.vat_treatment,
        })
      }

      removeItem(proposal.id, null)
      // Accepting a match proposal chains to a new booking proposal (generated
      // synchronously inside the event handler during accept). Accepting a
      // booking proposal produces the terminal state. Refresh the server
      // component either way so the new state lands on screen.
      router.refresh()
    } catch (err) {
      toast({
        title: 'Fel',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    } finally {
      setBusyProposalId(null)
    }
  }

  // ── Reject ─────────────────────────────────────────────────────────
  const handleReject = async (proposal: AIProposal) => {
    setBusyProposalId(proposal.id)
    try {
      const res = await fetch(`/api/ai/proposals/${proposal.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: proposal.version }),
      })
      const body = await res.json()
      if (!res.ok) {
        toast({ title: 'Kunde inte avvisa', description: body.error, variant: 'destructive' })
        return
      }
      toast({ title: 'Avvisad' })
      removeItem(proposal.id, null)
      router.refresh()
    } finally {
      setBusyProposalId(null)
    }
  }

  // ── Batch accept ───────────────────────────────────────────────────
  const handleBatchAccept = async () => {
    if (selectedIds.size === 0) return
    setBatchRunning(true)
    try {
      const res = await fetch('/api/ai/proposals/batch-accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposal_ids: [...selectedIds] }),
      })
      const body = await res.json()
      if (!res.ok) {
        toast({ title: 'Batch-godkännande misslyckades', description: body.error, variant: 'destructive' })
        return
      }
      const { accepted, failed, outcomes } = body.data
      toast({
        title: `${accepted} godkända${failed > 0 ? `, ${failed} misslyckades` : ''}`,
      })
      // Remove only the ones that succeeded.
      const successIds = new Set<string>(
        (outcomes as Array<{ proposal_id: string; ok: boolean }>)
          .filter((o) => o.ok)
          .map((o) => o.proposal_id)
      )
      setItems((prev) => prev.filter((i) => !(i.proposal && successIds.has(i.proposal.id))))
      clearSelection()
      router.refresh()
    } finally {
      setBatchRunning(false)
    }
  }

  // ── Backfill ───────────────────────────────────────────────────────
  const handleBackfill = async () => {
    setBackfillRunning(true)
    try {
      const res = await fetch('/api/ai/backfill/receipts', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) {
        toast({ title: 'Kunde inte starta backfill', description: body.error, variant: 'destructive' })
        setBackfillRunning(false)
        return
      }
      toast({
        title: 'Backfill igång',
        description: `Kö: ${body.data.queued_match} match, ${body.data.queued_booking} bokföring. Ladda om om en stund.`,
      })
    } catch (err) {
      toast({ title: 'Fel', description: String(err), variant: 'destructive' })
      setBackfillRunning(false)
    }
  }

  const handleCancelBackfill = async () => {
    await fetch('/api/ai/backfill/cancel', { method: 'POST' })
    toast({ title: 'Backfill stoppas' })
    setBackfillRunning(false)
    router.refresh()
  }

  // ── Learning prompt ────────────────────────────────────────────────
  const handleRememberYes = async () => {
    if (!learningPrompt) return
    await fetch('/api/ai/learning/remember', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proposal_id: learningPrompt.proposalId,
        counterparty_name: learningPrompt.counterparty_name,
        debit_account: learningPrompt.debit_account,
        credit_account: learningPrompt.credit_account,
        vat_treatment: learningPrompt.vat_treatment,
        category: null,
      }),
    })
    toast({ title: 'Sparad som mall' })
    setLearningPrompt(null)
  }

  return (
    <div className="container mx-auto p-4 sm:p-8 max-w-5xl">
      <PageHeader
        title="Agent-inkorg"
        description="AI föreslår bokföring — du godkänner varje steg."
        action={
          <div className="flex gap-2">
            {!backfillRunning ? (
              <Button variant="outline" onClick={handleBackfill} disabled={backfillRunning}>
                <PlayCircle className="mr-2 h-4 w-4" />
                Bearbeta befintliga
              </Button>
            ) : (
              <Button variant="outline" onClick={handleCancelBackfill}>
                <XCircle className="mr-2 h-4 w-4" />
                Stoppa backfill
              </Button>
            )}
          </div>
        }
      />

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="p-5 rounded-full bg-muted mb-6">
              <Sparkles className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-2">Inga väntande förslag</h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              När nya kvitton klassas i inkorgen kommer AI-förslagen att visas här.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {selectableProposalIds.length > 1 && (
            <div className="flex items-center justify-between mb-4">
              <Button variant="ghost" size="sm" onClick={selectAll}>
                Markera alla ({selectableProposalIds.length})
              </Button>
              {selectedIds.size > 0 && (
                <Button variant="ghost" size="sm" onClick={clearSelection}>
                  Avmarkera ({selectedIds.size})
                </Button>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3">
            {items.map((item) => {
              if (item.proposal) {
                return (
                  <ProposalCard
                    key={`p-${item.proposal.id}`}
                    item={item}
                    isSelected={selectedIds.has(item.proposal.id)}
                    isBusy={busyProposalId === item.proposal.id}
                    onToggleSelect={() => toggleSelect(item.proposal!.id)}
                    onAccept={() => handleAccept(item.proposal!)}
                    onReject={() => handleReject(item.proposal!)}
                    onEdit={() => setEditProposal(item.proposal!)}
                  />
                )
              }
              if (item.request) {
                return (
                  <RequestCard
                    key={`r-${item.request.id}`}
                    item={item}
                    onDismiss={() => removeItem(null, item.request!.id)}
                  />
                )
              }
              return null
            })}
          </div>

          {selectedIds.size > 0 && (
            <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 bg-background border shadow-lg rounded-full px-4 py-3 flex items-center gap-3 z-40">
              <span className="text-sm font-medium">{selectedIds.size} valda</span>
              <Button size="sm" onClick={handleBatchAccept} disabled={batchRunning}>
                {batchRunning ? 'Godkänner…' : `Godkänn ${selectedIds.size} st`}
              </Button>
            </div>
          )}
        </>
      )}

      {editProposal && (
        <EditBookingDialog
          proposal={editProposal}
          onClose={() => setEditProposal(null)}
          onSubmit={async (edits) => {
            const proposal = editProposal
            setEditProposal(null)
            await handleAccept(proposal, edits)
          }}
        />
      )}

      {learningPrompt && (
        <LearningPromptDialog
          counterpartyName={learningPrompt.counterparty_name}
          debitAccount={learningPrompt.debit_account}
          creditAccount={learningPrompt.credit_account}
          onYes={handleRememberYes}
          onNo={() => setLearningPrompt(null)}
        />
      )}
    </div>
  )
}
