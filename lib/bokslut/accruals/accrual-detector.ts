import type { SupabaseClient } from '@supabase/supabase-js'
import { generateVacationLiability } from '@/lib/reports/vacation-liability'
import { generateTrialBalance } from '@/lib/reports/trial-balance'
import type { AccrualProposal, AccrualsProposal } from './types'

/** Sociala avgifter on accrued salary/vacation (K3 BFNAR 2012:1 ch.19,
 *  K2 BFNAR 2016:10 ch.16). Same rate as the regular AGI calculation. */
export const AVGIFTER_RATE_ON_ACCRUED = 0.3142

/**
 * Compute the next-day ISO date for auto-reversal. The accrual is reversed
 * on the first day of the period following the closing date.
 */
function nextDayIso(closingDate: string): string {
  const d = new Date(closingDate + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Propose an adjustment of semesterlöneskuld (vacation pay liability).
 *
 * The change-in-liability journal entry mirrors the rule in
 * `lib/reports/vacation-liability.ts` and BFNAR 2016:10 ch.16:
 *   - delta on 2920 (accrued vacation) = closing - opening
 *   - 31.42% sociala avgifter on the delta hit 2940
 *
 * Returns null when delta is zero (no entry to propose).
 */
export async function proposeVacationLiabilityChange(
  supabase: SupabaseClient,
  companyId: string,
  fiscalPeriodId: string,
  options: { closingDate: string },
): Promise<AccrualProposal | null> {
  const closingYear = parseInt(options.closingDate.slice(0, 4), 10)
  if (Number.isNaN(closingYear)) {
    throw new Error(`Invalid closing date: ${options.closingDate}`)
  }

  const [report, tb] = await Promise.all([
    generateVacationLiability(supabase, companyId, closingYear),
    generateTrialBalance(supabase, companyId, fiscalPeriodId),
  ])

  // Current closing balance (what 2920 should be at year-end)
  const targetLiability = Math.round(report.totals.accruedAmount)
  // Existing opening balance on 2920 (what's already on the books)
  const row2920 = tb.rows.find((r) => r.account_number === '2920')
  const openingLiability = row2920
    ? Math.round((row2920.opening_credit - row2920.opening_debit) * 100) / 100
    : 0

  const deltaLiability = targetLiability - openingLiability
  if (Math.abs(deltaLiability) < 1) {
    return null
  }

  // Round each side to whole krona so the entry stays balanced after
  // rounding. Compute avgifter on the same rounded delta.
  const deltaInt = Math.round(deltaLiability)
  const avgifterDelta = Math.round(deltaInt * AVGIFTER_RATE_ON_ACCRUED)

  // Positive delta = more vacation liability accrued → debit 7090 expense.
  // Negative delta = vacation taken / liability released → credit 7090.
  const isIncrease = deltaInt > 0
  const lines = [
    {
      account_number: '7090',
      debit_amount: isIncrease ? Math.abs(deltaInt) : 0,
      credit_amount: isIncrease ? 0 : Math.abs(deltaInt),
      line_description: 'Förändring av semesterlöneskuld',
    },
    {
      account_number: '2920',
      debit_amount: isIncrease ? 0 : Math.abs(deltaInt),
      credit_amount: isIncrease ? Math.abs(deltaInt) : 0,
      line_description: 'Upplupna semesterlöner',
    },
    {
      account_number: '7519',
      debit_amount: isIncrease ? Math.abs(avgifterDelta) : 0,
      credit_amount: isIncrease ? 0 : Math.abs(avgifterDelta),
      line_description: 'Sociala avgifter på upplupen semester (31,42 %)',
    },
    {
      account_number: '2940',
      debit_amount: isIncrease ? 0 : Math.abs(avgifterDelta),
      credit_amount: isIncrease ? Math.abs(avgifterDelta) : 0,
      line_description: 'Upplupna sociala avgifter på semester',
    },
  ]

  const totalAmount = Math.abs(deltaInt) + Math.abs(avgifterDelta)

  return {
    kind: 'vacation_liability_change',
    label: isIncrease
      ? `Ökning av semesterlöneskuld (${Math.abs(deltaInt)} kr + avgifter)`
      : `Minskning av semesterlöneskuld (${Math.abs(deltaInt)} kr + avgifter)`,
    description:
      'Mellanvärde-justering av 2920 mot 7090 plus 31,42 % sociala avgifter på 2940 mot 7519.',
    amount: totalAmount,
    lines,
    reverses_on: nextDayIso(options.closingDate),
    warnings: [],
    computation: {
      opening_2920: openingLiability,
      closing_target: targetLiability,
      delta: deltaInt,
      avgifter_rate: AVGIFTER_RATE_ON_ACCRUED,
      avgifter_delta: avgifterDelta,
      employee_rows: report.rows.length,
    },
  }
}

export interface AuditFeeInput {
  /** Estimated audit fee for the fiscal year being closed. */
  amount: number
  /** Closing date — used to derive the reversal date. */
  closingDate: string
  /** Account to credit on the liability side. Defaults to 2992 (revision),
   *  use 2991 for bokslut-fee accrual. */
  liabilityAccount?: '2991' | '2992'
}

/**
 * Propose accrual of audit / bookkeeping fee that will be invoiced after
 * year-end. Standard BFL practice: accrue the cost in the period it relates
 * to, reverse on Jan 1 when the actual invoice arrives.
 */
export function proposeAuditFee(input: AuditFeeInput): AccrualProposal | null {
  const amount = Math.round(input.amount)
  if (amount <= 0) return null
  const liabilityAccount = input.liabilityAccount ?? '2992'
  const isBokslut = liabilityAccount === '2991'

  return {
    kind: 'audit_fee',
    label: isBokslut ? 'Beräknat arvode för bokslut' : 'Beräknat arvode för revision',
    description: `Debet 6420, kredit ${liabilityAccount}. Vänds vid faktura nästa år.`,
    amount,
    lines: [
      {
        account_number: '6420',
        debit_amount: amount,
        credit_amount: 0,
        line_description: isBokslut ? 'Beräknat bokslutarvode' : 'Beräknat revisionsarvode',
      },
      {
        account_number: liabilityAccount,
        debit_amount: 0,
        credit_amount: amount,
        line_description: isBokslut ? 'Beräknat arvode bokslut' : 'Beräknat arvode revision',
      },
    ],
    reverses_on: nextDayIso(input.closingDate),
    warnings: [],
  }
}

export interface ManualPrepaidInput {
  /** Amount of the cost that relates to NEXT year and should be reclassified
   *  to a 17xx prepaid account. */
  amount: number
  /** Cost account being relieved (e.g. 6310 företagsförsäkringar). */
  expenseAccount: string
  /** Target prepaid account (e.g. 1730 förutbetalda försäkringspremier).
   *  Must be in the 17xx interimsfordringar range. */
  prepaidAccount: string
  /** Period this prepaid covers — used in the line description. */
  description: string
  closingDate: string
}

/**
 * Manual prepaid expense reclassification. Debit 17xx, credit the expense
 * account by the portion that hasn't been consumed yet.
 *
 * The caller chooses which expense and prepaid accounts to use because
 * heuristic detection from supplier invoices isn't reliable (no service-
 * period field on the invoice model — see types/index.ts SupplierInvoice).
 * A future heuristic detector can replace this when the data model grows
 * service_period_start/_end fields.
 */
export function proposeManualPrepaid(input: ManualPrepaidInput): AccrualProposal | null {
  if (!/^17\d{2}$/.test(input.prepaidAccount)) {
    throw new Error(`prepaidAccount must be in 17xx range, got ${input.prepaidAccount}`)
  }
  const amount = Math.round(input.amount)
  if (amount <= 0) return null

  return {
    kind: 'manual_prepaid_expense',
    label: `Förutbetald kostnad: ${input.description}`,
    description: `Debet ${input.prepaidAccount}, kredit ${input.expenseAccount}. Vänds vid årsskiftet.`,
    amount,
    lines: [
      {
        account_number: input.prepaidAccount,
        debit_amount: amount,
        credit_amount: 0,
        line_description: `Förutbetald: ${input.description}`,
      },
      {
        account_number: input.expenseAccount,
        debit_amount: 0,
        credit_amount: amount,
        line_description: `Periodisering ut: ${input.description}`,
      },
    ],
    reverses_on: nextDayIso(input.closingDate),
    warnings: [],
  }
}

export interface ManualAccruedInput {
  amount: number
  /** Cost account being charged (e.g. 5010 hyra lokal). */
  expenseAccount: string
  /** Target accrued-cost account (e.g. 2990 övriga upplupna kostnader).
   *  Must be in the 29xx interimsskulder range. */
  accruedAccount: string
  description: string
  closingDate: string
}

/**
 * Manual accrued cost. Debit the expense account, credit 29xx for the
 * portion incurred but not yet invoiced. Mirrors `proposeManualPrepaid`
 * but in the opposite direction.
 */
export function proposeManualAccrued(input: ManualAccruedInput): AccrualProposal | null {
  if (!/^29\d{2}$/.test(input.accruedAccount)) {
    throw new Error(`accruedAccount must be in 29xx range, got ${input.accruedAccount}`)
  }
  const amount = Math.round(input.amount)
  if (amount <= 0) return null

  return {
    kind: 'manual_accrued_expense',
    label: `Upplupen kostnad: ${input.description}`,
    description: `Debet ${input.expenseAccount}, kredit ${input.accruedAccount}. Vänds vid årsskiftet.`,
    amount,
    lines: [
      {
        account_number: input.expenseAccount,
        debit_amount: amount,
        credit_amount: 0,
        line_description: `Periodisering in: ${input.description}`,
      },
      {
        account_number: input.accruedAccount,
        debit_amount: 0,
        credit_amount: amount,
        line_description: `Upplupen: ${input.description}`,
      },
    ],
    reverses_on: nextDayIso(input.closingDate),
    warnings: [],
  }
}

/**
 * Build a snapshot of automatically-detectable accrual proposals for the
 * wizard's preflight. Today this is just the vacation-liability delta;
 * future versions can add salary-accrued-but-unpaid, supplier-invoice-period
 * detection, etc. Manual prepaid/accrued cards are added via the UI form
 * (the API endpoint accepts them but they're not in the auto-proposal).
 */
export async function buildAccrualsProposal(
  supabase: SupabaseClient,
  companyId: string,
  fiscalPeriodId: string,
): Promise<AccrualsProposal> {
  const { data: period, error } = await supabase
    .from('fiscal_periods')
    .select('id, name, period_start, period_end')
    .eq('id', fiscalPeriodId)
    .eq('company_id', companyId)
    .single()
  if (error || !period) throw new Error('Fiscal period not found')

  const proposals: AccrualProposal[] = []

  const vacation = await proposeVacationLiabilityChange(supabase, companyId, fiscalPeriodId, {
    closingDate: period.period_end,
  })
  if (vacation) proposals.push(vacation)

  return {
    fiscalPeriod: period,
    proposals,
  }
}
