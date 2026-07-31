import { describe, expect, it, vi } from 'vitest'
import type { ConsumeInviteCookieResult } from '@/lib/auth/consume-invite-cookie'
import { completeMfaEnrollment } from '../complete-enrollment'

const noInvite: ConsumeInviteCookieResult = {
  attempted: false,
  disposition: null,
  accepted: false,
  cleared: false,
  problem: null,
}

describe('completeMfaEnrollment', () => {
  it('hard-navigates to the dashboard when a pending invite is accepted', async () => {
    const consumeInvite = vi.fn(async (): Promise<ConsumeInviteCookieResult> => ({
      attempted: true,
      disposition: 'accepted',
      accepted: true,
      cleared: true,
      problem: null,
    }))
    const hardNavigate = vi.fn()
    const push = vi.fn()

    const result = await completeMfaEnrollment('/invoices/new', {
      consumeInvite,
      hardNavigate,
      push,
      refresh: vi.fn(),
    })

    expect(result.accepted).toBe(true)
    expect(hardNavigate).toHaveBeenCalledWith('/')
    expect(push).not.toHaveBeenCalled()
  })

  it('preserves a retryable invite outcome and continues to the safe destination', async () => {
    const retryable: ConsumeInviteCookieResult = {
      attempted: true,
      disposition: 'retryable',
      accepted: false,
      cleared: false,
      problem: 'retryable',
    }
    const hardNavigate = vi.fn()
    const push = vi.fn()
    const refresh = vi.fn()

    const result = await completeMfaEnrollment('/invoices/new', {
      consumeInvite: vi.fn(async () => retryable),
      hardNavigate,
      push,
      refresh,
    })

    expect(result).toEqual(retryable)
    expect(hardNavigate).not.toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith('/invoices/new')
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('hard-navigates route-handler destinations and rejects hostile returnTo values', async () => {
    const hardNavigate = vi.fn()
    const push = vi.fn()

    await completeMfaEnrollment('/api/mcp-oauth/authorize?client_id=test', {
      consumeInvite: vi.fn(async () => noInvite),
      hardNavigate,
      push,
      refresh: vi.fn(),
    })
    expect(hardNavigate).toHaveBeenLastCalledWith('/api/mcp-oauth/authorize?client_id=test')

    await completeMfaEnrollment('//evil.example/steal', {
      consumeInvite: vi.fn(async () => noInvite),
      hardNavigate,
      push,
      refresh: vi.fn(),
    })
    expect(push).toHaveBeenLastCalledWith('/')
  })
})
