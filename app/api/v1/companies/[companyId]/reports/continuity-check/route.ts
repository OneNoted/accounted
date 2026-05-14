/**
 * GET /api/v1/companies/{companyId}/reports/continuity-check
 *
 * BFNAR 2013:2 + 5 kap 7 § continuity check: verifies that the period's
 * opening balances match the previous period's closing balances per
 * account. A pre-flight check before period-close.
 */

import { z } from 'zod'
import { ok } from '@/lib/api/v1/response'
import { registerEndpoint } from '@/lib/api/v1/registry'
import { withApiV1 } from '@/lib/api/v1/with-api-v1'
import { loadPeriodFromQuery, safeGenerate } from '@/lib/api/v1/report-period'
import { validateBalanceContinuity } from '@/lib/reports/continuity-check'

registerEndpoint({
  operation: 'reports.continuity-check',
  method: 'GET',
  path: '/api/v1/companies/:companyId/reports/continuity-check',
  summary: 'BFL continuity check — opening balances match prior closing.',
  description:
    'Validates that the target period\'s opening balances (IB) equal the prior period\'s closing balances (UB) per BFL 5 kap 7 §. Returns per-account discrepancies so an operator can rectify them before period close.',
  useWhen:
    'Before locking or closing a period, or as part of an automated year-end readiness gate. Any discrepancy is a hard data-integrity issue.',
  doNotUseFor:
    'Computing balances (use /reports/balance-sheet or /reports/trial-balance). Closing the period (POST /fiscal-periods/{id}/close).',
  pitfalls: [
    '`period_id` is required.',
    'A non-zero discrepancy means IB ≠ prior UB and indicates the opening-balance entry was edited or the prior period was changed after close. Investigate before posting any new entries.',
  ],
  example: {
    response: {
      data: { is_continuous: true, discrepancies: [] },
      meta: { request_id: 'req_…', api_version: '2026-05-12' },
    },
  },
  scope: 'reports:read',
  risk: 'low',
  idempotent: true,
  reversible: false,
  dryRunSupported: false,
  response: { success: z.unknown() },
})

export const GET = withApiV1<{ params: Promise<{ companyId: string }> }>(
  'reports.continuity-check',
  async (request, ctx) => {
    const period = await loadPeriodFromQuery(request, {
      supabase: ctx.supabase,
      companyId: ctx.companyId!,
      requestId: ctx.requestId,
      log: ctx.log,
    })
    if (!period.ok) return period.response

    const gen = await safeGenerate(
      () => validateBalanceContinuity(ctx.supabase, ctx.companyId!, period.period.id),
      { log: ctx.log, requestId: ctx.requestId, reportName: 'continuity-check' },
    )
    if (!gen.ok) return gen.response

    return ok(gen.result, { requestId: ctx.requestId })
  },
)
