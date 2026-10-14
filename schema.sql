create table if not exists trainee_records (
 id bigserial primary key,
 sheet_name text not null,
 row_number integer not null,
 payload jsonb not null,
 unique(sheet_name,row_number)
);
create index if not exists idx_records_payload on trainee_records using gin(payload);
create table if not exists app_roles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 role text not null check(role in ('viewer','exporter','admin'))
);
alter table trainee_records enable row level security;
alter table app_roles enable row level security;
-- No direct API access to records. Only server-side PostgreSQL connection may query them.
revoke all on trainee_records from anon, authenticated;
revoke all on app_roles from anon, authenticated;
