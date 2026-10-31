-- Gift vouchers, part 2: booking with a voucher, postponement and "lost" status.
--   paid    → client has the voucher, valid until expires_at (6 months)
--   booked  → the client booked a flight with it (a no-show loses the voucher)
--   used    → flight done (pilot taps "Vol effectué")
--   lost    → pilot decided the voucher is gone (no-show, expired)
-- If the pilot postpones a flight (weather), he sets extended_until (default +45 days from today).

ALTER TABLE public.gift_vouchers DROP CONSTRAINT IF EXISTS gift_vouchers_status_check;
ALTER TABLE public.gift_vouchers ADD CONSTRAINT gift_vouchers_status_check
  CHECK (status IN ('pending','paid','booked','used','lost','cancelled'));

ALTER TABLE public.gift_vouchers
  ADD COLUMN IF NOT EXISTS booking_id     uuid,
  ADD COLUMN IF NOT EXISTS booked_at      timestamptz,
  ADD COLUMN IF NOT EXISTS extended_until timestamptz;

-- Vouchers never include photo / video any more
UPDATE public.gift_vouchers SET media_pack = 'none' WHERE media_pack <> 'none';

-- Public check used by /reservation?bon=CODE: no personal data, only what the client needs to see.
CREATE OR REPLACE FUNCTION public.check_gift_voucher(p_code text)
RETURNS TABLE (state text, flight_label text, to_name text, valid_until timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    CASE
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

-- Attach a valid voucher to a booking (atomic: row locked, one use only).
CREATE OR REPLACE FUNCTION public.redeem_gift_voucher(p_code text, p_booking_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.gift_vouchers;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE id = p_booking_id) THEN RETURN 'no_booking'; END IF;
  SELECT * INTO v FROM public.gift_vouchers WHERE code = upper(trim(p_code)) FOR UPDATE;
  IF NOT FOUND THEN RETURN 'invalid'; END IF;
  IF v.status <> 'paid' THEN RETURN 'not_available'; END IF;
  IF now() > greatest(v.expires_at, coalesce(v.extended_until, v.expires_at)) THEN RETURN 'expired'; END IF;
  UPDATE public.gift_vouchers SET status = 'booked', booking_id = p_booking_id, booked_at = now() WHERE id = v.id;
  RETURN 'ok';
END $$;
REVOKE ALL ON FUNCTION public.redeem_gift_voucher(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.redeem_gift_voucher(text, uuid) TO anon, authenticated;
