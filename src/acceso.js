// Acceso a la mesa: correo + contraseña, doble verificación con app autenticadora (TOTP) y autorización de datos.
import { sb, recordar, tipoEnlace } from './supabase.js';

export const AVISO_VERSION = '2026-11-v1';
const raiz = () => document.getElementById('sra-acceso');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tarjeta = (cuerpo, ojo = 'Santiago Rubiano Arquitectos') =>
  `<div class="auth"><form class="auth-card" novalidate><div class="eyebrow">${esc(ojo)}</div>${cuerpo}</form></div>`;
const mostrar = html => { raiz().innerHTML = html; raiz().hidden = false; const f = raiz().querySelector('input'); if (f) f.focus(); return raiz().querySelector('form'); };
const err = (txt) => { const e = raiz().querySelector('.err'); if (e) e.textContent = txt || ''; };
const ocupado = (f, si) => { const b = f.querySelector('button[type=submit]'); if (b) b.disabled = si; };

const MENSAJES = {
  invalid_credentials: 'Correo o contraseña incorrectos.',
  email_not_confirmed: 'Tu correo aún no está confirmado. Revisa la invitación que te llegó.',
  mfa_verification_failed: 'El código no es correcto o ya venció. Escribe el que muestra ahora tu app.',
  mfa_challenge_expired: 'El código venció. Escribe el que muestra ahora tu app.',
  over_request_rate_limit: 'Demasiados intentos. Espera un momento y vuelve a intentar.',
  over_email_send_rate_limit: 'Ya se envió un correo hace poco. Espera unos minutos.',
  weak_password: 'La contraseña es muy débil o aparece en filtraciones conocidas. Usa otra.',
  same_password: 'La contraseña nueva debe ser distinta de la anterior.',
};
const texto = e => MENSAJES[e?.code] || MENSAJES[e?.error_code] || (e?.status === 429 ? MENSAJES.over_request_rate_limit : null) ||
  (/fetch|network/i.test(e?.message || '') ? 'Sin conexión con el servidor. Revisa tu internet.' : 'No se pudo completar. Intenta de nuevo.');
const codigoOk = c => /^\d{6}$/.test(c);
export const problemaContrasena = p => (p || '').length < 6 ? 'La contraseña debe tener al menos 6 caracteres.'
  : (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(p) || !/\d/.test(p)) ? 'La contraseña debe combinar letras y números.' : '';

// ---------- Pantallas ----------
function pantallaEntrar(aviso = '') {
  return new Promise(resolve => {
    let fallos = 0, esperaHasta = 0;
    const f = mostrar(tarjeta(`<h1>Iniciar sesión</h1><p>Entra con tu correo y tu contraseña.</p>
      ${aviso ? `<div class="notice" style="margin:0 0 12px">${esc(aviso)}</div>` : ''}
      <label class="f">Correo<input type="email" id="ac-c" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
      <label class="f">Contraseña<input type="password" id="ac-p" autocomplete="current-password" required></label>
      <label class="ck"><input type="checkbox" id="ac-r" ${recordar.get() ? 'checked' : ''}> Mantener la sesión abierta en este equipo</label>
      <div class="err" role="alert"></div><button class="btn pri" type="submit">Entrar</button>
      <p class="sub"><a href="#" id="ac-olv">¿Olvidaste tu contraseña?</a></p>`));
    raiz().querySelector('#ac-olv').onclick = e => { e.preventDefault(); pantallaRecuperar().then(() => pantallaEntrar().then(resolve)); };
    f.onsubmit = async e => {
      e.preventDefault(); err('');
      if (Date.now() < esperaHasta) return err(`Demasiados intentos. Espera ${Math.ceil((esperaHasta - Date.now()) / 1000)} s.`);
      const email = f.querySelector('#ac-c').value.trim().toLowerCase(), password = f.querySelector('#ac-p').value;
      if (!email || !password) return err('Escribe tu correo y tu contraseña.');
      recordar.set(f.querySelector('#ac-r').checked);
      ocupado(f, true);
      const { error } = await sb.auth.signInWithPassword({ email, password });
      ocupado(f, false);
      if (error) { if (++fallos >= 5) { fallos = 0; esperaHasta = Date.now() + 30000; } return err(texto(error)); }
      resolve();
    };
  });
}

