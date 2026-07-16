import { describe, it, expect } from 'vitest'
import { booksInvoicesOnIssue } from '../booking-mode'

describe('booksInvoicesOnIssue (#967)', () => {
  it('books at issue for accrual companies by default', () => {
    expect(booksInvoicesOnIssue({ accounting_method: 'accrual' })).toBe(true)
    expect(booksInvoicesOnIssue({ accounting_method: 'accrual', defer_invoice_booking: false })).toBe(true)
  })

  it('defers when defer_invoice_booking is on', () => {
    expect(booksInvoicesOnIssue({ accounting_method: 'accrual', defer_invoice_booking: true })).toBe(false)
  })

  it('never books at issue under the cash method, regardless of the flag', () => {
    expect(booksInvoicesOnIssue({ accounting_method: 'cash' })).toBe(false)
    expect(booksInvoicesOnIssue({ accounting_method: 'cash', defer_invoice_booking: true })).toBe(false)
  })

  it('treats missing settings as the historical accrual default', () => {
    expect(booksInvoicesOnIssue(null)).toBe(true)
    expect(booksInvoicesOnIssue(undefined)).toBe(true)
    expect(booksInvoicesOnIssue({})).toBe(true)
  })
})
