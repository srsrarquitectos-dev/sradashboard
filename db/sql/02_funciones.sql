-- =====================================================================
-- SRA Project Management v2 · 02 · Funciones, reglas de negocio y auditoría
-- Requiere el esquema «auth» de Supabase (auth.uid(), auth.jwt()).
-- =====================================================================

-- ---------- Quién soy y qué puedo hacer ----------
create or replace function sra.yo() returns uuid
language sql stable security definer set search_path = sra, public as $$
  select id from sra.personas where auth_user_id = auth.uid() and not inactivo
$$;

create or replace function sra.mfa_ok() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;
comment on function sra.mfa_ok() is 'Verdadero solo si la sesión pasó la doble verificación (AAL2).';

create or replace function sra.es_admin() returns boolean
language sql stable security definer set search_path = sra, public as $$
  select exists (select 1 from sra.personas where id = sra.yo() and rol = 'admin')
$$;

create or replace function sra.es_ceo() returns boolean
language sql stable security definer set search_path = sra, public as $$
  select exists (select 1 from sra.personas where id = sra.yo() and es_ceo)
$$;

create or replace function sra.tiene_panel(p sra.panel_t) returns boolean
language sql stable security definer set search_path = sra, public as $$
  select sra.es_admin() or sra.es_ceo()
      or exists (select 1 from sra.persona_paneles where persona_id = sra.yo() and panel = p)
$$;

create or replace function sra.es_director(p sra.panel_t) returns boolean
language sql stable security definer set search_path = sra, public as $$
  select exists (select 1 from sra.persona_paneles where persona_id = sra.yo() and panel = p and es_director)
$$;

create or replace function sra.hay_director(p sra.panel_t) returns boolean
language sql stable security definer set search_path = sra, public as $$
  select exists (select 1 from sra.persona_paneles pp join sra.personas pe on pe.id = pp.persona_id
                 where pp.panel = p and pp.es_director and not pe.inactivo)
$$;

create or replace function sra.hay_ceo() returns boolean
language sql stable security definer set search_path = sra, public as $$
  select exists (select 1 from sra.personas where es_ceo and not inactivo)
$$;

create or replace function sra.ve_proyecto(pid uuid) returns boolean
language sql stable security definer set search_path = sra, public as $$
  select exists (select 1 from sra.proyectos p where p.id = pid and sra.tiene_panel(p.panel))
$$;

create or replace function sra.gestiona(pid uuid) returns boolean
language sql stable security definer set search_path = sra, public as $$
  select sra.es_admin()
      or exists (select 1 from sra.proyectos where id = pid and encargado_id = sra.yo())
      or exists (select 1 from sra.proyecto_personas where proyecto_id = pid and persona_id = sra.yo() and rol = 'coencargado')
$$;
comment on function sra.gestiona(uuid) is 'Administrador, encargado o coencargado del proyecto.';

create or replace function sra.prepara(pid uuid) returns boolean
language sql stable security definer set search_path = sra, public as $$
  select sra.gestiona(pid) or exists (select 1 from sra.proyectos where id = pid and residente_id = sra.yo())
$$;
comment on function sra.prepara(uuid) is 'Gestiona el proyecto o es su residente de obra.';

create or replace function sra.ve_tarea(tid uuid) returns boolean
language sql stable security definer set search_path = sra, public as $$
  select exists (
    select 1 from sra.tareas t
    where t.id = tid and (
      sra.es_admin()
      or (t.proyecto_id is not null and sra.ve_proyecto(t.proyecto_id))
      or (t.proyecto_id is null and (sra.yo() in (t.responsable_id, t.verificador_id, t.creado_por)
          or exists (select 1 from sra.tarea_personas tp where tp.tarea_id = t.id and tp.persona_id = sra.yo())))
    ))
$$;

create or replace function sra.ve_presupuesto(pid uuid) returns boolean
language sql stable security definer set search_path = sra, public as $$
  select sra.prepara(pid) or sra.es_ceo()
