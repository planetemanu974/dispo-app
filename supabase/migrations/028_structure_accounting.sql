-- ─────────────────────────────────────────────────────────────────────────────
-- 028_structure_accounting.sql
-- Accounting of the flights done for other structures (inside « Comptabilité »):
--   • structure_rates           price per flight (type + media pack) for each structure
--   • structure_flight_payments which flights a structure has paid
--   • structure_invoices        invoices issued per structure and month
--   • colleagues.email          where to send the invoice
-- Everything is private to the signed-in pilot (RLS), nothing is public.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.colleagues ADD COLUMN IF NOT EXISTS email text;

-- ── Rates ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.structure_rates (
  pilot_id      uuid        NOT NULL REFERENCES public.pilots(id) ON DELETE CASCADE,
  structure_key text        NOT NULL,          -- lower-cased structure name
  flight_key    text        NOT NULL,          -- '<flight_type_id>|<media_pack>'
  price_eur     numeric     NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pilot_id, structure_key, flight_key)
);
ALTER TABLE public.structure_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "structure_rates_pilot_all" ON public.structure_rates;
CREATE POLICY "structure_rates_pilot_all" ON public.structure_rates FOR ALL
  USING  (pilot_id = (SELECT id FROM public.pilots WHERE user_id = auth.uid()))
  WITH CHECK (pilot_id = (SELECT id FROM public.pilots WHERE user_id = auth.uid()));

-- ── Paid flights ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.structure_flight_payments (
  pilot_id    uuid        NOT NULL REFERENCES public.pilots(id) ON DELETE CASCADE,
  booking_id  uuid        NOT NULL,
  flight_key  text        NOT NULL,            -- id of the flight inside closure_data.pilot_flights
  paid_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (booking_id, flight_key)
);
ALTER TABLE public.structure_flight_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "structure_flight_payments_pilot_all" ON public.structure_flight_payments;
CREATE POLICY "structure_flight_payments_pilot_all" ON public.structure_flight_payments FOR ALL
  USING  (pilot_id = (SELECT id FROM public.pilots WHERE user_id = auth.uid()))
  WITH CHECK (pilot_id = (SELECT id FROM public.pilots WHERE user_id = auth.uid()));

-- ── Invoices ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.structure_invoices (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_id       uuid        NOT NULL REFERENCES public.pilots(id) ON DELETE CASCADE,
  structure_key  text        NOT NULL,
  structure_name text        NOT NULL,
  month          text        NOT NULL,         -- 'YYYY-MM'
  invoice_number text        NOT NULL,
  total_eur      numeric     NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pilot_id, structure_key, month),
  UNIQUE (pilot_id, invoice_number)
);
ALTER TABLE public.structure_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "structure_invoices_pilot_all" ON public.structure_invoices;
CREATE POLICY "structure_invoices_pilot_all" ON public.structure_invoices FOR ALL
  USING  (pilot_id = (SELECT id FROM public.pilots WHERE user_id = auth.uid()))
  WITH CHECK (pilot_id = (SELECT id FROM public.pilots WHERE user_id = auth.uid()));

NOTIFY pgrst, 'reload schema';
