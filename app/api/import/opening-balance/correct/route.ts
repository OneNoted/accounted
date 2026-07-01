import { NextResponse } from 'next/server'
import { ensureInitialized } from '@/lib/init'
import { validateBody } from '@/lib/api/validate'
import { OpeningBalanceExecuteSchema } from '@/lib/api/schemas'
import { createJournalEntry, reverseEntry } from '@/lib/bookkeeping/engine'
import { isBookkeepingError } from '@/lib/bookkeeping/errors'
import {
  validateOpeningBalanceLines,
  activateMissingAccounts,
  buildOpeningBalanceEntryLines,
} from '@/lib/import/opening-balance/execute-helpers'
import { withRouteContext } from '@/lib/api/with-route-context'
import { errorResponse, errorResponseFromCode } from '@/lib/errors/get-structured-error'

ensureInitialized()

/**
 * POST /api/import/opening-balance/correct
 *
 * Correct a period's existing opening balances the BFL-compliant way: the
 * current IB verifikat (immutable, posted) is stornoed and a corrected IB is
 * booked, then fiscal_periods.opening_balance_entry_id is relinked to the new
 * entry via the replace_period_opening_balance_link RPC.
 *
 * Because getOpeningBalances reads the linked entry directly and the
 * trial-balance / general-ledger movement queries include both `posted` and
 * `reversed` lines (excluding only the linked OB entry), the stornoed old IB
 * and its storno mirror cancel out in period movement — so the Balansrapport
 * IB column shows the corrected figures and UB stays correct.
 *
 * Gated to the safe case only: the period must be open, unlocked, already have
 * opening balances, and have no year-end close on top. Locked/closed periods or
 * periods with a bokslut must be unwound first (assisted) — we refuse here.
 */
export const POST = withRouteContext(
  'opening_balance.correct',
  async (request, ctx) => {
    const { user, supabase, companyId, log, requestId } = ctx

    const result = await validateBody(request, OpeningBalanceExecuteSchema, {
      log,
      operation: 'opening_balance.correct',
    })
    if (!result.success) return result.response

    const { fiscal_period_id, lines } = result.data
    const opLog = log.child({ fiscalPeriodId: fiscal_period_id })

    try {
      // 1. Verify the fiscal period belongs to the company and is correctable.
      const { data: period, error: periodError } = await supabase
        .from('fiscal_periods')
        .select('*')
        .eq('id', fiscal_period_id)
        .eq('company_id', companyId)
        .single()

      if (periodError || !period) {
        return errorResponseFromCode('OB_PERIOD_NOT_FOUND', opLog, { requestId })
      }

      if (period.is_closed) {
        return errorResponseFromCode('OB_PERIOD_CLOSED', opLog, { requestId })
      }

      if (period.locked_at) {
        return errorResponseFromCode('OB_PERIOD_LOCKED', opLog, { requestId })
      }

      if (!period.opening_balances_set || !period.opening_balance_entry_id) {
        return errorResponseFromCode('OB_CORRECT_NO_EXISTING', opLog, { requestId })
      }

      // Refuse if a year-end close was built on top — correcting the IB without
      // unwinding the bokslut would leave the period (and the next period's
      // carried-forward IB) internally inconsistent.
      const { count: yearEndCount } = await supabase
        .from('journal_entries')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('fiscal_period_id', fiscal_period_id)
        .eq('source_type', 'year_end')
        .eq('status', 'posted')

      if ((yearEndCount ?? 0) > 0) {
        return errorResponseFromCode('OB_CORRECT_YEAR_END_EXISTS', opLog, { requestId })
      }

      const oldEntryId = period.opening_balance_entry_id

      // 2. Validate the corrected lines (drop zeros, ≥2 rows, no P&L, must balance).
      const validation = validateOpeningBalanceLines(lines)
      if (!validation.ok) {
        return errorResponseFromCode(validation.code, opLog, {
          requestId,
          details:
            validation.code === 'OB_PNL_ACCOUNT'
              ? { accounts: validation.accounts }
              : validation.code === 'OB_UNBALANCED'
                ? { totalDebit: validation.totalDebit, totalCredit: validation.totalCredit, diff: validation.diff }
                : undefined,
        })
      }
      const { validLines, totalDebit, totalCredit } = validation

      // 3. Auto-activate BAS accounts the corrected file references but the chart lacks.
      const accountNumbers = [...new Set(validLines.map((l) => l.account_number))]
      const activation = await activateMissingAccounts(supabase, companyId!, user.id, accountNumbers)
      if (!activation.ok) {
        opLog.error('opening balance account activation failed', new Error(activation.reason))
        return errorResponseFromCode('OB_ACCOUNT_ACTIVATION_FAILED', opLog, {
          requestId,
          details: { reason: activation.reason },
        })
      }

      // 4. Book the corrected IB, storno the old one, then relink the period.
      //    Order matters: create the replacement BEFORE reversing the original so a
      //    mid-failure never leaves the period without an opening balance. The final
      //    relink is a single atomic RPC (least likely to fail).
      const newEntry = await createJournalEntry(supabase, companyId!, user.id, {
        fiscal_period_id,
        entry_date: period.period_start,
        description: 'Ingående balanser (korrigerade)',
        source_type: 'opening_balance',
        voucher_series: 'A',
        lines: buildOpeningBalanceEntryLines(validLines),
      })

      await reverseEntry(supabase, companyId!, user.id, oldEntryId)

      const { error: relinkError } = await supabase.rpc('replace_period_opening_balance_link', {
        p_company_id: companyId,
        p_period_id: fiscal_period_id,
        p_new_entry_id: newEntry.id,
      })

      if (relinkError) {
        opLog.error('opening balance relink failed', new Error(relinkError.message))
        return errorResponseFromCode('OB_CORRECT_FAILED', opLog, {
          requestId,
          details: { reason: relinkError.message, newEntryId: newEntry.id, oldEntryId },
        })
      }

      return NextResponse.json({
        data: {
          success: true,
          journal_entry_id: newEntry.id,
          reversed_entry_id: oldEntryId,
          fiscal_period_id,
          lines_created: validLines.length,
          total_debit: totalDebit,
          total_credit: totalCredit,
        },
      })
    } catch (err) {
      if (isBookkeepingError(err)) {
        return errorResponse(err, opLog, { requestId })
      }
      opLog.error('opening balance correct failed', err as Error)
      return errorResponseFromCode('OB_CORRECT_FAILED', opLog, {
        requestId,
        details: { reason: err instanceof Error ? err.message : 'unknown' },
      })
    }
  },
  { requireWrite: true },
)
