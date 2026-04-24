-- Update anonymize_user_account to also remove bankid_identities.
--
-- bankid_identities.user_id has ON DELETE CASCADE against auth.users, but
-- account deletion anonymizes (bans) the auth.users row instead of deleting
-- it — the cascade never fires. Previously this left orphaned BankID
-- bindings linked to banned tombstone users. We now delete the row inside
-- the RPC so a "deleted" account no longer has a BankID attached.

CREATE OR REPLACE FUNCTION public.anonymize_user_account(target_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  blocker_count int;
BEGIN
  IF auth.uid() IS DISTINCT FROM target_user_id THEN
    RAISE EXCEPTION 'Can only delete your own account';
  END IF;

  SELECT count(*) INTO blocker_count
  FROM public.company_members cm
  JOIN public.companies c ON c.id = cm.company_id
  WHERE cm.user_id = target_user_id
    AND cm.role = 'owner'
    AND c.archived_at IS NULL;

  IF blocker_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete account: user still owns % active compan(y/ies)', blocker_count
      USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.company_members   WHERE user_id = target_user_id;
  DELETE FROM public.team_members      WHERE user_id = target_user_id;
  DELETE FROM public.bankid_identities WHERE user_id = target_user_id;

  DELETE FROM public.user_preferences WHERE user_id = target_user_id;
  DELETE FROM public.api_keys         WHERE user_id = target_user_id;

  UPDATE public.profiles
     SET email         = NULL,
         full_name     = NULL,
         avatar_url    = NULL,
         deleted_at    = now(),
         anonymized_at = now(),
         updated_at    = now()
   WHERE id = target_user_id;
END;
$function$;
