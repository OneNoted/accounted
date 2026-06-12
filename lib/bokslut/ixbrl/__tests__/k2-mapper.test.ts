import { describe, expect, it } from 'vitest'
import { mapTrialBalancesToK2, type TrialBalanceRowLike } from '../k2-mapper'

const row = (
  account: string,
  name: string,
  debit: number,
  credit: number,
): TrialBalanceRowLike => ({
  account_number: account,
  account_name: name,
  closing_debit: debit,
  closing_credit: credit,
})

/** Current-year fixture: small AB, balanced at 380 000, result 120 000. */
const CURRENT: TrialBalanceRowLike[] = [
  row('1220', 'Inventarier och verktyg', 80_000, 0),
  row('1229', 'Ack. avskrivningar inventarier', 0, 20_000),
  row('1510', 'Kundfordringar', 50_000, 0),
  row('1930', 'Företagskonto', 270_000, 0),
  row('2081', 'Aktiekapital', 0, 25_000),
  row('2091', 'Balanserad vinst eller förlust', 0, 100_000),
  row('2099', 'Årets resultat', 0, 120_000),
  row('2110', 'Periodiseringsfond', 0, 40_000),
  row('2440', 'Leverantörsskulder', 0, 30_000),
  row('2510', 'Skatteskulder', 0, 35_000),
  row('2610', 'Utgående moms 25 %', 0, 20_000),
  row('2941', 'Upplupna sociala avgifter', 0, 10_000),
  row('3010', 'Försäljning', 0, 1_000_000),
  row('4010', 'Inköp material och varor', 200_000, 0),
  row('5010', 'Lokalhyra', 100_000, 0),
  row('7010', 'Löner', 400_000, 0),
  row('7510', 'Arbetsgivaravgifter', 125_660, 0),
  row('7832', 'Avskrivningar inventarier', 20_000, 0),
  row('8310', 'Ränteintäkter', 0, 1_000),
  row('8410', 'Räntekostnader', 4_000, 0),
  row('8811', 'Avsättning till periodiseringsfond', 10_000, 0),
  row('8910', 'Skatt på årets resultat', 21_340, 0),
]

const PREVIOUS: TrialBalanceRowLike[] = [
  row('1220', 'Inventarier och verktyg', 80_000, 0),
  row('1229', 'Ack. avskrivningar inventarier', 0, 12_000),
  row('1930', 'Företagskonto', 185_000, 0),
  row('2081', 'Aktiekapital', 0, 25_000),
  row('2091', 'Balanserad vinst eller förlust', 0, 60_000),
  row('2099', 'Årets resultat', 0, 40_000),
  row('2110', 'Periodiseringsfond', 0, 30_000),
  row('2440', 'Leverantörsskulder', 0, 25_000),
  row('2510', 'Skatteskulder', 0, 15_000),
  row('2610', 'Utgående moms 25 %', 0, 8_000),
  row('2941', 'Upplupna sociala avgifter', 0, 50_000),
  row('3010', 'Försäljning', 0, 500_000),
  row('4010', 'Inköp material och varor', 200_000, 0),
  row('5010', 'Lokalhyra', 80_000, 0),
  row('7010', 'Löner', 150_000, 0),
  row('7832', 'Avskrivningar inventarier', 8_000, 0),
  row('8410', 'Räntekostnader', 2_000, 0),
  row('8910', 'Skatt på årets resultat', 20_000, 0),
]

