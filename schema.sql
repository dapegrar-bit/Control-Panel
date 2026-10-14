-- Run only after reviewing existing schema in Supabase. Do not drop existing roles.
create table if not exists public.trainee_records (
 id bigserial primary key,
 sheet_name text not null,
 row_number integer not null,
 payload jsonb not null,
 unique(sheet_name,row_number)
);
create index if not exists idx_records_payload on public.trainee_records using gin(payload);
alter table public.trainee_records enable row level security;
revoke all on public.trainee_records from PUBLIC, anon, authenticated;
revoke all on sequence public.trainee_records_id_seq from PUBLIC, anon, authenticated;
-- Roles are held in existing app_private.user_roles, not public.app_roles.
-- The backend DATABASE_URL user must have SELECT on app_private.user_roles and
-- SELECT on public.trainee_records. Configure grants for its actual DB role.
