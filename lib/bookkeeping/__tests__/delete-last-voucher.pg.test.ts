import { describe, expect, it } from 'vitest'
import { getPool, withUserContext } from '@/tests/pg/setup'
import {
  insertBalancedLines,
  insertDraftJournalEntry,
  seedCompany,
} from '@/tests/pg/fixtures'

describe('delete_last_voucher.pg — RPC + immutability trigger interaction', () => {
  it('deletes the last posted voucher in a series', async () => {
    const { userId, companyId, fiscalPeriodId } = await seedCompany()

    const entryId = await insertDraftJournalEntry({
      userId,
      companyId,
      fiscalPeriodId,
      status: 'posted',
      voucherNumber: 1,
    })
    await insertBalancedLines(entryId)

    await withUserContext(userId, async (client) => {
      const res = await client.query<{ deleted: boolean }>(
        `SELECT (public.delete_last_voucher($1::uuid, $2::uuid)->>'deleted')::boolean AS deleted`,
        [companyId, entryId],
      )
      expect(res.rows[0]!.deleted).toBe(true)
    })

    const after = await getPool().query(
      `SELECT 1 FROM public.journal_entries WHERE id = $1`,
      [entryId],
    )
    expect(after.rowCount).toBe(0)
  })

  it('flips original from reversed back to posted when its storno is deleted', async () => {
    const { userId, companyId, fiscalPeriodId } = await seedCompany()

    const originalId = await insertDraftJournalEntry({
      userId, companyId, fiscalPeriodId,
      status: 'posted', voucherNumber: 1,
    })
    await insertBalancedLines(originalId)

    const stornoId = await insertDraftJournalEntry({
      userId, companyId, fiscalPeriodId,
      status: 'posted', voucherNumber: 2,
    })
    await insertBalancedLines(stornoId)

    await getPool().query(
      `UPDATE public.journal_entries SET reverses_id = $1 WHERE id = $2`,
      [originalId, stornoId],
    )
    await getPool().query(
      `UPDATE public.journal_entries SET status = 'reversed', reversed_by_id = $1 WHERE id = $2`,
      [stornoId, originalId],
    )

    await withUserContext(userId, async (client) => {
      await client.query(
        `SELECT public.delete_last_voucher($1::uuid, $2::uuid)`,
        [companyId, stornoId],
      )
    })

    const restored = await getPool().query<{ status: string; reversed_by_id: string | null }>(
      `SELECT status, reversed_by_id FROM public.journal_entries WHERE id = $1`,
      [originalId],
    )
    expect(restored.rows[0]!.status).toBe('posted')
    expect(restored.rows[0]!.reversed_by_id).toBeNull()
  })

  it('blocks direct DELETE on a posted entry without the bypass flag', async () => {
    const { userId, companyId, fiscalPeriodId } = await seedCompany()

    const entryId = await insertDraftJournalEntry({
      userId, companyId, fiscalPeriodId,
      status: 'posted', voucherNumber: 1,
    })
    await insertBalancedLines(entryId)

    await expect(
      getPool().query(`DELETE FROM public.journal_entries WHERE id = $1`, [entryId]),
    ).rejects.toThrow(/Cannot delete journal entries/i)
  })

  it('blocks UPDATE of arbitrary fields on a posted entry even when bypass flag is set', async () => {
    const { userId, companyId, fiscalPeriodId } = await seedCompany()

    const entryId = await insertDraftJournalEntry({
      userId, companyId, fiscalPeriodId,
      status: 'posted', voucherNumber: 1,
    })
    await insertBalancedLines(entryId)

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

  it('blocks reversed → posted UPDATE without the bypass flag', async () => {
    const { userId, companyId, fiscalPeriodId } = await seedCompany()

    const entryId = await insertDraftJournalEntry({
      userId, companyId, fiscalPeriodId,
      status: 'posted', voucherNumber: 1,
    })
    await insertBalancedLines(entryId)
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
})
