'use client'

import { useTranslations } from 'next-intl'
import { useState, useCallback, useRef, type ChangeEvent } from 'react'
import { Loader2, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import { INVOICE_FONT_FAMILIES } from '@/lib/invoices/branding-constants'
import { getErrorMessage as getUserErrorMessage } from '@/lib/errors/get-error-message'
import type { CompanySettings, InvoiceFontFamily } from '@/types'

interface PdfPrintSettingsProps {
  settings: CompanySettings
  onUpdate: (updates: Partial<CompanySettings>) => void
}

export function PdfPrintSettings({ settings, onUpdate }: PdfPrintSettingsProps) {
  const t = useTranslations('settings_pdf_print')
  const { toast } = useToast()
  const [lateFeeText, setLateFeeText] = useState(settings.invoice_late_fee_text || '')
  const [creditTermsText, setCreditTermsText] = useState(settings.invoice_credit_terms_text || '')
  const [isSavingFont, setIsSavingFont] = useState(false)
  const [isUploadingFont, setIsUploadingFont] = useState(false)
  const [isDeletingFont, setIsDeletingFont] = useState(false)
  const fontInputRef = useRef<HTMLInputElement>(null)

  const saveToggle = useCallback(async (field: string, value: boolean) => {
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      })
      if (!response.ok) throw new Error()
      onUpdate({ [field]: value } as Partial<CompanySettings>)
    } catch {
      toast({ title: t('toast_save_failed'), variant: 'destructive' })
    }
  }, [onUpdate, toast, t])

  const savePosition = useCallback(async (value: 'header' | 'footer') => {
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_company_name_position: value }),
      })
      if (!response.ok) throw new Error()
      onUpdate({ invoice_company_name_position: value })
    } catch {
      toast({ title: t('toast_save_failed'), variant: 'destructive' })
    }
  }, [onUpdate, toast, t])

  const saveText = useCallback(async (field: string, value: string) => {
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value || null }),
      })
      if (!response.ok) throw new Error()
      onUpdate({ [field]: value || null } as Partial<CompanySettings>)
    } catch {
      toast({ title: t('toast_save_failed'), variant: 'destructive' })
    }
  }, [onUpdate, toast, t])

  const saveFont = useCallback(async (fontFamily: InvoiceFontFamily) => {
    setIsSavingFont(true)
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_font_family: fontFamily }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || t('toast_save_failed'))
      onUpdate({ invoice_font_family: fontFamily })
    } catch (error) {
      toast({
        title: t('toast_save_failed'),
        description: error instanceof Error ? getUserErrorMessage(error) : undefined,
        variant: 'destructive',
      })
    } finally {
      setIsSavingFont(false)
    }
  }, [onUpdate, toast, t])

  async function uploadFont(file: File) {
    setIsUploadingFont(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch('/api/settings/invoice-font', {
        method: 'POST',
        body: formData,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || t('font_upload_failed'))
      onUpdate(result.data as Partial<CompanySettings>)
    } catch (error) {
      toast({
        title: t('font_upload_failed'),
        description: error instanceof Error ? getUserErrorMessage(error) : undefined,
        variant: 'destructive',
      })
    } finally {
      setIsUploadingFont(false)
      if (fontInputRef.current) fontInputRef.current.value = ''
    }
  }

  async function deleteFont() {
    setIsDeletingFont(true)
    try {
      const response = await fetch('/api/settings/invoice-font', { method: 'DELETE' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || t('font_delete_failed'))
      onUpdate(result.data as Partial<CompanySettings>)
    } catch (error) {
      toast({
        title: t('font_delete_failed'),
        description: error instanceof Error ? getUserErrorMessage(error) : undefined,
        variant: 'destructive',
      })
    } finally {
      setIsDeletingFont(false)
    }
  }

  function handleFontChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) void uploadFont(file)
  }

  const fontLabels: Record<InvoiceFontFamily, string> = {
    Helvetica: t('font_helvetica'),
    'Times-Roman': t('font_times'),
    Courier: t('font_courier'),
    'Source Sans 3': t('font_source_sans'),
    'Source Serif 4': t('font_source_serif'),
    Custom: t('font_custom'),
  }

  return (
    <section className="space-y-6">
      <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
        {t('heading')}
      </h2>

      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="invoice_font_family">{t('font_label')}</Label>
          <p className="text-xs text-muted-foreground">{t('font_help')}</p>
        </div>
        <Select
          value={settings.invoice_font_family ?? 'Helvetica'}
          onValueChange={(value) => {
            if (value) void saveFont(value as InvoiceFontFamily)
          }}
          disabled={isSavingFont || isUploadingFont || isDeletingFont}
        >
          <SelectTrigger id="invoice_font_family" className="max-w-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INVOICE_FONT_FAMILIES
              .filter((family) => family !== 'Custom' || settings.invoice_custom_font_path)
              .map((family) => (
                <SelectItem key={family} value={family}>
                  {fontLabels[family]}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => fontInputRef.current?.click()}
            disabled={isUploadingFont || isDeletingFont}
          >
            {isUploadingFont ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            {settings.invoice_custom_font_path ? t('font_replace') : t('font_upload')}
          </Button>
          {settings.invoice_custom_font_path && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => void deleteFont()}
              disabled={isUploadingFont || isDeletingFont}
              className="text-muted-foreground hover:text-destructive"
            >
              {isDeletingFont ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              {t('font_remove')}
            </Button>
          )}
        </div>
        {settings.invoice_custom_font_name && (
          <p className="text-xs text-muted-foreground">
            {t('font_uploaded_name', { name: settings.invoice_custom_font_name })}
          </p>
        )}
        <p className="text-xs text-muted-foreground">{t('font_file_help')}</p>
        <input
          ref={fontInputRef}
          type="file"
          accept=".ttf,.woff,font/ttf,font/woff"
          className="hidden"
          onChange={handleFontChange}
        />
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label>{t('ore_rounding_label')}</Label>
            <p className="text-xs text-muted-foreground">{t('ore_rounding_help')}</p>
          </div>
          <Switch
            checked={settings.ore_rounding ?? true}
            onCheckedChange={(v) => saveToggle('ore_rounding', v)}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label>{t('show_ocr_label')}</Label>
            <p className="text-xs text-muted-foreground">{t('show_ocr_help')}</p>
          </div>
          <Switch
            checked={settings.invoice_show_ocr ?? true}
            onCheckedChange={(v) => saveToggle('invoice_show_ocr', v)}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label>{t('show_bankgiro_label')}</Label>
            <p className="text-xs text-muted-foreground">{t('show_bankgiro_help')}</p>
          </div>
          <Switch
            checked={settings.invoice_show_bankgiro ?? true}
            onCheckedChange={(v) => saveToggle('invoice_show_bankgiro', v)}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label>{t('show_plusgiro_label')}</Label>
            <p className="text-xs text-muted-foreground">{t('show_plusgiro_help')}</p>
          </div>
          <Switch
            checked={settings.invoice_show_plusgiro ?? true}
            onCheckedChange={(v) => saveToggle('invoice_show_plusgiro', v)}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label>{t('show_swish_label')}</Label>
            <p className="text-xs text-muted-foreground">{t('show_swish_help')}</p>
          </div>
          <Switch
            checked={settings.invoice_show_swish ?? false}
            onCheckedChange={(v) => saveToggle('invoice_show_swish', v)}
            aria-label={t('show_swish_label')}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label>{t('show_logo_label')}</Label>
            <p className="text-xs text-muted-foreground">{t('show_logo_help')}</p>
          </div>
          <Switch
            checked={settings.invoice_show_logo ?? true}
            onCheckedChange={(v) => saveToggle('invoice_show_logo', v)}
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label>{t('show_company_name_label')}</Label>
              <p className="text-xs text-muted-foreground">{t('show_company_name_help')}</p>
            </div>
            <Switch
              checked={settings.invoice_show_company_name ?? true}
              onCheckedChange={(v) => saveToggle('invoice_show_company_name', v)}
            />
          </div>
          {(settings.invoice_show_company_name ?? true) && (
            <div className="flex items-center justify-between pl-0">
              <p className="text-xs text-muted-foreground">{t('placement_label')}</p>
              <div
                role="group"
                aria-label={t('placement_aria_label')}
                className="inline-flex rounded-md border border-border p-1"
              >
                {(['header', 'footer'] as const).map((pos) => {
                  const active = (settings.invoice_company_name_position ?? 'header') === pos
                  return (
                    <button
                      key={pos}
                      type="button"
                      aria-pressed={active}
                      onClick={() => savePosition(pos)}
                      className={
                        'h-10 px-4 text-sm rounded-sm transition-colors ' +
                        (active
                          ? 'bg-muted text-foreground'
                          : 'text-muted-foreground hover:text-foreground')
                      }
                    >
                      {pos === 'header' ? t('placement_header') : t('placement_footer')}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4 pt-2">
        <div className="space-y-2">
          <Label htmlFor="invoice_late_fee_text">{t('late_fee_label')}</Label>
          <Textarea
            id="invoice_late_fee_text"
            rows={2}
            placeholder={t('late_fee_placeholder')}
            value={lateFeeText}
            onChange={(e) => setLateFeeText(e.target.value)}
            onBlur={() => saveText('invoice_late_fee_text', lateFeeText)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="invoice_credit_terms_text">{t('credit_terms_label')}</Label>
          <Textarea
            id="invoice_credit_terms_text"
            rows={2}
            placeholder={t('credit_terms_placeholder')}
            value={creditTermsText}
            onChange={(e) => setCreditTermsText(e.target.value)}
            onBlur={() => saveText('invoice_credit_terms_text', creditTermsText)}
          />
        </div>
      </div>

    </section>
  )
}
