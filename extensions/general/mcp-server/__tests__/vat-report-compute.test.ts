/**
 * Focused tests for computeVatReport — the shared VAT computation used by
 * gnubok_get_vat_report and gnubok_vat_review_widget. These exist because the
 * tools/call integration tests can't reach into the rutor math; this file
 * mocks Supabase to feed synthetic journal entry lines and asserts the rutor
 * shape, ruta48 inclusion of 2647, ruta49 formula, and the one-sided
 * reverse-charge warning.
 */
import { describe, it, expect } from 'vitest'
import { computeVatReport } from '../server'

interface MockLine {
  account_number: string
  debit_amount: number
  credit_amount: number
}

function mockSupabaseWithLines(lines: MockLine[]) {
  // Build a chain that matches the call path in computeVatReport:
  //   .from('journal_entry_lines').select(...).eq(...).in(...).gte(...).lte(...)
  // The terminal `.lte()` returns `{ data, error }`.
  const terminal = { data: lines, error: null }
  const chain: Record<string, () => unknown> = {}
  // Terminal awaitable: vitest awaits the last call; .lte() returns the data.
  chain.lte = () => terminal
  chain.gte = () => chain
  chain.in = () => chain
  chain.eq = () => chain
  chain.select = () => chain
  chain.from = () => chain
  return { from: chain.from } as never
}

describe('computeVatReport', () => {
  it('aggregates 2611 → ruta10, 2641 → ruta48, includes 2647 → ruta48', async () => {
    const lines: MockLine[] = [
      // Domestic 25% sale: 1000 + 250 VAT
      { account_number: '3001', debit_amount: 0, credit_amount: 1000 },
      { account_number: '2611', debit_amount: 0, credit_amount: 250 },
      // Domestic input VAT 25%
      { account_number: '2641', debit_amount: 100, credit_amount: 0 },
      // Domestic reverse-charge input VAT (2647)
      { account_number: '2647', debit_amount: 50, credit_amount: 0 },
    ]

    const result = await computeVatReport(
      { period_type: 'monthly', year: 2026, period: 1 },
      'company-1',
      mockSupabaseWithLines(lines)
    )

    expect(result.rutor.ruta05).toBe(1000)
    expect(result.rutor.ruta10).toBe(250)
    expect(result.rutor.ruta11).toBe(0)
    expect(result.rutor.ruta12).toBe(0)
    // Ruta 48 = 2641 (100) + 2647 (50) = 150
    expect(result.rutor.ruta48).toBe(150)
    // Ruta 49 = 250 - 150 = 100 (positive = pay)
    expect(result.rutor.ruta49).toBe(100)
    expect(result.summary).toContain('Moms att betala')
    expect(result.warnings).toEqual([])
  })

  it('aggregates reverse-charge output VAT into ruta30/31/32 and the ruta49 formula', async () => {
    const lines: MockLine[] = [
      // Reverse-charge purchase 25% — both sides booked correctly
      { account_number: '2614', debit_amount: 0, credit_amount: 500 },  // ruta30
      { account_number: '2645', debit_amount: 500, credit_amount: 0 },  // matching input → ruta48
      // Reverse-charge purchase 6%
      { account_number: '2634', debit_amount: 0, credit_amount: 30 },   // ruta32
      { account_number: '2645', debit_amount: 30, credit_amount: 0 },
    ]

    const result = await computeVatReport(
      { period_type: 'quarterly', year: 2026, period: 1 },
      'company-1',
      mockSupabaseWithLines(lines)
    )

    expect(result.rutor.ruta30).toBe(500)
    expect(result.rutor.ruta31).toBe(0)
    expect(result.rutor.ruta32).toBe(30)
    expect(result.rutor.ruta48).toBe(530) // 500 + 30 from 2645
    // Ruta 49 = (10+11+12+30+31+32) - 48 = 0+0+0+500+0+30 - 530 = 0
    expect(result.rutor.ruta49).toBe(0)
    expect(result.warnings).toEqual([])
  })

  it('emits a one-sided-reverse-charge warning when 2614 is booked without 2645', async () => {
    const lines: MockLine[] = [
      // Output booked but matching input missing (the most common reverse-charge error)
      { account_number: '2614', debit_amount: 0, credit_amount: 500 },
      // 2645 not present
    ]

    const result = await computeVatReport(
      { period_type: 'monthly', year: 2026, period: 1 },
      'company-1',
      mockSupabaseWithLines(lines)
    )

    expect(result.rutor.ruta30).toBe(500)
    expect(result.rutor.ruta48).toBe(0)
    // Without the matching input, ruta49 is inflated by 500 — the warning surfaces this.
    expect(result.rutor.ruta49).toBe(500)
    expect(result.warnings.length).toBe(1)
    expect(result.warnings[0]).toMatch(/Omvänd betalningsskyldighet/)
    expect(result.warnings[0]).toMatch(/2645/)
  })

  it('expanded ruta05 includes alternative BAS revenue accounts (3041/3051/3071)', async () => {
    const lines: MockLine[] = [
      { account_number: '3001', debit_amount: 0, credit_amount: 1000 },
      { account_number: '3041', debit_amount: 0, credit_amount: 500 },  // service 25%
      { account_number: '3051', debit_amount: 0, credit_amount: 300 },  // goods 25%
      { account_number: '3071', debit_amount: 0, credit_amount: 200 },  // other domestic
    ]

    const result = await computeVatReport(
      { period_type: 'yearly', year: 2026, period: 1 },
      'company-1',
      mockSupabaseWithLines(lines)
    )

    expect(result.rutor.ruta05).toBe(2000)
  })

  it('refund summary string when ruta49 is negative', async () => {
    const lines: MockLine[] = [
      { account_number: '2641', debit_amount: 100, credit_amount: 0 },
      // No output VAT; pure refund position.
    ]

    const result = await computeVatReport(
      { period_type: 'monthly', year: 2026, period: 1 },
      'company-1',
      mockSupabaseWithLines(lines)
    )

    expect(result.rutor.ruta49).toBe(-100)
    expect(result.summary).toContain('Moms att få tillbaka')
  })

  it('rejects bad period_type / out-of-range period / out-of-range year', async () => {
    const supabase = mockSupabaseWithLines([])

    await expect(
      computeVatReport({ period_type: 'weekly', year: 2026, period: 1 }, 'c', supabase)
    ).rejects.toThrow(/period_type/)

    await expect(
      computeVatReport({ period_type: 'monthly', year: 2026, period: 13 }, 'c', supabase)
    ).rejects.toThrow(/period must be 1–12/)

    await expect(
      computeVatReport({ period_type: 'quarterly', year: 2026, period: 5 }, 'c', supabase)
    ).rejects.toThrow(/period must be 1–4/)

    await expect(
      computeVatReport({ period_type: 'monthly', year: 1900, period: 1 }, 'c', supabase)
    ).rejects.toThrow(/year must be between/)
  })
})
