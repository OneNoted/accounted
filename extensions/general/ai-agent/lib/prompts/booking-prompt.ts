/**
 * Booking prompt — given an extracted receipt + matched transaction + any
 * existing counterparty templates, propose a complete journal entry.
 *
 * The v1 schema is deliberately narrow: standard expense with input VAT
 * (optional) paid from 1930. Reverse-charge / EU / import paths are out
 * of scope for the first receipts-only release; those still funnel to
 * manual via a clarify_business_private request if the LLM is unsure.
 */

import type { ToolConfiguration } from '@aws-sdk/client-bedrock-runtime'

export const BOOKING_PROMPT_VERSION = '2026-04-23-v1'

export const BOOKING_SYSTEM_PROMPT = `Du är en expert på svensk bokföring enligt BAS-kontoplanen. Du föreslår hur ett kvitto ska bokföras mot en matchad banktransaktion.

Indata:
- Extraherad kvittodata (handlare, belopp, moms, datum)
- Matchad banktransaktion (beskrivning, belopp, datum)
- Företagstyp (enskild firma eller aktiebolag)
- Befintliga mallar för samma motpart (om några)

Uppgift: föreslå ett balanserat verifikat (Debet = Kredit). Mönstret för en standardutgift med moms:
  Debet  5xxx/6xxx (kostnadskonto, nettobelopp)
  Debet  2641 Ingående moms (om standardmoms 25%, 12% eller 6%)
  Kredit 1930 Företagskonto (bruttobelopp)

Om privat uttag (enskild firma) — använd 2013 istället för kostnadskontot.

Riktlinjer:
- Välj lämpligt BAS-kostnadskonto utifrån typ av inköp (t.ex. 5410 IT-utrustning, 5611 Drivmedel, 5810 Representation)
- Momsavdrag: standard 25% → 2641, 12% → 2641, 6% → 2641. Sätt vat_treatment 'standard_25' / 'reduced_12' / 'reduced_6'.
- Om kvittot saknar momsspecifikation men är svensk handelsrelaterad — anta standard_25
- Om inköpet troligen är privat (t.ex. matvaror för hushåll, nöjen) och företagstyp = enskild firma — sätt default_private=true och använd 2013
- Representation: endast 50% moms avdragsgillt — för v1, föreslå utan reducering och flagga i reasoning att användaren bör kontrollera
- Om du är osäker på business vs private — returnera hellre ett ai_request av typ 'clarify_business_private' än att gissa

Resonera på svenska. Var konkret: vilket konto och varför.

Anropa ALLTID verktyget propose_booking med resultatet.`

export const BOOKING_TOOL_CONFIG: ToolConfiguration = {
  tools: [
    {
      toolSpec: {
        name: 'propose_booking',
        description: 'Returnera ett balanserat verifikatförslag eller en fråga till användaren',
        inputSchema: {
          json: {
            type: 'object',
            required: ['action', 'confidence', 'reasoning'],
            properties: {
              action: {
                type: 'string',
                enum: ['propose', 'clarify_business_private'],
                description:
                  'propose = konkret förslag. clarify_business_private = be användaren avgöra om privat/business.',
              },
              confidence: {
                type: 'integer',
                minimum: 0,
                maximum: 100,
              },
              reasoning: {
                type: 'string',
                description: '1-3 meningar på svenska som förklarar förslaget.',
              },
              proposal: {
                type: ['object', 'null'],
                description: 'Endast när action=propose.',
                required: ['lines', 'vat_treatment', 'default_private'],
                properties: {
                  lines: {
                    type: 'array',
                    minItems: 2,
                    items: {
                      type: 'object',
                      required: ['account_number', 'debit_amount', 'credit_amount', 'description'],
                      properties: {
                        account_number: {
                          type: 'string',
                          pattern: '^\\d{4}$',
                          description: '4-siffrigt BAS-kontonummer',
                        },
                        debit_amount: { type: 'number', minimum: 0 },
                        credit_amount: { type: 'number', minimum: 0 },
                        description: { type: 'string' },
                      },
                    },
                  },
                  vat_treatment: {
                    type: ['string', 'null'],
                    enum: [
                      'standard_25',
                      'reduced_12',
                      'reduced_6',
                      'reverse_charge',
                      'export',
                      'exempt',
                      null,
                    ],
                  },
                  default_private: {
                    type: 'boolean',
                    description: 'true för privat uttag (enskild firma 2013)',
                  },
                  counterparty_template_proposal: {
                    type: ['object', 'null'],
                    description:
                      'Föreslå en motpartsmall om handlaren är återkommande och bokföringsmönstret är tydligt.',
                    required: ['counterparty_name', 'debit_account', 'credit_account'],
                    properties: {
                      counterparty_name: { type: 'string' },
                      debit_account: { type: 'string', pattern: '^\\d{4}$' },
                      credit_account: { type: 'string', pattern: '^\\d{4}$' },
                      vat_treatment: {
                        type: ['string', 'null'],
                        enum: [
                          'standard_25',
                          'reduced_12',
                          'reduced_6',
                          'reverse_charge',
                          'export',
                          'exempt',
                          null,
                        ],
                      },
                      category: { type: ['string', 'null'] },
                    },
                  },
                },
              },
              clarify_message: {
                type: ['string', 'null'],
                description:
                  'Endast när action=clarify_business_private. Kort fråga på svenska till användaren.',
              },
            },
          },
        },
      },
    },
  ],
  toolChoice: { any: {} },
}
