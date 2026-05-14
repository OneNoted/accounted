/**
 * GET /api/v1/companies/{companyId}/reports/ar-ledger
 *
 * Accounts receivable ledger (kundreskontra) — unpaid customer invoices
 * grouped by customer with aging buckets.
 */

import { z } from 'zod'
import { ok } from '@/lib/api/v1/response'
import { registerEndpoint } from '@/lib/api/v1/registry'
import { withApiV1 } from '@/lib/api/v1/with-api-v1'
import { v1ErrorResponseFromCode } from '@/lib/api/v1/errors'
import { safeGenerate } from '@/lib/api/v1/report-period'
import { generateARLedger } from '@/lib/reports/ar-ledger'

registerEndpoint({
  operation: 'reports.ar-ledger',
  method: 'GET',
  path: '/api/v1/companies/:companyId/reports/ar-ledger',
  summary: 'AR ledger — unpaid customer invoices with aging.',
  description:
    'Returns the customer-receivable ledger as of `as_of_date` (defaults to today). Each customer entry includes outstanding invoices grouped into aging buckets (0–30, 31–60, 61–90, 90+ days). Reconciles against BAS 1510.',
  useWhen:
    'Cash collection dashboards, dunning workflows, end-of-period reconciliation against the 1510 trial-balance figure.',
  doNotUseFor:
    'Listing all invoices regardless of status (use /invoices). Sending dunning emails (the v1 surface does not yet expose dunning).',
  pitfalls: [
    '`as_of_date` is optional; format `YYYY-MM-DD`. Defaults to today (UTC).',
    'Only invoices in `sent`/`overdue`/`partially_paid` status appear. Drafts and credited invoices are excluded.',
  ],
  example: {
    response: {
      data: { as_of_date: '2026-05-31', customers: [], totals: {} },
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
  'reports.ar-ledger',
  async (request, ctx) => {
    const url = new URL(request.url)
    const asOfDate = url.searchParams.get('as_of_date') || undefined
    if (asOfDate && !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
      return v1ErrorResponseFromCode('VALIDATION_ERROR', ctx.log, {
        requestId: ctx.requestId,
        details: { field: 'as_of_date', message: 'Expected YYYY-MM-DD.' },
      })
    }

    const gen = await safeGenerate(
      () => generateARLedger(ctx.supabase, ctx.companyId!, asOfDate),
      { log: ctx.log, requestId: ctx.requestId, reportName: 'ar-ledger' },
    )
    if (!gen.ok) return gen.response

    return ok(gen.result, { requestId: ctx.requestId })
  },
)
