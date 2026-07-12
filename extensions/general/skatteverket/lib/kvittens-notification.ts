/**
 * Kvittens confirmation notification (email).
 *
 * The signing happens on Skatteverket's site, and the kvittens is often
 * observed by a background cron long after the user closed the tab. Without
 * an outbound notification the filing confirmation is silent: the user only
 * learns the declaration went through if they come back and look. Both
 * kvittens crons (AGI and VAT) call this after flipping the local state.
 *
 * Email is the delivery channel: it is the one notification surface that is
 * always available (push-notifications is a separate, optional extension and
 * cross-extension imports are not allowed). Deduplication goes through
 * notification_log under type 'skv_kvittens' so a re-observed kvittens never
 * notifies twice.
 *
 * Best-effort by design: a notification failure must never fail the
 * reconciliation that observed the kvittens. The body carries the period and
 * kvittens number but no amounts (same data-minimization stance as the
 * skattekonto drift email).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getEmailService } from '@/lib/email/service'
import { createLogger } from '@/lib/logger'

const log = createLogger('skv-kvittens-notification')

export interface KvittensNotificationInput {
  companyId: string
  /** The token-owning user: recipient candidate for the email. */
  userId: string
  kind: 'vat' | 'agi'
  /** Human-readable period, e.g. "2026-06" or "202606". */
  period: string
  kvittensnummer: string
  /** Dedup key for the notification log (e.g. declaration id or period key). */
  referenceId: string
}

export async function sendKvittensNotification(
  supabase: SupabaseClient,
  input: KvittensNotificationInput
): Promise<{ sent: boolean; reason?: string }> {
  try {
    const email = getEmailService()
    if (!email.isConfigured()) return { sent: false, reason: 'email_not_configured' }

    // Dedup: one notification per kvittens, ever.
    const { data: already } = await supabase
      .from('notification_log')
      .select('id')
      .eq('user_id', input.userId)
      .eq('notification_type', 'skv_kvittens')
      .eq('reference_id', input.referenceId)
      .maybeSingle()
    if (already) return { sent: false, reason: 'duplicate' }

    const recipient = await resolveMemberEmail(supabase, input.companyId, input.userId)
    if (!recipient) {
      log.info('no authorised recipient for kvittens email', { companyId: input.companyId })
      return { sent: false, reason: 'no_recipient' }
    }

    const label = input.kind === 'vat' ? 'Momsdeklarationen' : 'Arbetsgivardeklarationen'
    const labelLower = input.kind === 'vat' ? 'momsdeklarationen' : 'arbetsgivardeklarationen'
    const subject = `${label} för ${input.period} är inlämnad`
    const text = [
      `Din ${labelLower} för ${input.period} har signerats och lämnats in hos Skatteverket.`,
      '',
      `Kvittensnummer: ${input.kvittensnummer}`,
      '',
      'Ingen åtgärd behövs. Kvittensen finns sparad i Accounted.',
    ].join('\n')
    const html = [
      `<p>Din ${labelLower} för ${escapeHtml(input.period)} har signerats och lämnats in hos Skatteverket.</p>`,
      `<p>Kvittensnummer: <strong>${escapeHtml(input.kvittensnummer)}</strong></p>`,
      '<p>Ingen åtgärd behövs. Kvittensen finns sparad i Accounted.</p>',
    ].join('')

    const result = await email.sendEmail({ to: recipient, subject, text, html })
    if (!result.success) {
      log.warn('kvittens email send failed', { companyId: input.companyId, error: result.error })
      return { sent: false, reason: 'send_failed' }
    }

    await supabase.from('notification_log').insert({
      user_id: input.userId,
      company_id: input.companyId,
      notification_type: 'skv_kvittens',
      reference_id: input.referenceId,
      days_before: 0,
      delivery_status: 'sent',
    })

    return { sent: true }
  } catch (err) {
    log.warn('kvittens notification failed', {
      companyId: input.companyId,
      referenceId: input.referenceId,
      error: err instanceof Error ? err.message : String(err),
    })
    return { sent: false, reason: 'error' }
  }
}

/**
 * The recipient must still be an active member of the company (mirrors the
 * drift-email rule): a token owner who has since been removed from the
 * company must not receive filing confirmations for it.
 */
async function resolveMemberEmail(
  supabase: SupabaseClient,
  companyId: string,
  userId: string
): Promise<string | null> {
  const { data: member } = await supabase
    .from('company_members')
    .select('user_id, profiles!inner(email)')
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!member) return null

  type ProfileRef = { email?: string | null } | { email?: string | null }[] | null
  const profiles = (member as { profiles: ProfileRef }).profiles
  const profile = Array.isArray(profiles) ? profiles[0] : profiles
  return profile?.email ?? null
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
