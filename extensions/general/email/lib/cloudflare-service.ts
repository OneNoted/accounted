import { getBranding } from '@/lib/branding/service'
import type { EmailService, SendEmailOptions, SendEmailResult } from '@/lib/email/service'

interface CloudflareSendResponse {
  success?: boolean
  errors?: Array<{ code?: number; message?: string }>
  result?: {
    delivered?: string[]
    permanent_bounces?: string[]
    queued?: string[]
    message_id?: string
  } | null
}

function addresses(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value]
}

function sanitizeHeaderPart(value: string): string {
  return value.replace(/[\r\n<>]/g, '').trim()
}

export class CloudflareEmailService implements EmailService {
  isConfigured(): boolean {
    return Boolean(
      process.env.CLOUDFLARE_EMAIL_ACCOUNT_ID &&
        process.env.CLOUDFLARE_EMAIL_API_TOKEN &&
        process.env.CLOUDFLARE_EMAIL_FROM,
    )
  }

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    const accountId = process.env.CLOUDFLARE_EMAIL_ACCOUNT_ID
    const apiToken = process.env.CLOUDFLARE_EMAIL_API_TOKEN
    const fromEmail = process.env.CLOUDFLARE_EMAIL_FROM

    if (!accountId || !apiToken || !fromEmail) {
      return { success: false, provider: 'cloudflare', error: 'Email service is not configured' }
    }

    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: {
              address: fromEmail,
              name: options.fromName
                ? `${sanitizeHeaderPart(options.fromName)} via ${sanitizeHeaderPart(getBranding().appName)}`
                : sanitizeHeaderPart(getBranding().appName),
            },
            to: addresses(options.to),
            cc: options.cc ? addresses(options.cc) : undefined,
            bcc: options.bcc ? addresses(options.bcc) : undefined,
            reply_to: options.replyTo,
            subject: options.subject,
            html: options.html,
            text: options.text,
            attachments: options.attachments?.map((attachment) => ({
              filename: attachment.filename,
              content:
                typeof attachment.content === 'string'
                  ? attachment.content
                  : Buffer.from(attachment.content).toString('base64'),
              type: attachment.contentType ?? 'application/octet-stream',
              disposition: 'attachment',
            })),
          }),
        },
      )
      const payload = (await response.json()) as CloudflareSendResponse
      const accepted = [
        ...(payload.result?.delivered ?? []),
        ...(payload.result?.queued ?? []),
      ]
      const bounced = payload.result?.permanent_bounces ?? []
      const messageId = payload.result?.message_id

      if (
        !response.ok ||
        !payload.success ||
        bounced.length > 0 ||
        (!messageId && accepted.length === 0)
      ) {
        const providerError = payload.errors
          ?.map((item) => item.message)
          .filter(Boolean)
          .join('; ')
        const bounceError = bounced.length > 0 ? `Permanent bounce: ${bounced.join(', ')}` : ''
        return {
          success: false,
          provider: 'cloudflare',
          error:
            bounceError || providerError || 'Cloudflare Email Service rejected the message',
        }
      }

      return {
        success: true,
        provider: 'cloudflare',
        messageId,
      }
    } catch (error) {
      return {
        success: false,
        provider: 'cloudflare',
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
}
