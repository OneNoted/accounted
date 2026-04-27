import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ensureInvoiceNumber } from '@/lib/invoices/ensure-invoice-number'

type MockChain = {
  from: ReturnType<typeof vi.fn>
  rpc: ReturnType<typeof vi.fn>
}

function buildMockSupabase(): MockChain {
  return {
    from: vi.fn(),
    rpc: vi.fn(),
  }
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
    expect(invoice.invoice_number).toBe('F-2026001')
  })

  it('calls RPC with invoice id and document_type=invoice when number is null', async () => {
    const invoice: { id: string; invoice_number: string | null } = {
      id: 'inv-1',
      invoice_number: null,
    }

    supabase.rpc.mockResolvedValue({ data: 'F2026005', error: null })

    const result = await ensureInvoiceNumber(supabase as never, 'company-1', invoice)

    expect(result).toBe('F2026005')
    expect(supabase.rpc).toHaveBeenCalledWith('generate_invoice_number', {
      p_company_id: 'company-1',
      p_invoice_id: 'inv-1',
      p_document_type: 'invoice',
    })
    expect(invoice.invoice_number).toBe('F2026005')
  })

  it('passes document_type=proforma so the RPC produces a PF- prefix', async () => {
    const invoice = {
      id: 'inv-2',
      invoice_number: null,
      document_type: 'proforma' as const,
    }

    supabase.rpc.mockResolvedValue({ data: 'PF-2026005', error: null })

    const result = await ensureInvoiceNumber(supabase as never, 'company-1', invoice)

    expect(result).toBe('PF-2026005')
    expect(supabase.rpc).toHaveBeenCalledWith('generate_invoice_number', {
      p_company_id: 'company-1',
      p_invoice_id: 'inv-2',
      p_document_type: 'proforma',
    })
    expect(invoice.invoice_number).toBe('PF-2026005')
  })

  it('throws when RPC fails', async () => {
    const invoice = { id: 'inv-1', invoice_number: null }
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'RPC failed' } })

    await expect(
      ensureInvoiceNumber(supabase as never, 'company-1', invoice)
    ).rejects.toThrow('Failed to assign invoice number')
  })

  it('throws when RPC returns no data even without an error', async () => {
    const invoice = { id: 'inv-1', invoice_number: null }
    supabase.rpc.mockResolvedValue({ data: null, error: null })

    await expect(
      ensureInvoiceNumber(supabase as never, 'company-1', invoice)
    ).rejects.toThrow('no value returned')
  })
})
