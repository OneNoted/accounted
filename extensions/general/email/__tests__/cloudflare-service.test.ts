import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/branding/service', () => ({
  getBranding: () => ({ appName: 'Accounted' }),
}))

import { CloudflareEmailService } from '@/extensions/general/email/lib/cloudflare-service'

const ORIGINAL_ENV = { ...process.env }

describe('CloudflareEmailService', () => {
  beforeEach(() => {
    process.env.CLOUDFLARE_EMAIL_ACCOUNT_ID = 'account-123'
    process.env.CLOUDFLARE_EMAIL_API_TOKEN = 'token-secret'
    process.env.CLOUDFLARE_EMAIL_FROM = 'accounted@auth.notes.supply'
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('sends through the Cloudflare Email Service REST API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        errors: [],
        messages: [],
        result: {
          delivered: ['joyeuse@agents.notes.supply'],
          permanent_bounces: [],
          queued: [],
          message_id: '<message-123@auth.notes.supply>',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await new CloudflareEmailService().sendEmail({
      to: 'joyeuse@agents.notes.supply',
      subject: 'You have been invited',
      html: '<p>Welcome</p>',
      text: 'Welcome',
    })

    expect(result).toEqual({
      success: true,
      provider: 'cloudflare',
      messageId: '<message-123@auth.notes.supply>',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/account-123/email/sending/send',
    )
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer token-secret',
        'Content-Type': 'application/json',
      },
    })
    expect(JSON.parse(String(init.body))).toEqual({
      from: { address: 'accounted@auth.notes.supply', name: 'Accounted' },
      to: ['joyeuse@agents.notes.supply'],
      subject: 'You have been invited',
      html: '<p>Welcome</p>',
      text: 'Welcome',
    })
  })

  it('maps recipients, reply-to, sender name, and attachments', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        result: {
          delivered: ['customer@example.com', 'copy@example.com'],
          permanent_bounces: [],
          queued: [],
          message_id: '<invoice-123@auth.notes.supply>',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await new CloudflareEmailService().sendEmail({
      to: ['customer@example.com'],
      cc: 'copy@example.com',
      bcc: ['archive@example.com'],
      replyTo: 'billing@notes.supply',
      fromName: 'Notes Supply AB',
      subject: 'Invoice',
      html: '<p>Invoice attached</p>',
      attachments: [
        {
          filename: 'invoice.pdf',
          content: Buffer.from('pdf'),
          contentType: 'application/pdf',
        },
      ],
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      from: {
        address: 'accounted@auth.notes.supply',
        name: 'Notes Supply AB via Accounted',
      },
      to: ['customer@example.com'],
      cc: ['copy@example.com'],
      bcc: ['archive@example.com'],
      reply_to: 'billing@notes.supply',
      subject: 'Invoice',
      html: '<p>Invoice attached</p>',
      attachments: [
        {
          filename: 'invoice.pdf',
          content: 'cGRm',
          type: 'application/pdf',
          disposition: 'attachment',
        },
      ],
    })
  })

  it('accepts a successful response with a message ID when delivery arrays are empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          success: true,
          errors: [],
          result: {
            delivered: [],
            permanent_bounces: [],
            queued: [],
            message_id: '<accepted-123@auth.notes.supply>',
          },
        }),
      ),
    )

    await expect(
      new CloudflareEmailService().sendEmail({
        to: 'joyeuse@agents.notes.supply',
        subject: 'Invitation',
        html: '<p>Welcome</p>',
      }),
    ).resolves.toEqual({
      success: true,
      provider: 'cloudflare',
      messageId: '<accepted-123@auth.notes.supply>',
    })
  })

  it('accepts a queued-only Cloudflare response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          success: true,
          errors: [],
          result: {
            delivered: [],
            permanent_bounces: [],
            queued: ['joyeuse@agents.notes.supply'],
            message_id: '<queued-123@auth.notes.supply>',
          },
        }),
      ),
    )

    await expect(
      new CloudflareEmailService().sendEmail({
        to: 'joyeuse@agents.notes.supply',
        subject: 'Invitation',
        html: '<p>Welcome</p>',
      }),
    ).resolves.toEqual({
      success: true,
      provider: 'cloudflare',
      messageId: '<queued-123@auth.notes.supply>',
    })
  })

  it('returns provider API errors without exposing the token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            success: false,
            errors: [{ code: 9109, message: 'Invalid access token' }],
            result: null,
          },
          { status: 403 },
        ),
      ),
    )

    const result = await new CloudflareEmailService().sendEmail({
      to: 'joyeuse@agents.notes.supply',
      subject: 'Invitation',
      html: '<p>Welcome</p>',
    })

    expect(result).toEqual({
      success: false,
      provider: 'cloudflare',
      error: 'Invalid access token',
    })
    expect(JSON.stringify(result)).not.toContain('token-secret')
  })

  it('fails when one recipient permanently bounces and another is delivered', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        errors: [],
        result: {
          delivered: ['copy@example.com'],
          permanent_bounces: ['customer@example.com'],
          queued: [],
          message_id: '<partial-bounce-123@auth.notes.supply>',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await new CloudflareEmailService().sendEmail({
      to: 'customer@example.com',
      cc: 'copy@example.com',
      subject: 'Invoice',
      html: '<p>Invoice attached</p>',
    })

    expect(result).toEqual({
      success: false,
      provider: 'cloudflare',
      error: 'Permanent bounce: customer@example.com',
    })
    expect(JSON.stringify(result)).not.toContain('token-secret')
  })

  it('fails when every recipient permanently bounces', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        errors: [],
        result: {
          delivered: [],
          permanent_bounces: ['joyeuse@agents.notes.supply'],
          queued: [],
          message_id: '<bounce-123@auth.notes.supply>',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await new CloudflareEmailService().sendEmail({
      to: 'joyeuse@agents.notes.supply',
      subject: 'Invitation',
      html: '<p>Welcome</p>',
    })

    expect(result).toEqual({
      success: false,
      provider: 'cloudflare',
      error: 'Permanent bounce: joyeuse@agents.notes.supply',
    })
    expect(JSON.stringify(result)).not.toContain('token-secret')
  })
})
