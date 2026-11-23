-- فحص قواعد الحماية: المدير بيعمل كل شي، المندوب فواتيره وسنداته بس، والغريب ولا شي
\set ON_ERROR_STOP 1
create or replace function pg_temp.run(who text, q text) returns text language plpgsql as $f$
declare n int; r text;
begin
  perform set_config('test.uid', (case who when 'boss' then '00000000-0000-0000-0000-00000000000a' when 'rep' then '00000000-0000-0000-0000-00000000000b' else '00000000-0000-0000-0000-00000000000c' end), true);
  execute 'set local role authenticated';
  if q ~* '^\s*select' then execute q into r; reset role; return coalesce(r, 'null'); end if;
  execute q; get diagnostics n = row_count; reset role; return 'rows:' || n;
exception when others then reset role; return 'denied';
end $f$;
create or replace function pg_temp.expect(label text, got text, want text) returns void language plpgsql as $f$
begin
  if got is distinct from want then raise exception 'FAIL: % — got %, want %', label, got, want; end if;
  raise notice 'ok: %', label;
end $f$;

select pg_temp.expect('owner creates company', pg_temp.run('boss', $$insert into companies(id,name) values ('11111111-1111-1111-1111-111111111111','ش')$$), 'rows:1');
insert into members(company_id,user_id) values ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-00000000000b');
select pg_temp.expect('owner adds item', pg_temp.run('boss', $$insert into records(company_id,kind,id,data) values ('11111111-1111-1111-1111-111111111111','items','it1','{"sellPrice":1000}')$$), 'rows:1');
select pg_temp.expect('owner adds invoice', pg_temp.run('boss', $$insert into records(company_id,kind,id,data) values ('11111111-1111-1111-1111-111111111111','invoices','own1','{"no":1}')$$), 'rows:1');

select pg_temp.expect('rep reads items', pg_temp.run('rep', $$select count(*)::text from records where kind='items'$$), '1');
select pg_temp.expect('rep writes own invoice', pg_temp.run('rep', $$insert into records(company_id,kind,id,data) values ('11111111-1111-1111-1111-111111111111','invoices','r1','{"rep":"محمد"}') on conflict (company_id,kind,id) do update set data=excluded.data$$), 'rows:1');
select pg_temp.expect('rep edits own invoice', pg_temp.run('rep', $$insert into records(company_id,kind,id,data) values ('11111111-1111-1111-1111-111111111111','invoices','r1','{"rep":"محمد","x":1}') on conflict (company_id,kind,id) do update set data=excluded.data$$), 'rows:1');
select pg_temp.expect('rep writes receipt', pg_temp.run('rep', $$insert into records(company_id,kind,id,data) values ('11111111-1111-1111-1111-111111111111','vouchers','v1','{"rep":"محمد"}')$$), 'rows:1');
select pg_temp.expect('rep updates seq', pg_temp.run('rep', $$insert into records(company_id,kind,id,data) values ('11111111-1111-1111-1111-111111111111','seq','main','{}') on conflict (company_id,kind,id) do update set data=excluded.data$$), 'rows:1');
select pg_temp.expect('rep invoice without rep name', pg_temp.run('rep', $$insert into records(company_id,kind,id,data) values ('11111111-1111-1111-1111-111111111111','invoices','r2','{}')$$), 'denied');
select pg_temp.expect('rep changes price (upsert)', pg_temp.run('rep', $$insert into records(company_id,kind,id,data) values ('11111111-1111-1111-1111-111111111111','items','it1','{"sellPrice":1}') on conflict (company_id,kind,id) do update set data=excluded.data$$), 'denied');
select pg_temp.expect('rep changes price (update)', pg_temp.run('rep', $$update records set data='{"sellPrice":1}' where kind='items'$$), 'rows:0');
select pg_temp.expect('rep edits boss invoice', pg_temp.run('rep', $$update records set data='{"rep":"محمد"}' where id='own1'$$), 'rows:0');
select pg_temp.expect('rep soft-deletes', pg_temp.run('rep', $$update records set deleted=true where id='r1'$$), 'denied');
select pg_temp.expect('rep hard-deletes', pg_temp.run('rep', $$delete from records where id='r1'$$), 'rows:0');
select pg_temp.expect('rep adds new item', pg_temp.run('rep', $$insert into records(company_id,kind,id,data) values ('11111111-1111-1111-1111-111111111111','items','it9','{"sellPrice":1}')$$), 'denied');
select pg_temp.expect('rep adds account', pg_temp.run('rep', $$insert into records(company_id,kind,id,data) values ('11111111-1111-1111-1111-111111111111','accounts','a1','{}')$$), 'denied');
select pg_temp.expect('rep writes settings', pg_temp.run('rep', $$insert into records(company_id,kind,id,data) values ('11111111-1111-1111-1111-111111111111','settings','main','{}')$$), 'denied');

