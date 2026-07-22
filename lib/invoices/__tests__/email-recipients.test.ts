import { describe, expect, it } from 'vitest'
import {
  parseInvoiceRecipientText,
  resolveInvoiceEmailRecipients,
} from '@/lib/invoices/email-recipients'

describe('resolveInvoiceEmailRecipients', () => {
  it('uses the legacy copy only while the company list is unconfigured', () => {
    expect(resolveInvoiceEmailRecipients({
      to: 'customer@example.test',
      configuredCc: null,
      legacyCc: 'billing@example.test',
    }).cc).toEqual(['billing@example.test'])

    expect(resolveInvoiceEmailRecipients({
      to: 'customer@example.test',
      configuredCc: [],
      legacyCc: 'billing@example.test',
    }).cc).toEqual([])
  })

  it('merges fixed and per-send recipients with deterministic precedence', () => {
    expect(resolveInvoiceEmailRecipients({
      to: 'customer@example.test',
      configuredCc: ['finance@example.test', 'CUSTOMER@example.test'],
      configuredBcc: ['archive@example.test', 'finance@example.test'],
      additionalCc: ['handler@example.test', 'Finance@example.test'],
      additionalBcc: ['director@example.test', 'archive@example.test'],
    })).toEqual({
      to: ['customer@example.test'],
      cc: ['finance@example.test', 'handler@example.test'],
      bcc: ['archive@example.test', 'director@example.test'],
    })
  })

  it('trims and de-duplicates address text', () => {
    expect(parseInvoiceRecipientText(
      ' finance@example.test,\nDIRECTOR@example.test; finance@example.test ',
    )).toEqual(['finance@example.test', 'DIRECTOR@example.test'])
  })
})
