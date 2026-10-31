-- 029: keep the lines of each structure invoice so "Mes factures" can re-open the PDF later
ALTER TABLE public.structure_invoices ADD COLUMN IF NOT EXISTS lines jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.structure_invoices ADD COLUMN IF NOT EXISTS invoice_date date DEFAULT current_date;
NOTIFY pgrst, 'reload schema';
