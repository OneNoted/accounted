/**
 * GET /api/v1/companies/{companyId}/reports/vat-declaration
 *
 * Computes the Swedish momsdeklaration for a period (monthly, quarterly,
 * or yearly). Returns all 12 declaration rutor (05/06/07/10/11/12/30/31/32/39/40/48/49)
 * mapped from the BAS accounts (2611/2621/2631/3001/3002/3003/etc.).
 */

import { z } from 'zod'
import { ok } from '@/lib/api/v1/response'
import { registerEndpoint } from '@/lib/api/v1/registry'
import { withApiV1 } from '@/lib/api/v1/with-api-v1'
import { v1ErrorResponseFromCode } from '@/lib/api/v1/errors'
import { safeGenerate } from '@/lib/api/v1/report-period'
import { calculateVatDeclaration } from '@/lib/reports/vat-declaration'
import type { AccountingMethod, VatPeriodType } from '@/types'

const VatPeriodTypeEnum = z.enum(['monthly', 'quarterly', 'yearly'])
const AccountingMethodEnum = z.enum(['accrual', 'cash'])

registerEndpoint({
  operation: 'reports.vat-declaration',
  method: 'GET',
  path: '/api/v1/companies/:companyId/reports/vat-declaration',
  summary: 'Swedish VAT declaration (momsdeklaration) for a period.',
  description:
    'Computes momsdeklaration rutor for the given period_type / year / period. The result includes ruta 05 (taxable sales), 10-12 (output VAT 25/12/6%), 30-32 (reverse-charge VAT), 39-40 (EU services / export), 48 (input VAT), and 49 (moms att betala/återfå — the bottom line). Mapping rules match SKV 4700.',
  useWhen:
    'Submitting momsdeklaration to Skatteverket, reconciling VAT balances at month/quarter end, or building a VAT-payable dashboard.',
  doNotUseFor:
    'Specific transaction VAT lookups (use /transactions/{id}). Period-mismatch reconciliation (use /reports/general-ledger filtered to 26xx accounts).',
  pitfalls: [
    '`period_type` (monthly|quarterly|yearly), `year`, and `period` are all required.',
    'For monthly: period is 1-12. For quarterly: period is 1-4. For yearly: period is 1.',
    '`accounting_method` defaults to accrual (faktureringsmetoden); pass cash for kontantmetoden to honor the VAT-on-payment rule per ML 13 kap.',
    'Output ruta 49 = (10+11+12+30+31+32+60+61+62) − 48. Positive = pay; negative = refund.',
  ],
  example: {
    response: {
      data: {
        period_type: 'monthly',
        year: 2026,
        period: 4,
        rutor: { ruta05: 0, ruta10: 0, ruta11: 0, ruta12: 0, ruta30: 0, ruta48: 0, ruta49: 0 },
      },
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
  'reports.vat-declaration',
  async (request, ctx) => {
    const url = new URL(request.url)
    const FiltersSchema = z.object({
      period_type: VatPeriodTypeEnum,
      year: z.coerce.number().int().min(2000).max(2100),
      period: z.coerce.number().int().min(1).max(12),
      accounting_method: AccountingMethodEnum.optional(),
    })
    const filters = FiltersSchema.safeParse({
      period_type: url.searchParams.get('period_type'),
      year: url.searchParams.get('year'),
      period: url.searchParams.get('period'),
      accounting_method: url.searchParams.get('accounting_method') ?? undefined,
    })
    if (!filters.success) {
      return v1ErrorResponseFromCode('VALIDATION_ERROR', ctx.log, {
        requestId: ctx.requestId,
        details: {
          issues: filters.error.issues.map((i) => ({
            field: i.path.join('.'),
            message: i.message,
          })),
        },
      })
    }
    const { period_type, year, period, accounting_method } = filters.data

    const gen = await safeGenerate(
      () =>
        calculateVatDeclaration(
          ctx.supabase,
          ctx.companyId!,
          period_type as VatPeriodType,
          year,
          period,
          accounting_method as AccountingMethod | undefined,
        ),
      { log: ctx.log, requestId: ctx.requestId, reportName: 'vat-declaration' },
    )
    if (!gen.ok) return gen.response

    return ok(gen.result, { requestId: ctx.requestId })
  },
)