describe('mapTrialBalancesToK2', () => {
  const result = mapTrialBalancesToK2(CURRENT, PREVIOUS)

  it('maps RR posts with natural orientation for both years', () => {
    expect(result.rr['Nettoomsattning']).toEqual({ current: 1_000_000, previous: 500_000 })
    expect(result.rr['RavarorFornodenheterKostnader']).toEqual({
      current: 200_000,
      previous: 200_000,
    })
    expect(result.rr['OvrigaExternaKostnader']).toEqual({ current: 100_000, previous: 80_000 })
    expect(result.rr['Personalkostnader']).toEqual({ current: 525_660, previous: 150_000 })
    expect(
      result.rr['AvskrivningarNedskrivningarMateriellaImmateriellaAnlaggningstillgangar'],
    ).toEqual({ current: 20_000, previous: 8_000 })
    expect(result.rr['OvrigaRanteintakterLiknandeResultatposter']).toEqual({
      current: 1_000,
      previous: 0,
    })
    expect(result.rr['RantekostnaderLiknandeResultatposter']).toEqual({
      current: 4_000,
      previous: 2_000,
    })
    // 8811 avsättning = debit → credit-oriented concept goes negative.
    expect(result.rr['ForandringPeriodiseringsfond']).toEqual({ current: -10_000, previous: 0 })
    expect(result.rr['SkattAretsResultat']).toEqual({ current: 21_340, previous: 20_000 })
  })

  it('computes RR subtotals down to årets resultat', () => {
    expect(result.totals.rorelseintakter.current).toBe(1_000_000)
    expect(result.totals.rorelsekostnader.current).toBe(845_660)
    expect(result.totals.rorelseresultat.current).toBe(154_340)
    expect(result.totals.finansiellaPoster.current).toBe(-3_000)
    expect(result.totals.resultatEfterFinansiellaPoster.current).toBe(151_340)
    expect(result.totals.bokslutsdispositioner.current).toBe(-10_000)
    expect(result.totals.resultatForeSkatt.current).toBe(141_340)
    expect(result.totals.aretsResultat.current).toBe(120_000)
    expect(result.totals.aretsResultat.previous).toBe(40_000)
  })

  it('maps BR posts and nets contra accounts (ack. avskrivningar)', () => {
    expect(result.br['InventarierVerktygInstallationer']).toEqual({
      current: 60_000,
      previous: 68_000,
    })
    expect(result.br['Kundfordringar']).toEqual({ current: 50_000, previous: 0 })
    expect(result.br['KassaBankExklRedovisningsmedel']).toEqual({
      current: 270_000,
      previous: 185_000,
    })
    expect(result.br['Aktiekapital']).toEqual({ current: 25_000, previous: 25_000 })
    expect(result.br['BalanseratResultat']).toEqual({ current: 100_000, previous: 60_000 })
    expect(result.br['AretsResultatEgetKapital']).toEqual({ current: 120_000, previous: 40_000 })
    expect(result.br['Periodiseringsfonder']).toEqual({ current: 40_000, previous: 30_000 })
    expect(result.br['Leverantorsskulder']).toEqual({ current: 30_000, previous: 25_000 })
    expect(result.br['Skatteskulder']).toEqual({ current: 35_000, previous: 15_000 })
    // Moms (2610) lands in övriga kortfristiga skulder.
    expect(result.br['OvrigaKortfristigaSkulder']).toEqual({ current: 20_000, previous: 8_000 })
    expect(result.br['UpplupnaKostnaderForutbetaldaIntakter']).toEqual({
      current: 10_000,
      previous: 50_000,
    })
  })

  it('balances: Summa tillgångar == Summa eget kapital och skulder (3005)', () => {
    expect(result.totals.tillgangar.current).toBe(380_000)
    expect(result.totals.egetKapitalSkulder.current).toBe(380_000)
    expect(result.totals.tillgangar.previous).toBe(253_000)
    expect(result.totals.egetKapitalSkulder.previous).toBe(253_000)
    expect(result.warnings).toEqual([])
    expect(result.unmappedAccounts).toEqual([])
  })

  it('reconciles RR-result against BR 2099', () => {
    expect(result.totals.aretsResultat.current).toBe(result.br['AretsResultatEgetKapital'].current)
  })

  it('handles first fiscal year (no previous trial balance)', () => {
    const firstYear = mapTrialBalancesToK2(CURRENT, null)
    expect(firstYear.rr['Nettoomsattning']).toEqual({ current: 1_000_000, previous: null })
    expect(firstYear.totals.tillgangar.previous).toBeNull()
  })

  it('flags unmapped accounts (their balance never reaches the BR)', () => {
    const broken = [...CURRENT, row('9999', 'Internkonto', 5_000, 0)]
    const res = mapTrialBalancesToK2(broken, null)
    expect(res.unmappedAccounts).toHaveLength(1)
    expect(res.unmappedAccounts[0].account).toBe('9999')
    expect(res.warnings.some((w) => w.includes('9999'))).toBe(true)
  })

  it('warns when the mapped balance sheet does not balance (3005)', () => {
    const broken = CURRENT.map((r2) =>
      r2.account_number === '1930' ? { ...r2, closing_debit: 275_000 } : r2,
    )
    const res = mapTrialBalancesToK2(broken, null)
    expect(res.warnings.some((w) => w.includes('3005'))).toBe(true)
  })

  it('warns when 2099 is not booked (RR ≠ BR result)', () => {
    const noResult = CURRENT.map((r2) =>
      r2.account_number === '2099'
        ? { ...r2, closing_credit: 0 }
        : r2.account_number === '2091'
          ? { ...r2, closing_credit: 220_000 }
          : r2,
    )
    const res = mapTrialBalancesToK2(noResult, null)
    expect(res.warnings.some((w) => w.includes('2099'))).toBe(true)
  })

  it('routes lagerförändringar per K2 split (4910 → råvaror, 4960 → handelsvaror, 4940 → förändring av lager)', () => {
    const rows = [
      row('3010', 'Försäljning', 0, 100_000),
      row('4910', 'Förändring lager råvaror', 0, 5_000),
      row('4940', 'Förändring produkter i arbete', 0, 7_000),
      row('4960', 'Förändring lager handelsvaror', 3_000, 0),
    ]
    const res = mapTrialBalancesToK2(rows, null)
    expect(res.rr['RavarorFornodenheterKostnader'].current).toBe(-5_000)
    expect(
      res.rr['ForandringLagerProdukterIArbeteFardigaVarorPagaendeArbetenAnnansRakning'].current,
    ).toBe(7_000)
    expect(res.rr['HandelsvarorKostnader'].current).toBe(3_000)
  })
})
