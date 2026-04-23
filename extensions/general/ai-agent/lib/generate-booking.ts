/**
 * Booking proposal generator for the ai-agent extension.
 *
 * Takes a matched receipt + transaction and returns a balanced journal-entry
 * proposal in the BookingProposalPayload shape. Uses existing counterparty
 * templates as seeds in the prompt so recurring merchants converge fast.
 *
 * Returns an AIRequestResult when the LLM chooses to clarify (e.g.,
 * can't tell business vs private), or null on outage.
 *
 * Also verifies the proposed lines balance (sum debits = sum credits); when
 * the LLM returns unbalanced lines the result is degraded to a clarify ask
 * rather than being silently wrong.
 */

import {
  ConverseCommand,
  type ContentBlock,
  type Message,
} from '@aws-sdk/client-bedrock-runtime'
import { findFiscalPeriod } from '@/lib/bookkeeping/engine'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import type {
  AIRequestResult,
  BookingProposalResult,
  GenerateBookingContext,
} from '@/lib/ai/proposal-service'
import type {
  BookingProposalLine,
  BookingProposalCounterpartyTemplate,
  BookingProposalPayload,
  VatTreatment,
} from '@/types'
import { getBedrockClient, getModelId, getMaxTokens } from './bedrock-client'
import {
  BOOKING_PROMPT_VERSION,
  BOOKING_SYSTEM_PROMPT,
  BOOKING_TOOL_CONFIG,
} from './prompts/booking-prompt'

export async function generateBookingForExtension(
  ctx: GenerateBookingContext
): Promise<BookingProposalResult | AIRequestResult | null> {
  const serviceClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Resolve fiscal period for the transaction date — a prerequisite for any booking.
  const fiscalPeriodId = await findFiscalPeriod(
    serviceClient,
    ctx.companyId,
    ctx.matchedTransaction.date
  )

  if (!fiscalPeriodId) {
    return {
      kind: 'request',
      request: {
        request_type: 'needs_manual',
        message:
          'Ingen öppen räkenskapsperiod täcker transaktionens datum. Skapa perioden eller bokför manuellt.',
      },
      provenance: { prompt_version: BOOKING_PROMPT_VERSION },
    }
  }

  // Brief the LLM with receipt + transaction + relevant templates.
  const extracted = ctx.inboxItem.extracted_data as Record<string, unknown> | null
  const relevantTemplates = ctx.existingTemplates
    .filter((t) => t.is_active)
    .slice(0, 20)
    .map((t) => ({
      counterparty: t.counterparty_name,
      debit: t.debit_account,
      credit: t.credit_account,
      vat_treatment: t.vat_treatment,
      category: t.category,
      source: t.source,
      occurrences: t.occurrence_count,
    }))

  const userPrompt = `Kvittodata (extraherad):
${JSON.stringify(extracted, null, 2)}

Matchad banktransaktion:
${JSON.stringify(
  {
    id: ctx.matchedTransaction.id,
    date: ctx.matchedTransaction.date,
    description: ctx.matchedTransaction.description,
    amount: ctx.matchedTransaction.amount,
    amount_sek: ctx.matchedTransaction.amount_sek,
    currency: ctx.matchedTransaction.currency,
    merchant_name: ctx.matchedTransaction.merchant_name,
  },
  null,
  2
)}

Företagstyp: ${ctx.entityType}

Befintliga motpartsmallar (upp till 20):
${JSON.stringify(relevantTemplates, null, 2)}

Föreslå ett balanserat verifikat. Transaktionens belopp är bruttobeloppet som betalas från 1930.`

  const messages: Message[] = [{ role: 'user', content: [{ text: userPrompt }] }]

  let response
  try {
    response = await getBedrockClient().send(
      new ConverseCommand({
        modelId: getModelId(),
        messages,
        system: [{ text: BOOKING_SYSTEM_PROMPT }],
        toolConfig: BOOKING_TOOL_CONFIG,
        inferenceConfig: { maxTokens: getMaxTokens(), temperature: 0 },
      })
    )
  } catch (err) {
    console.error('[ai-agent/booking] Bedrock call failed:', err)
    return null
  }

  const usage = {
    input_tokens: response.usage?.inputTokens ?? 0,
    output_tokens: response.usage?.outputTokens ?? 0,
  }

  const toolUse = response.output?.message?.content?.find(
    (b): b is ContentBlock.ToolUseMember => 'toolUse' in b && b.toolUse !== undefined
  )

  if (!toolUse?.toolUse?.input) return null

  const raw = toolUse.toolUse.input as Record<string, unknown>
  const action = raw.action === 'clarify_business_private' ? 'clarify_business_private' : 'propose'
  const confidence = clampConfidence(Number(raw.confidence))
  const reasoning = typeof raw.reasoning === 'string' ? raw.reasoning.trim() : ''

  if (action === 'clarify_business_private') {
    return {
      kind: 'request',
      request: {
        request_type: 'clarify_business_private',
        message:
          typeof raw.clarify_message === 'string' && raw.clarify_message.trim().length > 0
            ? raw.clarify_message.trim()
            : 'Är detta en affärsutgift eller privat?',
        required_fields: { is_business: 'boolean' },
      },
      provenance: {
        model: getModelId(),
        prompt_version: BOOKING_PROMPT_VERSION,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
      },
    }
  }

  const proposalRaw = raw.proposal as Record<string, unknown> | null | undefined
  if (!proposalRaw) {
    return null
  }

  const lines = extractLines(proposalRaw.lines)
  const vatTreatment = extractVatTreatment(proposalRaw.vat_treatment)
  const defaultPrivate = Boolean(proposalRaw.default_private)
  const counterpartyTpl = extractCounterpartyTemplate(proposalRaw.counterparty_template_proposal)

  // Safety: the engine will reject an unbalanced entry. Catch it early and
  // degrade to clarify rather than forwarding a broken proposal.
  if (!linesBalanced(lines)) {
    return {
      kind: 'request',
      request: {
        request_type: 'needs_manual',
        message:
          'AI:n producerade ett obalanserat verifikat — bokför manuellt så dokumenteras det korrekt.',
      },
      provenance: {
        model: getModelId(),
        prompt_version: BOOKING_PROMPT_VERSION,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
      },
    }
  }

  const payload: BookingProposalPayload = {
    lines,
    vat_treatment: vatTreatment,
    default_private: defaultPrivate,
    counterparty_template_proposal: counterpartyTpl,
    fiscal_period_id: fiscalPeriodId,
    entry_date: ctx.matchedTransaction.date,
    description: buildDescription(ctx),
  }

  return {
    kind: 'proposal',
    proposal: payload,
    confidence,
    reasoning,
    provenance: {
      model: getModelId(),
      prompt_version: BOOKING_PROMPT_VERSION,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
    },
  }
}

