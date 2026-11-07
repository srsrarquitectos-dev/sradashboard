-- =====================================================================
-- SRA Project Management v2 · 01 · Esquema de tablas
-- PostgreSQL 15+ / Supabase. Ejecutar en orden: 01, 02, 03, 04, 05.
-- Principios: nada se borra (se archiva o se anula), todo cambio queda
-- en auditoría, y las reglas de acceso viven en la base de datos.
-- =====================================================================

create extension if not exists pgcrypto;

create schema if not exists sra;
comment on schema sra is 'SRA Project Management v2';

-- ---------- Tipos enumerados ----------
create type sra.panel_t           as enum ('disenos', 'obras', 'administrativo');
create type sra.rol_t             as enum ('admin', 'equipo');
create type sra.estado_proyecto_t as enum ('activo', 'pausa', 'terminado', 'archivado');
create type sra.nivel_t           as enum ('alta', 'media', 'baja');
create type sra.estado_etapa_t    as enum ('pendiente', 'curso', 'terminada');
create type sra.estado_entrega_t  as enum ('pendiente', 'rev_director', 'rev_ceo', 'go', 'cliente', 'observaciones', 'aprobado');
create type sra.estado_cambio_t   as enum ('propuesto', 'aprobado', 'rechazado');
create type sra.estado_tarea_t    as enum ('pendiente', 'progreso', 'revision', 'completada', 'aplazada', 'archivada');
create type sra.prioridad_tarea_t as enum ('normal', 'alta');
create type sra.estado_entregable_t as enum ('enviado', 'aprobado', 'devuelto');
create type sra.rol_proyecto_t    as enum ('coencargado', 'equipo');
create type sra.rol_tarea_t       as enum ('participante', 'observador');
create type sra.estado_reunion_t  as enum ('programada', 'realizada', 'cancelada');
create type sra.tipo_bitacora_t   as enum ('diario', 'visita');
create type sra.estado_plan_t     as enum ('borrador', 'enviado', 'devuelto', 'aprobado');
create type sra.clase_obra_t      as enum ('incidencia', 'pendiente', 'permiso', 'consulta');

-- ---------- Personas y accesos ----------
create table sra.personas (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique,                 -- usuario de Supabase Auth (se enlaza al aceptar la invitación)
  email         text unique,
  usuario       text unique check (usuario ~ '^[a-z0-9._-]{3,32}$'),
  nombre        text not null check (length(trim(nombre)) > 0),
  cargo         text not null default '',
  rol           sra.rol_t not null default 'equipo',
  es_ceo        boolean not null default false,
  color         text not null default '#2340B0',
  foto_path     text,                        -- ruta en el bucket privado «perfiles»
  inactivo      boolean not null default false,
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  id_origen     text unique                  -- id en la mesa v1 (migración)
);
comment on table sra.personas is 'Equipo de SRA. Nunca se borra: se marca inactivo.';

create table sra.persona_paneles (
  persona_id  uuid not null references sra.personas(id),
  panel       sra.panel_t not null,
  es_director boolean not null default false,   -- director de Diseños o director Administrativo
  primary key (persona_id, panel)
);
comment on table sra.persona_paneles is 'Paneles a los que entra cada persona y si dirige ese panel.';

-- ---------- Catálogos ----------
create table sra.tipos_proyecto (
  id     smallint generated always as identity primary key,
  panel  sra.panel_t not null,
  nombre text not null,
  orden  smallint not null default 0,
  activo boolean not null default true,
  unique (panel, nombre)
);
create table sra.subtipos (
  id      smallint generated always as identity primary key,
  tipo_id smallint not null references sra.tipos_proyecto(id),
  nombre  text not null,
  orden   smallint not null default 0,
  activo  boolean not null default true,
  unique (tipo_id, nombre)
);
create table sra.plantilla_etapas (
  id      smallint generated always as identity primary key,
  tipo_id smallint not null references sra.tipos_proyecto(id),
  orden   smallint not null,
  nombre  text not null,
  unique (tipo_id, orden)
);
comment on table sra.plantilla_etapas is 'Plantillas provisionales de etapas por tipo (se validan con el CEO).';

create table sra.festivos (
  fecha  date primary key,
  nombre text not null
);
create table sra.config (
  clave text primary key,
  valor jsonb not null,
  actualizado_en timestamptz not null default now()
);

