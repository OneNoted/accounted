import { randomUUID } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { getPool, withUserContext } from './setup'
import { seedCompany, insertAuthUser } from './fixtures'

// pg-real coverage for 20260622120000_bolagsverket_arsredovisning_submissions:
// RLS isolation on all three tables, the post-upload immutability trigger, and
// the status-transition state machine (GUIDE §5.2.2).

async function insertSubmission(
  companyId: string,
  userId: string,
  fiscalPeriodId: string,
  overrides: { status?: string; uploadedAt?: string | null; idnummer?: string | null } = {},
): Promise<string> {
  const id = randomUUID()
  await getPool().query(
    `INSERT INTO public.arsredovisning_submissions
       (id, company_id, user_id, fiscal_period_id, taxonomy_version, entry_point, status, uploaded_at, idnummer)
     VALUES ($1, $2, $3, $4, '2024-09-12', 'k2-ab-risbs-2024-09-12', $5, $6, $7)`,
    [
      id,
      companyId,
      userId,
      fiscalPeriodId,
      overrides.status ?? 'draft',
      overrides.uploadedAt ?? null,
      overrides.idnummer ?? null,
    ],
  )
  return id
}

describe('arsredovisning_submissions RLS', () => {
  it('members see their company rows, outsiders see nothing', async () => {
    const { userId, companyId, fiscalPeriodId } = await seedCompany()
    const outsider = await insertAuthUser()
    await insertSubmission(companyId, userId, fiscalPeriodId)

    const ownRows = await withUserContext(userId, async (client) => {
      const res = await client.query(
        `SELECT id FROM public.arsredovisning_submissions WHERE company_id = $1`,
        [companyId],
      )
      return res.rowCount
    })
    expect(ownRows).toBe(1)

    const outsiderRows = await withUserContext(outsider, async (client) => {
      const res = await client.query(
        `SELECT id FROM public.arsredovisning_submissions WHERE company_id = $1`,
        [companyId],
      )
      return res.rowCount
    })
    expect(outsiderRows).toBe(0)
  })

  it('users cannot DELETE submissions (no policy — audit trail)', async () => {
    const { userId, companyId, fiscalPeriodId } = await seedCompany()
    const id = await insertSubmission(companyId, userId, fiscalPeriodId)

    const deleted = await withUserContext(userId, async (client) => {
      const res = await client.query(
        `DELETE FROM public.arsredovisning_submissions WHERE id = $1`,
        [id],
      )
      return res.rowCount
    })
    expect(deleted).toBe(0)
  })
})

describe('arsredovisning_submissions immutability after upload', () => {
  it('freezes identity/fingerprint columns once uploaded_at is set', async () => {
    const { userId, companyId, fiscalPeriodId } = await seedCompany()
    const id = await insertSubmission(companyId, userId, fiscalPeriodId, {
      status: 'uploaded',
      uploadedAt: new Date().toISOString(),
      idnummer: '49679',
    })

    await expect(
      getPool().query(
        `UPDATE public.arsredovisning_submissions SET idnummer = 'tampered' WHERE id = $1`,
        [id],
      ),
    ).rejects.toThrow(/kan inte ändras/)

    await expect(
      getPool().query(
        `UPDATE public.arsredovisning_submissions SET taxonomy_version = '2021-10-31' WHERE id = $1`,
        [id],
      ),
    ).rejects.toThrow(/kan inte ändras/)
  })

  it('still allows status-tracking updates after upload', async () => {
    const { userId, companyId, fiscalPeriodId } = await seedCompany()
    const id = await insertSubmission(companyId, userId, fiscalPeriodId, {
      status: 'uploaded',
      uploadedAt: new Date().toISOString(),
    })

    const res = await getPool().query(
      `UPDATE public.arsredovisning_submissions
         SET status = 'inkommen', error_message = NULL
       WHERE id = $1 RETURNING status`,
      [id],
    )
    expect(res.rows[0].status).toBe('inkommen')
  })

  it('draft rows remain freely editable', async () => {
    const { userId, companyId, fiscalPeriodId } = await seedCompany()
    const id = await insertSubmission(companyId, userId, fiscalPeriodId)
    const res = await getPool().query(
      `UPDATE public.arsredovisning_submissions
         SET entry_point = 'k2-ab-risbs-2024-09-12', kontrollera_utfall = '[]'::jsonb
       WHERE id = $1 RETURNING entry_point`,
      [id],
    )
    expect(res.rows[0].entry_point).toBe('k2-ab-risbs-2024-09-12')
  })
})

