import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ticApiFetch, searchCompanyByOrgNumber, getBankAccounts, getIndustryCodes } from '../lib/tic-client'
import { TICAPIError } from '../lib/tic-types'

const PROXY_URL = 'https://proxy.example.com/api/tic/proxy'

describe('tic-client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.stubEnv('TIC_API_PROXY_URL', PROXY_URL)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  describe('ticApiFetch', () => {
    it('constructs correct proxy URL with encoded endpoint', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ data: 'test' }), { status: 200 }))

      await ticApiFetch('/search-public/companies?q=5560360793&query_by=registrationNumber')

      expect(mockFetch).toHaveBeenCalledWith(
        `${PROXY_URL}?endpoint=${encodeURIComponent('/search-public/companies?q=5560360793&query_by=registrationNumber')}`,
        expect.objectContaining({
          headers: { Accept: 'application/json' },
        })
      )
    })

    it('returns null on 404', async () => {
      vi.mocked(fetch).mockResolvedValue(new Response('Not found', { status: 404 }))

      const result = await ticApiFetch('/test')
      expect(result).toBeNull()
    })

    it('throws TICAPIError on 429', async () => {
      vi.mocked(fetch).mockResolvedValue(new Response('Too many requests', { status: 429 }))

      await expect(ticApiFetch('/test')).rejects.toThrow(TICAPIError)
      await expect(ticApiFetch('/test')).rejects.toMatchObject({
        statusCode: 429,
        code: 'RATE_LIMIT_EXCEEDED',
      })
    })

    it('throws TICAPIError on 500', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' })
      )

      await expect(ticApiFetch('/test')).rejects.toThrow(TICAPIError)
    })

    it('throws NOT_CONFIGURED when TIC_API_PROXY_URL is missing', async () => {
      vi.stubEnv('TIC_API_PROXY_URL', '')

      await expect(ticApiFetch('/test')).rejects.toMatchObject({
        code: 'NOT_CONFIGURED',
      })
    })

    it('wraps fetch errors in TICAPIError', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('network failure'))

      await expect(ticApiFetch('/test')).rejects.toThrow(TICAPIError)
      await expect(ticApiFetch('/test')).rejects.toThrow(/network failure/)
    })
  })

  describe('searchCompanyByOrgNumber', () => {
    it('returns company document on match', async () => {
      const doc = {
        companyId: 123,
        registrationNumber: '5560360793',
        names: [{ nameOrIdentifier: 'Test AB', companyNamingType: 'name' }],
        legalEntityType: 'AB',
        registrationDate: 0,
        isCeased: false,
      }
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({ found: 1, hits: [{ document: doc }], facet_counts: [] }))
      )

      const result = await searchCompanyByOrgNumber('556036-0793')
      expect(result).toEqual(doc)
    })

    it('hits the v2 /search-public/companies path', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ found: 0, hits: [] })))

      await searchCompanyByOrgNumber('556036-0793')

      const calledUrl = mockFetch.mock.calls[0][0] as string
      expect(calledUrl).toContain(encodeURIComponent('/search-public/companies'))
    })

    it('strips dashes and spaces from org number', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ found: 0, hits: [] })))

      await searchCompanyByOrgNumber('556036-0793')

      const calledUrl = mockFetch.mock.calls[0][0] as string
      expect(calledUrl).toContain('q%3D5560360793')
    })

    it('returns null when no hits', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({ found: 0, hits: [], facet_counts: [] }))
      )

      const result = await searchCompanyByOrgNumber('000000-0000')
      expect(result).toBeNull()
    })
  })

  describe('getBankAccounts', () => {
    it('fetches bankgiro numbers for company ID via /companies/{id}/bank-accounts', async () => {
      const mockFetch = vi.mocked(fetch)
      const accounts = [{ bankgironumber: 1234567, terminated: false, name: 'Test AB' }]
      mockFetch.mockResolvedValue(new Response(JSON.stringify(accounts)))

      const result = await getBankAccounts(123)
      expect(result).toEqual(accounts)
      const calledUrl = mockFetch.mock.calls[0][0] as string
      expect(calledUrl).toContain(encodeURIComponent('/companies/123/bank-accounts'))
    })
  })

  describe('getIndustryCodes', () => {
    it('fetches industry codes for company ID via /companies/{id}/industries', async () => {
      const mockFetch = vi.mocked(fetch)
      const codes = [
        { companyIndustryCodeType: 'sni2007', industryCode: '62010', description: 'Dataprogrammering' },
      ]
      mockFetch.mockResolvedValue(new Response(JSON.stringify(codes)))

      const result = await getIndustryCodes(123)
      expect(result).toEqual(codes)
      const calledUrl = mockFetch.mock.calls[0][0] as string
      expect(calledUrl).toContain(encodeURIComponent('/companies/123/industries'))
    })
  })
})
