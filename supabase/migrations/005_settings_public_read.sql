-- ============================================================
-- Allow anonymous (unauthenticated) reads on settings table
-- Required for the public booking page (/reservation) to load
-- dynamic flight types, time slots and school name without auth.
--
-- Only non-sensitive data is stored here (flight labels, colors,
-- slot times) — no accounting, no personal data, no planning.
-- ============================================================

CREATE POLICY "settings_select_anon" ON public.settings
  FOR SELECT TO anon USING (true);
