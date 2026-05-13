/**
 * GET /api/v1/companies/{companyId}/compliance/check?type=...
 *
 * gnubok's defensible edge: a single, structured pre-flight endpoint that
 * surfaces the same compliance checks the MCP / dashboard run, in a form
 * an agent can act on programmatically.
 *
 * Generalises the existing MCP tools (gnubok_vat_close_check,
 * gnubok_year_end_readiness) under a single response shape. New check types
 * can be added by registering an entry in CHECK_RUNNERS — the response
 * envelope stays stable so agents only learn one shape.
 *
 * Response shape:
 *   {
 *     type, ready: boolean, findings: [{ severity, code, message, details }],
 *     summary: string, generated_at, params: { ... }
 *   }
 */

import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ok } from '@/lib/api/v1/response'
import { registerEndpoint } from '@/lib/api/v1/registry'
import { withApiV1 } from '@/lib/api/v1/with-api-v1'
import { v1ErrorResponse, v1ErrorResponseFromCode } from '@/lib/api/v1/errors'
import { computeVatCloseCheck } from '@/extensions/general/mcp-server/server'
import { validateYearEndReadiness } from '@/lib/core/bookkeeping/year-end-service'

// --------------------------------------------------------------------
// Response envelope: identical shape across check types so agents learn
// one structure.
// --------------------------------------------------------------------

const Finding = z.object({
  severity: z.enum(['info', 'warning', 'blocker']),
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
})

const ComplianceCheckResponse = z.object({
  type: z.string(),
  ready: z.boolean(),
  findings: z.array(Finding),
  summary: z.string(),
  generated_at: z.string(),
  params: z.record(z.string(), z.unknown()),
})

type FindingShape = z.infer<typeof Finding>

interface CheckResult {
  ready: boolean
  findings: FindingShape[]
  summary: string
  /** Free-form extra payload merged into the response under `details` (e.g. the VAT rutor + payment block). */
  extra?: Record<string, unknown>
}

// --------------------------------------------------------------------
// Check runners. Each runner is responsible for its own param parsing.
// --------------------------------------------------------------------

const SUPPORTED_TYPES = [
  'vat_close',
  'year_end_readiness',
  'voucher_gaps',
] as const
type CheckType = (typeof SUPPORTED_TYPES)[number]

const CheckTypeSchema = z.enum(SUPPORTED_TYPES)

async function runVatCloseCheck(
  supabase: SupabaseClient,
  companyId: string,
  url: URL,
): Promise<CheckResult | { error: string; details?: unknown }> {
  const ParamsSchema = z.object({
    period_type: z.enum(['monthly', 'quarterly', 'yearly']),
    year: z.coerce.number().int().min(2000).max(2100),
    period: z.coerce.number().int().min(1).max(12),
  })
  const parsed = ParamsSchema.safeParse({
    period_type: url.searchParams.get('period_type') ?? undefined,
    year: url.searchParams.get('year') ?? undefined,
    period: url.searchParams.get('period') ?? undefined,
  })
  if (!parsed.success) {
    return {
      error: 'vat_close requires period_type, year, period query params.',
      details: { issues: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) },
    }
  }
  const args = parsed.data

  const result = await computeVatCloseCheck(
    { period_type: args.period_type, year: args.year, period: args.period },
    companyId,
    supabase,
  )

  const findings: FindingShape[] = []
  // Blockers from the MCP shape map 1:1 to our findings array.
  if (Array.isArray(result.blockers)) {
    for (const b of result.blockers as Array<{ code?: string; message?: string; severity?: string; details?: unknown }>) {
      findings.push({
        severity: (b.severity as FindingShape['severity']) ?? 'blocker',
        code: b.code ?? 'VAT_CLOSE_BLOCKER',
        message: b.message ?? 'VAT close blocker',
        details: b.details,
      })
    }
  }

  return {
    ready: !!result.ready_to_close,
    findings,
    summary: result.summary ?? `VAT close check for ${args.period_type} ${args.year}-${args.period}.`,
    extra: {
      period: result.period,
      period_label: result.period_label,
      rutor: result.rutor,
      payment: result.payment,
      sanity: result.sanity,
    },
  }
}

