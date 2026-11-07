\set ON_ERROR_STOP 0
\pset tuples_only on
-- Personas de prueba
insert into auth.users values ('00000000-0000-0000-0000-00000000000a','admin@sra.test'),('00000000-0000-0000-0000-00000000000b','ana@sra.test'),
 ('00000000-0000-0000-0000-00000000000c','dir@sra.test'),('00000000-0000-0000-0000-00000000000d','ceo@sra.test'),('00000000-0000-0000-0000-00000000000e','obra@sra.test');
insert into sra.personas (id, auth_user_id, email, usuario, nombre, rol, es_ceo) values
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000a','admin@sra.test','admin','Admin','admin',false),
 ('10000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000b','ana@sra.test','ana','Ana (diseño)','equipo',false),
 ('10000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000c','dir@sra.test','dir','Dir (director diseños)','equipo',false),
 ('10000000-0000-0000-0000-00000000000d','00000000-0000-0000-0000-00000000000d','ceo@sra.test','ceo','CEO','equipo',true),
 ('10000000-0000-0000-0000-00000000000e','00000000-0000-0000-0000-00000000000e','obra@sra.test','obra','Residente','equipo',false);
insert into sra.persona_paneles values ('10000000-0000-0000-0000-00000000000b','disenos',false),('10000000-0000-0000-0000-00000000000c','disenos',true),('10000000-0000-0000-0000-00000000000e','obras',false);
insert into sra.proyectos (id, panel, nombre, encargado_id, inicio, fin) values
 ('20000000-0000-0000-0000-000000000001','disenos','Casa prueba','10000000-0000-0000-0000-00000000000b','2026-11-01','2026-12-18'),
 ('20000000-0000-0000-0000-000000000002','obras','Obra prueba','10000000-0000-0000-0000-00000000000a','2026-11-01','2027-03-01');
update sra.proyectos set residente_id='10000000-0000-0000-0000-00000000000e' where id='20000000-0000-0000-0000-000000000002';
insert into sra.entregas (id, proyecto_id, nombre, fecha) values ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Anteproyecto','2026-11-20');
insert into sra.registros_horas (persona_id, fecha, horas) values ('10000000-0000-0000-0000-00000000000c','2026-11-05',3);

create or replace function pg_temp.como(sub text, aal text default 'aal2') returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', sub, 'aal', aal)::text, false); end $$;