$$;
comment on function sra.ve_presupuesto(uuid) is 'Valores de obra: solo residente, encargados, CEO y administrador.';

-- ---------- Festivos de Colombia y días hábiles ----------
create or replace function sra.pascua(anio int) returns date
language plpgsql immutable as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int; mes int; dia int;
begin
  a := anio % 19; b := anio / 100; c := anio % 100; d := b / 4; e := b % 4;
  f := (b + 8) / 25; g := (b - f + 1) / 3; h := (19*a + b - d - g + 15) % 30;
  i := c / 4; k := c % 4; l := (32 + 2*e + 2*i - h - k) % 7; m := (a + 11*h + 22*l) / 451;
  mes := (h + l - 7*m + 114) / 31; dia := ((h + l - 7*m + 114) % 31) + 1;
  return make_date(anio, mes, dia);
end $$;

create or replace function sra.lunes_siguiente(d date) returns date
language sql immutable as $$
  select case when extract(isodow from d) = 1 then d else d + ((8 - extract(isodow from d)::int) % 7) end
$$;
comment on function sra.lunes_siguiente(date) is 'Ley Emiliani: traslada el festivo al lunes siguiente.';

create or replace function sra.generar_festivos(anio int) returns int
language plpgsql security definer set search_path = sra, public as $$
declare p date := sra.pascua(anio); n int;
begin
  insert into sra.festivos (fecha, nombre) values
    (make_date(anio,1,1),  'Año Nuevo'),
    (sra.lunes_siguiente(make_date(anio,1,6)),  'Reyes Magos'),
    (sra.lunes_siguiente(make_date(anio,3,19)), 'San José'),
    (p - 3, 'Jueves Santo'),
    (p - 2, 'Viernes Santo'),
    (make_date(anio,5,1),  'Día del Trabajo'),
    (p + 43, 'Ascensión del Señor'),
    (p + 64, 'Corpus Christi'),
    (p + 71, 'Sagrado Corazón'),
    (sra.lunes_siguiente(make_date(anio,6,29)), 'San Pedro y San Pablo'),
    (make_date(anio,7,20), 'Independencia de Colombia'),
    (make_date(anio,8,7),  'Batalla de Boyacá'),
    (sra.lunes_siguiente(make_date(anio,8,15)), 'Asunción de la Virgen'),
    (sra.lunes_siguiente(make_date(anio,10,12)), 'Día de la Raza'),
    (sra.lunes_siguiente(make_date(anio,11,1)), 'Todos los Santos'),
    (sra.lunes_siguiente(make_date(anio,11,11)), 'Independencia de Cartagena'),
    (make_date(anio,12,8), 'Inmaculada Concepción'),
    (make_date(anio,12,25),'Navidad')
  on conflict (fecha) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function sra.es_habil(d date) returns boolean
language sql stable security definer set search_path = sra, public as $$
  select extract(isodow from d) < 6 and not exists (select 1 from sra.festivos where fecha = d)
$$;

create or replace function sra.sumar_habiles(d date, n int) returns date
language plpgsql stable as $$
declare r date := d; k int := 0;
begin
  if d is null then return null; end if;
  while k < n loop r := r + 1; if sra.es_habil(r) then k := k + 1; end if; end loop;
  return r;
end $$;

create or replace function sra.festivos_entre(a date, b date) returns int
language sql stable security definer set search_path = sra, public as $$
  select count(*)::int from sra.festivos where fecha > a and fecha <= b and extract(isodow from fecha) < 6
$$;
comment on function sra.festivos_entre(date, date) is 'Festivos entre semana después de a y hasta b.';

-- Días que suman los cambios de alcance aprobados que aplican a una fecha planeada
create or replace function sra.dias_alcance(pid uuid, fecha date) returns int
language sql stable security definer set search_path = sra, public as $$
  select coalesce(sum(dias_habiles), 0)::int from sra.cambios_alcance
  where proyecto_id = pid and estado = 'aprobado' and desde <= fecha
$$;

