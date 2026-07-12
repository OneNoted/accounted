'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SupportLink } from '@/components/ui/support-link'

/**
 * App-wide error boundary (rendered from app/error.tsx). It catches any render
 * error below the root layout that has no closer boundary, which includes the
 * auth and onboarding segments AND their layouts (an error.tsx never catches
 * its own sibling layout, only a parent boundary does).
 *
 * Those segments fire several Supabase auth/DB queries at the exact moment a
 * session is established (BankID login -> /auth/callback -> the /select-company
 * picker). A transient failure there, most often a Supabase refresh-token
 * rotation race in the first request after the cookies are set, or a stale JS
 * chunk right after a deploy, used to escape every boundary and hit
 * app/global-error.tsx, which blanks the whole document with a bare "Nagot gick
 * fel" screen for a second before the next request repainted and logged the
 * user in normally.
 *
 * Recovery is a single hard reload, NOT React's reset(). A reload re-runs
 * middleware (picking up the freshly rotated auth cookie) and fetches a fresh
 * bundle (recovering a ChunkLoadError after a deploy): the same
 * browser-navigation heal these transients already relied on. A soft reset()
 * re-renders against the same stale server payload / bundle and just re-throws.
 *
 * A per-path sessionStorage time-guard makes the reload fire at most once, so a
 * genuinely persistent error settles on the manual fallback instead of looping.
 */
const RELOAD_STAMP_PREFIX = 'accounted:app-error-reload-at:'
const RELOAD_WINDOW_MS = 12_000

function stampKey(): string {
  return (
    RELOAD_STAMP_PREFIX +
    (typeof window !== 'undefined' ? window.location.pathname : '')
  )
}

// Decided once at mount via a lazy state initializer, never in an effect, so
// the auto-reload stays off React's setState-in-effect path. 'reloading'
// renders nothing while the single hard reload is issued; 'fallback' shows the
// manual UI. On the server (root layout threw during SSR) there is no window,
// so it starts in 'reloading' -> renders nothing and defers to the client,
// avoiding both a server crash and a flash in the common recover-invisibly case.
function decideInitialPhase(): 'reloading' | 'fallback' {
  if (typeof window === 'undefined') return 'reloading'
  try {
    const last = Number(window.sessionStorage.getItem(stampKey()) ?? '0')
    return Number.isFinite(last) && Date.now() - last < RELOAD_WINDOW_MS
      ? 'fallback'
      : 'reloading'
  } catch {
    // sessionStorage blocked (private mode etc.): don't risk a reload loop,
    // show the fallback so the user always has an explicit way forward.
    return 'fallback'
  }
}

export function AppErrorBoundary({
  error,
  scope,
}: {
  error: Error & { digest?: string }
  scope: string
}) {
  const [phase] = useState<'reloading' | 'fallback'>(decideInitialPhase)

  useEffect(() => {
    console.error(
      `[${scope}] Unhandled error${error.digest ? ` (digest ${error.digest})` : ''}:`,
      error,
    )
    if (phase !== 'reloading') return
    try {
      window.sessionStorage.setItem(stampKey(), String(Date.now()))
    } catch {
      // Worst case: no stamp written, and a later error reloads again.
    }
    window.location.reload()
  }, [phase, error, scope])

  // During the single automatic reload, render nothing so a transient error
  // never flashes any UI at all.
  if (phase === 'reloading') return null

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h2 className="text-xl font-semibold">Något gick fel</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Ett oväntat fel uppstod. Försök igen eller{' '}
        <SupportLink variant="inline" subject="Oväntat fel">
          kontakta support
        </SupportLink>{' '}
        om problemet kvarstår.
      </p>
      <Button onClick={() => window.location.reload()}>Försök igen</Button>
    </div>
  )
}
