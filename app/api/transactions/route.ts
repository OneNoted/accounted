import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { requireCompanyId } from '@/lib/company/context'

const MAX_ROWS = 500

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const companyId = await requireCompanyId(supabase, user.id)

  const { searchParams } = new URL(request.url)
  const unmatched = searchParams.get('unmatched') === 'true'
  const reconciled = searchParams.get('reconciled') === 'true'
  const currency = searchParams.get('currency') || undefined
  const dateFrom = searchParams.get('date_from') || undefined
  const dateTo = searchParams.get('date_to') || undefined

  let query = supabase
    .from('transactions')
    .select('id, date, description, amount, currency, reference, journal_entry_id, reconciliation_method')
    .eq('company_id', companyId)

  // unmatched and reconciled are mutually exclusive — unmatched wins if both set
  if (unmatched) {
    query = query.is('journal_entry_id', null)
  } else if (reconciled) {
    query = query.not('journal_entry_id', 'is', null)
  }

  if (currency) query = query.eq('currency', currency)
  if (dateFrom) query = query.gte('date', dateFrom)
  if (dateTo) query = query.lte('date', dateTo)

  query = query.order('date', { ascending: false }).limit(MAX_ROWS)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: data || [] })
}
