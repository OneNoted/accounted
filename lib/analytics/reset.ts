import posthog from 'posthog-js'
import { isAnalyticsEnabled } from './enabled'

/**
 * Detach the current person from PostHog on logout.
 *
 * Call this ONLY on the transition out of an identified session, never on an
 * initially anonymous page load: reset() discards the anonymous distinct id
 * and the history attached to it, so a stray call at boot would sever the
 * pre-login part of a signup funnel.
 *
 * Replaces clearRecaptIdentity() from lib/recapt.ts. That helper also had to
 * sweep localStorage by key prefix, because Recapt cached the uid there. We
 * run with `persistence: 'memory'`, so there is no cached identity to wipe:
 * reset() is sufficient. (Surveys' own `seenSurvey_*` flags are deliberately
 * left alone: they carry no identity, only "this browser already saw this
 * survey", and clearing them would re-prompt the next person on the device.)
 */
export function resetAnalyticsIdentity(): void {
  if (typeof window === 'undefined') return
  if (!isAnalyticsEnabled()) return
  try {
    posthog.reset()
  } catch {
    // best-effort: we're already in a logout flow
  }
}
