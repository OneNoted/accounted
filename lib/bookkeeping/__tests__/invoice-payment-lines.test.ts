import { describe, it, expect } from 'vitest'
import { buildInvoicePaymentClearingLines } from '../invoice-payment-lines'

describe('buildInvoicePaymentClearingLines', () => {
  describe('same currency (SEK invoice + SEK tx)', () => {
    it('full payment: 1930 = 1510 = tx amount, no FX line', () => {
      const result = buildInvoicePaymentClearingLines(
        { amount: 1250, amount_sek: null, currency: 'SEK', exchange_rate: null },
        { currency: 'SEK', exchange_rate: null, remaining_amount: 1250, total: 1250, paid_amount: 0 },
        'Inbetalning kundfaktura',
      )
      expect(result.bankSek).toBe(1250)
      expect(result.arSek).toBe(1250)
      expect(result.fxDiffSek).toBe(0)
      expect(result.lines).toHaveLength(2)
      expect(result.lines[0]).toMatchObject({ account_number: '1930', debit_amount: 1250, credit_amount: 0 })
      expect(result.lines[1]).toMatchObject({ account_number: '1510', debit_amount: 0, credit_amount: 1250 })
    })

    it('partial payment: 1930 = 1510 = tx amount (the actual SEK received)', () => {
      // Scenario from the user: invoice 1 250, prior 230 partial, now 1 000 hits.
      // 1930/1510 must equal 1 000 (not 1 250). After this verifikat the invoice
      // remaining is 20 SEK and status stays partially_paid (handled by the
      // caller, not this helper).
      const result = buildInvoicePaymentClearingLines(
        { amount: 1000, amount_sek: null, currency: 'SEK', exchange_rate: null },
        { currency: 'SEK', exchange_rate: null, remaining_amount: 1020, total: 1250, paid_amount: 230 },
        'Inbetalning kundfaktura',
      )
      expect(result.bankSek).toBe(1000)
      expect(result.arSek).toBe(1000)
      expect(result.fxDiffSek).toBe(0)
      expect(result.lines).toHaveLength(2)
    })

    it('expense tx (negative amount) treats absolute SEK value', () => {
      const result = buildInvoicePaymentClearingLines(
        { amount: -500, amount_sek: null, currency: 'SEK', exchange_rate: null },
        { currency: 'SEK', exchange_rate: null, remaining_amount: 500, total: 500, paid_amount: 0 },
        'desc',
      )
      expect(result.bankSek).toBe(500)
      expect(result.arSek).toBe(500)
    })
  })

  describe('cross currency (USD invoice + SEK tx)', () => {
    it('bank received MORE SEK than booked: gain to 3960', () => {
      // Invoice 100 USD booked at 10.00 (1000 SEK on 1510)
      // Bank receives 1100 SEK (rate moved to 11.00 by payment date)
      // FX gain = 100 SEK → 3960 credit
      const result = buildInvoicePaymentClearingLines(
        { amount: 1100, amount_sek: null, currency: 'SEK', exchange_rate: null },
        { currency: 'USD', exchange_rate: 10, remaining_amount: 100, total: 100, paid_amount: 0 },
        'Inbetalning kundfaktura',
      )
      expect(result.bankSek).toBe(1100)
      expect(result.arSek).toBe(1000)
      expect(result.fxDiffSek).toBe(-100)
      expect(result.lines).toHaveLength(3)
      expect(result.lines[0]).toMatchObject({ account_number: '1930', debit_amount: 1100 })
      expect(result.lines[1]).toMatchObject({ account_number: '1510', credit_amount: 1000 })
      expect(result.lines[2]).toMatchObject({
        account_number: '3960',
        credit_amount: 100,
        line_description: 'Valutakursvinst',
      })
      // Balanced
      const debit = result.lines.reduce((s, l) => s + l.debit_amount, 0)
      const credit = result.lines.reduce((s, l) => s + l.credit_amount, 0)
      expect(Math.round((debit - credit) * 100)).toBe(0)
    })

    it('bank received FEWER SEK than booked: loss to 7960', () => {
      // Invoice 140 USD booked at 15.30 (2142 SEK on 1510)
      // Bank receives 230 SEK only (rate or amount disagreement)
      // FX loss = 1912 SEK → 7960 debit
      const result = buildInvoicePaymentClearingLines(
        { amount: 230, amount_sek: null, currency: 'SEK', exchange_rate: null },
        { currency: 'USD', exchange_rate: 15.3, remaining_amount: 140, total: 140, paid_amount: 0 },
        'Inbetalning kundfaktura',
      )
      expect(result.bankSek).toBe(230)
      expect(result.arSek).toBe(2142)
      expect(result.fxDiffSek).toBe(1912)
      expect(result.lines).toHaveLength(3)
      expect(result.lines[0]).toMatchObject({ account_number: '1930', debit_amount: 230 })
      expect(result.lines[1]).toMatchObject({ account_number: '1510', credit_amount: 2142 })
      expect(result.lines[2]).toMatchObject({
        account_number: '7960',
        debit_amount: 1912,
        line_description: 'Valutakursförlust',
      })
      const debit = result.lines.reduce((s, l) => s + l.debit_amount, 0)
      const credit = result.lines.reduce((s, l) => s + l.credit_amount, 0)
      expect(Math.round((debit - credit) * 100)).toBe(0)
    })

    it('exact match: no FX line', () => {
      // Invoice 100 USD @ 10.00 (1000 SEK booked); bank receives 1000 SEK
      const result = buildInvoicePaymentClearingLines(
        { amount: 1000, amount_sek: null, currency: 'SEK', exchange_rate: null },
        { currency: 'USD', exchange_rate: 10, remaining_amount: 100, total: 100, paid_amount: 0 },
        'desc',
      )
      expect(result.bankSek).toBe(1000)
      expect(result.arSek).toBe(1000)
      expect(result.fxDiffSek).toBe(0)
      expect(result.lines).toHaveLength(2)
    })

    it('sub-öre FX diff is suppressed (within floating-point tolerance)', () => {
      // 100.001 USD × 10 = 1000.01, but bookkeeping rounds at the line level
      const result = buildInvoicePaymentClearingLines(
        { amount: 1000, amount_sek: null, currency: 'SEK', exchange_rate: null },
        {
          currency: 'USD',
          exchange_rate: 10,
          remaining_amount: 100.0001,
          total: 100.0001,
          paid_amount: 0,
        },
        'desc',
      )
      expect(Math.abs(result.fxDiffSek)).toBeLessThanOrEqual(0.005)
      expect(result.lines).toHaveLength(2)
    })
  })

  describe('cross currency (USD invoice + USD tx)', () => {
    it('uses tx amount_sek for the bank-leg when populated', () => {
      // USD-denominated bank account paying a USD invoice — ingest converts
      // tx → SEK using the bank-date rate.
      const result = buildInvoicePaymentClearingLines(
        { amount: 100, amount_sek: 1100, currency: 'USD', exchange_rate: 11 },
        { currency: 'USD', exchange_rate: 10, remaining_amount: 100, total: 100, paid_amount: 0 },
        'desc',
      )
      // Same-currency path: bank-leg uses resolveSekAmount (which honours
      // amount_sek), AR-leg equals bank-leg, no FX diff line.
      expect(result.bankSek).toBe(1100)
      expect(result.arSek).toBe(1100)
      expect(result.fxDiffSek).toBe(0)
    })
  })
})
