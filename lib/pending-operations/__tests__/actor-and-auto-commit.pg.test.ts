/**
 * pg-real smoke tests for the four migrations introduced by the
 * AI-native streams (actor model, auto-commit, expanded op types, idempotency).
 *
 * These don't replicate the unit-test coverage — they prove the schema and
 * constraints behave as the application code assumes when running against a
 * real Postgres with the migrations applied.
 */
import { describe, expect, it } from 'vitest'
import { getPool } from '@/tests/pg/setup'
import { seedCompany } from '@/tests/pg/fixtures'

describe('pending_operations: actor model + risk + auto-commit columns', () => {
  it('accepts the expanded actor_type and risk_level enums', async () => {
    const { userId, companyId } = await seedCompany()
    const pool = getPool()

    const result = await pool.query<{
      id: string
      actor_type: string
      risk_level: string
      auto_commit_eligible: boolean
    }>(
      `INSERT INTO public.pending_operations (
         user_id, company_id, operation_type, title, params, preview_data,
         actor_type, actor_id, actor_label, risk_level, auto_commit_eligible
       ) VALUES ($1, $2, 'create_customer', 'pg-real test', '{}', '{}',
                 'api_key', NULL, 'Claude Desktop', 'low', true)
       RETURNING id, actor_type, risk_level, auto_commit_eligible`,
      [userId, companyId],
    )

    expect(result.rows[0]).toMatchObject({
      actor_type: 'api_key',
      risk_level: 'low',
      auto_commit_eligible: true,
    })
  })

  it('rejects invalid actor_type via CHECK constraint', async () => {
    const { userId, companyId } = await seedCompany()
    await expect(
      getPool().query(
        `INSERT INTO public.pending_operations (
           user_id, company_id, operation_type, title, params, preview_data, actor_type, risk_level
         ) VALUES ($1, $2, 'create_customer', 'x', '{}', '{}', 'martian', 'low')`,
        [userId, companyId],
      ),
    ).rejects.toThrow(/check constraint|actor_type/i)
  })

  it('rejects invalid risk_level via CHECK constraint', async () => {
    const { userId, companyId } = await seedCompany()
    await expect(
      getPool().query(
        `INSERT INTO public.pending_operations (
           user_id, company_id, operation_type, title, params, preview_data, actor_type, risk_level
         ) VALUES ($1, $2, 'create_customer', 'x', '{}', '{}', 'user', 'critical')`,
        [userId, companyId],
      ),
    ).rejects.toThrow(/check constraint|risk_level/i)
  })

  it('blocks auto_committed_at when status is still pending', async () => {
    const { userId, companyId } = await seedCompany()
    await expect(
      getPool().query(
        `INSERT INTO public.pending_operations (
           user_id, company_id, operation_type, title, params, preview_data,
           actor_type, risk_level, auto_committed_at
         ) VALUES ($1, $2, 'create_customer', 'x', '{}', '{}',
                   'api_key', 'low', now())`,
        [userId, companyId],
      ),
    ).rejects.toThrow(/pending_ops_auto_commit_status|check constraint/i)
  })

  it('accepts the expanded operation_type enum (close_period, run_year_end, …)', async () => {
    const { userId, companyId } = await seedCompany()
    const expandedTypes = [
      'close_period', 'lock_period', 'unlock_period', 'run_year_end', 'set_opening_balances',
      'run_currency_revaluation', 'explain_voucher_gap', 'uncategorize_transaction',
      'approve_supplier_invoice', 'credit_supplier_invoice',
      'credit_invoice', 'convert_invoice', 'import_sie',
    ]

    for (const op of expandedTypes) {
      const result = await getPool().query<{ id: string }>(
        `INSERT INTO public.pending_operations (
           user_id, company_id, operation_type, title, params, preview_data
         ) VALUES ($1, $2, $3, 'pg-real test', '{}', '{}')
         RETURNING id`,
        [userId, companyId, op],
      )
      expect(result.rows[0]?.id).toBeTruthy()
    }
  })
})

describe('audit_log: actor_type + actor_label columns', () => {
  it('accepts INSERT with actor_type and actor_label', async () => {
    const { userId } = await seedCompany()
    const result = await getPool().query<{ id: string }>(
      `INSERT INTO public.audit_log (
         user_id, action, table_name, actor_type, actor_label, description
       ) VALUES ($1, 'INSERT', 'pending_operations', 'api_key', 'Claude Desktop', 'pg-real test')
       RETURNING id`,
      [userId],
    )
    expect(result.rows[0]?.id).toBeTruthy()
  })
})

describe('company_settings: auto_commit columns', () => {
  it('exposes agent_auto_commit_enabled (default false) and agent_auto_commit_max_amount (NULL)', async () => {
    const { companyId } = await seedCompany()

    const settings = await getPool().query<{
      enabled: boolean
      max_amount: string | null
    }>(
      `SELECT agent_auto_commit_enabled AS enabled,
              agent_auto_commit_max_amount AS max_amount
       FROM public.company_settings
       WHERE company_id = $1`,
      [companyId],
    )

    // company_settings may or may not have a default row; if it doesn't, the
    // columns still exist on the table and we can inspect the catalog.
    if (settings.rows.length === 0) {
      const catalog = await getPool().query<{ name: string }>(
        `SELECT column_name AS name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'company_settings'
           AND column_name IN ('agent_auto_commit_enabled', 'agent_auto_commit_max_amount')`,
      )
      expect(catalog.rowCount).toBe(2)
      return
    }

    expect(settings.rows[0]?.enabled).toBe(false)
    expect(settings.rows[0]?.max_amount).toBeNull()
  })
})

describe('idempotency_keys table', () => {
  it('enforces unique (user_id, key) and 24h default expiry', async () => {
    const { userId, companyId } = await seedCompany()

    await getPool().query(
      `INSERT INTO public.idempotency_keys
         (user_id, company_id, key, request_hash, scope, response_status, response_body)
       VALUES ($1, $2, 'dup-key', 'hash-1', 'mcp_tool', 'success', '{}')`,
      [userId, companyId],
    )

    await expect(
      getPool().query(
        `INSERT INTO public.idempotency_keys
           (user_id, company_id, key, request_hash, scope, response_status, response_body)
         VALUES ($1, $2, 'dup-key', 'hash-2', 'mcp_tool', 'success', '{}')`,
        [userId, companyId],
      ),
    ).rejects.toThrow(/duplicate key|unique/i)

    const expiry = await getPool().query<{ expires_at: string; created_at: string }>(
      `SELECT expires_at, created_at FROM public.idempotency_keys
       WHERE user_id = $1 AND key = 'dup-key'`,
      [userId],
    )
    const created = new Date(expiry.rows[0]!.created_at).getTime()
    const expires = new Date(expiry.rows[0]!.expires_at).getTime()
    const hoursDelta = (expires - created) / 3_600_000
    // Expect the default ~24h gap (allow ±1 minute for clock skew).
    expect(hoursDelta).toBeGreaterThan(23.95)
    expect(hoursDelta).toBeLessThan(24.05)
  })

  it('rejects invalid response_status', async () => {
    const { userId, companyId } = await seedCompany()
    await expect(
      getPool().query(
        `INSERT INTO public.idempotency_keys
           (user_id, company_id, key, request_hash, scope, response_status, response_body)
         VALUES ($1, $2, 'bad-status', 'hash-x', 'mcp_tool', 'maybe', '{}')`,
        [userId, companyId],
      ),
    ).rejects.toThrow(/check constraint|response_status/i)
  })
})
