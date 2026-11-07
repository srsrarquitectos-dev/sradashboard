// Capa de datos de la mesa v2.
// La mesa v1 trabaja con «colecciones de documentos» (miembros, proyectos, tareas…). Esta capa ofrece esa misma
// forma de trabajo, pero lee y guarda en las tablas de Supabase (esquema sra), con las reglas de acceso de la base.
// Campos de la mesa sin columna propia van a la columna «extra», para que nada se pierda al guardar.
import { sb } from './supabase.js';

const P2V = { disenos: 'proyectos', obras: 'obras', administrativo: 'administrativo' };
const V2P = { proyectos: 'disenos', obras: 'obras', administrativo: 'administrativo' };
const nul = v => (v === '' || v === undefined ? null : v);
const fecha = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const uuidOk = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const idOrNull = v => (uuidOk(v) ? v : null);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const copia = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
const err = (msg, code = 'sra') => Object.assign(new Error(msg), { code });

let ME = null;          // persona que usa la mesa
export function setYo(id) { ME = id; }

async function q(promesa) {
  const { data, error } = await promesa;
  if (error) throw traducir(error);
  return data;
}
function traducir(e) {
  const m = e.message || '';
  if (e.code === '42501' || /row-level security|permission denied/i.test(m)) return err(/En SRA|Solo |No te corresponde|Primero/.test(m) ? m : 'No tienes permiso para este cambio.', 'permission-denied');
  if (e.code === 'P0001') return err(m, 'regla');
  if (e.code === '23505') return err('Ya existe un registro igual.', 'duplicado');
  if (e.code === '23514') return err('Algún dato no es válido (revisa fechas y valores).', 'invalido');
  if (/fetch|network/i.test(m)) return err('Sin conexión con el servidor. El cambio no se guardó.', 'red');
  return err(m || 'No se pudo guardar.', e.code || 'error');
}
const todo = (tabla, sel = '*') => q(sb.from(tabla).select(sel).range(0, 9999));

// Separa los campos conocidos de los demás (que van a «extra»)
function partir(data, conocidos, ignorar = []) {
  const extra = {};
  for (const [k, v] of Object.entries(data)) if (!conocidos.includes(k) && !ignorar.includes(k) && k !== 'id') extra[k] = v;
  return extra;
}

// ---------- Catálogos ----------
let CAT = { tipos: [], subtipos: [] };
async function cargarCatalogos() {
  const [tipos, subtipos] = await Promise.all([todo('tipos_proyecto'), todo('subtipos')]);
  CAT = { tipos, subtipos };
}
const tipoNombre = id => CAT.tipos.find(t => t.id === id)?.nombre || '';
const subNombre = id => CAT.subtipos.find(s => s.id === id)?.nombre || '';
const tipoId = (panel, nombre) => CAT.tipos.find(t => t.panel === panel && t.nombre === nombre)?.id ?? null;
const subId = (tid, nombre) => CAT.subtipos.find(s => s.tipo_id === tid && s.nombre === nombre)?.id ?? null;

// ---------- Fotos: direcciones firmadas ----------
const firmas = new Map();   // 'bucket/ruta' -> {url, vence}
export function sraBlob(id) { const f = firmas.get(id); return f ? f.url : ''; }
async function firmar(ids) {
  const ahora = Date.now();
  const faltan = [...new Set(ids.filter(Boolean))].filter(id => !(firmas.get(id)?.vence > ahora + 600e3));
  const porBucket = {};
  for (const id of faltan) { const i = id.indexOf('/'); if (i > 0) (porBucket[id.slice(0, i)] ||= []).push(id.slice(i + 1)); }
  for (const [b, rutas] of Object.entries(porBucket)) {
    try {
      const { data } = await sb.storage.from(b).createSignedUrls(rutas, 3600);
      (data || []).forEach(d => { if (d.signedUrl) firmas.set(`${b}/${d.path}`, { url: d.signedUrl, vence: ahora + 3600e3 }); });
    } catch (e) { console.warn('fotos', e); }
  }
}

// ---------- Colecciones ----------
const nuevoId = () => crypto.randomUUID();
const COL = {};

COL.miembros = {
  tablas: ['personas', 'persona_paneles'],
  async cargar() {
    const [ps, pp] = await Promise.all([todo('personas'), todo('persona_paneles')]);
    return ps.map(p => {
      const mios = pp.filter(x => x.persona_id === p.id);
      return { ...(p.extra || {}), id: p.id, nombre: p.nombre, cargo: p.cargo, rol: p.rol, ceo: p.es_ceo, color: p.color, inactivo: p.inactivo,
        usuario: p.usuario || '', email: p.email || '', paneles: mios.map(x => P2V[x.panel]), director: mios.filter(x => x.es_director).map(x => P2V[x.panel]), creadoEn: p.creado_en };
    });
  },
  async guardar(id, d, modo) {
    const C = ['nombre', 'cargo', 'rol', 'ceo', 'color', 'inactivo', 'usuario', 'email', 'paneles', 'director'];
    const row = {};
    if (has(d, 'nombre')) row.nombre = d.nombre; if (has(d, 'cargo')) row.cargo = d.cargo || ''; if (has(d, 'rol')) row.rol = d.rol === 'admin' ? 'admin' : 'equipo';
    if (has(d, 'ceo')) row.es_ceo = !!d.ceo; if (has(d, 'color')) row.color = d.color || '#2340B0'; if (has(d, 'inactivo')) row.inactivo = !!d.inactivo;
    if (has(d, 'usuario')) row.usuario = d.usuario ? String(d.usuario).toLowerCase() : null;
    if (has(d, 'email')) row.email = d.email ? String(d.email).trim().toLowerCase() : null;
    const extra = partir(d, C, ['creadoEn', 'actualizadoEn']);
    if (modo === 'add') { id = (await q(sb.from('personas').insert({ ...row, extra }).select('id').single())).id; }
    else { if (Object.keys(extra).length) row.extra = { ...(cache.miembros?.get(id)?._extra || {}), ...extra }; if (Object.keys(row).length) await q(sb.from('personas').update(row).eq('id', id)); }
    if (has(d, 'paneles') || has(d, 'director')) {
      const actual = cache.miembros?.get(id) || {};
      const paneles = d.paneles ?? actual.paneles ?? [], dirs = d.director ?? actual.director ?? [];
      const quiero = [...new Set([...paneles, ...dirs])].filter(k => V2P[k]);
      if (quiero.length) await q(sb.from('persona_paneles').upsert(quiero.map(k => ({ persona_id: id, panel: V2P[k], es_director: dirs.includes(k) })), { onConflict: 'persona_id,panel' }));
      const sobran = Object.keys(V2P).filter(k => !quiero.includes(k)).map(k => V2P[k]);
      if (sobran.length) await q(sb.from('persona_paneles').delete().eq('persona_id', id).in('panel', sobran));
    }
    return id;
  },
};

