export function shouldRefreshAfterInviteFailure(status: number, body: unknown): boolean {
  if (status !== 502 || typeof body !== 'object' || body === null) return false

  const data = (body as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return false

  const invitation = data as {
    email?: unknown
    status?: unknown
    email_sent?: unknown
  }

  return (
    typeof invitation.email === 'string' &&
    invitation.status === 'pending' &&
    invitation.email_sent === false
  )
}
