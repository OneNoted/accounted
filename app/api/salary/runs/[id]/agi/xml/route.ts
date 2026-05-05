import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { ensureInitialized } from '@/lib/init'
import { requireCompanyId } from '@/lib/company/context'
import { generateAGIXml, buildIndividuppgifterSnapshot, AGIIncompleteDataError } from '@/lib/salary/agi/xml-generator'
import type { AGIEmployeeData, AGICompanyData, AGITotals } from '@/lib/salary/agi/xml-generator'
import { eventBus } from '@/lib/events'

ensureInitialized()

/**
 * Generate AGI XML for a salary run.
 *
 * Per agi-filing.md:
 * - FK570 (specifikationsnummer) MUST stay consistent per employee
 * - Corrections resubmit with same FK570 — different number = new record
 * - XML is räkenskapsinformation, stored for 7-year retention per BFL 7 kap
 * - Filing deadline: 12th of following month (17th in Jan/Aug for ≤40 MSEK)
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const companyId = await requireCompanyId(supabase, user.id)

  // Load salary run
  const { data: run, error: runError } = await supabase
    .from('salary_runs')
    .select('*')
    .eq('id', id)
    .eq('company_id', companyId)
    .single()

  if (runError || !run) {
    return NextResponse.json({ error: 'Lönekörning hittades inte' }, { status: 404 })
  }

  if (!['review', 'approved', 'paid', 'booked', 'corrected'].includes(run.status)) {
    return NextResponse.json({ error: 'AGI kan bara genereras efter granskning' }, { status: 400 })
  }

  // Load company
  const { data: company } = await supabase
    .from('companies')
    .select('name, org_number')
    .eq('id', companyId)
    .single()

  if (!company) {
    return NextResponse.json({ error: 'Företag hittades inte' }, { status: 404 })
  }

  // Load company-level phone/email/org from settings (user-editable under /settings/company).
  // Note: the schema has `phone` and `email` — there is no separate `contact_*` column.
  const { data: settings } = await supabase
    .from('company_settings')
    .select('org_number, phone, email')
    .eq('company_id', companyId)
    .single()

  // Technical contact name comes from the signed-in user's profile (the person
  // generating the file), falling back to the company name.
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('id', user.id)
    .single()

  // Load employees with their data. We need monthly_salary on the employee
  // record to derive FK499 sjuklönekostnad from per-day records (the line
  // item `amount` is the net deduction, not the sjuklön cost).
  const { data: runEmployees } = await supabase
    .from('salary_run_employees')
    .select('*, employee:employees(personnummer, specification_number, f_skatt_status, monthly_salary), line_items:salary_line_items(*)')
    .eq('salary_run_id', id)

  if (!runEmployees || runEmployees.length === 0) {
    return NextResponse.json({ error: 'Inga anställda i lönekörningen' }, { status: 400 })
  }

  // Build AGI data.
  // org_number: prefer the user-editable company_settings.org_number, fall
  // back to companies.org_number (set during onboarding).
  const companyData: AGICompanyData = {
    orgNumber: (settings?.org_number || company.org_number || '').trim(),
    companyName: company.name,
    periodYear: run.period_year,
    periodMonth: run.period_month,
    contactName: (profile?.full_name || company.name || '').trim(),
    contactPhone: (settings?.phone || '').trim(),
    contactEmail: (settings?.email || profile?.email || user.email || '').trim(),
  }

  // Load per-day absence records for VAB + parental in the pay period.
  // Sick days never reach AGI (they go to Försäkringskassan separately).
  // The XML generator's Frånvarouppgift section consumes these per event.
  const periodStart = `${run.period_year}-${String(run.period_month).padStart(2, '0')}-01`
  const periodEndDate = new Date(Date.UTC(run.period_year, run.period_month, 0))
  const periodEnd = periodEndDate.toISOString().slice(0, 10)
  const employeeIds = runEmployees
    .map(sre => sre.employee_id as string)
    .filter(Boolean)
  const absenceByEmployee = new Map<string, Array<{ date: string; type: 'vab' | 'parental'; hours: number }>>()
  if (employeeIds.length > 0) {
    const { data: absenceRows } = await supabase
      .from('salary_absence_days')
      .select('employee_id, absence_date, absence_type, hours')
      .eq('company_id', companyId)
      .in('absence_type', ['vab', 'parental'])
      .gte('absence_date', periodStart)
      .lte('absence_date', periodEnd)
      .in('employee_id', employeeIds)
    for (const row of (absenceRows ?? [])) {
      const list = absenceByEmployee.get(row.employee_id) ?? []
      list.push({
        date: row.absence_date as string,
        type: row.absence_type as 'vab' | 'parental',
        hours: Number(row.hours ?? 8),
      })
      absenceByEmployee.set(row.employee_id, list)
    }
  }

  const employeeData: AGIEmployeeData[] = runEmployees.map(sre => {
    const emp = sre.employee as { personnummer: string; specification_number: number; f_skatt_status: string } | null
    const lineItems = (sre.line_items || []) as Array<Record<string, unknown>>

    // Sum benefits by type for AGI rutor 012-019
    const benefitCar = sumLineItemAmounts(lineItems, ['benefit_car'])
    const benefitMeals = sumLineItemAmounts(lineItems, ['benefit_meals'])
    const benefitHousing = sumLineItemAmounts(lineItems, ['benefit_housing'])
    const benefitOther = sumLineItemAmounts(lineItems, ['benefit_wellness', 'benefit_other'])

    const absenceEvents = absenceByEmployee.get(sre.employee_id as string)

    return {
      personnummer: emp?.personnummer || '',
      specificationNumber: emp?.specification_number || 0,
      grossSalary: sre.gross_salary,
      taxWithheld: sre.tax_withheld,
      avgifterBasis: sre.avgifter_basis,
      fSkattPayment: emp?.f_skatt_status === 'f_skatt' ? sre.gross_salary : undefined,
      benefitCar: benefitCar > 0 ? benefitCar : undefined,
      benefitHousing: benefitHousing > 0 ? benefitHousing : undefined,
      benefitMeals: benefitMeals > 0 ? benefitMeals : undefined,
      benefitOther: benefitOther > 0 ? benefitOther : undefined,
      sickDays: sre.sick_days > 0 ? sre.sick_days : undefined,
      vabDays: sre.vab_days > 0 ? sre.vab_days : undefined,
      parentalDays: sre.parental_days > 0 ? sre.parental_days : undefined,
      absenceEvents: absenceEvents && absenceEvents.length > 0 ? absenceEvents : undefined,
    }
  })

  // Build totals with avgifter breakdown by category (read from DB, not re-derived from rate)
  const avgifterByCategory: AGITotals['avgifterByCategory'] = {}
  for (const sre of runEmployees) {
    const dbCategory = sre.avgifter_category as string | null
    // Map DB category to AGI HU category; fall back to rate heuristic for legacy runs without stored category
    const category = dbCategory
      ? (dbCategory === 'reduced_65plus' ? 'reduced65plus' : dbCategory === 'vaxa_stod' ? 'standard' : dbCategory)
      : (sre.avgifter_rate <= 0.1022 ? 'reduced65plus' : sre.avgifter_rate <= 0.2082 ? 'youth' : 'standard')
    const cat = avgifterByCategory[category as keyof typeof avgifterByCategory] || { basis: 0, amount: 0 }
    cat.basis += sre.avgifter_basis
    cat.amount += sre.avgifter_amount
    ;(avgifterByCategory as Record<string, { basis: number; amount: number }>)[category] = cat
  }

  const totalAvgifterAmount = Object.values(avgifterByCategory).reduce(
    (sum, cat) => sum + (cat?.amount ?? 0),
    0
  )

  // FK499 TotalSjuklonekostnad — sum of *paid* sjuklön (days 2–14) across all
  // employees. Day 1 is karens (unpaid); day 15+ is Försäkringskassan, so
  // neither counts as an employer sjuklön cost.
  //
  // Sjuklön cost = dailyRate × sjuklonRate × day-2-14 count.
  // The line item `amount` is the *net deduction* (lostPay − sjuklön), not
  // the cost — using its quantity field plus the employee's monthly salary
  // gives the correct sjuklön cost regardless of the line-item amount
  // convention.
  //
  // sjuklonRate is read from the run's calculation_params snapshot (taken at
  // calc time), so an operator override (e.g. for a CBA-specific rate) is
  // honored. Falls back to 0.80 (Sjuklönelagen default) for older runs that
  // don't have the snapshot.
  const calcParams = (run.calculation_params ?? {}) as { sjuklonRate?: number; sjuklon_rate?: number }
  const sjuklonRate = calcParams.sjuklonRate ?? calcParams.sjuklon_rate ?? 0.80
  let totalSjuklonekostnad = 0
  for (const sre of runEmployees) {
    const monthly = (sre.employee as { monthly_salary?: number } | null)?.monthly_salary ?? 0
    if (!monthly) continue
    const dailyRate = monthly / 21
    const lineItems = (sre.line_items || []) as Array<Record<string, unknown>>
    for (const li of lineItems) {
      if (li.item_type === 'sick_day2_14') {
        const days = (li.quantity as number) || 0
        totalSjuklonekostnad += dailyRate * sjuklonRate * days
      }
    }
  }

  const totals: AGITotals = {
    totalTax: run.total_tax,
    totalAvgifterBasis: runEmployees.reduce((s, e) => s + e.avgifter_basis, 0),
    totalAvgifterAmount: Math.round(totalAvgifterAmount * 100) / 100,
    totalSjuklonekostnad: Math.round(totalSjuklonekostnad * 100) / 100,
    avgifterByCategory,
  }

  // Check for existing AGI for correction flag
  const { data: existingAgi } = await supabase
    .from('agi_declarations')
    .select('id')
    .eq('company_id', companyId)
    .eq('period_year', run.period_year)
    .eq('period_month', run.period_month)
    .single()

  const isCorrection = !!existingAgi

  let xml: string
  try {
    xml = generateAGIXml(companyData, employeeData, totals, isCorrection)
  } catch (err) {
    if (err instanceof AGIIncompleteDataError) {
      return NextResponse.json({ error: err.message, missingFields: err.missingFields }, { status: 400 })
    }
    throw err
  }
  const individuppgifter = buildIndividuppgifterSnapshot(employeeData)

  // Store AGI declaration (upsert for corrections per unique constraint).
  // In-place update: leave corrects_agi_id null — a record must not reference
  // itself as the declaration it corrects. When a true correction chain is
  // needed, create a new row pointing to the original instead.
  if (existingAgi) {
    await supabase
      .from('agi_declarations')
      .update({
        xml_content: xml,
        individuppgifter,
        total_gross: run.total_gross,
        total_tax: run.total_tax,
        total_avgifter_basis: totals.totalAvgifterBasis,
        total_avgifter: run.total_avgifter,
        employee_count: employeeData.length,
        is_correction: true,
        salary_run_id: run.id,
      })
      .eq('id', existingAgi.id)
  } else {
    await supabase
      .from('agi_declarations')
      .insert({
        company_id: companyId,
        user_id: user.id,
        salary_run_id: run.id,
        period_year: run.period_year,
        period_month: run.period_month,
        xml_content: xml,
        individuppgifter,
        total_gross: run.total_gross,
        total_tax: run.total_tax,
        total_avgifter_basis: totals.totalAvgifterBasis,
        total_avgifter: run.total_avgifter,
        employee_count: employeeData.length,
      })
  }

  // Update salary run
  await supabase
    .from('salary_runs')
    .update({ agi_generated_at: new Date().toISOString() })
    .eq('id', id)

  await eventBus.emit({
    type: 'agi.generated',
    payload: {
      agiId: existingAgi?.id || 'new',
      periodYear: run.period_year,
      periodMonth: run.period_month,
      userId: user.id,
      companyId,
    },
  })

  // Auto-complete arbetsgivardeklaration deadline for this period
  // Per Skatteförfarandelagen: AGI generation satisfies the filing obligation
  const period = `${run.period_year}-${String(run.period_month).padStart(2, '0')}`
  await supabase
    .from('deadlines')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      completed_by: user.id,
    })
    .eq('company_id', companyId)
    .eq('type', 'arbetsgivardeklaration')
    .eq('period', period)
    .eq('status', 'pending')

  // Return as downloadable XML
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="AGI_${company.org_number}_${run.period_year}${String(run.period_month).padStart(2, '0')}.xml"`,
    },
  })
}

function sumLineItemAmounts(lineItems: Array<Record<string, unknown>>, types: string[]): number {
  return lineItems
    .filter(li => types.includes(li.item_type as string))
    .reduce((sum, li) => sum + ((li.amount as number) || 0), 0)
}