COL.proyectos = {
  tablas: ['proyectos', 'etapas', 'proyecto_personas'],
  async cargar() {
    await cargarCatalogos();
    const [ps, es, pp] = await Promise.all([todo('proyectos'), q(sb.from('etapas').select('*').order('orden').range(0, 9999)), todo('proyecto_personas')]);
    return ps.map(p => {
      const co = pp.filter(x => x.proyecto_id === p.id && x.rol === 'coencargado').map(x => x.persona_id);
      const eq = pp.filter(x => x.proyecto_id === p.id && x.rol === 'equipo').map(x => x.persona_id);
      return { ...(p.extra || {}), id: p.id, panel: P2V[p.panel], nombre: p.nombre, tipo: tipoNombre(p.tipo_id), subtipo: subNombre(p.subtipo_id) || p.subtipo_libre || '',
        cliente: p.cliente, ubicacion: p.ubicacion, inicio: p.inicio || '', fin: p.fin || '', estado: p.estado, prioridad: p.prioridad || '', riesgo: p.riesgo || '',
        rutaNas: p.ruta_nas, descripcion: p.descripcion, color: p.color, encargadoId: p.encargado_id || '', residenteId: p.residente_id || '', contratista: p.contratista,
        disenoId: p.diseno_origen_id || '', creadoPor: p.creado_por || '', creadoEn: p.creado_en, actualizadoEn: p.actualizado_en,
        coEncargados: co, miembros: [...new Set([p.encargado_id, ...co, ...eq].filter(Boolean))],
        etapas: es.filter(e => e.proyecto_id === p.id).map(e => ({ id: e.id, nombre: e.nombre, inicio: e.inicio || '', fin: e.fin || '', estado: e.estado })) };
    });
  },
  async guardar(id, d, modo) {
    const C = ['panel', 'nombre', 'tipo', 'subtipo', 'cliente', 'ubicacion', 'inicio', 'fin', 'estado', 'prioridad', 'riesgo', 'rutaNas', 'descripcion', 'color',
      'encargadoId', 'residenteId', 'contratista', 'disenoId', 'coEncargados', 'miembros', 'etapas', 'creadoPor'];
    const actual = modo === 'add' ? {} : (cache.proyectos?.get(id) || {});
    const panel = V2P[has(d, 'panel') ? d.panel : actual.panel] || 'disenos';
    const row = {};
    if (has(d, 'panel')) row.panel = panel;
    if (has(d, 'nombre')) row.nombre = d.nombre;
    if (has(d, 'tipo') || has(d, 'subtipo') || has(d, 'panel')) {
      const tn = has(d, 'tipo') ? d.tipo : actual.tipo, sn = has(d, 'subtipo') ? d.subtipo : actual.subtipo;
      const tid = tn ? tipoId(panel, tn) : null; row.tipo_id = tid; const sid = tid && sn ? subId(tid, sn) : null;
      row.subtipo_id = sid; row.subtipo_libre = sn && !sid ? sn : null;
      if (tn && !tid) row.extra_tipo = tn;
    }
    for (const [v, c] of [['cliente', 'cliente'], ['ubicacion', 'ubicacion'], ['rutaNas', 'ruta_nas'], ['descripcion', 'descripcion'], ['contratista', 'contratista']]) if (has(d, v)) row[c] = d[v] || '';
    if (has(d, 'inicio')) row.inicio = fecha(d.inicio); if (has(d, 'fin')) row.fin = fecha(d.fin);
    if (has(d, 'estado')) row.estado = ['activo', 'pausa', 'terminado', 'archivado'].includes(d.estado) ? d.estado : 'activo';
    if (has(d, 'prioridad')) row.prioridad = ['alta', 'media', 'baja'].includes(d.prioridad) ? d.prioridad : null;
    if (has(d, 'riesgo')) row.riesgo = ['alta', 'media', 'baja'].includes(d.riesgo) ? d.riesgo : null;
    if (has(d, 'color')) row.color = d.color || '#2340B0';
    if (has(d, 'encargadoId')) row.encargado_id = idOrNull(d.encargadoId);
    if (has(d, 'residenteId')) row.residente_id = idOrNull(d.residenteId);
    if (has(d, 'disenoId')) row.diseno_origen_id = idOrNull(d.disenoId);
    const extra = partir(d, C, ['creadoEn', 'actualizadoEn', 'id']);
    if (row.extra_tipo) { extra.tipo = row.extra_tipo; delete row.extra_tipo; }
    if (modo === 'add') { row.creado_por = ME; row.extra = extra; id = (await q(sb.from('proyectos').insert(row).select('id').single())).id; }
    else {
      if (Object.keys(extra).length) row.extra = { ...extrasDe(actual, C), ...extra };
      if (Object.keys(row).length) await q(sb.from('proyectos').update(row).eq('id', id));
    }
    if (has(d, 'etapas')) await guardarEtapas(id, d.etapas || [], actual.etapas || []);
    if (has(d, 'coEncargados') || has(d, 'miembros') || has(d, 'encargadoId')) {
      const enc = has(d, 'encargadoId') ? d.encargadoId : actual.encargadoId;
      const co = (d.coEncargados ?? actual.coEncargados ?? []).filter(x => uuidOk(x) && x !== enc);
      const eq = (d.miembros ?? actual.miembros ?? []).filter(x => uuidOk(x) && x !== enc && !co.includes(x));
      const quiero = [...co.map(p => ({ proyecto_id: id, persona_id: p, rol: 'coencargado' })), ...eq.map(p => ({ proyecto_id: id, persona_id: p, rol: 'equipo' }))];
      if (quiero.length) await q(sb.from('proyecto_personas').upsert(quiero, { onConflict: 'proyecto_id,persona_id' }));
      const hoy = await q(sb.from('proyecto_personas').select('persona_id').eq('proyecto_id', id));
      const sobran = hoy.map(x => x.persona_id).filter(p => !quiero.some(x => x.persona_id === p));
      if (sobran.length) await q(sb.from('proyecto_personas').delete().eq('proyecto_id', id).in('persona_id', sobran));
    }
    return id;
  },
};
function extrasDe(doc, conocidos) { const e = {}; for (const [k, v] of Object.entries(doc || {})) if (!conocidos.includes(k) && !['id', 'creadoEn', 'actualizadoEn'].includes(k) && !CAMPOS_LEIDOS.has(k)) e[k] = v; return e; }
const CAMPOS_LEIDOS = new Set(['tipo', 'subtipo', 'cliente', 'ubicacion', 'inicio', 'fin', 'estado', 'prioridad', 'riesgo', 'rutaNas', 'descripcion', 'color', 'encargadoId', 'residenteId', 'contratista', 'disenoId', 'creadoPor', 'coEncargados', 'miembros', 'etapas', 'panel', 'nombre']);

