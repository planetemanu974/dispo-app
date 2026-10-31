-- Gift vouchers ("bons cadeaux").
-- Orders are created ONLY by Edge Functions (service role): the public never touches the table.
-- Public access is limited to one SECURITY DEFINER RPC that returns a PAID voucher from its secret token.

CREATE TABLE IF NOT EXISTS public.gift_vouchers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token              uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,   -- secret link of the buyer (download page)
  code               text NOT NULL UNIQUE,                             -- printed on the voucher, e.g. PP-7K3M-9QXD
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','paid','used','cancelled')),
  flight_type_id     text NOT NULL,
  flight_label       text NOT NULL,
  media_pack         text NOT NULL DEFAULT 'none' CHECK (media_pack IN ('none','photo','photo_video')),
  amount_eur         numeric(8,2) NOT NULL,
  design             text NOT NULL DEFAULT 'adult'
                       CHECK (design IN ('child','adult','colleague','birthday')),
  buyer_first_name   text NOT NULL,
  buyer_last_name    text NOT NULL,
  buyer_phone        text NOT NULL,
  buyer_email        text NOT NULL,
  from_name          text,
  to_name            text,
  message            text,
  desired_date       date,
  stripe_session_id  text UNIQUE,
  paid_at            timestamptz,
  used_at            timestamptz,
  expires_at         timestamptz,
  email_sent_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gift_vouchers ENABLE ROW LEVEL SECURITY;

-- Only logged-in pilots (the business owner and his team) can read / update vouchers.
DROP POLICY IF EXISTS "gift_vouchers_pilot_select" ON public.gift_vouchers;
CREATE POLICY "gift_vouchers_pilot_select" ON public.gift_vouchers
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.pilots WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "gift_vouchers_pilot_update" ON public.gift_vouchers;
CREATE POLICY "gift_vouchers_pilot_update" ON public.gift_vouchers
  FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.pilots WHERE user_id = auth.uid()));

-- Public RPC: the buyer opens /bon-cadeau/merci?t=<token>. Returns the voucher only once it is paid.
CREATE OR REPLACE FUNCTION public.get_gift_voucher(p_token uuid)
RETURNS TABLE (
  status text, code text, flight_label text, media_pack text, amount_eur numeric,
  design text, from_name text, to_name text, message text,
  desired_date date, expires_at timestamptz, buyer_email text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT v.status, v.code, v.flight_label, v.media_pack, v.amount_eur,
         v.design, v.from_name, v.to_name, v.message,
         v.desired_date, v.expires_at, v.buyer_email
  FROM public.gift_vouchers v
  WHERE v.token = p_token
$$;

REVOKE ALL ON FUNCTION public.get_gift_voucher(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_gift_voucher(uuid) TO anon, authenticated;
