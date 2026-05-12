import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { ensureInitialized } from '@/lib/init'
import { requireCompanyId } from '@/lib/company/context'
import { requireWritePermission } from '@/lib/auth/require-write'
import { formatRedovisare } from '@/lib/skatteverket/format'
import { decryptPersonnummer, maskPersonnummer } from '@/lib/salary/personnummer'

ensureInitialized()

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const companyId = await requireCompanyId(supabase, user.id)

  const { data: run, error } = await supabase
    .from('salary_runs')
    .select('*')
    .eq('id', id)
    .eq('company_id', companyId)
    .single()

  if (error || !run) {
    return NextResponse.json({ error: 'Lönekörning hittades inte' }, { status: 404 })
  }

  // Load employees with line items
  const { data: employees } = await supabase
    .from('salary_run_employees')
    .select('*, employee:employees(id, first_name, last_name, personnummer, personnummer_last4, employment_type), line_items:salary_line_items(*)')
    .eq('salary_run_id', id)
    .order('created_at')

  // Resolve Skatteverket arbetsgivare ID for AGI submission. We surface this
  // in the run payload so the client doesn't need a second round-trip just to
  // build extension URLs. Quietly null when the org number isn't set yet.
  let arbetsgivare: string | null = null
  const { data: settings } = await supabase
    .from('company_settings')
    .select('org_number, entity_type')
    .eq('company_id', companyId)
    .maybeSingle()
  if (settings?.org_number && settings?.entity_type) {
    try {
      arbetsgivare = formatRedovisare(settings.org_number, settings.entity_type)
    } catch {
      arbetsgivare = null
    }
  }

  return NextResponse.json({
    data: {
      ...run,
      arbetsgivare,
      employees: (employees || []).map(emp => ({
        ...emp,
        employee: emp.employee ? {
          ...emp.employee,
          personnummer: maskPersonnummer(decryptPersonnummer(emp.employee.personnummer)),
        } : null,
      })),
    },
  })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await requireWritePermission(supabase, user.id)
  if (!writeCheck.ok) return writeCheck.response

  const companyId = await requireCompanyId(supabase, user.id)

  // Only allow updates on draft runs
  const { data: run, error: fetchError } = await supabase
    .from('salary_runs')
    .select('id, status')
    .eq('id', id)
    .eq('company_id', companyId)
    .single()

  if (fetchError || !run) {
    return NextResponse.json({ error: 'Lönekörning hittades inte' }, { status: 404 })
  }

  if (run.status !== 'draft') {
    return NextResponse.json({ error: 'Kan bara redigera utkast' }, { status: 400 })
  }

  const body = await request.json()
  const allowedFields = ['payment_date', 'voucher_series', 'notes']
  const updates: Record<string, unknown> = {}
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates[field] = body[field]
    }
  }

  const { data: updated, error } = await supabase
    .from('salary_runs')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: updated })
}
