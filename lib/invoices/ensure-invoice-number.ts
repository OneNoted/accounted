import type { SupabaseClient } from '@supabase/supabase-js'
import type { Invoice } from '@/types'

type InvoiceShape = Pick<Invoice, 'id' | 'invoice_number'> & { invoice_number: string | null }

export async function ensureInvoiceNumber(
  supabase: SupabaseClient,
  companyId: string,
  invoice: InvoiceShape,
): Promise<string> {
  if (invoice.invoice_number) {
    return invoice.invoice_number
  }

  const { data: generated, error: rpcError } = await supabase.rpc('generate_invoice_number', {
    p_company_id: companyId,
  })

  if (rpcError || !generated) {
    throw new Error(`Failed to generate invoice number: ${rpcError?.message ?? 'no value returned'}`)
  }

  const { data: updated, error: updateError } = await supabase
    .from('invoices')
    .update({ invoice_number: generated })
    .eq('id', invoice.id)
    .eq('company_id', companyId)
    .is('invoice_number', null)
    .select('invoice_number')
    .maybeSingle()

  if (updateError) {
    throw new Error(`Failed to persist invoice number: ${updateError.message}`)
  }

  if (!updated) {
    const { data: existing } = await supabase
      .from('invoices')
      .select('invoice_number')
      .eq('id', invoice.id)
      .eq('company_id', companyId)
      .single()

    if (existing?.invoice_number) {
      invoice.invoice_number = existing.invoice_number
      return existing.invoice_number
    }
    throw new Error('Failed to persist invoice number: row not found')
  }

  invoice.invoice_number = updated.invoice_number
  return updated.invoice_number as string
}
