/**
 * The duplicate-guard refusal message in `categorizeMatchedTransaction`.
 *
 * This message is what the agent (MCP categorize flow) and the pending-operation
 * executors surface when the booking-time duplicate guard fires, and it appends
 * "kr" verbatim to a number. The contract under test: that number is ALWAYS the
 * candidate's SEK figure from the detector (`dup.amount`), never the raw foreign
 * `transactions.amount`, and when the detector could not establish a SEK figure
 * at all (`dup.amount === null`) the message states the amount in the sibling's
 * own currency and says the kronor value cannot be determined, rather than
 * fabricating one.
 *
 * Companion to lib/transactions/__tests__/booking-duplicate-detection.test.ts,
 * which pins the producer side of the same contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDetectDup = vi.fn()
const mockCreateJE = vi.fn()
const mockMapping = vi.fn()
const mockHasLiveLink = vi.fn()

vi.mock('@/lib/transactions/booking-duplicate-detection', () => ({
  detectBookingDuplicate: (...args: unknown[]) => mockDetectDup(...args),
}))
vi.mock('@/lib/bookkeeping/transaction-entries', () => ({
  createTransactionJournalEntry: (...args: unknown[]) => mockCreateJE(...args),
}))
vi.mock('@/lib/bookkeeping/category-mapping', () => ({
  buildMappingResultFromCategory: (...args: unknown[]) => mockMapping(...args),
}))
vi.mock('@/lib/bookkeeping/counterparty-templates', () => ({
  upsertCounterpartyTemplate: vi.fn(),
}))
vi.mock('@/lib/core/documents/document-service', () => ({
  linkToJournalEntry: vi.fn(),
}))
vi.mock('@/lib/transactions/link-journal-entry', () => ({
  hasLiveJournalEntryLink: (...args: unknown[]) => mockHasLiveLink(...args),
}))

import { categorizeMatchedTransaction } from '../categorize-core'
import { eventBus } from '@/lib/events/bus'

/** Queue-based supabase mock: each `from()` consumes the next queued result. */
function queuedSupabase(results: Array<{ data?: unknown; error?: unknown }>) {
  const queue = [...results]
  const from = vi.fn(() => {
    const raw = queue.shift() ?? { data: null, error: null }
    const result = { data: raw.data ?? null, error: raw.error ?? null }
    const chain: object = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result)
          return () => chain
        },
      },
    )
    return chain
  })
  return { from } as never
}

/** A `transactions` row as select('*') returns it. Synthetic fixture. */
const txRow = (over: Record<string, unknown> = {}) => ({
  id: 'tx-1',
  date: '2026-06-01',
  amount: -1616,
  currency: 'SEK',
  amount_sek: null,
  exchange_rate: null,
  description: 'PROGRAMVARA AB',
  cash_account_id: null,
  journal_entry_id: null,
  ...over,
})

/** A detector candidate with the invariant defaults (SEK, verified). */
const candidate = (over: Record<string, unknown> = {}) => ({
  transaction_id: 'sib-1',
  journal_entry_id: 'je-1',
  voucher_label: 'A142',
  entry_date: '2026-06-01',
  description: 'PROGRAMVARA AB',
  amount: -1616,
  account_number: null,
  currency: null,
  amount_in_currency: null,
  amount_verified: true,
  unverified_reason: null,
  ...over,
})

const OPTS = { category: 'expense_software' as const }

beforeEach(() => {
  vi.clearAllMocks()
  eventBus.clear()
  mockHasLiveLink.mockResolvedValue(false)
})

describe('categorizeMatchedTransaction duplicate refusal message', () => {
  it('states a verified SEK twin as an absolute kr amount', async () => {
    mockDetectDup.mockResolvedValue(candidate())
    const supabase = queuedSupabase([{ data: txRow() }])

    const result = await categorizeMatchedTransaction(supabase, 'u1', 'c1', 'tx-1', OPTS)

    expect(result.status).toBe(409)
    expect(result.error).toContain('verifikat A142')
    expect(result.error).toContain('bokför redan 1616 kr')
    expect(result.error).not.toContain('-1616')
  })

  it('prints the SIBLING SEK figure for a verified FX twin, never the raw EUR number as kr', async () => {
    // A 1 000 EUR sibling whose own booking states 11 500 kr. The message must
    // carry 11500 kr; "1000 kr" would be the original bug (foreign figure with
    // "kr" appended) in text form.
    mockDetectDup.mockResolvedValue(
      candidate({ amount: -11500, currency: 'EUR', amount_in_currency: -1000 }),
    )
    const supabase = queuedSupabase([
      { data: txRow({ amount: -1000, currency: 'EUR', amount_sek: -11450, exchange_rate: 11.45 }) },
    ])

    const result = await categorizeMatchedTransaction(supabase, 'u1', 'c1', 'tx-1', OPTS)

    expect(result.status).toBe(409)
    expect(result.error).toContain('bokför redan 11500 kr')
    expect(result.error).not.toContain('1000 kr')
  })

  it('refuses to fabricate kronor for a rateless foreign sibling: states the foreign amount instead', async () => {
    mockDetectDup.mockResolvedValue(
      candidate({
        amount: null,
        currency: 'EUR',
        amount_in_currency: -1000,
        amount_verified: false,
        unverified_reason: 'transaction_missing_sek_value',
      }),
    )
    const supabase = queuedSupabase([
      { data: txRow({ amount: -1000, currency: 'EUR' }) },
    ])

    const result = await categorizeMatchedTransaction(supabase, 'u1', 'c1', 'tx-1', OPTS)

    expect(result.status).toBe(409)
    expect(result.error).toContain('samma belopp (1000 EUR)')
    expect(result.error).toContain('kan inte fastställas')
    // No number in the message wears a kr label.
    expect(result.error).not.toMatch(/\d ?kr\b/)
  })

  it('says the amounts could not be compared for an unverified ledger candidate', async () => {
    // Ledger-voucher candidate found for a rateless foreign bank line: the kr
    // figure is the leg's own SEK amount (real), but no comparison was possible.
    mockDetectDup.mockResolvedValue(
      candidate({
        transaction_id: null,
        amount: 98565,
        account_number: '1930',
        amount_verified: false,
        unverified_reason: 'transaction_missing_sek_value',
      }),
    )
    const supabase = queuedSupabase([
      { data: txRow({ amount: -8570.87, currency: 'EUR' }) },
    ])

    const result = await categorizeMatchedTransaction(supabase, 'u1', 'c1', 'tx-1', OPTS)

    expect(result.status).toBe(409)
    expect(result.error).toContain('bokför 98565 kr')
    expect(result.error).toContain('beloppen kunde inte jämföras')
    expect(result.error).toContain('EUR')
  })
})