function clampConfidence(raw: number): number {
  if (!isFinite(raw)) return 0
  return Math.min(1, Math.max(0, raw / 100))
}

function extractLines(raw: unknown): BookingProposalLine[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => item as Record<string, unknown>)
    .filter((item) => typeof item.account_number === 'string')
    .map((item) => ({
      account_number: String(item.account_number),
      debit_amount: Number(item.debit_amount) || 0,
      credit_amount: Number(item.credit_amount) || 0,
      description: typeof item.description === 'string' ? item.description : '',
    }))
}

function extractVatTreatment(raw: unknown): VatTreatment | null {
  const allowed: VatTreatment[] = [
    'standard_25',
    'reduced_12',
    'reduced_6',
    'reverse_charge',
    'export',
    'exempt',
  ]
  if (typeof raw !== 'string') return null
  return (allowed as string[]).includes(raw) ? (raw as VatTreatment) : null
}

function extractCounterpartyTemplate(
  raw: unknown
): BookingProposalCounterpartyTemplate | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (
    typeof r.counterparty_name !== 'string' ||
    typeof r.debit_account !== 'string' ||
    typeof r.credit_account !== 'string'
  ) {
    return null
  }
  return {
    counterparty_name: r.counterparty_name,
    debit_account: r.debit_account,
    credit_account: r.credit_account,
    vat_treatment: extractVatTreatment(r.vat_treatment),
    category:
      typeof r.category === 'string' && r.category.length > 0
        ? (r.category as BookingProposalCounterpartyTemplate['category'])
        : null,
  }
}

function linesBalanced(lines: BookingProposalLine[]): boolean {
  if (lines.length < 2) return false
  const totalDebit = lines.reduce((sum, l) => sum + l.debit_amount, 0)
  const totalCredit = lines.reduce((sum, l) => sum + l.credit_amount, 0)
  return Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0
}

function buildDescription(ctx: GenerateBookingContext): string {
  const merchant =
    ctx.matchedTransaction.merchant_name ||
    ctx.matchedTransaction.description ||
    'Okänd handlare'
  return `AI-förslag: ${merchant}`
}
