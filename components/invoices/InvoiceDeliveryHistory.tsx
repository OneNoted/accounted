'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { ExternalLink, Mail, Send } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import type { InvoiceDelivery } from '@/types'

export type InvoiceDeliveryView = Pick<
  InvoiceDelivery,
  | 'id'
  | 'channel'
  | 'to_addresses'
  | 'cc_addresses'
  | 'bcc_addresses'
  | 'reply_to'
  | 'from_name'
  | 'subject'
  | 'body_text'
  | 'provider'
  | 'error_code'
  | 'document_attachment_id'
  | 'attachment_filename'
  | 'sent_at'
  | 'failed_at'
  | 'created_at'
> & {
  status: 'pending' | 'sent' | 'failed' | 'marked_sent'
}

interface InvoiceDeliveryHistoryProps {
  deliveries: InvoiceDeliveryView[]
  showLegacyEmptyState: boolean
}

const statusVariant = {
  pending: 'secondary',
  sent: 'success',
  failed: 'destructive',
  marked_sent: 'outline',
} as const

export function InvoiceDeliveryHistory({
  deliveries,
  showLegacyEmptyState,
}: InvoiceDeliveryHistoryProps) {
  const t = useTranslations('invoice_detail')
  const format = useFormatter()

  if (deliveries.length === 0 && !showLegacyEmptyState) return null

  const formatTimestamp = (value: string) =>
    format.dateTime(new Date(value), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          {t('delivery_history_title')}
        </CardTitle>
        <CardDescription>{t('delivery_history_description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {deliveries.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{t('delivery_history_legacy_title')}</p>
            <p className="mt-1">{t('delivery_history_legacy_description')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {deliveries.map((delivery) => {
              const occurredAt = delivery.sent_at || delivery.failed_at || delivery.created_at
              const isManual = delivery.channel === 'manual'

              return (
                <details key={delivery.id} className="group rounded-lg border bg-card">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                      {isManual ? <Send className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {isManual ? t('delivery_channel_manual') : t('delivery_channel_email')}
                      </span>
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        {formatTimestamp(occurredAt)}
                      </span>
                    </span>
                    <Badge variant={statusVariant[delivery.status]}>
                      {t(`delivery_status_${delivery.status}`)}
                    </Badge>
                  </summary>

                  <div className="px-4 pb-4">
                    <Separator className="mb-4" />
                    {isManual ? (
                      <p className="text-sm text-muted-foreground">
                        {t('delivery_manual_unknown_details')}
                      </p>
                    ) : (
                      <div className="space-y-4 text-sm">
                        <dl className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
                          <dt className="text-muted-foreground">{t('delivery_to_label')}</dt>
                          <dd className="break-words">{delivery.to_addresses.join(', ')}</dd>
                          {delivery.cc_addresses.length > 0 && (
                            <>
                              <dt className="text-muted-foreground">{t('delivery_cc_label')}</dt>
                              <dd className="break-words">{delivery.cc_addresses.join(', ')}</dd>
                            </>
                          )}
                          {delivery.bcc_addresses.length > 0 && (
                            <>
                              <dt className="text-muted-foreground">{t('delivery_bcc_label')}</dt>
                              <dd className="break-words">{delivery.bcc_addresses.join(', ')}</dd>
                            </>
                          )}
                          {delivery.reply_to && (
                            <>
                              <dt className="text-muted-foreground">{t('delivery_reply_to_label')}</dt>
                              <dd className="break-words">{delivery.reply_to}</dd>
                            </>
                          )}
                          {delivery.from_name && (
                            <>
                              <dt className="text-muted-foreground">{t('delivery_from_label')}</dt>
                              <dd className="break-words">{delivery.from_name}</dd>
                            </>
                          )}
                          {delivery.subject && (
                            <>
                              <dt className="text-muted-foreground">{t('delivery_subject_label')}</dt>
                              <dd className="break-words">{delivery.subject}</dd>
                            </>
                          )}
                        </dl>

                        {delivery.body_text && (
                          <div className="space-y-2">
                            <p className="text-muted-foreground">{t('delivery_message_label')}</p>
                            <p className="whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/30 p-4">
                              {delivery.body_text}
                            </p>
                          </div>
                        )}

                        {delivery.document_attachment_id && (
                          <Button asChild variant="outline" size="sm" className="max-w-full">
                            <a
                              href={`/api/documents/${delivery.document_attachment_id}/inline`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <ExternalLink className="mr-2 h-4 w-4" />
                              <span className="truncate">
                                {t('delivery_open_pdf', {
                                  filename: delivery.attachment_filename || t('delivery_pdf_fallback'),
                                })}
                              </span>
                            </a>
                          </Button>
                        )}

                        {(delivery.provider || delivery.error_code) && (
                          <dl className="grid gap-2 border-t pt-3 text-xs text-muted-foreground sm:grid-cols-[8rem_minmax(0,1fr)]">
                            {delivery.provider && (
                              <>
                                <dt>{t('delivery_provider_label')}</dt>
                                <dd>{delivery.provider}</dd>
                              </>
                            )}
                            {delivery.error_code && (
                              <>
                                <dt>{t('delivery_error_label')}</dt>
                                <dd>{delivery.error_code}</dd>
                              </>
                            )}
                          </dl>
                        )}
                      </div>
                    )}
                  </div>
                </details>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
