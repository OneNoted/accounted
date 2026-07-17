import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  proposeAvsattning,
  proposeAteforing,
  listExistingPeriodiseringsfonder,
  getPeriodiseringsfondCohortAccount,
  PFOND_AB_RATE,
  PFOND_MAX_HOLD_YEARS,
  type ExistingFond,
} from '../reserves/periodiseringsfond-service'
import { fetchEntryLines } from '@/lib/bookkeeping/entry-lines'

vi.mock('@/lib/bookkeeping/entry-lines', () => ({
  fetchEntryLines: vi.fn(),
}))

describe('getPeriodiseringsfondCohortAccount', () => {
  it('maps fiscal year to BAS 212X account', () => {
    expect(getPeriodiseringsfondCohortAccount(2020)).toBe('2120')
    expect(getPeriodiseringsfondCohortAccount(2025)).toBe('2125')
    expect(getPeriodiseringsfondCohortAccount(2026)).toBe('2126')
    expect(getPeriodiseringsfondCohortAccount(2027)).toBe('2127')
  })

  it('returns 2129 for 2019 per BAS collision rule', () => {
    expect(getPeriodiseringsfondCohortAccount(2019)).toBe('2129')
  })
})

describe('proposeAvsattning', () => {
  it('caps avsättning at 25% of base', () => {
    const result = proposeAvsattning({
      skattemassigtResultatBeforeAvsattning: 400_000,
      desiredAmount: 200_000, // user asks for 50%: should be capped
      fiscalYear: 2025,
    })
    expect(result).not.toBeNull()
    expect(result!.amount).toBe(100_000) // 25% of 400_000
    expect(result!.warnings).toHaveLength(1)
    expect(result!.warnings[0]).toContain('25 %')
    expect(result!.lines[0].account_number).toBe('8811')
    expect(result!.lines[1].account_number).toBe('2125')
  })

  it('defaults to maximum when desiredAmount is omitted', () => {
    const result = proposeAvsattning({
      skattemassigtResultatBeforeAvsattning: 400_000,
      fiscalYear: 2025,
    })
    expect(result!.amount).toBe(100_000)
    expect(result!.warnings).toHaveLength(0)
  })

  it('honors a smaller desiredAmount', () => {
    const result = proposeAvsattning({
      skattemassigtResultatBeforeAvsattning: 400_000,
      desiredAmount: 30_000,
      fiscalYear: 2025,
    })
    expect(result!.amount).toBe(30_000)
    expect(result!.warnings).toHaveLength(0)
  })

  it('returns null when base is negative (loss year)', () => {
    expect(
      proposeAvsattning({
        skattemassigtResultatBeforeAvsattning: -100_000,
        fiscalYear: 2025,
      }),
    ).toBeNull()
  })

  it('returns null when desired is zero', () => {
    expect(
      proposeAvsattning({
        skattemassigtResultatBeforeAvsattning: 400_000,
        desiredAmount: 0,
        fiscalYear: 2025,
      }),
    ).toBeNull()
  })

  it('emits balanced lines (debit 8811 = credit 21XX)', () => {
    const result = proposeAvsattning({
      skattemassigtResultatBeforeAvsattning: 400_000,
      fiscalYear: 2026,
    })
    expect(result!.lines).toHaveLength(2)
    const totalDebit = result!.lines.reduce((s, l) => s + l.debit_amount, 0)
    const totalCredit = result!.lines.reduce((s, l) => s + l.credit_amount, 0)
    expect(totalDebit).toBe(totalCredit)
    expect(result!.lines[1].account_number).toBe('2126')
  })

  it('uses fiscal year for cohort account number', () => {
    const result = proposeAvsattning({
      skattemassigtResultatBeforeAvsattning: 100_000,
      fiscalYear: 2027,
    })
    expect(result!.lines[1].account_number).toBe('2127')
  })
})

describe('proposeAteforing', () => {
  it('forces full reversal of 6+ year old fonder and marks them required', () => {
    const fonder: ExistingFond[] = [
      {
        account_number: '2120',
        cohort_year: 2020,
        balance: 50_000,
        must_return_this_year: true,
      },
    ]
    const result = proposeAteforing(fonder, { schablonintaktRate: 0.03 })
    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0].amount).toBe(50_000)
    expect(result.proposals[0].required).toBe(true)
    expect(result.proposals[0].warnings[0]).toContain('6-årsgränsen')
    // 50_000 × 0.03 = 1500
    expect(result.schablonintaktAmount).toBe(1_500)
  })

  it('skips non-mandatory fonder when no return amount requested', () => {
    const fonder: ExistingFond[] = [
      {
        account_number: '2122',
        cohort_year: 2022,
        balance: 100_000,
        must_return_this_year: false,
      },
    ]
    const result = proposeAteforing(fonder, { schablonintaktRate: 0.03 })
    expect(result.proposals).toHaveLength(0)
    // Schablonintäkt is computed regardless of return decision
    expect(result.schablonintaktAmount).toBe(3_000)
  })

  it('returns the requested optional amount when user opts in', () => {
    const fonder: ExistingFond[] = [
      {
        account_number: '2123',
        cohort_year: 2023,
        balance: 80_000,
        must_return_this_year: false,
      },
    ]
    const result = proposeAteforing(fonder, {
      returns: { '2123': 50_000 },
      schablonintaktRate: 0.03,
    })
    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0].amount).toBe(50_000)
    expect(result.proposals[0].required).toBeFalsy()
  })

  it('caps optional returns to the actual balance', () => {
    const fonder: ExistingFond[] = [
      {
        account_number: '2124',
        cohort_year: 2024,
        balance: 30_000,
        must_return_this_year: false,
      },
    ]
    const result = proposeAteforing(fonder, {
      returns: { '2124': 100_000 },
      schablonintaktRate: 0.03,
    })
    expect(result.proposals[0].amount).toBe(30_000) // capped to balance
  })

  it('emits balanced lines (debit 21XX = credit 8819)', () => {
    const fonder: ExistingFond[] = [
      {
        account_number: '2120',
        cohort_year: 2020,
        balance: 50_000,
        must_return_this_year: true,
      },
    ]
    const result = proposeAteforing(fonder, { schablonintaktRate: 0.03 })
    const lines = result.proposals[0].lines
    expect(lines).toHaveLength(2)
    expect(lines[0].account_number).toBe('2120')
    expect(lines[0].debit_amount).toBe(50_000)
    expect(lines[1].account_number).toBe('8819')
    expect(lines[1].credit_amount).toBe(50_000)
  })

  it('exposes constants used by callers', () => {
    expect(PFOND_AB_RATE).toBe(0.25)
    expect(PFOND_MAX_HOLD_YEARS).toBe(6)
  })
})