function pantallaRecuperar() {
  return new Promise(resolve => {
    const f = mostrar(tarjeta(`<h1>Recuperar contraseña</h1><p>Escribe tu correo. Si está registrado en SRA, te llegará un enlace para crear una contraseña nueva.</p>
      <label class="f">Correo<input type="email" id="rc-c" autocomplete="username" autocapitalize="none" spellcheck="false"></label>
      <div class="err" role="alert"></div><button class="btn pri" type="submit">Enviar enlace</button>
      <p class="sub"><a href="#" id="rc-v">Volver</a></p>`));
    raiz().querySelector('#rc-v').onclick = e => { e.preventDefault(); resolve(); };
    f.onsubmit = async e => {
      e.preventDefault(); err('');
      const email = f.querySelector('#rc-c').value.trim().toLowerCase(); if (!email) return err('Escribe tu correo.');
      ocupado(f, true);
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      ocupado(f, false);
      if (error && error.status === 429) return err(texto(error));
      // Mismo mensaje exista o no el correo, para no revelar quién tiene cuenta
      mostrar(tarjeta(`<h1>Revisa tu correo</h1><p>Si <b>${esc(email)}</b> está registrado, en unos minutos te llega el enlace. Revisa también la carpeta de spam.</p><button class="btn pri" type="submit">Volver a iniciar sesión</button>`))
        .onsubmit = ev => { ev.preventDefault(); resolve(); };
    };
  });
}

function pantallaNuevaContrasena(invitacion) {
  return new Promise(resolve => {
    const f = mostrar(tarjeta(`<h1>${invitacion ? 'Bienvenido a SRA Project Management' : 'Crea una contraseña nueva'}</h1>
      <p>${invitacion ? 'Crea tu contraseña para entrar. Después configurarás la doble verificación.' : 'Escribe tu nueva contraseña.'}</p>
      <label class="f">Contraseña nueva<input type="password" id="nc-1" autocomplete="new-password"></label>
      <label class="f">Repite la contraseña<input type="password" id="nc-2" autocomplete="new-password"></label>
      <div class="err" role="alert"></div><button class="btn pri" type="submit">Guardar contraseña</button>
      <p class="sub">Mínimo 6 caracteres, con letras y números.</p>`, invitacion ? 'Primer ingreso' : 'Seguridad'));
    f.onsubmit = async e => {
      e.preventDefault(); err('');
      const a = f.querySelector('#nc-1').value, b = f.querySelector('#nc-2').value;
      const p = problemaContrasena(a); if (p) return err(p); if (a !== b) return err('Las contraseñas no coinciden.');
      ocupado(f, true);
      const { error } = await sb.auth.updateUser({ password: a });
      ocupado(f, false);
      if (error) return err(texto(error));
      resolve();
    };
  });
}

async function pantallaActivarApp() {
  // Quita intentos anteriores sin terminar
  const { data: lista } = await sb.auth.mfa.listFactors();
  for (const x of (lista?.all || []).filter(x => x.factor_type === 'totp' && x.status !== 'verified')) await sb.auth.mfa.unenroll({ factorId: x.id });
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: `SRA ${new Date().toISOString().slice(0, 10)}`, issuer: 'SRA Project Management' });
  if (error) throw error;
  const qr = data.totp.qr_code.startsWith('data:') ? data.totp.qr_code : `data:image/svg+xml;utf-8,${encodeURIComponent(data.totp.qr_code)}`;
  return new Promise(resolve => {
    const f = mostrar(tarjeta(`<h1>Activa la doble verificación</h1>
      <p>1. Instala en tu celular una app autenticadora (Google Authenticator, Microsoft Authenticator o similar).</p>
      <p>2. En la app, toca <b>agregar</b> y escanea este código:</p>
      <div style="display:flex;justify-content:center;margin:8px 0"><img src="${esc(qr)}" alt="Código QR para la app autenticadora" width="180" height="180" style="background:#fff;padding:8px;border-radius:8px"></div>
      <details style="margin:0 0 10px"><summary class="sub">¿No puedes escanear? Escribe esta clave en la app</summary><code style="word-break:break-all;font-size:13px">${esc(data.totp.secret)}</code></details>
      <p>3. Escribe el código de 6 dígitos que muestra la app:</p>
      <label class="f">Código<input type="text" id="mf-c" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}"></label>
      <div class="err" role="alert"></div><button class="btn pri" type="submit">Activar y entrar</button>`, 'Seguridad'));
    f.onsubmit = async e => {
      e.preventDefault(); err('');
      const code = f.querySelector('#mf-c').value.replace(/\s/g, ''); if (!codigoOk(code)) return err('El código tiene 6 dígitos.');
      ocupado(f, true);
      const { error: e2 } = await sb.auth.mfa.challengeAndVerify({ factorId: data.id, code });
      ocupado(f, false);
      if (e2) return err(texto(e2));
      resolve(data.id);
    };
  });
}

function pantallaCodigo(factorId) {
  return new Promise(resolve => {
    const f = mostrar(tarjeta(`<h1>Código de verificación</h1><p>Abre tu app autenticadora y escribe el código de 6 dígitos de <b>SRA Project Management</b>.</p>
      <label class="f">Código<input type="text" id="cd-c" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}"></label>
      <div class="err" role="alert"></div><button class="btn pri" type="submit">Verificar</button>
      <p class="sub">¿Cambiaste o perdiste el celular? Pide al administrador que restablezca tu doble verificación. · <a href="#" id="cd-s">Salir</a></p>`, 'Seguridad'));
    raiz().querySelector('#cd-s').onclick = async e => { e.preventDefault(); await salir(); };
    f.onsubmit = async e => {
      e.preventDefault(); err('');
      const code = f.querySelector('#cd-c').value.replace(/\s/g, ''); if (!codigoOk(code)) return err('El código tiene 6 dígitos.');
      ocupado(f, true);
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code });
      ocupado(f, false);
      if (error) return err(texto(error));
      resolve();
    };
  });
}