async function runYearEndReadinessCheck(
  supabase: SupabaseClient,
  companyId: string,
  userId: string,
  url: URL,
): Promise<CheckResult | { error: string; details?: unknown }> {
  const fiscalPeriodId = url.searchParams.get('fiscal_period_id')
  if (!fiscalPeriodId || !z.string().uuid().safeParse(fiscalPeriodId).success) {
    return {
      error: 'year_end_readiness requires fiscal_period_id (UUID) query param.',
    }
  }

  const validation = await validateYearEndReadiness(supabase, companyId, userId, fiscalPeriodId)
  const findings: FindingShape[] = []

  for (const err of validation.errors ?? []) {
    findings.push({ severity: 'blocker', code: 'YEAR_END_BLOCKER', message: err })
  }
  for (const w of validation.warnings ?? []) {
    findings.push({ severity: 'warning', code: 'YEAR_END_WARNING', message: w })
  }
  if ((validation.draftCount ?? 0) > 0) {
    findings.push({
      severity: 'blocker',
      code: 'YEAR_END_DRAFTS_PRESENT',
      message: `${validation.draftCount} draft journal entries must be committed or cancelled before year-end.`,
      details: { draft_count: validation.draftCount },
    })
  }
  if ((validation.unexplainedGaps ?? []).length > 0) {
    findings.push({
      severity: 'blocker',
      code: 'YEAR_END_UNEXPLAINED_VOUCHER_GAPS',
      message: `${validation.unexplainedGaps.length} voucher-number gap(s) lack an explanation (BFNAR 2013:2 kap 8 §).`,
      details: { gaps: validation.unexplainedGaps },
    })
  }
  if (!validation.trialBalanceBalanced) {
    findings.push({
      severity: 'blocker',
      code: 'YEAR_END_TRIAL_BALANCE_UNBALANCED',
      message: 'Trial balance does not balance; close blockers before year-end.',
    })
  }

  return {
    ready: validation.ready,
    findings,
    summary: validation.ready
      ? 'Period is ready for year-end closing.'
      : `Period is NOT ready (${findings.filter((f) => f.severity === 'blocker').length} blocker(s)).`,
    extra: {
      draft_count: validation.draftCount,
      unexplained_gap_count: validation.unexplainedGaps?.length ?? 0,
      sequence_mismatch_count: validation.sequenceMismatches?.length ?? 0,
      trial_balance_balanced: validation.trialBalanceBalanced,
    },
  }
}

async function runVoucherGapsCheck(
  supabase: SupabaseClient,
  companyId: string,
  url: URL,
): Promise<CheckResult | { error: string; details?: unknown }> {
  const fiscalPeriodId = url.searchParams.get('fiscal_period_id')
  if (!fiscalPeriodId || !z.string().uuid().safeParse(fiscalPeriodId).success) {
    return { error: 'voucher_gaps requires fiscal_period_id (UUID) query param.' }
  }

  const { data, error } = await supabase.rpc('detect_voucher_gaps', {
    p_company_id: companyId,
    p_fiscal_period_id: fiscalPeriodId,
  })
  if (error) throw error

  type GapRow = { voucher_series: string; gap_start: number; gap_end: number; has_explanation: boolean }
  const rows = (data ?? []) as GapRow[]

  const findings: FindingShape[] = rows.map((r) => ({
    severity: r.has_explanation ? 'info' : 'blocker',
    code: r.has_explanation ? 'VOUCHER_GAP_EXPLAINED' : 'VOUCHER_GAP_UNEXPLAINED',
    message: `Series ${r.voucher_series}: gap ${r.gap_start}${r.gap_end > r.gap_start ? `–${r.gap_end}` : ''}${r.has_explanation ? ' (explained)' : ' (no explanation)'}.`,
    details: { voucher_series: r.voucher_series, gap_start: r.gap_start, gap_end: r.gap_end, has_explanation: r.has_explanation },
  }))

  const unexplainedCount = findings.filter((f) => f.code === 'VOUCHER_GAP_UNEXPLAINED').length

  return {
    ready: unexplainedCount === 0,
    findings,
    summary:
      rows.length === 0
        ? 'Verifikationsserie is continuous (no gaps).'
        : `${unexplainedCount} unexplained gap(s) of ${rows.length} total. Document via POST /voucher-gap-explanations.`,
    extra: { total_gaps: rows.length, unexplained_count: unexplainedCount },
  }
}

