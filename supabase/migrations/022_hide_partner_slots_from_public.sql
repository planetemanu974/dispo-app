-- 022_hide_partner_slots_from_public.sql
-- When the main pilot is hired by another structure (booking made in "Collègue / structure"
-- mode, ref 'COL-…'), his own school does not operate on that slot: it must no longer be
-- offered to public customers on the booking page.
--
-- The original view is kept as public_slot_availability_base; the public name now points to
-- a filtered view. Safe to run twice.
DO $$
BEGIN
  IF to_regclass('public.public_slot_availability_base') IS NULL THEN
    ALTER VIEW public.public_slot_availability RENAME TO public_slot_availability_base;
  END IF;
END $$;

CREATE OR REPLACE VIEW public.public_slot_availability AS
SELECT b.*
FROM public.public_slot_availability_base b
WHERE NOT EXISTS (
  SELECT 1
  FROM public.bookings bk
  WHERE bk.pilot_slot_id = b.id
    AND bk.booking_ref LIKE 'COL-%'
    AND bk.status IN ('pending', 'confirmed')
);

GRANT SELECT ON public.public_slot_availability TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
