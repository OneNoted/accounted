/**
 * GET /api/v1/companies/{companyId}/documents/{id}/download
 *
 * Returns a signed Supabase Storage URL (60-minute expiry) for the
 * document's current version. The signed URL is a direct-download link
 * the caller can fetch from any HTTP client without re-presenting an
 * API key — keep it server-side and don't surface to end-users beyond
 * the immediate transaction.
 *
 * The endpoint emits a `document.accessed` event (best-effort) so the
 * audit trail records every download.
 */

import { z } from 'zod'
import { ok } from '@/lib/api/v1/response'
import { registerEndpoint } from '@/lib/api/v1/registry'
import { withApiV1 } from '@/lib/api/v1/with-api-v1'
import { v1ErrorResponse, v1ErrorResponseFromCode } from '@/lib/api/v1/errors'
import { eventBus } from '@/lib/events'

const DocumentDownloadResponse = z.object({
  id: z.string().uuid(),
  file_name: z.string(),
  mime_type: z.string().nullable(),
  sha256_hash: z.string(),
  download_url: z.string().url(),
  expires_in_seconds: z.number().int(),
})

const SIGNED_URL_TTL_SECONDS = 60 * 60 // 60 minutes — matches the dashboard internal route.

registerEndpoint({
  operation: 'documents.download',
  method: 'GET',
  path: '/api/v1/companies/:companyId/documents/:id/download',
  summary: 'Get a time-limited signed download URL for a document.',
  description: `Returns a Supabase Storage signed URL valid for ${SIGNED_URL_TTL_SECONDS / 60} minutes. The URL itself is the canonical download — fetch it with any HTTP client; no API key needed on the storage host. Verify file integrity client-side against the returned sha256_hash if your workflow requires it.`,
  useWhen:
    'You need the bytes of an archived document (e.g. for OCR, attachment to an email, regulatory export). Always re-fetch the URL before each download — old URLs expire.',
  doNotUseFor:
    'Persisting the URL anywhere — it expires. Storing the URL in a webhook payload or audit log makes the audit trail dependent on URL state.',
  pitfalls: [
    `The signed URL expires after ${SIGNED_URL_TTL_SECONDS / 60} minutes. Don't cache it beyond the immediate transaction.`,
    'The URL leaks the Supabase Storage origin; this is benign (the signature alone authorizes the read) but rate-limit any forwarding so you don\'t reveal the storage layout to untrusted callers.',
    'Each call emits a document.accessed event. Polling this endpoint produces audit noise; cache the URL for its full TTL.',
  ],
  example: {
    response: {
      data: {
        id: '0e9c…',
        file_name: 'kvitto-2026-05-12.pdf',
        mime_type: 'application/pdf',
        sha256_hash: '8a7f…',
        download_url: 'https://…supabase.co/storage/v1/object/sign/…',
        expires_in_seconds: 3600,
      },
      meta: { request_id: 'req_…', api_version: '2026-05-12' },
    },
  },
  scope: 'documents:read',
  risk: 'low',
  idempotent: true,
  reversible: false,
  dryRunSupported: false,
  response: { success: DocumentDownloadResponse },
})

export const GET = withApiV1<{ params: Promise<{ companyId: string; id: string }> }>(
  'documents.download',
  async (_request, ctx, params) => {
    const { id } = await params.params
    const idParse = z.string().uuid().safeParse(id)
    if (!idParse.success) {
      return v1ErrorResponseFromCode('VALIDATION_ERROR', ctx.log, {
        requestId: ctx.requestId,
        details: { field: 'id', message: 'document id must be a UUID.' },
      })
    }
    const documentId = idParse.data

    const { data: doc, error: docErr } = await ctx.supabase
      .from('document_attachments')
      .select('id, file_name, mime_type, sha256_hash, storage_path, is_current_version')
      .eq('id', documentId)
      .eq('company_id', ctx.companyId!)
      .maybeSingle()

    if (docErr) return v1ErrorResponse(docErr, ctx.log, { requestId: ctx.requestId })
    if (!doc) {
      // Enumeration hardening — wrong id and cross-tenant id are
      // indistinguishable from outside.
      return v1ErrorResponseFromCode('NOT_FOUND', ctx.log, {
        requestId: ctx.requestId,
        details: { resource: 'document' },
      })
    }
    const typed = doc as {
      id: string; file_name: string; mime_type: string | null; sha256_hash: string;
      storage_path: string; is_current_version: boolean;
    }

    const { data: signed, error: signErr } = await ctx.supabase.storage
      .from('documents')
      .createSignedUrl(typed.storage_path, SIGNED_URL_TTL_SECONDS)

    if (signErr || !signed?.signedUrl) {
      ctx.log.error('createSignedUrl failed', signErr as Error, { documentId })
      return v1ErrorResponseFromCode('DOC_DOWNLOAD_FAILED', ctx.log, {
        requestId: ctx.requestId,
        details: { reason: signErr?.message ?? 'unknown' },
      })
    }

    try {
      await eventBus.emit({
        type: 'document.accessed',
        payload: {
          document: { id: typed.id, file_name: typed.file_name },
          userId: ctx.userId,
          companyId: ctx.companyId!,
        },
      })
    } catch (err) {
      ctx.log.warn('document.accessed emit failed', err as Error)
    }

    return ok(
      {
        id: typed.id,
        file_name: typed.file_name,
        mime_type: typed.mime_type,
        sha256_hash: typed.sha256_hash,
        download_url: signed.signedUrl,
        expires_in_seconds: SIGNED_URL_TTL_SECONDS,
      },
      { requestId: ctx.requestId },
    )
  },
)
