import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchExchangeRate } from '@/lib/currency/riksbanken'
import { getActiveCompanyId } from '@/lib/company/context'
import { guardSandbox } from '@/lib/sandbox/guard'
import type { Currency } from '@/types'

const VALID_CURRENCIES: Currency[] = ['EUR', 'USD', 'GBP', 'NOK', 'DKK']

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const companyId = await getActiveCompanyId(supabase, user.id)
  if (companyId) {
    // Riksbanken's open API is rate-limited per source IP — block the
    // demo from sharing that budget with paying users.
    const blocked = await guardSandbox(supabase, companyId)
    if (blocked) return blocked
  }

  const { searchParams } = new URL(request.url)
  const currency = searchParams.get('currency') as Currency | null
  const dateStr = searchParams.get('date')

  if (!currency || !VALID_CURRENCIES.includes(currency)) {
    return NextResponse.json({ error: 'Invalid currency' }, { status: 400 })
  }

  const date = dateStr ? new Date(dateStr) : undefined
  const rate = await fetchExchangeRate(currency, date)

  if (!rate) {
    return NextResponse.json({ error: 'Could not fetch exchange rate' }, { status: 502 })
  }

  return NextResponse.json({ data: rate })
}
