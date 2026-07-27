import posthog from 'posthog-js'
import { isAnalyticsEnabled } from '@/lib/analytics/enabled'

export interface SubmitFeedbackInput {
  message: string
  subject?: string
}

/**
 * Delivery channels.
 *
 * 'email'  - Resend to the support inbox. The guarantee: it works with no
 *            third party beyond the mail provider and needs no analytics.
 * 'ticket' - PostHog Support conversation, linked to the person and their
 *            session replay so we can see what they were doing.
 *
 * Recapt used to be the second channel and would report success on its own,
 * masking a failing /api/support/contact. This does NOT repeat that: the
 * result is `ok` only when email actually delivered. A ticket alone is not
 * treated as delivery, because nobody is watching PostHog at 02:00.
 */
export type SupportChannel = 'email' | 'ticket'

export interface SubmitFeedbackResult {
  ok: boolean
  channels: SupportChannel[]
  error?: string
}

async function submitViaEmail(
  { message, subject }: SubmitFeedbackInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/support/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, message }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return { ok: false, error: data.error || 'Kunde inte skicka meddelandet' }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Nätverksfel' }
  }
}

/**
 * Breadcrumb on the user's PostHog timeline so a support message is visible
 * next to the session replay that led to it: the genuinely useful half of what
 * the Recapt channel provided. NOT a delivery channel, and deliberately
 * carries no message body: free text is user content and would be PII in an
 * event property. Email remains the only thing that actually delivers.
 */
function noteInAnalytics({ subject }: SubmitFeedbackInput, delivered: boolean): void {
  if (!isAnalyticsEnabled()) return
  try {
    posthog.capture('support_feedback_submitted', {
      subject: subject ?? null,
      delivered,
    })
  } catch {
    // Telemetry must never affect whether the user's message went out.
  }
}

/**
 * Open a PostHog Support ticket alongside the email.
 *
 * Unlike the analytics breadcrumb this DOES carry the message body: a support
 * ticket the user deliberately wrote is the one place their words are the
 * point. That makes tickets a distinct processing purpose from analytics, so
 * it is declared separately in .compliance/ropa.yaml and on the privacy page.
 *
 * Never throws and never blocks: if conversations are unavailable (support
 * disabled, no analytics, older SDK) the user still gets the email path.
 */
async function submitViaTicket({ message, subject }: SubmitFeedbackInput): Promise<boolean> {
  if (!isAnalyticsEnabled()) return false
  try {
    const conversations = posthog.conversations
    if (!conversations?.isAvailable?.()) return false
    await conversations.sendMessage(composeTicketBody(message, subject))
    return true
  } catch {
    return false
  }
}

function composeTicketBody(message: string, subject?: string): string {
  return subject ? `[${subject}]\n\n${message}` : message
}

export async function submitFeedback(input: SubmitFeedbackInput): Promise<SubmitFeedbackResult> {
  // Email first and awaited on its own: it is the delivery guarantee, and a
  // slow or failing ticket call must never delay or affect it.
  const emailResult = await submitViaEmail(input)
  const ticketOk = await submitViaTicket(input)

  noteInAnalytics(input, emailResult.ok)

  if (emailResult.ok) {
    return { ok: true, channels: ticketOk ? ['email', 'ticket'] : ['email'] }
  }

  return {
    ok: false,
    channels: ticketOk ? ['ticket'] : [],
    error: emailResult.error,
  }
}
