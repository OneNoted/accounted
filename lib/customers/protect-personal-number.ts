import { createLogger } from '@/lib/logger'
import { decryptPersonnummer, encryptPersonnummer } from '@/lib/salary/personnummer'
import { maskCustomerPersonalNumber } from '@/lib/customers/mask-personal-number'

const log = createLogger('customers/protect-personal-number')

/**
 * Placeholder returned when a stored personal_number cannot be decrypted
 * (corrupted ciphertext, a value written under a different
 * PERSONNUMMER_ENCRYPTION_KEY, or pre-encryption garbage on a self-hosted DB).
 *
 * Shape rationale: it must be recognizably a mask (never mistakable for a real
 * suffix, so no fabricated digits) and it must NOT be null. Returning null
 * would render as "no personnummer", and worse: a client that reads the
 * customer and PATCHes the whole object back would send personal_number: null,
 * which the update route treats as "clear the column", destroying the stored
 * ciphertext. The placeholder fails the route's plaintext validation instead,
 * so a blind round-trip errors loudly rather than deleting data.
 */
export const UNDECRYPTABLE_PERSONAL_NUMBER_MASK = '********-????'

export function encryptCustomerPersonalNumber(value: string | null | undefined): string | null {
  return value ? encryptPersonnummer(value) : null
}

/**
 * Decrypt-and-mask a stored customers.personal_number for display.
 *
 * Never throws: every customer read surface (list, detail, export) maps rows
 * through this, so a single row with an undecryptable value must not 500 the
 * whole endpoint. On decrypt failure it logs at error level (the value itself
 * is never logged) and returns UNDECRYPTABLE_PERSONAL_NUMBER_MASK.
 */
export function maskStoredCustomerPersonalNumber(value: string | null | undefined): string | null {
  if (!value) return null
  if (/^(\d{6}|\d{8})[-+]?\d{4}$/.test(value)) {
    return maskCustomerPersonalNumber(value)
  }
  try {
    return maskCustomerPersonalNumber(decryptPersonnummer(value))
  } catch (err) {
    log.error('customer personal_number decrypt failed; returning placeholder mask', {
      reason: err instanceof Error ? err.message : String(err),
    })
    return UNDECRYPTABLE_PERSONAL_NUMBER_MASK
  }
}

export function maskCustomerRow<T extends { personal_number?: string | null }>(row: T): T {
  return {
    ...row,
    personal_number: maskStoredCustomerPersonalNumber(row.personal_number),
  }
}
