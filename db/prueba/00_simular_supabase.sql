-- Solo para pruebas locales: imita lo mínimo de Supabase (roles, auth, storage, cron)
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; end if; end $$;
create schema auth; create schema storage; create schema cron;
create table auth.users (id uuid primary key, email text);
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
grant usage on schema storage, auth to authenticated; grant select, insert, update on storage.objects to authenticated;
grant execute on function auth.uid(), auth.jwt() to authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
create table cron.jobs (name text primary key, sched text, cmd text);
create function cron.schedule(n text, s text, c text) returns int language sql as $$ insert into cron.jobs values (n, s, c) on conflict (name) do update set sched = excluded.sched, cmd = excluded.cmd; select 1 $$;
