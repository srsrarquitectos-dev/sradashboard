-- =====================================================================
-- SRA Project Management v2 · 04 · Catálogos, plantillas, configuración y festivos
-- Tipos, subtipos y etapas tal como están hoy en la mesa (plantillas provisionales).
-- =====================================================================

insert into sra.config (clave, valor) values
  ('jornada', '{"inicio": "08:20", "fin": "17:40", "zona": "America/Bogota", "nota": "Lo trabajado después del fin cuenta como hora extra."}'),
  ('seguridad', '{"sesion_horas": 12, "verificacion_reciente_min": 15, "intentos_codigo": 5, "bloqueo_min": 15}'),
  ('visita_residente_habiles', '3')
on conflict (clave) do nothing;

-- Tipos por panel (Obras usa los mismos tipos de Diseños)
with t(panel, nombre, orden) as (values
  ('disenos'::sra.panel_t, 'Vivienda', 1), ('disenos', 'Comercial', 2), ('disenos', 'Gestión de proyectos', 3),
  ('disenos', 'Urbano / master plan', 4), ('disenos', 'Corporativo', 5),
  ('obras', 'Vivienda', 1), ('obras', 'Comercial', 2), ('obras', 'Gestión de proyectos', 3),
  ('obras', 'Urbano / master plan', 4), ('obras', 'Corporativo', 5),
  ('administrativo', 'Contratos', 1), ('administrativo', 'Procesos internos', 2))
insert into sra.tipos_proyecto (panel, nombre, orden) select panel, nombre, orden from t
on conflict (panel, nombre) do nothing;

with s(tipo, nombre, orden) as (values
  ('Vivienda', 'Obra nueva', 1), ('Vivienda', 'Remodelación', 2),
  ('Comercial', 'Restaurantes', 1), ('Comercial', 'Bares', 2), ('Comercial', 'Centros comerciales', 3),
  ('Comercial', 'Hoteles', 4), ('Comercial', 'Contenido para Instagram', 5),
  ('Gestión de proyectos', 'Urbanizaciones', 1),
  ('Urbano / master plan', 'Diagnóstico territorial', 1), ('Urbano / master plan', 'Planes maestros', 2),
  ('Corporativo', 'Oficina', 1))
insert into sra.subtipos (tipo_id, nombre, orden)
select tp.id, s.nombre, s.orden from s join sra.tipos_proyecto tp on tp.nombre = s.tipo and tp.panel in ('disenos', 'obras')
on conflict (tipo_id, nombre) do nothing;

with e(tipo, orden, nombre) as (values
  ('Vivienda', 1, 'Levantamiento y diagnóstico'), ('Vivienda', 2, 'Concepto / esquema básico'), ('Vivienda', 3, 'Anteproyecto'),
  ('Vivienda', 4, 'Proyecto arquitectónico'), ('Vivienda', 5, 'Proyecto ejecutivo y técnico'), ('Vivienda', 6, 'Licencia y trámites'),
  ('Comercial', 1, 'Programa y brief'), ('Comercial', 2, 'Concepto'), ('Comercial', 3, 'Anteproyecto'),
  ('Comercial', 4, 'Proyecto arquitectónico'), ('Comercial', 5, 'Interiorismo y especialidades'), ('Comercial', 6, 'Proyecto ejecutivo'),
  ('Comercial', 7, 'Licencia y trámites'),
  ('Gestión de proyectos', 1, 'Estudio de factibilidad'), ('Gestión de proyectos', 2, 'Planteamiento urbanístico'),
  ('Gestión de proyectos', 3, 'Trámites y licencias de urbanismo'), ('Gestión de proyectos', 4, 'Diseño de redes e infraestructura'),
  ('Gestión de proyectos', 5, 'Proyecto arquitectónico tipo'), ('Gestión de proyectos', 6, 'Seguimiento de ejecución'),
  ('Urbano / master plan', 1, 'Diagnóstico territorial'), ('Urbano / master plan', 2, 'Visión y estrategia'),
  ('Urbano / master plan', 3, 'Propuesta preliminar'), ('Urbano / master plan', 4, 'Plan maestro'),
  ('Urbano / master plan', 5, 'Fases e implementación'), ('Urbano / master plan', 6, 'Entrega final'),
  ('Contratos', 1, 'Solicitud'), ('Contratos', 2, 'Elaboración'), ('Contratos', 3, 'Revisión jurídica'),
  ('Contratos', 4, 'Negociación'), ('Contratos', 5, 'Firma'), ('Contratos', 6, 'Seguimiento'),
  ('Procesos internos', 1, 'Planeación'), ('Procesos internos', 2, 'Ejecución'), ('Procesos internos', 3, 'Revisión'), ('Procesos internos', 4, 'Cierre'))
insert into sra.plantilla_etapas (tipo_id, orden, nombre)
select tp.id, e.orden, e.nombre from e join sra.tipos_proyecto tp on tp.nombre = e.tipo and tp.panel in ('disenos', 'administrativo')
on conflict (tipo_id, orden) do nothing;

-- Festivos de Colombia 2025 a 2035
select sra.generar_festivos(y) from generate_series(2025, 2035) y;