-- ---------- Proyectos ----------
create table sra.proyectos (
  id             uuid primary key default gen_random_uuid(),
  panel          sra.panel_t not null default 'disenos',
  nombre         text not null check (length(trim(nombre)) > 0),
  tipo_id        smallint references sra.tipos_proyecto(id),
  subtipo_id     smallint references sra.subtipos(id),
  subtipo_libre  text,                         -- subtipo fuera de catálogo (datos heredados)
  cliente        text not null default '',
  ubicacion      text not null default '',
  inicio         date,
  fin            date,                          -- entrega final planeada (sin festivos ni cambios de alcance)
  estado         sra.estado_proyecto_t not null default 'activo',
  prioridad      sra.nivel_t,
  riesgo         sra.nivel_t,
  ruta_nas       text not null default '',
  descripcion    text not null default '',
  color          text not null default '#2340B0',
  encargado_id   uuid references sra.personas(id),
  residente_id   uuid references sra.personas(id),   -- obras
  contratista    text not null default '',            -- obras
  diseno_origen_id uuid references sra.proyectos(id), -- obras: diseño del que nace
  creado_por     uuid references sra.personas(id),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  id_origen      text unique,
  check (fin is null or inicio is null or fin >= inicio)
);
create index on sra.proyectos (panel, estado);
create index on sra.proyectos (encargado_id);

create table sra.proyecto_personas (
  proyecto_id uuid not null references sra.proyectos(id),
  persona_id  uuid not null references sra.personas(id),
  rol         sra.rol_proyecto_t not null default 'equipo',
  primary key (proyecto_id, persona_id)
);
create index on sra.proyecto_personas (persona_id);

create table sra.etapas (
  id          uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references sra.proyectos(id),
  orden       smallint not null,
  nombre      text not null,
  inicio      date,
  fin         date,
  estado      sra.estado_etapa_t not null default 'pendiente',
  id_origen   text,
  unique (proyecto_id, orden),
  check (fin is null or inicio is null or fin >= inicio)
);

-- ---------- Entregas al cliente y su cadena de revisión ----------
create table sra.entregas (
  id          uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references sra.proyectos(id),
  etapa_id    uuid references sra.etapas(id),
  nombre      text not null,
  fecha       date not null,                  -- fecha planeada
  estado      sra.estado_entrega_t not null default 'pendiente',
  link_nas    text not null default '',
  rondas      smallint not null default 0,
  go_por      uuid references sra.personas(id),
  go_en       timestamptz,
  enviado_en  timestamptz,
  aprobado_en timestamptz,
  creado_por  uuid references sra.personas(id),
  creado_en   timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  id_origen   text unique
);
create index on sra.entregas (proyecto_id, fecha);
create index on sra.entregas (estado);

create table sra.entrega_historial (
  id         bigint generated always as identity primary key,
  entrega_id uuid not null references sra.entregas(id),
  de         sra.estado_entrega_t,
  a          sra.estado_entrega_t not null,
  devuelta   boolean not null default false,
  nota       text not null default '',
  link_nas   text not null default '',
  por        uuid references sra.personas(id),
  en         timestamptz not null default now()
);
create index on sra.entrega_historial (entrega_id, en);

create table sra.cambios_alcance (
  id            uuid primary key default gen_random_uuid(),
  proyecto_id   uuid not null references sra.proyectos(id),
  descripcion   text not null,
  solicitado_por text not null default 'Cliente',
  dias_habiles  smallint not null default 0 check (dias_habiles between 0 and 365),
  desde         date not null default current_date,
  estado        sra.estado_cambio_t not null default 'propuesto',
  aprobado_por  uuid references sra.personas(id),
  aprobado_en   timestamptz,
  creado_por    uuid references sra.personas(id),
  creado_en     timestamptz not null default now(),
  id_origen     text unique
);
create index on sra.cambios_alcance (proyecto_id, estado);

-- ---------- Tareas ----------
create table sra.tareas (
  id             uuid primary key default gen_random_uuid(),
  num            bigint generated always as identity unique,   -- código SRA-n
  panel          sra.panel_t not null default 'disenos',
  proyecto_id    uuid references sra.proyectos(id),
  etapa_id       uuid references sra.etapas(id),
  padre_id       uuid references sra.tareas(id),
  depende_de     uuid references sra.tareas(id),
  titulo         text not null check (length(trim(titulo)) > 0),
  descripcion    text not null default '',
  estado         sra.estado_tarea_t not null default 'pendiente',
  prioridad      sra.prioridad_tarea_t not null default 'normal',
  responsable_id uuid references sra.personas(id),
  verificador_id uuid references sra.personas(id),
  requiere_aprobacion boolean not null default true,
  inicio         date,
  limite         date,                         -- fecha de entrega planeada
  etiquetas      text[] not null default '{}',
  creado_por     uuid references sra.personas(id),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  completada_en  timestamptz,
  id_origen      text unique
);
create index on sra.tareas (proyecto_id, estado);
create index on sra.tareas (responsable_id, estado);
create index on sra.tareas (limite);