-- Fecha efectiva: fecha planeada + cambios de alcance aprobados + un día hábil por cada festivo de por medio.
-- Si cae en día no hábil, pasa al siguiente día hábil. La fecha planeada nunca se modifica.
create or replace function sra.fecha_efectiva(pid uuid, base date, fecha date) returns date
language plpgsql stable as $$
declare f date; n int;
begin
  if fecha is null then return null; end if;
  f := sra.sumar_habiles(fecha, sra.dias_alcance(pid, fecha));
  n := sra.festivos_entre(coalesce(base, fecha), f);
  if n > 0 then f := sra.sumar_habiles(f, n); end if;
  while not sra.es_habil(f) loop f := f + 1; end loop;
  return f;
end $$;

-- ---------- Jornada: horas ordinarias y extra ----------
create or replace function sra.cfg(clave text) returns jsonb
language sql stable security definer set search_path = sra, public as $$
  select valor from sra.config where config.clave = cfg.clave
$$;

create or replace function sra.horas_jornada(p_persona uuid, p_fecha date)
returns table (ordinarias numeric, extra numeric)
language plpgsql stable security definer set search_path = sra, public as $$
declare j sra.jornadas; zona text := coalesce(sra.cfg('jornada') ->> 'zona', 'America/Bogota');
        corte timestamptz; fin_j timestamptz; ord numeric := 0; ext numeric := 0;
begin
  select * into j from sra.jornadas where persona_id = p_persona and fecha = p_fecha;
  if j.entrada is null then return query select 0::numeric, 0::numeric; return; end if;
  corte := (p_fecha + (coalesce(sra.cfg('jornada') ->> 'fin', '17:40'))::time) at time zone zona;
  fin_j := coalesce(j.salida, now());
  -- tiempo trabajado menos pausas, partido en el corte de la jornada
  select coalesce(sum(extract(epoch from (least(b, corte) - a)) / 3600) filter (where least(b, corte) > a), 0),
         coalesce(sum(extract(epoch from (b - greatest(a, corte))) / 3600) filter (where b > greatest(a, corte)), 0)
    into ord, ext
  from (
    select lower(r) as a, upper(r) as b
    from unnest(
      tstzmultirange(tstzrange(j.entrada, fin_j)) -
      coalesce((select range_agg(tstzrange(desde, coalesce(hasta, fin_j))) from sra.jornada_pausas
                where persona_id = p_persona and fecha = p_fecha), '{}'::tstzmultirange)
    ) as r
  ) s;
  return query select round(ord, 2), round(ext, 2);
end $$;
comment on function sra.horas_jornada(uuid, date) is 'Ordinarias hasta las 5:40 p. m. (configurable), extra después; descuenta pausas.';

-- ---------- Marcas de tiempo y protección ----------
-- Verdadero para migraciones y procesos del servidor; falso para cualquier persona que entra por la app.
-- (Dentro de funciones «security definer» current_user es el dueño, por eso se mira el rol de la sesión.)
create or replace function sra.es_sistema() returns boolean
language sql stable as $$
  select coalesce(nullif(current_setting('role', true), ''), 'none') not in ('authenticated', 'anon')
$$;
create or replace function sra.tocar() returns trigger language plpgsql as $$
begin new.actualizado_en := now(); return new; end $$;

create or replace function sra.no_borrar() returns trigger language plpgsql as $$
begin
  raise exception 'En SRA los registros no se borran: archívalos, anúlalos o márcalos como inactivos (%).', tg_table_name
    using errcode = 'P0001';
end $$;

