#!/usr/bin/env npx tsx
/**
 * Retroactive catch-up for the year-open result omföring (2099 → 2098).
 *
 * Problem: before generateResultAppropriation existed, year-end closing posted
 * the result to 2099 "Årets resultat" and the opening-balance entry carried it
 * forward verbatim. 2099 was therefore re-opened on 2099 every year and the
 * prior result accumulated there instead of being moved off "Årets resultat".
 *
 * Fix (per affected aktiebolag): post ONE balanced omföring verifikat in the
 * company's current OPEN period clearing the accumulated 2099 balance
 * (Dr 2099 / Cr 2098 for a profit, reversed for a loss). No closed/locked
 * years are touched — the entry lands in an open period and respects every BFL
 * trigger. This corrects the balance sheet going forward; it does not
 * reconstruct the per-year history (which would require reopening closed years).
 *
 * The actual posting and all no-op gating (AB-only, idempotency, zero balance)
 * are delegated to the SAME helper the year-end flow uses, so the catch-up and
 * the steady-state behaviour can never diverge.
 *
 * Usage:
 *   # Preview every affected company (read-only)
 *   npx tsx scripts/repair-result-appropriation.ts
 *
 *   # Preview a single company
 *   npx tsx scripts/repair-result-appropriation.ts --company-id <uuid>
 *
 *   # Apply (post the omföring entries)
 *   npx tsx scripts/repair-result-appropriation.ts --commit
 *
 * Run against staging first; only run against prod after reviewing the dry-run.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  planResultAppropriation,
  generateResultAppropriation,
} from '../lib/core/bookkeeping/result-appropriation-service'

// ──────────────────────────────────────────────────────────────────
// Args + client
// ──────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const ONLY_COMPANY_ID = arg('company-id')
const COMMIT = process.argv.includes('--commit')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey) as SupabaseClient

console.log('─────────────────────────────────────────────────────────')
console.log('Result Appropriation Catch-up (2099 → 2098)')
console.log('─────────────────────────────────────────────────────────')
console.log('Supabase URL :', supabaseUrl)
console.log('Scope        :', ONLY_COMPANY_ID ? `company ${ONLY_COMPANY_ID}` : 'ALL companies')
console.log('Mode         :', COMMIT ? 'COMMIT (writes)' : 'DRY RUN (no writes)')
console.log('─────────────────────────────────────────────────────────\n')

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

async function listCompanyIds(): Promise<string[]> {
  if (ONLY_COMPANY_ID) return [ONLY_COMPANY_ID]
  const { data, error } = await supabase
    .from('companies')
    .select('id')
    .order('created_at', { ascending: true })
  if (error) throw new Error(`Failed to list companies: ${error.message}`)
  return (data as { id: string }[]).map((c) => c.id)
}

/** Open periods (not locked, not closed), earliest first. */
async function listOpenPeriods(companyId: string): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from('fiscal_periods')
    .select('id, name')
    .eq('company_id', companyId)
    .eq('is_closed', false)
    .is('locked_at', null)
    .order('period_start', { ascending: true })
  if (error) throw new Error(`Failed to list open periods for ${companyId}: ${error.message}`)
  return (data as { id: string; name: string }[]) ?? []
}

/** The company owner's user_id, used as the verifikat's user_id on commit. */
async function resolveOwnerUserId(companyId: string): Promise<string | null> {
  const { data: owner } = await supabase
    .from('company_members')
    .select('user_id')
    .eq('company_id', companyId)
    .eq('role', 'owner')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (owner?.user_id) return owner.user_id as string

  // Fallback: any member (e.g. legacy data with no explicit owner row).
  const { data: anyMember } = await supabase
    .from('company_members')
    .select('user_id')
    .eq('company_id', companyId)
    .limit(1)
    .maybeSingle()
  return (anyMember?.user_id as string) ?? null
}

// ──────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────

async function main() {
  let scanned = 0
  let planned = 0
  let posted = 0
  let skippedNoOwner = 0
  let failed = 0

  const companyIds = await listCompanyIds()
  console.log(`Scanning ${companyIds.length} company(ies)…\n`)

  for (const companyId of companyIds) {
    scanned++
    let openPeriods: { id: string; name: string }[]
    try {
      openPeriods = await listOpenPeriods(companyId)
    } catch (err) {
      console.error(`  · ${companyId}: FAILED to list periods:`, err instanceof Error ? err.message : err)
      failed++
      continue
    }

    for (const period of openPeriods) {
      let plan
      try {
        plan = await planResultAppropriation(supabase, companyId, period.id)
      } catch (err) {
        console.error(
          `  · ${companyId} / ${period.name}: FAILED to plan:`,
          err instanceof Error ? err.message : err,
        )
        failed++
        continue
      }
      if (!plan) continue // non-AB, already done, or 2099 flat

      planned++
      console.log(
        `  · ${companyId} / ${period.name}: ${plan.direction} ${plan.amount} kr ` +
          `— ${plan.lines.map((l) => `${l.account_number} ${l.debit_amount ? `D ${l.debit_amount}` : `K ${l.credit_amount}`}`).join(' / ')}`,
      )

      if (!COMMIT) continue

      const userId = await resolveOwnerUserId(companyId)
      if (!userId) {
        console.error(`  · ${companyId}: SKIPPED — no member to attribute the entry to`)
        skippedNoOwner++
        continue
      }

      try {
        const entry = await generateResultAppropriation(supabase, companyId, userId, period.id)
        if (entry) {
          console.log(`    → posted ${entry.voucher_series}${entry.voucher_number} (${entry.id})`)
          posted++
        }
      } catch (err) {
        console.error(
          `  · ${companyId} / ${period.name}: FAILED to post:`,
          err instanceof Error ? err.message : err,
        )
        failed++
      }
    }
  }

  console.log('\n─────────────────────────────────────────────────────────')
  console.log('Summary')
  console.log('─────────────────────────────────────────────────────────')
  console.log(`Companies scanned : ${scanned}`)
  console.log(`Omföringar planned: ${planned}`)
  console.log(`Omföringar posted : ${posted}`)
  console.log(`Skipped (no owner): ${skippedNoOwner}`)
  console.log(`Failed            : ${failed}`)
  console.log(`Mode              : ${COMMIT ? 'COMMIT' : 'DRY RUN'}`)
  if (!COMMIT) console.log('\nRe-run with --commit to apply.')
}

main().catch((err) => {
  console.error('\nFATAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})
