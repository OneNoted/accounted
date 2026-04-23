-- BFL compliance: replace hard-delete of uncredited credit notes with a soft-delete
-- status so that the row, its items, and its back-reference from the posted JE all
-- survive. BFL 7 kap requires räkenskapsinformation to be preserved in an unalterable
-- form for 7 years; BFL 5 kap 7§ implies ankomstnummer should be an unbroken series;
-- sambandskravet (BFL 4 kap 2§) requires verifikationer to remain traceable back to
-- their underlag. Hard-deleting the supplier_invoices row would break all three.
--
-- This migration mirrors the pattern used for journal_entries in
-- 20260319000001_add_cancelled_journal_status.sql.

-- 1. Expand status CHECK to include 'reversed'.
ALTER TABLE public.supplier_invoices
  DROP CONSTRAINT IF EXISTS supplier_invoices_status_check;
ALTER TABLE public.supplier_invoices
  ADD CONSTRAINT supplier_invoices_status_check
  CHECK (status IN (
    'registered',
    'approved',
    'paid',
    'partially_paid',
    'overdue',
    'disputed',
    'credited',
    'reversed'
  ));

-- 2. Add reversed_at timestamp for audit — when a credit note was storno-reversed.
ALTER TABLE public.supplier_invoices
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.supplier_invoices.reversed_at IS
  'Timestamp when a credit note was reversed via "Ångra kreditering". Pairs with status=''reversed''. Row itself is retained for BFL 7 kap compliance.';

-- 3. Extend the partial unique index to also exclude status='reversed'.
-- Without this, re-crediting the same original after an uncredit would collide on the
-- KREDIT-prefixed supplier_invoice_number of the previously-reversed credit note.
DROP INDEX IF EXISTS public.idx_supplier_invoices_company_supplier_number;

CREATE UNIQUE INDEX idx_supplier_invoices_company_supplier_number
  ON public.supplier_invoices (company_id, supplier_id, supplier_invoice_number)
  WHERE supplier_invoice_number IS NOT NULL
    AND status NOT IN ('credited', 'reversed');

NOTIFY pgrst, 'reload schema';