create table sra.tarea_personas (
  tarea_id   uuid not null references sra.tareas(id),
  persona_id uuid not null references sra.personas(id),
  rol        sra.rol_tarea_t not null,
  primary key (tarea_id, persona_id)
);
create table sra.tarea_checklist (
  id       uuid primary key default gen_random_uuid(),
  tarea_id uuid not null references sra.tareas(id),
  orden    smallint not null default 0,
  texto    text not null,
  hecho    boolean not null default false
);
create table sra.entregables (
  id        uuid primary key default gen_random_uuid(),
  tarea_id  uuid not null references sra.tareas(id),
  nombre    text not null,
  link_nas  text not null default '',
  estado    sra.estado_entregable_t not null default 'enviado',
  nota      text not null default '',
  por       uuid references sra.personas(id),
  en        timestamptz not null default now(),
  revisado_por uuid references sra.personas(id),
  revisado_en  timestamptz
);
create table sra.comentarios (
  id        uuid primary key default gen_random_uuid(),
  tarea_id  uuid not null references sra.tareas(id),
  autor_id  uuid references sra.personas(id),
  texto     text not null,
  sistema   boolean not null default false,
  en        timestamptz not null default now()
);
create index on sra.comentarios (tarea_id, en);

-- ---------- Tiempo ----------
create table sra.cronometros (
  persona_id uuid primary key references sra.personas(id),   -- uno activo por persona
  tarea_id   uuid not null references sra.tareas(id),
  desde      timestamptz not null default now()
);
create table sra.registros_horas (
  id          uuid primary key default gen_random_uuid(),
  tarea_id    uuid references sra.tareas(id),
  proyecto_id uuid references sra.proyectos(id),
  persona_id  uuid not null references sra.personas(id),
  fecha       date not null,
  inicio      timestamptz,
  fin         timestamptz,
  horas       numeric(6,3) not null check (horas > 0 and horas <= 24),
  nota        text not null default '',
  horas_originales numeric(6,3),
  corregido_por uuid references sra.personas(id),
  corregido_en  timestamptz,
  anulado     boolean not null default false,
  motivo_anulacion text,
  anulado_por uuid references sra.personas(id),
  anulado_en  timestamptz,
  creado_en   timestamptz not null default now(),
  id_origen   text unique,
  check (not anulado or motivo_anulacion is not null)
);
create index on sra.registros_horas (persona_id, fecha);
create index on sra.registros_horas (proyecto_id, fecha);

create table sra.jornadas (
  persona_id uuid not null references sra.personas(id),
  fecha      date not null,
  entrada    timestamptz,
  salida     timestamptz,
  nota       text not null default '',
  editado_por uuid references sra.personas(id),
  editado_en  timestamptz,
  primary key (persona_id, fecha),
  check (salida is null or entrada is null or salida > entrada)
);
create table sra.jornada_pausas (
  id         uuid primary key default gen_random_uuid(),
  persona_id uuid not null,
  fecha      date not null,
  desde      timestamptz not null,
  hasta      timestamptz,
  foreign key (persona_id, fecha) references sra.jornadas(persona_id, fecha),
  check (hasta is null or hasta > desde)
);

-- ---------- Reuniones ----------
create table sra.reuniones (
  id          uuid primary key default gen_random_uuid(),
  proyecto_id uuid references sra.proyectos(id),
  titulo      text not null,
  fecha       date not null,
  hora        time,
  duracion_min smallint,
  lugar       text not null default '',
  tipo        text not null default '',
  estado      sra.estado_reunion_t not null default 'programada',
  externos    text not null default '',
  acuerdos    text not null default '',
  notas       text not null default '',
  creado_por  uuid references sra.personas(id),
  creado_en   timestamptz not null default now(),
  id_origen   text unique
);
create table sra.reunion_personas (
  reunion_id uuid not null references sra.reuniones(id),
  persona_id uuid not null references sra.personas(id),
  primary key (reunion_id, persona_id)
);

