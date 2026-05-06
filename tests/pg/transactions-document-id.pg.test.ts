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
  const storagePath = `documents/${params.companyId}/test.pdf`
  const sha256 = randomUUID().replace(/-/g, '').padEnd(64, '0')
  await getPool().query(
    `INSERT INTO public.document_attachments
       (id, user_id, company_id, file_name, mime_type, file_size_bytes,
        storage_path, sha256_hash, upload_source)
     VALUES ($1, $2, $3, 'test.pdf', 'application/pdf', 1024,
             $4, $5, 'file_upload')`,
    [id, params.userId, params.companyId, storagePath, sha256],
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

async function insertJournalEntry(params: {
  userId: string
  companyId: string
  fiscalPeriodId: string
}): Promise<string> {
  const id = randomUUID()
  await getPool().query(
    `INSERT INTO public.journal_entries
       (id, user_id, company_id, fiscal_period_id, voucher_number, voucher_series,
        entry_date, description, source_type, status)
     VALUES ($1, $2, $3, $4, 1, 'A', '2026-05-01', 'Test', 'manual', 'draft')`,
    [id, params.userId, params.companyId, params.fiscalPeriodId],
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

    // block_document_deletion fires only on rows linked to journal entries —
    // this document has no journal_entry_id so the trigger is a no-op.
    await getPool().query(`DELETE FROM public.document_attachments WHERE id = $1`, [docId])

    const res = await getPool().query<{ document_id: string | null }>(
      `SELECT document_id FROM public.transactions WHERE id = $1`,
      [txId],
    )
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0]!.document_id).toBeNull()
  })

  it('blocks UPDATE that detaches a document already linked to a journal entry', async () => {
    const { userId, companyId, fiscalPeriodId } = await seedCompany()
    const docId = await insertDocument({ userId, companyId })
    const txId = await insertTransaction({ userId, companyId, documentId: docId })
    const jeId = await insertJournalEntry({ userId, companyId, fiscalPeriodId })

    // Simulate the categorize propagation: doc is now räkenskapsinformation.
    await getPool().query(
      `UPDATE public.document_attachments SET journal_entry_id = $1 WHERE id = $2`,
      [jeId, docId],
    )

    await expect(
      getPool().query(
        `UPDATE public.transactions SET document_id = NULL WHERE id = $1`,
        [txId],
      ),
    ).rejects.toThrow(/räkenskapsinformation/)

    // And blocks swapping to a different document.
    const otherDocId = await insertDocument({ userId, companyId })
    await expect(
      getPool().query(
        `UPDATE public.transactions SET document_id = $1 WHERE id = $2`,
        [otherDocId, txId],
      ),
    ).rejects.toThrow(/räkenskapsinformation/)
  })

  it('allows detach when the document is not yet on a journal entry', async () => {
    const { userId, companyId } = await seedCompany()
    const docId = await insertDocument({ userId, companyId })
    const txId = await insertTransaction({ userId, companyId, documentId: docId })

    await getPool().query(
      `UPDATE public.transactions SET document_id = NULL WHERE id = $1`,
      [txId],
    )

    const res = await getPool().query<{ document_id: string | null }>(
      `SELECT document_id FROM public.transactions WHERE id = $1`,
      [txId],
    )
    expect(res.rows[0]!.document_id).toBeNull()
  })
})
