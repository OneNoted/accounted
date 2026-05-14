import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { ensureInitialized } from '@/lib/init'
import { requireCompanyId } from '@/lib/company/context'
import { generateAgiDeclaration } from '@/lib/salary/agi/generate-declaration'
import { createLogger } from '@/lib/logger'
import { errorResponseFromCode } from '@/lib/errors/get-structured-error'

ensureInitialized()

/**
 * GET /api/salary/runs/{id}/agi/xml
 *
 * Thin wrapper over `generateAgiDeclaration()` from
 * `lib/salary/agi/generate-declaration.ts`. The orchestration was extracted in
 * Phase 5 PR-2 so the v1 public route (`POST /api/v1/.../salary-runs/{id}/generate-agi`)
 * can call the same code. This route's responsibility is now: auth → invoke
 * helper → return the raw XML as a downloadable file (the dashboard's
 * historical contract).
 *
 * Per agi-filing.md:
 *   - FK570 (specifikationsnummer) MUST stay consistent per employee
 *   - Corrections resubmit with same FK570 — different number = new record
 *   - XML is räkenskapsinformation, stored for 7-year retention per BFL 7 kap
 *   - Filing deadline: the 12th of the following month (17th in Jan/Aug for
 *     companies ≤ 40 MSEK turnover)
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const companyId = await requireCompanyId(supabase, user.id)
  const requestId = `req_${crypto.randomUUID()}`
  const log = createLogger('api/salary/agi/xml', { requestId, userId: user.id })

  const result = await generateAgiDeclaration({
    supabase,
    companyId,
    userId: user.id,
    userEmail: user.email ?? null,
    salaryRunId: id,
    log,
    requestId,
  })

  if (!result.ok) {
    return errorResponseFromCode(result.code, log, {
      requestId,
      details: result.details,
      status: result.status,
    })
  }

  return new Response(result.xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="AGI_${result.orgNumber}_${result.periodYear}${String(result.periodMonth).padStart(2, '0')}.xml"`,
    },
  })
}
