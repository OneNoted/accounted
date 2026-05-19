import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { ensureInitialized } from '@/lib/init'
import { requireCompanyId } from '@/lib/company/context'
import { createExtensionContext } from '@/lib/extensions/context-factory'
import { computeSkattekontoDrift } from '@/extensions/general/skatteverket/lib/skattekonto-drift'

ensureInitialized()

/**
 * GET /api/extensions/skatteverket/skattekonto/drift
 *
 * Returns the current SKV saldo vs GL 1630 drift snapshot for the active
 * company. Backs the dashboard SkattekontoDriftTile. Returns null when no
 * snapshot exists yet (fresh company, never synced).
 */
export async function GET(_request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const companyId = await requireCompanyId(supabase, user.id)
  const ctx = createExtensionContext(supabase, user.id, companyId, 'skatteverket')

  const drift = await computeSkattekontoDrift(ctx)
  return NextResponse.json({ data: drift })
}
