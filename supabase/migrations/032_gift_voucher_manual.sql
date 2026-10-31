-- Gift vouchers, part 3: vouchers created by the pilot by phone (unpaid until the client pays).
-- An unpaid voucher is 'pending': it can never be used or booked, and says "pas réglé".

DROP POLICY IF EXISTS "gift_vouchers_pilot_insert" ON public.gift_vouchers;
CREATE POLICY "gift_vouchers_pilot_insert" ON public.gift_vouchers
  FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.pilots WHERE user_id = auth.uid()));

-- Same public check as before, plus an explicit 'unpaid' state.
CREATE OR REPLACE FUNCTION public.check_gift_voucher(p_code text)
RETURNS TABLE (state text, flight_label text, to_name text, valid_until timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    CASE
      WHEN v.status = 'pending' THEN 'unpaid'
      WHEN v.status = 'paid' AND now() <= greatest(v.expires_at, coalesce(v.extended_until, v.expires_at)) THEN 'valid'
      WHEN v.status = 'paid'   THEN 'expired'
      WHEN v.status = 'booked' THEN 'booked'
      WHEN v.status = 'used'   THEN 'used'
      ELSE 'invalid'
    END,
    v.flight_label, v.to_name,
    greatest(v.expires_at, coalesce(v.extended_until, v.expires_at))
  FROM public.gift_vouchers v
  WHERE v.code = upper(trim(p_code))
$$;
REVOKE ALL ON FUNCTION public.check_gift_voucher(text) FROM public;
GRANT EXECUTE ON FUNCTION public.check_gift_voucher(text) TO anon, authenticated;
