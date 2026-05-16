import { describe, it, expect, vi } from 'vitest'
import { DEFAULT_ACCOUNTS_BY_CATEGORY, disposeAsset } from '../assets/asset-service'
import type { Asset } from '@/types'

vi.mock('@/lib/bookkeeping/engine', () => ({
  createJournalEntry: vi.fn().mockResolvedValue({
    id: 'entry-1',
    voucher_series: 'A',
    voucher_number: 1,
  }),
}))

describe('DEFAULT_ACCOUNTS_BY_CATEGORY', () => {
  it('maps every AssetCategory to a BAS-aligned account triple', () => {
    const expected = {
      immaterial: { asset: '1010', accumulated: '1019', expense: '7810' },
      building: { asset: '1110', accumulated: '1119', expense: '7821' },
      land_improvement: { asset: '1150', accumulated: '1159', expense: '7824' },
      machinery: { asset: '1210', accumulated: '1219', expense: '7831' },
      equipment: { asset: '1220', accumulated: '1229', expense: '7832' },
      vehicle: { asset: '1240', accumulated: '1249', expense: '7834' },
      computer: { asset: '1250', accumulated: '1259', expense: '7833' },
      other_tangible: { asset: '1280', accumulated: '1289', expense: '7839' },
    } as const
    expect(DEFAULT_ACCOUNTS_BY_CATEGORY).toEqual(expected)
  })

  it('uses the convention that accumulated = asset + 9 for tangible categories', () => {
    const tangible = ['machinery', 'equipment', 'vehicle', 'computer', 'other_tangible'] as const
    for (const cat of tangible) {
      const triple = DEFAULT_ACCOUNTS_BY_CATEGORY[cat]
      const assetNum = parseInt(triple.asset, 10)
      const accumulatedNum = parseInt(triple.accumulated, 10)
      expect(accumulatedNum).toBe(assetNum + 9)
    }
  })

  it('expense accounts are in the 78xx range (planenliga avskrivningar)', () => {
    for (const cat of Object.keys(DEFAULT_ACCOUNTS_BY_CATEGORY) as Array<
      keyof typeof DEFAULT_ACCOUNTS_BY_CATEGORY
    >) {
      const expense = DEFAULT_ACCOUNTS_BY_CATEGORY[cat].expense
      expect(expense).toMatch(/^78\d{2}$/)
    }
  })
})

describe('disposeAsset — gain/loss account selection', () => {
  function makeAsset(overrides: Partial<Asset> = {}): Asset {
    return {
      id: 'asset-1',
      user_id: 'u',
      company_id: 'co',
      name: 'Test',
      category: 'equipment',
      acquisition_date: '2023-01-01',
      acquisition_cost: 100_000,
      salvage_value: 0,
      useful_life_months: 60,
      depreciation_method: 'linear',
      bas_asset_account: '1220',
      bas_accumulated_account: '1229',
      bas_expense_account: '7832',
      disposed_at: null,
      disposed_proceeds: null,
      k3_components: null,
      notes: null,
      created_at: '2023-01-01T00:00:00Z',
      updated_at: '2023-01-01T00:00:00Z',
      ...overrides,
    }
  }

  function makeSupabaseForDispose(asset: Asset) {
    // Two from() calls happen inside disposeAsset: getAsset (single) and the
    // update (returning the disposed row). The captured lines from the
    // engine mock are what we assert on.
    const builders = {
      getBuilder: {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: asset, error: null }),
      },
      updateBuilder: {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { ...asset, disposed_at: '2025-06-30', disposed_proceeds: 50_000 },
          error: null,
        }),
      },
    }
    let calls = 0
    const supabase = {
      from: vi.fn(() => {
        calls++
        return calls === 1 ? builders.getBuilder : builders.updateBuilder
      }),
    }
    return { supabase, builders } as const
  }

  it('uses 3973 / 7973 for tangible asset disposal (equipment)', async () => {
    const { createJournalEntry } = await import('@/lib/bookkeeping/engine')
    vi.mocked(createJournalEntry).mockClear()
    const asset = makeAsset({ category: 'equipment' })
    const { supabase } = makeSupabaseForDispose(asset)

    await disposeAsset(
      supabase as unknown as Parameters<typeof disposeAsset>[0],
      'co',
      'u',
      'asset-1',
      {
        disposed_at: '2025-06-30',
        disposed_proceeds: 80_000,
        fiscal_period_id: 'fp',
        accumulated_depreciation: 40_000, // NBV = 60_000, proceeds 80_000 → gain 20_000
      },
    )

    const call = vi.mocked(createJournalEntry).mock.calls[0]
    expect(call).toBeDefined()
    const lines = (call![3] as { lines: { account_number: string }[] }).lines
    expect(lines.find((l) => l.account_number === '3973')).toBeDefined()
    expect(lines.find((l) => l.account_number === '3013')).toBeUndefined()
  })

  it('uses 3013 / 7813 for immaterial asset disposal', async () => {
    const { createJournalEntry } = await import('@/lib/bookkeeping/engine')
    vi.mocked(createJournalEntry).mockClear()
    const asset = makeAsset({
      category: 'immaterial',
      bas_asset_account: '1010',
      bas_accumulated_account: '1019',
      bas_expense_account: '7810',
    })
    const { supabase } = makeSupabaseForDispose(asset)

    await disposeAsset(
      supabase as unknown as Parameters<typeof disposeAsset>[0],
      'co',
      'u',
      'asset-1',
      {
        disposed_at: '2025-06-30',
        disposed_proceeds: 10_000,
        fiscal_period_id: 'fp',
        accumulated_depreciation: 50_000, // NBV = 50_000, proceeds 10_000 → loss 40_000
      },
    )

    const call = vi.mocked(createJournalEntry).mock.calls[0]
    expect(call).toBeDefined()
    const lines = (call![3] as { lines: { account_number: string }[] }).lines
    expect(lines.find((l) => l.account_number === '7813')).toBeDefined()
    expect(lines.find((l) => l.account_number === '7973')).toBeUndefined()
  })
})
