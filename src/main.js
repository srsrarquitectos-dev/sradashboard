// SRA Project Management v2: acceso seguro y, después, la mesa conectada a Supabase.
import './generado/mesa.css';
import './acceso.css';
import { sb } from './supabase.js';
import { acceder, salir, reverificar, modo } from './acceso.js';
import { db, setYo, sraBlob, iniciarTiempoReal } from './datos.js';

function descargar({ filename, data, mime }) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime || (filename.endsWith('.csv') ? 'text/csv;charset=utf-8' : 'application/json') });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function subir(blob, opts = {}, yo) {
  const nombre = `${crypto.randomUUID()}.jpg`;
  let bucket, ruta;
  if (opts.perfil) { bucket = 'perfiles'; ruta = `${yo}/${nombre}`; }
  else if (opts.proyecto) { bucket = 'obra'; ruta = `${opts.proyecto}/${nombre}`; }
  else throw Object.assign(new Error('No se sabe a qué proyecto pertenece la foto.'), { code: 'sra' });
  if (blob.size > 8 * 1024 * 1024) throw Object.assign(new Error('Foto muy grande'), { code: 'too_large' });
  const { error } = await sb.storage.from(bucket).upload(ruta, blob, { contentType: opts.type || 'image/jpeg', upsert: false });
  if (error) throw Object.assign(new Error(error.message), { code: 'upload' });
  return { id: `${bucket}/${ruta}` };
}

async function arrancar() {
  let sesion;
  try { sesion = await acceder(); }
  catch (e) {
    console.error(e);
    document.getElementById('sra-acceso').innerHTML = `<div class="auth"><div class="auth-card"><h1>No se pudo conectar</h1><p>Revisa tu conexión a internet y recarga la página. Si el problema sigue, escribe a soporte.</p></div></div>`;
    return;
  }
  const { data: yo } = await sb.from('personas').select('rol').eq('id', sesion.personaId).single();
  setYo(sesion.personaId);
  window.SRA_SESION = sesion;
  window.SRA_SALIR = msg => salir(msg);
  window.SRA_REVERIFICAR = reverificar;
  window.SRA_REV = modo;
  window.sraBlob = sraBlob;
  // La mesa v1 pide sus servicios con window.claude.use(...); aquí se entregan los de Supabase
  window.claude = {
    use: async nombre => ({
      db,
      user: { can: async () => true, canEdit: async () => yo?.rol === 'admin' },
      downloads: { save: async x => descargar(x) },
      assets: { upload: (blob, opts) => subir(blob, opts, sesion.personaId) },
    })[nombre] || null,
  };
  document.body.classList.remove('sra-cargando');
  document.getElementById('sra-app').hidden = false;
  iniciarTiempoReal();
  // Si la sesión se cierra en otra pestaña o vence, se vuelve a pedir el acceso
  sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') location.replace(location.pathname); });
  // Fotos que no cargan: aviso en lugar de imagen rota
  document.addEventListener('error', e => {
    const img = e.target; if (img?.tagName === 'IMG' && img.dataset.fallback) img.replaceWith(Object.assign(document.createElement('span'), { className: 'sub', textContent: 'Foto no disponible' }));
  }, true);
  await import('./generado/mesa.js');
}
arrancar();
