-- =====================================================================
-- SRA Project Management v2 · 03 · Seguridad: disparadores, permisos y reglas por fila (RLS)
-- Toda regla exige sesión con doble verificación (sra.mfa_ok()).
-- No hay reglas de DELETE: nada se borra desde la app.
-- =====================================================================

-- ---------- Disparadores ----------
do $$
declare t text;
begin
  -- fecha de actualización
  foreach t in array array['personas','proyectos','entregas','tareas'] loop
    execute format('create trigger tocar before update on sra.%I for each row execute function sra.tocar()', t);
  end loop;
  -- auditoría de cambios
  foreach t in array array['personas','persona_paneles','proyectos','proyecto_personas','etapas','entregas','cambios_alcance',
                           'tareas','tarea_personas','entregables','registros_horas','jornadas','planes_obra','partidas',
                           'obra_items','bitacora','reuniones','tipos_proyecto','subtipos','plantilla_etapas','config'] loop
    execute format('create trigger auditar after insert or update or delete on sra.%I for each row execute function sra.auditar()', t);
  end loop;
  -- nada se borra
  foreach t in array array['personas','proyectos','etapas','entregas','entrega_historial','cambios_alcance','tareas','entregables',
                           'comentarios','registros_horas','jornadas','reuniones','planes_obra','plan_historial','avance_obra',
                           'bitacora','obra_items','fotos','programaciones','auditoria','festivos'] loop
    execute format('create trigger no_borrar before delete on sra.%I for each row execute function sra.no_borrar()', t);
  end loop;
end $$;

create trigger guardia before update on sra.personas for each row execute function sra.guardia_personas();
create trigger guardia before insert or update on sra.entregas for each row execute function sra.guardia_entregas();
create trigger guardia before insert on sra.bitacora for each row execute function sra.guardia_bitacora();
create trigger guardia before insert or update or delete on sra.partidas for each row execute function sra.guardia_partidas();
create trigger guardia before insert or update on sra.registros_horas for each row execute function sra.guardia_horas();

-- La auditoría no se edita
create or replace function sra.solo_lectura() returns trigger language plpgsql as $$
begin raise exception 'La auditoría no se puede modificar.' using errcode = '42501'; end $$;
create trigger solo_lectura before update on sra.auditoria for each row execute function sra.solo_lectura();

-- ---------- Permisos de la API ----------
revoke all on schema sra from public, anon;
grant usage on schema sra to authenticated, service_role;
revoke all on all tables in schema sra from public, anon, authenticated;
grant select, insert, update on all tables in schema sra to authenticated;
revoke insert, update on sra.auditoria, sra.entrega_historial, sra.plan_historial, sra.festivos from authenticated;
grant all on all tables in schema sra to service_role;
grant usage on all sequences in schema sra to authenticated, service_role;
revoke all on all functions in schema sra from public, anon;
grant execute on all functions in schema sra to authenticated, service_role;

-- ---------- Reglas por fila ----------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'sra' loop
    execute format('alter table sra.%I enable row level security', t);
  end loop;
end $$;
-- Las funciones «security definer» corren como dueño de las tablas y por eso no quedan sujetas a RLS
-- (así se evita que las funciones de rol se llamen a sí mismas). No usar FORCE ROW LEVEL SECURITY.

-- Personas: todo el equipo ve el directorio; el administrador crea y cambia; cada quien edita su color y foto
create policy ver on sra.personas for select to authenticated using (sra.mfa_ok() and sra.yo() is not null);
create policy crear on sra.personas for insert to authenticated with check (sra.mfa_ok() and sra.es_admin());
create policy editar on sra.personas for update to authenticated
  using (sra.mfa_ok() and (sra.es_admin() or id = sra.yo())) with check (sra.mfa_ok() and (sra.es_admin() or id = sra.yo()));

create policy ver on sra.persona_paneles for select to authenticated using (sra.mfa_ok() and sra.yo() is not null);
create policy crear on sra.persona_paneles for insert to authenticated with check (sra.mfa_ok() and sra.es_admin());
create policy editar on sra.persona_paneles for update to authenticated using (sra.mfa_ok() and sra.es_admin());

