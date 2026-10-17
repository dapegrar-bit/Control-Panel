-- شغّلي هذا الملف مرة واحدة في Supabase SQL Editor قبل تفعيل الصفحة.
-- لا يغيّر الجداول القديمة ولا يمس سجلات المتدربين.
CREATE TABLE IF NOT EXISTS public.trainee_document_issues (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 trainee_record_id BIGINT NOT NULL REFERENCES public.trainee_records(id) ON DELETE RESTRICT,
 template_id TEXT NOT NULL,
 document_kind TEXT NOT NULL CHECK (document_kind IN ('certificate','letter')),
 document_type TEXT NOT NULL,
 batch_name TEXT NOT NULL,
 trainee_name TEXT NOT NULL,
 issued_by UUID NOT NULL,
 issuer_email TEXT,
 issuer_role TEXT NOT NULL,
 action TEXT NOT NULL DEFAULT 'prepared_for_print',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trainee_document_issues_record ON public.trainee_document_issues (trainee_record_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trainee_document_issues_user ON public.trainee_document_issues (issued_by,created_at DESC);
-- الوصول إلى هذا الجدول يكون عبر الخادم المصادق عليه، لا عبر Supabase anon.
ALTER TABLE public.trainee_document_issues ENABLE ROW LEVEL SECURITY;
