import { describe, it, expect } from 'vitest'
import { monthLockStates } from '../month-lock'

describe('monthLockStates', () => {
  it('returns the trailing months oldest-first, ending with the current month', () => {
    const states = monthLockStates(null, '2026-07-17', 3)
    expect(states.map((s) => s.month)).toEqual(['2026-05', '2026-06', '2026-07'])
    expect(states.map((s) => s.isCurrent)).toEqual([false, false, true])
  })

  it('locks exactly the months whose last day is on or before lockedThrough', () => {
    const states = monthLockStates('2026-05-31', '2026-07-17', 4)
    expect(states.map((s) => `${s.month}:${s.locked}`)).toEqual([
      '2026-04:true',
      '2026-05:true',
      '2026-06:false',
      '2026-07:false',
    ])
  })

  it('a mid-month lock date does not lock that month', () => {
    const states = monthLockStates('2026-06-15', '2026-07-17', 3)
    expect(states.find((s) => s.month === '2026-06')?.locked).toBe(false)
    expect(states.find((s) => s.month === '2026-05')?.locked).toBe(true)
  })

  it('null lockedThrough locks nothing', () => {
    expect(monthLockStates(null, '2026-07-17').every((s) => !s.locked)).toBe(true)
  })

  it('crosses year boundaries correctly', () => {
    const states = monthLockStates('2025-12-31', '2026-02-10', 4)
    expect(states.map((s) => `${s.month}:${s.locked}`)).toEqual([
      '2025-11:true',
      '2025-12:true',
      '2026-01:false',
      '2026-02:false',
    ])
  })

  it('defaults to 12 months', () => {
    expect(monthLockStates(null, '2026-07-01')).toHaveLength(12)
    expect(monthLockStates(null, '2026-07-01')[0].month).toBe('2025-08')
  })
})
