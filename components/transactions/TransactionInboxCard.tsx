'use client'

import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DataListRow,
  DataListPrimary,
  DataListMeta,
  DataListMetaSeparator,
} from '@/components/ui/data-list'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import {
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  FileText,
  Loader2,
  MoreHorizontal,
  Trash2,
} from 'lucide-react'
import { getAccountName, formatAccountWithName } from '@/lib/bookkeeping/client-account-names'
import { getTemplateById } from '@/lib/bookkeeping/booking-templates'
import { isCounterpartyTemplateId } from '@/lib/bookkeeping/counterparty-templates'
import { TransactionAttachmentIndicator } from './TransactionAttachmentIndicator'
import type { TransactionWithInvoice, CategorizeHandler } from './transaction-types'
import type { SuggestedCategory, SuggestedTemplate } from '@/lib/transactions/category-suggestions'

interface TransactionInboxCardProps {
  transaction: TransactionWithInvoice
  suggestions?: SuggestedCategory[]
  templateSuggestions?: SuggestedTemplate[]
  /** When set, this bank tx looks like the bank side of a 1930↔1630
   *  transfer that the user will later see on /skattekonto. */
  skvCounterpartDate?: string
  processingId: string | null
  isBatchMode: boolean
  isSelected: boolean
  entityType?: string
  onCategorize: CategorizeHandler
  onMarkPrivate: (id: string) => void
  onOpenMatchDialog: (transaction: TransactionWithInvoice) => void
  onOpenCategoryDialog: (transaction: TransactionWithInvoice) => void
  onDelete?: (id: string) => void
  onOpenQuickReview?: (transaction: TransactionWithInvoice, suggestion: SuggestedCategory) => void
  onOpenTemplateReview?: (transaction: TransactionWithInvoice, templateId: string) => void
  onToggleSelect: (id: string) => void
  onAnimationComplete?: (id: string) => void
}

