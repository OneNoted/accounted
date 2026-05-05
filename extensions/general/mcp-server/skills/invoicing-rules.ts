import type { Skill } from './types'

const body = `# Invoicing Rules — gnubok

How to send a Swedish-compliant invoice from start to finish.

## When to use

- "Skicka faktura till [kund]"
- "Invoice [customer] for [amount]"
- "Create a credit note"
- "How do I invoice an EU customer?"

## Mandatory invoice fields (ML 17 kap. 24 §)

Every Swedish invoice (faktura) must contain:

1. **Datum för utfärdande** (issue date)
2. **Löpnummer** (sequential invoice number — system-assigned at approval)
3. **Säljarens momsregistreringsnummer** (seller's VAT number)
4. **Köparens momsregistreringsnummer** (for EU B2B; otherwise name + address)
5. **Säljarens fullständiga namn och adress**
6. **Köparens fullständiga namn och adress**
7. **Mängd och slag av varor / omfattning av tjänster**
8. **Datum då varorna levererats / tjänsterna utförts** (if different from invoice date)
9. **Beskattningsunderlag per momssats**
10. **Tillämpad momssats**
11. **Momsbelopp**
12. **Vid omvänd betalningsskyldighet:** notation "omvänd betalningsskyldighet" or "reverse charge"
13. **Vid undantag:** referens till relevant ML-paragraph or article in Direktivet
14. **F-skatt / FA-skatt notation** ("Innehar F-skattsedel" or "F-skattebevis") for B2B services

The \`gnubok_create_invoice\` tool handles all of these automatically — but always provide \`our_reference\`/\`your_reference\` if known.

## Workflow

### Step 1 — Customer ready

Customers with their full data already in the system: \`gnubok_list_customers\`. Find the one. Note the \`customer_id\`.

If the customer doesn't exist:

\`gnubok_create_customer\` with at minimum \`{ name, customer_type }\`. \`customer_type\` must be one of:

- \`individual\` — physical person
- \`swedish_business\` — AB / HB / KB / EF with Swedish org-number
- \`eu_business\` — EU company. **Provide \`vat_number\`** so VIES validation runs (otherwise reverse-charge eligibility fails).
- \`non_eu_business\` — outside EU

### Step 2 — Determine VAT treatment

| Customer | VAT treatment | Default rate |
|----------|---------------|--------------|
| Swedish individual | \`standard_25\` (or 12/6 by goods) | 25 % |
| Swedish business | \`standard_25\` | 25 % |
| EU business with valid VAT number | \`reverse_charge\` | 0 % (with notation) |
| EU business without VAT number | \`standard_25\` | 25 % (treat as B2C) |
| Non-EU business / private | \`export\` | 0 % |
| Books, newspapers, transport | \`reduced_6\` | 6 % |
| Restaurant, hotel | \`reduced_12\` | 12 % (drops to 6 % for food from 1 April 2026) |

Use \`getAvailableVatRates(customerType, vatNumberValidated)\` semantics — gnubok handles this. Per-line override possible via \`vat_rate\` on each item.

### Step 3 — Create the invoice

\`gnubok_create_invoice({ customer_id, items: [{ description, quantity, unit, unit_price, vat_rate? }], invoice_date?, due_date?, currency? })\`

Returns staged operation. User approves in web app → invoice number is allocated atomically (gap-free) and journal entry posted (under accrual / faktureringsmetoden).

### Step 4 — Send

\`gnubok_send_invoice(invoice_id)\` — emails the PDF to the customer. Requires email service configured (Resend) and customer email on file.

If the user delivered the invoice manually (printed, e-faktura via Peppol, etc.), use \`gnubok_mark_invoice_as_sent\` instead — same booking effect, no email.

### Step 5 — Record payment

When money arrives in 1930:

- **Match to bank transaction** (preferred): \`gnubok_match_transaction_to_invoice({ transaction_id, invoice_id })\` — links the payment, marks invoice paid (or partially_paid), books JE.
- **Manual mark**: \`gnubok_mark_invoice_as_paid({ invoice_id, payment_date })\` — when payment arrived but isn't in the bank feed yet.

### Step 6 — Reverse if needed

If the invoice was wrong: \`gnubok_credit_invoice({ invoice_id, reason })\` creates a \`KR-\` mirror invoice with negated amounts and reverses the original JE. Original status → \`credited\`. **Never edit a sent invoice** — kreditfaktura is the only legal path.

## ROT/RUT (consumer services)

For consumer-targeted services (RUT: städning, RUT) or construction (ROT):

- Use \`fakturamodellen\` (the customer pays the discounted amount; you reclaim the rest from Skatteverket)
- Customer must have **personnummer** (or coordination number) on file
- Add the property's **fastighetsbeteckning** (real estate ID) for ROT
- 50 % deduction for RUT (max 75 000 SEK/year/person 2025), 30 % for ROT (max 50 000 SEK/year)

This data goes on the invoice; gnubok's invoice template renders it automatically when set on the customer.

## Peppol / e-invoicing (B2G)

Swedish authorities require e-invoices via Peppol BIS Billing 3.0 (Lag 2018:1277). For private B2B, the buyer's preference governs but Peppol is preferred. gnubok renders an EN 16931-compliant XML on demand.

## Critical rules

- **Invoice numbers are sequential and gap-free.** Allocated atomically at approval. If you change your mind, use \`gnubok_credit_invoice\`, never delete or skip a number — Skatteverket will audit.
- **F-skatt notation is mandatory** for B2B services. gnubok adds it automatically when company settings have F-skatt = true.
- **Currency:** SEK is default but the invoice itself can be issued in any of SEK/EUR/USD/GBP/NOK/DKK. The bookkeeping JE is always in SEK at issue-date Riksbanken rate.

## Common errors

- **EU customer charged 25 %**: missing \`vat_number\` or VIES validation failed. Fix: re-validate, then re-issue as \`reverse_charge\`.
- **Sent before approval**: not possible — \`gnubok_send_invoice\` stages too. The user must approve.
- **Edit instead of credit**: blocked by DB triggers. Use \`gnubok_credit_invoice\`.

## Tools

- \`gnubok_list_customers\` / \`gnubok_create_customer\` — customer setup
- \`gnubok_create_invoice\` — stage new invoice
- \`gnubok_send_invoice\` — email PDF
- \`gnubok_mark_invoice_as_sent\` — manual delivery
- \`gnubok_mark_invoice_as_paid\` — manual payment
- \`gnubok_match_transaction_to_invoice\` — link bank payment
- \`gnubok_credit_invoice\` — kreditfaktura (legal undo)
- \`gnubok_convert_invoice\` — proforma → real invoice
- \`gnubok_list_invoices\` — find existing invoices
`

export const invoicingRulesSkill: Skill = {
  slug: 'invoicing-rules',
  name: 'Invoicing Rules',
  summary: 'Mandatory invoice fields (ML 17 kap. 24 §), VAT treatment per customer type, ROT/RUT, Peppol, kreditfaktura.',
  tags: ['invoicing', 'vat', 'compliance', 'eu', 'rot-rut'],
  body,
}