-- Catálogos y configuración: todos leen, el administrador cambia
do $$
declare t text;
begin
  foreach t in array array['tipos_proyecto','subtipos','plantilla_etapas','config'] loop
    execute format('create policy ver on sra.%I for select to authenticated using (sra.mfa_ok())', t);
    execute format('create policy crear on sra.%I for insert to authenticated with check (sra.mfa_ok() and sra.es_admin())', t);
    execute format('create policy editar on sra.%I for update to authenticated using (sra.mfa_ok() and sra.es_admin())', t);
  end loop;
end $$;
create policy ver on sra.festivos for select to authenticated using (true);

-- Proyectos: se ven por panel; los crea y edita el administrador (los encargados editan datos de su proyecto)
create policy ver on sra.proyectos for select to authenticated using (sra.mfa_ok() and sra.tiene_panel(panel));
create policy crear on sra.proyectos for insert to authenticated with check (sra.mfa_ok() and sra.es_admin());
create policy editar on sra.proyectos for update to authenticated
  using (sra.mfa_ok() and sra.gestiona(id)) with check (sra.mfa_ok() and sra.gestiona(id) and sra.tiene_panel(panel));

create policy ver on sra.proyecto_personas for select to authenticated using (sra.mfa_ok() and sra.ve_proyecto(proyecto_id));
create policy crear on sra.proyecto_personas for insert to authenticated with check (sra.mfa_ok() and sra.gestiona(proyecto_id));
create policy editar on sra.proyecto_personas for update to authenticated using (sra.mfa_ok() and sra.gestiona(proyecto_id));

create policy ver on sra.etapas for select to authenticated using (sra.mfa_ok() and sra.ve_proyecto(proyecto_id));
create policy crear on sra.etapas for insert to authenticated with check (sra.mfa_ok() and sra.gestiona(proyecto_id));
create policy editar on sra.etapas for update to authenticated using (sra.mfa_ok() and sra.gestiona(proyecto_id));

-- Entregas: se ven por panel; las crean los encargados; el estado cambia solo con sra.mover_entrega()
create policy ver on sra.entregas for select to authenticated using (sra.mfa_ok() and sra.ve_proyecto(proyecto_id));
create policy crear on sra.entregas for insert to authenticated with check (sra.mfa_ok() and sra.prepara(proyecto_id));
create policy editar on sra.entregas for update to authenticated using (sra.mfa_ok() and sra.prepara(proyecto_id));
create policy ver on sra.entrega_historial for select to authenticated
  using (sra.mfa_ok() and exists (select 1 from sra.entregas e where e.id = entrega_id and sra.ve_proyecto(e.proyecto_id)));

create policy ver on sra.cambios_alcance for select to authenticated using (sra.mfa_ok() and sra.ve_proyecto(proyecto_id));
create policy crear on sra.cambios_alcance for insert to authenticated with check (sra.mfa_ok() and sra.prepara(proyecto_id) and estado = 'propuesto');
create policy editar on sra.cambios_alcance for update to authenticated using (sra.mfa_ok() and sra.prepara(proyecto_id));

-- Tareas: con proyecto, por panel; sin proyecto, solo sus participantes
create policy ver on sra.tareas for select to authenticated using (sra.mfa_ok() and sra.ve_tarea(id));
create policy crear on sra.tareas for insert to authenticated
  with check (sra.mfa_ok() and creado_por = sra.yo() and (proyecto_id is null or sra.ve_proyecto(proyecto_id)));
create policy editar on sra.tareas for update to authenticated
  using (sra.mfa_ok() and (sra.es_admin() or sra.yo() in (responsable_id, verificador_id, creado_por)
         or (proyecto_id is not null and sra.gestiona(proyecto_id))
         or exists (select 1 from sra.tarea_personas tp where tp.tarea_id = id and tp.persona_id = sra.yo() and tp.rol = 'participante')));

