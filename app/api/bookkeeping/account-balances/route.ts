import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { requireCompanyId } from '@/lib/company/context'
import { validateQuery } from '@/lib/api/validate'
import { AccountBalancesQuerySchema } from '@/lib/api/schemas'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params = validateQuery(request, AccountBalancesQuerySchema)
  if (!params.success) return params.response
  const { accounts, as_of } = params.data

  const companyId = await requireCompanyId(supabase, user.id)

  const { data: entries, error: entriesError } = await supabase
    .from('journal_entries')
    .select('id')
    .eq('company_id', companyId)
    .eq('status', 'posted')
    .lte('entry_date', as_of)

  if (entriesError) {
    return NextResponse.json({ error: entriesError.message }, { status: 500 })
  }

  const balances = new Map<string, number>()
  for (const acct of accounts) balances.set(acct, 0)

  if (!entries || entries.length === 0) {
    return NextResponse.json({
      data: accounts.map((account_number) => ({ account_number, balance: 0 })),
    })
  }

  const entryIds = entries.map((e) => e.id)
  const batchSize = 200

  for (let i = 0; i < entryIds.length; i += batchSize) {
    const batch = entryIds.slice(i, i + batchSize)
    const { data: lines, error: linesError } = await supabase
      .from('journal_entry_lines')
      .select('account_number, debit_amount, credit_amount')
      .in('journal_entry_id', batch)
      .in('account_number', accounts)

    if (linesError) {
      return NextResponse.json({ error: linesError.message }, { status: 500 })
    }
    if (!lines) continue

    for (const line of lines) {
      const current = balances.get(line.account_number) ?? 0
      balances.set(
        line.account_number,
        current + (Number(line.debit_amount) || 0) - (Number(line.credit_amount) || 0),
      )
    }
  }

  return NextResponse.json({
    data: accounts.map((account_number) => ({
      account_number,
      balance: Math.round((balances.get(account_number) ?? 0) * 100) / 100,
    })),
  })
}
