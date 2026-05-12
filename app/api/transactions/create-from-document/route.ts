import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { ensureInitialized } from '@/lib/init'
import { validateBody } from '@/lib/api/validate'
import { CreateTransactionFromDocumentSchema } from '@/lib/api/schemas'
import { requireCompanyId } from '@/lib/company/context'
import { requireWritePermission } from '@/lib/auth/require-write'

ensureInitialized()

/**
 * POST /api/transactions/create-from-document
 *
 * Creates an uncategorized manual bank transaction prefilled from an
 * invoice_inbox_items row, then attaches the inbox item's document to it
 * and links the inbox item to the new transaction. The user categorizes
 * the new transaction through the normal /transactions flow (which routes
 * through the bookkeeping engine and respects period locks, etc.).
 *
 * Use case: receipt in the inbox has no matching bank transaction
 * (cash purchase, personal-card expense, missed sync).
 */
export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await requireWritePermission(supabase, user.id)
  if (!writeCheck.ok) return writeCheck.response

  const companyId = await requireCompanyId(supabase, user.id)

  const validation = await validateBody(request, CreateTransactionFromDocumentSchema)
  if (!validation.success) return validation.response
  const { inbox_item_id, amount, transaction_date, description } = validation.data

  const { data: item, error: itemError } = await supabase
    .from('invoice_inbox_items')
    .select('id, document_id, matched_transaction_id, created_supplier_invoice_id, extracted_data')
    .eq('id', inbox_item_id)
    .eq('company_id', companyId)
    .maybeSingle()

  if (itemError || !item) {
    return NextResponse.json({ error: 'Inbox item not found' }, { status: 404 })
  }
  if (item.matched_transaction_id) {
    return NextResponse.json(
      { error: 'Inkorgsposten är redan kopplad till en transaktion.' },
      { status: 409 },
    )
  }
  if (item.created_supplier_invoice_id) {
    return NextResponse.json(
      { error: 'Inkorgsposten är redan bokförd som leverantörsfaktura.' },
      { status: 409 },
    )
  }

  const currency =
    (item.extracted_data as { invoice?: { currency?: string } } | null)?.invoice?.currency ||
    'SEK'

  const { data: newTx, error: insertError } = await supabase
    .from('transactions')
    .insert({
      company_id: companyId,
      user_id: user.id,
      date: transaction_date,
      description,
      amount,
      currency,
      category: 'uncategorized',
      is_business: null,
      import_source: 'manual',
      document_id: item.document_id,
    })
    .select('id')
    .single()

  if (insertError || !newTx) {
    console.error('[create-from-document] Failed to insert transaction:', insertError)
    return NextResponse.json({ error: 'Kunde inte skapa transaktion.' }, { status: 500 })
  }

  const { error: linkError } = await supabase
    .from('invoice_inbox_items')
    .update({ matched_transaction_id: newTx.id })
    .eq('id', inbox_item_id)
    .eq('company_id', companyId)

  if (linkError) {
    console.error('[create-from-document] Failed to link inbox item:', linkError)
    // Transaction was created; surface a 200 with a warning so the user can
    // still find it under Transaktioner — the inbox-link orphan is recoverable.
    return NextResponse.json({
      data: { transaction_id: newTx.id, inbox_link_failed: true },
    })
  }

  return NextResponse.json({
    data: { transaction_id: newTx.id, inbox_item_id, document_id: item.document_id },
  })
}
