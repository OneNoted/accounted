#!/usr/bin/env npx tsx
/**
 * One-off repair for the "rättelse hamnar i fel räkenskapsår" bug.
 *
 * Pre-fix, lib/core/bookkeeping/storno-service.ts and lib/bookkeeping/engine.ts
 * stamped storno + correction entries with `entry_date = today` instead of
 * `original.entry_date`. fiscal_period_id was correctly inherited from the
 * original, so reports/SIE/momsdeklaration are correct, but the bookkeeping
 * list (which sorts by entry_date) shows the rättelse in the wrong year.
 *
 * This script finds every storno/correction entry whose own `entry_date` falls
 * outside its own fiscal_period's [period_start, period_end] window and
 * realigns `entry_date` to the parent entry's date.
 *
 * Mechanism:
 *   - Single Postgres transaction per company.
 *   - Inside the transaction, `SET LOCAL session_replication_role = replica`
 *     temporarily bypasses enforce_journal_entry_immutability (which would
 *     otherwise block any UPDATE of entry_date on posted/reversed entries).
 *   - Every change is recorded in audit_log with old/new state and a clear
 *     description, satisfying BFNAR 2013:2 kap 8 behandlingshistorik.
 *   - The role reverts on COMMIT/ROLLBACK; nothing else in the session can
 *     bypass immutability after this script exits.
 *
 * Usage:
 *   DATABASE_URL=postgres://... \
 *   npx tsx scripts/repair-rattelse-entry-dates.ts \
 *     --user-id <uuid>                 # engineer running the repair (audit_log.user_id)
 *     [--company-id <uuid>]            # restrict to one company; default = all
 *     [--commit]                       # default is --dry-run
 *
 * Run dry-run first, eyeball the diff, then re-run with --commit.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { Pool } from 'pg'

// ────────────────────────────────────────────────────────────────────
// Args
// ────────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const USER_ID = arg('user-id')
const COMPANY_ID = arg('company-id')
const COMMIT = process.argv.includes('--commit')

if (!USER_ID) {
  console.error(
    'Usage: DATABASE_URL=... npx tsx scripts/repair-rattelse-entry-dates.ts --user-id <uuid> [--company-id <uuid>] [--commit]'
  )
  process.exit(1)
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('Missing DATABASE_URL (point at the target Postgres directly, not via PostgREST).')
  process.exit(1)
}

// ────────────────────────────────────────────────────────────────────
// Banner
// ────────────────────────────────────────────────────────────────────

console.log('─────────────────────────────────────────────────────────')
console.log('Repair: rättelse entry_date misalignment')
console.log('─────────────────────────────────────────────────────────')
console.log('Database :', databaseUrl.replace(/:[^@]+@/, ':***@'))
console.log('User     :', USER_ID)
console.log('Scope    :', COMPANY_ID ? `company ${COMPANY_ID}` : 'ALL companies')
console.log('Mode     :', COMMIT ? 'COMMIT (writes)' : 'DRY RUN (no writes)')
console.log('─────────────────────────────────────────────────────────\n')

// ────────────────────────────────────────────────────────────────────
// Query
// ────────────────────────────────────────────────────────────────────

interface Candidate {
  id: string
  company_id: string
  source_type: 'storno' | 'correction'
  voucher_series: string
  voucher_number: number
  current_entry_date: string
  parent_id: string
  parent_entry_date: string
  fiscal_period_id: string
  fiscal_period_name: string
  period_start: string
  period_end: string
}

const findSql = `
  SELECT
    je.id,
    je.company_id,
    je.source_type,
    je.voucher_series,
    je.voucher_number,
    je.entry_date::text       AS current_entry_date,
    parent.id                 AS parent_id,
    parent.entry_date::text   AS parent_entry_date,
    je.fiscal_period_id,
    fp.name                   AS fiscal_period_name,
    fp.period_start::text     AS period_start,
    fp.period_end::text       AS period_end
  FROM journal_entries je
  JOIN fiscal_periods fp        ON fp.id = je.fiscal_period_id
  JOIN journal_entries parent   ON parent.id = COALESCE(je.reverses_id, je.correction_of_id)
  WHERE je.source_type IN ('storno', 'correction')
    AND je.status IN ('posted', 'reversed')
    AND (je.entry_date < fp.period_start OR je.entry_date > fp.period_end)
    AND parent.entry_date BETWEEN fp.period_start AND fp.period_end
    AND ($1::uuid IS NULL OR je.company_id = $1)
  ORDER BY je.company_id, fp.period_start, je.voucher_series, je.voucher_number
`

// ────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────

async function main() {
  const pool = new Pool({ connectionString: databaseUrl })
  const client = await pool.connect()

  try {
    const { rows: candidates } = await client.query<Candidate>(findSql, [COMPANY_ID ?? null])

    if (candidates.length === 0) {
      console.log('✓ No misaligned storno/correction entries found. Nothing to do.')
      return
    }

    // Group by company for readable output and per-company transactions
    const byCompany = new Map<string, Candidate[]>()
    for (const c of candidates) {
      if (!byCompany.has(c.company_id)) byCompany.set(c.company_id, [])
      byCompany.get(c.company_id)!.push(c)
    }

    console.log(
      `Found ${candidates.length} misaligned ${candidates.length === 1 ? 'entry' : 'entries'} across ${byCompany.size} ${byCompany.size === 1 ? 'company' : 'companies'}.\n`
    )

    for (const [companyId, entries] of byCompany) {
      console.log(`Company ${companyId} — ${entries.length} entries`)
      for (const e of entries) {
        console.log(
          `  ${e.voucher_series}${e.voucher_number} (${e.source_type})  ${e.current_entry_date} → ${e.parent_entry_date}  [period ${e.fiscal_period_name}: ${e.period_start} … ${e.period_end}]`
        )
      }
      console.log()
    }

    if (!COMMIT) {
      console.log('Mode: DRY RUN. Re-run with --commit to apply changes.')
      return
    }

    // Apply per-company so a single bad row doesn't poison the whole batch
    let totalChanged = 0
    for (const [companyId, entries] of byCompany) {
      console.log(`\n─── Applying to company ${companyId} (${entries.length} entries) ───`)
      try {
        await client.query('BEGIN')
        // Bypass enforce_journal_entry_immutability for this transaction only.
        // Reverts to 'origin' automatically on COMMIT/ROLLBACK.
        await client.query(`SET LOCAL session_replication_role = replica`)

        for (const e of entries) {
          const updateRes = await client.query(
            `UPDATE journal_entries
                SET entry_date = $1::date
              WHERE id = $2 AND company_id = $3
                AND entry_date = $4::date
              RETURNING id`,
            [e.parent_entry_date, e.id, e.company_id, e.current_entry_date]
          )

          if (updateRes.rowCount !== 1) {
            throw new Error(
              `Expected 1 row updated for ${e.id}, got ${updateRes.rowCount}. Aborting company batch.`
            )
          }

          await client.query(
            `INSERT INTO audit_log (user_id, action, table_name, record_id, actor_id, old_state, new_state, description)
             VALUES ($1, 'UPDATE', 'journal_entries', $2, $3, $4::jsonb, $5::jsonb, $6)`,
            [
              USER_ID,
              e.id,
              USER_ID,
              JSON.stringify({ entry_date: e.current_entry_date }),
              JSON.stringify({
                entry_date: e.parent_entry_date,
                parent_entry_id: e.parent_id,
                reason: 'rattelse_entry_date_misalignment_bug',
              }),
              `SYSTEM_REPAIR: rättelse/storno entry_date realigned to parent verifikation date (BFL-compliance fix; fiscal_period_id was already correct).`,
            ]
          )

          totalChanged++
        }

        await client.query('COMMIT')
        console.log(`  ✓ Committed ${entries.length} updates`)
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        console.error(
          `  ✗ Rolled back company ${companyId}: ${err instanceof Error ? err.message : err}`
        )
      }
    }

    console.log('\n─────────────────────────────────────────────────────────')
    console.log(`Summary: ${totalChanged}/${candidates.length} entries realigned`)
    console.log('─────────────────────────────────────────────────────────')
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('\n✗ Repair failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
