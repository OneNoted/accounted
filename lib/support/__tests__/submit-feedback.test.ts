import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { submitFeedback } from '@/lib/support/submit-feedback'

// posthog-js is browser-only and irrelevant to delivery: stub it so the
// analytics breadcrumb can be asserted without initialising the real SDK.
const captureMock = vi.fn()
vi.mock('posthog-js', () => ({ default: { capture: (...a: unknown[]) => captureMock(...a) } }))

describe('submitFeedback', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    captureMock.mockClear()
    // Analytics on by default so the breadcrumb path is exercised.
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', 'false')
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN', 'phc_test')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  function stubFetchOk() {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchSpy)
    return fetchSpy
  }

  it('delivers over email and reports the email channel', async () => {
    const fetchSpy = stubFetchOk()

    const result = await submitFeedback({ subject: 'Hjälpsida', message: 'Hjälp tack' })

    expect(result.ok).toBe(true)
    expect(result.channels).toEqual(['email'])
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/support/contact',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ subject: 'Hjälpsida', message: 'Hjälp tack' }),
      })
    )
  })

  // Recapt used to mask a failing email endpoint by reporting success on its
  // own channel. Email is now the only delivery path, so its failure must
  // surface to the user instead of being swallowed.
  it('reports failure when the email endpoint rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Mailtjänsten är inte konfigurerad' }),
      })
    )

    const result = await submitFeedback({ message: 'msg' })

    expect(result.ok).toBe(false)
    expect(result.channels).toEqual([])
    expect(result.error).toBe('Mailtjänsten är inte konfigurerad')
  })

  it('reports failure when fetch itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network down')))

    const result = await submitFeedback({ message: 'msg' })

    expect(result.ok).toBe(false)
    expect(result.channels).toEqual([])
    expect(result.error).toBe('Network down')
  })

  it('records a PostHog breadcrumb WITHOUT the message body', async () => {
    stubFetchOk()

    await submitFeedback({ subject: 'Hjälpsida', message: 'känslig text om mitt bolag' })

    expect(captureMock).toHaveBeenCalledWith('support_feedback_submitted', {
      subject: 'Hjälpsida',
      delivered: true,
    })
    // Free text is user content: it must never ride along as an event property.
    expect(JSON.stringify(captureMock.mock.calls)).not.toContain('känslig text')
  })

  it('marks the breadcrumb undelivered when email failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))

    await submitFeedback({ message: 'msg' })

    expect(captureMock).toHaveBeenCalledWith(
      'support_feedback_submitted',
      expect.objectContaining({ delivered: false })
    )
  })

  it('skips the breadcrumb entirely when analytics is off (self-hosted)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', 'true')
    stubFetchOk()

    const result = await submitFeedback({ message: 'msg' })

    expect(result.ok).toBe(true)
    expect(captureMock).not.toHaveBeenCalled()
  })

  it('does not let a throwing analytics SDK break delivery', async () => {
    captureMock.mockImplementationOnce(() => {
      throw new Error('posthog boom')
    })
    stubFetchOk()

    const result = await submitFeedback({ message: 'msg' })

    expect(result.ok).toBe(true)
    expect(result.channels).toEqual(['email'])
  })
})
