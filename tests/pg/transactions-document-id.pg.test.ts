import { randomUUID } from 'crypto'
import { describe, expect, it } from 'vitest'
import { seedCompany } from '@/tests/pg/fixtures'
import { getPool } from '@/tests/pg/setup'

/**
 * Smoke for transactions.document_id added in 20260505140000.
 * Locks in:
 *   - The FK exists and points at document_attachments(id).
 *   - ON DELETE SET NULL: deleting the document nulls the link rather than
 *     blocking (RESTRICT) or cascading the transaction (CASCADE).
 */

async function insertDocument(params: {
  userId: string
  companyId: string
}): Promise<string> {
  const id = randomUUID()
  await getPool().query(
    `INSERT INTO public.document_attachments
       (id, user_id, company_id, file_name, mime_type, file_size_bytes,
        storage_path, sha256_hash, upload_source)
     VALUES ($1, $2, $3, 'test.pdf', 'application/pdf', 1024,
             'documents/' || $2 || '/test.pdf',
             $4, 'file_upload')`,
    [id, params.userId, params.companyId, randomUUID().replace(/-/g, '').padEnd(64, '0')],
  )
  return id
}

async function insertTransaction(params: {
  userId: string
  companyId: string
  documentId?: string | null
}): Promise<string> {
  const id = randomUUID()
  await getPool().query(
    `INSERT INTO public.transactions
       (id, user_id, company_id, date, description, amount, currency, document_id)
     VALUES ($1, $2, $3, '2026-05-01', 'Test tx', -1000, 'SEK', $4)`,
    [id, params.userId, params.companyId, params.documentId ?? null],
  )
  return id
}

describe('transactions.document_id.pg', () => {
  it('attaches a document to a transaction and reads it back', async () => {
    const { userId, companyId } = await seedCompany()
    const docId = await insertDocument({ userId, companyId })
    const txId = await insertTransaction({ userId, companyId, documentId: docId })

    const res = await getPool().query<{ document_id: string | null }>(
      `SELECT document_id FROM public.transactions WHERE id = $1`,
      [txId],
    )
    expect(res.rows[0]!.document_id).toBe(docId)
  })

  it('ON DELETE SET NULL: deleting the document nulls transactions.document_id', async () => {
    const { userId, companyId } = await seedCompany()
    const docId = await insertDocument({ userId, companyId })
    const txId = await insertTransaction({ userId, companyId, documentId: docId })

    // Bypass document immutability triggers by using superuser DELETE.
    // (block_document_deletion fires only on rows linked to journal entries —
    // this document has no journal_entry_id so the trigger is a no-op.)
    await getPool().query(`DELETE FROM public.document_attachments WHERE id = $1`, [docId])

    const res = await getPool().query<{ document_id: string | null }>(
      `SELECT document_id FROM public.transactions WHERE id = $1`,
      [txId],
    )
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0]!.document_id).toBeNull()
  })
})
