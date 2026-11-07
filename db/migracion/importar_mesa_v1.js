#!/usr/bin/env node
/*
 * SRA Project Management · Migración de la mesa v1 a la base v2 (PostgreSQL / Supabase)
 *
 * Uso:
 *   node importar_mesa_v1.js <respaldo.json | carpeta_de_colecciones> <salida.sql>
 *
 * Entrada:
 *   - El respaldo que descarga el Administrador en la mesa («Respaldo SRA Project Management AAAA-MM-DD.json»), o
 *   - una carpeta con una subcarpeta por colección y un JSON por documento (<carpeta>/proyectos/<id>.json).
 * Salida: un archivo SQL que se ejecuta como dueño de la base (SQL Editor de Supabase o psql), en una sola transacción.
 *
 * Reglas: no migra contraseñas (cada persona entra con su correo y activa la doble verificación);
 * los identificadores nuevos se derivan de los de la mesa, así que correrlo dos veces no duplica nada.
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const [, , entrada, salida] = process.argv;
if (!entrada || !salida) { console.error('Uso: node importar_mesa_v1.js <respaldo.json | carpeta> <salida.sql>'); process.exit(1); }

// ---------- Leer datos ----------
function leer(entrada) {
  const st = fs.statSync(entrada);
  if (st.isFile()) {
    const j = JSON.parse(fs.readFileSync(entrada, 'utf8'));
    const datos = j.datos || j;
    if (j.comentarios) datos.__comentarios = j.comentarios;
    return datos;
  }
  const datos = {};
  for (const col of fs.readdirSync(entrada)) {
    const dir = path.join(entrada, col);
    if (!fs.statSync(dir).isDirectory()) continue;
    datos[col] = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      return d.data ? { id: d.id || f.replace(/\.json$/, ''), ...d.data } : { id: f.replace(/\.json$/, ''), ...d };
    });
  }
  // comentarios en tareas/<id>/comentarios/<cid>.json
  const tdir = path.join(entrada, 'tareas');
  if (fs.existsSync(tdir)) {
    datos.__comentarios = {};
    for (const t of fs.readdirSync(tdir)) {
      const cdir = path.join(tdir, t, 'comentarios');
      if (fs.existsSync(cdir)) datos.__comentarios[t] = fs.readdirSync(cdir).map(f => { const d = JSON.parse(fs.readFileSync(path.join(cdir, f), 'utf8')); return { id: f.replace(/\.json$/, ''), ...(d.data || d) }; });
    }
  }
  return datos;
}
const D = leer(entrada);
const col = n => Array.isArray(D[n]) ? D[n] : [];

// ---------- Utilidades ----------
const uid = (tipo, id) => {
  const h = crypto.createHash('sha1').update(`sra-v1:${tipo}:${id}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const q = v => v === null || v === undefined || v === '' ? 'null' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const qt = v => v === null || v === undefined ? "''" : `'${String(v).replace(/'/g, "''")}'`;     // texto no nulo
const fecha = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) ? `'${v.slice(0, 10)}'` : 'null';
const ts = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) ? `'${v}'` : 'null';
const arr = a => `array[${(a || []).map(x => qt(x)).join(',')}]::text[]`;
const PANEL = { proyectos: 'disenos', obras: 'obras', administrativo: 'administrativo' };
const panelDe = p => PANEL[p] || 'disenos';
const NIVEL = v => ['alta', 'media', 'baja'].includes(v) ? `'${v}'` : 'null';
const persona = id => id ? `'${uid('persona', id)}'` : 'null';
const avisos = [];

const out = [];
const sql = s => out.push(s);
sql(`-- Generado por importar_mesa_v1.js el ${new Date().toISOString()}`);
sql('begin;');

// ---------- Personas ----------
const personasIds = new Set(col('miembros').map(m => m.id));
for (const m of col('miembros')) {
  sql(`insert into sra.personas (id, usuario, nombre, cargo, rol, es_ceo, color, inactivo, creado_en, id_origen) values (` +
    `${persona(m.id)}, ${q(m.usuario ? String(m.usuario).toLowerCase() : null)}, ${qt(m.nombre || 'Sin nombre')}, ${qt(m.cargo)}, '${m.rol === 'admin' ? 'admin' : 'equipo'}', ${!!m.ceo}, ` +
    `${qt(m.color || '#2340B0')}, ${!!m.inactivo}, coalesce(${ts(m.creadoEn)}, now()), ${q(m.id)}) on conflict (id) do nothing;`);
  const paneles = m.rol === 'admin' ? ['proyectos', 'obras', 'administrativo'] : (Array.isArray(m.paneles) ? m.paneles : ['proyectos']);
  const dirs = m.director || [];
  for (const p of new Set([...paneles, ...dirs])) {
    sql(`insert into sra.persona_paneles (persona_id, panel, es_director) values (${persona(m.id)}, '${panelDe(p)}', ${dirs.includes(p)}) on conflict do nothing;`);
  }
  if (m.foto) avisos.push(`Foto de perfil de ${m.nombre} (asset ${m.foto}): descargarla de la mesa y subirla al bucket «perfiles».`);
}
const pid = id => personasIds.has(id) ? persona(id) : 'null';

// ---------- Proyectos y etapas ----------
const proyectosIds = new Set(col('proyectos').map(p => p.id));
const etapaIds = {};
for (const p of col('proyectos')) {
  const pan = panelDe(p.panel);
  let ini = p.inicio, fin = p.fin;
  if (ini && fin && fin < ini) { avisos.push(`Proyecto «${p.nombre}»: la fecha final (${fin}) era anterior al inicio; se dejó sin fecha final.`); fin = ''; }
  const tipo = p.tipo ? `(select id from sra.tipos_proyecto where panel = '${pan}' and nombre = ${qt(p.tipo)})` : 'null';
  const sub = p.subtipo ? `(select s.id from sra.subtipos s join sra.tipos_proyecto t on t.id = s.tipo_id where t.panel = '${pan}' and t.nombre = ${qt(p.tipo)} and s.nombre = ${qt(p.subtipo)})` : 'null';
  sql(`insert into sra.proyectos (id, panel, nombre, tipo_id, subtipo_id, subtipo_libre, cliente, ubicacion, inicio, fin, estado, prioridad, riesgo, ruta_nas, descripcion, color, encargado_id, residente_id, contratista, creado_por, creado_en, actualizado_en, id_origen) values (` +
    `'${uid('proyecto', p.id)}', '${pan}', ${qt(p.nombre)}, ${tipo}, ${sub}, ${p.subtipo ? `case when ${sub} is null then ${qt(p.subtipo)} end` : 'null'}, ${qt(p.cliente)}, ${qt(p.ubicacion)}, ${fecha(ini)}, ${fecha(fin)}, ` +
    `'${['activo', 'pausa', 'terminado', 'archivado'].includes(p.estado) ? p.estado : 'activo'}', ${NIVEL(p.prioridad)}, ${NIVEL(p.riesgo)}, ${qt(p.rutaNas)}, ${qt(p.descripcion)}, ${qt(p.color || '#2340B0')}, ` +
    `${pid(p.encargadoId)}, ${pid(p.residenteId)}, ${qt(p.contratista)}, ${pid(p.creadoPor)}, coalesce(${ts(p.creadoEn)}, now()), coalesce(${ts(p.actualizadoEn)}, now()), ${q(p.id)}) on conflict (id) do nothing;`);
  if (p.tipo) sql(`do $$ begin if (select tipo_id from sra.proyectos where id = '${uid('proyecto', p.id)}') is null then raise notice 'Tipo «%» no está en el catálogo de %: proyecto «%» quedó sin tipo.', ${qt(p.tipo)}, '${pan}', ${qt(p.nombre)}; end if; end $$;`);
  const co = new Set((p.coEncargados || []).filter(x => x && x !== p.encargadoId));
  for (const c of co) if (personasIds.has(c)) sql(`insert into sra.proyecto_personas values ('${uid('proyecto', p.id)}', ${persona(c)}, 'coencargado') on conflict do nothing;`);
  for (const m of new Set(p.miembros || [])) if (personasIds.has(m) && m !== p.encargadoId && !co.has(m)) sql(`insert into sra.proyecto_personas values ('${uid('proyecto', p.id)}', ${persona(m)}, 'equipo') on conflict do nothing;`);
  (p.etapas || []).forEach((e, i) => {
    const eid = uid('etapa', `${p.id}/${e.id || i}`); etapaIds[`${p.id}/${e.id}`] = eid;
    let ei = e.inicio, ef = e.fin; if (ei && ef && ef < ei) ef = '';
    sql(`insert into sra.etapas (id, proyecto_id, orden, nombre, inicio, fin, estado, id_origen) values ('${eid}', '${uid('proyecto', p.id)}', ${i + 1}, ${qt(e.nombre)}, ${fecha(ei)}, ${fecha(ef)}, '${['pendiente', 'curso', 'terminada'].includes(e.estado) ? e.estado : 'pendiente'}', ${q(e.id)}) on conflict (id) do nothing;`);
  });
}
for (const p of col('proyectos')) if (p.disenoId && proyectosIds.has(p.disenoId)) sql(`update sra.proyectos set diseno_origen_id = '${uid('proyecto', p.disenoId)}' where id = '${uid('proyecto', p.id)}';`);
const pr = id => id && proyectosIds.has(id) ? `'${uid('proyecto', id)}'` : 'null';
const et = (p, e) => e && etapaIds[`${p}/${e}`] ? `'${etapaIds[`${p}/${e}`]}'` : 'null';

// ---------- Cambios de alcance ----------
for (const c of col('cambios')) {
  if (!proyectosIds.has(c.proyectoId)) continue;
  sql(`insert into sra.cambios_alcance (id, proyecto_id, descripcion, solicitado_por, dias_habiles, desde, estado, aprobado_por, aprobado_en, creado_por, creado_en, id_origen) values (` +
    `'${uid('cambio', c.id)}', ${pr(c.proyectoId)}, ${qt(c.descripcion)}, ${qt(c.solicitadoPor || 'Cliente')}, ${Math.max(0, Math.min(365, parseInt(c.dias) || 0))}, coalesce(${fecha(c.desde)}, current_date), ` +
    `'${['propuesto', 'aprobado', 'rechazado'].includes(c.estado) ? c.estado : 'propuesto'}', ${pid(c.aprobadoPor)}, ${ts(c.aprobadoEn)}, ${pid(c.creadoPor)}, coalesce(${ts(c.creadoEn)}, now()), ${q(c.id)}) on conflict (id) do nothing;`);
}

// ---------- Entregas al cliente ----------
const EENT = { pendiente: 'pendiente', interna: 'rev_director', rev_director: 'rev_director', rev_ceo: 'rev_ceo', go: 'go', cliente: 'cliente', observaciones: 'observaciones', aprobado: 'aprobado' };
for (const h of col('hitos')) {
  if (!proyectosIds.has(h.proyectoId) || !h.fecha) { avisos.push(`Entrega «${h.nombre}» omitida: sin proyecto válido o sin fecha.`); continue; }
  const id = uid('entrega', h.id);
  sql(`insert into sra.entregas (id, proyecto_id, etapa_id, nombre, fecha, estado, link_nas, rondas, go_por, go_en, enviado_en, aprobado_en, creado_por, creado_en, id_origen) values (` +
    `'${id}', ${pr(h.proyectoId)}, ${et(h.proyectoId, h.etapaId)}, ${qt(h.nombre)}, ${fecha(h.fecha)}, '${EENT[h.estado] || 'pendiente'}', ${qt(h.linkNas)}, ${parseInt(h.rondas) || 0}, ` +
    `${pid(h.goPor)}, ${ts(h.goEn)}, ${ts(h.enviadoEn)}, ${ts(h.aprobadoEn)}, ${pid(h.creadoPor)}, coalesce(${ts(h.creadoEn)}, now()), ${q(h.id)}) on conflict (id) do nothing;`);
  for (const x of (h.historial || [])) {
    if (!EENT[x.estado]) continue;
    sql(`insert into sra.entrega_historial (entrega_id, de, a, devuelta, nota, por, en) values ('${id}', ${x.de && EENT[x.de] ? `'${EENT[x.de]}'` : 'null'}, '${EENT[x.estado]}', ${x.estado === 'pendiente' && !!x.de}, ${qt(x.nota)}, ${pid(x.por)}, coalesce(${ts(x.en)}, now()));`);
  }
}

// ---------- Tareas ----------
const tareasIds = new Set(col('tareas').map(t => t.id));
const ETAR = ['pendiente', 'progreso', 'revision', 'completada', 'aplazada', 'archivada'];
for (const t of col('tareas')) {
  const id = uid('tarea', t.id);
  let ini = t.inicio, lim = t.limite;
  sql(`insert into sra.tareas (id, num, panel, proyecto_id, etapa_id, titulo, descripcion, estado, prioridad, responsable_id, verificador_id, requiere_aprobacion, inicio, limite, etiquetas, creado_por, creado_en, actualizado_en, completada_en, id_origen) overriding system value values (` +
    `'${id}', ${parseInt(t.num) > 0 ? parseInt(t.num) : `nextval(pg_get_serial_sequence('sra.tareas', 'num'))`}, '${panelDe(t.panel)}', ${pr(t.proyectoId)}, ${et(t.proyectoId, t.etapaId)}, ${qt(t.titulo || 'Sin título')}, ${qt(t.descripcion)}, '${ETAR.includes(t.estado) ? t.estado : 'pendiente'}', ` +
    `'${t.prioridad === 'alta' ? 'alta' : 'normal'}', ${pid(t.responsableId)}, ${pid(t.creadorId)}, ${t.requiereAprobacion !== false}, ${fecha(ini)}, ${fecha(lim)}, ${arr(t.etiquetas)}, ` +
    `${pid(t.asignadaPor || t.creadorId)}, coalesce(${ts(t.creadaEn)}, now()), coalesce(${ts(t.actualizadaEn)}, now()), ${ts(t.completadaEn)}, ${q(t.id)}) on conflict (id) do nothing;`);
  for (const p of new Set(t.participantes || [])) if (personasIds.has(p)) sql(`insert into sra.tarea_personas values ('${id}', ${persona(p)}, 'participante') on conflict do nothing;`);
  for (const p of new Set(t.observadores || [])) if (personasIds.has(p) && !(t.participantes || []).includes(p)) sql(`insert into sra.tarea_personas values ('${id}', ${persona(p)}, 'observador') on conflict do nothing;`);
  (t.checklist || []).forEach((c, i) => sql(`insert into sra.tarea_checklist (id, tarea_id, orden, texto, hecho) values ('${uid('check', `${t.id}/${i}`)}', '${id}', ${i}, ${qt(c.t || c.texto || '')}, ${!!(c.ok || c.hecho)}) on conflict (id) do nothing;`));
  (t.entregables || []).forEach((x, i) => sql(`insert into sra.entregables (id, tarea_id, nombre, link_nas, estado, nota, por, en, revisado_por, revisado_en) values ('${uid('entregable', `${t.id}/${x.id || i}`)}', '${id}', ${qt(x.descripcion || x.nombre || 'Entregable')}, ${qt(x.linkNas)}, '${['enviado', 'aprobado', 'devuelto'].includes(x.estado) ? x.estado : 'enviado'}', ${qt(x.nota)}, ${pid(x.autorId)}, coalesce(${ts(x.en)}, now()), ${pid(x.revisadoPor)}, ${ts(x.revisadoEn)}) on conflict (id) do nothing;`));
  for (const c of ((D.__comentarios || {})[t.id] || [])) sql(`insert into sra.comentarios (id, tarea_id, autor_id, texto, sistema, en) values ('${uid('comentario', `${t.id}/${c.id}`)}', '${id}', ${pid(c.autorId)}, ${qt(c.texto)}, ${!!c.sistema}, coalesce(${ts(c.en)}, now())) on conflict (id) do nothing;`);
  for (const [m, desde] of Object.entries(t.timers || {})) if (desde && personasIds.has(m)) sql(`insert into sra.cronometros values (${persona(m)}, '${id}', ${ts(desde)}) on conflict do nothing;`);
}
for (const t of col('tareas')) {
  if (t.padreId && tareasIds.has(t.padreId)) sql(`update sra.tareas set padre_id = '${uid('tarea', t.padreId)}' where id = '${uid('tarea', t.id)}';`);
  if (t.dependeDe && tareasIds.has(t.dependeDe)) sql(`update sra.tareas set depende_de = '${uid('tarea', t.dependeDe)}' where id = '${uid('tarea', t.id)}';`);
}

// ---------- Horas y jornadas ----------
for (const r of col('registros')) {
  if (!personasIds.has(r.miembroId) || !(+r.horas > 0)) continue;
  sql(`insert into sra.registros_horas (id, tarea_id, proyecto_id, persona_id, fecha, inicio, fin, horas, nota, horas_originales, corregido_por, corregido_en, anulado, motivo_anulacion, anulado_por, anulado_en, creado_en, id_origen) values (` +
    `'${uid('registro', r.id)}', ${tareasIds.has(r.tareaId) ? `'${uid('tarea', r.tareaId)}'` : 'null'}, ${pr(r.proyectoId)}, ${persona(r.miembroId)}, ${fecha(r.fecha)}, ${ts(r.inicio)}, ${ts(r.fin)}, ${Math.min(24, +r.horas)}, ${qt(r.nota)}, ` +
    `${r.horasOriginales != null && r.horasOriginales !== '' ? +r.horasOriginales : 'null'}, ${pid(r.corregidoPor)}, ${ts(r.corregidoEn)}, ${!!r.anulado}, ${r.anulado ? qt(r.motivoAnulacion || 'Anulado en la mesa v1') : 'null'}, ${pid(r.anuladoPor)}, ${ts(r.anuladoEn)}, coalesce(${ts(r.creadoEn)}, now()), ${q(r.id)}) on conflict (id) do nothing;`);
}
for (const j of col('jornadas')) {
  if (!personasIds.has(j.miembroId) || !j.fecha) continue;
  const salidaOk = j.salida && j.entrada && j.salida > j.entrada;
  sql(`insert into sra.jornadas (persona_id, fecha, entrada, salida, nota) values (${persona(j.miembroId)}, ${fecha(j.fecha)}, ${ts(j.entrada)}, ${salidaOk ? ts(j.salida) : 'null'}, ${qt(j.nota)}) on conflict do nothing;`);
  (j.pausas || []).forEach((p, i) => { if (p.desde) sql(`insert into sra.jornada_pausas (id, persona_id, fecha, desde, hasta) values ('${uid('pausa', `${j.id}/${i}`)}', ${persona(j.miembroId)}, ${fecha(j.fecha)}, ${ts(p.desde)}, ${p.hasta && p.hasta > p.desde ? ts(p.hasta) : 'null'}) on conflict (id) do nothing;`); });
}

// ---------- Reuniones ----------
for (const r of col('reuniones')) {
  if (!r.fecha) continue;
  const id = uid('reunion', r.id);
  const dur = (r.horaIni && r.horaFin) ? (() => { const [a, b] = r.horaIni.split(':').map(Number), [c, d] = r.horaFin.split(':').map(Number); const m = (c * 60 + d) - (a * 60 + b); return m > 0 ? m : null; })() : null;
  sql(`insert into sra.reuniones (id, proyecto_id, titulo, fecha, hora, duracion_min, lugar, estado, externos, acuerdos, notas, creado_por, creado_en, id_origen) values (` +
    `'${id}', ${pr(r.proyectoId)}, ${qt(r.titulo || 'Reunión')}, ${fecha(r.fecha)}, ${r.horaIni ? q(r.horaIni) : 'null'}, ${dur ?? 'null'}, ${qt(r.lugar)}, '${r.estado === 'realizada' ? 'realizada' : r.estado === 'cancelada' ? 'cancelada' : 'programada'}', ` +
    `${qt(r.externos)}, ${qt(r.acuerdos)}, ${qt(r.notas)}, ${pid(r.creadorId)}, coalesce(${ts(r.creadaEn)}, now()), ${q(r.id)}) on conflict (id) do nothing;`);
  for (const p of new Set(r.participantes || [])) if (personasIds.has(p)) sql(`insert into sra.reunion_personas values ('${id}', ${persona(p)}) on conflict do nothing;`);
}

// ---------- Obra ----------
const PLANST = ['borrador', 'enviado', 'devuelto', 'aprobado'];
for (const pl of col('obraPlan')) {
  const p = pl.proyectoId || pl.id;
  if (!proyectosIds.has(p)) continue;
  sql(`insert into sra.planes_obra (proyecto_id, estado, nota, preparado_por, enviado_en, aprobado_por, aprobado_en, actualizado_en) values (${pr(p)}, '${PLANST.includes(pl.estado) ? pl.estado : 'borrador'}', ${qt(pl.nota)}, ${pid(pl.preparadoPor)}, ${ts(pl.enviadoEn)}, ${pid(pl.aprobadoPor)}, ${ts(pl.aprobadoEn)}, coalesce(${ts(pl.actualizadoEn)}, now())) on conflict (proyecto_id) do nothing;`);
  (pl.partidas || []).forEach((x, i) => {
    if (!(+x.valor > 0) || !x.inicio || !x.fin || x.fin < x.inicio) { avisos.push(`Partida «${x.nombre}» de un plan de obra omitida: le falta valor o fechas válidas.`); return; }
    sql(`insert into sra.partidas (id, proyecto_id, orden, nombre, valor, inicio, fin, avance) values ('${uid('partida', `${p}/${x.id || i}`)}', ${pr(p)}, ${i + 1}, ${qt(x.nombre)}, ${+x.valor}, ${fecha(x.inicio)}, ${fecha(x.fin)}, ${Math.max(0, Math.min(100, +x.avance || 0))}) on conflict (id) do nothing;`);
  });
  for (const a of (pl.hist || [])) if (a.fecha) sql(`insert into sra.avance_obra (proyecto_id, fecha, avance) values (${pr(p)}, ${fecha(a.fecha)}, ${Math.max(0, Math.min(100, +a.avance || 0))}) on conflict do nothing;`);
  for (const h of (pl.historial || [])) if (PLANST.includes(h.estado)) sql(`insert into sra.plan_historial (proyecto_id, estado, nota, por, en) values (${pr(p)}, '${h.estado}', ${qt(h.nota)}, ${pid(h.por)}, coalesce(${ts(h.en)}, now()));`);
}
const fotos = (ids, campo, rid, proyecto, momento) => (ids || []).filter(Boolean).forEach(f => {
  sql(`insert into sra.fotos (proyecto_id, ${campo}, momento, storage_path) values (${pr(proyecto)}, '${rid}', ${momento ? `'${momento}'` : 'null'}, ${qt(`migrar/${f}`)}) on conflict (storage_path) do nothing;`);
  avisos.push(`Foto ${f}: descargarla de la mesa v1 y subirla al bucket «obra» en ${proyecto ? uid('proyecto', proyecto) : '?'}/; luego actualizar storage_path.`);
});
for (const b of col('bitacora')) {
  if (!proyectosIds.has(b.proyectoId) || !b.fecha) continue;
  const id = uid('bitacora', b.id);
  sql(`insert into sra.bitacora (id, proyecto_id, tipo, fecha, clima, personal, actividades, novedades, autor_id, creada_en, id_origen) values ('${id}', ${pr(b.proyectoId)}, '${b.tipo === 'visita' ? 'visita' : 'diario'}', ${fecha(b.fecha)}, ${qt(b.clima)}, ` +
    `${b.personal === '' || b.personal == null ? 'null' : Math.max(0, parseInt(b.personal) || 0)}, ${qt(b.actividades || '(sin detalle)')}, ${qt(b.novedades)}, ${pid(b.autorId)}, coalesce(${ts(b.creadaEn)}, now()), ${q(b.id)}) on conflict (id) do nothing;`);
  fotos(b.fotos, 'bitacora_id', id, b.proyectoId);
}
const OBEST = { incidencia: ['abierta', 'cerrada'], pendiente: ['abierto', 'resuelto'], permiso: ['tramite', 'vigente', 'cerrado'], consulta: ['abierta', 'respondida'] };
for (const x of col('obra')) {
  if (!proyectosIds.has(x.proyectoId) || !OBEST[x.clase]) continue;
  const id = uid('obra', x.id);
  sql(`insert into sra.obra_items (id, proyecto_id, clase, titulo, detalle, responsable, ubicacion, plazo, entidad, numero, vence, link_nas, estado, para_id, respuesta, respondida_por, respondida_en, cierre, cerrado_por, cerrado_en, creado_por, creado_en, id_origen) values (` +
    `'${id}', ${pr(x.proyectoId)}, '${x.clase}', ${qt(x.titulo || '(sin título)')}, ${qt(x.detalle)}, ${qt(x.responsable)}, ${qt(x.ubicacion)}, ${fecha(x.plazo)}, ${qt(x.entidad)}, ${qt(x.numero)}, ${fecha(x.vence)}, ${qt(x.linkNas)}, ` +
    `'${OBEST[x.clase].includes(x.estado) ? x.estado : OBEST[x.clase][0]}', ${pid(x.paraId)}, ${q(x.respuesta)}, ${pid(x.respondidaPor)}, ${ts(x.respondidaEn)}, ${qt(x.cierre)}, ${pid(x.cerradoPor)}, ${ts(x.cerradoEn)}, ${pid(x.creadoPor)}, coalesce(${ts(x.creadoEn)}, now()), ${q(x.id)}) on conflict (id) do nothing;`);
  fotos(x.fotos, 'obra_item_id', id, x.proyectoId, x.clase === 'pendiente' ? 'antes' : null);
  fotos(x.fotosDespues, 'obra_item_id', id, x.proyectoId, 'despues');
}

// ---------- Programaciones publicadas ----------
for (const p of col('programacion')) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.id)) continue;
  const { id, ...resto } = p;
  sql(`insert into sra.programaciones (semana, estado, contenido, publicada_por, publicada_en) values ('${id}', 'publicada', ${qt(JSON.stringify(resto))}::jsonb, ${pid(p.publicadaPor || p.por)}, coalesce(${ts(p.publicadaEn || p.en)}, now())) on conflict (semana) do nothing;`);
}

if (col('tareas').length) sql(`select setval(pg_get_serial_sequence('sra.tareas', 'num'), greatest((select max(num) from sra.tareas), 1));`);
sql(`-- Resumen esperado: ${col('miembros').length} personas, ${col('proyectos').length} proyectos, ${col('tareas').length} tareas, ${col('hitos').length} entregas, ${col('registros').length} registros de horas, ${col('jornadas').length} jornadas, ${col('cambios').length} cambios de alcance.`);
sql('commit;');
fs.writeFileSync(salida, out.join('\n') + '\n');
console.log(`Listo: ${salida} (${out.length} líneas)`);
console.log(`Personas ${col('miembros').length} · proyectos ${col('proyectos').length} · tareas ${col('tareas').length} · entregas ${col('hitos').length} · horas ${col('registros').length} · jornadas ${col('jornadas').length} · cambios ${col('cambios').length} · reuniones ${col('reuniones').length} · bitácora ${col('bitacora').length} · obra ${col('obra').length} · planes ${col('obraPlan').length}`);
if (avisos.length) { console.log('\nAvisos para revisar:'); for (const a of avisos) console.log(' - ' + a); }
console.log('\nLas contraseñas no se migran. Después de cargar: escribir el correo de cada persona en sra.personas.email e invitarla desde Supabase Auth.');
