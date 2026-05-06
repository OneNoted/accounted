import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { getPool } from '@/tests/pg/setup'
import {
  insertBalancedLines,
  insertDraftJournalEntry,
  seedCompany,
} from '@/tests/pg/fixtures'

// Inline because there is no shared documents fixture and pg-real tests are
// intentionally minimal — only the columns the trigger needs.
async function insertDocument(params: {
  userId: string
  companyId: string
  journalEntryId: string | null
  journalEntryLineId?: string | null
}): Promise<string> {
  const id = randomUUID()
  await getPool().query(
    `INSERT INTO public.document_attachments
       (id, user_id, company_id, storage_path, file_name, file_size_bytes,
        mime_type, sha256_hash, journal_entry_id, journal_entry_line_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      params.userId,
      params.companyId,
      `documents/${params.userId}/${id}.pdf`,
      'underlag.pdf',
      1024,
      'application/pdf',
      'a'.repeat(64),
      params.journalEntryId,
      params.journalEntryLineId ?? null,
    ],
  )
  return id
}

async function insertPostedEntry(params: {
  userId: string
  companyId: string
  fiscalPeriodId: string
  voucherNumber: number
  status?: 'posted' | 'reversed'
}): Promise<string> {
  const entryId = await insertDraftJournalEntry({
    userId: params.userId,
    companyId: params.companyId,
    fiscalPeriodId: params.fiscalPeriodId,
    voucherNumber: params.voucherNumber,
  })
  await insertBalancedLines(entryId)
  await getPool().query(
    `UPDATE public.journal_entries SET status = $1 WHERE id = $2`,
    [params.status ?? 'posted', entryId],
  )
  return entryId
}

describe('document-immutability.pg — BFL 7 kap retention bypass guards', () => {
  it('rejects unlinking (journal_entry_id → NULL) on a doc linked to a posted entry', async () => {
    const { userId, companyId, fiscalPeriodId } = await seedCompany()
    const entryId = await insertPostedEntry({
      userId, companyId, fiscalPeriodId, voucherNumber: 1,
    })
    const docId = await insertDocument({ userId, companyId, journalEntryId: entryId })

    await expect(
      getPool().query(
        `UPDATE public.document_attachments SET journal_entry_id = NULL WHERE id = $1`,
        [docId],
      ),
    ).rejects.toThrow(/BFL 7 kap/i)
  })

  it('rejects unlinking on a doc linked to a reversed entry', async () => {
    const { userId, companyId, fiscalPeriodId } = await seedCompany()
    const entryId = await insertPostedEntry({
      userId, companyId, fiscalPeriodId, voucherNumber: 1, status: 'reversed',
    })
    const docId = await insertDocument({ userId, companyId, journalEntryId: entryId })

    await expect(
      getPool().query(
        `UPDATE public.document_attachments SET journal_entry_id = NULL WHERE id = $1`,
        [docId],
      ),
    ).rejects.toThrow(/BFL 7 kap/i)
  })

  it('allows unlinking on a doc linked to a draft entry (drafts are mutable)', async () => {
    const { userId, companyId, fiscalPeriodId } = await seedCompany()
    const draftId = await insertDraftJournalEntry({
      userId, companyId, fiscalPeriodId, voucherNumber: 0,
    })
    const docId = await insertDocument({ userId, companyId, journalEntryId: draftId })

    await getPool().query(
      `UPDATE public.document_attachments SET journal_entry_id = NULL WHERE id = $1`,
      [docId],
    )
    const after = await getPool().query<{ journal_entry_id: string | null }>(
      `SELECT journal_entry_id FROM public.document_attachments WHERE id = $1`,
      [docId],
    )
    expect(after.rows[0]!.journal_entry_id).toBeNull()
  })

  it('rejects re-pointing journal_entry_id to a different posted entry', async () => {
    const { userId, companyId, fiscalPeriodId } = await seedCompany()
    const entryA = await insertPostedEntry({
      userId, companyId, fiscalPeriodId, voucherNumber: 1,
    })
    const entryB = await insertPostedEntry({
      userId, companyId, fiscalPeriodId, voucherNumber: 2,
    })
    const docId = await insertDocument({ userId, companyId, journalEntryId: entryA })

    await expect(
      getPool().query(
        `UPDATE public.document_attachments SET journal_entry_id = $1 WHERE id = $2`,
        [entryB, docId],
      ),
    ).rejects.toThrow(/BFL 7 kap/i)
  })

  it('allows first-time linking (NULL → UUID) — legitimate linkToJournalEntry path', async () => {
    const { userId, companyId, fiscalPeriodId } = await seedCompany()
    const entryId = await insertPostedEntry({
      userId, companyId, fiscalPeriodId, voucherNumber: 1,
    })
    const docId = await insertDocument({ userId, companyId, journalEntryId: null })

    await getPool().query(
      `UPDATE public.document_attachments SET journal_entry_id = $1 WHERE id = $2`,
      [entryId, docId],
    )
    const after = await getPool().query<{ journal_entry_id: string | null }>(
      `SELECT journal_entry_id FROM public.document_attachments WHERE id = $1`,
      [docId],
    )
    expect(after.rows[0]!.journal_entry_id).toBe(entryId)
  })

  it('rejects unlinking journal_entry_line_id on a doc linked to a posted entry', async () => {
    const { userId, companyId, fiscalPeriodId } = await seedCompany()
    const entryId = await insertPostedEntry({
      userId, companyId, fiscalPeriodId, voucherNumber: 1,
    })
    const lineRow = await getPool().query<{ id: string }>(
      `SELECT id FROM public.journal_entry_lines WHERE journal_entry_id = $1 LIMIT 1`,
      [entryId],
    )
    const lineId = lineRow.rows[0]!.id
    const docId = await insertDocument({
      userId, companyId, journalEntryId: entryId, journalEntryLineId: lineId,
    })

    await expect(
      getPool().query(
        `UPDATE public.document_attachments SET journal_entry_line_id = NULL WHERE id = $1`,
        [docId],
      ),
    ).rejects.toThrow(/BFL 7 kap/i)
  })

  it('end-to-end: unlink-then-delete attack is blocked at the unlink step', async () => {
    const { userId, companyId, fiscalPeriodId } = await seedCompany()
    const entryId = await insertPostedEntry({
      userId, companyId, fiscalPeriodId, voucherNumber: 1,
    })
    const docId = await insertDocument({ userId, companyId, journalEntryId: entryId })

    // Step 1 of attack now blocked. block_document_deletion would also have
    // caught a direct DELETE — this asserts the unlink hole is closed.
    await expect(
      getPool().query(
        `UPDATE public.document_attachments SET journal_entry_id = NULL WHERE id = $1`,
        [docId],
      ),
    ).rejects.toThrow(/BFL 7 kap/i)

    // Direct DELETE is also still blocked by the existing trigger.
    await expect(
      getPool().query(`DELETE FROM public.document_attachments WHERE id = $1`, [docId]),
    ).rejects.toThrow(/Bokföringslagen/i)
  })

  it('respects gnubok.allow_delete bypass — delete_last_voucher RPC keeps working', async () => {
    const { userId, companyId, fiscalPeriodId } = await seedCompany()
    const entryId = await insertPostedEntry({
      userId, companyId, fiscalPeriodId, voucherNumber: 1,
    })
    const docId = await insertDocument({ userId, companyId, journalEntryId: entryId })

    const client = await getPool().connect()
    try {
      await client.query('BEGIN')
      await client.query(`SELECT set_config('gnubok.allow_delete', 'true', true)`)
      await client.query(
        `UPDATE public.document_attachments SET journal_entry_id = NULL WHERE id = $1`,
        [docId],
      )
      const after = await client.query<{ journal_entry_id: string | null }>(
        `SELECT journal_entry_id FROM public.document_attachments WHERE id = $1`,
        [docId],
      )
      expect(after.rows[0]!.journal_entry_id).toBeNull()
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
  })
})
