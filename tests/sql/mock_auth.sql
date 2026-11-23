-- بديل بسيط لـ Supabase Auth لحتى نفحص قواعد الحماية على Postgres عادي
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a', 'boss@test'),
  ('00000000-0000-0000-0000-00000000000b', 'rep@test'),
  ('00000000-0000-0000-0000-00000000000c', 'stranger@test');