-- ---------- Obra: plan predecesor, partidas, bitácora y control ----------
create table sra.planes_obra (
  proyecto_id   uuid primary key references sra.proyectos(id),
  estado        sra.estado_plan_t not null default 'borrador',
  nota          text not null default '',
  preparado_por uuid references sra.personas(id),
  enviado_en    timestamptz,
  aprobado_por  uuid references sra.personas(id),
  aprobado_en   timestamptz,
  actualizado_en timestamptz not null default now()
);
create table sra.partidas (
  id          uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references sra.planes_obra(proyecto_id),
  orden       smallint not null,
  nombre      text not null,
  valor       numeric(16,2) not null check (valor > 0),   -- pesos colombianos
  inicio      date not null,
  fin         date not null,
  avance      numeric(5,2) not null default 0 check (avance between 0 and 100),
  check (fin >= inicio),
  unique (proyecto_id, orden)
);
create table sra.avance_obra (
  proyecto_id uuid not null references sra.planes_obra(proyecto_id),
  fecha       date not null,
  avance      numeric(5,2) not null check (avance between 0 and 100),
  por         uuid references sra.personas(id),
  primary key (proyecto_id, fecha)
);
create table sra.plan_historial (
  id          bigint generated always as identity primary key,
  proyecto_id uuid not null references sra.planes_obra(proyecto_id),
  estado      sra.estado_plan_t not null,
  nota        text not null default '',
  por         uuid references sra.personas(id),
  en          timestamptz not null default now()
);
create table sra.bitacora (
  id          uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references sra.proyectos(id),
  tipo        sra.tipo_bitacora_t not null default 'diario',
  fecha       date not null,
  clima       text not null default '',
  personal    smallint check (personal >= 0),
  actividades text not null,
  novedades   text not null default '',
  autor_id    uuid references sra.personas(id),
  creada_en   timestamptz not null default now(),
  id_origen   text unique
);
create index on sra.bitacora (proyecto_id, fecha desc);
create table sra.obra_items (
  id           uuid primary key default gen_random_uuid(),
  proyecto_id  uuid not null references sra.proyectos(id),
  clase        sra.clase_obra_t not null,
  titulo       text not null,
  detalle      text not null default '',
  responsable  text not null default '',
  ubicacion    text not null default '',
  plazo        date,
  entidad      text not null default '',    -- permisos
  numero       text not null default '',    -- permisos
  vence        date,                         -- permisos
  link_nas     text not null default '',
  estado       text not null,                -- abierta/cerrada · abierto/resuelto · tramite/vigente/cerrado · abierta/respondida
  para_id      uuid references sra.personas(id),   -- consultas: encargado del diseño
  respuesta    text,
  respondida_por uuid references sra.personas(id),
  respondida_en  timestamptz,
  cierre       text not null default '',
  cerrado_por  uuid references sra.personas(id),
  cerrado_en   timestamptz,
  creado_por   uuid references sra.personas(id),
  creado_en    timestamptz not null default now(),
  id_origen    text unique,
  check ((clase = 'incidencia' and estado in ('abierta','cerrada'))
      or (clase = 'pendiente'  and estado in ('abierto','resuelto'))
      or (clase = 'permiso'    and estado in ('tramite','vigente','cerrado'))
      or (clase = 'consulta'   and estado in ('abierta','respondida')))
);
create index on sra.obra_items (proyecto_id, clase, estado);
create index on sra.obra_items (para_id) where clase = 'consulta';

create table sra.fotos (
  id          uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references sra.proyectos(id),
  bitacora_id uuid references sra.bitacora(id),
  obra_item_id uuid references sra.obra_items(id),
  momento     text check (momento in ('antes','despues')),
  storage_path text not null unique,      -- bucket privado «obra»
  subida_por  uuid references sra.personas(id),
  subida_en   timestamptz not null default now(),
  check ((bitacora_id is not null) <> (obra_item_id is not null))
);

-- ---------- Programación semanal publicada ----------
create table sra.programaciones (
  semana       date primary key check (extract(isodow from semana) = 1),   -- lunes
  estado       text not null default 'publicada',
  contenido    jsonb not null,
  publicada_por uuid references sra.personas(id),
  publicada_en timestamptz not null default now()
);

-- ---------- Auditoría (solo agregar) ----------
create table sra.auditoria (
  id         bigint generated always as identity primary key,
  tabla      text not null,
  registro_id text not null,
  accion     text not null check (accion in ('INSERT','UPDATE','DELETE')),
  cambios    jsonb not null,
  por        uuid,
  en         timestamptz not null default now()
);
create index on sra.auditoria (tabla, registro_id, en);
comment on table sra.auditoria is 'Registro inalterable de cambios. Nadie puede editarlo ni borrarlo.';
