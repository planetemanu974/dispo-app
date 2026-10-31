-- 027_colleague_logo_rpc.sql
-- A structure's own logo, for the header of its planning page (/dispo). Returns only the logo of
-- that structure (not a direct pilot), nothing else.
CREATE OR REPLACE FUNCTION public.get_colleague_logo(p_colleague_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.logo_url FROM public.colleagues c
  WHERE c.id = p_colleague_id AND NOT COALESCE(c.is_direct, false);
$$;

GRANT EXECUTE ON FUNCTION public.get_colleague_logo(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
