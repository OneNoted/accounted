import { NextResponse } from 'next/server'
import { ensureInitialized } from '@/lib/init'
import { withCronContext } from '@/lib/api/with-cron-context'
import { createServiceClient } from '@/lib/supabase/server'
import {
  executeRecurringSchedule,
  computeNextRunDate,
  computeInitialRunDate,
  getStockholmDateHour,
} from '@/lib/invoices/recurring-schedule-service'
import type {
  RecurringInvoiceSchedule,
  RecurringInvoiceScheduleItem,
} from '@/types'

ensureInitialized()

type DueSchedule = RecurringInvoiceSchedule & { items: RecurringInvoiceScheduleItem[] }

/**
 * GET /api/invoices/recurring/cron: hourly (top of every hour, UTC).
 *
 * Users pick a send hour in Swedish local time (send_hour, 0-23,
 * Europe/Stockholm). This cron runs every hour and, for each active schedule
 * due today, sends only once the chosen Stockholm hour has arrived.
 *
 * Safety rules (see DECISIONS.md):
 *  - Never send for a date in the past. A schedule whose next_run_date is
 *    before today (a missed prior day, e.g. after an outage or on a schedule
 *    the user just reactivated) is rolled forward to its next future
 *    occurrence WITHOUT generating anything.
 *  - Paused schedules are ignored (status filter). Existing schedules were
 *    paused on deploy so nothing resumes sending behind the user's back.
 *
 * Each schedule runs in isolated try/catch so a failure on one doesn't block
 * the rest. On a successful send: bump next_run_date to next month, set
 * last_run_at/last_invoice_id/generated_count. On failure: leave next_run_date
 * alone so a later run retries.
 */
export const GET = withCronContext('cron.recurring_invoices', async (_request, ctx) => {
  const supabase = createServiceClient()

  const now = new Date()
  // "Today" and the current hour in Swedish local time. Date math for rolling
  // next_run_date uses a UTC-midnight Date of the Stockholm calendar day so it
  // stays consistent with the Stockholm day even across the UTC boundary.
  const { date: todayStockholm, hour: currentHour } = getStockholmDateHour(now)
  const stockholmToday = new Date(`${todayStockholm}T00:00:00Z`)

  const { data: due, error } = await supabase
    .from('recurring_invoice_schedules')
    .select('*, items:recurring_invoice_schedule_items(*)')
    .eq('status', 'active')
    .lte('next_run_date', todayStockholm)

  if (error) {
    ctx.log.error('failed to load due recurring schedules', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    )
  }

  const schedules = (due ?? []) as DueSchedule[]

  ctx.log.info('recurring invoice cron starting', {
    dueCount: schedules.length,
    todayStockholm,
    currentHour,
  })

  type RunResult = {
    scheduleId: string
    invoiceId?: string
    invoiceNumber?: string | null
    autoSent?: boolean
    warning?: string | null
    skipped?: boolean
    skipReason?: string
    error?: string
  }
  const results: RunResult[] = []

  const summary = await ctx.forEach('schedule', schedules, async (schedule, itemCtx) => {
    // 1. Missed a prior day: never send for the past. Roll forward to the next
    //    future occurrence (this month if the day hasn't passed, else next
    //    month) without generating an invoice. This also protects the
    //    reactivation path: turning a long-paused schedule back on rolls it to
    //    its next date rather than firing a stale one immediately.
    if (schedule.next_run_date < todayStockholm) {
      const rolledNext = computeInitialRunDate(stockholmToday, schedule.day_of_month)
      const { error: rollError } = await supabase
        .from('recurring_invoice_schedules')
        .update({ next_run_date: rolledNext })
        .eq('id', schedule.id)
        .eq('company_id', schedule.company_id)
      if (rollError) {
        throw new Error(`failed to roll stale schedule forward: ${rollError.message}`)
      }
      itemCtx.log.info('stale schedule rolled forward without sending', {
        from: schedule.next_run_date,
        to: rolledNext,
      })
      results.push({
        scheduleId: schedule.id,
        skipped: true,
        skipReason: 'stale_rolled_forward',
      })
      return
    }

    // 2. Due today but the chosen Stockholm hour hasn't arrived yet. A later
    //    run this same day will pick it up (send_hour <= currentHour).
    if (currentHour < schedule.send_hour) {
      results.push({
        scheduleId: schedule.id,
        skipped: true,
        skipReason: 'hour_not_reached',
      })
      return
    }

    // 3. Idempotency: skip if already ran today (cron retries within the same
    //    Stockholm day). Cheaper than a Postgres advisory lock and the window
    //    we're protecting (one row, ~seconds) is tiny.
    if (schedule.last_run_at) {
      const lastRunDay = getStockholmDateHour(new Date(schedule.last_run_at)).date
      if (lastRunDay >= todayStockholm) {
        itemCtx.log.info('schedule already ran today; skipping')
        results.push({
          scheduleId: schedule.id,
          skipped: true,
          skipReason: 'already_ran_today',
        })
        return
      }
    }

    const result = await executeRecurringSchedule(supabase, schedule, now)

    const nextRunDate = computeNextRunDate(stockholmToday, schedule.day_of_month)
    const { error: updateError } = await supabase
      .from('recurring_invoice_schedules')
      .update({
        next_run_date: nextRunDate,
        last_run_at: now.toISOString(),
        last_invoice_id: result.invoiceId,
        last_run_warning: result.warning,
        generated_count: schedule.generated_count + 1,
      })
      .eq('id', schedule.id)
      .eq('company_id', schedule.company_id)

    if (updateError) {
      // The invoice exists. If we don't mark the schedule as ran, tomorrow's
      // cron would spawn a duplicate. Surface this loudly.
      itemCtx.log.error(
        'invoice created but failed to update schedule: manual cleanup may be needed',
        updateError,
        { scheduleId: schedule.id, invoiceId: result.invoiceId },
      )
      throw new Error(
        `schedule update failed after invoice ${result.invoiceId} created: ${updateError.message}`,
      )
    }

    results.push({
      scheduleId: schedule.id,
      invoiceId: result.invoiceId,
      invoiceNumber: result.invoiceNumber,
      autoSent: result.autoSent,
      warning: result.warning,
    })
  })

  ctx.log.info('recurring invoice cron summary', {
    total: summary.total,
    succeeded: summary.succeeded,
    failed: summary.failed,
  })

  return NextResponse.json({
    success: true,
    total: summary.total,
    succeeded: summary.succeeded,
    failed: summary.failed,
    failures: summary.failures,
    results,
  })
})

export const POST = GET