async function guardarEtapas(pid, nuevas, viejas) {
  const filas = await q(sb.from('etapas').select('id,id_origen,orden').eq('proyecto_id', pid));
  const buscar = eid => filas.find(f => f.id === eid || f.id_origen === eid);
  const usadas = new Set();
  const salen = filas.filter(f => !nuevas.some(n => buscar(n.id)?.id === f.id));
  if (salen.length) throw err('Las etapas no se borran: si una ya no aplica, márcala como terminada o cámbiale el nombre.', 'regla');
  // Primero se apartan los órdenes para poder reordenar sin chocar
  if (filas.length) for (const f of filas) await q(sb.from('etapas').update({ orden: 1000 + f.orden }).eq('id', f.id));
  for (let i = 0; i < nuevas.length; i++) {
    const n = nuevas[i], f = buscar(n.id);
    const row = { nombre: n.nombre || 'Etapa', inicio: fecha(n.inicio), fin: fecha(n.fin), estado: ['pendiente', 'curso', 'terminada'].includes(n.estado) ? n.estado : 'pendiente', orden: i + 1 };
    if (f) { usadas.add(f.id); await q(sb.from('etapas').update(row).eq('id', f.id)); }
    else await q(sb.from('etapas').insert({ ...row, proyecto_id: pid, id_origen: n.id ? String(n.id) : null }));
  }
}
async function resolverEtapa(pid, eid) {
  if (!eid) return null; if (uuidOk(eid)) return eid;
  const r = await q(sb.from('etapas').select('id').eq('id_origen', String(eid)).limit(1));
  return r[0]?.id || null;
}

const EST_ENT = { interna: 'rev_director' };
COL.hitos = {
  tablas: ['entregas', 'entrega_historial'],
  async cargar() {
    const [es, hs] = await Promise.all([todo('entregas'), q(sb.from('entrega_historial').select('*').order('en').range(0, 99999))]);
    return es.map(e => {
      const historial = hs.filter(h => h.entrega_id === e.id).map(h => ({ de: h.de || '', estado: h.a, en: h.en, por: h.por || '', nota: h.nota, link: h.link_nas, devuelta: h.devuelta }));
      const ult = historial[historial.length - 1];
      const devuelta = e.estado === 'pendiente' && ult?.devuelta ? { por: ult.por, nota: ult.nota, en: ult.en, paso: ult.de } : null;
      return { ...(e.extra || {}), id: e.id, proyectoId: e.proyecto_id, etapaId: e.etapa_id || '', nombre: e.nombre, fecha: e.fecha, estado: e.estado, linkNas: e.link_nas,
        rondas: e.rondas, goPor: e.go_por || '', goEn: e.go_en || '', enviadoEn: e.enviado_en || '', aprobadoEn: e.aprobado_en || '', creadoPor: e.creado_por || '',
        creadoEn: e.creado_en, actualizadoEn: e.actualizado_en, historial, devuelta };
    });
  },
  async guardar(id, d, modo) {
    const C = ['proyectoId', 'etapaId', 'nombre', 'fecha', 'estado', 'linkNas', 'rondas', 'goPor', 'goEn', 'enviadoEn', 'aprobadoEn', 'creadoPor', 'historial', 'devuelta'];
    const actual = modo === 'add' ? {} : (cache.hitos?.get(id) || {});
    const pid = d.proyectoId || actual.proyectoId;
    const row = {};
    if (has(d, 'nombre')) row.nombre = d.nombre; if (has(d, 'fecha')) row.fecha = fecha(d.fecha);
    if (has(d, 'etapaId')) row.etapa_id = await resolverEtapa(pid, d.etapaId);
    const extra = partir(d, C, ['creadoEn', 'actualizadoEn']);
    if (modo === 'add') {
      if (!row.fecha) throw err('La entrega necesita fecha.', 'invalido');
      id = (await q(sb.from('entregas').insert({ ...row, proyecto_id: pid, link_nas: d.linkNas || '', creado_por: ME, extra }).select('id').single())).id;
      return id;
    }
    const cambiaEstado = has(d, 'estado') && (EST_ENT[d.estado] || d.estado) !== actual.estado;
    if (!cambiaEstado && has(d, 'linkNas')) row.link_nas = d.linkNas || '';
    if (Object.keys(extra).length) row.extra = { ...extrasDe(actual, C), ...extra };
    if (Object.keys(row).length) await q(sb.from('entregas').update(row).eq('id', id));
    if (cambiaEstado) {
      const h = (d.historial || []).at(-1) || {};
      await q(sb.rpc('mover_entrega', { p_id: id, p_a: EST_ENT[d.estado] || d.estado, p_nota: h.nota || '', p_link: has(d, 'linkNas') ? d.linkNas || null : null }));
    }
    return id;
  },
};

COL.cambios = {
  tablas: ['cambios_alcance'],
  async cargar() {
    return (await todo('cambios_alcance')).map(c => ({ historial: [], ...(c.extra || {}), id: c.id, proyectoId: c.proyecto_id, descripcion: c.descripcion, solicitadoPor: c.solicitado_por,
      dias: c.dias_habiles, desde: c.desde, estado: c.estado, aprobadoPor: c.aprobado_por || '', aprobadoEn: c.aprobado_en || '', creadoPor: c.creado_por || '', creadoEn: c.creado_en }));
  },
  async guardar(id, d, modo) {
    const C = ['proyectoId', 'descripcion', 'solicitadoPor', 'dias', 'desde', 'estado', 'aprobadoPor', 'aprobadoEn', 'creadoPor'];
    const actual = modo === 'add' ? {} : (cache.cambios?.get(id) || {});
    const row = {};
    if (has(d, 'descripcion')) row.descripcion = d.descripcion || ''; if (has(d, 'solicitadoPor')) row.solicitado_por = d.solicitadoPor || 'Cliente';
    if (has(d, 'dias')) row.dias_habiles = Math.max(0, Math.min(365, parseInt(d.dias) || 0)); if (has(d, 'desde')) row.desde = fecha(d.desde) || new Date().toISOString().slice(0, 10);
    if (has(d, 'estado')) { row.estado = d.estado; if (d.estado === 'aprobado' && actual.estado !== 'aprobado') { row.aprobado_por = ME; row.aprobado_en = new Date().toISOString(); } }
    const extra = { ...extrasDe(actual, C), ...partir(d, C, ['creadoEn', 'actualizadoEn']) };
    if (modo === 'add') return (await q(sb.from('cambios_alcance').insert({ ...row, estado: 'propuesto', proyecto_id: d.proyectoId, creado_por: ME, extra }).select('id').single())).id;
    row.extra = extra;
    await q(sb.from('cambios_alcance').update(row).eq('id', id));
    return id;
  },
};

