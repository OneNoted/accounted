import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { ensureInitialized } from '@/lib/init'
import { requireCompanyId } from '@/lib/company/context'
import { requireWritePermission } from '@/lib/auth/require-write'
import { validateBody } from '@/lib/api/validate'
import { PendingOperationsBulkSchema } from '@/lib/api/schemas'
import { commitPendingOperation } from '@/lib/pending-operations/commit'
import { bookkeepingErrorResponse } from '@/lib/bookkeeping/errors'
import type { PendingOperation } from '@/types'

ensureInitialized()

interface BulkCommitItemResult {
  id: string
  status: 'committed' | 'failed' | 'skipped'
  error?: string
}

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const writeCheck = await requireWritePermission(supabase, user.id)
  if (!writeCheck.ok) return writeCheck.response

  const validated = await validateBody(request, PendingOperationsBulkSchema)
  if (!validated.success) return validated.response
  const { ids } = validated.data

  const companyId = await requireCompanyId(supabase, user.id)

  const { data: ops, error: fetchError } = await supabase
    .from('pending_operations')
    .select('*')
    .in('id', ids)
    .eq('company_id', companyId)

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  const opsById = new Map((ops ?? []).map((op) => [op.id, op as PendingOperation]))
  const results: BulkCommitItemResult[] = []

  for (const id of ids) {
    const op = opsById.get(id)
    if (!op) {
      results.push({ id, status: 'failed', error: 'Operation not found' })
      continue
    }
    if (op.status !== 'pending') {
      results.push({ id, status: 'skipped', error: `Already ${op.status}` })
      continue
    }
    if (op.risk_level === 'high') {
      results.push({
        id,
        status: 'skipped',
        error: 'Hög risk — kräver individuellt godkännande',
      })
      continue
    }

    try {
      const result = await commitPendingOperation(supabase, user.id, companyId, op, {
        userEmail: user.email,
      })
      if (result.status === 'committed') {
        results.push({ id, status: 'committed' })
      } else {
        results.push({ id, status: 'failed', error: result.error ?? 'Misslyckades' })
      }
    } catch (err) {
      const typed = bookkeepingErrorResponse(err)
      if (typed) {
        const body = (await typed.json().catch(() => null)) as
          | { error?: { message?: string } | string }
          | null
        const message =
          typeof body?.error === 'string'
            ? body.error
            : body?.error?.message ?? 'Bokföringsfel'
        results.push({ id, status: 'failed', error: message })
        continue
      }
      results.push({
        id,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Okänt fel',
      })
    }
  }

  const summary = {
    total: results.length,
    committed: results.filter((r) => r.status === 'committed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
  }

  return NextResponse.json({ data: { results, summary } })
}
