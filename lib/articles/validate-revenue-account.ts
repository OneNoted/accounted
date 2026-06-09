import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * True when `account` exists in the company's chart of accounts as an ACTIVE
 * class-3 (revenue/intäkt) account. Used to guard the optional per-article
 * revenue-account override so a typo or a non-revenue account can never be
 * pinned to an article (and later booked). Never trust the client.
 *
 * Throws on an unexpected DB error so the route wrapper maps it to the canonical
 * envelope; a simple "account not found" resolves to `false`, not an error.
 */
export async function isValidRevenueAccount(
  supabase: SupabaseClient,
  companyId: string,
  account: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('chart_of_accounts')
    .select('account_number')
    .eq('company_id', companyId)
    .eq('account_class', 3)
    .eq('is_active', true)
    .eq('account_number', account)
    .maybeSingle()

  if (error) throw error
  return !!data
}
