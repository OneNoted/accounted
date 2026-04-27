import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ensureInvoiceNumber } from '@/lib/invoices/ensure-invoice-number'

type MockChain = {
  update: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  is: ReturnType<typeof vi.fn>
  select: ReturnType<typeof vi.fn>
  maybeSingle: ReturnType<typeof vi.fn>
  single: ReturnType<typeof vi.fn>
  from: ReturnType<typeof vi.fn>
  rpc: ReturnType<typeof vi.fn>
}

function buildMockSupabase(): MockChain {
  const chain: MockChain = {
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    select: vi.fn(() => chain),
    maybeSingle: vi.fn(),
    single: vi.fn(),
    from: vi.fn(() => chain),
    rpc: vi.fn(),
  }
  return chain
}

describe('ensureInvoiceNumber', () => {
  let supabase: MockChain

  beforeEach(() => {
    supabase = buildMockSupabase()
  })

  it('returns existing number without RPC when invoice already has one', async () => {
    const invoice = { id: 'inv-1', invoice_number: 'F-2026001' }

    const result = await ensureInvoiceNumber(supabase as never, 'company-1', invoice)

    expect(result).toBe('F-2026001')
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
    expect(invoice.invoice_number).toBe('F-2026001')
  })

  it('generates and persists number when invoice has null', async () => {
    const invoice: { id: string; invoice_number: string | null } = {
      id: 'inv-1',
      invoice_number: null,
    }

    supabase.rpc.mockResolvedValue({ data: 'F-2026005', error: null })
    supabase.maybeSingle.mockResolvedValue({
      data: { invoice_number: 'F-2026005' },
      error: null,
    })

    const result = await ensureInvoiceNumber(supabase as never, 'company-1', invoice)

    expect(result).toBe('F-2026005')
    expect(supabase.rpc).toHaveBeenCalledWith('generate_invoice_number', {
      p_company_id: 'company-1',
    })
    expect(supabase.update).toHaveBeenCalledWith({ invoice_number: 'F-2026005' })
    expect(supabase.is).toHaveBeenCalledWith('invoice_number', null)
    expect(invoice.invoice_number).toBe('F-2026005')
  })

  it('throws when RPC fails', async () => {
    const invoice = { id: 'inv-1', invoice_number: null }
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'RPC failed' } })

    await expect(
      ensureInvoiceNumber(supabase as never, 'company-1', invoice)
    ).rejects.toThrow('Failed to generate invoice number')
  })

  it('recovers existing number when UPDATE finds row already populated by a concurrent caller', async () => {
    const invoice: { id: string; invoice_number: string | null } = {
      id: 'inv-1',
      invoice_number: null,
    }

    supabase.rpc.mockResolvedValue({ data: 'F-2026010', error: null })
    // The is_null guarded UPDATE returns no rows because another caller won the race
    supabase.maybeSingle.mockResolvedValue({ data: null, error: null })
    // Fallback fetch reveals the winning number
    supabase.single.mockResolvedValue({
      data: { invoice_number: 'F-2026009' },
      error: null,
    })

    const result = await ensureInvoiceNumber(supabase as never, 'company-1', invoice)

    expect(result).toBe('F-2026009')
    expect(invoice.invoice_number).toBe('F-2026009')
  })

  it('throws when UPDATE returns no row and no fallback number exists', async () => {
    const invoice = { id: 'inv-1', invoice_number: null }
    supabase.rpc.mockResolvedValue({ data: 'F-2026020', error: null })
    supabase.maybeSingle.mockResolvedValue({ data: null, error: null })
    supabase.single.mockResolvedValue({ data: null, error: null })

    await expect(
      ensureInvoiceNumber(supabase as never, 'company-1', invoice)
    ).rejects.toThrow('row not found')
  })
})
