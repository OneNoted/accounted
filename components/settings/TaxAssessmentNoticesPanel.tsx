'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CalendarClock, Pencil, Trash2 } from 'lucide-react'
import { FiscalYearSelector } from '@/components/common/FiscalYearSelector'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { useErrorToast } from '@/lib/hooks/use-error-toast'
import type {
  TaxAssessmentDecisionType,
  TaxAssessmentNotice,
} from '@/types'

function todayLocalIso(): string {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function TaxAssessmentNoticesPanel() {
  const t = useTranslations('tax_assessment_notices')
  const { toast } = useToast()
  const showError = useErrorToast()
  const [notices, setNotices] = useState<TaxAssessmentNotice[]>([])
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null)
  const [decisionType, setDecisionType] = useState<TaxAssessmentDecisionType>('final')
  const [decisionDate, setDecisionDate] = useState(todayLocalIso)
  const [paymentDueDate, setPaymentDueDate] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch('/api/tax-assessment-notices')
        if (!response.ok) {
          if (!cancelled) await showError(response, { context: 'settings' })
          return
        }
        const payload = await response.json() as { data: TaxAssessmentNotice[] }
        if (!cancelled) setNotices(payload.data)
      } catch (error) {
        if (!cancelled) await showError(error, { context: 'settings' })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  // The error helper is recreated with the toast hook. This load should run
  // once per panel mount, not after every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resetForm = () => {
    setEditingId(null)
    setDecisionType('final')
    setDecisionDate(todayLocalIso())
    setPaymentDueDate('')
  }

  const saveNotice = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedPeriodId || !paymentDueDate) return
    setSaving(true)
    try {
      const response = await fetch(
        editingId ? `/api/tax-assessment-notices/${editingId}` : '/api/tax-assessment-notices',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fiscal_period_id: selectedPeriodId,
            decision_type: decisionType,
            decision_date: decisionDate,
            payment_due_date: paymentDueDate,
          }),
        },
      )
      if (!response.ok) {
        await showError(response, { context: 'settings' })
        return
      }
      const payload = await response.json() as { data: TaxAssessmentNotice }
      setNotices((current) => {
        const withoutSaved = current.filter((notice) => notice.id !== payload.data.id)
        return [...withoutSaved, payload.data]
          .sort((a, b) => a.payment_due_date.localeCompare(b.payment_due_date))
      })
      toast({ title: t(editingId ? 'updated' : 'saved') })
      resetForm()
    } catch (error) {
      await showError(error, { context: 'settings' })
    } finally {
      setSaving(false)
    }
  }

  const editNotice = (notice: TaxAssessmentNotice) => {
    setEditingId(notice.id)
    setSelectedPeriodId(notice.fiscal_period_id)
    setDecisionType(notice.decision_type)
    setDecisionDate(notice.decision_date)
    setPaymentDueDate(notice.payment_due_date)
  }

  const archiveNotice = async (notice: TaxAssessmentNotice) => {
    setSaving(true)
    try {
      const response = await fetch(`/api/tax-assessment-notices/${notice.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      })
      if (!response.ok) {
        await showError(response, { context: 'settings' })
        return
      }
      setNotices((current) => current.filter((item) => item.id !== notice.id))
      if (editingId === notice.id) resetForm()
      toast({ title: t('archived') })
    } catch (error) {
      await showError(error, { context: 'settings' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="border-t border-border pt-8" aria-labelledby="tax-assessment-notices-title">
      <div className="max-w-3xl">
        <div className="flex items-start gap-3">
          <CalendarClock className="mt-0.5 h-5 w-5" />
          <div>
            <h2 id="tax-assessment-notices-title" className="font-display text-xl tracking-tight">
              {t('title')}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {t('description')}
            </p>
          </div>
        </div>

        <form onSubmit={saveNotice} className="mt-6 grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2 sm:p-6">
          <FiscalYearSelector
            value={selectedPeriodId}
            onChange={(periodId) => setSelectedPeriodId(periodId)}
            includeAllOption={false}
            label={t('fiscal_period')}
            className="sm:col-span-2"
          />
          <div className="space-y-1.5">
            <Label htmlFor="tax-assessment-decision-type">{t('decision_type')}</Label>
            <Select value={decisionType} onValueChange={(value) => setDecisionType(value as TaxAssessmentDecisionType)}>
              <SelectTrigger id="tax-assessment-decision-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="final">{t('decision_final')}</SelectItem>
                <SelectItem value="reassessment">{t('decision_reassessment')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tax-assessment-decision-date">{t('decision_date')}</Label>
            <Input
              id="tax-assessment-decision-date"
              type="date"
              required
              value={decisionDate}
              onChange={(event) => setDecisionDate(event.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="tax-assessment-payment-due-date">{t('payment_due_date')}</Label>
            <Input
              id="tax-assessment-payment-due-date"
              type="date"
              required
              min={decisionDate}
              value={paymentDueDate}
              onChange={(event) => setPaymentDueDate(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('payment_due_date_help')}</p>
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="submit" disabled={saving || !selectedPeriodId || !paymentDueDate}>
              {saving ? t('saving') : t(editingId ? 'update_action' : 'save_action')}
            </Button>
            {editingId && (
              <Button type="button" variant="ghost" onClick={resetForm} disabled={saving}>
                {t('cancel')}
              </Button>
            )}
          </div>
        </form>

        {!loading && notices.length > 0 && (
          <div className="mt-6 divide-y divide-border border-y border-border">
            {notices.map((notice) => (
              <div key={notice.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">
                    {notice.decision_type === 'final' ? t('decision_final') : t('decision_reassessment')}
                    {notice.fiscal_period?.name ? `: ${notice.fiscal_period.name}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('due_summary', { date: notice.payment_due_date })}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => editNotice(notice)} disabled={saving}>
                    <Pencil className="mr-2 h-4 w-4" />
                    {t('edit')}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => void archiveNotice(notice)} disabled={saving}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t('archive')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
