-- شغلي هذا الأمر مرة واحدة في Supabase SQL Editor قبل نشر الكود.
-- لا يحذف أي بيانات موجودة.
CREATE TABLE IF NOT EXISTS public.trainee_imports (
  file_hash text PRIMARY KEY,
  file_name text NOT NULL,
  row_count integer NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.trainee_imports FROM PUBLIC, anon, authenticated;
