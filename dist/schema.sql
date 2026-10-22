-- Mess Insight • Jalankan melalui SQL Editor proyek Supabase Anda.
-- Satu snapshot menyimpan pasangan sumber yang utuh dalam satu transaksi.
begin;

create table if not exists public.mess_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 160),
  created_at timestamptz not null default now(),
  imported_at timestamptz not null default now(),
  grade_mode text not null default 'raw' check (grade_mode in ('raw','number')),
  source_info jsonb not null default '{}'::jsonb,
  counts jsonb not null default '{}'::jsonb,
  mess jsonb not null default '[]'::jsonb,
  manpower jsonb not null default '[]'::jsonb,
  invalid_rows jsonb not null default '[]'::jsonb,
  constraint mess_array check (jsonb_typeof(mess) = 'array' and jsonb_array_length(mess) <= 50000),
  constraint manpower_array check (jsonb_typeof(manpower) = 'array' and jsonb_array_length(manpower) <= 50000),
  constraint invalid_array check (jsonb_typeof(invalid_rows) = 'array'),
  constraint source_object check (jsonb_typeof(source_info) = 'object'),
  constraint counts_object check (jsonb_typeof(counts) = 'object')
);
create index if not exists mess_snapshots_user_created_idx on public.mess_snapshots (user_id, created_at desc);
alter table public.mess_snapshots enable row level security;
alter table public.mess_snapshots force row level security;

drop policy if exists "mess_select_own" on public.mess_snapshots;
create policy "mess_select_own" on public.mess_snapshots for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "mess_insert_own" on public.mess_snapshots;
create policy "mess_insert_own" on public.mess_snapshots for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "mess_delete_own" on public.mess_snapshots;
create policy "mess_delete_own" on public.mess_snapshots for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.mess_snapshots from anon;
revoke all on public.mess_snapshots from authenticated;
grant select, insert, delete on public.mess_snapshots to authenticated;

comment on table public.mess_snapshots is 'Snapshot impor hunian. Akses dibatasi ke pemilik oleh Supabase Auth dan RLS. Tidak ada akses anonim atau pembaruan snapshot.';
commit;
