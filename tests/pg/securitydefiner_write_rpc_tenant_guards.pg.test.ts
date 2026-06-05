/**
 * pg-real test for the SECURITY DEFINER write-RPC tenant guards
 * (20260619120100_securitydefiner_write_rpc_tenant_guards.sql).
 *
 * Six SECURITY DEFINER write RPCs are EXECUTE-able by `authenticated` and so,
 * without an in-function tenant guard, an authenticated user could call them via
 * PostgREST with ANOTHER company's p_company_id. The migration adds the canonical
 * claims-based guard (mirrors 20260615120000_link_voucher_rpcs_tenant_guard.sql):
 * for anon/authenticated callers, membership of p_company_id is required, else
 * RAISE 42501; service_role / no-claims callers bypass BY DESIGN (MCP / API-key /
 * migration / pg-harness paths whose company scoping happens elsewhere).
 *
 * What each case asserts:
 *   - cross-tenant (userA's session, companyB's id) → RAISE with SQLSTATE 42501.
 *   - own company (userA's session, companyA's id) → the guard does NOT fire;
 *     the call either succeeds or fails with a NON-42501 domain error. For the
 *     two RPCs with no other gate (reserve/release_voucher_range) and for
 *     rotate_company_inbox the own-company call fully succeeds; for the others a
 *     non-guard outcome is sufficient and is documented inline.
 *   - no-claims bare-pool cross-tenant → guard bypassed (no 42501), proving the
 *     MCP / service-role paths are unaffected.
 *
 * The role-claim simulation technique (set request.jwt.claims + SET LOCAL ROLE)
 * follows tests/pg/gl_lines_rpc_tenant_guard.pg.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool } from './setup'
import { seedCompany } from './fixtures'

interface PgError extends Error {
  code?: string
}

/**
 * Run `sql` as an authenticated user session (request.jwt.claims role =
 * authenticated + SET LOCAL ROLE authenticated) in its own transaction, always
 * rolling back. Returns the thrown PgError (or null if it succeeded). A 42501
 * guard rejection aborts the transaction, so each probe gets a fresh one.
 */
async function callAsUser(
  userId: string,
  sql: string,
  params: unknown[],
): Promise<PgError | null> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ])
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId])
    await client.query('SET LOCAL ROLE authenticated')
    await client.query(sql, params)
    return null
  } catch (err) {
    return err as PgError
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    client.release()
  }
}

/**
 * Run `sql` on the bare superuser pool with NO request.jwt.claims — the trusted
 * bypass that migrations, this harness and the service-role / MCP API paths rely
 * on. Wrapped in a rolled-back transaction so writes don't persist. Returns the
 * thrown PgError or null.
 */
async function callBare(sql: string, params: unknown[]): Promise<PgError | null> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await client.query(sql, params)
    return null
  } catch (err) {
    return err as PgError
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    client.release()
  }
}

// Posted bank-account IB usable by mark_entry_as_opening_balance.
async function insertPostedManualIb(params: {
  userId: string
  companyId: string
  fiscalPeriodId: string
}): Promise<string> {
  const id = randomUUID()
  await getPool().query(
    `INSERT INTO public.journal_entries
       (id, user_id, company_id, fiscal_period_id, voucher_number, voucher_series,
        entry_date, description, source_type, status)
     VALUES ($1, $2, $3, $4, $5, 'A', '2026-01-01', 'Ingående balanser 2026', 'manual', 'draft')`,
    [id, params.userId, params.companyId, params.fiscalPeriodId, Math.floor(Math.random() * 100000) + 1],
  )
  await getPool().query(
    `INSERT INTO public.journal_entry_lines
       (journal_entry_id, account_number, debit_amount, credit_amount)
     VALUES ($1, '1930', 5000, 0),
            ($1, '2099', 0, 5000)`,
    [id],
  )
  await getPool().query(`UPDATE public.journal_entries SET status = 'posted' WHERE id = $1`, [id])
  return id
}

const BULK_BOOK = `SELECT public.bulk_book_transactions($1::uuid[], $2, $3::jsonb, $4)`
const MATCH_BATCH = `SELECT public.match_batch_allocate($1, $2::jsonb, $3)`
const MARK_OB = `SELECT public.mark_entry_as_opening_balance($1, $2)`
const RESERVE = `SELECT public.reserve_voucher_range($1, $2, $3, $4)`
const RELEASE = `SELECT public.release_voucher_range($1, $2, $3, $4, $5)`
const ROTATE = `SELECT public.rotate_company_inbox($1)`

