/**
 * Charset repair for chart_of_accounts account names corrupted during the
 * 2026-03-30 → 2026-06-12 seeding/import window. Pure functions only (no DB) so
 * the logic is unit-testable; scripts/repair-chart-of-accounts-charset.ts wires
 * them to the live table.
 *
 * Three distinct corruption signatures, each with its own recovery strategy:
 *
 *  1. double_encoded — UTF-8 bytes were decoded as Windows-1252 and re-encoded
 *     as UTF-8: "FÃ¶retagskonto", "Ã–vriga bankkonton", "Ã…rets resultat".
 *     LOSSLESS to reverse (reverseMojibake): no canonical name required, so it
 *     recovers custom account names too.
 *  2. lost_byte — a CP437/Latin-1 SIE file was decoded as UTF-8; every diacritic
 *     byte became U+FFFD: "Ackumulerade nedskrivningar p� bilar". The byte is
 *     GONE — unrecoverable from the string. Restore from a known-good sibling
 *     name for the same account number, matching with U+FFFD as a 1-char
 *     wildcard.
 *  3. stripped — literals typed without diacritics: "Utgaende moms forsaljning
 *     inom Sverige, 25%". Diacritics gone; restore from a de-accent-equal
 *     sibling that actually carries the diacritics.
 *
 * The seed function's wording differs slightly from BAS_REFERENCE (seed:
 * "…försäljning inom Sverige, 25%" vs BAS: "…på försäljning inom Sverige, 25 %"),
 * so the caller supplies CANDIDATE correct names per account number — the clean
 * sibling rows already in the table, plus the BAS reference name as a fallback —
 * and we match per row. Anything ambiguous (≠1 sibling) is left untouched.
 */

export const REPLACEMENT_CHAR = '�'

/**
 * Windows-1252 code point → byte for the 0x80–0x9F block, where CP1252 diverges
 * from Latin-1 (e.g. 0x96 = U+2013 "–", 0x85 = U+2026 "…"). Reversing
 * double-encoding requires mapping these back to their original byte; the å/ä/ö
 * continuation bytes for UPPERCASE Å/Ä/Ö (0x85/0x84/0x96) land in this block.
 */
const CP1252_TO_BYTE: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
}

/** True if the name carries the U+FFFD lost-byte signature. */
export function hasLostByte(s: string): boolean {
  return s.includes(REPLACEMENT_CHAR)
}

/** True if the name carries the double-encoded signature (Â/Ã lead byte). */
export function hasMojibakeSignature(s: string): boolean {
  return /[ÂÃ]/.test(s)
}

/**
 * True if the name contains a Windows-1252 C1 "special" character used IN PLACE
 * OF A LETTER — i.e. a CP437/Latin-1 diacritic byte mis-decoded as CP1252
 * (CP437 ö 0x94 → "”", ä 0x84 → "„", Ö 0x99 → "™"). Swedish diacritics always
 * sit mid-word, so the tell is letter-adjacency: "F”rmedlad" (corrupt) vs
 * "Periodiseringsfond 2021 – nr 2" (a legitimate space-padded en-dash, NOT
 * corrupt). Such a name must never be a repair target for another row.
 */
export function hasCp1252Artifact(s: string): boolean {
  const chars = [...s]
  const isLetter = (c: string | undefined): boolean => !!c && /\p{L}/u.test(c)
  for (let i = 0; i < chars.length; i++) {
    if (!(chars[i].codePointAt(0)! in CP1252_TO_BYTE)) continue
    if (isLetter(chars[i - 1]) || isLetter(chars[i + 1])) return true
  }
  return false
}

/** A name with no corruption signature of any kind — safe to treat as canonical. */
export function isClean(s: string): boolean {
  return !hasLostByte(s) && !hasMojibakeSignature(s) && !hasCp1252Artifact(s)
}

