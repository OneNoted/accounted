import { describe, expect, it } from 'vitest'
import { buildSwishQrPayload } from '@/lib/invoices/swish-qr'

// All expected payloads follow the Swish Type C 4-field spec:
//   C{swishNumber};{amount};{message};{editableMask}
// The previous (off-spec) 5-field form is intentionally retired here.
describe('buildSwishQrPayload', () => {
  it('builds a Type C payload with the four documented fields', () => {
    const payload = buildSwishQrPayload({
      swishNumber: '1231181189',
      amount: 1234.5,
      message: 'F-2026001',
    })
    expect(payload).toBe('C1231181189;1234.50;F-2026001;0')
  })

  it('strips spaces and hyphens from the Swish number', () => {
    const payload = buildSwishQrPayload({
      swishNumber: '123-118 11 89',
      amount: 100,
      message: 'ref',
    })
    expect(payload).toBe('C1231181189;100.00;ref;0')
  })

  it('rounds the amount to 2 decimals with dot separator', () => {
    const payload = buildSwishQrPayload({
      swishNumber: '1231181189',
      amount: 99.999,
      message: 'ref',
    })
    expect(payload).toBe('C1231181189;100.00;ref;0')
  })

  it('falls back to the legacy `reference` field when `message` is empty', () => {
    const payload = buildSwishQrPayload({
      swishNumber: '1231181189',
      amount: 50,
      message: '',
      reference: 'INV-42',
    })
    expect(payload).toBe('C1231181189;50.00;INV-42;0')
  })

  it('prefers `message` over `reference` when both are supplied', () => {
    const payload = buildSwishQrPayload({
      swishNumber: '1231181189',
      amount: 50,
      message: 'Hello',
      reference: 'INV-42',
    })
    // The legacy 5th `;{reference}` field is dropped — `message` wins, the
    // QR encodes a single text channel as Swish itself models it.
    expect(payload).toBe('C1231181189;50.00;Hello;0')
  })

  it('removes embedded semicolons from the message', () => {
    const payload = buildSwishQrPayload({
      swishNumber: '1231181189',
      amount: 50,
      message: 'a;b;c',
    })
    // Without the strip, this would inject two extra fields into the payload.
    expect(payload).toBe('C1231181189;50.00;abc;0')
  })

  it('encodes the editable mask when supplied (e.g. 2 = amount editable)', () => {
    const payload = buildSwishQrPayload({
      swishNumber: '1231181189',
      amount: 100,
      message: 'ref',
      editable: 2,
    })
    expect(payload).toBe('C1231181189;100.00;ref;2')
  })

  it('clamps the editable mask to the documented 3-bit range', () => {
    const payload = buildSwishQrPayload({
      swishNumber: '1231181189',
      amount: 100,
      message: 'ref',
      editable: 99,
    })
    // The Type C spec defines only bits 0 (phone), 1 (amount), 2 (message)
    // = combined max 7. A stray large mask is clamped to 7 so the QR shape
    // stays the documented 4 fields.
    expect(payload).toBe('C1231181189;100.00;ref;7')
  })

  it('floors a negative editable mask to zero', () => {
    const payload = buildSwishQrPayload({
      swishNumber: '1231181189',
      amount: 100,
      message: 'ref',
      editable: -5,
    })
    expect(payload).toBe('C1231181189;100.00;ref;0')
  })

  it('returns null when the swish number is empty or non-numeric', () => {
    expect(buildSwishQrPayload({ swishNumber: '', amount: 100, message: 'x' })).toBeNull()
    expect(buildSwishQrPayload({ swishNumber: 'abc', amount: 100, message: 'x' })).toBeNull()
  })

  it('returns null when the amount is zero, negative, or non-finite', () => {
    expect(buildSwishQrPayload({ swishNumber: '1231181189', amount: 0, message: 'x' })).toBeNull()
    expect(buildSwishQrPayload({ swishNumber: '1231181189', amount: -5, message: 'x' })).toBeNull()
    expect(buildSwishQrPayload({ swishNumber: '1231181189', amount: Number.NaN, message: 'x' })).toBeNull()
  })

  it('truncates a message that exceeds the 50-char Swish limit', () => {
    const longMessage = 'x'.repeat(120)
    const payload = buildSwishQrPayload({
      swishNumber: '1231181189',
      amount: 100,
      message: longMessage,
    })
    expect(payload).not.toBeNull()
    expect(payload!.split(';')[2]).toHaveLength(50)
  })
})
