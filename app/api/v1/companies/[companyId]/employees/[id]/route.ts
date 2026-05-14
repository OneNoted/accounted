/**
 * /api/v1/companies/{companyId}/employees/{id}
 *
 * GET    — return the full employee record. Personnummer is NOT masked here
 *          (deliberate drill-in; caller already knows the id, has read scope,
 *          and has membership in the company).
 * PATCH  — update a subset of fields. Idempotent (Idempotency-Key recommended,
 *          not enforced). Dry-runnable.
 * DELETE — soft-delete via is_active=false. The employees table has no
 *          archived_at column; BFL 7 kap requires the row to remain for 7
 *          years for audit. Hard delete is never exposed.
 */

import { z } from 'zod'
import { ok, noContent } from '@/lib/api/v1/response'
import { dryRunPreview } from '@/lib/api/v1/dry-run'
import { registerEndpoint } from '@/lib/api/v1/registry'
import { withApiV1 } from '@/lib/api/v1/with-api-v1'
import { v1ErrorResponse, v1ErrorResponseFromCode } from '@/lib/api/v1/errors'
import { UpdateEmployeeSchema } from '@/lib/api/schemas'
import { maskPersonnummer } from '@/lib/api/v1/mask-personnummer'

const EmploymentType = z.enum(['employee', 'company_owner', 'board_member'])
const SalaryType = z.enum(['monthly', 'hourly'])
const FSkattStatus = z.enum(['a_skatt', 'f_skatt', 'fa_skatt', 'not_verified'])

