import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const verifyOtp = vi.fn()
const exchangeCodeForSession = vi.fn()

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      verifyOtp,
      exchangeCodeForSession,
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({ data: null }),
        listFactors: vi.fn().mockResolvedValue({ data: null }),
      },
    },
    from: vi.fn(),
    rpc: vi.fn(),
  })),
}))

vi.mock('@/lib/auth/invite-tokens', () => ({
  hashInviteToken: vi.fn(),
}))

import { GET } from '../route'

describe('GET /auth/callback: recovery flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('redirects to /reset-password after a successful recovery OTP (token-hash flow)', async () => {
    verifyOtp.mockResolvedValue({ error: null })

    const request = new NextRequest(
      'http://localhost:3000/auth/callback?token_hash=abc&type=recovery&next=/reset-password'
    )
    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/reset-password')
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc', type: 'recovery' })
  })

  it('uses the configured public origin instead of the internal request origin', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://accounted.ts.notes.supply')
    verifyOtp.mockResolvedValue({ error: null })

    const request = new NextRequest(
      'http://0.0.0.0:3000/auth/callback?token_hash=abc&type=recovery&next=/reset-password'
    )
    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://accounted.ts.notes.supply/reset-password'
    )
  })

  it('keeps legacy-host recovery callbacks on the legacy origin', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://accounted.ts.notes.supply')
    verifyOtp.mockResolvedValue({ error: null })

    const request = new NextRequest(
      'http://0.0.0.0:3000/auth/callback?token_hash=abc&type=recovery&next=/reset-password',
      { headers: { host: 'app.gnubok.se' } }
    )
    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://app.gnubok.se/reset-password')
  })

  it('does not trust legacy-host lookalikes', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://accounted.ts.notes.supply')
    verifyOtp.mockResolvedValue({ error: null })

    const request = new NextRequest(
      'http://0.0.0.0:3000/auth/callback?token_hash=abc&type=recovery&next=/reset-password',
      { headers: { host: 'app.gnubok.se.evil.example' } }
    )
    const response = await GET(request)

    expect(response.headers.get('location')).toBe(
      'https://accounted.ts.notes.supply/reset-password'
    )
  })

  it('redirects to /reset-password after a successful PKCE exchange when next=/reset-password (no type param)', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null })

    const request = new NextRequest(
      'http://localhost:3000/auth/callback?code=xyz&next=/reset-password'
    )
    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/reset-password')
    expect(exchangeCodeForSession).toHaveBeenCalledWith('xyz')
  })

  it('tags a failed recovery link with flow=recovery so the login page shows reset copy', async () => {
    verifyOtp.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } })

    const request = new NextRequest(
      'http://localhost:3000/auth/callback?token_hash=expired&type=recovery&next=/reset-password'
    )
    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/login?error=auth_error&flow=recovery'
    )
  })

  it('tags a failed signup confirmation (PKCE code, no type/next) with flow=signup', async () => {
    exchangeCodeForSession.mockResolvedValue({
      error: { message: 'code verifier missing' },
    })

    const request = new NextRequest('http://localhost:3000/auth/callback?code=xyz')
    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/login?error=auth_error&flow=signup'
    )
  })
})
