import { describe, expect, it, vi } from 'vitest'
import { completePasswordLogin } from '../post-password-login'

describe('completePasswordLogin', () => {
  it('uses a full navigation immediately after a successful password grant', () => {
    const navigate = vi.fn()

    completePasswordLogin('/', navigate)

    expect(navigate).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith('/')
  })

  it('preserves a safe deep-link destination', () => {
    const navigate = vi.fn()

    completePasswordLogin('/api/mcp-oauth/authorize?client_id=test', navigate)

    expect(navigate).toHaveBeenCalledWith('/api/mcp-oauth/authorize?client_id=test')
  })

  it.each([
    'https://evil.example/steal',
    '//evil.example/steal',
    '/..//evil.example/steal',
    '/%2e%2e//evil.example/steal',
  ])('sanitizes hostile next value %s at the login navigation boundary', (destination) => {
    const navigate = vi.fn()

    completePasswordLogin(destination, navigate)

    expect(navigate).toHaveBeenCalledWith('/')
  })
})
