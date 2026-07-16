import { describe, it, expect } from 'vitest'
import {
  LEGAL_VAT_RATES,
  isLegalVatRate,
  findIllegalVatRateRow,
  findReverseChargeAccountWarningRows,
} from '@/lib/vat/supplier-invoice-line-checks'

describe('LEGAL_VAT_RATES', () => {
  it('is exactly the legal Swedish set as decimal fractions', () => {
    expect(LEGAL_VAT_RATES).toEqual([0.25, 0.12, 0.06, 0])
  })
})

describe('isLegalVatRate', () => {
  it.each([0.25, 0.12, 0.06, 0])('accepts %s', (rate) => {
    expect(isLegalVatRate(rate)).toBe(true)
  })

  it.each([0.13, 0.17, 0.2, 0.1, 1, -0.25])('rejects %s', (rate) => {
    expect(isLegalVatRate(rate)).toBe(false)
  })

  it('accepts a rate produced the way the form parses free text (typing 12 -> 12/100)', () => {
    // VatRateCell stores parsed-percent / 100; the division must land exactly
    // on the preset double for the strict includes() match to hold.
    expect(isLegalVatRate(12 / 100)).toBe(true)
    expect(isLegalVatRate(6 / 100)).toBe(true)
    expect(isLegalVatRate(25 / 100)).toBe(true)
  })
})

describe('findIllegalVatRateRow', () => {
  it('returns -1 when every line is legal', () => {
    const items = [{ vat_rate: 0.25 }, { vat_rate: 0.12 }, { vat_rate: 0 }]
    expect(findIllegalVatRateRow(items)).toBe(-1)
  })

  it('returns -1 for an empty list', () => {
    expect(findIllegalVatRateRow([])).toBe(-1)
  })

  it('returns the index of the first illegal line', () => {
    const items = [{ vat_rate: 0.25 }, { vat_rate: 0.13 }, { vat_rate: 0.17 }]
    expect(findIllegalVatRateRow(items)).toBe(1)
  })

  it('flags a 13 % rate typed into the free-text cell (13 / 100)', () => {
    expect(findIllegalVatRateRow([{ vat_rate: 13 / 100 }])).toBe(0)
  })
})

describe('findReverseChargeAccountWarningRows', () => {
  it('flags class 1 and class 6 accounts', () => {
    const items = [
      { account_number: '1930' },
      { account_number: '4010' },
      { account_number: '6540' },
    ]
    expect(findReverseChargeAccountWarningRows(items)).toEqual([0, 2])
  })

  it('does not flag the expected 4xxx/5xxx cost accounts', () => {
    const items = [{ account_number: '4515' }, { account_number: '5420' }]
    expect(findReverseChargeAccountWarningRows(items)).toEqual([])
  })

  it('skips rows without an account (owned by the account-missing check)', () => {
    const items = [{ account_number: '' }, { account_number: '1220' }]
    expect(findReverseChargeAccountWarningRows(items)).toEqual([1])
  })

  it('returns an empty list for no items', () => {
    expect(findReverseChargeAccountWarningRows([])).toEqual([])
  })

  it('treats account numbers as strings, not numbers', () => {
    // '16' and '60' start with 1/6 as strings; a numeric range check would
    // classify them differently.
    expect(
      findReverseChargeAccountWarningRows([
        { account_number: '1680' },
        { account_number: '6072' },
        { account_number: '7010' },
      ]),
    ).toEqual([0, 1])
  })
})