const EmployeeDetail = z.object({
  id: z.string().uuid(),
  first_name: z.string(),
  last_name: z.string(),
  /** Full personnummer (12 digits). Detail endpoint only — never echoed on list. */
  personnummer: z.string(),
  employment_type: EmploymentType,
  employment_start: z.string(),
  employment_end: z.string().nullable(),
  employment_degree: z.number(),
  salary_type: SalaryType,
  monthly_salary: z.number().nullable(),
  hourly_rate: z.number().nullable(),
  tax_table_number: z.number().nullable(),
  tax_column: z.number().nullable(),
  tax_municipality: z.string().nullable(),
  is_sidoinkomst: z.boolean(),
  f_skatt_status: FSkattStatus,
  clearing_number: z.string().nullable(),
  bank_account_number: z.string().nullable(),
  vacation_rule: z.string(),
  vacation_days_per_year: z.number(),
  semestertillagg_rate: z.number(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address_line1: z.string().nullable(),
  postal_code: z.string().nullable(),
  city: z.string().nullable(),
  vaxa_stod_eligible: z.boolean(),
  vaxa_stod_start: z.string().nullable(),
  vaxa_stod_end: z.string().nullable(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
})

const EMPLOYEE_DETAIL_COLUMNS =
  'id, first_name, last_name, personnummer, employment_type, employment_start, employment_end, employment_degree, salary_type, monthly_salary, hourly_rate, tax_table_number, tax_column, tax_municipality, is_sidoinkomst, f_skatt_status, clearing_number, bank_account_number, vacation_rule, vacation_days_per_year, semestertillagg_rate, email, phone, address_line1, postal_code, city, vaxa_stod_eligible, vaxa_stod_start, vaxa_stod_end, is_active, created_at, updated_at'

registerEndpoint({
  operation: 'employees.get',
  method: 'GET',
  path: '/api/v1/companies/:companyId/employees/:id',
  summary: 'Get a single employee.',
  description:
    'Returns the full employee record including the 12-digit personnummer, bank details, tax configuration, and contact info. This is the deliberate drill-in for an id you already know — list calls mask personnummer.',
  useWhen:
    'You have an employee id and need every field (tax table, bank account, vacation rule) — typically to render an edit form or to construct a payroll calculation input.',
  doNotUseFor:
    'Rosters or pickers (use the list endpoint — personnummer is masked there).',
  pitfalls: [
    'The response includes the full personnummer. Treat it as a national identifier (GDPR Art.5(1)(c)) — do not propagate it to logs or external systems beyond what your integration strictly requires.',
    'Inactive (soft-deleted) employees are returned by the detail endpoint; check `is_active` if your flow should skip them.',
  ],
  example: {
    response: {
      data: {
        id: 'a8f1…',
        first_name: 'Anna',
        last_name: 'Andersson',
        personnummer: '198504121234',
        employment_type: 'employee',
        employment_start: '2024-01-15',
        employment_end: null,
        salary_type: 'monthly',
        monthly_salary: 35000,
        f_skatt_status: 'a_skatt',
        is_active: true,
      },
      meta: { request_id: 'req_…', api_version: '2026-05-12' },
    },
  },
  scope: 'payroll:read',
  risk: 'low',
  idempotent: true,
  reversible: false,
  dryRunSupported: false,
  response: { success: EmployeeDetail },
})

export const GET = withApiV1<{ params: Promise<{ companyId: string; id: string }> }>(
  'employees.get',
  async (_request, ctx, params) => {
    const { id } = await params.params
    const idParse = z.string().uuid().safeParse(id)
    if (!idParse.success) {
      return v1ErrorResponseFromCode('VALIDATION_ERROR', ctx.log, {
        requestId: ctx.requestId,
        details: { field: 'id', message: 'Employee id must be a UUID.' },
      })
    }

    const { data, error } = await ctx.supabase
      .from('employees')
      .select(EMPLOYEE_DETAIL_COLUMNS)
      .eq('company_id', ctx.companyId!)
      .eq('id', idParse.data)
      .maybeSingle()

    if (error) {
      return v1ErrorResponse(error, ctx.log, { requestId: ctx.requestId })
    }
    if (!data) {
      return v1ErrorResponseFromCode('EMPLOYEE_NOT_FOUND', ctx.log, { requestId: ctx.requestId })
    }

    return ok(data, { requestId: ctx.requestId })
  },
)

// ──────────────────────────────────────────────────────────────────
// PATCH — update employee
// ──────────────────────────────────────────────────────────────────

registerEndpoint({
  operation: 'employees.update',
  method: 'PATCH',
  path: '/api/v1/companies/:companyId/employees/:id',
  summary: 'Update an employee.',
  description:
    'Partial update of an employee. Only the fields supplied in the body are changed. Supports ?dry_run=true to validate the merged record without committing. Personnummer changes are NOT permitted via this endpoint — the natural-person identity is immutable post-creation.',
  useWhen:
    'You need to change tax configuration, bank details, salary amount, or contact info on an existing employee.',
  doNotUseFor:
    'Changing personnummer (not supported — create a new employee if the natural-person identity changes, which is a rare edge case). Soft-deleting (use DELETE).',
  pitfalls: [
    'personnummer in the body is ignored by this endpoint. To change it you must DELETE and recreate.',
    'salary_type changes require the matching salary field in the same request — switching to monthly without monthly_salary returns 400.',
    'tax_table_number changes only take effect on future salary runs; runs already in `review` or beyond use a frozen snapshot.',
  ],
  example: {
    request: { monthly_salary: 38000, tax_municipality: 'Göteborg' },
    response: { data: { id: 'a8f1…', monthly_salary: 38000 } },
  },
  scope: 'payroll:write',
  risk: 'low',
  idempotent: true,
  reversible: false,
  dryRunSupported: true,
  request: { body: UpdateEmployeeSchema },
  response: { success: EmployeeDetail },
})

export const PATCH = withApiV1<{ params: Promise<{ companyId: string; id: string }> }>(
  'employees.update',
  async (request, ctx, params) => {
    const { id } = await params.params
    const idParse = z.string().uuid().safeParse(id)
    if (!idParse.success) {
      return v1ErrorResponseFromCode('VALIDATION_ERROR', ctx.log, {
        requestId: ctx.requestId,
        details: { field: 'id', message: 'Employee id must be a UUID.' },
      })
    }

    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return v1ErrorResponseFromCode('VALIDATION_ERROR', ctx.log, {
        requestId: ctx.requestId,
        details: { field: 'body', message: 'Body is not valid JSON.' },
      })
    }

    const parsed = UpdateEmployeeSchema.safeParse(rawBody)
    if (!parsed.success) {
      return v1ErrorResponseFromCode('VALIDATION_ERROR', ctx.log, {
        requestId: ctx.requestId,
        details: {
          issues: parsed.error.issues.map((i) => ({
            field: i.path.join('.'),
            message: i.message,
          })),
        },
      })
    }
    const body = parsed.data

    // Fetch the existing row so dry-run + the eventual update see merged state
    // (the Zod superRefine validates against the merged object). Also gives
    // us a clean 404 path before any work happens.
    const { data: existing, error: fetchErr } = await ctx.supabase
      .from('employees')
      .select(EMPLOYEE_DETAIL_COLUMNS)
      .eq('company_id', ctx.companyId!)
      .eq('id', idParse.data)
      .maybeSingle()
    if (fetchErr) {
      return v1ErrorResponse(fetchErr, ctx.log, { requestId: ctx.requestId })
    }
    if (!existing) {
      return v1ErrorResponseFromCode('EMPLOYEE_NOT_FOUND', ctx.log, { requestId: ctx.requestId })
    }

    // Block personnummer change explicitly — UpdateEmployeeSchema doesn't
    // include the field (EmployeeSchemaBase.partial() preserves it as
    // optional, but our intent is forbid). Defensive guard: if a caller
    // somehow supplied it, drop the value rather than alter identity.
    type PersonnummerAttempt = { personnummer?: unknown }
    delete (body as PersonnummerAttempt).personnummer

    // The Zod schema accepts all base fields as optional. Filter to the
    // explicitly-supplied keys so unmentioned columns aren't overwritten to
    // their `default()` values (e.g. is_sidoinkomst would silently reset
    // to false on every PATCH if we passed it unconditionally).
    const rawKeys = Object.keys(rawBody as object)
    const updates: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(body) as Array<[string, unknown]>) {
      if (rawKeys.includes(key)) {
        updates[key] = value === undefined ? null : value
      }
    }

    if (Object.keys(updates).length === 0) {
      return ok(existing, { requestId: ctx.requestId })
    }

    if (ctx.dryRun) {
      // Merge for the preview; mask personnummer in the dry-run shape too.
      const merged = { ...(existing as object), ...updates }
      return dryRunPreview(merged, { requestId: ctx.requestId, log: ctx.log })
    }

    const { data, error } = await ctx.supabase
      .from('employees')
      .update(updates)
      .eq('company_id', ctx.companyId!)
      .eq('id', idParse.data)
      .select(EMPLOYEE_DETAIL_COLUMNS)
      .single()

    if (error) {
      return v1ErrorResponse(error, ctx.log, { requestId: ctx.requestId })
    }

    return ok(data, { requestId: ctx.requestId })
  },
)