-- Auditoría genérica: guarda qué cambió, quién y cuándo
create or replace function sra.auditar() returns trigger
language plpgsql security definer set search_path = sra, public as $$
declare rid text; cambios jsonb;
begin
  if tg_op = 'DELETE' then
    rid := coalesce(to_jsonb(old) ->> 'id', to_jsonb(old) ->> 'proyecto_id', to_jsonb(old) ->> 'persona_id');
    cambios := to_jsonb(old);
  elsif tg_op = 'INSERT' then
    rid := coalesce(to_jsonb(new) ->> 'id', to_jsonb(new) ->> 'proyecto_id', to_jsonb(new) ->> 'persona_id');
    cambios := to_jsonb(new);
  else
    rid := coalesce(to_jsonb(new) ->> 'id', to_jsonb(new) ->> 'proyecto_id', to_jsonb(new) ->> 'persona_id');
    select coalesce(jsonb_object_agg(n.key, jsonb_build_object('antes', o.value, 'despues', n.value)), '{}'::jsonb)
      into cambios
    from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value and n.key not in ('actualizado_en');
    if cambios = '{}'::jsonb then return new; end if;
  end if;
  insert into sra.auditoria (tabla, registro_id, accion, cambios, por) values (tg_table_name, coalesce(rid, '?'), tg_op, cambios, sra.yo());
  return coalesce(new, old);
end $$;

-- Personas: solo el administrador cambia rol, CEO, usuario, correo, estado o enlace de acceso
create or replace function sra.guardia_personas() returns trigger language plpgsql
security definer set search_path = sra, public as $$
begin
  if sra.es_sistema() or sra.es_admin() then return new; end if;
  if new.rol is distinct from old.rol or new.es_ceo is distinct from old.es_ceo or new.usuario is distinct from old.usuario
     or new.email is distinct from old.email or new.inactivo is distinct from old.inactivo
     or new.auth_user_id is distinct from old.auth_user_id or new.nombre is distinct from old.nombre then
    raise exception 'Solo el administrador puede cambiar nombre, rol, CEO, usuario, correo o estado.' using errcode = '42501';
  end if;
  return new;
end $$;

-- Entregas: el estado solo cambia por sra.mover_entrega (cadena de revisión)
create or replace function sra.guardia_entregas() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.estado is distinct from old.estado
     and coalesce(current_setting('sra.flujo', true), '') <> 'on'
     and not sra.es_sistema() then
    raise exception 'El estado de una entrega solo cambia con sra.mover_entrega().' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and new.estado <> 'pendiente' and not sra.es_sistema() then
    raise exception 'Una entrega nueva empieza en «pendiente».' using errcode = '42501';
  end if;
  return new;
end $$;

-- Bitácora: sin plan de obra aprobado no se ejecuta
create or replace function sra.guardia_bitacora() returns trigger language plpgsql
security definer set search_path = sra, public as $$
begin
  if sra.es_sistema() then return new; end if;
  if not exists (select 1 from sra.planes_obra where proyecto_id = new.proyecto_id and estado = 'aprobado') then
    raise exception 'Primero el CEO debe aprobar el plan de obra (cronograma y presupuesto).' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Partidas: la estructura solo cambia en borrador o devuelto; el avance solo cuando está aprobado
create or replace function sra.guardia_partidas() returns trigger language plpgsql
security definer set search_path = sra, public as $$
declare est sra.estado_plan_t;
begin
  if sra.es_sistema() then return coalesce(new, old); end if;
  select estado into est from sra.planes_obra where proyecto_id = coalesce(new.proyecto_id, old.proyecto_id);
  if tg_op = 'UPDATE' and est = 'aprobado' then
    if (new.nombre, new.valor, new.inicio, new.fin, new.orden) is distinct from (old.nombre, old.valor, old.inicio, old.fin, old.orden) then
      raise exception 'El plan está aprobado: solo se actualiza el avance. Para cambiar partidas, el CEO debe reabrirlo.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if est not in ('borrador', 'devuelto') then
    raise exception 'Las partidas solo se editan con el plan en borrador o devuelto.' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.avance is distinct from old.avance then
    raise exception 'El avance se registra después de aprobar el plan.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

-- Registros de horas: cada quien registra lo suyo; corrige y anula solo el administrador
create or replace function sra.guardia_horas() returns trigger language plpgsql
security definer set search_path = sra, public as $$
begin
  if sra.es_sistema() then return new; end if;
  if tg_op = 'INSERT' and new.persona_id is distinct from sra.yo() and not sra.es_admin() then
    raise exception 'Solo puedes registrar tus propias horas.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and not sra.es_admin() then
    raise exception 'Solo el administrador corrige o anula horas, con motivo.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.horas is distinct from old.horas then
    new.horas_originales := coalesce(old.horas_originales, old.horas);
    new.corregido_por := sra.yo(); new.corregido_en := now();
  end if;
  if tg_op = 'UPDATE' and new.anulado and not old.anulado then
    new.anulado_por := sra.yo(); new.anulado_en := now();
  end if;
  return new;