do $$
declare t text;
begin
  foreach t in array array['tarea_personas','tarea_checklist','entregables','comentarios'] loop
    execute format('create policy ver on sra.%I for select to authenticated using (sra.mfa_ok() and sra.ve_tarea(tarea_id))', t);
    execute format('create policy crear on sra.%I for insert to authenticated with check (sra.mfa_ok() and sra.ve_tarea(tarea_id))', t);
  end loop;
  foreach t in array array['tarea_personas','tarea_checklist','entregables'] loop
    execute format('create policy editar on sra.%I for update to authenticated using (sra.mfa_ok() and sra.ve_tarea(tarea_id))', t);
  end loop;
end $$;

-- Tiempo: cada quien ve y registra lo suyo; administrador y CEO ven todo; solo el administrador corrige
create policy ver on sra.cronometros for select to authenticated using (sra.mfa_ok() and (persona_id = sra.yo() or sra.es_admin()));
create policy crear on sra.cronometros for insert to authenticated with check (sra.mfa_ok() and persona_id = sra.yo() and sra.ve_tarea(tarea_id));
create policy editar on sra.cronometros for update to authenticated using (sra.mfa_ok() and persona_id = sra.yo());

create policy ver on sra.registros_horas for select to authenticated
  using (sra.mfa_ok() and (persona_id = sra.yo() or sra.es_admin() or sra.es_ceo()));
create policy crear on sra.registros_horas for insert to authenticated with check (sra.mfa_ok() and (persona_id = sra.yo() or sra.es_admin()));
create policy editar on sra.registros_horas for update to authenticated using (sra.mfa_ok() and sra.es_admin());

create policy ver on sra.jornadas for select to authenticated
  using (sra.mfa_ok() and (persona_id = sra.yo() or sra.es_admin() or sra.es_ceo()));
create policy crear on sra.jornadas for insert to authenticated with check (sra.mfa_ok() and (persona_id = sra.yo() or sra.es_admin()));
create policy editar on sra.jornadas for update to authenticated using (sra.mfa_ok() and (persona_id = sra.yo() or sra.es_admin()));
create policy ver on sra.jornada_pausas for select to authenticated
  using (sra.mfa_ok() and (persona_id = sra.yo() or sra.es_admin() or sra.es_ceo()));
create policy crear on sra.jornada_pausas for insert to authenticated with check (sra.mfa_ok() and persona_id = sra.yo());
create policy editar on sra.jornada_pausas for update to authenticated using (sra.mfa_ok() and (persona_id = sra.yo() or sra.es_admin()));

-- Reuniones: las del proyecto por panel; las sin proyecto, sus asistentes y quien las creó
create policy ver on sra.reuniones for select to authenticated using (sra.mfa_ok() and (
  sra.es_admin() or creado_por = sra.yo()
  or (proyecto_id is not null and sra.ve_proyecto(proyecto_id))
  or exists (select 1 from sra.reunion_personas rp where rp.reunion_id = id and rp.persona_id = sra.yo())));
create policy crear on sra.reuniones for insert to authenticated
  with check (sra.mfa_ok() and creado_por = sra.yo() and (proyecto_id is null or sra.ve_proyecto(proyecto_id)));
create policy editar on sra.reuniones for update to authenticated using (sra.mfa_ok() and (sra.es_admin() or creado_por = sra.yo()));
create policy ver on sra.reunion_personas for select to authenticated using (sra.mfa_ok() and sra.yo() is not null);
create policy crear on sra.reunion_personas for insert to authenticated
  with check (sra.mfa_ok() and exists (select 1 from sra.reuniones r where r.id = reunion_id and (r.creado_por = sra.yo() or sra.es_admin())));

-- Obra: plan y partidas los prepara el residente o el encargado; los valores solo los ven ellos, el CEO y el administrador
create policy ver on sra.planes_obra for select to authenticated using (sra.mfa_ok() and sra.ve_proyecto(proyecto_id));
create policy crear on sra.planes_obra for insert to authenticated with check (sra.mfa_ok() and sra.prepara(proyecto_id) and estado = 'borrador');
create policy editar on sra.planes_obra for update to authenticated using (sra.mfa_ok() and sra.prepara(proyecto_id) and estado in ('borrador', 'devuelto'));
create policy ver on sra.plan_historial for select to authenticated using (sra.mfa_ok() and sra.ve_proyecto(proyecto_id));