// ──────────────────────────────────────────────────────────────────
// DELETE — soft-delete (is_active=false)
// ──────────────────────────────────────────────────────────────────

registerEndpoint({
  operation: 'employees.delete',
  method: 'DELETE',
  path: '/api/v1/companies/:companyId/employees/:id',
  summary: 'Soft-delete an employee.',
  description:
    'Sets `is_active=false`. The row persists for the 7-year retention period required by BFL 7 kap; salary runs that include the employee remain queryable. Hard delete is never exposed.',
  useWhen:
    'An employee has left the company and should no longer appear in active rosters or default to new salary runs.',
  doNotUseFor:
    'Reactivating later (PATCH `is_active=true` instead). Hard-deleting (not supported — retention).',
  pitfalls: [
    'Idempotent: deleting an already-inactive employee returns 204 No Content (the same as the first call).',
    'The row is NOT removed from the database — re-creating with the same personnummer returns 409 EMPLOYEE_DUPLICATE_PERSONNUMMER even after soft-delete.',
    'Past salary runs still reference this employee; their data continues to surface in GET /salary-runs/{id} and SIE exports.',
  ],
  example: {
    response: { data: null },
  },
  scope: 'payroll:write',
  risk: 'low',
  idempotent: true,
  reversible: true,
  dryRunSupported: true,
  response: { success: z.object({}) },
})

export const DELETE = withApiV1<{ params: Promise<{ companyId: string; id: string }> }>(
  'employees.delete',
  async (_request, ctx, params) => {
    const { id } = await params.params
    const idParse = z.string().uuid().safeParse(id)
    if (!idParse.success) {
      return v1ErrorResponseFromCode('VALIDATION_ERROR', ctx.log, {
        requestId: ctx.requestId,
        details: { field: 'id', message: 'Employee id must be a UUID.' },
      })
    }

    const { data: existing, error: fetchErr } = await ctx.supabase
      .from('employees')
      .select('id, is_active')
      .eq('company_id', ctx.companyId!)
      .eq('id', idParse.data)
      .maybeSingle()
    if (fetchErr) {
      return v1ErrorResponse(fetchErr, ctx.log, { requestId: ctx.requestId })
    }
    if (!existing) {
      return v1ErrorResponseFromCode('EMPLOYEE_NOT_FOUND', ctx.log, { requestId: ctx.requestId })
    }

    if (ctx.dryRun) {
      return dryRunPreview(
        { ...(existing as object), is_active: false },
        { requestId: ctx.requestId, log: ctx.log },
      )
    }

    // Already inactive → no-op (idempotent).
    if (!(existing as { is_active: boolean }).is_active) {
      return noContent({ requestId: ctx.requestId })
    }

    const { error } = await ctx.supabase
      .from('employees')
      .update({ is_active: false })
      .eq('company_id', ctx.companyId!)
      .eq('id', idParse.data)

    if (error) {
      return v1ErrorResponse(error, ctx.log, { requestId: ctx.requestId })
    }

    return noContent({ requestId: ctx.requestId })
  },
)

