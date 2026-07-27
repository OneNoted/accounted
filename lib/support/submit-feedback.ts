import posthog from 'posthog-js'
import { isAnalyticsEnabled } from '@/lib/analytics/enabled'

export interface SubmitFeedbackInput {
  message: string
  subject?: string
}

/**
 * Delivery channels. Recapt used to be a second one: it accepted the message
 * through its feedback SDK, so a failing /api/support/contact still reported
 * success. With Recapt gone, email is the only delivery channel and its
 * failure is now a real, visible failure. That is correct: silently
 * "succeeding" while the message reached nobody was the worse behaviour.
 */
export type SupportChannel = 'email'

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

export async function submitFeedback(input: SubmitFeedbackInput): Promise<SubmitFeedbackResult> {
  const emailResult = await submitViaEmail(input)

  noteInAnalytics(input, emailResult.ok)

  if (emailResult.ok) {
    return { ok: true, channels: ['email'] }
  }

  return {
    ok: false,
    channels: [],
    error: emailResult.error,
  }
}
