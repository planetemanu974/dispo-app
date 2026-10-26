-- Add sms_name to pilots: the name shown in outgoing SMS to colleagues.
-- Separate from the display name ("Capitaine") used inside the app.
-- Example: "Planète Parapente", "PPR", etc.
ALTER TABLE public.pilots
  ADD COLUMN IF NOT EXISTS sms_name text NOT NULL DEFAULT '';
