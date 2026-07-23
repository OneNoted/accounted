export const MAX_INVOICE_EMAIL_RECIPIENTS = 20
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface ResolveInvoiceEmailRecipientsInput {
  to: string | readonly string[]
  configuredCc?: readonly string[] | null
  configuredBcc?: readonly string[] | null
  legacyCc?: string | null
  additionalCc?: readonly string[]
  additionalBcc?: readonly string[]
}

export interface ResolvedInvoiceEmailRecipients {
  to: string[]
  cc: string[]
  bcc: string[]
}

function normalizedKey(address: string): string {
  return address.trim().toLocaleLowerCase('en-US')
}

function uniqueAddresses(
  addresses: readonly string[],
  used: Set<string>,
): string[] {
  const result: string[] = []

  for (const rawAddress of addresses) {
    const address = rawAddress.trim()
    const key = normalizedKey(address)
    if (!key || used.has(key)) continue
    used.add(key)
    result.push(address)
  }

  return result
}

/**
 * Build the exact recipient lists submitted to the email provider.
 *
 * A null company CC list means the company has never configured the new
 * setting, so the historical automatic-copy address remains in effect. An
 * explicit empty list disables that fallback. Recipients are de-duplicated
 * with To taking precedence over CC and CC taking precedence over BCC.
 */
export function resolveInvoiceEmailRecipients(
  input: ResolveInvoiceEmailRecipientsInput,
): ResolvedInvoiceEmailRecipients {
  const used = new Set<string>()
  const rawTo = typeof input.to === 'string' ? [input.to] : input.to
  const to = uniqueAddresses(rawTo, used)

  const fixedCc = input.configuredCc === null || input.configuredCc === undefined
    ? input.legacyCc
      ? [input.legacyCc]
      : []
    : input.configuredCc

  const cc = uniqueAddresses(
    [...fixedCc, ...(input.additionalCc ?? [])],
    used,
  )
  const bcc = uniqueAddresses(
    [...(input.configuredBcc ?? []), ...(input.additionalBcc ?? [])],
    used,
  )

  return { to, cc, bcc }
}

export function parseInvoiceRecipientText(value: string): string[] {
  const used = new Set<string>()
  return uniqueAddresses(value.split(/[\n,;]+/), used)
}
