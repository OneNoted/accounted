-- Harden check_and_increment_agent_quota against caller-chosen p_user_id.
--
-- The function is SECURITY DEFINER and lives in `public`, so PostgREST exposes
-- it at /rest/v1/rpc/check_and_increment_agent_quota with the default
-- EXECUTE-to-PUBLIC grant. p_user_id is a plain argument, and user ids are
-- discoverable through company_members, so any authenticated user could burn
-- down a colleague's minute/day budget and lock them out of every agent
-- endpoint for the rest of the day.
--
-- A plain REVOKE is not the fix here: all three callers (agent invoke,
-- onboarding stream, composer) call this with the user's own RLS client, so
-- revoking EXECUTE from `authenticated` would break the limiter itself and, as
-- it fails open on error, silently remove the spend cap it exists to enforce.
--
-- Instead the function now refuses to act for anyone other than the caller.
-- auth.uid() IS NULL means a service-role/superuser connection (cron, tests,
-- backend jobs) which already bypasses RLS entirely and is trusted; those keep
-- passing an explicit user id.
--
-- Function body is otherwise byte-identical to 20260526140000.

CREATE OR REPLACE FUNCTION public.check_and_increment_agent_quota(
  p_user_id    uuid,
  p_minute_max integer,
  p_day_max    integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_minute_key   text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI');
  v_day_key      text := to_char(now() AT TIME ZONE 'Europe/Stockholm', 'YYYY-MM-DD');
  v_minute_count integer;
  v_day_count    integer;
BEGIN
  -- Caller guard: an end user may only spend their own quota.
  IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'check_and_increment_agent_quota: p_user_id must be the calling user'
      USING ERRCODE = '42501';
  END IF;

  -- 1) Minute window — burst guard.
  INSERT INTO public.agent_rate_counters (user_id, window_kind, window_key, count)
  VALUES (p_user_id, 'minute', v_minute_key, 1)
  ON CONFLICT (user_id, window_kind, window_key)
  DO UPDATE SET count = agent_rate_counters.count + 1, updated_at = now()
  RETURNING count INTO v_minute_count;

  IF v_minute_count > p_minute_max THEN
    UPDATE public.agent_rate_counters SET count = count - 1
      WHERE user_id = p_user_id AND window_kind = 'minute' AND window_key = v_minute_key;
    RETURN jsonb_build_object('ok', false, 'scope', 'minute', 'retry_after_sec', 60);
  END IF;

  -- 2) Day window — slow-drip backstop (only checked once minute passes).
  INSERT INTO public.agent_rate_counters (user_id, window_kind, window_key, count)
  VALUES (p_user_id, 'day', v_day_key, 1)
  ON CONFLICT (user_id, window_kind, window_key)
  DO UPDATE SET count = agent_rate_counters.count + 1, updated_at = now()
  RETURNING count INTO v_day_count;

  IF v_day_count > p_day_max THEN
    -- Roll both counters back: the request didn't go through.
    UPDATE public.agent_rate_counters SET count = count - 1
      WHERE user_id = p_user_id AND window_kind = 'day' AND window_key = v_day_key;
    UPDATE public.agent_rate_counters SET count = count - 1
      WHERE user_id = p_user_id AND window_kind = 'minute' AND window_key = v_minute_key;
    RETURN jsonb_build_object('ok', false, 'scope', 'day', 'retry_after_sec', 3600);
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

NOTIFY pgrst, 'reload schema';
