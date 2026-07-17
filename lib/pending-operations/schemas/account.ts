import { z } from 'zod'

// Commit-boundary re-validation for staged chart-of-accounts operations
// (gnubok_create_account / gnubok_update_account). A staged
// pending_operations row is re-parsed here before it touches
// chart_of_accounts so a tampered row cannot inject unexpected fields
// (defense in depth, ASVS V4.5): mirrors lib/pending-operations/schemas/article.ts.
//
// account_type includes 'untaxed_reserves' beyond the web UI's five values:
// BAS 2026 carries it for the 21xx group and the batch-activate route already
// inserts it, so a BAS-prefilled staged create must round-trip it too.

const accountNumber = z
  .string()
  .regex(/^\d{4}$/, 'Account number must be exactly 4 digits')

const accountType = z.enum([
  'asset', 'equity', 'liability', 'revenue', 'expense', 'untaxed_reserves',
])

const normalBalance = z.enum(['debit', 'credit'])

// Same shape as defaultVatRate in lib/api/schemas.ts (the dashboard route):
// fraction-of-one, not percent, so the two write paths cannot drift.
const defaultVatRate = z
  .union([z.literal(0), z.literal(0.06), z.literal(0.12), z.literal(0.25)])
  .nullable()
  .optional()

/** Empty string / null → undefined, then bounded string. */
const optString = (max: number) =>
  z.preprocess((v) => (v == null || v === '' ? undefined : v), z.string().max(max).optional())

/**
 * Update-side variant: empty string → null so an agent can CLEAR a stored
 * value ('' and null both mean "remove"); undefined still means "unchanged".
 * The executor copies null through to the UPDATE payload.
 */
const clearableString = (max: number) =>
  z.preprocess((v) => (v === '' ? null : v), z.string().max(max).nullable().optional())

const trimmedName = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim() : v),
  z.string().min(1, 'Account name is required').max(200),
)

export const CreateAccountParamsSchema = z.object({
  account_number: accountNumber,
  account_name: trimmedName,
  account_type: accountType,
  normal_balance: normalBalance,
  plan_type: z.enum(['k1', 'full_bas']).default('k1'),
  description: optString(2000),
  default_vat_code: optString(32),
  default_vat_rate: defaultVatRate,
  sru_code: optString(16),
})

export const UpdateAccountParamsSchema = z.object({
  account_number: accountNumber,
  account_name: trimmedName.optional(),
  description: clearableString(2000),
  default_vat_code: clearableString(32),
  default_vat_rate: defaultVatRate,
  sru_code: clearableString(16),
  is_active: z.boolean().optional(),
})

export type CreateAccountParams = z.infer<typeof CreateAccountParamsSchema>
export type UpdateAccountParams = z.infer<typeof UpdateAccountParamsSchema>