function pantallaAviso(personaId) {
  return new Promise(resolve => {
    const f = mostrar(tarjeta(`<h1>Tratamiento de tus datos</h1>
      <p>Santiago Rubiano Arquitectos usa tu nombre, correo, cargo, horas y jornadas registradas solo para gestionar los proyectos y el trabajo del equipo, según la Ley 1581 de 2012. Los datos se guardan en servidores de Supabase en Estados Unidos, con acceso solo para quien tu rol permite.</p>
      <p><a href="/privacidad.html" target="_blank" rel="noopener">Lee el aviso de privacidad completo</a>. Puedes consultar, corregir o pedir que se eliminen tus datos escribiendo a sr.srarquitectos@gmail.com.</p>
      <label class="ck"><input type="checkbox" id="av-ok"> Autorizo el tratamiento de mis datos personales en los términos del aviso de privacidad.</label>
      <div class="err" role="alert"></div><button class="btn pri" type="submit">Continuar</button>`, 'Primer ingreso'));
    f.onsubmit = async e => {
      e.preventDefault(); err('');
      if (!f.querySelector('#av-ok').checked) return err('Para usar la mesa necesitas aceptar el aviso de privacidad.');
      ocupado(f, true);
      const { error } = await sb.from('autorizaciones').insert({ persona_id: personaId, version: AVISO_VERSION, navegador: navigator.userAgent.slice(0, 200) });
      ocupado(f, false);
      if (error && error.code !== '23505') return err(texto(error));
      resolve();
    };
  });
}

function pantallaSinPerfil(email) {
  mostrar(tarjeta(`<h1>Sin perfil en la mesa</h1><p>Tu cuenta <b>${esc(email)}</b> entró bien, pero no está enlazada a ningún perfil activo del equipo de SRA.</p>
    <p>Pide al administrador que registre este correo en tu perfil.</p><button class="btn pri" type="submit">Salir</button>`, 'Acceso'))
    .onsubmit = async e => { e.preventDefault(); await salir(); };
  return new Promise(() => {});
}

// ---------- Flujo completo ----------
export async function salir(msg) {
  try { if (msg) sessionStorage.setItem('sra_msg', msg); } catch {}
  await sb.auth.signOut({ scope: 'local' }).catch(() => {});
  location.replace(location.pathname);
}

// Doble verificación: interruptor en la base (config seguridad.doble_verificacion)
export const modo = { mfa: true, email: '' };

// Zona de administrador: con doble verificación pide el código; sin ella, la contraseña
export async function reverificar(valor) {
  if (!modo.mfa) {
    if (!valor) return false;
    const { error } = await sb.auth.signInWithPassword({ email: modo.email, password: String(valor) });
    return !error;
  }
  const code = String(valor || '').replace(/\s/g, ''); if (!codigoOk(code)) return false;
  const { data } = await sb.auth.mfa.listFactors();
  const f = (data?.totp || []).find(x => x.status === 'verified'); if (!f) return false;
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: f.id, code });
  return !error;
}

export async function acceder() {
  let msg = ''; try { msg = sessionStorage.getItem('sra_msg') || ''; sessionStorage.removeItem('sra_msg'); } catch {}
  let { data: { session } } = await sb.auth.getSession();
  if (session && (tipoEnlace === 'recovery' || tipoEnlace === 'invite')) await pantallaNuevaContrasena(tipoEnlace === 'invite');
  if (!session) { await pantallaEntrar(msg); ({ data: { session } } = await sb.auth.getSession()); }

  const { data: requiere, error: eReq } = await sb.rpc('requiere_doble_verificacion');
  if (eReq) throw eReq;   // sin respuesta de la base no se sigue (evita pedir pasos que no aplican)
  modo.mfa = requiere !== false;
  modo.email = session.user.email;
  const { data: nivel } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (modo.mfa && nivel?.currentLevel !== 'aal2') {
    const { data: fs } = await sb.auth.mfa.listFactors();
    const ok = (fs?.totp || []).find(x => x.status === 'verified');
    if (ok) await pantallaCodigo(ok.id); else await pantallaActivarApp();
  }
  ({ data: { session } } = await sb.auth.getSession());
  const email = session.user.email;
  const { data: personaId, error } = await sb.rpc('enlazar_mi_cuenta');
  if (error) throw error;
  if (!personaId) await pantallaSinPerfil(email);

  const { data: aut } = await sb.from('autorizaciones').select('version').eq('persona_id', personaId).eq('version', AVISO_VERSION).maybeSingle();
  if (!aut) await pantallaAviso(personaId);
  raiz().hidden = true; raiz().innerHTML = '';
  return { personaId, email, userId: session.user.id };
}
