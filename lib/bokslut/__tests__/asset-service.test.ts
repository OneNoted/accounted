import { describe, it, expect } from 'vitest'
import { DEFAULT_ACCOUNTS_BY_CATEGORY } from '../assets/asset-service'

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
