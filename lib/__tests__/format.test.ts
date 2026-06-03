import { describe, it, expect } from 'vitest'
import { formatAmount, formatWholeKr, formatDateTime, formatDate } from '@/lib/utils'

// Intl sv-SE groups thousands with a non-breaking / narrow space (U+00A0 or
// U+202F depending on ICU version) and may render negatives with U+2212. Both
// vary across Node builds, so normalize them to plain ASCII before asserting —
// the test cares about format shape, not the exact whitespace codepoint.
const norm = (s: string) => s.replace(/\s/g, ' ').replace(/−/g, '-')

describe('formatAmount', () => {
  it('renders two decimals with sv-SE grouping and no currency symbol', () => {
    expect(norm(formatAmount(1234.5))).toBe('1 234,50')
    expect(norm(formatAmount(0))).toBe('0,00')
    expect(norm(formatAmount(-1234.56))).toBe('-1 234,56')
  })

  it('does not include "kr" or the SEK symbol', () => {
    expect(formatAmount(100)).not.toMatch(/kr|SEK/)
  })
})

describe('formatWholeKr', () => {
  it('rounds to whole krona with grouping, no decimals', () => {
    expect(norm(formatWholeKr(1234.56))).toBe('1 235')
    expect(norm(formatWholeKr(999.4))).toBe('999')
    expect(norm(formatWholeKr(0))).toBe('0')
  })
})

describe('formatDateTime', () => {
  it('renders ISO-ordered date and time', () => {
    expect(formatDateTime('2026-05-11T14:30:00')).toBe('2026-05-11 14:30')
  })

  it('accepts a Date instance', () => {
    expect(formatDateTime(new Date('2026-01-02T09:05:00'))).toBe('2026-01-02 09:05')
  })

  it('stays date-aligned with formatDate on the date portion', () => {
    const iso = '2026-12-31T23:59:00'
    expect(formatDateTime(iso).startsWith(formatDate(iso))).toBe(true)
  })
})
