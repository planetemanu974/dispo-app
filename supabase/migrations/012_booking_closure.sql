-- ─────────────────────────────────────────────────────────────────────────────
-- 012_booking_closure.sql
-- Post-flight closure workflow.
-- Adds columns to bookings so the pilot can record:
--   • which pilot actually flew (flew_pilot_name)
--   • how the client paid (payment_method)
--   • what kind of invoice was issued (invoice_type)
--   • the invoice reference number stored on the booking (invoice_number)
--   • timestamp when the flight was closed / invoiced (paid_at)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS flew_pilot_name  text,
  -- 'Capitaine' = the logged-in pilot; any other value = a colleague's name

  ADD COLUMN IF NOT EXISTS payment_method   text
    CHECK (payment_method IN ('card', 'cash', 'wero')),
  -- card = CB, wero = treated identically to card (electronic)
  -- cash = espèces

  ADD COLUMN IF NOT EXISTS invoice_type     text
    CHECK (invoice_type IN ('none', 'single', 'individual')),
  -- none       = no invoice requested
  -- single     = one invoice for the whole group (payer = contact)
  -- individual = one invoice per passenger (generated client-side)

  ADD COLUMN IF NOT EXISTS invoice_number   text,
  -- Stored only for 'single' invoices; format: DDMMYY/N (e.g. '261027/1')
  -- For 'individual', each passenger invoice gets a separate number (not stored here)

  ADD COLUMN IF NOT EXISTS paid_at          timestamptz;
  -- NULL = not yet closed; set to now() when pilot clicks "Clôturer"

-- Index for the pilot report (flights per pilot per month)
CREATE INDEX IF NOT EXISTS bookings_flew_pilot
  ON public.bookings (pilot_id, flew_pilot_name, paid_at)
  WHERE flew_pilot_name IS NOT NULL;
