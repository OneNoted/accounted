import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/require-auth'
import { createServiceClient } from '@/lib/supabase/server'
import { validateDocumentMagicBytes } from '@/lib/core/documents/document-service'

/**
 * GET /api/documents/:id/integrity
 *
 * Probes the actual stored bytes against the declared MIME type. Used by the
 * Bilagor modal to surface a clear "this file is corrupt — please re-upload"
 * warning instead of relying on the browser's PDF viewer error UI, which
 * only fires after the user has already tried to view the file.
 *
 * Some legacy MCP uploads landed with non-PDF bytes under
 * `mime_type = 'application/pdf'` because magic-byte validation was added
 * after those rows were written. This endpoint lets the UI detect and steer
 * the user toward replacing them.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, supabase, error } = await requireAuth()
  if (error) return error

  const { id } = await params

  const { data: doc, error: docError } = await supabase
    .from('document_attachments')
    .select('id, company_id, file_name, mime_type, storage_path')
    .eq('id', id)
    .single()

  if (docError || !doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  const { data: membership } = await supabase
    .from('company_members')
    .select('company_id')
    .eq('company_id', doc.company_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  if (!doc.mime_type) {
    return NextResponse.json({ data: { valid: true } })
  }

  const serviceClient = createServiceClient()
  const { data: blob, error: downloadError } = await serviceClient.storage
    .from('documents')
    .download(doc.storage_path)

  if (downloadError || !blob) {
    return NextResponse.json(
      { error: `Failed to download document: ${downloadError?.message ?? 'unknown error'}` },
      { status: 500 }
    )
  }

  const buffer = await blob.arrayBuffer()
  const magicError = validateDocumentMagicBytes(buffer, doc.mime_type)

  return NextResponse.json({
    data: {
      valid: magicError === null,
      reason: magicError ?? undefined,
    },
  })
}