COL.tareas = {
  tablas: ['tareas', 'tarea_personas', 'tarea_checklist', 'entregables', 'cronometros'],
  async cargar() {
    const [ts, tp, ck, en, cr] = await Promise.all([todo('tareas'), todo('tarea_personas'), q(sb.from('tarea_checklist').select('*').order('orden').range(0, 99999)),
      q(sb.from('entregables').select('*').order('en').range(0, 99999)), todo('cronometros')]);
    return ts.map(t => ({ ...(t.extra || {}), id: t.id, num: t.num, panel: P2V[t.panel], proyectoId: t.proyecto_id || '', etapaId: t.etapa_id || '', padreId: t.padre_id || '',
      dependeDe: t.depende_de || '', titulo: t.titulo, descripcion: t.descripcion, estado: t.estado, prioridad: t.prioridad, responsableId: t.responsable_id || '',
      creadorId: t.verificador_id || '', requiereAprobacion: t.requiere_aprobacion, inicio: t.inicio || '', limite: t.limite || '', etiquetas: t.etiquetas || [],
      asignadaPor: t.creado_por || '', creadaEn: t.creado_en, actualizadaEn: t.actualizado_en, completadaEn: t.completada_en || null,
      participantes: tp.filter(x => x.tarea_id === t.id && x.rol === 'participante').map(x => x.persona_id),
      observadores: tp.filter(x => x.tarea_id === t.id && x.rol === 'observador').map(x => x.persona_id),
      checklist: ck.filter(x => x.tarea_id === t.id).map(x => ({ t: x.texto, ok: x.hecho })),
      entregables: en.filter(x => x.tarea_id === t.id).map(x => ({ id: x.id_origen || x.id, linkNas: x.link_nas, descripcion: x.nombre, autorId: x.por || '', en: x.en, estado: x.estado,
        comentario: x.nota, revisorId: x.revisado_por || '', revisadoEn: x.revisado_en || '' })),
      timers: Object.fromEntries(cr.filter(x => x.tarea_id === t.id).map(x => [x.persona_id, x.desde])) }));
  },
  async guardar(id, d, modo) {
    const C = ['num', 'panel', 'proyectoId', 'etapaId', 'padreId', 'dependeDe', 'titulo', 'descripcion', 'estado', 'prioridad', 'responsableId', 'creadorId', 'requiereAprobacion',
      'inicio', 'limite', 'etiquetas', 'asignadaPor', 'completadaEn', 'participantes', 'observadores', 'checklist', 'entregables', 'timers'];
    const actual = modo === 'add' ? {} : (cache.tareas?.get(id) || {});
    const pid = has(d, 'proyectoId') ? d.proyectoId : actual.proyectoId;
    const row = {};
    if (has(d, 'panel')) row.panel = V2P[d.panel] || 'disenos';
    if (has(d, 'proyectoId')) row.proyecto_id = idOrNull(d.proyectoId);
    if (has(d, 'etapaId')) row.etapa_id = await resolverEtapa(pid, d.etapaId);
    if (has(d, 'padreId')) row.padre_id = idOrNull(d.padreId); if (has(d, 'dependeDe')) row.depende_de = idOrNull(d.dependeDe);
    if (has(d, 'titulo')) row.titulo = d.titulo; if (has(d, 'descripcion')) row.descripcion = d.descripcion || '';
    if (has(d, 'estado')) row.estado = d.estado; if (has(d, 'prioridad')) row.prioridad = d.prioridad === 'alta' ? 'alta' : 'normal';
    if (has(d, 'responsableId')) row.responsable_id = idOrNull(d.responsableId); if (has(d, 'creadorId')) row.verificador_id = idOrNull(d.creadorId);
    if (has(d, 'requiereAprobacion')) row.requiere_aprobacion = d.requiereAprobacion !== false;
    if (has(d, 'inicio')) row.inicio = fecha(d.inicio); if (has(d, 'limite')) row.limite = fecha(d.limite);
    if (has(d, 'etiquetas')) row.etiquetas = (d.etiquetas || []).map(String);
    if (has(d, 'completadaEn')) row.completada_en = nul(d.completadaEn);
    const extra = partir(d, C, ['creadaEn', 'actualizadaEn']);
    if (modo === 'add') { row.creado_por = ME; row.extra = extra; if (!row.panel) row.panel = 'disenos'; id = (await q(sb.from('tareas').insert(row).select('id').single())).id; }
    else {
      if (Object.keys(extra).length) row.extra = { ...extrasDe(actual, C), ...extra };
      if (Object.keys(row).length) await q(sb.from('tareas').update(row).eq('id', id));
    }
    if (has(d, 'participantes') || has(d, 'observadores')) {
      const par = (d.participantes ?? actual.participantes ?? []).filter(uuidOk);
      const obs = (d.observadores ?? actual.observadores ?? []).filter(x => uuidOk(x) && !par.includes(x));
      const quiero = [...par.map(p => ({ tarea_id: id, persona_id: p, rol: 'participante' })), ...obs.map(p => ({ tarea_id: id, persona_id: p, rol: 'observador' }))];
      if (quiero.length) await q(sb.from('tarea_personas').upsert(quiero, { onConflict: 'tarea_id,persona_id' }));
      const hoy = await q(sb.from('tarea_personas').select('persona_id').eq('tarea_id', id));
      const sobran = hoy.map(x => x.persona_id).filter(p => !quiero.some(x => x.persona_id === p));
      if (sobran.length) await q(sb.from('tarea_personas').delete().eq('tarea_id', id).in('persona_id', sobran));
    }
    if (has(d, 'checklist') && JSON.stringify((d.checklist || []).map(c => [c.t, !!c.ok])) !== JSON.stringify((actual.checklist || []).map(c => [c.t, !!c.ok]))) {
      if (modo !== 'add') await q(sb.from('tarea_checklist').delete().eq('tarea_id', id));
      const filas = (d.checklist || []).map((c, i) => ({ tarea_id: id, orden: i, texto: String(c.t ?? c.texto ?? ''), hecho: !!(c.ok ?? c.hecho) }));
      if (filas.length) await q(sb.from('tarea_checklist').insert(filas));
    }
    if (has(d, 'entregables') && (d.entregables || []).length) {
      const filas = d.entregables.map(x => ({ tarea_id: id, id_origen: String(x.id || ''), nombre: x.descripcion || x.nombre || 'Entregable', link_nas: x.linkNas || '',
        estado: ['enviado', 'aprobado', 'devuelto'].includes(x.estado) ? x.estado : 'enviado', nota: x.comentario || x.nota || '', por: idOrNull(x.autorId), en: x.en || new Date().toISOString(),
        revisado_por: idOrNull(x.revisorId || x.revisadoPor), revisado_en: nul(x.revisadoEn) }));
      await q(sb.from('entregables').upsert(filas, { onConflict: 'tarea_id,id_origen' }));
    }
    if (has(d, 'timers')) {
      for (const [p, desde] of Object.entries(d.timers || {})) {
        if (!uuidOk(p)) continue;
        if (desde) await q(sb.from('cronometros').upsert({ persona_id: p, tarea_id: id, desde }, { onConflict: 'persona_id' }));
        else await q(sb.from('cronometros').delete().eq('persona_id', p).eq('tarea_id', id));
      }
    }
    return id;
  },
};

