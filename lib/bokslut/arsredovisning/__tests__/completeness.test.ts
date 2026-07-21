import { describe, expect, it } from 'vitest'
import type { ArsredovisningData } from '../types'
import {
  emptyAnnualReportProfile,
  type AnnualReportEligibilityResult,
  type AnnualReportProfile,
} from '../compliance-types'
import { validateAnnualReportCompleteness } from '../completeness'

const eligibility: AnnualReportEligibilityResult = {
  k2_eligible: true,
  digital_filing_eligible: true,
  size_classification: 'smaller',
  k2_relief_rule: 'eligible',
  issues: [],
  digital_issues: [],
}

function report(): ArsredovisningData {
  return {
    accounting_framework: 'k2',
    company: { name: 'Test AB', org_number: '556012-5790', city: 'Stockholm' },
    fiscal_period: {
      id: 'period-1',
      name: '2025',
      period_start: '2025-01-01',
      period_end: '2025-12-31',
    },
    previous_period: null,
    forvaltningsberattelse: {
      description: 'Bolaget bedriver konsultverksamhet.',
      important_events: 'Inga väsentliga händelser.',
      resultatdisposition: 'Resultatet balanseras i ny räkning.',
      proposed_dividend: 0,
      resultatdisposition_amounts: {
        retained_earnings: 80,
        share_premium_reserve: 0,
        current_year_result: 20,
        total: 100,
        proposed_dividend: 0,
        carried_forward: 100,
      },
      agm_date: '2026-03-15',
    },
    balansrakning: {
      total_assets: 100,
      total_equity_liabilities: 100,
      total_assets_previous: null,
      total_equity_liabilities_previous: null,
      assets: [{ label: 'Bank', amount: 100 }],
    },
    resultatrakning: [{ label: 'Nettoomsättning', amount: 100 }],
    noter: [{ number: 1, title: 'Principer', body: 'K2' }],
    signatures: [{ role: 'Styrelseledamot', name: 'Anna Andersson', signed_at: '2026-03-01' }],
    warnings: [],
  } as unknown as ArsredovisningData
}

function input(stage: 'draft' | 'signing' | 'filing') {
  const profile: AnnualReportProfile = {
    ...emptyAnnualReportProfile('company-1', 'period-1'),
    k2_assessment_confirmed_at: '2026-02-01T10:00:00Z',
    narrative_confirmed_at: '2026-02-01T10:00:00Z',
    signer_roster_confirmed_at: '2026-02-01T10:00:00Z',
    is_in_liquidation: false,
    auditor_report_required: false,
  }
  return {
    report: report(),
    profile,
    eligibility,
    stage,
    todayIso: '2026-03-20',
    disclosures: {
      long_term_debt_over_five_years_confirmed: true,
      securities_pledged_confirmed: true,
      contingent_liabilities_confirmed: true,
      parent_company_confirmed: true,
      agm_disposition_outcome: 'proposal_approved' as
        | 'proposal_approved'
        | 'alternative_decision'
        | null,
      agm_disposition_decision: null,
    },
  }
}

describe('validateAnnualReportCompleteness', () => {
  it('accepts a complete filing model', () => {
    const result = validateAnnualReportCompleteness(input('filing'))
    expect(result.ok).toBe(true)
    expect(result.error_count).toBe(0)
  })

  it('does not infer an unanswered disclosure confirmation', () => {
    const value = input('draft')
    value.disclosures.securities_pledged_confirmed = false
    const result = validateAnnualReportCompleteness(value)
    expect(result.ok).toBe(false)
    expect(result.issues.some((issue) => issue.code === 'AR-NOTE-SECURITIES-UNCONFIRMED')).toBe(
      true,
    )
  })

  it('requires signers before a version can be locked', () => {
    const value = input('signing')
    value.report.signatures = []
    const result = validateAnnualReportCompleteness(value)
    expect(result.issues.some((issue) => issue.code === 'AR-SIGNERS-MISSING')).toBe(true)
  })

  it('validates the organisation number check digit', () => {
    const value = input('draft')
    value.report.company.org_number = '556012-5791'
    const result = validateAnnualReportCompleteness(value)
    expect(result.issues.some((issue) => issue.code === 'AR-COMPANY-ORGNR')).toBe(true)
  })

  it('requires confirmation that the signer roster matches Bolagsverket', () => {
    const value = input('signing')
    value.profile.signer_roster_confirmed_at = null
    const result = validateAnnualReportCompleteness(value)
    expect(result.issues.some((issue) => issue.code === 'AR-SIGNER-ROSTER-UNCONFIRMED')).toBe(true)
  })

  it('blocks impossible signature and AGM chronology', () => {
    const value = input('filing')
    value.report.signatures[0].signed_at = '2025-12-30'
    value.report.forvaltningsberattelse.agm_date = '2025-12-29'
    const result = validateAnnualReportCompleteness(value)
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['AR-SIGNATURE-BEFORE-PERIOD-END', 'AR-AGM-BEFORE-PERIOD-END']),
    )
  })

  it('keeps K3 output draft-only until the complete K3 disclosure matrix exists', () => {
    const value = input('signing')
    value.report.accounting_framework = 'k3'
    const result = validateAnnualReportCompleteness(value)
    expect(result.issues.some((issue) => issue.code === 'AR-K3-DRAFT-ONLY')).toBe(true)
  })

  it('requires the AGM decision and evidence dates at filing stage', () => {
    const value = input('filing')
    value.report.signatures[0].signed_at = null
    value.disclosures.agm_disposition_outcome = null
    const result = validateAnnualReportCompleteness(value)
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['AR-SIGNATURES-INCOMPLETE', 'AR-AGM-DISPOSITION-OUTCOME']),
    )
  })

  it('blocks a proposed dividend above distributable equity', () => {
    const value = input('draft')
    value.report.forvaltningsberattelse.resultatdisposition_amounts.proposed_dividend = 101
    const result = validateAnnualReportCompleteness(value)
    expect(result.issues.some((issue) => issue.code === 'AR-DIVIDEND-EXCEEDS-EQUITY')).toBe(true)
  })

  it('requires a documented prudence assessment for a positive dividend', () => {
    const value = input('draft')
    value.report.forvaltningsberattelse.resultatdisposition_amounts.proposed_dividend = 50
    const result = validateAnnualReportCompleteness(value)
    expect(
      result.issues.some((issue) => issue.code === 'AR-DIVIDEND-PRUDENCE-UNCONFIRMED'),
    ).toBe(true)

    value.profile.dividend_prudence_confirmed = true
    const confirmed = validateAnnualReportCompleteness(value)
    expect(
      confirmed.issues.some((issue) => issue.code === 'AR-DIVIDEND-PRUDENCE-UNCONFIRMED'),
    ).toBe(false)
  })

  it('does not report a dividend error for zero dividend and negative equity', () => {
    const value = input('draft')
    value.report.forvaltningsberattelse.resultatdisposition_amounts.total = -100
    value.report.forvaltningsberattelse.resultatdisposition_amounts.carried_forward = -100
    const result = validateAnnualReportCompleteness(value)
    expect(result.issues.some((issue) => issue.code.startsWith('AR-DIVIDEND-'))).toBe(false)
  })
})
