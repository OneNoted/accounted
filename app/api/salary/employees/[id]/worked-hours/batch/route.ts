import { NextResponse } from 'next/server'
import { ensureInitialized } from '@/lib/init'
import { withRouteContext } from '@/lib/api/with-route-context'
import { validateBody } from '@/lib/api/validate'
import { BatchUpsertWorkedDaysSchema } from '@/lib/api/schemas'
import { getErrorMessage as getUserErrorMessage } from '@/lib/errors/get-error-message'

ensureInitialized()

interface BatchConflict {
  date: string
  reason: string
}

/** The per-day values the delete-and-reinsert below must not destroy. */
interface ExistingWorkedDay {
  work_date: string
  notes: string | null
  salary_run_employee_id: string | null
  start_time: string | null
  end_time: string | null
}

export const POST = withRouteContext<{ params: Promise<{ id: string }> }>(
  'salary.employees.worked_hours.batch',
  async (request, { supabase, companyId }, { params }) => {
    const { id: employeeId } = await params

    const { data: employee } = await supabase
      .from('employees')
      .select('id')
      .eq('id', employeeId)
      .eq('company_id', companyId)
      .maybeSingle()
    if (!employee) {
      return NextResponse.json({ error: 'Anställd hittades inte' }, { status: 404 })
    }

    const validation = await validateBody(request, BatchUpsertWorkedDaysSchema)
    if (!validation.success) return validation.response
    const body = validation.data

    // Dedupe dates so the user can pass an array with accidental duplicates
    // (e.g. shift-clicking over the same date twice).
    const uniqueDates = Array.from(new Set(body.dates))

    // Read the rows we are about to replace BEFORE deleting them. The batch
    // carries one shared value for N dates, so it cannot express per-day notes,
    // per-day shift windows or per-day run links: anything the body omits has to
    // survive the replace. Without this, "mark Mon-Fri as 8 h" silently wipes
    // every note the user wrote on those days and every shift window that made
    // OB-tillägg computable. Read first so a failure here aborts before we have
    // deleted anything.
    const { data: existingRows, error: existingError } = await supabase
      .from('salary_worked_days')
      .select('work_date, notes, salary_run_employee_id, start_time, end_time')
      .eq('company_id', companyId)
      .eq('employee_id', employeeId)
      .in('work_date', uniqueDates)

    if (existingError) {
      return NextResponse.json({ error: getUserErrorMessage(existingError) }, { status: 500 })
    }

    const existingByDate = new Map<string, ExistingWorkedDay>(
      ((existingRows ?? []) as ExistingWorkedDay[]).map((row) => [row.work_date, row]),
    )

    // A supplied shift window applies to every date in the batch; an omitted one
    // leaves each day's stored window alone. Resolved as a pair so a body start
    // time is never mixed with a stored end time (the schema pairs them too).
    const bodyShiftWindow =
      body.start_time != null && body.end_time != null
        ? { start_time: body.start_time, end_time: body.end_time }
        : null

    // Bulk delete existing rows on these dates first so the per-row insert step
    // is a clean replace. Stays within RLS via company_id + employee_id filter.
    const { error: deleteError } = await supabase
      .from('salary_worked_days')
      .delete()
      .eq('company_id', companyId)
      .eq('employee_id', employeeId)
      .in('work_date', uniqueDates)

    if (deleteError) {
      return NextResponse.json({ error: getUserErrorMessage(deleteError) }, { status: 500 })
    }

    // Per-row insert so we can isolate trigger failures (24h cap on a date with
    // existing absence) without aborting the whole batch. A single multi-row
    // insert would fail-fast and surface only the first conflict.
    const conflicts: BatchConflict[] = []
    let inserted = 0

    for (const date of uniqueDates) {
      const existing = existingByDate.get(date)
      const shiftWindow = bodyShiftWindow ?? {
        start_time: existing?.start_time ?? null,
        end_time: existing?.end_time ?? null,
      }
      const { error } = await supabase
        .from('salary_worked_days')
        .insert({
          company_id: companyId,
          employee_id: employeeId,
          work_date: date,
          // hours is the point of the batch: it always overwrites.
          hours: body.hours,
          // Everything else: the body wins when it carries a value, otherwise
          // the day keeps what it already had.
          notes: body.notes ?? existing?.notes ?? null,
          salary_run_employee_id:
            body.salary_run_employee_id ?? existing?.salary_run_employee_id ?? null,
          start_time: shiftWindow.start_time,
          end_time: shiftWindow.end_time,
        })
      if (error) {
        // 24h cap trigger uses ERRCODE check_violation (23514) and a Swedish
        // message starting with "Total tid". Other failures are unexpected.
        if (error.message?.includes('Total tid') || error.code === '23514') {
          conflicts.push({ date, reason: getUserErrorMessage(error) })
          continue
        }
        return NextResponse.json(
          { error: getUserErrorMessage(error), inserted, conflicts },
          { status: 500 },
        )
      }
      inserted += 1
    }

    return NextResponse.json(
      { data: { inserted, conflicts } },
      { status: conflicts.length > 0 ? 207 : 201 },
    )
  },
  { requireWrite: true },
)