end $$;

-- ---------- Flujos con reglas (se llaman desde la app) ----------
-- Cadena: Diseños y Administrativo: encargado → director → CEO (GO) → cliente → aprobado/observaciones.
--         Obras: residente → CEO (GO) → cliente. Toda devolución vuelve a «pendiente» con comentario.
create or replace function sra.mover_entrega(p_id uuid, p_a sra.estado_entrega_t, p_nota text default '', p_link text default null)
returns sra.entregas
language plpgsql security definer set search_path = sra, public as $$
declare e sra.entregas; pr sra.proyectos; de sra.estado_entrega_t; ok boolean := false; devolver boolean := false;
begin
  if not sra.mfa_ok() then raise exception 'Se requiere doble verificación.' using errcode = '42501'; end if;
  select * into e from sra.entregas where id = p_id for update;
  if not found then raise exception 'Entrega no encontrada.'; end if;
  select * into pr from sra.proyectos where id = e.proyecto_id;
  de := e.estado;
  if de in ('pendiente', 'observaciones') and sra.prepara(pr.id) then
    ok := (pr.panel = 'obras' and p_a = 'rev_ceo') or (pr.panel <> 'obras' and p_a = 'rev_director');
  elsif de = 'rev_director' and (sra.es_director(pr.panel) or sra.es_admin()) then
    ok := p_a in ('rev_ceo', 'pendiente'); devolver := p_a = 'pendiente';
  elsif de = 'rev_ceo' and (sra.es_ceo() or sra.es_admin()) then
    ok := p_a in ('go', 'pendiente'); devolver := p_a = 'pendiente';
  elsif de = 'go' and sra.prepara(pr.id) then
    ok := p_a = 'cliente';
  elsif de = 'cliente' and sra.prepara(pr.id) then
    ok := p_a in ('observaciones', 'aprobado');
  end if;
  if not ok then raise exception 'No te corresponde mover esta entrega de % a %.', de, p_a using errcode = '42501'; end if;
  if (devolver or p_a = 'observaciones') and coalesce(trim(p_nota), '') = '' then
    raise exception 'Escribe los comentarios: son obligatorios al devolver o registrar observaciones.' using errcode = 'P0001';
  end if;
  if p_a in ('rev_director', 'cliente') or (p_a = 'rev_ceo' and de in ('pendiente', 'observaciones')) then
    if coalesce(trim(coalesce(p_link, e.link_nas)), '') = '' then
      raise exception 'Pega el Link NAS de la entrega.' using errcode = 'P0001';
    end if;
  end if;
  perform set_config('sra.flujo', 'on', true);
  update sra.entregas set
    estado = p_a,
    link_nas = coalesce(nullif(trim(p_link), ''), link_nas),
    go_por = case when p_a = 'go' then sra.yo() else go_por end,
    go_en  = case when p_a = 'go' then now() else go_en end,
    rondas = case when p_a = 'cliente' then rondas + 1 else rondas end,
    enviado_en = case when p_a = 'cliente' then now() else enviado_en end,
    aprobado_en = case when p_a = 'aprobado' then now() else aprobado_en end,
    actualizado_en = now()
  where id = p_id returning * into e;
  perform set_config('sra.flujo', '', true);
  insert into sra.entrega_historial (entrega_id, de, a, devuelta, nota, link_nas, por)
  values (p_id, de, p_a, devolver, coalesce(p_nota, ''), coalesce(p_link, ''), sra.yo());
  return e;
end $$;

