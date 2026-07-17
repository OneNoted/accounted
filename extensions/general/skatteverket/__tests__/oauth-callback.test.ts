/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// after() must be observable: the callback hands it the eager refresh
// promise so the serverless function stays alive past the response.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: vi.fn() }
})

vi.mock('../lib/oauth', () => ({
  buildAuthorizeUrl: vi.fn().mockReturnValue('https://skv.test/authorize'),
  generatePkcePair: vi.fn().mockReturnValue({ verifier: 'v', challenge: 'c' }),
  exchangeCodeForTokens: vi.fn(),
}))

vi.mock('../lib/token-store', () => ({
  storeTokens: vi.fn().mockResolvedValue(undefined),
  getTokens: vi.fn().mockResolvedValue(null),
  deleteTokens: vi.fn().mockResolvedValue(undefined),
  getTokenHealth: vi.fn().mockResolvedValue(null),
  markNeedsReconsent: vi.fn().mockResolvedValue(undefined),
  RECONSENT_ERROR_CODES: ['SESSION_EXPIRED', 'REFRESH_EXHAUSTED', 'MISSING_SCOPE', 'TOKEN_CORRUPTED'],
}))

vi.mock('../lib/post-connect-refresh', () => ({
  runPostConnectRefresh: vi.fn(),
}))

vi.mock('@/lib/company/context', () => ({
  requireCompanyId: vi.fn().mockResolvedValue('company-1'),
}))

const { mockCreateClient } = vi.hoisted(() => ({ mockCreateClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}))

import { after } from 'next/server'
import { skatteverketExtension } from '../index'
import { exchangeCodeForTokens } from '../lib/oauth'
import { storeTokens } from '../lib/token-store'
import { runPostConnectRefresh } from '../lib/post-connect-refresh'

const mockExchange = vi.mocked(exchangeCodeForTokens)
const mockStoreTokens = vi.mocked(storeTokens)
const mockRefresh = vi.mocked(runPostConnectRefresh)

const STATE = 'state-1'

/**
 * Supabase mock covering the callback's extension_data reads (keyed lookups
 * for oauth_state / oauth_redirect_uri / oauth_code_verifier /
 * oauth_return_to) and the post-exchange cleanup delete.
 */
function makeSupabase(overrides: Record<string, string | null> = {}) {
  const values: Record<string, string | null> = {
    oauth_state: STATE,
    oauth_redirect_uri: 'https://app.example/api/extensions/ext/skatteverket/callback',
    oauth_code_verifier: 'verifier-1',
    oauth_return_to: '/settings/tax',
    ...overrides,
  }
  const from = vi.fn(() => {
    let key: string | null = null
    const result = () => ({
      data: key !== null && values[key] != null ? { value: values[key] } : null,
    })
    const chain: any = {
      select: vi.fn(() => chain),
      delete: vi.fn(() => chain),
      eq: vi.fn((col: string, val: string) => {
        if (col === 'key') key = val
        return chain
      }),
      in: vi.fn(() => Promise.resolve({ error: null })),
      single: vi.fn(async () => result()),
      maybeSingle: vi.fn(async () => result()),
    }
    return chain
  })
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } } })),
    },
    from,
  }
}

function callbackRoute() {
  const route = skatteverketExtension.apiRoutes?.find(
    (r) => r.method === 'GET' && r.path === '/callback',
  )
  expect(route, 'GET /callback must be registered').toBeDefined()
  expect(route!.skipAuth).toBe(true)
  return route!
}

function callbackRequest(params: string) {
  return new Request(
    `https://app.example/api/extensions/ext/skatteverket/callback?${params}`,
  )
}

describe('skatteverket OAuth callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateClient.mockResolvedValue(makeSupabase() as any)
    mockExchange.mockResolvedValue({
      access_token: 'at',
      refresh_token: 'rt',
      expires_at: Date.now() + 3_600_000,
      refresh_count: 0,
      scope: 'momsdeklaration skahmst agd',
    })
  })

  it('responds with the success page WITHOUT awaiting the post-connect refresh', async () => {
    // A refresh that never settles: if the handler regressed to awaiting it,
    // this test would hang into the vitest timeout instead of passing.
    let refreshStarted = false
    mockRefresh.mockImplementation(() => {
      refreshStarted = true
      return new Promise(() => {})
    })

    const response = await callbackRoute().handler(
      callbackRequest(`code=abc&state=${STATE}`),
    )

    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('skatteverket-oauth-success')
    expect(html).toContain('window.close()')

    expect(mockExchange).toHaveBeenCalledWith(
      'abc',
      'https://app.example/api/extensions/ext/skatteverket/callback',
      'verifier-1',
    )
    expect(mockStoreTokens).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      expect.objectContaining({ access_token: 'at' }),
      'company-1',
    )
    // The refresh was started eagerly and handed to after() so it survives
    // past the response; it must not gate the response itself.
    expect(refreshStarted).toBe(true)
    expect(vi.mocked(after)).toHaveBeenCalledTimes(1)
  })

  it('still succeeds when after() is unavailable (outside a request scope)', async () => {
    mockRefresh.mockResolvedValue({ synced: true, reconciled: 0 })
    vi.mocked(after).mockImplementation(() => {
      throw new Error('after called outside request scope')
    })

    const response = await callbackRoute().handler(
      callbackRequest(`code=abc&state=${STATE}`),
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('skatteverket-oauth-success')
  })

  it('returns the error page on a state (CSRF) mismatch without exchanging the code', async () => {
    const response = await callbackRoute().handler(
      callbackRequest('code=abc&state=wrong-state'),
    )

    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('skatteverket-oauth-error')
    expect(mockExchange).not.toHaveBeenCalled()
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('returns the error page when the token exchange fails', async () => {
    mockExchange.mockRejectedValueOnce(new Error('exchange boom'))

    const response = await callbackRoute().handler(
      callbackRequest(`code=abc&state=${STATE}`),
    )

    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('skatteverket-oauth-error')
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})
