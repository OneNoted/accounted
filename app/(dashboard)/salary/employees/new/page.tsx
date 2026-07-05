'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArrowLeft, Save } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { getErrorMessage } from '@/lib/errors/get-error-message'
import EmployeeTaxCard, { type EmployeeTaxValue } from '@/components/salary/EmployeeTaxCard'
import LineDimensionFields from '@/components/dimensions/LineDimensionFields'

function RequiredMark() {
  return <span className="text-destructive ml-0.5">*</span>
}

export default function NewEmployeePage() {
  const t = useTranslations('salary_employee')
  const router = useRouter()
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [employmentType, setEmploymentType] = useState('employee')
  const [salaryType, setSalaryType] = useState('monthly')
  const [personnummer, setPersonnummer] = useState('')
  const [vacationRule, setVacationRule] = useState('procentregeln')
  // Default dimensions bag ({sie_dim_no: object_code}) proposed on the
  // employee's salary-cost lines at booking. The fields render only when
  // company_settings.dimensions_enabled — same UI gate as the voucher form.
  const [dimensionsEnabled, setDimensionsEnabled] = useState(false)
  const [dimensions, setDimensions] = useState<Record<string, string>>({})
  const [tax, setTax] = useState<EmployeeTaxValue>({
    f_skatt_status: 'a_skatt',
    is_sidoinkomst: false,
    tax_table_number: null,
    tax_column: 1,
    tax_municipality: '',
  })

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then(({ data }) => setDimensionsEnabled(data?.dimensions_enabled === true))
      .catch(() => {/* keep the dimension fields hidden */})
  }, [])

  function setDimension(dimNo: string, code: string | null) {
    setDimensions((prev) => {
      const next = { ...prev }
      const value = code?.trim()
      if (value) next[dimNo] = value
      else delete next[dimNo]
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)

    const form = new FormData(e.currentTarget)
    const body = {
      first_name: form.get('first_name') as string,
      last_name: form.get('last_name') as string,
      personnummer: personnummer.replace(/\D/g, ''),
      employment_type: employmentType,
      employment_start: form.get('employment_start') as string,
      employment_end: form.get('employment_end') as string || undefined,
      employment_degree: parseFloat(form.get('employment_degree') as string) || 100,
      salary_type: salaryType,
      monthly_salary: salaryType === 'monthly' ? (parseFloat(form.get('monthly_salary') as string) || undefined) : undefined,
      hourly_rate: salaryType === 'hourly' ? (parseFloat(form.get('hourly_rate') as string) || undefined) : undefined,
      f_skatt_status: tax.f_skatt_status,
      is_sidoinkomst: tax.is_sidoinkomst,
      tax_table_number: tax.tax_table_number ?? undefined,
      tax_column: tax.tax_column,
      tax_municipality: tax.tax_municipality || undefined,
      email: form.get('email') as string || undefined,
      phone: form.get('phone') as string || undefined,
      address_line1: form.get('address_line1') as string || undefined,
      postal_code: form.get('postal_code') as string || undefined,
      city: form.get('city') as string || undefined,
      clearing_number: form.get('clearing_number') as string || undefined,
      bank_account_number: form.get('bank_account_number') as string || undefined,
      vacation_rule: vacationRule,
      vacation_days_per_year: parseInt(form.get('vacation_days_per_year') as string) || 25,
      // Always sent — {} means no default dimensions.
      default_dimensions: dimensions,
    }

    const res = await fetch('/api/salary/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (res.ok) {
      toast({ title: t('new_created') })
      router.push('/salary/employees')
    } else {
      const result = await res.json()
      toast({
        title: t('new_create_failed'),
        description: getErrorMessage(result, { context: 'salary', statusCode: res.status }),
        variant: 'destructive',
      })
    }

    setSaving(false)
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/salary/employees" aria-label={t('form_back_to_employees')}><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <h1 className="font-display text-2xl md:text-3xl tracking-tight">{t('new_title')}</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Personal info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('form_personal_info')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="first_name">{t('form_first_name')}<RequiredMark /></Label>
                <Input id="first_name" name="first_name" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last_name">{t('form_last_name')}<RequiredMark /></Label>
                <Input id="last_name" name="last_name" required />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="personnummer">{t('new_personnummer_label')}<RequiredMark /></Label>
                <Input
                  id="personnummer"
                  name="personnummer"
                  placeholder={t('new_personnummer_placeholder')}
                  required
                  maxLength={13}
                  value={personnummer}
                  onChange={(e) => setPersonnummer(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t('new_personnummer_hint')}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">{t('form_email')}</Label>
                <Input id="email" name="email" type="email" />
                <p className="text-xs text-muted-foreground">{t('form_email_hint')}</p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">{t('form_phone')}</Label>
              <Input id="phone" name="phone" className="max-w-xs" />
            </div>
          </CardContent>
        </Card>

        {/* Address */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('form_address')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="address_line1">{t('form_street_address')}</Label>
              <Input id="address_line1" name="address_line1" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="postal_code">{t('form_postal_code')}</Label>
                <Input id="postal_code" name="postal_code" className="max-w-[160px]" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">{t('form_city')}</Label>
                <Input id="city" name="city" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Employment */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('form_employment')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="employment_type">{t('form_employment_type')}</Label>
                <Select value={employmentType} onValueChange={setEmploymentType}>
                  <SelectTrigger id="employment_type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">{t('form_employment_type_employee')}</SelectItem>
                    <SelectItem value="company_owner">{t('form_employment_type_company_owner')}</SelectItem>
                    <SelectItem value="board_member">{t('form_employment_type_board_member')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="employment_start">{t('form_employment_start')}<RequiredMark /></Label>
                <Input id="employment_start" name="employment_start" type="date" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="employment_end">{t('form_employment_end')}</Label>
                <Input id="employment_end" name="employment_end" type="date" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="employment_degree">{t('form_employment_degree')}</Label>
                <Input id="employment_degree" name="employment_degree" type="number" defaultValue="100" min="1" max="100" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Salary */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('form_salary')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="salary_type">{t('form_salary_type')}<RequiredMark /></Label>
                <Select value={salaryType} onValueChange={setSalaryType}>
                  <SelectTrigger id="salary_type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">{t('form_salary_type_monthly')}</SelectItem>
                    <SelectItem value="hourly">{t('form_salary_type_hourly')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {salaryType === 'monthly' ? (
                <div className="space-y-2">
                  <Label htmlFor="monthly_salary">{t('form_monthly_salary')}<RequiredMark /></Label>
                  <Input id="monthly_salary" name="monthly_salary" type="number" step="1" min="1" required />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="hourly_rate">{t('form_hourly_rate')}<RequiredMark /></Label>
                  <Input id="hourly_rate" name="hourly_rate" type="number" step="0.01" min="0.01" required />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Default dimensions (kostnadsställe/projekt) */}
        {dimensionsEnabled && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('form_dimensions_title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <LineDimensionFields dimensions={dimensions} onChange={setDimension} />
              <p className="text-xs text-muted-foreground">
                {t('form_dimensions_hint')}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Tax */}
        <EmployeeTaxCard personnummer={personnummer} onChange={setTax} />

        {/* Vacation */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('form_vacation')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="vacation_rule">{t('form_vacation_rule')}</Label>
                <Select value={vacationRule} onValueChange={setVacationRule}>
                  <SelectTrigger id="vacation_rule">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="procentregeln">{t('form_vacation_rule_procentregeln')}</SelectItem>
                    <SelectItem value="sammaloneregeln">{t('form_vacation_rule_sammaloneregeln')}</SelectItem>
                    <SelectItem value="semesterersattning">{t('form_vacation_rule_semesterersattning')}</SelectItem>
                    <SelectItem value="none">{t('form_vacation_rule_none')}</SelectItem>
                  </SelectContent>
                </Select>
                {vacationRule === 'none' && (
                  <p className="text-xs text-muted-foreground">
                    {t('new_vacation_none_hint')}
                  </p>
                )}
                {vacationRule === 'semesterersattning' && (
                  <p className="text-xs text-muted-foreground">
                    {t('form_vacation_semesterersattning_hint')}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="vacation_days_per_year">{t('form_vacation_days')}</Label>
                <Input id="vacation_days_per_year" name="vacation_days_per_year" type="number" min="25" max="40" defaultValue="25" />
                <p className="text-xs text-muted-foreground">{t('form_vacation_days_hint')}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Bank */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('form_bank_account')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="clearing_number">{t('form_clearing_number')}</Label>
                <Input id="clearing_number" name="clearing_number" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bank_account_number">{t('form_account_number')}</Label>
                <Input id="bank_account_number" name="bank_account_number" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">{t('form_bank_hint')}</p>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Button variant="outline" asChild>
            <Link href="/salary/employees">{t('form_cancel')}</Link>
          </Button>
          <Button type="submit" disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? t('form_saving') : t('form_save')}
          </Button>
        </div>
      </form>
    </div>
  )
}
