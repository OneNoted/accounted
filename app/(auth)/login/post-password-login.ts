import { safeReturnTo } from '@/lib/auth/safe-return-to'

/**
 * Complete password login with a document navigation.
 *
 * Mobile Firefox can stall while the login page performs additional Supabase
 * calls immediately after the password grant. A document navigation lets the
 * server middleware enforce MFA and route onboarding, while pending invite
 * cookies remain available to the destination flow.
 */
export function completePasswordLogin(
  destination: string,
  navigate: (destination: string) => void = window.location.assign.bind(window.location),
): void {
  navigate(safeReturnTo(destination, '/'))
}
