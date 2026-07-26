import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import type { InvoiceWriteItemRow } from '@/lib/invoices/build-invoice-write'

/**
 * Replace ALL invoice_items rows of a DRAFT invoice with `items` (full-replace
 * semantics: delete everything, then insert the new set with `invoice_id`
 * stamped on).
 *
 * Only valid for editable drafts: a draft has no journal entry or linked
 * documents, so delete + reinsert is safe and lets the caller add / remove /
 * reorder rows freely (invoice_items cascade nothing else). The caller is
 * responsible for the draft guard (isEditableInvoiceDraft) BEFORE calling.
 *
 * Shared by the cookie PATCH route (app/api/invoices/[id]), the v1 REST PATCH
 * route, and the update_invoice commit executor so the replace logic cannot
 * drift between the surfaces.
 */
export type ReplaceInvoiceItemsResult =
  | { ok: true }
  | { ok: false; stage: 'delete' | 'insert'; error: PostgrestError }

export async function replaceInvoiceItems(
  supabase: SupabaseClient,
  invoiceId: string,
  items: InvoiceWriteItemRow[],
): Promise<ReplaceInvoiceItemsResult> {
  const { error: deleteError } = await supabase
    .from('invoice_items')
    .delete()
    .eq('invoice_id', invoiceId)

  if (deleteError) return { ok: false, stage: 'delete', error: deleteError }

  const { error: insertError } = await supabase
    .from('invoice_items')
    .insert(items.map((item) => ({ ...item, invoice_id: invoiceId })))

  if (insertError) return { ok: false, stage: 'insert', error: insertError }

  return { ok: true }
}
