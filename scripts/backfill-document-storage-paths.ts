#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * !! DESTRUCTIVE. READ THIS BEFORE YOU RUN ANYTHING. !!
 * ============================================================================
 *
 * This script MOVES räkenskapsinformation. The objects it touches are kvitton,
 * leverantorsfakturor and kontoutdrag held under the Bokforingslagen 7 kap 2 §
 * SEVEN-YEAR RETENTION requirement. Losing one is a legal incident, not a bug.
 *
 *   * ALWAYS run against STAGING first and confirm the counts there.
 *   * NEVER point this at .env.local. That file targets the REAL customer
 *     database. Pass --env <file> explicitly and read the banner it prints.
 *   * The default mode is --dry-run. Moving data requires the explicit
 *     --apply flag. Removing the source copies requires --apply AND
 *     --delete-source, which should be a SEPARATE run, days after --apply,
 *     once the app has been observed serving the new keys.
 *
 * ============================================================================
 * WHAT IT DOES (Phase B of the 3-phase rollout)
 * ============================================================================
 *
 * Phase A (migration 20260726092000_documents_bucket_company_scope.sql) added
 * company-scoped storage policies for the key layout
 *
 *     documents/{companyId}/{userId}/{timestamp}_{filename}
 *
 * and switched lib/core/documents/document-service.ts to write that layout.
 * Legacy objects still sit at
 *
 *     documents/{userId}/{timestamp}_{filename}
 *
 * where the RLS policy can only scope on auth.uid(), so a removed company
 * member keeps read access to everything they ever uploaded.
 *
 * This script re-homes those legacy objects. Per document row, in this order:
 *
 *   1. resolve the owning company_id from document_attachments
 *   2. skip if storage_path is already company-scoped (idempotent / resumable)
 *   3. COPY the object to the company-scoped key (never move, never rename)
 *   4. VERIFY the new key is readable and byte-identical (SHA-256 compared
 *      against document_attachments.sha256_hash when present, otherwise
 *      against the source bytes)
 *   5. only then UPDATE document_attachments.storage_path
 *   6. only with --delete-source, and only after 3-5 all succeeded, remove
 *      the legacy object
 *
 * The source is NEVER deleted before the new key has been confirmed readable.
 * A failure at any step logs the document id and the script continues to the
 * next row; it never aborts the run on a single bad document.
 *
 * ============================================================================
 * PHASE C GATE
 * ============================================================================
 *
 * The final summary prints `legacy_prefix_remaining`. Phase C (the migration
 * that drops `documents_select_own` / `documents_insert_own`) may only be
 * applied when a --dry-run of this script reports legacy_prefix_remaining = 0.
 * Dropping those policies earlier makes every un-migrated document unreadable
 * to everyone except the service role.
 *
 * ============================================================================
 * USAGE
 * ============================================================================
 *
 *   # 1. Inspect. Changes nothing. This is the default.
 *   npx tsx scripts/backfill-document-storage-paths.ts --env .env.staging.local
 *
 *   # 2. Copy + verify + repoint. Leaves the legacy objects in place.
 *   npx tsx scripts/backfill-document-storage-paths.ts --env .env.staging.local --apply
 *
 *   # 3. Days later, after the app has been observed serving new keys:
 *   npx tsx scripts/backfill-document-storage-paths.ts --env .env.staging.local --apply --delete-source
 *
 * Flags:
 *   --env <file>       dotenv file to load. REQUIRED. No default: an implicit
 *                      .env.local would point at production.
 *   --apply            actually copy/verify/repoint. Without it: dry run.
 *   --delete-source    additionally remove the legacy object after a verified
 *                      repoint. Requires --apply.
 *   --company <uuid>   restrict the run to one company. Use this for the first
 *                      production batch.
 *   --limit <n>        process at most n documents this run (resumable: run
 *                      again to continue).
 *   --yes              skip the interactive confirmation prompt.
 */

import { createHash } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { config } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const BUCKET = 'documents'
const PATH_ROOT = 'documents'
const PAGE_SIZE = 500

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function flagValue(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  const value = process.argv[idx + 1]
  if (!value || value.startsWith('--')) {
    console.error(`--${name} requires a value`)
    process.exit(1)
  }
  return value
}

