import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { requireWritePermission } from '@/lib/auth/require-write'

/**
 * DELETE /api/settings/oauth-clients/[id] — revoke a redirect URI
 * registration. Soft-delete via revoked_at so the audit trail survives
 * and the same URI can be re-registered later.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { id } = await params
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const writeCheck = await requireWritePermission(supabase, user.id)
  if (!writeCheck.ok) return writeCheck.response

  const { error } = await supabase
    .from('oauth_client_registrations')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .is('revoked_at', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
