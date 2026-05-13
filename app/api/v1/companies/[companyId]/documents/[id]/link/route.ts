/**
 * POST /api/v1/companies/{companyId}/documents/{id}/link
 *
 * Link an already-uploaded document to a journal entry (and optionally a
 * specific line). Wraps lib/core/documents/document-service.linkToJournalEntry.
 *
 * Body: `{ journal_entry_id: UUID, journal_entry_line_id?: UUID }`.
 *
 * The link is REVERSIBLE — set journal_entry_id back via the dashboard if
 * needed (no unlink endpoint in v1 yet to keep the WORM contract tight).
 * Once the journal entry it points at is committed (status='posted'), the
 * document row is effectively immutable per BFL 7 kap.
 *
 * Idempotent (mandatory Idempotency-Key). Dry-runnable: confirms the JE
 * and document both exist + belong to the company without persisting.
 */

import { z } from 'zod'
import { ok } from '@/lib/api/v1/response'
import { dryRunPreview } from '@/lib/api/v1/dry-run'
import { registerEndpoint } from '@/lib/api/v1/registry'
import { withApiV1 } from '@/lib/api/v1/with-api-v1'
import { v1ErrorResponse, v1ErrorResponseFromCode } from '@/lib/api/v1/errors'
import { linkToJournalEntry } from '@/lib/core/documents/document-service'

const Body = z
  .object({
    journal_entry_id: z.string().uuid(),
    journal_entry_line_id: z.string().uuid().optional(),
  })
  .strict()

const DocumentLinkedResponse = z.object({
  id: z.string().uuid(),
  journal_entry_id: z.string().uuid(),
  journal_entry_line_id: z.string().uuid().nullable(),
  file_name: z.string(),
})

registerEndpoint({
  operation: 'documents.link',
  method: 'POST',
  path: '/api/v1/companies/:companyId/documents/:id/link',
  summary: 'Link a document to a journal entry.',
  description:
    'Sets journal_entry_id (and optionally journal_entry_line_id) on an existing document. Use this after /documents upload when the link target was unknown at upload time, or to re-link a stray document. Once the target JE is posted, the document row is effectively immutable per BFL 7 kap retention.',
  useWhen:
    'A document was uploaded without a journal_entry_id (e.g. bulk import) and you now want to attach it to a posted verifikation.',
  doNotUseFor:
    'Unlinking — no v1 unlink endpoint. The dashboard exposes a manual override; v1 keeps the WORM contract by refusing to revert posted-JE links.',
  pitfalls: [
    'Idempotency-Key is mandatory.',
    'Both the document and the journal_entry_id must belong to the caller\'s company. NOT_FOUND on mismatch (enumeration hardening).',
    'Re-linking an already-linked document overwrites the previous journal_entry_id — confirm the old target is what you intend to break.',
  ],
  example: {
    request: { journal_entry_id: 'a8f1…' },
    response: {
      data: {
        id: '0e9c…',
        journal_entry_id: 'a8f1…',
        journal_entry_line_id: null,
        file_name: 'kvitto-2026-05-12.pdf',
      },
      meta: { request_id: 'req_…', api_version: '2026-05-12' },
    },
  },
  scope: 'documents:write',
  risk: 'medium',
  idempotent: true,
  reversible: false,
  dryRunSupported: true,
  request: { body: Body },
  response: { success: DocumentLinkedResponse },
})

export const POST = withApiV1<{ params: Promise<{ companyId: string; id: string }> }>(
  'documents.link',
  async (request, ctx, params) => {
    const { id } = await params.params
    const idParse = z.string().uuid().safeParse(id)
    if (!idParse.success) {
      return v1ErrorResponseFromCode('VALIDATION_ERROR', ctx.log, {
        requestId: ctx.requestId,
        details: { field: 'id', message: 'document id must be a UUID.' },
      })
    }
    const documentId = idParse.data

    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return v1ErrorResponseFromCode('VALIDATION_ERROR', ctx.log, {
        requestId: ctx.requestId,
        details: { field: 'body', message: 'Body is not valid JSON.' },
      })
    }
    const parsed = Body.safeParse(rawBody)
    if (!parsed.success) {
      return v1ErrorResponseFromCode('VALIDATION_ERROR', ctx.log, {
        requestId: ctx.requestId,
        details: { issues: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) },
      })
    }
    const body = parsed.data

    // Ownership pre-check: document AND target JE must both belong to the
    // caller's company before the link write. Otherwise the row could
    // persist with a cross-tenant journal_entry_id pointer.
    const [{ data: doc }, { data: je }] = await Promise.all([
      ctx.supabase
        .from('document_attachments')
        .select('id, file_name')
        .eq('id', documentId)
        .eq('company_id', ctx.companyId!)
        .maybeSingle(),
      ctx.supabase
        .from('journal_entries')
        .select('id')
        .eq('id', body.journal_entry_id)
        .eq('company_id', ctx.companyId!)
        .maybeSingle(),
    ])

    if (!doc) {
      return v1ErrorResponseFromCode('NOT_FOUND', ctx.log, {
        requestId: ctx.requestId,
        details: { resource: 'document' },
      })
    }
    if (!je) {
      return v1ErrorResponseFromCode('NOT_FOUND', ctx.log, {
        requestId: ctx.requestId,
        details: { resource: 'journal_entry', field: 'journal_entry_id' },
      })
    }

    if (ctx.dryRun) {
      return dryRunPreview(
        {
          id: documentId,
          journal_entry_id: body.journal_entry_id,
          journal_entry_line_id: body.journal_entry_line_id ?? null,
          file_name: (doc as { file_name: string }).file_name,
        },
        { requestId: ctx.requestId, log: ctx.log },
      )
    }

    try {
      const updated = await linkToJournalEntry(
        ctx.supabase,
        ctx.companyId!,
        documentId,
        body.journal_entry_id,
        body.journal_entry_line_id,
      )
      return ok(
        {
          id: updated.id,
          journal_entry_id: updated.journal_entry_id!,
          journal_entry_line_id: updated.journal_entry_line_id,
          file_name: updated.file_name,
        },
        { requestId: ctx.requestId },
      )
    } catch (err) {
      ctx.log.error('documents.link failed', err as Error, { documentId, journalEntryId: body.journal_entry_id })
      return v1ErrorResponse(err, ctx.log, { requestId: ctx.requestId })
    }
  },
  { requireIdempotencyKey: true },
)