const envFile = flagValue('env')
const apply = process.argv.includes('--apply')
const deleteSource = process.argv.includes('--delete-source')
const skipPrompt = process.argv.includes('--yes')
const onlyCompany = flagValue('company')
const limitRaw = flagValue('limit')
const limit = limitRaw ? Number.parseInt(limitRaw, 10) : Number.POSITIVE_INFINITY

if (!envFile) {
  console.error(
    'Refusing to run without an explicit --env <file>. An implicit .env.local ' +
      'points at the PRODUCTION database. Example: --env .env.staging.local',
  )
  process.exit(1)
}

if (deleteSource && !apply) {
  console.error('--delete-source requires --apply.')
  process.exit(1)
}

if (limitRaw && (!Number.isFinite(limit) || limit <= 0)) {
  console.error('--limit must be a positive integer.')
  process.exit(1)
}

config({ path: envFile })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error(`Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in ${envFile}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DocumentRow {
  id: string
  company_id: string | null
  storage_path: string | null
  file_name: string | null
  mime_type: string | null
  sha256_hash: string | null
}

interface Failure {
  documentId: string
  storagePath: string | null
  step: string
  reason: string
}

// ---------------------------------------------------------------------------
// Path helpers.
//
// Deliberately duplicated from lib/core/documents/document-service.ts instead
// of imported: this script runs standalone under tsx and must not drag the
// service module's Next.js/event-bus imports into a plain node process. Keep
// the two in sync if the layout ever changes again.
// ---------------------------------------------------------------------------

function isCompanyScoped(storagePath: string, companyId: string): boolean {
  return storagePath.startsWith(`${PATH_ROOT}/${companyId}/`)
}

function isLegacyDocumentPath(storagePath: string): boolean {
  return storagePath.startsWith(`${PATH_ROOT}/`)
}

function companyScopedPath(storagePath: string, companyId: string): string | null {
  if (isCompanyScoped(storagePath, companyId)) return null
  if (!isLegacyDocumentPath(storagePath)) return null
  return `${PATH_ROOT}/${companyId}/${storagePath.slice(`${PATH_ROOT}/`.length)}`
}

function sha256Hex(buffer: ArrayBuffer): string {
  return createHash('sha256').update(Buffer.from(buffer)).digest('hex')
}

// ---------------------------------------------------------------------------
// Safety banner + confirmation
// ---------------------------------------------------------------------------

function projectRef(url: string): string {
  try {
    return new URL(url).hostname.split('.')[0] ?? url
  } catch {
    return url
  }
}

async function confirmOrExit(): Promise<void> {
  const ref = projectRef(supabaseUrl!)

  console.log('')
  console.log('='.repeat(78))
  console.log('  documents bucket backfill: legacy uploader-scoped keys -> company-scoped')
  console.log('='.repeat(78))
  console.log(`  env file        : ${envFile}`)
  console.log(`  supabase project: ${ref}`)
  console.log(`  mode            : ${apply ? 'APPLY (writes data)' : 'DRY RUN (no changes)'}`)
  console.log(`  delete source   : ${deleteSource ? 'YES (legacy objects removed)' : 'no'}`)
  console.log(`  company filter  : ${onlyCompany ?? '(all companies)'}`)
  console.log(`  limit           : ${Number.isFinite(limit) ? limit : '(none)'}`)
  console.log('='.repeat(78))
  console.log('')

  if (envFile === '.env.local') {
    console.error(
      'REFUSING: .env.local points at the production database. If you really ' +
        'intend to run against production, copy the credentials into an ' +
        'explicitly named file (e.g. .env.production.backfill) so the intent ' +
        'is recorded in the command line.',
    )
    process.exit(1)
  }

  if (!apply || skipPrompt) return

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(
    `Type the project ref (${ref}) to proceed, anything else to abort: `,
  )
  rl.close()
  if (answer.trim() !== ref) {
    console.error('Aborted.')
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

/**
 * Page through document_attachments. PostgREST caps a single response at
 * 1000 rows, so never rely on an unbounded select here.
 */
async function fetchAllDocuments(supabase: SupabaseClient): Promise<DocumentRow[]> {
  const rows: DocumentRow[] = []
  let from = 0

  for (;;) {
    let query = supabase
      .from('document_attachments')
      .select('id, company_id, storage_path, file_name, mime_type, sha256_hash')
      .not('storage_path', 'is', null)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (onlyCompany) query = query.eq('company_id', onlyCompany)

    const { data, error } = await query
    if (error) throw new Error(`Failed to page document_attachments: ${error.message}`)
    if (!data || data.length === 0) break

    rows.push(...(data as DocumentRow[]))
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  return rows
}

async function objectExists(supabase: SupabaseClient, path: string): Promise<boolean> {
  const segments = path.split('/')
  const name = segments.pop()!
  const { data } = await supabase.storage.from(BUCKET).list(segments.join('/'), { search: name })
  return !!data?.some((entry) => entry.name === name)
}

// ---------------------------------------------------------------------------
// Per-document migration
// ---------------------------------------------------------------------------

async function migrateOne(
  supabase: SupabaseClient,
  row: DocumentRow,
  failures: Failure[],
): Promise<'migrated' | 'failed'> {
  const oldPath = row.storage_path!
  const companyId = row.company_id!
  const newPath = companyScopedPath(oldPath, companyId)!

  // ---- 3. COPY (never move: the source must survive until step 5) --------
  const { data: sourceBlob, error: downloadError } = await supabase.storage
    .from(BUCKET)
    .download(oldPath)

  if (downloadError || !sourceBlob) {
    failures.push({
      documentId: row.id,
      storagePath: oldPath,
      step: 'download-source',
      reason: downloadError?.message ?? 'no data returned',
    })
    return 'failed'
  }

  const sourceBytes = await sourceBlob.arrayBuffer()
  const sourceHash = sha256Hex(sourceBytes)

  // An already-present target means a previous run got this far: fall through
  // to verification rather than failing on the upsert:false conflict.
  if (!(await objectExists(supabase, newPath))) {
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(newPath, sourceBytes, {
        contentType: row.mime_type ?? 'application/octet-stream',
        upsert: false,
      })

    if (uploadError) {
      failures.push({
        documentId: row.id,
        storagePath: oldPath,
        step: 'upload-copy',
        reason: uploadError.message,
      })
      return 'failed'
    }
  }

  // ---- 4. VERIFY the new key is readable and byte-identical ---------------
  const { data: copyBlob, error: verifyError } = await supabase.storage
    .from(BUCKET)
    .download(newPath)

  if (verifyError || !copyBlob) {
    failures.push({
      documentId: row.id,
      storagePath: oldPath,
      step: 'verify-readable',
      reason: verifyError?.message ?? 'copy not readable at the new key',
    })
    return 'failed'
  }

  const copyHash = sha256Hex(await copyBlob.arrayBuffer())
  // The stored hash is the strongest reference; fall back to the source bytes
  // for rows written before sha256_hash was populated.
  const expectedHash = row.sha256_hash ?? sourceHash

  if (copyHash !== expectedHash) {
    failures.push({
      documentId: row.id,
      storagePath: oldPath,
      step: 'verify-hash',
      reason: `copy hash ${copyHash} does not match expected ${expectedHash}`,
    })
    return 'failed'
  }

  // ---- 5. Repoint the DB, only now that the copy is proven ---------------
  const { error: updateError } = await supabase
    .from('document_attachments')
    .update({ storage_path: newPath })
    .eq('id', row.id)

  if (updateError) {
    failures.push({
      documentId: row.id,
      storagePath: oldPath,
      step: 'update-pointer',
      reason: updateError.message,
    })
    return 'failed'
  }

  // ---- 6. Optional source removal, strictly last --------------------------
  if (deleteSource) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove([oldPath])
    if (removeError) {
      // Not a failure of the migration: the DB already points at a verified
      // copy. Log it so the leftover can be swept later.
      console.warn(
        `  [${row.id}] source not removed (pointer already repointed): ${removeError.message}`,
      )
    }
  }

  return 'migrated'
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await confirmOrExit()

  const supabase = createClient(supabaseUrl!, serviceRoleKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const rows = await fetchAllDocuments(supabase)

  const alreadyScoped: DocumentRow[] = []
  const candidates: DocumentRow[] = []
  const unmapped: DocumentRow[] = []

  for (const row of rows) {
    if (!row.storage_path) continue
    if (!row.company_id) {
      unmapped.push(row)
      continue
    }
    if (isCompanyScoped(row.storage_path, row.company_id)) {
      alreadyScoped.push(row)
    } else if (isLegacyDocumentPath(row.storage_path)) {
      candidates.push(row)
    } else {
      // Shapes this backfill deliberately does not touch, e.g. the MCP
      // audit-package keys `{userId}/audit-packages/...` and the demo-seed
      // `{userId}/{companyId}/inbox/...` keys. They are not covered by the
      // documents_*_company policies and are not document_attachments
      // underlag in the BFL sense.
      unmapped.push(row)
    }
  }

  console.log(`document_attachments rows with a storage_path : ${rows.length}`)
  console.log(`  already company-scoped                      : ${alreadyScoped.length}`)
  console.log(`  legacy prefix, need migration               : ${candidates.length}`)
  console.log(`  outside the documents/ layout (skipped)     : ${unmapped.length}`)
  console.log('')

  if (unmapped.length > 0) {
    console.log('Skipped rows (first 20):')
    for (const row of unmapped.slice(0, 20)) {
      console.log(`  ${row.id}  company=${row.company_id ?? 'NULL'}  path=${row.storage_path}`)
    }
    console.log('')
  }

  const batch = Number.isFinite(limit) ? candidates.slice(0, limit) : candidates

  if (!apply) {
    console.log('DRY RUN: nothing was changed. Planned moves (first 20):')
    for (const row of batch.slice(0, 20)) {
      console.log(`  ${row.id}`)
      console.log(`    from ${row.storage_path}`)
      console.log(`    to   ${companyScopedPath(row.storage_path!, row.company_id!)}`)
    }
    console.log('')
    console.log(`legacy_prefix_remaining = ${candidates.length}`)
    console.log(
      candidates.length === 0
        ? 'PHASE C GATE: OPEN. Zero legacy-prefix objects; the Phase C migration may be applied.'
        : 'PHASE C GATE: CLOSED. Run with --apply until legacy_prefix_remaining reaches 0.',
    )
    return
  }

  const failures: Failure[] = []
  let migrated = 0

  for (const [index, row] of batch.entries()) {
    const progress = `${index + 1}/${batch.length}`
    console.log(`[${progress}] ${row.id}  ${row.storage_path}`)
    let outcome: 'migrated' | 'failed'
    try {
      outcome = await migrateOne(supabase, row, failures)
    } catch (err) {
      // Never abort the run on one bad document.
      failures.push({
        documentId: row.id,
        storagePath: row.storage_path,
        step: 'unexpected',
        reason: err instanceof Error ? err.message : String(err),
      })
      outcome = 'failed'
    }
    if (outcome === 'migrated') migrated++
  }

  const remaining = candidates.length - migrated

  console.log('')
  console.log('='.repeat(78))
  console.log(`  migrated                : ${migrated}`)
  console.log(`  failed                  : ${failures.length}`)
  console.log(`  legacy_prefix_remaining : ${remaining}`)
  console.log('='.repeat(78))

  if (failures.length > 0) {
    console.log('')
    console.log('Failures (document id / step / reason):')
    for (const failure of failures) {
      console.log(`  ${failure.documentId}  [${failure.step}]  ${failure.reason}`)
      console.log(`    path: ${failure.storagePath}`)
    }
  }

  console.log('')
  console.log(
    remaining === 0 && failures.length === 0
      ? 'PHASE C GATE: OPEN. Re-run with --dry-run to confirm, then apply the Phase C migration.'
      : 'PHASE C GATE: CLOSED. Do NOT drop documents_select_own / documents_insert_own yet.',
  )

  // Non-zero exit on failures so a CI/ops wrapper notices, but only AFTER the
  // full report has been printed.
  if (failures.length > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
