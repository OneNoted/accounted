import {
  consumeInviteCookie,
  type ConsumeInviteCookieResult,
} from '@/lib/auth/consume-invite-cookie'
import { safeReturnTo } from '@/lib/auth/safe-return-to'

interface EnrollmentCompletionDependencies {
  consumeInvite: () => Promise<ConsumeInviteCookieResult>
  hardNavigate: (destination: string) => void
  push: (destination: string) => void
  refresh: () => void
}

/** Finish first-factor enrollment with the same invite handoff as MFA verify. */
export async function completeMfaEnrollment(
  destination: string,
  dependencies: EnrollmentCompletionDependencies,
): Promise<ConsumeInviteCookieResult> {
  const invite = await dependencies.consumeInvite()
  if (invite.accepted) {
    dependencies.hardNavigate('/')
    return invite
  }

  const safeDestination = safeReturnTo(destination, '/')
  if (safeDestination.startsWith('/api/')) {
    dependencies.hardNavigate(safeDestination)
    return invite
  }

  dependencies.push(safeDestination)
  dependencies.refresh()
  return invite
}

export function browserEnrollmentCompletionDependencies(
  push: (destination: string) => void,
  refresh: () => void,
): EnrollmentCompletionDependencies {
  return {
    consumeInvite: consumeInviteCookie,
    hardNavigate: window.location.assign.bind(window.location),
    push,
    refresh,
  }
}
