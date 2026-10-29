-- 021_colleague_logo.sql
-- Logo of a structure / colleague, stored as a small data URL (resized client-side to <=160px).
-- Used on the planning slots instead of the structure name.
ALTER TABLE public.colleagues ADD COLUMN IF NOT EXISTS logo_url text;

NOTIFY pgrst, 'reload schema';