// --------------------------------------------------------------------
// Endpoint definition
// --------------------------------------------------------------------

registerEndpoint({
  operation: 'compliance.check',
  method: 'GET',
  path: '/api/v1/companies/:companyId/compliance/check',
  summary: 'Run a structured compliance pre-flight check.',
  description:
    'Generalised pre-flight that consolidates the gnubok pre-close validators under one envelope. Supported check types: vat_close (SKV 4700 rutor + close blockers), year_end_readiness (BFNAR 2017:3 + ÅRL 2:1 blockers), voucher_gaps (BFNAR 2013:2 kap 8 § series continuity). New types can be added without changing the response shape.',
  useWhen:
    'Before committing to an irreversible action (VAT close, year-end close), or as a periodic audit sweep to surface blockers before they become urgent.',
  doNotUseFor:
    'Executing the underlying action — this is read-only. After a passing check, call the corresponding async endpoint (POST /fiscal-periods/{id}/year-end, etc).',
  pitfalls: [
    'vat_close requires period_type (monthly|quarterly|yearly), year, and period query params.',
    'year_end_readiness and voucher_gaps require fiscal_period_id (UUID).',
    'A passing check is a SNAPSHOT — the state can change between the check and the action. The same blocker logic runs again on commit.',
  ],
  example: {
    response: {
      data: {
        type: 'year_end_readiness',
        ready: false,
        findings: [
          { severity: 'blocker', code: 'YEAR_END_DRAFTS_PRESENT', message: '3 draft journal entries must be committed or cancelled before year-end.', details: { draft_count: 3 } },
        ],
        summary: 'Period is NOT ready (1 blocker(s)).',
        generated_at: '2026-05-12T14:00:00Z',
        params: { fiscal_period_id: 'a8f1…' },
      },
      meta: { request_id: 'req_…', api_version: '2026-05-12' },
    },
  },
  scope: 'compliance:read',
  risk: 'low',
  idempotent: true,
  reversible: false,
  dryRunSupported: false,
  response: { success: ComplianceCheckResponse },
})

export const GET = withApiV1<{ params: Promise<{ companyId: string }> }>(
  'compliance.check',
  async (request, ctx) => {
    const url = new URL(request.url)
    const typeRaw = url.searchParams.get('type')
    const typeParse = CheckTypeSchema.safeParse(typeRaw)
    if (!typeParse.success) {
      return v1ErrorResponseFromCode('VALIDATION_ERROR', ctx.log, {
        requestId: ctx.requestId,
        details: {
          field: 'type',
          message: `type must be one of: ${SUPPORTED_TYPES.join(', ')}.`,
          supported_types: SUPPORTED_TYPES,
        },
      })
    }
    const type: CheckType = typeParse.data

    try {
      let result: CheckResult | { error: string; details?: unknown }
      const params: Record<string, unknown> = { type }

      switch (type) {
        case 'vat_close':
          result = await runVatCloseCheck(ctx.supabase, ctx.companyId!, url)
          params.period_type = url.searchParams.get('period_type')
          params.year = url.searchParams.get('year')
          params.period = url.searchParams.get('period')
          break
        case 'year_end_readiness':
          result = await runYearEndReadinessCheck(ctx.supabase, ctx.companyId!, ctx.userId, url)
          params.fiscal_period_id = url.searchParams.get('fiscal_period_id')
          break
        case 'voucher_gaps':
          result = await runVoucherGapsCheck(ctx.supabase, ctx.companyId!, url)
          params.fiscal_period_id = url.searchParams.get('fiscal_period_id')
          break
      }

      if ('error' in result) {
        return v1ErrorResponseFromCode('VALIDATION_ERROR', ctx.log, {
          requestId: ctx.requestId,
          details: { message: result.error, ...(result.details ? { issues: result.details } : {}) },
        })
      }

      return ok(
        {
          type,
          ready: result.ready,
          findings: result.findings,
          summary: result.summary,
          generated_at: new Date().toISOString(),
          params,
          ...(result.extra ? { details: result.extra } : {}),
        },
        { requestId: ctx.requestId },
      )
    } catch (err) {
      ctx.log.error('compliance.check failed', err as Error, { type })
      return v1ErrorResponse(err, ctx.log, { requestId: ctx.requestId })
    }
  },
)
