import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { ensureInitialized } from '@/lib/init'
import { validateBody } from '@/lib/api/validate'
import { AttachDocumentSchema } from '@/lib/api/schemas'
import { requireCompanyId } from '@/lib/company/context'
import { requireWritePermission } from '@/lib/auth/require-write'

ensureInitialized()

/**
 * POST /api/transactions/[id]/attach-document
 *
 * Pin an unmatched document_attachments row to a bank transaction. Lets users
 * (or AI agents via MCP) bind a forwarded/uploaded invoice or receipt before
 * the transaction is categorized. When the transaction is later categorized,
 * the categorize route propagates the link to document_attachments.journal_entry_id.
 *
 * Idempotent — overwrites any existing link.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { id: transactionId } = await params

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await requireWritePermission(supabase, user.id)
  if (!writeCheck.ok) return writeCheck.response

  const companyId = await requireCompanyId(supabase, user.id)

  const validation = await validateBody(request, AttachDocumentSchema)
  if (!validation.success) return validation.response
  const { document_id } = validation.data

  const { data: transaction, error: txError } = await supabase
    .from('transactions')
    .select('id')
    .eq('id', transactionId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (txError || !transaction) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  }

  const { data: document, error: docError } = await supabase
    .from('document_attachments')
    .select('id')
    .eq('id', document_id)
    .eq('company_id', companyId)
    .maybeSingle()

  if (docError || !document) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  const { error: updateError } = await supabase
    .from('transactions')
    .update({ document_id })
    .eq('id', transactionId)
    .eq('company_id', companyId)

  if (updateError) {
    console.error('[attach-document] Failed to attach:', updateError)
    return NextResponse.json({ error: 'Failed to attach document' }, { status: 500 })
  }

  return NextResponse.json({ data: { transaction_id: transactionId, document_id } })
}

/**
 * DELETE /api/transactions/[id]/attach-document
 *
 * Detach a document from a transaction. Does not touch any downstream
 * journal_entry_id link on document_attachments — reversing the journal entry
 * is a separate, explicit action.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { id: transactionId } = await params

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await requireWritePermission(supabase, user.id)
  if (!writeCheck.ok) return writeCheck.response

  const companyId = await requireCompanyId(supabase, user.id)

  const { error: updateError } = await supabase
    .from('transactions')
    .update({ document_id: null })
    .eq('id', transactionId)
    .eq('company_id', companyId)

  if (updateError) {
    console.error('[attach-document] Failed to detach:', updateError)
    return NextResponse.json({ error: 'Failed to detach document' }, { status: 500 })
  }

  return NextResponse.json({ data: { transaction_id: transactionId, document_id: null } })
}
