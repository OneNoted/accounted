import { describe, expect, it } from 'vitest'
import { shouldRefreshAfterInviteFailure } from '@/components/settings/invite-response'

describe('shouldRefreshAfterInviteFailure', () => {
  it('refreshes after a 502 that reports a persisted invitation with failed email delivery', () => {
    expect(
      shouldRefreshAfterInviteFailure(502, {
        data: {
          email: 'joyeuse@agents.notes.supply',
          status: 'pending',
          email_sent: false,
        },
      }),
    ).toBe(true)
  })
})