create or replace function sra.mover_plan(p_proyecto uuid, p_a sra.estado_plan_t, p_nota text default '')
returns sra.planes_obra
language plpgsql security definer set search_path = sra, public as $$
declare pl sra.planes_obra; ok boolean := false; n int;
begin
  if not sra.mfa_ok() then raise exception 'Se requiere doble verificación.' using errcode = '42501'; end if;
  select * into pl from sra.planes_obra where proyecto_id = p_proyecto for update;
  if not found then raise exception 'El proyecto no tiene plan de obra.'; end if;
  if pl.estado in ('borrador', 'devuelto') and p_a = 'enviado' and sra.prepara(p_proyecto) then
    select count(*) into n from sra.partidas where proyecto_id = p_proyecto;
    if n = 0 then raise exception 'Agrega al menos una partida antes de enviar.' using errcode = 'P0001'; end if;
    ok := true;
  elsif pl.estado = 'enviado' and p_a in ('aprobado', 'devuelto') and (sra.es_ceo() or sra.es_admin()) then ok := true;
  elsif pl.estado = 'aprobado' and p_a = 'borrador' and (sra.es_ceo() or sra.es_admin()) then ok := true;
  end if;
  if not ok then raise exception 'No te corresponde pasar el plan de % a %.', pl.estado, p_a using errcode = '42501'; end if;
  if p_a in ('devuelto', 'borrador') and coalesce(trim(p_nota), '') = '' then
    raise exception 'Escribe el motivo o los comentarios.' using errcode = 'P0001';
  end if;
  update sra.planes_obra set estado = p_a, nota = coalesce(p_nota, ''),
    enviado_en = case when p_a = 'enviado' then now() else enviado_en end,
    aprobado_por = case when p_a = 'aprobado' then sra.yo() else aprobado_por end,
    aprobado_en = case when p_a = 'aprobado' then now() else aprobado_en end,
    preparado_por = case when p_a = 'enviado' then sra.yo() else preparado_por end,
    actualizado_en = now()
  where proyecto_id = p_proyecto returning * into pl;
  insert into sra.plan_historial (proyecto_id, estado, nota, por) values (p_proyecto, p_a, coalesce(p_nota, ''), sra.yo());
  return pl;
end $$;

-- Avance ponderado por valor de partida
create or replace function sra.avance_ponderado(p_proyecto uuid) returns numeric
language sql stable security definer set search_path = sra, public as $$
  select case when sum(valor) > 0 then round(sum(valor * avance) / sum(valor), 1) end
  from sra.partidas where proyecto_id = p_proyecto
$$;

create or replace function sra.registrar_avance(p_proyecto uuid) returns numeric
language plpgsql security definer set search_path = sra, public as $$
declare a numeric;
begin
  if not sra.prepara(p_proyecto) then raise exception 'No te corresponde.' using errcode = '42501'; end if;
  a := sra.avance_ponderado(p_proyecto);
  insert into sra.avance_obra (proyecto_id, fecha, avance, por) values (p_proyecto, current_date, coalesce(a, 0), sra.yo())
  on conflict (proyecto_id, fecha) do update set avance = excluded.avance, por = excluded.por;
  return a;
end $$;

-- Cronómetro: al detenerlo, reparte el tiempo por día en registros de horas
create or replace function sra.detener_cronometro(p_persona uuid default null, p_hasta timestamptz default now(), p_nota text default 'Cronómetro')
returns int
language plpgsql security definer set search_path = sra, public as $$
declare c sra.cronometros; t sra.tareas; a timestamptz; b timestamptz; zona text := coalesce(sra.cfg('jornada') ->> 'zona', 'America/Bogota'); n int := 0;
begin
  p_persona := coalesce(p_persona, sra.yo());
  if p_persona is distinct from sra.yo() and not sra.es_admin() and not sra.es_sistema() then
    raise exception 'Solo puedes detener tu cronómetro.' using errcode = '42501';
  end if;
  delete from sra.cronometros where persona_id = p_persona returning * into c;
  if c.persona_id is null then return 0; end if;
  select * into t from sra.tareas where id = c.tarea_id;
  a := c.desde;
  while a < p_hasta loop
    b := least(p_hasta, ((a at time zone zona)::date + 1)::timestamp at time zone zona);
    if extract(epoch from (b - a)) >= 60 then
      insert into sra.registros_horas (tarea_id, proyecto_id, persona_id, fecha, inicio, fin, horas, nota)
      values (t.id, t.proyecto_id, p_persona, (a at time zone zona)::date, a, b, round(extract(epoch from (b - a)) / 3600, 3), p_nota);
      n := n + 1;
    end if;
    a := b;
  end loop;
  return n;
