import { describe, it, expect } from 'vitest'
import type { VatDeclarationRutor } from '@/types'
import { runVatDeclarationChecks } from '../vat-declaration-checks'

const emptyRutor: VatDeclarationRutor = {
  ruta05: 0, ruta06: 0, ruta07: 0, ruta08: 0,
  ruta10: 0, ruta11: 0, ruta12: 0,
  ruta20: 0, ruta21: 0, ruta22: 0, ruta23: 0, ruta24: 0,
  ruta30: 0, ruta31: 0, ruta32: 0,
  ruta35: 0, ruta36: 0, ruta37: 0, ruta38: 0,
  ruta39: 0, ruta40: 0, ruta41: 0, ruta42: 0,
  ruta48: 0, ruta49: 0,
  ruta50: 0, ruta60: 0, ruta61: 0, ruta62: 0,
}

describe('runVatDeclarationChecks', () => {
  it('returns empty findings for a balanced sales-only declaration', () => {
    const rutor: VatDeclarationRutor = {
      ...emptyRutor,
      ruta05: 100000,
      ruta10: 25000,
      ruta49: 25000,
    }
    expect(runVatDeclarationChecks(rutor)).toEqual([])
  })

  it('returns empty findings for a balanced declaration with RC basis + output VAT', () => {
    const rutor: VatDeclarationRutor = {
      ...emptyRutor,
      ruta21: 10000, // EU services basis
      ruta30: 2500,  // RC output VAT
      ruta48: 2500,  // matching input VAT
      ruta49: 0,
    }
    expect(runVatDeclarationChecks(rutor)).toEqual([])
  })

  // FK004 mirror: SKV's primary rejection signal we want to catch locally.
  it('flags ERROR when ruta 30-32 populated but ruta 20-24 is empty', () => {
    const rutor: VatDeclarationRutor = {
      ...emptyRutor,
      ruta05: 78852,
      ruta10: 19713,
      ruta30: 2500,
      ruta48: 2500,
      ruta49: 19713,
    }
    const findings = runVatDeclarationChecks(rutor)
    const fk004 = findings.find((f) => f.code === 'RC_BASIS_MISSING')
    expect(fk004).toBeDefined()
    expect(fk004?.status).toBe('ERROR')
    expect(fk004?.message).toMatch(/ruta 30-32/)
    expect(fk004?.message).toMatch(/ruta 20-24/)
  })

  it('flags ERROR when basis is present but no output RC VAT', () => {
    const rutor: VatDeclarationRutor = {
      ...emptyRutor,
      ruta21: 10000,
      ruta48: 2500,
      ruta49: -2500,
    }
    const findings = runVatDeclarationChecks(rutor)
    expect(findings.find((f) => f.code === 'RC_OUTPUT_MISSING')?.status).toBe('ERROR')
  })

  it('warns when input VAT is materially smaller than RC output VAT', () => {
    const rutor: VatDeclarationRutor = {
      ...emptyRutor,
      ruta21: 10000,
      ruta30: 2500,
      ruta48: 100, // Calculated input VAT missing — should be ~2500
      ruta49: 2400,
    }
    const findings = runVatDeclarationChecks(rutor)
    const mismatch = findings.find((f) => f.code === 'RC_INPUT_VAT_MISMATCH')
    expect(mismatch?.status).toBe('WARNING')
  })

  // FK009 detection: if our calculator and SKV's recomputed sum disagree
  // we flag locally so we never submit a drift.
  it('flags ERROR when ruta49 drifts from the canonical formula', () => {
    const rutor: VatDeclarationRutor = {
      ...emptyRutor,
      ruta10: 100,
      ruta48: 20,
      ruta49: 99, // wrong — should be 80
    }
    const findings = runVatDeclarationChecks(rutor)
    const drift = findings.find((f) => f.code === 'SUMMA_MOMS_DRIFT')
    expect(drift?.status).toBe('ERROR')
  })

  it('ignores fractional-öre drift (≤ 0.5 SEK)', () => {
    const rutor: VatDeclarationRutor = {
      ...emptyRutor,
      ruta10: 100.30,
      ruta48: 20.10,
      ruta49: 80.20, // canonical formula exactly, only fractional öre
    }
    const findings = runVatDeclarationChecks(rutor)
    expect(findings.find((f) => f.code === 'SUMMA_MOMS_DRIFT')).toBeUndefined()
  })
})