COL.comentarios = {   // subcolección tareas/{id}/comentarios
  tablas: ['comentarios'],
  async cargar(padre) {
    let qq = sb.from('comentarios').select('*').order('en').range(0, 99999); if (padre) qq = qq.eq('tarea_id', padre);
    return (await q(qq)).map(c => ({ id: c.id, tareaId: c.tarea_id, autorId: c.autor_id || '', texto: c.texto, en: c.en, sistema: c.sistema }));
  },
  async guardar(id, d, modo, padre) {
    if (modo !== 'add') throw err('Los comentarios no se editan.', 'regla');
    return (await q(sb.from('comentarios').insert({ tarea_id: padre, autor_id: idOrNull(d.autorId) || ME, texto: d.texto || '', sistema: !!d.sistema }).select('id').single())).id;
  },
};

COL.registros = {
  tablas: ['registros_horas'],
  async cargar() {
    return (await todo('registros_horas')).map(r => ({ id: r.id, tareaId: r.tarea_id || '', proyectoId: r.proyecto_id || '', miembroId: r.persona_id, fecha: r.fecha,
      inicio: r.inicio || '', fin: r.fin || '', horas: +r.horas, nota: r.nota, creadoEn: r.creado_en, horasOriginales: r.horas_originales != null ? +r.horas_originales : undefined,
      corregidoPor: r.corregido_por || '', corregidoEn: r.corregido_en || '', anulado: r.anulado, motivoAnulacion: r.motivo_anulacion || '', anuladoPor: r.anulado_por || '', anuladoEn: r.anulado_en || '' }));
  },
  async guardar(id, d, modo) {
    const row = {};
    if (has(d, 'fecha')) row.fecha = fecha(d.fecha); if (has(d, 'horas')) row.horas = Math.min(24, +d.horas);
    if (has(d, 'nota')) row.nota = d.nota || ''; if (has(d, 'anulado')) row.anulado = !!d.anulado; if (has(d, 'motivoAnulacion')) row.motivo_anulacion = d.motivoAnulacion || null;
    if (modo === 'add') return (await q(sb.from('registros_horas').insert({ ...row, tarea_id: idOrNull(d.tareaId), proyecto_id: idOrNull(d.proyectoId), persona_id: d.miembroId || ME,
      inicio: nul(d.inicio), fin: nul(d.fin) }).select('id').single())).id;
    await q(sb.from('registros_horas').update(row).eq('id', id));
    return id;
  },
};

COL.jornadas = {
  tablas: ['jornadas', 'jornada_pausas'],
  async cargar() {
    const [js, ps] = await Promise.all([todo('jornadas'), q(sb.from('jornada_pausas').select('*').order('desde').range(0, 99999))]);
    return js.map(j => ({ id: `${j.persona_id}_${j.fecha}`, miembroId: j.persona_id, fecha: j.fecha, entrada: j.entrada || null, salida: j.salida || null, nota: j.nota,
      editadoPor: j.editado_por || '', editadoEn: j.editado_en || '',
      pausas: ps.filter(p => p.persona_id === j.persona_id && p.fecha === j.fecha).map(p => ({ desde: p.desde, hasta: p.hasta || null })) }));
  },
  async guardar(id, d, modo) {
    const actual = cache.jornadas?.get(id) || {};
    const persona = d.miembroId || actual.miembroId || id.split('_')[0], dia = d.fecha || actual.fecha || id.split('_')[1];
    const row = { persona_id: persona, fecha: dia };
    if (has(d, 'entrada')) row.entrada = nul(d.entrada); if (has(d, 'salida')) row.salida = nul(d.salida); if (has(d, 'nota')) row.nota = d.nota || '';
    if (persona !== ME) { row.editado_por = ME; row.editado_en = new Date().toISOString(); }
    if (modo === 'set') { row.entrada ??= null; row.salida ??= null; }
    await q(sb.from('jornadas').upsert(row, { onConflict: 'persona_id,fecha' }));
    if (has(d, 'pausas')) {
      await q(sb.from('jornada_pausas').delete().eq('persona_id', persona).eq('fecha', dia));
      const filas = (d.pausas || []).filter(p => p.desde).map(p => ({ persona_id: persona, fecha: dia, desde: p.desde, hasta: nul(p.hasta) }));
      if (filas.length) await q(sb.from('jornada_pausas').insert(filas));
    }
    return `${persona}_${dia}`;
  },
};

