/**
 * Unit tests for gnubok_query_journal.
 *
 * Verifies tool registration and the post-fetch amount filter + totals
 * computation. The supabase query-builder chain is exercised by the live
 * MCP smoke test; here we just check the result-shape pipeline.
 */
import { describe, it, expect, vi } from 'vitest'
import { tools } from '../server'
import { TOOL_SCOPE_MAP } from '@/lib/auth/api-keys'

describe('gnubok_query_journal — registration', () => {
  it('is registered and read-only', () => {
    const tool = tools.find((t) => t.name === 'gnubok_query_journal')
    expect(tool).toBeDefined()
    expect(tool?.annotations.readOnlyHint).toBe(true)
    expect(tool?.annotations.destructiveHint).toBe(false)
  })

  it('declares the expected output fields', () => {
    const tool = tools.find((t) => t.name === 'gnubok_query_journal')!
    const schema = tool.outputSchema as { required?: string[] }
    expect(schema.required).toContain('lines')
    expect(schema.required).toContain('totals')
    expect(schema.required).toContain('total_lines')
  })

  it('is mapped to reports:read scope', () => {
    expect(TOOL_SCOPE_MAP.gnubok_query_journal).toBe('reports:read')
  })
})

/**
 * Build a minimal supabase mock that returns a fixed line set when the chain
 * is awaited. Uses a chainable proxy whose every method returns itself, with
 * the terminal awaitable resolving to { data, error, count }.
 */
function makeChainMock(lines: unknown[], count: number) {
  const result = { data: lines, error: null, count }
  const buildChain = (): unknown => {
    return new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void) => resolve(result)
          }
          return () => buildChain()
        },
      },
    )
  }
  return {
    from: vi.fn().mockImplementation(() => buildChain()),
  } as never
}

describe('gnubok_query_journal — execute', () => {
  it('applies amount_min filter and computes totals on the filtered set', async () => {
    const tool = tools.find((t) => t.name === 'gnubok_query_journal')!
    const lines = [
      // Line 1: large debit — should pass amount_min: 1000
      {
        id: 'l1', account_number: '4010',
        debit_amount: 5000, credit_amount: 0,
        currency: 'SEK', line_description: 'Hyra', project: null, cost_center: null, sort_order: 0,
        journal_entries: {
          id: 'e1', voucher_number: 1, voucher_series: 'A',
          entry_date: '2026-03-15', description: 'Marshyra',
          source_type: 'supplier_invoice', status: 'posted',
        },
      },
      // Line 2: small debit — should fail amount_min: 1000
      {
        id: 'l2', account_number: '4010',
        debit_amount: 50, credit_amount: 0,
        currency: 'SEK', line_description: 'Småinköp', project: null, cost_center: null, sort_order: 0,
        journal_entries: {
          id: 'e2', voucher_number: 2, voucher_series: 'A',
          entry_date: '2026-03-16', description: 'Reseutlägg',
          source_type: 'bank_transaction', status: 'posted',
        },
      },
    ]
    const supabase = makeChainMock(lines, 2)

    const result = (await tool.execute(
      { account_from: '4000', account_to: '4999', amount_min: 1000, limit: 100 },
      'company-1',
      'user-1',
      supabase,
    )) as {
      lines: { line_id: string }[]
      totals: { debit: number; credit: number; net: number }
      truncated: boolean
      total_lines: number
      returned_lines: number
    }

    // amount_min: 1000 should filter out the 50-line
    expect(result.returned_lines).toBe(1)
    expect(result.lines[0].line_id).toBe('l1')
    expect(result.totals.debit).toBe(5000)
    expect(result.totals.credit).toBe(0)
    expect(result.totals.net).toBe(5000)
  })

  it('caps accounts list at 50', async () => {
    const tool = tools.find((t) => t.name === 'gnubok_query_journal')!
    const supabase = makeChainMock([], 0)
    const accounts = Array.from({ length: 51 }, (_, i) => String(1000 + i))

    await expect(
      tool.execute({ accounts }, 'company-1', 'user-1', supabase),
    ).rejects.toThrow(/capped at 50/)
  })

  it('marks truncated=true when count exceeds returned', async () => {
    const tool = tools.find((t) => t.name === 'gnubok_query_journal')!
    const lines = [
      {
        id: 'l1', account_number: '1930',
        debit_amount: 100, credit_amount: 0,
        currency: 'SEK', line_description: null, project: null, cost_center: null, sort_order: 0,
        journal_entries: {
          id: 'e1', voucher_number: 1, voucher_series: 'A',
          entry_date: '2026-01-01', description: 'Inbetalning',
          source_type: 'bank_transaction', status: 'posted',
        },
      },
    ]
    // count=999 simulates "many more matched than were returned"
    const supabase = makeChainMock(lines, 999)

    const result = (await tool.execute(
      { accounts: ['1930'], limit: 1 },
      'company-1',
      'user-1',
      supabase,
    )) as { truncated: boolean; total_lines: number; returned_lines: number }

    expect(result.truncated).toBe(true)
    expect(result.total_lines).toBe(999)
    expect(result.returned_lines).toBe(1)
  })
})
