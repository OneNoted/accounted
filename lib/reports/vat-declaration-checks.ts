import type { VatDeclarationRutor } from '@/types'

/**
 * Local pre-flight checks for the momsdeklaration, run BEFORE the SKV
 * /kontrollera or /utkast calls.
 *
 * Why we need this: Skatteverket's "validering" only confirms that the
 * payload is internally arithmetically consistent — it does NOT confirm
 * that the declaration reflects reality. A declaration of all zeros
 * validates fine; one with output VAT but no underlying purchases
 * validates fine too, until the gateway-level FK004 rule fires.
 *
 * The checks below catch the patterns we have seen in practice where
 * "Validera" returned OK but the declaration was wrong:
 *
 * - Reverse charge: ruta 30-32 populated but ruta 20-24 empty. Caused by
 *   supplier invoices flagged as reverse charge that booked the fiktiv
 *   moms (2614/2624/2634) without the parallel basis lines on 44xx/45xx.
 *   Fixed at the data layer by generateReverseChargeBasisLines, but we
 *   keep the check here as a safety net for legacy verifikat and direct
 *   journal entries that bypass the supplier invoice flow.
 *
 * - Reverse charge: ruta 20-24 populated but ruta 30-32 empty. The mirror
 *   case — basis booked but fiktiv moms missing. Less common but equally
 *   broken.
 *
 * - Mismatch between output RC VAT (ruta 30-32) and offsetting input VAT
 *   in ruta 48. The 2614/2645 (or 2647) pair must net to zero in the
 *   buyer's input deduction. A mismatch indicates one half of the pair
 *   was booked without the other.
 *
 * Output is consumed by the UI; ERROR findings should block "Skicka",
 * WARNING findings should surface but allow the user to proceed if they
 * understand the reason.
 */

export type VatDeclarationCheckStatus = 'ERROR' | 'WARNING'

export interface VatDeclarationCheck {
  /** Stable identifier so the UI can render specific guidance per rule. */
  code:
    | 'RC_BASIS_MISSING'
    | 'RC_OUTPUT_MISSING'
    | 'RC_INPUT_VAT_MISMATCH'
    | 'SUMMA_MOMS_DRIFT'
  status: VatDeclarationCheckStatus
  /** Swedish user-facing message; safe to render directly in the UI. */
  message: string
  /** Optional rutor that the user should investigate. */
  rutor?: Array<keyof VatDeclarationRutor>
}

/**
 * Run all local checks against a calculated VatDeclarationRutor.
 *
 * Returns an empty array when the declaration looks consistent. Order
 * within the returned array is stable so the UI can rely on it for
 * snapshot tests.
 */
export function runVatDeclarationChecks(rutor: VatDeclarationRutor): VatDeclarationCheck[] {
  const findings: VatDeclarationCheck[] = []

  const rcOutput = rutor.ruta30 + rutor.ruta31 + rutor.ruta32
  const rcBasis =
    rutor.ruta20 + rutor.ruta21 + rutor.ruta22 + rutor.ruta23 + rutor.ruta24

  // Use a 0.5 SEK epsilon — values are rounded to öres in the calculator
  // and we don't want a 0.01 rounding scrap to trip a sanity check.
  const eps = 0.5

  // FK004 mirror: output RC VAT exists, basis missing.
  if (rcOutput > eps && rcBasis <= eps) {
    findings.push({
      code: 'RC_BASIS_MISSING',
      status: 'ERROR',
      message:
        'Du har redovisat utgående moms på inköp (ruta 30-32) men inget ' +
        'basbelopp för omvänd skattskyldighet (ruta 20-24). Skatteverket ' +
        'kräver att båda sidor finns med (ML 13 kap; SKV felkod FK004). ' +
        'Kontrollera att leverantörsfakturor med omvänd skattskyldighet ' +
        'är bokförda med basbelopp på 44xx/45xx-konton.',
      rutor: ['ruta20', 'ruta21', 'ruta22', 'ruta23', 'ruta24', 'ruta30', 'ruta31', 'ruta32'],
    })
  }

  // Mirror: basis present but no output VAT — equally broken, often a
  // half-finished manual posting.
  if (rcBasis > eps && rcOutput <= eps) {
    findings.push({
      code: 'RC_OUTPUT_MISSING',
      status: 'ERROR',
      message:
        'Du har redovisat basbelopp för omvänd skattskyldighet (ruta 20-24) ' +
        'men ingen utgående moms (ruta 30-32). Vid omvänd skattskyldighet ' +
        'måste köparen redovisa både underlag och fiktiv moms (ML 13 kap). ' +
        'Kontrollera att fiktiv moms är bokförd på 2614/2624/2634.',
      rutor: ['ruta20', 'ruta21', 'ruta22', 'ruta23', 'ruta24', 'ruta30', 'ruta31', 'ruta32'],
    })
  }

  // The fiktiv-moms-pair must net to zero in the buyer's input deduction.
  // We can't isolate the RC portion of ruta 48 without the breakdown, but
  // we can flag when ruta 48 is smaller than rcOutput — that means the
  // RC purchase didn't fully recover the calculated input VAT, which is
  // a strong signal that one half of the 2645/2614 pair is missing.
  if (rcOutput > eps && rutor.ruta48 + eps < rcOutput) {
    findings.push({
      code: 'RC_INPUT_VAT_MISMATCH',
      status: 'WARNING',
      message:
        'Utgående moms på omvänd skattskyldighet (ruta 30-32) är högre än ' +
        'avdragsgill ingående moms (ruta 48). Vid full avdragsrätt ska ' +
        'beräknad ingående moms (2645/2647) nolla ut den fiktiva utgående ' +
        'momsen. Kontrollera att 2645/2647 är bokförd för varje 2614/2624/2634-rad.',
      rutor: ['ruta30', 'ruta31', 'ruta32', 'ruta48'],
    })
  }

  // SummaMoms drift — sanity check that our local ruta49 matches what the
  // mapper will send. If this fires, the calculator and mapper disagree
  // and we'd hit SKV's FK009.
  const expectedRuta49 =
    rutor.ruta10 + rutor.ruta11 + rutor.ruta12 +
    rutor.ruta30 + rutor.ruta31 + rutor.ruta32 +
    rutor.ruta60 + rutor.ruta61 + rutor.ruta62 -
    rutor.ruta48
  if (Math.abs(expectedRuta49 - rutor.ruta49) > eps) {
    findings.push({
      code: 'SUMMA_MOMS_DRIFT',
      status: 'ERROR',
      message:
        'Beräknad ruta 49 (moms att betala) stämmer inte överens med summan ' +
        'av övriga rutor. Detta tyder på avrundningsfel i bokföringen. ' +
        'Kontrollera huvudboken för perioden innan inlämning.',
      rutor: ['ruta49'],
    })
  }

  return findings
}
