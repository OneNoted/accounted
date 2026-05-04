import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { ensureInitialized } from '@/lib/init'
import { requireCompanyId } from '@/lib/company/context'
import { requireWritePermission } from '@/lib/auth/require-write'

ensureInitialized()

/** Fetch one employee's pay spec within a salary run, with employee + line items. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; employeeId: string }> },
) {
  const { id, employeeId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const companyId = await requireCompanyId(supabase, user.id)

  const { data, error } = await supabase
    .from('salary_run_employees')
    .select('*, employee:employees(*), line_items:salary_line_items(*)')
    .eq('salary_run_id', id)
    .eq('employee_id', employeeId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Anställd hittades inte i lönekörningen' }, { status: 404 })
  }

  return NextResponse.json({ data })
}

/** Remove employee from a draft salary run. Cascades to delete their line items. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; employeeId: string }> }
) {
  const { id, employeeId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await requireWritePermission(supabase, user.id)
  if (!writeCheck.ok) return writeCheck.response

  const companyId = await requireCompanyId(supabase, user.id)

  // Verify run is draft
  const { data: run } = await supabase
    .from('salary_runs')
    .select('id, status')
    .eq('id', id)
    .eq('company_id', companyId)
    .single()

  if (!run) return NextResponse.json({ error: 'Lönekörning hittades inte' }, { status: 404 })
  if (run.status !== 'draft') return NextResponse.json({ error: 'Kan bara redigera utkast' }, { status: 400 })

  // Delete the salary_run_employee (cascades to salary_line_items via ON DELETE CASCADE)
  const { error } = await supabase
    .from('salary_run_employees')
    .delete()
    .eq('salary_run_id', id)
    .eq('employee_id', employeeId)
    .eq('company_id', companyId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: { deleted: true } })
}
