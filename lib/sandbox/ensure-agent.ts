import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Backfill a verified agent_profile for sandbox companies that pre-date the
 * profile-seeding step in /api/sandbox/seed. Without this, an anonymous user
 * who started their session before that seed change was deployed would see
 * "Bygg din bokföringsassistent" CTAs all over the dashboard, even though
 * the sandbox is supposed to ship with the assistant chrome pre-built.
 *
 * Best-effort: any error is swallowed and the caller continues. Worst case
 * the user sees the old behaviour on this request; next request retries.
 *
 * Idempotent — the UNIQUE constraint on company_id makes the insert a no-op
 * once a profile exists.
 */
export async function ensureSandboxAgentProfile(
  supabase: SupabaseClient,
  userId: string,
  companyId: string,
): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from('agent_profiles')
      .select('id')
      .eq('company_id', companyId)
      .maybeSingle()
    if (existing) return

    await supabase.from('agent_profiles').insert({
      company_id: companyId,
      display_name: 'Anna',
      avatar_id: 'notionists-3',
      horizontal_atoms: [
        'horizontal/swedish-vat',
        'horizontal/swedish-accounting-compliance',
      ],
      vertical_atoms: ['vertical/consulting'],
      modifier_atoms: [],
      profile_summary:
        'Du är Anna, en revisorsassistent för en svensk enskild firma som tillhandahåller IT-konsulttjänster i Stockholm. Företaget är momsregistrerat (kvartalsvis), använder kontantmetoden och fakturerar både svenska och utländska kunder.',
      source_signals: { is_sandbox: true },
      field_overrides: {},
      composer_model: 'sandbox-demo',
      composer_version: 1,
      composed_at: new Date().toISOString(),
      verified_at: new Date().toISOString(),
      verified_by_user_id: userId,
      intake_completed_at: new Date().toISOString(),
    })
  } catch {
    // Swallowed by design — see comment above.
  }
}
