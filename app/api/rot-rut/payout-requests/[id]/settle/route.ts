import { NextResponse } from 'next/server'
import { withRouteContext } from '@/lib/api/with-route-context'
import { validateBody } from '@/lib/api/validate'
import { RotRutSettleSchema } from '@/lib/api/schemas'
import { errorResponse, errorResponseFromCode } from '@/lib/errors/get-structured-error'
import { createRotRutPayoutEntry } from '@/lib/bookkeeping/rot-rut-entries'

/**
 * POST /api/rot-rut/payout-requests/[id]/settle
 *
 * Books Skatteverkets utbetalning for a begäran:
 *
 *   Debit  1930 Företagskonto            [amount]
 *   Credit 1513 Skattereduktion rot/rut  [amount]
 *
 * The journal entry IS the accounting record here, so engine failure blocks
 * the operation (see .claude/skills/erp-api-route — payment entries block).
 * amount defaults to decided_total, falling back to requested_total. If the
 * amount equals requested_total the request completes as 'paid'; anything
 * lower records 'partially_paid' with decided_total = amount.
 */
export const POST = withRouteContext<{ params: Promise<{ id: string }> }>(
  'rot_rut.requests.settle',
  async (request, ctx, { params }) => {
    const { user, supabase, companyId, log, requestId } = ctx
    const { id } = await params

    const validation = await validateBody(request, RotRutSettleSchema)
    if (!validation.success) return validation.response
    const input = validation.data

    const { data: payoutRequest, error: fetchError } = await supabase
      .from('rot_rut_payout_requests')
      .select('*')
      .eq('company_id', companyId!)
      .eq('id', id)
      .maybeSingle()

    if (fetchError) {
      log.error('failed to fetch rot/rut payout request', fetchError)
      return errorResponse(fetchError, log, { requestId })
    }
    if (!payoutRequest) {
      return errorResponseFromCode('ROT_RUT_REQUEST_NOT_FOUND', log, { requestId })
    }

    const settleable =
      !payoutRequest.settlement_journal_entry_id &&
      !['cancelled', 'rejected'].includes(payoutRequest.status)
    if (!settleable) {
      return errorResponseFromCode('ROT_RUT_SETTLE_INVALID_STATE', log, {
        requestId,
        details: {
          status: payoutRequest.status,
          already_settled: !!payoutRequest.settlement_journal_entry_id,
        },
      })
    }

    const amount =
      input.amount ?? Number(payoutRequest.decided_total ?? payoutRequest.requested_total)

    // The voucher is the accounting record — engine failure must block.
    let journalEntryId: string
    try {
      const entry = await createRotRutPayoutEntry(supabase, companyId!, user.id, {
        requestId: payoutRequest.id,
        requestName: payoutRequest.name,
        deductionType: payoutRequest.deduction_type,
        paymentDate: input.payment_date,
        amount,
      })
      journalEntryId = entry.id
    } catch (engineError) {
      log.error('failed to book rot/rut payout entry', engineError as Error)
      return errorResponse(engineError, log, { requestId })
    }

    const fullyPaid = amount >= Number(payoutRequest.requested_total)
    const update: Record<string, unknown> = {
      settlement_journal_entry_id: journalEntryId,
      status: fullyPaid ? 'paid' : 'partially_paid',
      decided_total: payoutRequest.decided_total ?? amount,
    }
    if (!payoutRequest.decided_at) {
      update.decided_at = new Date().toISOString()
    }

    const { data: updated, error: updateError } = await supabase
      .from('rot_rut_payout_requests')
      .update(update)
      .eq('company_id', companyId!)
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      // The voucher exists (immutable per BFL) but the request row didn't
      // absorb the link — surface loudly, do NOT try to unbook.
      log.error('rot/rut payout entry booked but request update failed', updateError, {
        journalEntryId,
        payoutRequestId: id,
      })
      return errorResponse(updateError, log, { requestId })
    }

    if (fullyPaid) {
      const { data: items } = await supabase
        .from('rot_rut_payout_request_items')
        .select('id, requested_amount')
        .eq('request_id', id)
      for (const item of items ?? []) {
        await supabase
          .from('rot_rut_payout_request_items')
          .update({ decided_amount: item.requested_amount })
          .eq('id', item.id)
      }
    }

    log.info('rot/rut payout settled', {
      payoutRequestId: id,
      journalEntryId,
      amount,
      fullyPaid,
    })

    return NextResponse.json({ data: { request: updated, journal_entry_id: journalEntryId } })
  },
  { requireWrite: true },
)
