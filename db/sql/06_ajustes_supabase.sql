-- =====================================================================
-- SRA Project Management v2 · 06 · Ajustes aplicados al instalar en Supabase (7 nov 2026)
-- Ejecutar después de 05. Ya aplicado en el proyecto de SRA.
-- =====================================================================
-- Horas de jornada: solo las propias, o todas si es administrador o CEO
create or replace function sra.horas_jornada(p_persona uuid, p_fecha date)
returns table (ordinarias numeric, extra numeric)
language plpgsql stable security definer set search_path = sra, public as $$
declare j sra.jornadas; zona text := coalesce(sra.cfg('jornada') ->> 'zona', 'America/Bogota');
        corte timestamptz; fin_j timestamptz; ord numeric := 0; ext numeric := 0;
begin
  if not (sra.es_sistema() or p_persona = sra.yo() or sra.es_admin() or sra.es_ceo()) then
    raise exception 'Solo puedes consultar tu propia jornada.' using errcode = '42501';
  end if;
  select * into j from sra.jornadas where persona_id = p_persona and fecha = p_fecha;
  if j.entrada is null then return query select 0::numeric, 0::numeric; return; end if;
  corte := (p_fecha + (coalesce(sra.cfg('jornada') ->> 'fin', '17:40'))::time) at time zone zona;
  fin_j := coalesce(j.salida, now());
  select coalesce(sum(extract(epoch from (least(b, corte) - a)) / 3600) filter (where least(b, corte) > a), 0),
         coalesce(sum(extract(epoch from (b - greatest(a, corte))) / 3600) filter (where b > greatest(a, corte)), 0)
    into ord, ext
  from (select lower(r) as a, upper(r) as b
        from unnest(tstzmultirange(tstzrange(j.entrada, fin_j)) -
             coalesce((select range_agg(tstzrange(desde, coalesce(hasta, fin_j))) from sra.jornada_pausas
                       where persona_id = p_persona and fecha = p_fecha), '{}'::tstzmultirange)) as r) s;
  return query select round(ord, 2), round(ext, 2);
end $$;
-- Procesos del servidor: no se ejecutan desde la app
revoke execute on function sra.generar_festivos(int), sra.cerrar_cronometros_olvidados() from authenticated;
revoke execute on function sra.programacion_semana(date) from public, anon, authenticated;
grant execute on function sra.programacion_semana(date) to service_role;
-- La regla «quitar» de partidas (plan en borrador o devuelto) necesita el permiso de borrar en esa tabla
grant delete on sra.partidas to authenticated;
-- Security Advisor: ruta de búsqueda fija
alter function sra.mfa_ok() set search_path = sra, public;
alter function sra.pascua(int) set search_path = sra, public;
alter function sra.lunes_siguiente(date) set search_path = sra, public;
alter function sra.sumar_habiles(date, int) set search_path = sra, public;
alter function sra.fecha_efectiva(uuid, date, date) set search_path = sra, public;
alter function sra.es_sistema() set search_path = sra, public;
alter function sra.tocar() set search_path = sra, public;
alter function sra.no_borrar() set search_path = sra, public;
alter function sra.guardia_entregas() set search_path = sra, public;
alter function sra.solo_lectura() set search_path = sra, public;
-- Función de Supabase para «RLS automático»: solo la usa el sistema
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
