/**
 * Skatteverket API types for Momsdeklaration 1.0
 *
 * Field names match Skatteverket's JSON schema exactly.
 * Reference: Tjänstebeskrivning Momsdeklaration v1.5
 */

/** Momsuppgift payload — maps 1:1 to SKV 4700 boxes */
export interface SkatteverketMomsuppgift {
  momspliktigForsaljning?: number       // Box 05
  momspliktigaUttag?: number            // Box 06
  vinstmarginal?: number                // Box 07
  hyresInkomst?: number                 // Box 08
  momsForsaljningUtgaendeHog?: number   // Box 10
  momsForsaljningUtgaendeMedel?: number // Box 11
  momsForsaljningUtgaendeLag?: number   // Box 12
  inkopVarorEU?: number                 // Box 20
  inkopTjansterEU?: number              // Box 21
  inkopTjansterUtanforEU?: number       // Box 22
  inkopVarorSE?: number                 // Box 23
  inkopTjansterSE?: number              // Box 24
  momsInkopUtgaendeHog?: number         // Box 30
  momsInkopUtgaendeMedel?: number       // Box 31
  momsInkopUtgaendeLag?: number         // Box 32
  forsaljningVarorEU?: number           // Box 35
  forsaljningVarorUtanforEU?: number    // Box 36
  inkopVaror3pHandel?: number           // Box 37
  forsaljningVaror3pHandel?: number     // Box 38
  forsaljningTjansterEU?: number        // Box 39
  ovrigForsaljningTjansterUtanforSE?: number // Box 40
  forsaljningBskKopareSE?: number       // Box 41
  momsfriForsaljning?: number           // Box 42
  ingaendeMomsAvdrag?: number           // Box 48
  summaMoms?: number                    // Box 49
  import?: number                       // Box 50
  momsImportUtgaendeHog?: number        // Box 60
  momsImportUtgaendeMedel?: number      // Box 61
  momsImportUtgaendeLag?: number        // Box 62
}

/**
 * Validation result from Skatteverket /kontrollera or /utkast.
 * Field names match Momsdeklaration v1.0.24 RAML — note SKV's mixed casing
 * on `kontrollResultat` and `signeringsLank`.
 */
export interface SkatteverketKontrollResultat {
  status?: 'OK' | 'WARNING' | 'ERROR'
  resultat?: SkatteverketKontroll[]
}

export interface SkatteverketKontroll {
  kod: string             // e.g. "49"
  status: 'ERROR' | 'WARNING'
  beskrivning: string
}

/** Response from saving a draft */
export interface SkatteverketUtkastResponse {
  kontrollResultat?: SkatteverketKontrollResultat
  signeringsLank?: string
  locked?: boolean
}

/** Response from fetching submitted declarations */
export interface SkatteverketInlamnatResponse {
  kvittensnummer?: string
  tidpunkt?: string    // ISO 8601 timestamp
  signerare?: string   // Personnummer of signer
}

/** Response from fetching decisions */
export interface SkatteverketBeslutatResponse {
  beslutsdatum?: string
  momsBeslut?: SkatteverketMomsuppgift
}

/** Stored token pair (decrypted form) */
export interface SkatteverketTokens {
  access_token: string
  refresh_token: string | null
  expires_at: number     // Unix timestamp ms
  refresh_count: number
  scope: string
}

/** Declaration submission status tracking */
export type DeclarationStatus =
  | 'draft_saved'
  | 'draft_locked'
  | 'signed'
  | 'decided'

// ── AGI (Arbetsgivardeklaration) types ──────────────────────────

/**
 * AGI submission payload — sent to Skatteverket inlämning API.
 *
 * JSON property names follow the same camelCase convention as the
 * Momsdeklaration API. Derived from Skatteverket's XML element names
 * and FK field codes. Verify against the RAML spec on Utvecklarportalen.
 */
export interface SkatteverketAGIInlamning {
  rattelse: boolean
  huvuduppgift: SkatteverketHuvuduppgift
  individuppgifter: SkatteverketIndividuppgift[]
}

/** Employer-level totals (Huvuduppgift) */
export interface SkatteverketHuvuduppgift {
  /** Ruta 001: Total avdragen skatt */
  avdragenSkatt?: number
  /** Ruta 020: Total underlag arbetsgivaravgifter */
  summaArbetsgivaravgifterUnderlag?: number
  /** Ruta 060: Avgifter — standard rate (31.42%) */
  avgifterUnderlagStandard?: number
  /** Ruta 061: Avgifter — ålderspension only (10.21%, 67+ from 2026) */
  avgifterUnderlagAlderspension?: number
  /** Ruta 062: Avgifter — youth rate (20.81%, ages 19-23, Apr 2026–Sep 2027) */
  avgifterUnderlagUngdom?: number
}

/** Per-employee data (Individuppgift) */
export interface SkatteverketIndividuppgift {
  /** FK215: Personnummer/samordningsnummer (12 digits, plaintext) */
  personnummer: string
  /** FK570: Specifikationsnummer — MUST stay consistent per employee */
  specifikationsnummer: number
  /** Ruta 011: Kontant bruttolön */
  kontantBruttoloen?: number
  /** Ruta 001: Avdragen skatt */
  avdragenSkatt?: number
  /** Ruta 012: Förmån bil */
  formanBil?: number
  /** Ruta 013: Förmån drivmedel */
  formanDrivmedel?: number
  /** Ruta 014: Förmån bostad */
  formanBostad?: number
  /** Ruta 015: Förmån kost */
  formanKost?: number
  /** Ruta 019: Förmån övrigt */
  formanOvrigt?: number
  /** Ruta 020: Underlag arbetsgivaravgifter */
  underlagArbetsgivaravgifter?: number
  /** Ruta 131: Ersättning till F-skatt holder */
  ersattningFSkatt?: number
  /** FK821: Sjukfrånvaro dagar */
  sjukfranvaroDagar?: number
  /** FK822: VAB dagar */
  vabDagar?: number
  /** FK823: Föräldraledighet dagar */
  foraldraledigDagar?: number
}

/** AGI validation result from Skatteverket /kontrollera */
export interface SkatteverketAGIKontrollresultat {
  kontroller?: SkatteverketKontroll[]
}

export interface SkatteverketSubmission {
  id: string
  user_id: string
  redovisare: string         // 12-digit org/personnummer
  redovisningsperiod: string // YYYYMM
  status: DeclarationStatus
  kvittensnummer: string | null
  signeringslank: string | null
  kontrollresultat: SkatteverketKontrollResultat | null
  momsuppgift: SkatteverketMomsuppgift
  created_at: string
  updated_at: string
}
