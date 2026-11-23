-- =====================================================================
--  دفتر — إعداد قاعدة البيانات السحابية على Supabase
--  انسخ هذا الملف كاملاً، والصقه في: SQL Editor ← New query ← اضغط Run
--  (آمن إذا شغّلته أكثر من مرة)
-- =====================================================================

create extension if not exists pgcrypto;

-- الشركات (كل شركة لها بياناتها المستقلة)
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- المستخدمون المسموح لهم بالدخول لكل شركة
create table if not exists public.members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  primary key (company_id, user_id)
);

-- كل السجلات (حسابات، مواد، فواتير، سندات، قيود، إعدادات)
create table if not exists public.records (
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null,
  id text not null,
  data jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid,
  primary key (company_id, kind, id)
);
create index if not exists records_sync_idx on public.records (company_id, updated_at);

-- هل المستخدم الحالي عضو في الشركة؟
create or replace function public.is_member(c uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.members where company_id = c and user_id = auth.uid());
$$;

-- وقت التعديل يأتي من السيرفر دائماً (لا نعتمد على ساعة الموبايل)
create or replace function public.touch_record() returns trigger
language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
  for each row execute function public.touch_record();

-- منشئ الشركة يصبح عضواً فيها تلقائياً
create or replace function public.add_owner_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.members (company_id, user_id, role) values (new.id, new.owner, 'owner')
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists companies_owner on public.companies;
create trigger companies_owner after insert on public.companies
  for each row execute function public.add_owner_member();

-- إضافة مستخدم للشركة بإيميله (للمالك فقط)
create or replace function public.add_member(p_company uuid, p_email text) returns text
language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  if not exists (select 1 from public.companies where id = p_company and owner = auth.uid()) then
    raise exception 'فقط مالك الشركة يستطيع إضافة مستخدمين';
  end if;
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email));
  if v_uid is null then return 'notfound'; end if;
  insert into public.members (company_id, user_id) values (p_company, v_uid) on conflict do nothing;
  return 'ok';
end $$;

-- ===================== الحماية (Row Level Security) =====================
alter table public.companies enable row level security;
alter table public.members   enable row level security;
alter table public.records   enable row level security;

drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select to authenticated
  using (owner = auth.uid() or public.is_member(id));
drop policy if exists companies_insert on public.companies;
create policy companies_insert on public.companies for insert to authenticated
  with check (owner = auth.uid());
drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies for update to authenticated
  using (owner = auth.uid());

drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated
  using (user_id = auth.uid() or public.is_member(company_id));
drop policy if exists members_delete on public.members;
create policy members_delete on public.members for delete to authenticated
  using (exists (select 1 from public.companies c where c.id = company_id and c.owner = auth.uid()));

drop policy if exists records_all on public.records;
create policy records_all on public.records for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

grant usage on schema public to authenticated;
grant select, insert, update on public.companies to authenticated;
grant select, delete on public.members to authenticated;
grant select, insert, update, delete on public.records to authenticated;
revoke execute on function public.add_member(uuid, text) from public, anon;
grant execute on function public.add_member(uuid, text) to authenticated;
grant execute on function public.is_member(uuid) to authenticated;

-- ===================== تفعيل موبايلات نقطة البيع =====================
-- موبايل المندوب بيصوّر الباركود ← بيبعت طلب ← المدير بيكبس «تفعيل» من موبايله
create table if not exists public.pos_requests (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text,
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
alter table public.pos_requests enable row level security;
drop policy if exists pos_req_select on public.pos_requests;
create policy pos_req_select on public.pos_requests for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.companies c where c.id = company_id and c.owner = auth.uid()));
drop policy if exists pos_req_insert on public.pos_requests;
create policy pos_req_insert on public.pos_requests for insert to authenticated
  with check (user_id = auth.uid() and approved = false);
drop policy if exists pos_req_delete on public.pos_requests;
create policy pos_req_delete on public.pos_requests for delete to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.companies c where c.id = company_id and c.owner = auth.uid()));
grant select, insert, delete on public.pos_requests to authenticated;

-- المدير بيفعّل موبايل نقطة بيع (بيصير عضو بالشركة)
create or replace function public.approve_pos(p_company uuid, p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.companies where id = p_company and owner = auth.uid()) then
    raise exception 'فقط مالك الشركة يستطيع تفعيل نقطة بيع';
  end if;
  if not exists (select 1 from public.pos_requests where company_id = p_company and user_id = p_user) then return 'notfound'; end if;
  insert into public.members (company_id, user_id) values (p_company, p_user) on conflict do nothing;
  update public.pos_requests set approved = true where company_id = p_company and user_id = p_user;
  return 'ok';
end $$;

-- المدير بيوقّف موبايل نقطة بيع (بيطلع من الشركة)
create or replace function public.revoke_pos(p_company uuid, p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.companies where id = p_company and owner = auth.uid()) then
    raise exception 'فقط مالك الشركة يستطيع إيقاف نقطة بيع';
  end if;
  if p_user = auth.uid() then return 'self'; end if;
  delete from public.members where company_id = p_company and user_id = p_user;
  delete from public.pos_requests where company_id = p_company and user_id = p_user;
  return 'ok';
end $$;
revoke execute on function public.approve_pos(uuid, uuid) from public, anon;
revoke execute on function public.revoke_pos(uuid, uuid) from public, anon;
grant execute on function public.approve_pos(uuid, uuid) to authenticated;
grant execute on function public.revoke_pos(uuid, uuid) to authenticated;
