import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { getPool, withUserContext } from '@/tests/pg/setup'
import {
  insertBalancedLines,
  insertDraftJournalEntry,
  seedCompany,
} from '@/tests/pg/fixtures'

// Set up a posted journal entry with balanced lines, going through draft so
// the line-immutability trigger is happy. Returns the entry id.
async function insertPostedEntryWithLines(params: {
  userId: string
  companyId: string
  fiscalPeriodId: string
  voucherNumber: number
  reversesId?: string
  sourceType?: string
}): Promise<string> {
  const id = randomUUID()
  await getPool().query(
    `INSERT INTO public.journal_entries
       (id, user_id, company_id, fiscal_period_id, voucher_number, voucher_series,
        entry_date, description, source_type, status, reverses_id)
     VALUES ($1, $2, $3, $4, $5, 'A', '2026-06-01', 'Test entry', $6, 'draft', $7)`,
    [
      id,
      params.userId,
      params.companyId,
      params.fiscalPeriodId,
      params.voucherNumber,
      params.sourceType ?? 'manual',
      params.reversesId ?? null,
    ],
  )
  await insertBalancedLines(id)
  await getPool().query(
    `UPDATE public.journal_entries SET status = 'posted' WHERE id = $1`,
    [id],
  )
  return id
}

// Insert a document_attachment row already linked to a journal entry, so
// tests can exercise the bidirectional immutability trigger on the
// journal_entry_id column.
async function insertDocumentLinkedToEntry(params: {
  userId: string
  companyId: string
  journalEntryId: string
}): Promise<string> {
  const id = randomUUID()
  await getPool().query(
    `INSERT INTO public.document_attachments
       (id, user_id, company_id, storage_path, file_name, sha256_hash,
        journal_entry_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      params.userId,
      params.companyId,
      `test/${id}.pdf`,
      'receipt.pdf',
      'a'.repeat(64),
      params.journalEntryId,
    ],
  )
  return id
}

describe('delete_last_voucher.pg — RPC + immutability trigger interaction', () => {
  it('deletes the last posted voucher in a series', async () => {
    const { userId, companyId, fiscalPeriodId } = await seedCompany()
    const entryId = await insertPostedEntryWithLines({
      userId, companyId, fiscalPeriodId, voucherNumber: 1,
    })

    await withUserContext(userId, async (client) => {
      await client.query(
        `SELECT public.delete_last_voucher($1::uuid, $2::uuid)`,
        [companyId, entryId],
      )
      // Verify inside the txn — withUserContext rolls back on exit, so an
      // outer pool query would see the row again.
      const after = await client.query(
        `SELECT 1 FROM public.journal_entries WHERE id = $1`,
        [entryId],
      )
      expect(after.rowCount).toBe(0)
    })
  })

  it('flips original from reversed back to posted when its storno is deleted', async () => {
    const { userId, companyId, fiscalPeriodId } = await seedCompany()

    const originalId = await insertPostedEntryWithLines({
      userId, companyId, fiscalPeriodId, voucherNumber: 1,
    })

    // Storno: insert with reverses_id already set so the immutability trigger
    // never sees an UPDATE that adds it after the fact.
    const stornoId = await insertPostedEntryWithLines({
      userId, companyId, fiscalPeriodId, voucherNumber: 2,
      sourceType: 'storno', reversesId: originalId,
    })

    // Mark original as reversed — posted → reversed is allowed by the state
    // machine as long as no other fields change.
    await getPool().query(
      `UPDATE public.journal_entries SET status = 'reversed', reversed_by_id = $1 WHERE id = $2`,
      [stornoId, originalId],
    )

    await withUserContext(userId, async (client) => {
      await client.query(
        `SELECT public.delete_last_voucher($1::uuid, $2::uuid)`,
        [companyId, stornoId],
      )
      const restored = await client.query<{ status: string; reversed_by_id: string | null }>(
        `SELECT status, reversed_by_id FROM public.journal_entries WHERE id = $1`,
        [originalId],
      )
      expect(restored.rows[0]!.status).toBe('posted')
      expect(restored.rows[0]!.reversed_by_id).toBeNull()
    })
  })

  it('blocks direct DELETE on a posted entry without the bypass flag', async () => {
    const { userId, companyId, fiscalPeriodId } = await seedCompany()
    const entryId = await insertPostedEntryWithLines({
      userId, companyId, fiscalPeriodId, voucherNumber: 1,
    })

    await expect(
      getPool().query(`DELETE FROM public.journal_entries WHERE id = $1`, [entryId]),
    ).rejects.toThrow(/Cannot delete journal entries/i)
  })

  it('blocks UPDATE of arbitrary fields on a posted entry even when bypass flag is set', async () => {
    const { userId, companyId, fiscalPeriodId } = await seedCompany()
    const entryId = await insertPostedEntryWithLines({
      userId, companyId, fiscalPeriodId, voucherNumber: 1,
    })

    const client = await getPool().connect()
    try {
      await client.query(`SELECT set_config('gnubok.allow_delete', 'true', true)`)
      await expect(
        client.query(
          `UPDATE public.journal_entries SET description = 'tampered' WHERE id = $1`,
          [entryId],
        ),
      ).rejects.toThrow(/Cannot modify a posted journal entry/i)
    } finally {
      client.release()
    }
  })

  it('clears journal_entry_id on attached documents and deletes the voucher', async () => {
    // Regression for the document-immutability triggers ignoring the
    // gnubok.allow_delete bypass. delete_last_voucher unlinks documents
    // (UPDATE document_attachments SET journal_entry_id = NULL) before
    // deleting the entry; if the trigger refused the unlink the whole RPC
    // would fail and the entry would remain.
    const { userId, companyId, fiscalPeriodId } = await seedCompany()
    const entryId = await insertPostedEntryWithLines({
      userId, companyId, fiscalPeriodId, voucherNumber: 1,
    })
    const docId = randomUUID()
    await getPool().query(
      `INSERT INTO public.document_attachments
         (id, user_id, company_id, storage_path, file_name, file_size_bytes,
          mime_type, sha256_hash, journal_entry_id)
       VALUES ($1, $2, $3, $4, 'underlag.pdf', 1024, 'application/pdf', $5, $6)`,
      [
        docId,
        userId,
        companyId,
        `documents/${userId}/${docId}.pdf`,
        'a'.repeat(64),
        entryId,
      ],
    )

    await withUserContext(userId, async (client) => {
      await client.query(
        `SELECT public.delete_last_voucher($1::uuid, $2::uuid)`,
        [companyId, entryId],
      )
      const entryAfter = await client.query(
        `SELECT 1 FROM public.journal_entries WHERE id = $1`,
        [entryId],
      )
      expect(entryAfter.rowCount).toBe(0)
      const docAfter = await client.query<{ journal_entry_id: string | null }>(
        `SELECT journal_entry_id FROM public.document_attachments WHERE id = $1`,
        [docId],
      )
      expect(docAfter.rows[0]!.journal_entry_id).toBeNull()
    })
  })

  it('blocks reversed → posted UPDATE without the bypass flag', async () => {
    const { userId, companyId, fiscalPeriodId } = await seedCompany()
    const entryId = await insertPostedEntryWithLines({
      userId, companyId, fiscalPeriodId, voucherNumber: 1,
    })
    await getPool().query(
      `UPDATE public.journal_entries SET status = 'reversed' WHERE id = $1`,
      [entryId],
    )

    await expect(
      getPool().query(
        `UPDATE public.journal_entries SET status = 'posted' WHERE id = $1`,
        [entryId],
      ),
    ).rejects.toThrow(/Cannot modify a reversed journal entry/i)
  })

  // The bypass must remain narrow: an unauthorized direct UPDATE that clears
  // journal_entry_id outside delete_last_voucher (no gnubok.allow_delete
  // transaction-local flag) must still raise BFL_DOCUMENT_IMMUTABILITY.
  it('blocks direct UPDATE that nulls journal_entry_id without the bypass flag', async () => {
    const { userId, companyId, fiscalPeriodId } = await seedCompany()
    const entryId = await insertPostedEntryWithLines({
      userId, companyId, fiscalPeriodId, voucherNumber: 1,
    })
    const documentId = await insertDocumentLinkedToEntry({
      userId, companyId, journalEntryId: entryId,
    })

    await expect(
      getPool().query(
        `UPDATE public.document_attachments SET journal_entry_id = NULL WHERE id = $1`,
        [documentId],
      ),
    ).rejects.toThrow(/BFL_DOCUMENT_IMMUTABILITY/)
  })
})
