/**
 * Tests for lib/customers/protect-personal-number.ts.
 *
 * customers.personal_number holds AES-256-GCM ciphertext (migration
 * 20260726110000), and every customer read surface (list, detail, export)
 * funnels rows through maskStoredCustomerPersonalNumber / maskCustomerRow.
 * The load-bearing properties:
 *
 *   1. No caller ever receives the full personnummer or the raw ciphertext:
 *      only the '********-1234' display mask.
 *   2. The helpers NEVER throw. A single corrupted/foreign-key ciphertext row
 *      used to propagate ERR_CRYPTO out of maskCustomerRow, which would 500
 *      the entire GET /api/customers list for the company. A decrypt failure
 *      must degrade to a placeholder mask for that one row instead.
 */
import { describe, it, expect } from 'vitest'
import { encryptPersonnummer } from '@/lib/salary/personnummer'
import {
  encryptCustomerPersonalNumber,
  maskCustomerRow,
  maskStoredCustomerPersonalNumber,
  UNDECRYPTABLE_PERSONAL_NUMBER_MASK,
} from '../protect-personal-number'

// Synthetic personnummer, never a real one.
const PERSONAL_NUMBER = '19900101-1234'
const MASKED = '********-1234'

// Hex of the right shape for the ciphertext CHECK (76-255 lowercase hex) that
// is NOT a valid ciphertext: the GCM auth tag can never verify.
const GARBAGE_HEX = 'ab'.repeat(40)

describe('maskStoredCustomerPersonalNumber', () => {
  it('decrypts stored ciphertext and returns only the display mask', () => {
    const stored = encryptPersonnummer(PERSONAL_NUMBER)
    expect(maskStoredCustomerPersonalNumber(stored)).toBe(MASKED)
  })

  it('masks a legacy plaintext value without attempting a decrypt', () => {
    expect(maskStoredCustomerPersonalNumber('19900101-1234')).toBe(MASKED)
    expect(maskStoredCustomerPersonalNumber('900101-1234')).toBe(MASKED)
    expect(maskStoredCustomerPersonalNumber('9001011234')).toBe(MASKED)
  })

  it('returns null for empty values', () => {
    expect(maskStoredCustomerPersonalNumber(null)).toBeNull()
    expect(maskStoredCustomerPersonalNumber(undefined)).toBeNull()
    expect(maskStoredCustomerPersonalNumber('')).toBeNull()
  })

  it('returns the placeholder mask instead of throwing on undecryptable input', () => {
    // Garbage that passes the DB ciphertext CHECK shape but fails GCM auth.
    expect(maskStoredCustomerPersonalNumber(GARBAGE_HEX)).toBe(
      UNDECRYPTABLE_PERSONAL_NUMBER_MASK,
    )
    // Real ciphertext tampered with (auth tag mismatch).
    const stored = encryptPersonnummer(PERSONAL_NUMBER)
    const tampered = (stored[0] === 'a' ? 'b' : 'a') + stored.slice(1)
    expect(maskStoredCustomerPersonalNumber(tampered)).toBe(
      UNDECRYPTABLE_PERSONAL_NUMBER_MASK,
    )
    // Not even hex-shaped.
    expect(maskStoredCustomerPersonalNumber('not-a-ciphertext')).toBe(
      UNDECRYPTABLE_PERSONAL_NUMBER_MASK,
    )
  })

  it('placeholder mask carries no digits and cannot pass personnummer validation', () => {
    // It must never read as a real suffix, and a client that blindly PATCHes
    // it back must fail plaintext validation rather than store or clear
    // anything (null here would let a round-trip DELETE the stored value).
    expect(UNDECRYPTABLE_PERSONAL_NUMBER_MASK).not.toMatch(/\d/)
    expect(UNDECRYPTABLE_PERSONAL_NUMBER_MASK).not.toMatch(/^(\d{6}|\d{8})[-+]?\d{4}$/)
  })
})

describe('maskCustomerRow', () => {
  it('replaces the stored value with the mask and leaves other fields alone', () => {
    const stored = encryptPersonnummer(PERSONAL_NUMBER)
    const row = { id: 'c1', name: 'Anna Andersson', personal_number: stored }
    expect(maskCustomerRow(row)).toEqual({
      id: 'c1',
      name: 'Anna Andersson',
      personal_number: MASKED,
    })
  })

  it('never throws on a corrupt row: the list endpoint must stay 200', () => {
    // GET /api/customers maps every row through maskCustomerRow; one bad row
    // must not take down the whole roster.
    const row = { id: 'c1', name: 'Anna Andersson', personal_number: GARBAGE_HEX }
    expect(() => maskCustomerRow(row)).not.toThrow()
    expect(maskCustomerRow(row).personal_number).toBe(UNDECRYPTABLE_PERSONAL_NUMBER_MASK)
  })

  it('passes through rows without a personal number', () => {
    const withNull: { id: string; personal_number: string | null } = {
      id: 'c1',
      personal_number: null,
    }
    const withoutKey: { id: string; personal_number?: string | null } = { id: 'c1' }
    expect(maskCustomerRow(withNull).personal_number).toBeNull()
    expect(maskCustomerRow(withoutKey).personal_number).toBeNull()
  })
})

describe('encryptCustomerPersonalNumber', () => {
  it('round-trips through the mask helper', () => {
    const stored = encryptCustomerPersonalNumber(PERSONAL_NUMBER)
    expect(stored).not.toBeNull()
    expect(stored).not.toBe(PERSONAL_NUMBER)
    expect(maskStoredCustomerPersonalNumber(stored)).toBe(MASKED)
  })

  it('maps empty input to null', () => {
    expect(encryptCustomerPersonalNumber(null)).toBeNull()
    expect(encryptCustomerPersonalNumber(undefined)).toBeNull()
    expect(encryptCustomerPersonalNumber('')).toBeNull()
  })
})
