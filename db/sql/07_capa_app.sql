-- =====================================================================
-- SRA Project Management v2 · 07 · Ajustes para la aplicación web
-- 1. Quitar vínculos (no registros): persona de un panel o de un proyecto, participante de una tarea,
--    punto de checklist, asistente de reunión, pausa de jornada y cronómetro en marcha.
--    Todo queda en la auditoría. Los registros principales siguen sin poder borrarse.
-- 2. Autorización de tratamiento de datos (Ley 1581 de 2012) con versión y fecha.
-- 3. Entregables de tarea con identificador de origen (para no duplicar al guardar).
-- 4. Tiempo real: las tablas que la mesa escucha.
-- =====================================================================

-- 1. Quitar vínculos
grant delete on sra.persona_paneles, sra.proyecto_personas, sra.tarea_personas, sra.tarea_checklist,
                sra.reunion_personas, sra.jornada_pausas, sra.cronometros to authenticated;
create policy quitar on sra.persona_paneles for delete to authenticated using (sra.mfa_ok() and sra.es_admin());
create policy quitar on sra.proyecto_personas for delete to authenticated using (sra.mfa_ok() and sra.gestiona(proyecto_id));
create policy quitar on sra.tarea_personas for delete to authenticated using (sra.mfa_ok() and sra.ve_tarea(tarea_id));
create policy quitar on sra.tarea_checklist for delete to authenticated using (sra.mfa_ok() and sra.ve_tarea(tarea_id));
create policy quitar on sra.reunion_personas for delete to authenticated
  using (sra.mfa_ok() and exists (select 1 from sra.reuniones r where r.id = reunion_id and (r.creado_por = sra.yo() or sra.es_admin())));
create policy quitar on sra.jornada_pausas for delete to authenticated using (sra.mfa_ok() and (persona_id = sra.yo() or sra.es_admin()));
create policy quitar on sra.cronometros for delete to authenticated using (sra.mfa_ok() and (persona_id = sra.yo() or sra.es_admin()));
create policy editar on sra.reunion_personas for update to authenticated
  using (sra.mfa_ok() and exists (select 1 from sra.reuniones r where r.id = reunion_id and (r.creado_por = sra.yo() or sra.es_admin())));

do $$
declare t text;
begin
  foreach t in array array['tarea_checklist','reunion_personas','jornada_pausas'] loop
    execute format('create trigger auditar after insert or update or delete on sra.%I for each row execute function sra.auditar()', t);
  end loop;
end $$;

-- 2. Autorización de datos personales
create table if not exists sra.autorizaciones (
  persona_id  uuid not null references sra.personas(id),
  version     text not null,
  aceptada_en timestamptz not null default now(),
  navegador   text not null default '',
  primary key (persona_id, version)
);
comment on table sra.autorizaciones is 'Autorización de tratamiento de datos personales (Ley 1581 de 2012), por versión del aviso.';
alter table sra.autorizaciones enable row level security;
grant select, insert on sra.autorizaciones to authenticated;
grant all on sra.autorizaciones to service_role;
create policy ver on sra.autorizaciones for select to authenticated using (sra.mfa_ok() and (persona_id = sra.yo() or sra.es_admin()));
create policy crear on sra.autorizaciones for insert to authenticated with check (sra.mfa_ok() and persona_id = sra.yo());
create trigger no_borrar before delete on sra.autorizaciones for each row execute function sra.no_borrar();
create trigger auditar after insert or update or delete on sra.autorizaciones for each row execute function sra.auditar();

-- 3. Entregables con identificador de origen
alter table sra.entregables add column if not exists id_origen text;
create unique index if not exists entregables_tarea_origen on sra.entregables (tarea_id, id_origen);

-- 4. Tiempo real (solo existe en Supabase)
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['personas','persona_paneles','proyectos','proyecto_personas','etapas','entregas','entrega_historial',
      'cambios_alcance','tareas','tarea_personas','tarea_checklist','entregables','comentarios','cronometros','registros_horas',
      'jornadas','jornada_pausas','reuniones','reunion_personas','planes_obra','partidas','avance_obra','plan_historial',
      'bitacora','obra_items','fotos','programaciones','config'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'sra' and tablename = t) then
        execute format('alter publication supabase_realtime add table sra.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- 5. Campos de la mesa que no tienen columna propia se guardan en «extra» (nada se pierde al guardar)
do $$
declare t text;
begin
  foreach t in array array['personas','proyectos','entregas','cambios_alcance','tareas','reuniones','bitacora','obra_items','planes_obra'] loop
    execute format('alter table sra.%I add column if not exists extra jsonb not null default ''{}''::jsonb', t);
  end loop;
end $$;
alter table sra.partidas add column if not exists id_origen text;
create unique index if not exists partidas_proyecto_origen on sra.partidas (proyecto_id, id_origen);

-- 6. El administrador también corrige pausas de jornada de otras personas
drop policy if exists crear on sra.jornada_pausas;
create policy crear on sra.jornada_pausas for insert to authenticated with check (sra.mfa_ok() and (persona_id = sra.yo() or sra.es_admin()));

-- 7. Primer ingreso: enlazar la cuenta de Supabase con su persona.
-- La guardia de personas bloqueaba este enlace (la persona todavía no es «yo»); ahora se permite solo ese cambio, solo desde esta función.
create or replace function sra.guardia_personas() returns trigger language plpgsql
security definer set search_path = sra, public as $$
begin
  if sra.es_sistema() or sra.es_admin() then return new; end if;
  if coalesce(current_setting('sra.enlace', true), '') = 'on' and old.auth_user_id is null and new.auth_user_id = auth.uid()
     and (to_jsonb(new) - 'auth_user_id' - 'actualizado_en') = (to_jsonb(old) - 'auth_user_id' - 'actualizado_en') then
    return new;
  end if;
  if new.rol is distinct from old.rol or new.es_ceo is distinct from old.es_ceo or new.usuario is distinct from old.usuario
     or new.email is distinct from old.email or new.inactivo is distinct from old.inactivo
     or new.auth_user_id is distinct from old.auth_user_id or new.nombre is distinct from old.nombre then
    raise exception 'Solo el administrador puede cambiar nombre, rol, CEO, usuario, correo o estado.' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function sra.enlazar_mi_cuenta() returns uuid
language plpgsql security definer set search_path = sra, public as $$
declare pid uuid; mail text := lower(auth.jwt() ->> 'email');
begin
  if auth.uid() is null or coalesce(mail, '') = '' then return null; end if;
  select id into pid from sra.personas where auth_user_id = auth.uid();
  if pid is not null then return pid; end if;
  perform set_config('sra.enlace', 'on', true);
  update sra.personas set auth_user_id = auth.uid()
  where lower(email) = mail and auth_user_id is null and not inactivo returning id into pid;
  perform set_config('sra.enlace', '', true);
  return pid;
end $$;

-- 8. Ver tareas: la regla se evalúa con las columnas de la fila (antes consultaba la propia tabla,
--    y al crear una tarea la fila nueva aún no era visible para esa consulta).
drop policy if exists ver on sra.tareas;
create policy ver on sra.tareas for select to authenticated using (sra.mfa_ok() and (
  sra.es_admin()
  or (proyecto_id is not null and sra.ve_proyecto(proyecto_id))
  or (proyecto_id is null and (sra.yo() in (responsable_id, verificador_id, creado_por)
      or exists (select 1 from sra.tarea_personas tp where tp.tarea_id = id and tp.persona_id = sra.yo())))));