export default function TransactionInboxCard({
  transaction,
  suggestions,
  templateSuggestions,
  skvCounterpartDate,
  processingId,
  isBatchMode,
  isSelected,
  onCategorize,
  onOpenMatchDialog,
  onOpenCategoryDialog,
  onDelete,
  onOpenQuickReview,
  onOpenTemplateReview,
  onToggleSelect,
  onAnimationComplete,
}: TransactionInboxCardProps) {
  const isProcessing = processingId === transaction.id
  const isDisabled = processingId !== null && processingId !== transaction.id
  const isIncome = transaction.amount > 0
  const hasInvoiceMatch = !!transaction.potential_invoice && !transaction.invoice_id
  const hasSupplierInvoiceMatch = !!transaction.potential_supplier_invoice && !transaction.supplier_invoice_id
  const topSuggestion = suggestions?.[0]
  const topTemplate = templateSuggestions?.[0]
  const alternateTemplates = templateSuggestions?.slice(1, 4) ?? []
  const isUncategorized = transaction.is_business === null && !transaction.journal_entry_id
  const showCheckbox = isBatchMode && isUncategorized
  const isDeletable = !transaction.journal_entry_id

  function handleSuggestionClick(suggestion: SuggestedCategory) {
    if (onOpenQuickReview) {
      onOpenQuickReview(transaction, suggestion)
    } else {
      onCategorize(transaction.id, true, suggestion.category)
    }
  }

  function handleTemplateClick(templateId: string) {
    if (onOpenTemplateReview) {
      onOpenTemplateReview(transaction, templateId)
    } else if (topSuggestion) {
      handleSuggestionClick(topSuggestion)
    }
  }

  // Decide the single primary action button shown in the trailing slot.
  const primaryAction = (() => {
    if (hasInvoiceMatch) {
      return (
        <Button
          size="sm"
          variant="default"
          className="h-8 px-3 text-xs"
          onClick={(e) => {
            e.stopPropagation()
            onOpenMatchDialog(transaction)
          }}
          disabled={isProcessing || isDisabled}
        >
          {isProcessing ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <FileText className="mr-1 h-3 w-3" />
          )}
          Matcha {transaction.potential_invoice!.invoice_number}
        </Button>
      )
    }
    if (hasSupplierInvoiceMatch) {
      return (
        <Button
          size="sm"
          variant="default"
          className="h-8 px-3 text-xs"
          onClick={(e) => {
            e.stopPropagation()
            onOpenMatchDialog(transaction)
          }}
          disabled={isProcessing || isDisabled}
        >
          {isProcessing ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <FileText className="mr-1 h-3 w-3" />
          )}
          Matcha {transaction.potential_supplier_invoice!.supplier_invoice_number}
        </Button>
      )
    }
    if (topTemplate) {
      const isCounterparty = isCounterpartyTemplateId(topTemplate.template_id)
      return (
        <Button
          size="sm"
          variant="default"
          className="h-8 px-3 text-xs"
          onClick={(e) => {
            e.stopPropagation()
            const tmpl = isCounterparty ? null : getTemplateById(topTemplate.template_id)
            if (isCounterparty || tmpl) {
              handleTemplateClick(topTemplate.template_id)
            }
          }}
          disabled={isProcessing || isDisabled}
        >
          {isProcessing && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          {topTemplate.name_sv}
        </Button>
      )
    }
    if (topSuggestion) {
      return (
        <Button
          size="sm"
          variant="default"
          className="h-8 px-3 text-xs"
          onClick={(e) => {
            e.stopPropagation()
            handleSuggestionClick(topSuggestion)
          }}
          disabled={isProcessing || isDisabled}
        >
          {isProcessing && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          {topSuggestion.label}
        </Button>
      )
    }
    return (
      <Button
        size="sm"
        variant="default"
        className="h-8 px-3 text-xs"
        onClick={(e) => {
          e.stopPropagation()
          onOpenCategoryDialog(transaction)
        }}
        disabled={isProcessing || isDisabled}
      >
        Bokför
      </Button>
    )
  })()

  // Suggestion text for the meta line (what the primary button will do).
  const primaryHint = (() => {
    if (hasInvoiceMatch) return null // primary already names the invoice
    if (hasSupplierInvoiceMatch) return null
    if (topTemplate) {
      const isCounterparty = isCounterpartyTemplateId(topTemplate.template_id)
      const tmpl = isCounterparty ? null : getTemplateById(topTemplate.template_id)
      const detail = isCounterparty
        ? topTemplate.description_sv
        : getAccountName(tmpl?.debit_account || topTemplate.debit_account)
      return detail ? `Förslag: ${detail}` : null
    }
    if (topSuggestion?.account) {
      const conf =
        topSuggestion.confidence >= 0.8 ? ` · ${Math.round(topSuggestion.confidence * 100)}%` : ''
      return `Förslag: ${formatAccountWithName(topSuggestion.account)}${conf}`
    }
    return null
  })()

  const hasOverflow =
    isDeletable || alternateTemplates.length > 0 || hasInvoiceMatch || hasSupplierInvoiceMatch || topTemplate || topSuggestion

  const row = (
    <DataListRow
      data-tx-id={transaction.id}
      selected={isSelected}
      className={cn(isDisabled && 'opacity-50')}
      onClick={showCheckbox ? () => onToggleSelect(transaction.id) : undefined}
      leading={
        showCheckbox ? (
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelect(transaction.id)}
            onClick={(e) => e.stopPropagation()}
            aria-label="Välj transaktion"
          />
        ) : (
          <span
            className={cn(
              'inline-flex h-5 w-5 items-center justify-center text-muted-foreground',
              isIncome ? 'text-success' : 'text-foreground/60'
            )}
            aria-hidden
          >
            {isIncome ? (
              <ArrowUpRight className="h-4 w-4" />
            ) : (
              <ArrowDownRight className="h-4 w-4" />
            )}
          </span>
        )
      }
      trailing={
        <>
          <div className="text-right">
            <p
              className={cn(
                'font-medium tabular-nums leading-none',
                isIncome && 'text-success'
              )}
            >
              {isIncome ? '+' : ''}
              {formatCurrency(transaction.amount, transaction.currency)}
            </p>
            {transaction.currency !== 'SEK' && transaction.amount_sek != null && (
              <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                {formatCurrency(transaction.amount_sek)}
              </p>
            )}
          </div>
          {!isBatchMode && primaryAction}
          {!isBatchMode && hasOverflow && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground"
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Fler alternativ"
                  disabled={isProcessing || isDisabled}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[14rem]">
                {alternateTemplates.length > 0 && (
                  <>
                    <DropdownMenuLabel>Andra mallar</DropdownMenuLabel>
                    {alternateTemplates.map((ts) => (
                      <DropdownMenuItem
                        key={ts.template_id}
                        onSelect={() => handleTemplateClick(ts.template_id)}
                      >
                        {ts.name_sv}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem onSelect={() => onOpenCategoryDialog(transaction)}>
                  Välj mall…
                </DropdownMenuItem>
                {isDeletable && onDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => onDelete(transaction.id)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Ta bort
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </>
      }
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <DataListPrimary>{transaction.description}</DataListPrimary>
        <TransactionAttachmentIndicator documentId={transaction.document_id} />
      </div>
      <DataListMeta>
        <span className="tabular-nums">{formatDate(transaction.date)}</span>
        {primaryHint && (
          <>
            <DataListMetaSeparator />
            <span className="truncate max-w-[28ch]">{primaryHint}</span>
          </>
        )}
        {skvCounterpartDate && (
          <>
            <DataListMetaSeparator />
            <Badge variant="warning" className="h-4 gap-1 px-1.5 py-0 text-[10px]">
              <AlertCircle className="h-3 w-3" />
              Möjlig 1930↔1630
            </Badge>
          </>
        )}
      </DataListMeta>
    </DataListRow>
  )

  return (
    <motion.div
      layout
      initial={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97, x: -16 }}
      transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
      onAnimationComplete={(definition) => {
        if (typeof definition === 'object' && 'opacity' in definition && definition.opacity === 0) {
          onAnimationComplete?.(transaction.id)
        }
      }}
    >
      {row}
    </motion.div>
  )
}
