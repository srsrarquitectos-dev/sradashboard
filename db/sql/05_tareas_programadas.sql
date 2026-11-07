-- =====================================================================
-- SRA Project Management v2 · 05 · Tareas programadas (pg_cron)
-- Activa pg_cron (también se puede desde Database › Extensions).
-- Horas en UTC: Bogotá = UTC−5.
-- =====================================================================

create extension if not exists pg_cron with schema pg_catalog;

-- Programación de la semana siguiente: por proyecto activo y día hábil, la etapa en curso y las entregas
create or replace function sra.programacion_semana(p_lunes date) returns jsonb
language sql stable security definer set search_path = sra, public as $$
  with dias as (
    select d::date as dia from generate_series(p_lunes, p_lunes + 4, interval '1 day') d
  ), pr as (
    select p.* from sra.proyectos p where p.estado = 'activo'
  )
  select jsonb_build_object(
    'semana', p_lunes,
    'festivos', (select coalesce(jsonb_agg(jsonb_build_object('fecha', f.fecha, 'nombre', f.nombre)), '[]') from sra.festivos f where f.fecha between p_lunes and p_lunes + 4),
    'proyectos', coalesce(jsonb_agg(jsonb_build_object(
      'proyecto_id', pr.id, 'nombre', pr.nombre, 'panel', pr.panel, 'encargado_id', pr.encargado_id,
      'dias', (select jsonb_agg(jsonb_build_object(
          'fecha', d.dia,
          'habil', sra.es_habil(d.dia),
          'etapa', (select e.nombre from sra.etapas e where e.proyecto_id = pr.id
                    and coalesce(e.inicio, pr.inicio, d.dia) <= d.dia
                    and coalesce(sra.fecha_efectiva(pr.id, pr.inicio, e.fin), d.dia) >= d.dia
                    order by e.orden limit 1),
          'entregas', (select coalesce(jsonb_agg(v.nombre), '[]') from sra.v_entregas v
                       where v.proyecto_id = pr.id and v.fecha_efectiva = d.dia and v.estado <> 'aprobado')
        ) order by d.dia) from dias d)
    ) order by pr.nombre), '[]'))
  from pr
$$;

-- Jueves 7:00 a. m. Bogotá: deja lista la programación de la semana siguiente (el administrador la revisa y publica)
select cron.schedule('sra-programacion-jueves', '0 12 * * 4', $$
  insert into sra.programaciones (semana, estado, contenido)
  values (date_trunc('week', now() at time zone 'America/Bogota')::date + 7, 'borrador',
          sra.programacion_semana(date_trunc('week', now() at time zone 'America/Bogota')::date + 7))
  on conflict (semana) do update set contenido = excluded.contenido where sra.programaciones.estado = 'borrador'
$$);

-- Cada noche 11:55 p. m. Bogotá: cierra cronómetros olvidados
select cron.schedule('sra-cronometros', '55 4 * * *', $$ select sra.cerrar_cronometros_olvidados() $$);

-- 1 de diciembre: agrega los festivos del año subsiguiente
select cron.schedule('sra-festivos', '0 12 1 12 *', $$ select sra.generar_festivos(extract(year from now())::int + 2) $$);