select pg_temp.expect('stranger reads nothing', pg_temp.run('x', $$select count(*)::text from records$$), '0');
select pg_temp.expect('stranger writes', pg_temp.run('x', $$insert into records(company_id,kind,id,data) values ('11111111-1111-1111-1111-111111111111','invoices','z','{"rep":"x"}')$$), 'denied');
select pg_temp.expect('stranger takes number', pg_temp.run('x', $$select take_no('11111111-1111-1111-1111-111111111111','sale',0)::text$$), 'denied');
select pg_temp.expect('stranger reads counters', pg_temp.run('x', $$select count(*)::text from counters$$), 'denied');

select pg_temp.expect('owner edits rep invoice', pg_temp.run('boss', $$update records set data='{"rep":"محمد","fixed":1}' where id='r1'$$), 'rows:1');
select pg_temp.expect('rep blocked after owner edit', pg_temp.run('rep', $$update records set data='{"rep":"محمد"}' where id='r1'$$), 'rows:0');
select pg_temp.expect('owner deletes', pg_temp.run('boss', $$delete from records where id='v1'$$), 'rows:1');
select pg_temp.expect('price unchanged', (select data->>'sellPrice' from records where id='it1'), '1000');

select pg_temp.expect('number continues from device max', pg_temp.run('boss', $$select take_no('11111111-1111-1111-1111-111111111111','sale',40)::text$$), '41');
select pg_temp.expect('next number', pg_temp.run('boss', $$select take_no('11111111-1111-1111-1111-111111111111','sale',40)::text$$), '42');
select pg_temp.expect('stale device still unique', pg_temp.run('rep', $$select take_no('11111111-1111-1111-1111-111111111111','sale',30)::text$$), '43');

-- تنظيف الحسابات الوهمية
insert into auth.users (id, email, created_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'pos-old@pos.daftar.app', now() - interval '2 days'),   -- وهمي قديم ← ينمسح
  ('00000000-0000-0000-0000-0000000000d2', 'pos-new@pos.daftar.app', now() - interval '2 hours'),  -- جديد ← يضل
  ('00000000-0000-0000-0000-0000000000d3', 'someone@mail', now() - interval '3 days'),             -- عادي عمره 3 أيام ← يضل
  ('00000000-0000-0000-0000-0000000000d4', 'spam@mail', now() - interval '10 days'),               -- عادي قديم ← ينمسح
  ('00000000-0000-0000-0000-0000000000d5', 'pos-wait@pos.daftar.app', now() - interval '5 days');  -- بعت طلب ← يضل
insert into pos_requests (company_id, user_id, name) values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000d5', 'علي');
update auth.users set created_at = now() - interval '30 days' where email in ('boss@test', 'rep@test', 'stranger@test');
select pg_temp.expect('rep cannot run cleanup', pg_temp.run('rep', $$select cleanup_orphan_users()::text$$), 'denied');
select pg_temp.expect('cleanup removes orphans', public.cleanup_orphan_users()::text, '3');
select pg_temp.expect('kept users', (select string_agg(email, ',' order by email) from auth.users), 'boss@test,pos-new@pos.daftar.app,pos-wait@pos.daftar.app,rep@test,someone@mail');

-- حد طلبات التفعيل
do $$ begin
  for i in 1..19 loop
    insert into auth.users (id, email) values (('00000000-0000-0000-0001-' || lpad(i::text, 12, '0'))::uuid, 'pos-' || i || '@pos.daftar.app');
    perform set_config('test.uid', '00000000-0000-0000-0001-' || lpad(i::text, 12, '0'), true);
    set local role authenticated;
    insert into pos_requests (company_id, name) values ('11111111-1111-1111-1111-111111111111', 'x' || i);
    reset role;
  end loop;
end $$;
insert into auth.users (id, email) values ('00000000-0000-0000-0001-000000000099', 'pos-99@pos.daftar.app');
create or replace function pg_temp.run_as(uid text, q text) returns text language plpgsql as $f$
begin perform set_config('test.uid', uid, true); execute 'set local role authenticated'; execute q; reset role; return 'ok';
exception when others then reset role; return 'denied'; end $f$;
select pg_temp.expect('21st pending request blocked', pg_temp.run_as('00000000-0000-0000-0001-000000000099', $$insert into pos_requests (company_id, name) values ('11111111-1111-1111-1111-111111111111', 'spam')$$), 'denied');
