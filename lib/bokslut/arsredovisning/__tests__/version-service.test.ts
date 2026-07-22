import { describe, expect, it, vi } from 'vitest'
import type { CanonicalAnnualReport } from '../compliance-types'
import { annualReportContentHash, createAnnualReportVersion } from '../version-service'

function model(signedAt: string | null): CanonicalAnnualReport {
  return {
    schema_version: '1.0',
    generated_at: '2026-07-21T10:00:00Z',
    company_id: 'company-1',
    fiscal_period_id: 'period-1',
    entity_type: 'aktiebolag',
    report: {
      accounting_framework: 'k2',
      signatures: [{ role: 'Styrelseledamot', name: 'Anna Andersson', signed_at: signedAt }],
    },
    profile: { reporting_currency: 'SEK' },
    disclosures: {},
    eligibility: {
      digital_filing_eligible: true,
      digital_issues: [],
    },
    validation: { ok: true },
    ixbrl: {
      entryPointId: 'k2-ab-risbs-2024-09-12',
      underskrifter: {
        dateringsdatum: signedAt,
        signers: [
          {
            firstName: 'Anna',
            lastName: 'Andersson',
            role: 'Styrelseledamot',
            signedDate: signedAt,
          },
        ],
      },
      faststallelseintyg: {
        signerFirstName: 'Anna',
        signerLastName: 'Andersson',
        signerRole: 'Styrelseledamot',
        genereratDatum: '2026-07-21',
      },
    },
  } as unknown as CanonicalAnnualReport
}

describe('annualReportContentHash', () => {
  it('does not change when evidence dates are overlaid after locking', () => {
    expect(annualReportContentHash(model(null))).toBe(
      annualReportContentHash(model('2026-03-01T10:00:00Z')),
    )
  })

  it('changes when signed content changes', () => {
    const original = model(null)
    const changed = model(null)
    changed.report.signatures[0].name = 'Bertil Andersson'
    expect(annualReportContentHash(changed)).not.toBe(annualReportContentHash(original))
  })

  it('locks the digital eligibility decision into the validation snapshot', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: 'version-1', version_number: 1, status: 'draft' }],
      error: null,
    })
    await createAnnualReportVersion({ rpc } as never, 'user-1', model(null), false)
    expect(rpc).toHaveBeenCalledWith(
      'create_annual_report_version',
      expect.objectContaining({
        p_validation_summary: expect.objectContaining({
          digital_filing_eligible: true,
          digital_issues: [],
          profile: expect.objectContaining({ reporting_currency: 'SEK' }),
          disclosures: {},
          eligibility: expect.objectContaining({ digital_filing_eligible: true }),
        }),
      }),
    )
  })
})