/** Strip combining diacritical marks (å→a, ä→a, ö→o, é→e), preserving case. */
export function deaccent(s: string): string {
  // ̀-ͯ = the combining-diacritical-marks block left after NFD.
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Reverse a double-encoded (UTF-8-bytes-read-as-CP1252-then-re-UTF-8) string.
 * Returns the recovered string, or null when the input can't be a clean
 * double-encoding (a char outside CP1252, or bytes that aren't valid UTF-8) —
 * which also makes it a no-op on already-correct names.
 */
export function reverseMojibake(s: string): string | null {
  const bytes: number[] = []
  for (const ch of s) {
    const cp = ch.codePointAt(0)!
    if (cp <= 0xff) {
      bytes.push(cp)
    } else if (cp in CP1252_TO_BYTE) {
      bytes.push(CP1252_TO_BYTE[cp])
    } else {
      return null
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes))
  } catch {
    return null
  }
}

/**
 * CP437 high bytes (0x80–0xA5) that decode to Latin letters — the only bytes
 * that can legitimately appear inside a Swedish account name. A CP437 SIE file
 * decoded as CP1252 turns these into the C1 specials above (ö 0x94 → "”", Ö 0x99
 * → "™", ä 0x84 → "„", å 0x86 → "†"); reversing maps the char back to its byte,
 * then to the CP437 letter. Bytes outside this set (box-drawing, symbols) never
 * occur in account names, so we refuse to reverse them (return null).
 */
const CP437_LETTER: Record<number, string> = {
  0x80: 'Ç', 0x81: 'ü', 0x82: 'é', 0x83: 'â', 0x84: 'ä', 0x85: 'à', 0x86: 'å',
  0x87: 'ç', 0x88: 'ê', 0x89: 'ë', 0x8a: 'è', 0x8b: 'ï', 0x8c: 'î', 0x8d: 'ì',
  0x8e: 'Ä', 0x8f: 'Å', 0x90: 'É', 0x91: 'æ', 0x92: 'Æ', 0x93: 'ô', 0x94: 'ö',
  0x95: 'ò', 0x96: 'û', 0x97: 'ù', 0x98: 'ÿ', 0x99: 'Ö', 0x9a: 'Ü', 0xa0: 'á',
  0xa1: 'í', 0xa2: 'ó', 0xa3: 'ú', 0xa4: 'ñ', 0xa5: 'Ñ',
}

/**
 * Reverse a CP437-decoded-as-CP1252 name ("F”rmedlad" → "Förmedlad", "™vriga" →
 * "Övriga"). Each char is mapped back to the byte CP1252 would have produced,
 * then re-interpreted as CP437. Returns null when any high byte isn't a known
 * CP437 letter (so it's a no-op on clean names and refuses to guess on symbols).
 */
export function reverseCp437Mojibake(s: string): string | null {
  let out = ''
  let changed = false
  for (const ch of s) {
    const cp = ch.codePointAt(0)!
    const byte = cp <= 0xff ? cp : (cp in CP1252_TO_BYTE ? CP1252_TO_BYTE[cp] : -1)
    if (byte < 0) return null
    if (byte < 0x80) {
      out += ch
    } else if (byte in CP437_LETTER) {
      out += CP437_LETTER[byte]
      changed = true
    } else {
      return null
    }
  }
  return changed ? out : null
}

/** Build an anchored regex from a lost-byte name, each U+FFFD a single-char wildcard. */
function lostByteRegex(s: string): RegExp {
  const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('^' + escaped.split(REPLACEMENT_CHAR).join('.') + '$')
}

const uniq = (xs: string[]): string[] => [...new Set(xs)]

export interface RepairResult {
  corrected: string
  method: 'reverse' | 'reverse_cp437' | 'sibling_stripped' | 'sibling_lostbyte'
}

/**
 * Resolve the correct name for a (possibly) corrupted account name.
 *
 * `candidates` = known names for the SAME account number from elsewhere (clean
 * sibling rows + the BAS reference name). Corrupt candidates are ignored.
 *
 * Returns null when the name is already clean, or when no confident, unambiguous
 * correction exists — the caller leaves the row untouched and reports it.
 */
export function resolveCorrectName(
  corrupted: string,
  candidates: string[],
): RepairResult | null {
  // Only genuinely-clean names are eligible repair targets — never another
  // corrupted variant (e.g. a CP437-as-CP1252 "F”rmedlad frakt" must not be the
  // target for the lost-byte "F�rmedlad frakt").
  const clean = uniq(candidates.filter((c) => c && isClean(c)))

  // 1. Lost-byte — the byte is gone; match a sibling treating each U+FFFD as one
  //    wildcard char. Require exactly one distinct sibling so we never guess.
  if (hasLostByte(corrupted)) {
    const re = lostByteRegex(corrupted)
    const matches = uniq(clean.filter((c) => re.test(c)))
    return matches.length === 1
      ? { corrected: matches[0], method: 'sibling_lostbyte' }
      : null
  }

  // 2. Double-encoded (UTF-8-as-CP1252) — reverse losslessly; recovers customs.
  if (hasMojibakeSignature(corrupted)) {
    const rev = reverseMojibake(corrupted)
    if (rev && rev !== corrupted && isClean(rev)) {
      return { corrected: rev, method: 'reverse' }
    }
    return null
  }

  // 3. CP437-as-CP1252 (a SIE file's diacritic byte rendered as a C1 special) —
  //    also lossless. Only fires on a mid-word artifact (hasCp1252Artifact).
  if (hasCp1252Artifact(corrupted)) {
    const rev = reverseCp437Mojibake(corrupted)
    if (rev && rev !== corrupted && isClean(rev)) {
      return { corrected: rev, method: 'reverse_cp437' }
    }
    return null
  }

  // 4. Stripped diacritics — restore from a de-accent-equal sibling that carries
  //    the diacritics this row lost. DIRECTIONAL GUARD: only act when the input
  //    is itself fully de-accented (no diacritics), so a CORRECT name is never
  //    "fixed" down to a stripped sibling. Require a unique clean sibling.
  if (deaccent(corrupted) !== corrupted) return null
  const matches = uniq(clean.filter((c) => c !== corrupted && deaccent(c) === corrupted))
  return matches.length === 1
    ? { corrected: matches[0], method: 'sibling_stripped' }
    : null
}
