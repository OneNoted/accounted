import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'

const log = createLogger('onboarding-client')

export async function POST(request: Request) {
  try {
    const { message, extra } = await request.json()

    // Client-reported onboarding errors. Route through the structured logger so
    // the (untrusted, client-supplied) message + extra are PII-redacted —
    // personnummer / IBAN / tokens etc. via the logger's REDACT_KEYS — before
    // reaching Vercel logs. The previous raw `console.error(..., JSON.stringify(extra))`
    // logged them verbatim.
    log.error('client onboarding error', { clientMessage: message, extra })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
}
