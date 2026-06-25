/**
 * The agent/MCP commit path (lib/pending-operations/commit.ts) must run the same
 * duplicate guards as the web routes — it previously bypassed them entirely,
 * which let an approved staged op double-book an affärshändelse already in the
 * ledger (the production case: a bank line booked on top of an invoice
 * "markera som betald" voucher or a salary payout).
 *
 * These tests drive the public `commitPendingOperation` dispatcher (the executor
 * functions are private) and assert the op is auto-rejected (409) when a
 * duplicate is detected. The detection functions themselves are unit-tested in
 * lib/transactions/__tests__/booking-duplicate-detection.test.ts and
 * lib/invoices/__tests__/duplicate-payment-detection.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { eventBus } from '@/lib/events/bus'
import type { PendingOperation } from '@/types'

const mockDetectBookingDuplicate = vi.fn()
vi.mock('@/lib/transactions/booking-duplicate-detection', () => ({
  detectBookingDuplicate: (...args: unknown[]) => mockDetectBookingDuplicate(...args),
}))

const mockFindDupPayments = vi.fn()
vi.mock('@/lib/invoices/duplicate-payment-candidates', () => ({
  findDuplicatePaymentCandidatesForInvoice: (...args: unknown[]) => mockFindDupPayments(...args),
}))

import { commitPendingOperation } from '../commit'

/** Queue-based supabase mock: each `from()` resolves to the next queued result. */
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

function makePendingOp(overrides: Partial<PendingOperation>): PendingOperation {
  return {
    id: 'op-1',
    user_id: 'user-1',
    company_id: 'company-1',
    operation_type: 'categorize_transaction',
    status: 'pending',
    title: 'test',
    params: {},
    preview_data: {},
    result_data: null,
    actor_type: 'user',
    actor_id: null,
    actor_label: null,
    risk_level: 'medium',
    created_at: '2026-05-03T00:00:00Z',
    resolved_at: null,
    updated_at: '2026-05-03T00:00:00Z',
    ...overrides,
  } as PendingOperation
}

const voucherCandidate = {
  transaction_id: null,
  journal_entry_id: 'je-existing',
  voucher_label: 'A2',
  entry_date: '2026-03-30',
  description: 'Inbetalning kundfaktura 2026001',
  amount: 98565,
}

beforeEach(() => {
  vi.clearAllMocks()
  eventBus.clear()
})

describe('commit duplicate guard: categorize_transaction (reverse / book the bank line)', () => {
  it('auto-rejects (409) when a ledger voucher already books this movement', async () => {
    mockDetectBookingDuplicate.mockResolvedValue(voucherCandidate)
    // claim → transaction fetch → reject update
    const supabase = queuedSupabase([
      { data: { id: 'op-1' } },
      { data: { id: 'tx-1', date: '2026-03-26', amount: 98565, cash_account_id: null, journal_entry_id: null } },
      { data: null },
    ])

    const op = makePendingOp({
      operation_type: 'categorize_transaction',
      params: { transaction_id: 'tx-1', category: 'income' },
    })

    const result = await commitPendingOperation(supabase, 'user-1', 'company-1', op)

    expect(mockDetectBookingDuplicate).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('rejected')
    expect(result.http_status).toBe(409)
  })

  it('skips the guard entirely when allow_duplicate=true (no detection query)', async () => {
    mockDetectBookingDuplicate.mockResolvedValue(voucherCandidate)
    // The booking proceeds past the guard; we only assert the guard was skipped,
    // so the downstream booking is allowed to fail against the bare mock.
    const supabase = queuedSupabase([
      { data: { id: 'op-1' } },
      { data: { id: 'tx-1', date: '2026-03-26', amount: 98565, cash_account_id: null, journal_entry_id: null } },
      { data: { entity_type: 'aktiebolag', fiscal_year_start_month: 1 } },
      { data: [] },
    ])

    const op = makePendingOp({
      operation_type: 'categorize_transaction',
      params: { transaction_id: 'tx-1', category: 'income', allow_duplicate: true },
    })

    await commitPendingOperation(supabase, 'user-1', 'company-1', op)

    expect(mockDetectBookingDuplicate).not.toHaveBeenCalled()
  })
})

describe('commit duplicate guard: mark_invoice_paid (forward / book the payment)', () => {
  it('auto-rejects (409) when an unlinked bank transaction already looks like the payment', async () => {
    mockFindDupPayments.mockResolvedValue([
      { id: 'tx-9', date: '2026-03-26', amount: 98565, description: '2026001', merchant_name: null, reference: null, match_reason: 'ocr_exact', match_confidence: 0.99 },
    ])
    // claim → invoice fetch → reject update
    const supabase = queuedSupabase([
      { data: { id: 'op-1' } },
      { data: { id: 'inv-1', invoice_number: '2026001', status: 'sent', total: 98565, remaining_amount: 98565, customer: { name: 'Arcim Technology AB' } } },
      { data: null },
    ])

    const op = makePendingOp({
      operation_type: 'mark_invoice_paid',
      params: { invoice_id: 'inv-1', payment_date: '2026-03-30' },
    })

    const result = await commitPendingOperation(supabase, 'user-1', 'company-1', op)

    expect(mockFindDupPayments).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('rejected')
    expect(result.http_status).toBe(409)
  })
})
