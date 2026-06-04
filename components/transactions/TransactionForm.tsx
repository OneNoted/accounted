'use client'

import { useEffect, useMemo } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format, parseISO, isValid } from 'date-fns'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import type { CreateTransactionInput, Currency } from '@/types'

interface TransactionFormProps {
  onSubmit: (data: CreateTransactionInput) => Promise<void>
  isLoading: boolean
}

const currencies: Currency[] = ['SEK', 'EUR', 'USD', 'GBP', 'NOK', 'DKK']

export default function TransactionForm({ onSubmit, isLoading }: TransactionFormProps) {
  const t = useTranslations('tx_form')
  const schema = useMemo(
    () =>
      z.object({
        date: z
          .string()
          .min(1, t('date_required'))
          // Native <input type="date"> normally emits 'YYYY-MM-DD', but its
          // year subfield accepts up to 6 digits — over-typing produces
          // '202403-02-05' (year 202403), which Postgres stores happily and
          // which then crashes every date formatter. Require a 4-digit year
          // and a real, in-range calendar date.
          .refine((s) => {
            if (!s) return true // empty handled by .min above
            if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
            const d = parseISO(s)
            return isValid(d) && d.getFullYear() >= 1900 && d.getFullYear() <= 2100
          }, t('date_invalid')),
        description: z.string().min(1, t('description_required')),
        amount: z.number().refine((n) => n !== 0, t('amount_required')),
        currency: z.enum(['SEK', 'EUR', 'USD', 'GBP', 'NOK', 'DKK']),
        notes: z.string().optional(),
      }),
    [t]
  )
  type FormData = z.infer<typeof schema>
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      date: '',
      description: '',
      amount: 0,
      currency: 'SEK',
      notes: '',
    },
  })

  // Set date default on client only to avoid hydration mismatch
  useEffect(() => {
    setValue('date', format(new Date(), 'yyyy-MM-dd'))
  }, [])

  const onFormSubmit = (data: FormData) => {
    onSubmit({
      date: data.date,
      description: data.description,
      amount: data.amount,
      currency: data.currency,
      notes: data.notes,
    })
  }

  return (
    <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="date">{t('date_label')}</Label>
          <Input id="date" type="date" min="1900-01-01" max="2100-12-31" {...register('date')} />
          {errors.date && (
            <p className="text-sm text-destructive">{errors.date.message}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="currency">{t('currency_label')}</Label>
          <Controller
            name="currency"
            control={control}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currencies.map((currency) => (
                    <SelectItem key={currency} value={currency}>
                      {currency}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">{t('description_label')}</Label>
        <Input
          id="description"
          placeholder={t('description_placeholder')}
          {...register('description')}
        />
        {errors.description && (
          <p className="text-sm text-destructive">{errors.description.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="amount">{t('amount_label')}</Label>
        <Input
          id="amount"
          type="number"
          step="0.01"
          placeholder={t('amount_placeholder')}
          {...register('amount', { valueAsNumber: true })}
        />
        {errors.amount && (
          <p className="text-sm text-destructive">{errors.amount.message}</p>
        )}
        <p className="text-xs text-muted-foreground">
          {t('amount_help')}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">{t('notes_label')}</Label>
        <Textarea
          id="notes"
          placeholder={t('notes_placeholder')}
          {...register('notes')}
        />
      </div>

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t('saving')}
          </>
        ) : (
          t('save')
        )}
      </Button>
    </form>
  )
}
