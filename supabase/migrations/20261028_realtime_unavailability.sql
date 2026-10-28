-- Enable Supabase Realtime on fixed_pilot_unavailability so the admin
-- dashboard receives live INSERT events when a pilot marks themselves unavailable.
-- Without this, the table is not in the realtime publication and the channel
-- subscription fires no events.

ALTER PUBLICATION supabase_realtime ADD TABLE fixed_pilot_unavailability;
