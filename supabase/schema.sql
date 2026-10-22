-- Data Mess • Jalankan sekali melalui SQL Editor proyek Supabase Anda.
-- Satu data bersama. Semua akun yang terdaftar saat skrip dijalankan diberi akses.
-- Data lama dipertahankan sampai impor pengganti berhasil disimpan.
begin;

create table if not exists public.mess_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
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
create index if not exists mess_snapshots_latest_idx on public.mess_snapshots (created_at desc, id desc);
-- user_id mencatat pengunggah, bukan pemilik data bersama.
alter table public.mess_snapshots alter column user_id drop not null;
alter table public.mess_snapshots drop constraint if exists mess_snapshots_user_id_fkey;
alter table public.mess_snapshots add constraint mess_snapshots_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null;
alter table public.mess_snapshots enable row level security;
alter table public.mess_snapshots force row level security;

create table if not exists public.mess_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.mess_members enable row level security;
alter table public.mess_members force row level security;
drop policy if exists "mess_member_self" on public.mess_members;
create policy "mess_member_self" on public.mess_members for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.mess_members from anon, authenticated;
grant select on public.mess_members to authenticated;

-- Menyetujui akun yang sudah dibuat, tanpa membuka akses bagi pendaftaran
-- publik baru. Akun yang enabled=false tetap tidak diaktifkan saat dijalankan ulang.
insert into public.mess_members (user_id) select id from auth.users where email is not null on conflict (user_id) do nothing;

create or replace function public.is_mess_member()
returns boolean language sql stable security definer set search_path = ''
as $$ select auth.uid() is not null and exists (select 1 from public.mess_members where user_id = auth.uid() and enabled) $$;

create or replace function public.mess_access_status()
returns jsonb language sql stable security definer set search_path = ''
as $$ select jsonb_build_object('version', 2, 'allowed', public.is_mess_member()) $$;

drop policy if exists "mess_select_own" on public.mess_snapshots;
drop policy if exists "mess_insert_own" on public.mess_snapshots;
drop policy if exists "mess_delete_own" on public.mess_snapshots;
drop policy if exists "mess_select_shared" on public.mess_snapshots;
create policy "mess_select_shared" on public.mess_snapshots for select to authenticated using ((select public.is_mess_member()));

revoke all on public.mess_snapshots from anon;
revoke all on public.mess_snapshots from authenticated;
grant select on public.mess_snapshots to authenticated;

-- Penggantian data hanya melalui fungsi ini. Lock mengurutkan unggahan dari
-- beberapa pengguna. Jika insert atau delete gagal, seluruh transaksi dibatalkan.
create or replace function public.replace_mess_data(p_data jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  saved public.mess_snapshots%rowtype;
begin
  if not public.is_mess_member() then
    raise exception 'Akun belum diberi akses data mess.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_data) is distinct from 'object'
     or jsonb_typeof(p_data->'mess') is distinct from 'array'
     or jsonb_typeof(p_data->'manpower') is distinct from 'array' then
    raise exception 'Format data mess atau manpower tidak valid.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_data->'mess') = 0 or jsonb_array_length(p_data->'manpower') = 0 then
    raise exception 'Data kosong tidak boleh mengganti data tersimpan.' using errcode = '22023';
  end if;
  if exists (
    select 1 from (
      select value as item from jsonb_array_elements(p_data->'mess')
      union all select value as item from jsonb_array_elements(p_data->'manpower')
    ) rows_to_check
    where jsonb_typeof(item) is distinct from 'object'
       or jsonb_typeof(item->'nik') is distinct from 'string'
       or nullif(btrim(item->>'nik'), '') is null
  ) then
    raise exception 'Setiap baris data tersimpan harus memiliki NIK yang valid.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(763427115::bigint);
  -- Periksa ulang setelah menunggu lock jika akses dicabut selama antrean.
  if not public.is_mess_member() then
    raise exception 'Akun belum diberi akses data mess.' using errcode = '42501';
  end if;
  insert into public.mess_snapshots (user_id, label, created_at, imported_at, grade_mode, source_info, counts, mess, manpower, invalid_rows)
  values (auth.uid(), coalesce(nullif(btrim(p_data->>'label'), ''), 'Data mess'), clock_timestamp(),
    coalesce((p_data->>'imported_at')::timestamptz, now()), 'raw',
    coalesce(p_data->'source_info', '{}'::jsonb), coalesce(p_data->'counts', '{}'::jsonb),
    p_data->'mess', p_data->'manpower', coalesce(p_data->'invalid_rows', '[]'::jsonb))
  returning * into saved;
  delete from public.mess_snapshots where id <> saved.id;
  return jsonb_build_object('id', saved.id, 'label', saved.label, 'created_at', saved.created_at, 'user_id', saved.user_id);
end;
$$;

revoke all on function public.is_mess_member() from public, anon, authenticated;
revoke all on function public.mess_access_status() from public, anon, authenticated;
revoke all on function public.replace_mess_data(jsonb) from public, anon, authenticated;
grant execute on function public.is_mess_member() to authenticated;
grant execute on function public.mess_access_status() to authenticated;
grant execute on function public.replace_mess_data(jsonb) to authenticated;

comment on table public.mess_snapshots is 'Data hunian bersama bagi akun yang terdaftar. user_id mencatat pengunggah. Penggantian data dilakukan secara atomik melalui replace_mess_data.';
comment on table public.mess_members is 'Akun yang diberi akses ke satu data mess bersama. Semua anggota dapat melihat dan mengganti data.';
notify pgrst, 'reload schema';
commit;
