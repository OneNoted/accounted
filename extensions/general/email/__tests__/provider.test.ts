import { afterEach, describe, expect, it } from 'vitest'
import { CloudflareEmailService } from '@/extensions/general/email/lib/cloudflare-service'
import { createEmailServiceFromEnv } from '@/extensions/general/email/lib/provider'
import { ResendEmailService } from '@/extensions/general/email/lib/resend-service'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('createEmailServiceFromEnv', () => {
  it('prefers Cloudflare when its complete configuration is present', () => {
    process.env.CLOUDFLARE_EMAIL_ACCOUNT_ID = 'account-123'
    process.env.CLOUDFLARE_EMAIL_API_TOKEN = 'token-secret'
    process.env.CLOUDFLARE_EMAIL_FROM = 'accounted@auth.notes.supply'
    process.env.RESEND_API_KEY = 'resend-secret'
    process.env.RESEND_FROM_EMAIL = 'resend@example.com'

    expect(createEmailServiceFromEnv()).toBeInstanceOf(CloudflareEmailService)
  })

  it('keeps Resend as the fallback when any Cloudflare setting is missing', () => {
    const cloudflareVariables = [
      'CLOUDFLARE_EMAIL_ACCOUNT_ID',
      'CLOUDFLARE_EMAIL_API_TOKEN',
      'CLOUDFLARE_EMAIL_FROM',
    ] as const

    for (const missing of cloudflareVariables) {
      process.env.CLOUDFLARE_EMAIL_ACCOUNT_ID = 'account-123'
      process.env.CLOUDFLARE_EMAIL_API_TOKEN = 'token-secret'
      process.env.CLOUDFLARE_EMAIL_FROM = 'accounted@auth.notes.supply'
      process.env.RESEND_API_KEY = 'resend-secret'
      process.env.RESEND_FROM_EMAIL = 'hosted@example.com'
      delete process.env[missing]

      expect(createEmailServiceFromEnv()).toBeInstanceOf(ResendEmailService)
    }
  })
})