create policy ver on sra.partidas for select to authenticated using (sra.mfa_ok() and sra.ve_presupuesto(proyecto_id));
create policy crear on sra.partidas for insert to authenticated with check (sra.mfa_ok() and sra.prepara(proyecto_id));
create policy editar on sra.partidas for update to authenticated using (sra.mfa_ok() and sra.prepara(proyecto_id));
create policy quitar on sra.partidas for delete to authenticated using (sra.mfa_ok() and sra.prepara(proyecto_id));
comment on policy quitar on sra.partidas is 'Única excepción: quitar partidas de un plan en borrador (el disparador lo impide si está enviado o aprobado).';

create policy ver on sra.avance_obra for select to authenticated using (sra.mfa_ok() and sra.ve_proyecto(proyecto_id));

create policy ver on sra.bitacora for select to authenticated using (sra.mfa_ok() and sra.ve_proyecto(proyecto_id));
create policy crear on sra.bitacora for insert to authenticated with check (sra.mfa_ok() and sra.prepara(proyecto_id) and autor_id = sra.yo());
create policy editar on sra.bitacora for update to authenticated using (sra.mfa_ok() and (autor_id = sra.yo() or sra.es_admin()));

create policy ver on sra.obra_items for select to authenticated
  using (sra.mfa_ok() and (sra.ve_proyecto(proyecto_id) or (clase = 'consulta' and para_id = sra.yo())));
create policy crear on sra.obra_items for insert to authenticated with check (sra.mfa_ok() and sra.prepara(proyecto_id) and creado_por = sra.yo());
create policy editar on sra.obra_items for update to authenticated
  using (sra.mfa_ok() and (sra.prepara(proyecto_id) or (clase = 'consulta' and para_id = sra.yo())));

create policy ver on sra.fotos for select to authenticated using (sra.mfa_ok() and sra.ve_proyecto(proyecto_id));
create policy crear on sra.fotos for insert to authenticated with check (sra.mfa_ok() and sra.prepara(proyecto_id) and subida_por = sra.yo());

-- Programación semanal: todos la leen; la publica el administrador
create policy ver on sra.programaciones for select to authenticated using (sra.mfa_ok() and sra.yo() is not null);
create policy crear on sra.programaciones for insert to authenticated with check (sra.mfa_ok() and sra.es_admin());
create policy editar on sra.programaciones for update to authenticated using (sra.mfa_ok() and sra.es_admin());

-- Auditoría: solo la leen administrador y CEO
create policy ver on sra.auditoria for select to authenticated using (sra.mfa_ok() and (sra.es_admin() or sra.es_ceo()));

-- ---------- Archivos (Supabase Storage) ----------
-- Buckets privados: «obra» (ruta: <proyecto_id>/<archivo>) y «perfiles» (ruta: <persona_id>/<archivo>).
insert into storage.buckets (id, name, public) values ('obra', 'obra', false), ('perfiles', 'perfiles', false)
on conflict (id) do nothing;

create policy "obra: ver" on storage.objects for select to authenticated
  using (bucket_id = 'obra' and sra.mfa_ok() and sra.ve_proyecto(((storage.foldername(name))[1])::uuid));
create policy "obra: subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'obra' and sra.mfa_ok() and sra.prepara(((storage.foldername(name))[1])::uuid));
create policy "perfiles: ver" on storage.objects for select to authenticated
  using (bucket_id = 'perfiles' and sra.mfa_ok());
create policy "perfiles: subir la propia" on storage.objects for insert to authenticated
  with check (bucket_id = 'perfiles' and sra.mfa_ok() and (storage.foldername(name))[1] = sra.yo()::text);
create policy "perfiles: cambiar la propia" on storage.objects for update to authenticated
  using (bucket_id = 'perfiles' and sra.mfa_ok() and (storage.foldername(name))[1] = sra.yo()::text);
