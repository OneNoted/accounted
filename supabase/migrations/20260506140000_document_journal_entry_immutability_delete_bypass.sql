-- Regression fix: enforce_document_journal_entry_immutability (added in
-- 20260506130000) unconditionally blocks UPDATE document_attachments SET
-- journal_entry_id = NULL once the column has been set. delete_last_voucher
-- (RPC, schema_sync 4j) needs to perform exactly that clear before deleting
-- the journal entry, because document_attachments.journal_entry_id has an
-- ON DELETE RESTRICT FK to journal_entries(id). Without the clear, the
-- subsequent DELETE either fails on the FK or — in this case — fails on the
-- new trigger first, surfacing as BFL_DOCUMENT_IMMUTABILITY in production.
--
-- Mirror the bypass pattern that enforce_journal_entry_immutability,
-- enforce_journal_entry_line_immutability, and enforce_retention_journal_entries
-- already implement (see migration 20260428160000): allow the clear when the
-- transaction-scoped flag gnubok.allow_delete='true' is set. The flag is
-- LOCAL — it lives only for the current transaction — and is set only
-- inside delete_last_voucher, which already enforces every BFNAR 2013:2
-- precondition before setting it:
--   * caller is owner or admin of the company
--   * voucher is the last in its series (no later vouchers in the same
--     fiscal_period_id + voucher_series)
--   * fiscal period is open (not closed, not locked)
--   * no other entries reference this voucher via reverses_id or
--     correction_of_id
-- and writes a complete audit_log snapshot of the entry + lines before the
-- DELETE runs (audit_log is itself immutable per audit_log_no_update).
--
-- Compliance rationale:
--   * BFL 5 kap 6 § (verifikation must reference its underlag) — preserved.
--     Once the verifikation has been legitimately deleted under BFNAR 2013:2,
--     there is no verifikation left to point at. The document itself is not
--     deleted; only the back-reference is cleared so the FK no longer blocks
--     the DELETE. The document continues to exist on the bank transaction
--     and remains discoverable.
--   * BFL 7 kap (7-year retention of räkenskapsinformation) — preserved.
--     The document row itself stays in document_attachments, with its
--     storage_path, sha256_hash, version chain, and the existing WORM
--     guarantees (block_document_deletion). Detaching journal_entry_id
--     does not delete or alter the underlying document.
--   * BFL 5 kap 5 § (rättelse traceability) — preserved via the audit_log
--     snapshot written by delete_last_voucher before the DELETE.
--   * BFNAR 2013:2 explicitly allows deletion of the last voucher in a
--     series before presentation, which is the exact precondition the RPC
--     enforces.
--
-- Bypass scope, intentionally narrow:
--   * NULL clear (uuid → NULL) is allowed when the bypass flag is set.
--   * Swap to a different non-null journal_entry_id stays blocked even
--     with the flag set — that is never a legitimate operation.
--   * First-time set (NULL → uuid) stays unconditionally allowed (this is
--     the propagate path used by commitAttach and the supplier-invoice
--     handler to mark a document as räkenskapsinformation).

CREATE OR REPLACE FUNCTION public.enforce_document_journal_entry_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.journal_entry_id IS NOT DISTINCT FROM OLD.journal_entry_id THEN
    RETURN NEW;
  END IF;

  IF OLD.journal_entry_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.journal_entry_id IS NULL
     AND current_setting('gnubok.allow_delete', true) = 'true' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'BFL_DOCUMENT_IMMUTABILITY: cannot clear or change journal_entry_id on document % once set (BFL 5 kap 6 §). Reverse the journal entry first.',
    OLD.id;
END;
$$;

NOTIFY pgrst, 'reload schema';
