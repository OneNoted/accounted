import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { normalizeOrgNumber } from '@/lib/company-lookup/normalize-org-number'

/**
 * GET /api/company/check-org-number?org_number=XXXXXXXXXX
 *
 * Returns `{ data: { exists: boolean } }` indicating whether the given
 * organisation number is already registered in any non-archived Accounted
 * company. Used by the onboarding wizard to warn users before they try to
 * create a duplicate.
 *
 * Normalizes the input with the same rule as the server action
 * (`normalizeOrgNumber`) so that a 12-digit form typed in the UI still
 * matches a 10-digit stored canonical. Returns `exists: false` for
 * malformed input — the submit-time server action will reject it with
 * `org_number_invalid`, which is the right place to surface the error.
 *
 * Requires authentication so the endpoint can't be used to enumerate the
 * full set of org numbers on the platform. Uses the service role internally
 * because RLS hides rows the caller isn't a member of — which is exactly
 * what we need to detect ("owned by someone else").
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const raw = url.searchParams.get('org_number') ?? ''
  if (!raw) {
    return NextResponse.json({ error: 'org_number is required' }, { status: 400 })
  }

  const canonical = normalizeOrgNumber(raw)
  if (!canonical) {
    // Invalid format/Luhn — not a duplicate of anything by definition.
    return NextResponse.json({ data: { exists: false } })
  }

  const service = createServiceClient()
  const { data, error } = await service
    .from('companies')
    .select('id')
    .eq('org_number', canonical)
    .is('archived_at', null)
    .limit(1)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: { exists: !!data } })
}
