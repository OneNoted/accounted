import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withRouteContext } from '@/lib/api/with-route-context'
import { errorResponse, errorResponseFromCode } from '@/lib/errors/get-structured-error'
import { validateBody } from '@/lib/api/validate'
import { createJournalEntry } from '@/lib/bookkeeping/engine'
import {
  buildAccrualsProposal,
  proposeAuditFee,
  proposeManualAccrued,
  proposeManualPrepaid,
  proposeVacationLiabilityChange,
} from '@/lib/bokslut/accruals/accrual-detector'
import type { AccrualProposal } from '@/lib/bokslut/accruals/types'
import type { JournalEntry } from '@/types'

export const GET = withRouteContext(
  'period.accruals_preview',
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const { supabase, companyId, log, requestId } = ctx
    try {
      const proposal = await buildAccrualsProposal(supabase, companyId, id)
      return NextResponse.json({ data: proposal })
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (/not found/i.test(message)) {
        return errorResponseFromCode('PERIOD_NOT_FOUND', log, { requestId })
      }
      return errorResponse(err, log, { requestId })
    }
  },
)

const PostItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('vacation_liability_change') }),
  z.object({
    kind: z.literal('audit_fee'),
    amount: z.number().positive(),
    liability_account: z.enum(['2991', '2992']).optional(),
  }),
  z.object({
    kind: z.literal('manual_prepaid_expense'),
    amount: z.number().positive(),
    expense_account: z.string().regex(/^\d{4}$/),
    prepaid_account: z.string().regex(/^17\d{2}$/),
    description: z.string().min(1),
  }),
  z.object({
    kind: z.literal('manual_accrued_expense'),
    amount: z.number().positive(),
    expense_account: z.string().regex(/^\d{4}$/),
    accrued_account: z.string().regex(/^29\d{2}$/),
    description: z.string().min(1),
  }),
])

const PostBodySchema = z.object({
  items: z.array(PostItemSchema).min(1),
})

export const POST = withRouteContext(
  'period.accruals_post',
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const { user, supabase, companyId, log, requestId } = ctx

    const validation = await validateBody(request, PostBodySchema)
    if (!validation.success) return validation.response

    try {
      const { data: period, error: periodError } = await supabase
        .from('fiscal_periods')
        .select('id, name, period_end, is_closed, locked_at, closing_entry_id')
        .eq('id', id)
        .eq('company_id', companyId)
        .single()
      if (periodError || !period) {
        return errorResponseFromCode('PERIOD_NOT_FOUND', log, { requestId })
      }
      if (period.is_closed || period.closing_entry_id || period.locked_at) {
        return errorResponseFromCode('PERIOD_LOCKED', log, { requestId })
      }

      const created: { kind: string; entry: JournalEntry; reverses_on: string }[] = []

      for (const item of validation.data.items) {
        let proposal: AccrualProposal | null = null
        switch (item.kind) {
          case 'vacation_liability_change':
            proposal = await proposeVacationLiabilityChange(supabase, companyId, id, {
              closingDate: period.period_end,
            })
            break
          case 'audit_fee':
            proposal = proposeAuditFee({
              amount: item.amount,
              closingDate: period.period_end,
              liabilityAccount: item.liability_account,
            })
            break
          case 'manual_prepaid_expense':
            proposal = proposeManualPrepaid({
              amount: item.amount,
              expenseAccount: item.expense_account,
              prepaidAccount: item.prepaid_account,
              description: item.description,
              closingDate: period.period_end,
            })
            break
          case 'manual_accrued_expense':
            proposal = proposeManualAccrued({
              amount: item.amount,
              expenseAccount: item.expense_account,
              accruedAccount: item.accrued_account,
              description: item.description,
              closingDate: period.period_end,
            })
            break
        }
        if (!proposal) continue

        // Mark the entry's description with the reversal date so future
        // bookkeepers (and a future cron) can spot the periodisering. The
        // accrual_reversals cron is follow-up infra — once it lands, the
        // entry's source_type or a metadata column can drive the auto-flip.
        const entry = await createJournalEntry(supabase, companyId, user.id, {
          fiscal_period_id: id,
          entry_date: period.period_end,
          description: `Periodisering: ${proposal.label} (vänds ${proposal.reverses_on})`,
          source_type: 'manual',
          voucher_series: 'A',
          lines: proposal.lines,
        })

        created.push({ kind: item.kind, entry, reverses_on: proposal.reverses_on })
      }

      return NextResponse.json({ data: { created } })
    } catch (err) {
      return errorResponse(err, log, { requestId })
    }
  },
  { requireWrite: true },
)
