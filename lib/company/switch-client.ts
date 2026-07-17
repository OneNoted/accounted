'use client'

/**
 * Client-side tail of a company switch, shared by CompanySwitcher and the
 * bureau roster's OpenClientButton so the two can never drift. Call AFTER the
 * switchCompany server action has succeeded.
 *
 * Notifies every other open tab of the same user so they hard-reload onto the
 * new company. BroadcastChannel is best-effort: if the browser doesn't
 * support it (very old) we still hard-reload ourselves, and other tabs will
 * self-correct via the visibilitychange / pageshow listeners in
 * CompanyTabSync on their next focus event.
 *
 * The hard navigation tears down React state, router cache, in-flight
 * fetches, blob URLs, etc. This is the whole point: nothing from the previous
 * company can survive the switch.
 */
export function performCompanySwitch(companyId: string, target: string = '/'): void {
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel('gnubok-company-switch')
      channel.postMessage({ companyId })
      channel.close()
    } catch {
      // Ignore: hard reload still happens below
    }
  }
  window.location.assign(target)
}
