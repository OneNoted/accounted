import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import {
  backfillMissingTaxDeadlines,
  generateNewYearDeadlines,
} from '@/lib/tax/deadline-generator'
import { withCronContext } from '@/lib/api/with-cron-context'
import { errorResponseFromCode } from '@/lib/errors/get-structured-error'

/**
 * GET /api/tax-deadlines/cron: daily recovery plus annual horizon extension.
 */
export const GET = withCronContext('cron.tax_deadlines', async (_request, ctx) => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    return errorResponseFromCode('INTERNAL_ERROR', ctx.log, {
      requestId: ctx.requestId,
      details: { reason: 'Missing Supabase configuration' },
    })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const now = new Date()
  const isAnnualRun = now.getUTCMonth() === 0 && now.getUTCDate() === 2
  const annual = isAnnualRun
    ? await generateNewYearDeadlines(supabase)
    : { usersProcessed: 0, totalCreated: 0 }
  const recovery = await backfillMissingTaxDeadlines(supabase)
  const totalCreated = annual.totalCreated + recovery.totalCreated

  ctx.log.info('tax deadlines cron summary', {
    isAnnualRun,
    usersProcessed: annual.usersProcessed,
    companiesScanned: recovery.companiesScanned,
    companiesRepaired: recovery.companiesRepaired,
    totalCreated,
  })

  return NextResponse.json({
    success: true,
    isAnnualRun,
    usersProcessed: annual.usersProcessed,
    companiesScanned: recovery.companiesScanned,
    companiesRepaired: recovery.companiesRepaired,
    totalCreated,
  })
})