\echo '--- 1. Ana (diseños, aal2) ve proyectos:'
select pg_temp.como('00000000-0000-0000-0000-00000000000b'); set role authenticated;
select string_agg(nombre, ', ') from sra.proyectos; reset role;
\echo '--- 2. Ana con sesión sin doble verificación (aal1) ve proyectos:'
select pg_temp.como('00000000-0000-0000-0000-00000000000b','aal1'); set role authenticated;
select count(*) from sra.proyectos; reset role;
\echo '--- 3. Residente (obras) ve proyectos:'
select pg_temp.como('00000000-0000-0000-0000-00000000000e'); set role authenticated;
select string_agg(nombre, ', ') from sra.proyectos; reset role;
\echo '--- 4. Ana intenta crear un proyecto (debe fallar):'
select pg_temp.como('00000000-0000-0000-0000-00000000000b'); set role authenticated;
insert into sra.proyectos (panel, nombre) values ('disenos','Intruso'); reset role;
\echo '--- 5. Ana intenta ver horas de Dir (0 esperado):'
select pg_temp.como('00000000-0000-0000-0000-00000000000b'); set role authenticated;
select count(*) from sra.registros_horas; reset role;
\echo '--- 6. Ana intenta hacerse administradora (debe fallar):'
select pg_temp.como('00000000-0000-0000-0000-00000000000b'); set role authenticated;
update sra.personas set rol='admin' where id='10000000-0000-0000-0000-00000000000b'; reset role;
\echo '--- 7. Ana cambia el estado de la entrega directo (debe fallar):'
select pg_temp.como('00000000-0000-0000-0000-00000000000b'); set role authenticated;
update sra.entregas set estado='go' where id='30000000-0000-0000-0000-000000000001'; reset role;
\echo '--- 8. Cadena: Ana pasa al director sin link (falla), luego con link:'
select pg_temp.como('00000000-0000-0000-0000-00000000000b'); set role authenticated;
select (sra.mover_entrega('30000000-0000-0000-0000-000000000001','rev_director')).estado;
select (sra.mover_entrega('30000000-0000-0000-0000-000000000001','rev_director','', '\\NAS\Casa\Ante')).estado; reset role;
\echo '--- 9. Ana intenta aprobarse a sí misma como director (falla):'
select pg_temp.como('00000000-0000-0000-0000-00000000000b'); set role authenticated;
select (sra.mover_entrega('30000000-0000-0000-0000-000000000001','rev_ceo')).estado; reset role;
\echo '--- 10. Director devuelve sin comentario (falla), luego aprueba:'
select pg_temp.como('00000000-0000-0000-0000-00000000000c'); set role authenticated;
select (sra.mover_entrega('30000000-0000-0000-0000-000000000001','pendiente')).estado;
select (sra.mover_entrega('30000000-0000-0000-0000-000000000001','rev_ceo')).estado; reset role;
\echo '--- 11. Director intenta dar GO (falla); CEO da GO:'
select pg_temp.como('00000000-0000-0000-0000-00000000000c'); set role authenticated;
select (sra.mover_entrega('30000000-0000-0000-0000-000000000001','go')).estado; reset role;
select pg_temp.como('00000000-0000-0000-0000-00000000000d'); set role authenticated;
select (sra.mover_entrega('30000000-0000-0000-0000-000000000001','go')).estado; reset role;
\echo '--- 12. Ana envía al cliente; historial:'
select pg_temp.como('00000000-0000-0000-0000-00000000000b'); set role authenticated;
select (sra.mover_entrega('30000000-0000-0000-0000-000000000001','cliente')).estado;
select string_agg(de || '>' || a, ' · ' order by en) from sra.entrega_historial; reset role;
\echo '--- 13. Nadie borra un proyecto (ni el administrador):'
select pg_temp.como('00000000-0000-0000-0000-00000000000a'); set role authenticated;
delete from sra.proyectos where id='20000000-0000-0000-0000-000000000001'; reset role;
delete from sra.proyectos where id='20000000-0000-0000-0000-000000000001';
\echo '--- 14. Residente registra bitácora sin plan aprobado (falla):'
select pg_temp.como('00000000-0000-0000-0000-00000000000e'); set role authenticated;
insert into sra.bitacora (proyecto_id, fecha, actividades, autor_id) values ('20000000-0000-0000-0000-000000000002','2026-11-05','Excavación','10000000-0000-0000-0000-00000000000e'); reset role;
\echo '--- 15. Plan de obra: residente prepara, envía; CEO aprueba; luego bitácora y avance:'
select pg_temp.como('00000000-0000-0000-0000-00000000000e'); set role authenticated;
insert into sra.planes_obra (proyecto_id) values ('20000000-0000-0000-0000-000000000002');
insert into sra.partidas (proyecto_id, orden, nombre, valor, inicio, fin) values ('20000000-0000-0000-0000-000000000002',1,'Cimentación',40000000,'2026-11-01','2026-12-01'),('20000000-0000-0000-0000-000000000002',2,'Estructura',60000000,'2026-12-01','2027-02-01');
select (sra.mover_plan('20000000-0000-0000-0000-000000000002','enviado')).estado; reset role;
select pg_temp.como('00000000-0000-0000-0000-00000000000d'); set role authenticated;
select (sra.mover_plan('20000000-0000-0000-0000-000000000002','aprobado')).estado; reset role;
select pg_temp.como('00000000-0000-0000-0000-00000000000e'); set role authenticated;
insert into sra.bitacora (proyecto_id, fecha, actividades, autor_id) values ('20000000-0000-0000-0000-000000000002','2026-11-05','Excavación','10000000-0000-0000-0000-00000000000e');
update sra.partidas set avance = 100 where orden = 1; update sra.partidas set valor = 1 where orden = 2;
select sra.registrar_avance('20000000-0000-0000-0000-000000000002'); reset role;
\echo '--- 16. Ana (sin acceso a obras) ve valores de partidas (0 esperado):'
select pg_temp.como('00000000-0000-0000-0000-00000000000b'); set role authenticated;
select count(*) from sra.partidas; reset role;
\echo '--- 17. Auditoría: filas registradas y Ana no puede leerla:'
select count(*) from sra.auditoria;
select pg_temp.como('00000000-0000-0000-0000-00000000000b'); set role authenticated;
select count(*) from sra.auditoria; reset role;
\echo '--- 18. Cambio de alcance aprobado de 5 días corre la entrega (20 nov → efectiva):'
insert into sra.cambios_alcance (proyecto_id, descripcion, dias_habiles, desde, estado) values ('20000000-0000-0000-0000-000000000001','Más alcance',5,'2026-11-01','aprobado');
select fecha, fecha_efectiva, dias_alcance from sra.v_entregas;
\echo '--- 19. Jornada 8:00 a 19:10 con pausa de 1 h (ordinarias / extra):'
insert into sra.jornadas (persona_id, fecha, entrada, salida) values ('10000000-0000-0000-0000-00000000000b','2026-11-05','2026-11-05 08:00-05','2026-11-05 19:10-05');
insert into sra.jornada_pausas (persona_id, fecha, desde, hasta) values ('10000000-0000-0000-0000-00000000000b','2026-11-05','2026-11-05 12:30-05','2026-11-05 13:30-05');
select ordinarias, extra from sra.v_jornadas;
\echo '--- 20. Cronómetro de 2 días se parte por día:'
insert into sra.tareas (id, titulo, proyecto_id, responsable_id, creado_por) values ('40000000-0000-0000-0000-000000000001','Planos','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b','10000000-0000-0000-0000-00000000000b');
insert into sra.cronometros values ('10000000-0000-0000-0000-00000000000b','40000000-0000-0000-0000-000000000001','2026-11-05 16:00-05');
select sra.detener_cronometro('10000000-0000-0000-0000-00000000000b','2026-11-06 10:00-05');
select fecha, horas from sra.registros_horas where persona_id='10000000-0000-0000-0000-00000000000b' order by fecha;
\echo '--- 21. Programación semanal (resumen):'
select jsonb_array_length(sra.programacion_semana('2026-11-16') -> 'proyectos'), sra.programacion_semana('2026-11-16') -> 'festivos';
