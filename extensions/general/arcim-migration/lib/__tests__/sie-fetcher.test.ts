import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  providerSupportsSie,
  fetchProviderSieFiles,
  ALLOWED_FISCAL_YEARS,
} from '../sie-fetcher'

/**
 * Routes mocked fetch responses by URL substring. The fetcher goes through
 * the real provider clients (rate limiter in in-memory mode, retry on), so
 * these tests exercise the full request path including auth headers and the
 * encoding-detection decode of binary SIE payloads.
 */
function routeFetch(
  fetchSpy: ReturnType<typeof vi.spyOn>,
  routes: { match: string; respond: () => Response }[],
) {
  fetchSpy.mockImplementation(((input: RequestInfo | URL) => {
    const url = String(input)
    const route = routes.find((r) => url.includes(r.match))
    if (!route) {
      return Promise.resolve(new Response(`no mock for ${url}`, { status: 404 }))
    }
    return Promise.resolve(route.respond())
  }) as typeof fetch)
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Build a CP437-encoded SIE snippet containing "Företagskonto" (ö = 0x94). */
function cp437SieBytes(label: string): Uint8Array {
  const prefix = `#FLAGGA 0\n#KONTO 1930 "F`
  const suffix = `retagskonto ${label}"\n`
  const bytes: number[] = []
  for (const c of prefix) bytes.push(c.charCodeAt(0))
  bytes.push(0x94) // 'ö' in CP437
  for (const c of suffix) bytes.push(c.charCodeAt(0))
  return new Uint8Array(bytes)
}

function octetResponse(bytes: Uint8Array): Response {
  return new Response(bytes.buffer as ArrayBuffer, {
    status: 200,
    headers: { 'Content-Type': 'application/octet-stream' },
  })
}

describe('providerSupportsSie', () => {
  it('is true for providers with SIE-over-API, false otherwise', () => {
    expect(providerSupportsSie('fortnox')).toBe(true)
    expect(providerSupportsSie('briox')).toBe(true)
    expect(providerSupportsSie('bjornlunden')).toBe(true)
    expect(providerSupportsSie('visma')).toBe(false)
    expect(providerSupportsSie('bokio')).toBe(false)
  })
})

describe('fetchProviderSieFiles', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('rejects providers without SIE support', async () => {
    await expect(fetchProviderSieFiles('visma', 't', undefined)).rejects.toThrow(
      /does not support SIE over API/,
    )
  })

  describe('briox', () => {
    const yearRoutes = {
      match: '/financialyear',
      respond: () =>
        jsonResponse({
          data: {
            financialyears: [
              { id: '8', fromdate: '2023-01-01', todate: '2023-12-31' },
              { id: '9', fromdate: '2024-01-01', todate: '2024-12-31' },
              { id: '10', fromdate: '2025-01-01', todate: '2025-12-31' },
            ],
          },
        }),
    }

    it('fetches one decoded SIE file per allowed fiscal year', async () => {
      routeFetch(fetchSpy, [
        yearRoutes,
        { match: '/sie/9/4', respond: () => octetResponse(cp437SieBytes('2024')) },
        { match: '/sie/10/4', respond: () => octetResponse(cp437SieBytes('2025')) },
      ])

      const result = await fetchProviderSieFiles('briox', 'token', undefined)

      // 2023 is outside ALLOWED_FISCAL_YEARS and must not be fetched
      expect(ALLOWED_FISCAL_YEARS.has(2023)).toBe(false)
      expect(result.availableYears).toEqual([2024, 2025])
      expect(result.files.map((f) => f.fiscalYear)).toEqual([2024, 2025])
      // CP437 bytes decoded into proper Swedish characters
      expect(result.files[0].rawContent).toContain('Företagskonto 2024')
      expect(result.files[1].rawContent).toContain('Företagskonto 2025')
      expect(fetchSpy.mock.calls.map((c: unknown[]) => String(c[0]))).not.toContainEqual(
        expect.stringContaining('/sie/8/4'),
      )
    })

    it('latestOnly fetches just the most recent year but reports all years', async () => {
      routeFetch(fetchSpy, [
        yearRoutes,
        { match: '/sie/10/4', respond: () => octetResponse(cp437SieBytes('2025')) },
      ])

      const result = await fetchProviderSieFiles('briox', 'token', undefined, { latestOnly: true })

      expect(result.files).toHaveLength(1)
      expect(result.files[0].fiscalYear).toBe(2025)
      expect(result.availableYears).toEqual([2024, 2025])
      const sieCalls = fetchSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes('/sie/'))
      expect(sieCalls).toHaveLength(1)
    })

    it('skips a year whose export fails and keeps the rest', async () => {
      routeFetch(fetchSpy, [
        yearRoutes,
        // 404 is non-retryable, so the bad year fails fast and gets skipped
        { match: '/sie/9/4', respond: () => new Response('gone', { status: 404 }) },
        { match: '/sie/10/4', respond: () => octetResponse(cp437SieBytes('2025')) },
      ])

      const result = await fetchProviderSieFiles('briox', 'token', undefined)

      expect(result.files.map((f) => f.fiscalYear)).toEqual([2025])
      expect(result.availableYears).toEqual([2024, 2025])
    })
  })

  describe('fortnox', () => {
    it('fetches text SIE via /sie/4?financialyear={id}', async () => {
      routeFetch(fetchSpy, [
        {
          match: '/financialyears',
          respond: () =>
            jsonResponse({
              FinancialYears: [
                { Id: 5, FromDate: '2024-01-01', ToDate: '2024-12-31' },
                { Id: 6, FromDate: '2025-01-01', ToDate: '2025-12-31' },
              ],
            }),
        },
        {
          match: '/sie/4?financialyear=',
          respond: () => new Response('#FLAGGA 0\n#KONTO 1930 "Företagskonto"\n', { status: 200 }),
        },
      ])

      const result = await fetchProviderSieFiles('fortnox', 'token', undefined)

      expect(result.availableYears).toEqual([2024, 2025])
      expect(result.files).toHaveLength(2)
      expect(result.files[0].rawContent).toContain('#KONTO 1930')
      const sieUrls = fetchSpy.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .filter((u: string) => u.includes('/sie/4'))
      expect(sieUrls[0]).toContain('financialyear=5')
      expect(sieUrls[1]).toContain('financialyear=6')
    })
  })

  describe('bjornlunden', () => {
    it('requires the company User-Key (providerCompanyId)', async () => {
      await expect(fetchProviderSieFiles('bjornlunden', 't', undefined)).rejects.toThrow(/User-Key/)
    })

    it('fetches date-ranged exports with the User-Key header', async () => {
      routeFetch(fetchSpy, [
        {
          match: '/sie/export/2025-01-01/2025-12-31',
          respond: () => octetResponse(cp437SieBytes('2025')),
        },
        {
          match: '/financialyear',
          respond: () =>
            jsonResponse([
              { entityId: 1, id: '202501', fromDate: '2025-01-01', toDate: '2025-12-31', open: true },
            ]),
        },
      ])

      const result = await fetchProviderSieFiles('bjornlunden', 'token', 'user-key-guid')

      expect(result.files).toHaveLength(1)
      expect(result.files[0].fiscalYear).toBe(2025)
      expect(result.files[0].rawContent).toContain('Företagskonto 2025')

      const exportCall = fetchSpy.mock.calls.find((c: unknown[]) => String(c[0]).includes('/sie/export/'))
      expect(exportCall).toBeDefined()
      expect((exportCall![1] as RequestInit).headers).toMatchObject({
        'User-Key': 'user-key-guid',
        Authorization: 'Bearer token',
      })
    })

    it('also decodes the swagger-declared base64 body shape', async () => {
      // BL's swagger declares the export as a base64 string; the live API
      // sends raw bytes. Guard the contingency path: a JSON-quoted base64
      // payload of CP437 SIE bytes must decode to the same content.
      const sieBytes = cp437SieBytes('2025')
      const base64 = Buffer.from(sieBytes).toString('base64')
      routeFetch(fetchSpy, [
        {
          match: '/sie/export/2025-01-01/2025-12-31',
          respond: () =>
            new Response(JSON.stringify(base64), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
        },
        {
          match: '/financialyear',
          respond: () =>
            jsonResponse([
              { entityId: 1, id: '202501', fromDate: '2025-01-01', toDate: '2025-12-31', open: true },
            ]),
        },
      ])

      const result = await fetchProviderSieFiles('bjornlunden', 'token', 'user-key-guid')

      expect(result.files).toHaveLength(1)
      expect(result.files[0].rawContent).toContain('Företagskonto 2025')
    })
  })
})
