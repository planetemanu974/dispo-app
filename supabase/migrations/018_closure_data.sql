-- ─────────────────────────────────────────────────────────────────────────────
-- 018_closure_data.sql
-- Enriches the post-flight closure with per-passenger data and payment groups.
--
-- Changes:
--   • bookings.closure_data JSONB — full closure detail (pilots, types, groups)
--   • bookings.payment_method — add 'check' to the allowed set
--   • bookings.invoice_type   — add 'custom' to the allowed set
--
-- closure_data shape:
-- {
--   "passengers": [
--     { "id": "<uuid>", "actual_pilot": "Capitaine", "actual_flight_type": "discovery" }
--   ],
--   "payment_groups": [
--     {
--       "passenger_ids": ["<uuid>"],
--       "method": "cash",           -- 'cash' | 'check' | 'wero'
--       "invoice": "none",          -- 'none' | 'single' | 'each'
--       "payer_name": "Jean Dupont",
--       "invoice_number": null,     -- set when invoice = 'single'
--       "invoice_numbers": null     -- [{passenger_id, number}] when invoice = 'each'
--     }
--   ]
-- }
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add the new JSONB closure column
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS closure_data jsonb DEFAULT NULL;

-- 2. Widen payment_method to accept 'check' (chèque)
--    The old constraint only allowed card | cash | wero.
--    We drop and recreate it so existing data is preserved.
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_payment_method_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_payment_method_check
    CHECK (payment_method IN ('card', 'cash', 'check', 'wero'));

-- 3. Widen invoice_type to accept 'custom' (rich closure_data-driven invoicing)
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_invoice_type_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_invoice_type_check
    CHECK (invoice_type IN ('none', 'single', 'individual', 'custom'));

-- 4. GIN index on closure_data for future invoice archive queries
CREATE INDEX IF NOT EXISTS bookings_closure_data_gin
  ON public.bookings USING GIN (closure_data)
  WHERE closure_data IS NOT NULL;
