/**
 * Swish QR payload builder.
 *
 * Format follows the Swish "Skapa QR-kod" Type C specification (company /
 * sole-trader payments). The string is encoded as a QR code on the
 * customer-facing invoice so the customer can pay without re-typing the
 * recipient number, amount, or reference.
 *
 * Payload layout (semicolon-separated, exactly four fields):
 *   C{swishNumber};{amount};{message};{editableMask}
 *
 * Where:
 *   - C prefix marks a Type C code (payment with message + editable mask).
 *   - swishNumber is the recipient's Swish-handelsnummer, digits only.
 *   - amount is decimal SEK with dot separator (e.g. 1234.50).
 *   - message is the free-text payment reference (we use the invoice number).
 *   - editableMask is a bitwise field controlling which values the customer
 *     can edit in the Swish app before confirming:
 *       0b001 = 1  → phone/payee editable
 *       0b010 = 2  → amount editable
 *       0b100 = 4  → message editable
 *     Combine via OR. `0` locks every field (the right default for an invoice
 *     QR — we know the exact amount and we don't want the customer to type a
 *     different recipient number).
 *
 * Reference: documented at https://developer.swish.nu and corroborated by the
 * lindskogen/swish-qr-format and gillstrom/swish-qr reference implementations
 * (the npm Swish payment ecosystem). The earlier shape we shipped here added a
 * 5th `;{reference}` field that is NOT part of the spec — strict Swish QR
 * decoders rejected it. The reference is now encoded inside `message` (Swish's
 * own model: a single 50-char text used both as customer-visible message and
 * as the merchant-side payment reference).
 *
 * Constraints we enforce in code:
 *   - swishNumber digits only (strip whitespace, hyphens, +)
 *   - amount rounded to 2 decimals with dot separator
 *   - message truncated to 50 chars (Swish max for `message` field)
 *   - message stripped of semicolons (delimiter) and control characters
 */

import * as QRCode from 'qrcode'

export interface SwishQrInput {
  swishNumber: string
  amount: number
  message: string
  /**
   * Bitwise editable mask. `0` locks every field (default — the correct value
   * for an invoice QR with a known amount). Set to `2` to let the customer
   * adjust the amount (e.g. partial payment); rarely useful in this codebase.
   */
  editable?: number
  /**
   * Legacy alias for `message`. Kept for backward compatibility with callers
   * passing both — when supplied and `message` is not, used as the message.
   * The previous implementation encoded a separate 5th field for this, which
   * was off-spec; modern callers should pass everything through `message`.
   */
  reference?: string
}

function normalizeSwishNumber(raw: string): string {
  return raw.replace(/[^0-9]/g, '')
}

function normalizeMessage(raw: string): string {
  // Swish allows letters/digits/spaces/most punctuation but no embedded
  // semicolons (delimiter) — strip them outright. 50 char cap per spec.
  return raw.replace(/;/g, '').slice(0, 50)
}

function formatAmount(amount: number): string {
  // Two decimals, dot separator — Swish parses en_US-style numbers.
  return (Math.round(amount * 100) / 100).toFixed(2)
}

/**
 * Returns a Swish QR Type C payload string ready to be encoded into a QR
 * image. Returns null when the swish number is empty/invalid or the amount is
 * non-positive — caller should hide the QR section in that case.
 */
export function buildSwishQrPayload(input: SwishQrInput): string | null {
  const swish = normalizeSwishNumber(input.swishNumber)
  if (!swish) return null
  if (input.amount <= 0 || !Number.isFinite(input.amount)) return null

  const amount = formatAmount(input.amount)
  // Prefer `message`; fall back to legacy `reference` if only the latter was
  // supplied. The 5th-field reference shipped in the previous version is
  // intentionally dropped — it was not in the Swish spec.
  const rawMessage = input.message || input.reference || ''
  const message = normalizeMessage(rawMessage)
  // Default editable mask = 0 (everything locked). Clamp to the documented
  // 3-bit range so a stray large integer can't desync the QR length.
  const editable = Math.max(0, Math.min(7, Math.floor(input.editable ?? 0)))

  return `C${swish};${amount};${message};${editable}`
}

/**
 * Builds the Swish payload AND renders it to a base64 PNG data URL suitable
 * for embedding directly into a `@react-pdf/renderer` `<Image src>` prop.
 *
 * Returns null when the payload is invalid (delegates the validation rules
 * documented above). Callers should branch on null to hide the QR block.
 *
 * Render parameters:
 *   - margin 1 module (compact — saves space next to the bank line)
 *   - scale 6 (≈ 162×162 px PNG at the source; rendered at 80×80pt by the
 *     PDF template — enough resolution to keep edges crisp under print)
 *   - error correction M (matches the Swish merchant guide; balances
 *     scannability against capacity for a ~30-char payload)
 */
export async function buildSwishQrDataUrl(input: SwishQrInput): Promise<string | null> {
  const payload = buildSwishQrPayload(input)
  if (!payload) return null
  try {
    return await QRCode.toDataURL(payload, {
      margin: 1,
      scale: 6,
      errorCorrectionLevel: 'M',
    })
  } catch {
    // Don't break invoice rendering if QR encoding fails — just omit the QR.
    return null
  }
}
