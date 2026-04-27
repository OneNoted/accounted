/**
 * Agent-inkorg feature flag.
 *
 * The AI bookkeeping agent isn't ready for general availability. It is
 * strictly local-dev only — sidebar link, page, API routes, and orchestrator
 * event handlers all return 404 / are hidden on any deployed (Vercel) build.
 */

import { NextResponse } from 'next/server'

export function isAgentInboxEnabled(): boolean {
  return process.env.NODE_ENV === 'development'
}

/**
 * Auto-booking of bank transactions during ingest.
 *
 * Mapping-rule-driven creation of journal entries on import is a future
 * feature. It must NEVER run on the deployed Vercel production build —
 * users have to explicitly book each transaction. Allowed only in local
 * dev (and in the test environment so the auto-book pipeline stays under
 * test coverage). No env-var escape hatch.
 */
export function isAutoBookEnabled(): boolean {
  return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test'
}

/**
 * 404 early-return for API routes. Returns the response when disabled, null
 * when enabled. Usage:
 *
 *   const gate = gateAgentInbox()
 *   if (gate) return gate
 */
export function gateAgentInbox(): NextResponse | null {
  if (isAgentInboxEnabled()) return null
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}