describe('SECURITY DEFINER write RPCs — tenant-isolation guard', () => {
  it('bulk_book_transactions: blocks cross-company, passes own, bypasses for no-claims', async () => {
    const a = await seedCompany()
    const b = await seedCompany()
    const newEntry = {
      description: 'x',
      lines: [
        { account_number: '1930', debit_amount: 100, credit_amount: 0, currency: 'SEK' },
        { account_number: '3001', debit_amount: 0, credit_amount: 100, currency: 'SEK' },
      ],
    }
    const txIds = [randomUUID()] // non-existent — guard runs first regardless.

    // userA session targeting companyB → 42501.
    const cross = await callAsUser(a.userId, BULK_BOOK, [txIds, null, JSON.stringify(newEntry), b.companyId])
    expect(cross?.code).toBe('42501')

    // userA session targeting own companyA → guard passes; the call then fails a
    // DOMAIN check (txs not found), returned as jsonb, NOT a 42501 raise.
    const own = await callAsUser(a.userId, BULK_BOOK, [txIds, null, JSON.stringify(newEntry), a.companyId])
    expect(own).toBeNull()

    // No-claims bare pool targeting companyB → guard bypassed (no 42501); the
    // membership check inside the body then short-circuits to a jsonb result.
    const bare = await callBare(BULK_BOOK, [txIds, null, JSON.stringify(newEntry), b.companyId])
    expect(bare).toBeNull()
  })

  it('match_batch_allocate: blocks cross-company, passes own, bypasses for no-claims', async () => {
    const a = await seedCompany()
    const b = await seedCompany()
    const allocations = [{ kind: 'customer_invoice', invoice_id: randomUUID(), amount: 100 }]
    const txId = randomUUID()

    const cross = await callAsUser(a.userId, MATCH_BATCH, [txId, JSON.stringify(allocations), b.companyId])
    expect(cross?.code).toBe('42501')

    // Own company: guard passes; BATCH_TX_NOT_FOUND returned as jsonb (no raise).
    const own = await callAsUser(a.userId, MATCH_BATCH, [txId, JSON.stringify(allocations), a.companyId])
    expect(own).toBeNull()

    const bare = await callBare(MATCH_BATCH, [txId, JSON.stringify(allocations), b.companyId])
    expect(bare).toBeNull()
  })

  it('mark_entry_as_opening_balance: blocks cross-company, passes own, bypasses for no-claims', async () => {
    const a = await seedCompany()
    const b = await seedCompany()
    const entryA = await insertPostedManualIb({
      userId: a.userId,
      companyId: a.companyId,
      fiscalPeriodId: a.fiscalPeriodId,
    })

    // userA (member of A only) targeting companyB → 42501 before any work.
    const cross = await callAsUser(a.userId, MARK_OB, [b.companyId, entryA])
    expect(cross?.code).toBe('42501')

    // Own company, owner of A, valid posted manual IB → full success (no raise).
    const own = await callAsUser(a.userId, MARK_OB, [a.companyId, entryA])
    expect(own).toBeNull()

    // No-claims bare pool cross-referencing companyB with A's entry: guard
    // bypassed. It then raises a NON-guard domain error ("Journal entry not
    // found" — the entry is not in companyB), proving the bypass is real.
    const bare = await callBare(MARK_OB, [b.companyId, entryA])
    expect(bare?.code).not.toBe('42501')
  })

  it('reserve_voucher_range: blocks cross-company, passes own, bypasses for no-claims', async () => {
    const a = await seedCompany()
    const b = await seedCompany()

    const cross = await callAsUser(a.userId, RESERVE, [b.companyId, b.fiscalPeriodId, 'A', 10])
    expect(cross?.code).toBe('42501')

    // Own company → succeeds (void). No other gate exists on this RPC, so this
    // is the cleanest proof the guard does not break the legitimate path.
    const own = await callAsUser(a.userId, RESERVE, [a.companyId, a.fiscalPeriodId, 'A', 10])
    expect(own).toBeNull()

    // No-claims bare pool cross-tenant → the new tenant guard is bypassed. (The
    // INSERT then writes auth.uid()=NULL into voucher_sequences.user_id, which is
    // NOT NULL, so a 23502 surfaces — pre-existing behaviour for a true no-session
    // caller; the point here is only that it is NOT the 42501 tenant guard.)
    const bare = await callBare(RESERVE, [b.companyId, b.fiscalPeriodId, 'A', 10])
    expect(bare?.code).not.toBe('42501')
  })

  it('release_voucher_range: blocks cross-company, passes own, bypasses for no-claims', async () => {
    const a = await seedCompany()
    const b = await seedCompany()

    const cross = await callAsUser(a.userId, RELEASE, [b.companyId, b.fiscalPeriodId, 'A', 5, 10])
    expect(cross?.code).toBe('42501')

    // Own company → succeeds (void no-op against an empty sequence).
    const own = await callAsUser(a.userId, RELEASE, [a.companyId, a.fiscalPeriodId, 'A', 5, 10])
    expect(own).toBeNull()

    const bare = await callBare(RELEASE, [b.companyId, b.fiscalPeriodId, 'A', 5, 10])
    expect(bare).toBeNull()
  })

  it('rotate_company_inbox: blocks cross-company, passes own, bypasses for no-claims', async () => {
    const a = await seedCompany()
    const b = await seedCompany()

    const cross = await callAsUser(a.userId, ROTATE, [b.companyId])
    expect(cross?.code).toBe('42501')

    // Own company, owner of A → succeeds (creates an active inbox row).
    const own = await callAsUser(a.userId, ROTATE, [a.companyId])
    expect(own).toBeNull()

    // No-claims bare pool cross-tenant → the NEW claims-based tenant guard is
    // bypassed (role is not anon/authenticated). rotate_company_inbox is only
    // ever called from a user session (auth.uid() present), so unlike the other
    // five it has no service-role caller; the pre-existing owner/admin check
    // (auth.uid() NULL → no membership) still raises 42501 here. Disambiguate by
    // message: the bypass is proven by the new guard's message NOT appearing.
    const bare = await callBare(ROTATE, [b.companyId])
    expect(bare?.message ?? '').not.toMatch(/caller is not a member of company/i)
  })
})
