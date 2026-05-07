import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { requireCompanyId } from '@/lib/company/context'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const companyId = await requireCompanyId(supabase, user.id)

  const today = new Date().toISOString().split('T')[0]

  const [{ data: period }, { data: settings }] = await Promise.all([
    supabase
      .from('fiscal_periods')
      .select('id')
      .eq('company_id', companyId)
      .lte('period_start', today)
      .gte('period_end', today)
      .maybeSingle(),
    supabase
      .from('company_settings')
      .select('default_voucher_series')
      .eq('company_id', companyId)
      .maybeSingle(),
  ])

  const series = settings?.default_voucher_series || 'A'

  if (!period) {
    return NextResponse.json({ data: { next: null, series, fiscal_period_id: null } })
  }

  const { data: sequence } = await supabase
    .from('voucher_sequences')
    .select('last_number')
    .eq('company_id', companyId)
    .eq('fiscal_period_id', period.id)
    .eq('voucher_series', series)
    .maybeSingle()

  const next = (sequence?.last_number ?? 0) + 1

  return NextResponse.json({
    data: { next, series, fiscal_period_id: period.id },
  })
}
