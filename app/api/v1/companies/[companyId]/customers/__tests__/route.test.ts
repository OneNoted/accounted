/**
 * Integration tests for GET /api/v1/companies/:companyId/customers and
 * /api/v1/companies/:companyId/customers/:id.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'test-anon-key'
})

vi.mock('@/lib/auth/api-keys', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/api-keys')>('@/lib/auth/api-keys')
  return {
    ...actual,
    validateApiKey: vi.fn(),
    createServiceClientNoCookies: vi.fn(),
  }
})

vi.mock('@supabase/supabase-js', async () => {
  const actual = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js')
  return { ...actual, createClient: vi.fn().mockReturnValue({}) }
})

import { validateApiKey, createServiceClientNoCookies } from '@/lib/auth/api-keys'
import { GET as listCustomers } from '../route'
import { GET as getCustomer } from '../[id]/route'

const mockValidate = validateApiKey as ReturnType<typeof vi.fn>
const mockServiceClient = createServiceClientNoCookies as ReturnType<typeof vi.fn>

function makeFlexibleSupabase(byTable: Record<string, { data?: unknown; error?: unknown }>) {
  const buildChain = (table: string): unknown => {
    const handler: ProxyHandler<object> = {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) =>
            resolve(byTable[table] ?? { data: null, error: null })
        }
        return (..._args: unknown[]) => buildChain(table)
      },
    }
    return new Proxy({}, handler)
  }
  return { from: vi.fn((table: string) => buildChain(table)) }
}

const COMPANY_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const CUSTOMER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const USER_ID = 'user-1'

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(url, {
    ...init,
    headers: { Authorization: 'Bearer gnubok_sk_x', ...(init?.headers ?? {}) },
  })
}

function companyParams(companyId: string) {
  return { params: Promise.resolve({ companyId }) }
}

function detailParams(companyId: string, id: string) {
  return { params: Promise.resolve({ companyId, id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockValidate.mockResolvedValue({
    userId: USER_ID,
    companyId: COMPANY_ID,
    apiKeyId: 'ak_1',
    apiKeyName: 'CI key',
    scopes: ['customers:read'],
    mode: 'live',
  })
})

const SAMPLE_CUSTOMER = {
  id: CUSTOMER_ID,
  name: 'Acme AB',
  customer_type: 'business',
  email: 'a@acme.test',
  phone: null,
  address_line1: null,
  address_line2: null,
  postal_code: null,
  city: null,
  country: 'Sweden',
  org_number: '556677-8899',
  vat_number: 'SE556677889901',
  vat_number_validated: true,
  vat_number_validated_at: '2025-04-12T09:00:00Z',
  default_payment_terms: 30,
  notes: null,
  archived_at: null,
  created_at: '2025-04-12T08:30:00Z',
  updated_at: '2026-04-30T11:22:09Z',
}

describe('GET /api/v1/companies/:companyId/customers', () => {
  it('returns a paginated customer list, excluding archived rows by default', async () => {
    mockServiceClient.mockReturnValue(
      makeFlexibleSupabase({
        company_members: { data: { company_id: COMPANY_ID, role: 'owner' }, error: null },
        customers: { data: [SAMPLE_CUSTOMER], error: null },
      }),
    )

    const res = await listCustomers(
      makeRequest(`https://x.test/api/v1/companies/${COMPANY_ID}/customers`),
      companyParams(COMPANY_ID),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].name).toBe('Acme AB')
    expect(body.data[0].org_number).toBe('556677-8899')
  })

  it('accepts include_archived=true', async () => {
    const archived = { ...SAMPLE_CUSTOMER, archived_at: '2026-01-01T00:00:00Z' }
    mockServiceClient.mockReturnValue(
      makeFlexibleSupabase({
        company_members: { data: { company_id: COMPANY_ID, role: 'owner' }, error: null },
        customers: { data: [SAMPLE_CUSTOMER, archived], error: null },
      }),
    )

    const res = await listCustomers(
      makeRequest(`https://x.test/api/v1/companies/${COMPANY_ID}/customers?include_archived=true`),
      companyParams(COMPANY_ID),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toHaveLength(2)
  })

  it('rejects an invalid customer_type filter', async () => {
    mockServiceClient.mockReturnValue(
      makeFlexibleSupabase({
        company_members: { data: { company_id: COMPANY_ID, role: 'owner' }, error: null },
      }),
    )

    const res = await listCustomers(
      makeRequest(`https://x.test/api/v1/companies/${COMPANY_ID}/customers?customer_type=alien`),
      companyParams(COMPANY_ID),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('emits a next_cursor when the page is full', async () => {
    mockServiceClient.mockReturnValue(
      makeFlexibleSupabase({
        company_members: { data: { company_id: COMPANY_ID, role: 'owner' }, error: null },
        customers: {
          data: [
            SAMPLE_CUSTOMER,
            { ...SAMPLE_CUSTOMER, id: 'dddddddd-dddd-dddd-dddd-dddddddddddd' },
          ],
          error: null,
        },
      }),
    )

    const res = await listCustomers(
      makeRequest(`https://x.test/api/v1/companies/${COMPANY_ID}/customers?limit=1`),
      companyParams(COMPANY_ID),
    )

    const body = await res.json()
    expect(body.data).toHaveLength(1)
    expect(body.meta.next_cursor).toBeTruthy()
  })
})

describe('GET /api/v1/companies/:companyId/customers/:id', () => {
  it('returns the customer record', async () => {
    mockServiceClient.mockReturnValue(
      makeFlexibleSupabase({
        company_members: { data: { company_id: COMPANY_ID, role: 'owner' }, error: null },
        customers: { data: SAMPLE_CUSTOMER, error: null },
      }),
    )

    const res = await getCustomer(
      makeRequest(`https://x.test/api/v1/companies/${COMPANY_ID}/customers/${CUSTOMER_ID}`),
      detailParams(COMPANY_ID, CUSTOMER_ID),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.id).toBe(CUSTOMER_ID)
    expect(body.data.name).toBe('Acme AB')
    // Default response MUST NOT include the invoices expansion.
    expect(body.data.invoices).toBeUndefined()
  })

  it('embeds open invoices when ?expand=invoices is requested', async () => {
    const openInvoice = {
      id: 'inv-open-1',
      invoice_number: '2026-0001',
      invoice_date: '2026-04-01',
      due_date: '2026-04-30',
      status: 'sent',
      currency: 'SEK',
      total: 5000,
      remaining_amount: 5000,
    }
    mockServiceClient.mockReturnValue(
      makeFlexibleSupabase({
        company_members: { data: { company_id: COMPANY_ID, role: 'owner' }, error: null },
        customers: { data: SAMPLE_CUSTOMER, error: null },
        invoices: { data: [openInvoice], error: null },
      }),
    )

    const res = await getCustomer(
      makeRequest(
        `https://x.test/api/v1/companies/${COMPANY_ID}/customers/${CUSTOMER_ID}?expand=invoices`,
      ),
      detailParams(COMPANY_ID, CUSTOMER_ID),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.invoices).toHaveLength(1)
    expect(body.data.invoices[0].id).toBe('inv-open-1')
  })

  it('returns 404 when the customer does not exist for the company', async () => {
    mockServiceClient.mockReturnValue(
      makeFlexibleSupabase({
        company_members: { data: { company_id: COMPANY_ID, role: 'owner' }, error: null },
        customers: { data: null, error: null },
      }),
    )

    const res = await getCustomer(
      makeRequest(`https://x.test/api/v1/companies/${COMPANY_ID}/customers/${CUSTOMER_ID}`),
      detailParams(COMPANY_ID, CUSTOMER_ID),
    )

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('NOT_FOUND')
  })
})
