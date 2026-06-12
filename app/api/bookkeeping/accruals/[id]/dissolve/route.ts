import { NextResponse } from 'next/server'
import { ensureInitialized } from '@/lib/init'
import { withRouteContext } from '@/lib/api/with-route-context'
import { errorResponseFromCode } from '@/lib/errors/get-structured-error'
import { dissolveScheduleNow } from '@/lib/bookkeeping/accruals/service'

ensureInitialized()

/**
 * POST /api/bookkeeping/accruals/[id]/dissolve
 *
 * "Lös upp nu": books the schedule's remaining months in ONE verifikat dated
 * today (clamped by lock date) and completes the schedule. Used when the
 * underlying service ends early or the user wants the rest expensed now.
 * Cancelling-with-storno only happens via the credit flows — a standalone
 * cancel would strand the interim-account balance.
 */
export const POST = withRouteContext<{ params: Promise<{ id: string }> }>(
  'accruals.dissolve',
  async (_request, ctx, { params }) => {
    const { id } = await params
    const { user, supabase, companyId, log, requestId } = ctx

    try {
      const result = await dissolveScheduleNow(supabase, companyId!, user.id, id)
      return NextResponse.json({ data: result })
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown'
      if (reason === 'Periodiseringen hittades inte') {
        return errorResponseFromCode('ACCRUAL_NOT_FOUND', log, { requestId })
      }
      log.error('accrual dissolve failed', err as Error, { entityId: id })
      return errorResponseFromCode('ACCRUAL_DISSOLVE_FAILED', log, {
        requestId,
        details: { reason },
      })
    }
  },
  { requireWrite: true },
)
