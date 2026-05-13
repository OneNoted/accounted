/**
 * POST /api/v1/companies/{companyId}/voucher-gap-explanations
 *
 * Document a gap in a verifikationsserie per BFNAR 2013:2 kap 8 §. Voucher
 * numbers are sequential within (fiscal_period_id, voucher_series); any
 * missing number must have a documented explanation. The gap can be a
 * single number (gap_start = gap_end) or a range.
 *
 * Used by:
 *   - Migration / import flows that need to claim numbers but can't fill them
 *   - Audit response when a number was burned by a failed commit attempt
 *   - Operational recovery after manual reconciliation
 *
 * Idempotent (mandatory Idempotency-Key). Insert is small — no dry-run helper.
 */

import { z } from 'zod'
import { created } from '@/lib/api/v1/response'
import { dryRunPreview } from '@/lib/api/v1/dry-run'
import { registerEndpoint } from '@/lib/api/v1/registry'
import { withApiV1 } from '@/lib/api/v1/with-api-v1'
import { v1ErrorResponse, v1ErrorResponseFromCode } from '@/lib/api/v1/errors'

const CreateVoucherGapExplanation = z
  .object({
    fiscal_period_id: z.string().uuid(),
    voucher_series: z.string().regex(/^[A-Z]$/, 'voucher_series must be a single uppercase letter'),
    gap_start: z.number().int().positive(),
    gap_end: z.number().int().positive(),
    explanation: z.string().min(1).max(2000),
  })
  .strict()
  .refine((d) => d.gap_end >= d.gap_start, {
    message: 'gap_end must be >= gap_start',
    path: ['gap_end'],
  })

const VoucherGapExplanationCreated = z.object({
  id: z.string().uuid(),
  fiscal_period_id: z.string().uuid(),
  voucher_series: z.string(),
  gap_start: z.number().int(),
  gap_end: z.number().int(),
  explanation: z.string(),
  created_at: z.string(),
})

registerEndpoint({
  operation: 'voucher-gap-explanations.create',
  method: 'POST',
  path: '/api/v1/companies/:companyId/voucher-gap-explanations',
  summary: 'Document a gap in the verifikationsserie (BFNAR 2013:2 kap 8 §).',
  description:
    'Records an explanation for one or more missing voucher numbers in a series. Required when a number is unaccounted for during audit (e.g. a failed commit that burned the number, or migration data that skipped a range). Idempotent. Dry-runnable.',
  useWhen:
    'You\'re responding to a voucher-gap audit finding and need to document the cause. Also used by migration flows that claim numbers without filling them.',
  doNotUseFor:
    'Falsifying a series — every gap MUST have a genuine explanation. The dashboard surfaces these for auditor review.',
  pitfalls: [
    'Idempotency-Key is mandatory.',
    'gap_end must be >= gap_start; a single-number gap has gap_start = gap_end.',
    'voucher_series is a single uppercase letter (A–Z); the same series + period + numeric range must not already exist.',
  ],
  example: {
    request: {
      fiscal_period_id: 'a8f1…',
      voucher_series: 'A',
      gap_start: 142,
      gap_end: 142,
      explanation: 'Failed commit on 2026-05-12 — balance trigger rejected the entry; sequence advanced before rollback. No source document.',
    },
    response: {
      data: { id: '0e9c…', voucher_series: 'A', gap_start: 142, gap_end: 142 },
      meta: { request_id: 'req_…', api_version: '2026-05-12' },
    },
  },
  scope: 'bookkeeping:write',
  risk: 'low',
  idempotent: true,
  reversible: false,
  dryRunSupported: true,
  request: { body: CreateVoucherGapExplanation },
  response: { success: VoucherGapExplanationCreated },
})

export const POST = withApiV1<{ params: Promise<{ companyId: string }> }>(
  'voucher-gap-explanations.create',
  async (request, ctx) => {
    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return v1ErrorResponseFromCode('VALIDATION_ERROR', ctx.log, {
        requestId: ctx.requestId,
        details: { field: 'body', message: 'Body is not valid JSON.' },
      })
    }
    const parsed = CreateVoucherGapExplanation.safeParse(rawBody)
    if (!parsed.success) {
      return v1ErrorResponseFromCode('VALIDATION_ERROR', ctx.log, {
        requestId: ctx.requestId,
        details: { issues: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) },
      })
    }
    const body = parsed.data

    if (ctx.dryRun) {
      return dryRunPreview(
        {
          fiscal_period_id: body.fiscal_period_id,
          voucher_series: body.voucher_series,
          gap_start: body.gap_start,
          gap_end: body.gap_end,
          explanation: body.explanation,
        },
        { requestId: ctx.requestId, log: ctx.log },
      )
    }

    const { data, error } = await ctx.supabase
      .from('voucher_gap_explanations')
      .insert({
        company_id: ctx.companyId!,
        user_id: ctx.userId,
        fiscal_period_id: body.fiscal_period_id,
        voucher_series: body.voucher_series,
        gap_start: body.gap_start,
        gap_end: body.gap_end,
        explanation: body.explanation,
      })
      .select('id, fiscal_period_id, voucher_series, gap_start, gap_end, explanation, created_at')
      .single()

    if (error) {
      ctx.log.error('voucher-gap-explanations insert failed', error)
      return v1ErrorResponse(error, ctx.log, { requestId: ctx.requestId })
    }
    return created(data, { requestId: ctx.requestId })
  },
  { requireIdempotencyKey: true },
)