const hhmm = t => (t ? String(t).slice(0, 5) : '');
COL.reuniones = {
  tablas: ['reuniones', 'reunion_personas'],
  async cargar() {
    const [rs, rp] = await Promise.all([todo('reuniones'), todo('reunion_personas')]);
    return rs.map(r => {
      let fin = ''; if (r.hora && r.duracion_min) { const [h, m] = r.hora.split(':').map(Number), t = h * 60 + m + r.duracion_min; fin = `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; }
      return { ...(r.extra || {}), id: r.id, proyectoId: r.proyecto_id || '', titulo: r.titulo, fecha: r.fecha, horaIni: hhmm(r.hora), horaFin: fin, lugar: r.lugar, tipo: r.tipo,
        estado: r.estado === 'programada' ? '' : r.estado, externos: r.externos, acuerdos: r.acuerdos, notas: r.notas, creadorId: r.creado_por || '', creadaEn: r.creado_en,
        participantes: rp.filter(x => x.reunion_id === r.id).map(x => x.persona_id) };
    });
  },
  async guardar(id, d, modo) {
    const C = ['proyectoId', 'titulo', 'fecha', 'horaIni', 'horaFin', 'lugar', 'tipo', 'estado', 'externos', 'acuerdos', 'notas', 'creadorId', 'participantes'];
    const actual = modo === 'add' ? {} : (cache.reuniones?.get(id) || {});
    const row = {};
    if (has(d, 'proyectoId')) row.proyecto_id = idOrNull(d.proyectoId); if (has(d, 'titulo')) row.titulo = d.titulo || 'Reunión'; if (has(d, 'fecha')) row.fecha = fecha(d.fecha);
    if (has(d, 'horaIni')) row.hora = d.horaIni || null;
    if (has(d, 'horaIni') || has(d, 'horaFin')) {
      const a = d.horaIni ?? actual.horaIni, b = d.horaFin ?? actual.horaFin;
      if (a && b) { const [h1, m1] = a.split(':').map(Number), [h2, m2] = b.split(':').map(Number); const m = (h2 * 60 + m2) - (h1 * 60 + m1); row.duracion_min = m > 0 ? m : null; } else row.duracion_min = null;
    }
    for (const k of ['lugar', 'tipo', 'externos', 'acuerdos', 'notas']) if (has(d, k)) row[k] = d[k] || '';
    if (has(d, 'estado')) row.estado = ['realizada', 'cancelada'].includes(d.estado) ? d.estado : 'programada';
    const extra = partir(d, C, ['creadaEn', 'actualizadaEn']);
    if (modo === 'add') { row.creado_por = ME; row.extra = extra; id = (await q(sb.from('reuniones').insert(row).select('id').single())).id; }
    else { if (Object.keys(extra).length) row.extra = { ...extrasDe(actual, C), ...extra }; if (Object.keys(row).length) await q(sb.from('reuniones').update(row).eq('id', id)); }
    if (has(d, 'participantes')) {
      const quiero = (d.participantes || []).filter(uuidOk);
      if (quiero.length) await q(sb.from('reunion_personas').upsert(quiero.map(p => ({ reunion_id: id, persona_id: p })), { onConflict: 'reunion_id,persona_id' }));
      const hoy = await q(sb.from('reunion_personas').select('persona_id').eq('reunion_id', id));
      const sobran = hoy.map(x => x.persona_id).filter(p => !quiero.includes(p));
      if (sobran.length) await q(sb.from('reunion_personas').delete().eq('reunion_id', id).in('persona_id', sobran));
    }
    return id;
  },
};

COL.bitacora = {
  tablas: ['bitacora', 'fotos'],
  async cargar() {
    const [bs, fs] = await Promise.all([todo('bitacora'), todo('fotos')]);
    await firmar(fs.map(f => f.storage_path));
    return bs.map(b => ({ ...(b.extra || {}), id: b.id, proyectoId: b.proyecto_id, fecha: b.fecha, tipo: b.tipo, clima: b.clima, personal: b.personal ?? '', actividades: b.actividades,
      novedades: b.novedades, autorId: b.autor_id || '', creadaEn: b.creada_en, fotos: fs.filter(f => f.bitacora_id === b.id).map(f => f.storage_path) }));
  },
  async guardar(id, d, modo) {
    const C = ['proyectoId', 'fecha', 'tipo', 'clima', 'personal', 'actividades', 'novedades', 'autorId', 'fotos'];
    const row = {};
    if (has(d, 'fecha')) row.fecha = fecha(d.fecha); if (has(d, 'tipo')) row.tipo = d.tipo === 'visita' ? 'visita' : 'diario';
    if (has(d, 'clima')) row.clima = d.clima || ''; if (has(d, 'personal')) row.personal = d.personal === '' || d.personal == null ? null : Math.max(0, parseInt(d.personal) || 0);
    if (has(d, 'actividades')) row.actividades = d.actividades || ''; if (has(d, 'novedades')) row.novedades = d.novedades || '';
    const extra = partir(d, C, ['creadaEn']);
    const pid = d.proyectoId || cache.bitacora?.get(id)?.proyectoId;
    if (modo === 'add') id = (await q(sb.from('bitacora').insert({ ...row, proyecto_id: pid, autor_id: ME, extra }).select('id').single())).id;
    else if (Object.keys(row).length) await q(sb.from('bitacora').update(row).eq('id', id));
    await guardarFotos(d.fotos, pid, { bitacora_id: id });
    return id;
  },
};
async function guardarFotos(rutas, pid, ref, momento = null) {
  const nuevas = (rutas || []).filter(r => typeof r === 'string' && r.startsWith('obra/'));
  if (!nuevas.length) return;
  await q(sb.from('fotos').upsert(nuevas.map(r => ({ proyecto_id: pid, ...ref, momento, storage_path: r, subida_por: ME })), { onConflict: 'storage_path', ignoreDuplicates: true }));
}

const OBRA_C = ['proyectoId', 'clase', 'titulo', 'detalle', 'responsable', 'ubicacion', 'plazo', 'entidad', 'numero', 'vence', 'linkNas', 'estado', 'paraId', 'respuesta',
  'respondidaPor', 'respondidaEn', 'cierre', 'cerradoPor', 'cerradoEn', 'creadoPor', 'fotos', 'fotosDespues'];
COL.obra = {
  tablas: ['obra_items', 'fotos'],
  async cargar() {
    const [xs, fs] = await Promise.all([todo('obra_items'), todo('fotos')]);
    await firmar(fs.map(f => f.storage_path));
    return xs.map(x => ({ ...(x.extra || {}), id: x.id, proyectoId: x.proyecto_id, clase: x.clase, titulo: x.titulo, detalle: x.detalle, responsable: x.responsable, ubicacion: x.ubicacion,
      plazo: x.plazo || '', entidad: x.entidad, numero: x.numero, vence: x.vence || '', linkNas: x.link_nas, estado: x.estado, paraId: x.para_id || '', respuesta: x.respuesta || '',
      respondidaPor: x.respondida_por || '', respondidaEn: x.respondida_en || '', cierre: x.cierre, cerradoPor: x.cerrado_por || '', cerradoEn: x.cerrado_en || '',
      creadoPor: x.creado_por || '', creadoEn: x.creado_en,
      fotos: fs.filter(f => f.obra_item_id === x.id && f.momento !== 'despues').map(f => f.storage_path),
      fotosDespues: fs.filter(f => f.obra_item_id === x.id && f.momento === 'despues').map(f => f.storage_path) }));
  },
  async guardar(id, d, modo) {
    const actual = modo === 'add' ? {} : (cache.obra?.get(id) || {});
    const row = {};
    for (const [v, c] of [['titulo', 'titulo'], ['detalle', 'detalle'], ['responsable', 'responsable'], ['ubicacion', 'ubicacion'], ['entidad', 'entidad'], ['numero', 'numero'], ['linkNas', 'link_nas'], ['cierre', 'cierre']])
      if (has(d, v)) row[c] = d[v] || '';
    if (has(d, 'plazo')) row.plazo = fecha(d.plazo); if (has(d, 'vence')) row.vence = fecha(d.vence); if (has(d, 'estado')) row.estado = d.estado;
    if (has(d, 'paraId')) row.para_id = idOrNull(d.paraId); if (has(d, 'respuesta')) row.respuesta = d.respuesta || null;
    if (has(d, 'respondidaEn')) { row.respondida_por = ME; row.respondida_en = nul(d.respondidaEn); }
    if (has(d, 'cerradoEn')) { row.cerrado_por = d.cerradoEn ? ME : null; row.cerrado_en = nul(d.cerradoEn); }
    const extra = partir(d, OBRA_C, ['creadoEn', 'actualizadoEn']);
    const pid = d.proyectoId || actual.proyectoId;
    if (modo === 'add') id = (await q(sb.from('obra_items').insert({ ...row, clase: d.clase, proyecto_id: pid, creado_por: ME, extra }).select('id').single())).id;
    else { if (Object.keys(extra).length) row.extra = { ...extrasDe(actual, OBRA_C), ...extra }; if (Object.keys(row).length) await q(sb.from('obra_items').update(row).eq('id', id)); }
    const cl = d.clase || actual.clase;
    await guardarFotos(d.fotos, pid, { obra_item_id: id }, cl === 'pendiente' ? 'antes' : null);
    await guardarFotos(d.fotosDespues, pid, { obra_item_id: id }, 'despues');
    return id;
  },
};

COL.obraPlan = {
  tablas: ['planes_obra', 'partidas', 'avance_obra', 'plan_historial'],
  async cargar() {
    const [pl, pa, av, hi] = await Promise.all([todo('planes_obra'), q(sb.from('partidas').select('*').order('orden').range(0, 99999)), q(sb.from('avance_obra').select('*').order('fecha').range(0, 99999)),
      q(sb.from('plan_historial').select('*').order('en').range(0, 99999))]);
    return pl.map(p => ({ ...(p.extra || {}), id: p.proyecto_id, proyectoId: p.proyecto_id, estado: p.estado, nota: p.nota, preparadoPor: p.preparado_por || '', enviadoEn: p.enviado_en || '',
      aprobadoPor: p.aprobado_por || '', aprobadoEn: p.aprobado_en || '', actualizadoEn: p.actualizado_en,
      partidas: pa.filter(x => x.proyecto_id === p.proyecto_id).map(x => ({ id: x.id_origen || x.id, nombre: x.nombre, valor: +x.valor, inicio: x.inicio, fin: x.fin, avance: +x.avance })),
      hist: av.filter(x => x.proyecto_id === p.proyecto_id).map(x => ({ fecha: x.fecha, avance: +x.avance })),
      historial: hi.filter(x => x.proyecto_id === p.proyecto_id).map(x => ({ estado: x.estado, nota: x.nota, por: x.por || '', en: x.en })) }));
  },
  async guardar(id, d, modo) {
    const C = ['proyectoId', 'estado', 'nota', 'preparadoPor', 'enviadoEn', 'aprobadoPor', 'aprobadoEn', 'partidas', 'hist', 'historial'];
    const pid = d.proyectoId || id;
    let actual = cache.obraPlan?.get(pid);
    const extra = partir(d, C, ['actualizadoEn', 'avancePor']);
    if (!actual) { await q(sb.from('planes_obra').insert({ proyecto_id: pid, estado: 'borrador', extra })); actual = { estado: 'borrador', partidas: [] }; }
    else if (Object.keys(extra).length) await q(sb.from('planes_obra').update({ extra: { ...extrasDe(actual, C), ...extra } }).eq('proyecto_id', pid));
    if (has(d, 'partidas')) {
      const ps = d.partidas || [];
      const filas = await q(sb.from('partidas').select('id,id_origen,orden,avance').eq('proyecto_id', pid));
      const buscar = pidx => filas.find(f => f.id === pidx || f.id_origen === String(pidx));
      if (actual.estado === 'aprobado') {
        for (const x of ps) { const f = buscar(x.id); if (f && +x.avance !== +f.avance) await q(sb.from('partidas').update({ avance: Math.max(0, Math.min(100, +x.avance || 0)) }).eq('id', f.id)); }
        await q(sb.rpc('registrar_avance', { p_proyecto: pid }));
      } else {
        const salen = filas.filter(f => !ps.some(x => buscar(x.id)?.id === f.id));
        if (salen.length) await q(sb.from('partidas').delete().in('id', salen.map(f => f.id)));
        for (const f of filas) if (!salen.includes(f)) await q(sb.from('partidas').update({ orden: 1000 + f.orden }).eq('id', f.id));
        for (let i = 0; i < ps.length; i++) {
          const x = ps[i], f = buscar(x.id);
          if (!(+x.valor > 0) || !x.inicio || !x.fin) continue;   // partidas incompletas no se guardan hasta tener valor y fechas
          const row = { orden: i + 1, nombre: String(x.nombre || '').trim() || 'Partida', valor: +x.valor, inicio: fecha(x.inicio), fin: fecha(x.fin) };
          if (f) await q(sb.from('partidas').update(row).eq('id', f.id)); else await q(sb.from('partidas').insert({ ...row, proyecto_id: pid, id_origen: String(x.id || nuevoId()) }));
        }
      }
    }
    if (has(d, 'estado') && d.estado !== actual.estado) {
      const h = (d.historial || []).at(-1) || {};
      await q(sb.rpc('mover_plan', { p_proyecto: pid, p_a: d.estado, p_nota: h.nota || d.nota || '' }));
    }
    return pid;
  },
};

COL.fotos = {   // fotos de perfil: fotos/{persona}
  tablas: ['personas'],
  async cargar() {
    const ps = (await todo('personas', 'id,foto_path')).filter(p => p.foto_path);
    await firmar(ps.map(p => p.foto_path));
    return ps.map(p => ({ id: p.id, foto: p.foto_path }));
  },
  async guardar(id, d) { await q(sb.from('personas').update({ foto_path: d.foto || null }).eq('id', id)); return id; },
};

COL.programacion = {
  tablas: ['programaciones'],
  async cargar() {
    return (await todo('programaciones')).map(p => ({ ...(p.contenido || {}), id: p.semana, semana: p.semana, estado: p.estado, publicadaEn: p.publicada_en, publicadaPor: p.publicada_por || '' }));
  },
  async guardar(id, d, modo) {
    const actual = cache.programacion?.get(id);
    const { semana, estado, publicadaEn, publicadaPor, id: _x, ...resto } = d;
    const row = { semana: id };
    if (estado !== undefined) row.estado = estado;
    if (publicadaEn !== undefined) row.publicada_en = publicadaEn; if (publicadaPor !== undefined) row.publicada_por = idOrNull(publicadaPor);
    const cont = { ...(modo === 'set' ? {} : (actual ? partir(actual, ['semana', 'estado', 'publicadaEn', 'publicadaPor']) : {})), ...resto };
    row.contenido = cont;
    if (!actual) { row.estado ??= 'publicada'; await q(sb.from('programaciones').insert(row)); }
    else await q(sb.from('programaciones').update(row).eq('semana', id));
    return id;
  },
};

COL.config = {
  tablas: ['config'],
  async cargar() { return (await todo('config')).map(c => ({ ...(typeof c.valor === 'object' && c.valor ? c.valor : { valor: c.valor }), id: c.clave })); },
  async guardar(id, d, modo) {
    const actual = cache.config?.get(id);
    const valor = modo === 'set' ? d : { ...(actual || {}), ...d }; delete valor.id;
    await q(sb.from('config').upsert({ clave: id, valor }, { onConflict: 'clave' }));
    return id;
  },
};

// Colecciones que la v2 resuelve de otra forma
COL.contadores = { tablas: ['tareas'], async cargar() { const r = await q(sb.from('tareas').select('num').order('num', { ascending: false }).limit(1)); return [{ id: 'tareas', ultimo: r[0]?.num || 0 }]; }, async guardar(id) { return id; } };
COL.credenciales = { tablas: [], async cargar() { return [{ id: '_supabase' }]; }, async guardar() { throw err('En la v2 el acceso se da por invitación de correo: registra el correo de la persona y el administrador la invita desde Supabase.', 'regla'); } };

// ---------- Caché, consultas y avisos de cambios ----------
const cache = {};          // nombre -> Map(id -> doc)
const cargando = {};
const oyentes = new Set(); // { nombre, padre, consulta, cb, err }
const claveDe = (nombre, padre) => (padre ? `${nombre}@${padre}` : nombre);

async function asegurar(nombre, padre) {
  const k = claveDe(nombre, padre);
  if (cache[k]) return cache[k];
  if (!cargando[k]) cargando[k] = recargar(nombre, padre).finally(() => { delete cargando[k]; });
  return cargando[k];
}
async function recargar(nombre, padre) {
  const k = claveDe(nombre, padre); const def = COL[nombre];
  if (!def) throw err(`Colección desconocida: ${nombre}`);
  const docs = await def.cargar(padre);
  cache[k] = new Map(docs.map(x => [x.id, x]));
  if (nombre === 'tareas' || nombre === 'contadores') { /* nada */ }
  avisar(k);
  return cache[k];
}
function avisar(k) {
  for (const o of oyentes) if (claveDe(o.nombre, o.padre) === k) entregar(o);
}
function aplicar(docs, c) {
  let r = [...docs];
  for (const [f, op, v] of c.wheres) r = r.filter(x => {
    const a = x[f];
    switch (op) { case '==': return a === v; case '!=': return a !== v; case '>=': return a >= v; case '>': return a > v; case '<=': return a <= v; case '<': return a < v;
      case 'in': return v.includes(a); case 'array-contains': return Array.isArray(a) && a.includes(v); default: return true; }
  });
  if (c.orden) { const [f, dir] = c.orden; r.sort((a, b) => (a[f] > b[f] ? 1 : a[f] < b[f] ? -1 : 0) * (dir === 'desc' ? -1 : 1)); }
  if (c.lim) r = r.slice(0, c.lim);
  return r;
}
const snapDoc = x => ({ id: x.id, exists: true, data: () => copia(x), ref: null });
const snapCol = docs => { const ds = docs.map(snapDoc); return { docs: ds, size: ds.length, empty: !ds.length, forEach: fn => ds.forEach(fn) }; };
function entregar(o) {
  const m = cache[claveDe(o.nombre, o.padre)]; if (!m) return;
  try { o.cb(o.esDoc ? (m.has(o.id) ? snapDoc(m.get(o.id)) : { id: o.id, exists: false, data: () => undefined }) : snapCol(aplicar([...m.values()], o.consulta))); }
  catch (e) { console.error(e); }
}

// Rutas tipo «tareas/ID/comentarios» o «config/respaldo»
function ruta(path) {
  const s = String(path).split('/').filter(Boolean);
  if (s.length === 3 && s[0] === 'tareas' && s[2] === 'comentarios') return { nombre: 'comentarios', padre: s[1] };
  if (s.length === 4 && s[0] === 'tareas' && s[2] === 'comentarios') return { nombre: 'comentarios', padre: s[1], id: s[3] };
  if (s.length === 2) return { nombre: s[0], id: s[1] };
  return { nombre: s[0] };
}

async function escribir(nombre, padre, id, data, modo) {
  const def = COL[nombre]; if (!def) throw err(`Colección desconocida: ${nombre}`);
  await asegurar(nombre, padre);
  const nuevo = await def.guardar(id, copia(data) || {}, modo, padre);
  await recargarRelacionadas(nombre, padre);
  return nuevo;
}
// Después de guardar se recarga lo que pudo cambiar (incluye efectos de reglas y funciones de la base)
const RELACION = { tareas: ['tareas', 'registros'], hitos: ['hitos'], obraPlan: ['obraPlan', 'proyectos'], miembros: ['miembros', 'fotos'], fotos: ['fotos', 'miembros'], proyectos: ['proyectos'] };
async function recargarRelacionadas(nombre, padre) {
  const lista = RELACION[nombre] || [nombre];
  await Promise.all(lista.map(n => (n === nombre ? recargar(n, padre) : cache[n] ? recargar(n) : null)));
}

function coleccion(path, consulta = { wheres: [], orden: null, lim: 0 }) {
  const { nombre, padre } = ruta(path);
  const api = {
    where: (f, op, v) => coleccion(path, { ...consulta, wheres: [...consulta.wheres, [f, op, v]] }),
    orderBy: (f, dir = 'asc') => coleccion(path, { ...consulta, orden: [f, dir] }),
    limit: n => coleccion(path, { ...consulta, lim: n }),
    doc: id => documento(`${path}/${id ?? nuevoId()}`),
    async add(data) { const id = await escribir(nombre, padre, null, data, 'add'); return { id }; },
    async get() { const m = await asegurar(nombre, padre); return snapCol(aplicar([...m.values()], consulta)); },
    onSnapshot(cb, errCb) {
      const o = { nombre, padre, consulta, cb, err: errCb };
      oyentes.add(o); vigilar(nombre);
      asegurar(nombre, padre).then(() => entregar(o)).catch(e => { console.error(nombre, e); errCb?.(e); });
      return () => oyentes.delete(o);
    },
  };
  return api;
}
function documento(path) {
  const { nombre, padre, id } = ruta(path);
  return {
    id,
    collection: sub => coleccion(`${path}/${sub}`),
    async get() { const m = await asegurar(nombre, padre); const x = m.get(id); return x ? snapDoc(x) : { id, exists: false, data: () => undefined }; },
    async set(data, opts) { await escribir(nombre, padre, id, data, opts?.merge ? 'update' : (cache[claveDe(nombre, padre)]?.has(id) ? 'set' : 'set')); },
    async update(patch) { await escribir(nombre, padre, id, patch, 'update'); },
    async delete() { throw err('En SRA los registros no se borran: archívalos o márcalos como inactivos.', 'regla'); },
    async acquire() { return { acquired: true }; },
    async release() {},
    onSnapshot(cb, errCb) {
      const o = { nombre, padre, id, esDoc: true, cb, err: errCb };
      oyentes.add(o); vigilar(nombre);
      asegurar(nombre, padre).then(() => entregar(o)).catch(e => errCb?.(e));
      return () => oyentes.delete(o);
    },
  };
}

// ---------- Tiempo real (con respaldo por consulta periódica) ----------
const vigiladas = new Set();
let canal = null, tiempoReal = false, temporizador = null;
const pendientes = new Set();
function vigilar(nombre) { vigiladas.add(nombre); }
function programarRecarga(nombres) {
  nombres.forEach(n => pendientes.add(n));
  clearTimeout(temporizador);
  temporizador = setTimeout(() => {
    const lista = [...pendientes]; pendientes.clear();
    for (const k of Object.keys(cache)) { const [n, padre] = k.split('@'); if (lista.includes(n)) recargar(n, padre).catch(e => console.warn(n, e)); }
  }, 400);
}
function coleccionesDeTabla(tabla) { return Object.entries(COL).filter(([, d]) => d.tablas.includes(tabla)).map(([n]) => n); }
export function iniciarTiempoReal() {
  try {
    canal = sb.channel('sra-mesa')
      .on('postgres_changes', { event: '*', schema: 'sra' }, p => programarRecarga(coleccionesDeTabla(p.table)))
      .subscribe(estado => { tiempoReal = estado === 'SUBSCRIBED'; });
  } catch (e) { console.warn('tiempo real', e); }
  // Respaldo: si el tiempo real no está disponible, se consulta cada 30 s (y siempre al volver a la pestaña)
  setInterval(() => { if (!tiempoReal && document.visibilityState === 'visible') programarRecarga([...vigiladas]); }, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') programarRecarga([...vigiladas]); });
  setInterval(() => firmar([...firmas.keys()]), 20 * 60e3);
}

export const db = { collection: coleccion, doc: documento };
export { COL, cache as _cache };
