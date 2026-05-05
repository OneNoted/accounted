import { describe, it, expect } from 'vitest'
import { guessCounterAccount } from '../lib/skattekonto-booking'

describe('guessCounterAccount', () => {
  it('routes "Inbetalning bokförd" to bank account 1930', () => {
    const guess = guessCounterAccount('Inbetalning bokförd 240412', 'aktiebolag')
    expect(guess?.account).toBe('1930')
  })

  it('routes refund-style descriptions to 1930', () => {
    expect(guessCounterAccount('Utbetalning 1234', 'aktiebolag')?.account).toBe('1930')
    expect(guessCounterAccount('Återbetalning av moms', 'aktiebolag')?.account).toBe('1930')
  })

  it('uses 2510 for AB preliminär skatt and 2012 for EF', () => {
    expect(
      guessCounterAccount('Debiterad preliminärskatt', 'aktiebolag')?.account,
    ).toBe('2510')
    expect(
      guessCounterAccount('Debiterad preliminärskatt', 'enskild_firma')?.account,
    ).toBe('2012')
  })

  it('routes employer payroll taxes to 2731', () => {
    expect(
      guessCounterAccount('Arbetsgivaravgifter januari', 'aktiebolag')?.account,
    ).toBe('2731')
    expect(
      guessCounterAccount('Sociala avgifter Q1', 'aktiebolag')?.account,
    ).toBe('2731')
  })

  it('routes deducted income tax to 2710', () => {
    expect(
      guessCounterAccount('Avdragen skatt anställda', 'aktiebolag')?.account,
    ).toBe('2710')
  })

  it('routes VAT settlements to 2650', () => {
    expect(
      guessCounterAccount('Mervärdesskatt mars', 'aktiebolag')?.account,
    ).toBe('2650')
    expect(guessCounterAccount('Moms Q1 2025', 'aktiebolag')?.account).toBe(
      '2650',
    )
  })

  it('routes interest to 8423/8313', () => {
    expect(
      guessCounterAccount('Kostnadsränta skattekonto', 'aktiebolag')?.account,
    ).toBe('8423')
    expect(
      guessCounterAccount('Intäktsränta skattekonto', 'aktiebolag')?.account,
    ).toBe('8313')
  })

  it('returns null when no keyword matches', () => {
    expect(
      guessCounterAccount('Något konstigt vi inte känner igen', 'aktiebolag'),
    ).toBeNull()
  })

  it('matches case-insensitively', () => {
    expect(
      guessCounterAccount('INBETALNING BOKFÖRD 240412', 'aktiebolag')?.account,
    ).toBe('1930')
  })
})