describe('listExistingPeriodiseringsfonder', () => {
  const supabase = {} as SupabaseClient
  const mockFetchEntryLines = vi.mocked(fetchEntryLines)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  /** Chainable query spy that records every filter call in order. */
  function makeChainableQuery() {
    const calls: Array<[string, ...unknown[]]> = []
    const q: Record<string, unknown> = {}
    for (const m of ['eq', 'gte', 'lte'] as const) {
      q[m] = vi.fn((...args: unknown[]) => {
        calls.push([m, ...args])
        return q
      })
    }
    return { q, calls }
  }

  it('calls fetchEntryLines with line columns only and no entry reattachment', async () => {
    mockFetchEntryLines.mockResolvedValue([])

    const result = await listExistingPeriodiseringsfonder(supabase, 'company-1', '2025-12-31')

    expect(result).toEqual([])
    expect(mockFetchEntryLines).toHaveBeenCalledTimes(1)
    expect(mockFetchEntryLines).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase,
        lineColumns: 'account_number, debit_amount, credit_amount',
        attachEntriesAs: null,
      }),
    )
  })

  it('scopes entries to company/posted/closing date and lines to the 21xx range', async () => {
    mockFetchEntryLines.mockResolvedValue([])

    await listExistingPeriodiseringsfonder(supabase, 'company-1', '2025-12-31')

    const options = mockFetchEntryLines.mock.calls[0][0]

    const entries = makeChainableQuery()
    options.filterEntries(entries.q)
    expect(entries.calls).toEqual([
      ['eq', 'company_id', 'company-1'],
      ['eq', 'status', 'posted'],
      ['lte', 'entry_date', '2025-12-31'],
    ])

    expect(options.filterLines).toBeDefined()
    const lines = makeChainableQuery()
    options.filterLines?.(lines.q)
    expect(lines.calls).toEqual([
      ['gte', 'account_number', '2110'],
      ['lte', 'account_number', '2199'],
    ])
  })

  it('sums per-account balances (credit minus debit) and maps cohort years', async () => {
    mockFetchEntryLines.mockResolvedValue([
      // 2125 across two rows: 100_000 credit, 20_000 debit -> 80_000
      { account_number: '2125', debit_amount: 0, credit_amount: 100_000 },
      { account_number: '2125', debit_amount: 20_000, credit_amount: 0 },
      // Numeric strings and nulls coerce like the embed rows did
      { account_number: '2120', debit_amount: null, credit_amount: '50000' },
      // 2129 is the 2019 collision account per the BAS 2020 seed
      { account_number: '2129', debit_amount: 0, credit_amount: 10_000 },
      // 2110 is a grouping account with no cohort: skipped
      { account_number: '2110', debit_amount: 0, credit_amount: 5_000 },
    ])

    const result = await listExistingPeriodiseringsfonder(supabase, 'company-1', '2026-12-31')

    // Sorted by cohort_year ascending
    expect(result).toEqual([
      {
        account_number: '2129',
        cohort_year: 2019,
        balance: 10_000,
        must_return_this_year: true, // 2019 + 6 = 2025 <= 2026
      },
      {
        account_number: '2120',
        cohort_year: 2020,
        balance: 50_000,
        must_return_this_year: true, // 2020 + 6 = 2026 <= 2026
      },
      {
        account_number: '2125',
        cohort_year: 2025,
        balance: 80_000,
        must_return_this_year: false, // 2025 + 6 = 2031 > 2026
      },
    ])
  })

  it('drops near-zero balances below the 0.005 threshold', async () => {
    mockFetchEntryLines.mockResolvedValue([
      { account_number: '2123', debit_amount: 1_000, credit_amount: 1_000.004 },
      { account_number: '2124', debit_amount: 0, credit_amount: 30_000 },
    ])

    const result = await listExistingPeriodiseringsfonder(supabase, 'company-1', '2026-12-31')

    expect(result).toHaveLength(1)
    expect(result[0].account_number).toBe('2124')
  })

  it('wraps helper failures in the periodiseringsfond error contract', async () => {
    mockFetchEntryLines.mockRejectedValue(new Error('boom'))

    await expect(
      listExistingPeriodiseringsfonder(supabase, 'company-1', '2025-12-31'),
    ).rejects.toThrow('Failed to fetch periodiseringsfond balances: boom')
  })

  it('rejects an unparseable closing date before querying', async () => {
    await expect(
      listExistingPeriodiseringsfonder(supabase, 'company-1', 'not-a-date'),
    ).rejects.toThrow('Invalid closing date: not-a-date')
    expect(mockFetchEntryLines).not.toHaveBeenCalled()
  })
})
