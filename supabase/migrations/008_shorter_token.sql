-- Shorten the default token to 10 hex characters (was 32)
-- This makes SMS links much shorter: /job/a1b2c3d4e5 instead of /job/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4
ALTER TABLE public.booking_assignments
  ALTER COLUMN token SET DEFAULT encode(gen_random_bytes(5), 'hex');
