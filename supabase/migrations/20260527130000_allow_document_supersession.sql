-- Restore document version supersession on posted entries.
--
-- Background: 20260506150000 extended enforce_document_metadata_immutability
-- to also block changes to journal_entry_id, journal_entry_line_id, AND
-- is_current_version when the document is linked to a posted/reversed entry.
-- The journal_entry_id / line_id additions are correct — they close a real
-- BFL 7 kap 2§ bypass (UPDATE journal_entry_id = NULL → DELETE).
--
-- The is_current_version addition was overreach: the create_document_version
-- RPC must flip the OLD row from is_current_version = true to false (and
-- set superseded_by_id) as part of the legitimate WORM-compliant supersession
-- flow. Every replace attempt on a doc linked to a posted verifikat now
-- raises "Cannot modify metadata or journal entry link of document linked
-- to a posted journal entry (BFL 7 kap)" — which surfaces in the Bilagor
-- modal as "Kunde inte ladda upp ny version".
--
-- This blocks the only path users have to fix corrupt underlag: a PDF that
-- was uploaded with bad bytes (e.g. via the MCP server before magic-byte
-- validation landed in 20260526) is now permanently unreadable on a posted
-- entry, with no replacement possible.
--
-- Fix: introduce a transaction-local gnubok.allow_supersede GUC mirroring
-- the existing gnubok.allow_delete pattern used by delete_last_voucher.
-- create_document_version sets it before the supersession UPDATE; ad-hoc
-- UPDATEs from application code do not, so the immutability check still
-- protects against tampering.

CREATE OR REPLACE FUNCTION public.enforce_document_metadata_immutability()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_entry_status text;
BEGIN
  IF current_setting('gnubok.allow_delete', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF current_setting('gnubok.allow_supersede', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF OLD.journal_entry_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status INTO v_entry_status
  FROM public.journal_entries
  WHERE id = OLD.journal_entry_id;

  IF v_entry_status IS NULL OR v_entry_status NOT IN ('posted', 'reversed') THEN
    RETURN NEW;
  END IF;

  IF NEW.file_name              IS DISTINCT FROM OLD.file_name
     OR NEW.storage_path        IS DISTINCT FROM OLD.storage_path
     OR NEW.file_size_bytes     IS DISTINCT FROM OLD.file_size_bytes
     OR NEW.mime_type           IS DISTINCT FROM OLD.mime_type
     OR NEW.sha256_hash         IS DISTINCT FROM OLD.sha256_hash
     OR NEW.upload_source       IS DISTINCT FROM OLD.upload_source
     OR NEW.digitization_date   IS DISTINCT FROM OLD.digitization_date
     OR NEW.uploaded_by         IS DISTINCT FROM OLD.uploaded_by
     OR NEW.version             IS DISTINCT FROM OLD.version
     OR NEW.original_id         IS DISTINCT FROM OLD.original_id
     OR NEW.is_current_version  IS DISTINCT FROM OLD.is_current_version
     OR NEW.journal_entry_id    IS DISTINCT FROM OLD.journal_entry_id
     OR NEW.journal_entry_line_id IS DISTINCT FROM OLD.journal_entry_line_id
  THEN
    INSERT INTO public.audit_log (user_id, company_id, action, table_name, record_id, description)
    VALUES (OLD.user_id, OLD.company_id, 'SECURITY_EVENT', 'document_attachments', OLD.id,
      'Blocked metadata or link modification of document linked to ' || v_entry_status || ' entry ' || OLD.journal_entry_id);

    RAISE EXCEPTION 'Cannot modify metadata or journal entry link of document linked to a % journal entry (BFL 7 kap)', v_entry_status;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_document_version(
  p_user_id uuid,
  p_original_doc_id uuid,
  p_storage_path text,
  p_file_name text,
  p_file_size_bytes bigint,
  p_mime_type text,
  p_sha256_hash text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current document_attachments%ROWTYPE;
  v_new_id uuid;
  v_root_id uuid;
  v_next_version integer;
BEGIN
  SELECT * INTO v_current
  FROM public.document_attachments
  WHERE id = p_original_doc_id
    AND is_current_version = true
  FOR UPDATE;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Document % not found or is not the current version', p_original_doc_id;
  END IF;

  v_root_id := COALESCE(v_current.original_id, v_current.id);
  v_next_version := v_current.version + 1;

  INSERT INTO public.document_attachments (
    user_id, company_id, storage_path, file_name, file_size_bytes,
    mime_type, sha256_hash, version, original_id, is_current_version,
    uploaded_by, upload_source, digitization_date,
    journal_entry_id, journal_entry_line_id, prev_version_hash
  ) VALUES (
    p_user_id, v_current.company_id, p_storage_path, p_file_name,
    p_file_size_bytes, p_mime_type, p_sha256_hash, v_next_version,
    v_root_id, true, p_user_id, v_current.upload_source, now(),
    v_current.journal_entry_id, v_current.journal_entry_line_id,
    v_current.sha256_hash
  )
  RETURNING id INTO v_new_id;

  PERFORM set_config('gnubok.allow_supersede', 'true', true);

  UPDATE public.document_attachments
  SET is_current_version = false,
      superseded_by_id = v_new_id
  WHERE id = p_original_doc_id;

  RETURN v_new_id;
END;
$function$;

NOTIFY pgrst, 'reload schema';
