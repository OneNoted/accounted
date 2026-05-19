import { getEmailService } from '@/lib/email/service'
import { createLogger } from '@/lib/logger'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { ExtensionContext } from '@/lib/extensions/types'
import type { EventPayload } from '@/lib/events/types'

const log = createLogger('skattekonto-drift-email')

/**
 * Email handler for `skattekonto.drift_detected`. Notifies the company contact
 * that their cached Skatteverket saldo and GL 1630 sum diverge beyond the
 * configured tolerance, with a short diagnostic listing the most recent
 * unbooked SKV rows.
 *
 * Degrades silently when no email service is registered (e.g. self-hosted
 * installations without Resend configured).
 */
export async function handleSkattekontoDriftDetected(
  payload: EventPayload<'skattekonto.drift_detected'>,
  ctx?: ExtensionContext,
): Promise<void> {
  if (!ctx) {
    log.warn('drift event fired without ctx — cannot resolve recipient', {
      companyId: payload.companyId,
    })
    return
  }

  const email = getEmailService()
  if (!email.isConfigured()) {
    log.info('email service not configured — skipping drift alert', {
      companyId: payload.companyId,
    })
    return
  }

  const recipient = await resolveRecipient(ctx, payload.userId)
  if (!recipient) {
    log.warn('no recipient resolved for drift alert', {
      companyId: payload.companyId,
      userId: payload.userId,
    })
    return
  }

  const driftFormatted = formatCurrency(Math.abs(payload.drift))
  const direction =
    payload.drift > 0
      ? 'Skatteverkets saldo är högre än bokföringen'
      : 'Bokföringen är högre än Skatteverkets saldo'
  const fetchedAt = formatDate(new Date(payload.fetchedAt).toISOString())

  const subject = 'Skattekontot stämmer inte med bokföringen'
  const text = [
    `${direction} med ${driftFormatted} per ${fetchedAt}.`,
    '',
    `Skatteverket saldo: ${formatCurrency(payload.saldoSkatteverket)}`,
    `Bokföring (1630): ${formatCurrency(payload.glSum1630)}`,
    `Differens: ${formatCurrency(payload.drift)}`,
    '',
    payload.unbookedCount > 0
      ? `Det finns ${payload.unbookedCount} obokförd${payload.unbookedCount === 1 ? '' : 'a'} skattekonto-rad${payload.unbookedCount === 1 ? '' : 'er'} fram till ${fetchedAt}.`
      : 'Alla skattekonto-rader är bokförda — differensen kommer från ett verifikat som inte motsvaras av en transaktion hos Skatteverket.',
    '',
    'Logga in på gnubok för att granska.',
  ].join('\n')

  const html = `
<p>${escapeHtml(direction)} med <strong>${escapeHtml(driftFormatted)}</strong> per ${escapeHtml(fetchedAt)}.</p>
<ul>
  <li>Skatteverket saldo: <strong>${escapeHtml(formatCurrency(payload.saldoSkatteverket))}</strong></li>
  <li>Bokföring (1630): <strong>${escapeHtml(formatCurrency(payload.glSum1630))}</strong></li>
  <li>Differens: <strong>${escapeHtml(formatCurrency(payload.drift))}</strong></li>
</ul>
<p>${
  payload.unbookedCount > 0
    ? `Det finns <strong>${payload.unbookedCount}</strong> obokförd${payload.unbookedCount === 1 ? '' : 'a'} skattekonto-rad${payload.unbookedCount === 1 ? '' : 'er'} fram till ${escapeHtml(fetchedAt)}.`
    : 'Alla skattekonto-rader är bokförda — differensen kommer från ett verifikat som inte motsvaras av en transaktion hos Skatteverket.'
}</p>
<p>Logga in på gnubok för att granska.</p>
`.trim()

  try {
    const result = await email.sendEmail({
      to: recipient,
      subject,
      text,
      html,
    })
    if (!result.success) {
      log.warn('drift email send failed', {
        companyId: payload.companyId,
        error: result.error,
      })
    }
  } catch (err) {
    log.error('drift email send threw', {
      companyId: payload.companyId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

async function resolveRecipient(
  ctx: ExtensionContext,
  userId: string,
): Promise<string | null> {
  // Prefer company contact email; fall back to the syncing user's email.
  const { data: settings } = await ctx.supabase
    .from('company_settings')
    .select('contact_email')
    .eq('company_id', ctx.companyId)
    .maybeSingle()

  const contactEmail = (settings as { contact_email?: string | null } | null)?.contact_email
  if (contactEmail) return contactEmail

  const { data: profile } = await ctx.supabase
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .maybeSingle()
  return (profile as { email?: string | null } | null)?.email ?? null
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
