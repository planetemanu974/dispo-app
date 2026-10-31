-- 025_delete_requests.sql
-- Let signed-in pilots permanently delete a callback request / help request from the dashboard.
CREATE POLICY "callback_requests_pilot_delete"
  ON public.callback_requests FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pilots WHERE user_id = auth.uid()));

CREATE POLICY "support_requests_pilot_delete"
  ON public.support_requests FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pilots WHERE user_id = auth.uid()));

NOTIFY pgrst, 'reload schema';