describe('arsredovisning_submissions status machine', () => {
  it('follows the documented flow inkommen → forelagd → komplettering → registrerad', async () => {
    const { userId, companyId, fiscalPeriodId } = await seedCompany()
    const id = await insertSubmission(companyId, userId, fiscalPeriodId, {
      status: 'uploaded',
      uploadedAt: new Date().toISOString(),
    })
    for (const next of ['inkommen', 'forelagd', 'komplettering', 'registrerad']) {
      await getPool().query(
        `UPDATE public.arsredovisning_submissions SET status = $2 WHERE id = $1`,
        [id, next],
      )
    }
    const final = await getPool().query(
      `SELECT status, registered_at FROM public.arsredovisning_submissions WHERE id = $1`,
      [id],
    )
    expect(final.rows[0].status).toBe('registrerad')
  })

  it('rejects undocumented transitions (registrerad → draft, draft → inkommen)', async () => {
    const { userId, companyId, fiscalPeriodId } = await seedCompany()
    const id = await insertSubmission(companyId, userId, fiscalPeriodId, {
      status: 'uploaded',
      uploadedAt: new Date().toISOString(),
    })
    await getPool().query(
      `UPDATE public.arsredovisning_submissions SET status = 'registrerad' WHERE id = $1`,
      [id],
    )
    await expect(
      getPool().query(
        `UPDATE public.arsredovisning_submissions SET status = 'draft' WHERE id = $1`,
        [id],
      ),
    ).rejects.toThrow(/Ogiltig statusövergång/)

    const draftId = await insertSubmission(companyId, userId, fiscalPeriodId)
    await expect(
      getPool().query(
        `UPDATE public.arsredovisning_submissions SET status = 'inkommen' WHERE id = $1`,
        [draftId],
      ),
    ).rejects.toThrow(/Ogiltig statusövergång/)
  })
})

describe('bolagsverket_avtal_acceptances', () => {
  it('is insert-once per (company, user, avtalstext version) and RLS-scoped', async () => {
    const { userId, companyId } = await seedCompany()
    const outsider = await insertAuthUser()

    await withUserContext(userId, async (client) => {
      await client.query(
        `INSERT INTO public.bolagsverket_avtal_acceptances (company_id, user_id, avtalstext_andrad)
         VALUES ($1, $2, '2017-12-06')`,
        [companyId, userId],
      )
      await expect(
        client.query(
          `INSERT INTO public.bolagsverket_avtal_acceptances (company_id, user_id, avtalstext_andrad)
           VALUES ($1, $2, '2017-12-06')`,
          [companyId, userId],
        ),
      ).rejects.toThrow(/duplicate key/)
    })

    // Outsider cannot accept on behalf of someone else's company.
    await withUserContext(outsider, async (client) => {
      await expect(
        client.query(
          `INSERT INTO public.bolagsverket_avtal_acceptances (company_id, user_id, avtalstext_andrad)
           VALUES ($1, $2, '2017-12-06')`,
          [companyId, outsider],
        ),
      ).rejects.toThrow(/row-level security/)
    })
  })
})

describe('bolagsverket_subscriptions', () => {
  it('is unique per (company, orgnr, url, environment) and RLS-scoped', async () => {
    const { userId, companyId } = await seedCompany()
    const outsider = await insertAuthUser()
    await getPool().query(
      `INSERT INTO public.bolagsverket_subscriptions
         (company_id, user_id, orgnr, url, auth_secret, environment, expires_at)
       VALUES ($1, $2, '5560001111', 'https://example.test/hook', 's3cret', 'test', now() + interval '6 months')`,
      [companyId, userId],
    )
    await expect(
      getPool().query(
        `INSERT INTO public.bolagsverket_subscriptions
           (company_id, user_id, orgnr, url, auth_secret, environment, expires_at)
         VALUES ($1, $2, '5560001111', 'https://example.test/hook', 'other', 'test', now() + interval '6 months')`,
        [companyId, userId],
      ),
    ).rejects.toThrow(/duplicate key/)

    const visible = await withUserContext(outsider, async (client) => {
      const res = await client.query(
        `SELECT id FROM public.bolagsverket_subscriptions WHERE company_id = $1`,
        [companyId],
      )
      return res.rowCount
    })
    expect(visible).toBe(0)
  })
})
