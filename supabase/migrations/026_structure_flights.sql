-- ─────────────────────────────────────────────────────────────────────────────
-- 026_structure_flights.sql
-- Lets a structure (colleague, not a direct pilot) see on its planning the flights it has booked
-- with the pilot, shown with its logo. Returns ONLY that structure's own bookings
-- (booking_ref 'COL-…' whose contact name = the structure's name): date, time, status, number of
-- passengers and the logo. No client names, phones or prices.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_structure_flights(
  p_colleague_id uuid,
  p_start_date   date,
  p_end_date     date
)
RETURNS TABLE (slot_date date, slot_time time, status text, pax int, logo_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ps.slot_date,
         ps.slot_time,
         b.status,
         GREATEST(1, (SELECT count(*) FROM public.passengers p WHERE p.booking_id = b.id))::int,
         c.logo_url
  FROM public.colleagues c
  JOIN public.pilot_slots ps ON ps.pilot_id = c.pilot_id
  JOIN public.bookings b     ON b.pilot_slot_id = ps.id
  WHERE c.id = p_colleague_id
    AND NOT COALESCE(c.is_direct, false)
    AND b.booking_ref LIKE 'COL-%'
    AND lower(trim(b.contact_name)) = lower(trim(c.name))
    AND b.status IN ('pending', 'confirmed')
    AND ps.slot_date BETWEEN p_start_date AND p_end_date
  ORDER BY ps.slot_date, ps.slot_time;
$$;

GRANT EXECUTE ON FUNCTION public.get_structure_flights(uuid, date, date) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