end $$;

-- Cierra cronómetros olvidados de días anteriores (se programa cada noche)
create or replace function sra.cerrar_cronometros_olvidados() returns int
language plpgsql security definer set search_path = sra, public as $$
declare c record; n int := 0; zona text := coalesce(sra.cfg('jornada') ->> 'zona', 'America/Bogota'); hasta timestamptz;
begin
  for c in select * from sra.cronometros where (desde at time zone zona)::date < (now() at time zone zona)::date loop
    select coalesce(j.salida, least(c.desde + interval '4 hours', ((c.desde at time zone zona)::date + 1)::timestamp at time zone zona - interval '1 minute'))
      into hasta from (select 1) x left join sra.jornadas j on j.persona_id = c.persona_id and j.fecha = (c.desde at time zone zona)::date and j.salida > c.desde;
    perform sra.detener_cronometro(c.persona_id, hasta, 'Cerrado automáticamente (cronómetro olvidado) · revisar');
    n := n + 1;
  end loop;
  return n;
end $$;

-- Enlaza el usuario de Supabase Auth con su persona la primera vez que entra (por correo)
create or replace function sra.enlazar_mi_cuenta() returns uuid
language plpgsql security definer set search_path = sra, public as $$
declare pid uuid; mail text := lower(auth.jwt() ->> 'email');
begin
  select id into pid from sra.personas where auth_user_id = auth.uid();
  if pid is not null then return pid; end if;
  update sra.personas set auth_user_id = auth.uid()
  where lower(email) = mail and auth_user_id is null and not inactivo returning id into pid;
  return pid;
end $$;

-- ---------- Vistas (respetan las reglas de acceso de quien consulta) ----------
create or replace view sra.v_entregas with (security_invoker = true) as
select e.*,
       sra.fecha_efectiva(e.proyecto_id, coalesce(p.inicio, et.inicio, e.creado_en::date), e.fecha) as fecha_efectiva,
       sra.dias_alcance(e.proyecto_id, e.fecha) as dias_alcance
from sra.entregas e
join sra.proyectos p on p.id = e.proyecto_id
left join sra.etapas et on et.id = e.etapa_id;

create or replace view sra.v_proyectos with (security_invoker = true) as
select p.*,
       sra.fecha_efectiva(p.id, p.inicio, p.fin) as fin_efectivo,
       sra.dias_alcance(p.id, p.fin) as dias_alcance,
       (select e.nombre from sra.etapas e where e.proyecto_id = p.id and e.estado = 'curso' order by e.orden limit 1) as etapa_actual,
       tp.nombre as tipo, coalesce(st.nombre, p.subtipo_libre) as subtipo,
       case when p.panel = 'obras' then sra.avance_ponderado(p.id) end as avance_fisico
from sra.proyectos p
left join sra.tipos_proyecto tp on tp.id = p.tipo_id
left join sra.subtipos st on st.id = p.subtipo_id;

create or replace view sra.v_tareas with (security_invoker = true) as
select t.*,
       sra.fecha_efectiva(t.proyecto_id, coalesce(t.inicio, t.creado_en::date), t.limite) as limite_efectivo,
       (select coalesce(sum(h.horas), 0) from sra.registros_horas h where h.tarea_id = t.id and not h.anulado) as horas
from sra.tareas t;

create or replace view sra.v_jornadas with (security_invoker = true) as
select j.*, h.ordinarias, h.extra
from sra.jornadas j, lateral sra.horas_jornada(j.persona_id, j.fecha) h;
