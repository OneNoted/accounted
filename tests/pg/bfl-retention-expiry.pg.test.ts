import { describe, expect, it } from 'vitest'
import { getPool } from './setup'
import { insertAuthUser, insertCompany, insertFiscalPeriod } from './fixtures'

describe('BFL retention expiry', () => {
  it('retains a fiscal year through the end of the seventh following calendar year', async () => {
    const userId = await insertAuthUser()
    const companyId = await insertCompany({ createdBy: userId })
    const fiscalPeriodId = await insertFiscalPeriod({
      userId,
      companyId,
      periodStart: '2025-07-01',
      periodEnd: '2026-06-30',
      name: '2025/2026',
    })

    const result = await getPool().query<{ retention_expires_at: string }>(
      `SELECT retention_expires_at::text
       FROM public.fiscal_periods
       WHERE id = $1`,
      [fiscalPeriodId],
    )

    expect(result.rows[0].retention_expires_at).toBe('2034-01-01')
  })

  it('recalculates the first allowed deletion date when an open period end changes', async () => {
    const userId = await insertAuthUser()
    const companyId = await insertCompany({ createdBy: userId })
    const fiscalPeriodId = await insertFiscalPeriod({ userId, companyId })

    await getPool().query(
      `UPDATE public.fiscal_periods
       SET period_end = '2027-03-31'
       WHERE id = $1`,
      [fiscalPeriodId],
    )
    const result = await getPool().query<{ retention_expires_at: string }>(
      `SELECT retention_expires_at::text
       FROM public.fiscal_periods
       WHERE id = $1`,
      [fiscalPeriodId],
    )

    expect(result.rows[0].retention_expires_at).toBe('2035-01-01')
  })
})
