-- Allow re-using a supplier_invoice_number once the original has been credited.
--
-- Before: idx_supplier_invoices_company_supplier_number was UNIQUE on
-- (company_id, supplier_id, supplier_invoice_number) WHERE supplier_invoice_number IS NOT NULL.
-- A credited original kept its row in the table with the original number, so any attempt
-- to re-enter the corrected invoice under the same number from the same supplier was
-- rejected by Postgres (23505). The user-facing symptom: HTTP 500 with no recovery path.
--
-- After: the partial index also excludes status='credited'. The credit row itself uses
-- a "KREDIT-..." prefixed number so it never collides. The credited original remains in
-- the table for audit-trail purposes (its journal entry is retained; the credit's reversal
-- entry continues to net it out at the GL layer), but it no longer reserves the number.
--
-- This matches Swedish accounting practice: when a supplier re-issues a corrected invoice,
-- it commonly carries the same number, and the bookkeeping system must accept that without
-- forcing the user to invent a synthetic number.

DROP INDEX IF EXISTS public.idx_supplier_invoices_company_supplier_number;

CREATE UNIQUE INDEX idx_supplier_invoices_company_supplier_number
  ON public.supplier_invoices (company_id, supplier_id, supplier_invoice_number)
  WHERE supplier_invoice_number IS NOT NULL
    AND status <> 'credited';

NOTIFY pgrst, 'reload schema';
