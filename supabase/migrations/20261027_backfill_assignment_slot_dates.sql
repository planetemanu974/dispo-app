-- Backfill slot_date / slot_time on booking_assignments rows created by
-- the auto-assign (fixed pilots) path that did not include those columns.
-- The edge function pilot-planning filters on slot_date, so NULL values
-- meant those assignments were invisible on pilots' personal planning pages.

UPDATE booking_assignments ba
SET
  slot_date  = ps.slot_date,
  slot_time  = ps.slot_time
FROM bookings b
JOIN pilot_slots ps ON b.pilot_slot_id = ps.id
WHERE ba.booking_id = b.id
  AND ba.slot_date IS NULL;
