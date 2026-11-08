// Genera la v2 a partir de la mesa v1 (mesa/mesa-v1.html), sin tocar el original.
// Separa estilos, estructura y código, y aplica los cambios necesarios para Supabase.
// Cada cambio debe encontrar su texto exactamente una vez; si no, el proceso se detiene.
import fs from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = fs.readFileSync(path.join(raiz, 'mesa/mesa-v1.html'), 'utf8');

const entre = (a, b) => {
  const i = src.indexOf(a); const j = src.indexOf(b, i + a.length);
  if (i < 0 || j < 0) throw new Error(`No se encontró el bloque ${a} … ${b}`);
  return src.slice(i + a.length, j);
};
const css = entre('<style>', '</style>');
const marcado = entre('</style>', '<script>').trim();
let js = entre('<script>', '</script>');

const cambios = [
  // 1. Sesión: la da Supabase (correo + contraseña + código). El panel de administrador no pide otra contraseña.
  ['function loadSession(){ ',
   'function loadSession(){ if (window.SRA_SESION) { S.me = window.SRA_SESION.personaId; S.sess = { miembroId:S.me, usuario:window.SRA_SESION.email, exp: Date.now() + SESS_H*3600e3 }; return; } '],
  // 2. Salir: cierra la sesión de Supabase
  ['function logout(msg){ ', 'function logout(msg){ if (window.SRA_SALIR) { window.SRA_SALIR(msg); return; } '],
  // 3. Fotos: los archivos viven en el almacenamiento privado; la dirección se firma por unos minutos
  ['<img src="/_blob/${esc(id)}" alt="Foto de obra del ${fmtD(b.fecha)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),{className:\'sub\',textContent:\'Foto no disponible\'}))">',
   '<img src="${esc(sraBlob(id))}" alt="Foto de obra del ${fmtD(b.fecha)}" loading="lazy" data-fallback="1">'],
  // 4. Zona de administrador: se confirma con el código de la app autenticadora
  ['<p>Confirma tu contraseña para entrar. El panel queda abierto ${ADMIN_MIN} minutos.</p>',
   '<p>${window.SRA_REV?.mfa ? "Confirma con el código de 6 dígitos de tu app autenticadora." : "Confirma tu contraseña para entrar."} El panel queda abierto ${ADMIN_MIN} minutos.</p>'],
  ['<label class="f">Contraseña<input type="password" id="un-p" autocomplete="current-password"></label>',
   '${window.SRA_REV?.mfa ? `<label class="f">Código de 6 dígitos<input type="text" id="un-p" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}"></label>` : `<label class="f">Contraseña<input type="password" id="un-p" autocomplete="current-password"></label>`}'],
  ['const u = normUser($("#un-u").value), cred = await getCred(u);\n      if (cred && cred.miembroId === S.me && await checkPass(cred, $("#un-p").value)) {',
   'if (await window.SRA_REVERIFICAR($("#un-p").value)) {'],
  // 5. Fotos: se indica dónde se guardan (perfil de la persona o carpeta privada del proyecto)
  ['const r = await S.assets.upload(blob, { type:"image/jpeg" });', 'const r = await S.assets.upload(blob, { type:"image/jpeg", perfil:mid });'],
  ['const r = await S.assets.upload(await shrinkImage(files[i]), { type:"image/jpeg" }); fotos.push(r.id);',
   'const r = await S.assets.upload(await shrinkImage(files[i]), { type:"image/jpeg", proyecto:p.id }); fotos.push(r.id);'],
  ['const r = await S.assets.upload(await shrinkImage(files[i]), { type:"image/jpeg" }); ids.push(r.id);',
   'const r = await S.assets.upload(await shrinkImage(files[i]), { type:"image/jpeg", proyecto:S.pid }); ids.push(r.id);'],
  // 6. Perfiles y zona de administrador: acceso por correo (invitación de Supabase), sin contraseñas en la mesa
  ["    <div class=\"box\"><h4>Acceso</h4>\n      ${d.usuario ? `<label class=\"f\">Usuario<input type=\"text\" value=\"${esc(d.usuario)}\" readonly></label><label class=\"f\">Nueva contraseña <span class=\"sub\" style=\"font-weight:400\">(déjala vacía para no cambiarla)</span><input type=\"password\" id=\"m-p\" autocomplete=\"new-password\"></label>`\n        : `<label class=\"f\">Usuario<input type=\"text\" id=\"m-u\" placeholder=\"ej. aperez\" autocapitalize=\"none\" spellcheck=\"false\" autocomplete=\"off\"></label><label class=\"f\">Contraseña ${isNew ? \"inicial\" : \"\"}<input type=\"password\" id=\"m-p\" autocomplete=\"new-password\"></label>`}\n      <label class=\"f\">Repite la contraseña<input type=\"password\" id=\"m-p2\" autocomplete=\"new-password\"></label>\n      <p class=\"sub\" style=\"margin:0\">Mínimo 8 caracteres, con letras y números. Entrégale el usuario y la contraseña a la persona en privado; solo un administrador puede restablecerla.</p></div>",
   "    <div class=\"box\"><h4>Acceso</h4><label class=\"f\">Correo<input type=\"email\" id=\"m-mail\" value=\"${esc(d.email || \"\")}\" autocapitalize=\"none\" spellcheck=\"false\" autocomplete=\"off\"></label><p class=\"sub\" style=\"margin:0\">Con este correo la persona entra a la mesa. Después de guardar, el administrador la invita desde Supabase (Autenticación › Usuarios › Invitar usuario). En su primer ingreso crea su contraseña y activa la doble verificación.</p></div>"],
  ["    const u = d.usuario || normUser($(\"#m-u\")?.value), pw = $(\"#m-p\").value, pw2 = $(\"#m-p2\").value;\n    const wantsCred = !d.usuario ? (isNew || !!(u || pw)) : !!pw;\n    if (wantsCred) {\n      if (!d.usuario && !validUser(u)) { toast(\"El usuario debe tener de 3 a 40 caracteres: minúsculas, números, punto, guion o guion bajo.\"); return; }\n      const pi = passIssue(pw); if (pi) { toast(pi); return; }\n      if (pw !== pw2) { toast(\"Las contraseñas no coinciden.\"); return; }\n      if (!d.usuario) { try { if (await getCred(u)) { toast(\"Ese usuario ya existe. Elige otro.\"); return; } } catch(e){ fail(e); return; } }\n    }",
   "    const email = ($(\"#m-mail\").value || \"\").trim().toLowerCase();\n    if (email && !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) { toast(\"Escribe un correo válido.\"); return; }\n    if (email && S.miembros.some(x => x.id !== m?.id && (x.email || \"\").toLowerCase() === email)) { toast(\"Ese correo ya está en otro perfil.\"); return; }\n    const wantsCred = false, u = d.usuario || \"\";"],
  ["&& x.rol === \"admin\" && !x.inactivo && x.usuario)",
   "&& x.rol === \"admin\" && !x.inactivo && (x.email || x.usuario))"],
  ["db.collection(\"miembros\").add({ ...body, usuario:u, creadoEn:nowISO() })",
   "db.collection(\"miembros\").add({ ...body, email, creadoEn:nowISO() })"],
  ["db.collection(\"miembros\").doc(m.id).update(wantsCred && !d.usuario ? { ...body, usuario:u } : body)",
   "db.collection(\"miembros\").doc(m.id).update({ ...body, email })"],
  ["toast(isNew ? `Perfil de ${nombre} creado con usuario @${u}.` : wantsCred ? (d.usuario ? \"Contraseña restablecida.\" : `Acceso creado: @${u}.`) : \"Perfil guardado.\")",
   "toast(isNew ? `Perfil de ${nombre} creado. Ahora invítalo desde Supabase con ${email || \"su correo\"}.` : \"Perfil guardado.\")"],
  ["err.textContent = \"Contraseña incorrecta.\"; $(\"#un-p\").value = \"\";",
   "err.textContent = window.SRA_REV?.mfa ? \"Código incorrecto o vencido.\" : \"Contraseña incorrecta.\"; $(\"#un-p\").value = \"\";"],
];
for (const [a, b] of cambios) {
  const n = js.split(a).length - 1;
  if (n !== 1) throw new Error(`El cambio debe aplicar una vez y aplicó ${n}: ${a.slice(0, 80)}`);
  js = js.replace(a, () => b);
}
// Las demás fotos (/_blob/…), en todas sus apariciones
js = js.split("url('/_blob/${esc(f)}')").join("url('${esc(sraBlob(f))}')");
const nBlob = js.split('/_blob/${esc(id)}').length - 1;
js = js.split('src="/_blob/${esc(id)}"').join('src="${esc(sraBlob(id))}"').split("'/_blob/${esc(id)}'").join("'${esc(sraBlob(id))}'");
if (js.includes('/_blob/')) throw new Error('Quedaron direcciones /_blob/ sin convertir: ' + js.slice(js.indexOf('/_blob/') - 80, js.indexOf('/_blob/') + 40));

const gen = path.join(raiz, 'src/generado');
fs.mkdirSync(gen, { recursive: true });
fs.writeFileSync(path.join(gen, 'mesa.css'), css.trim() + '\n');
fs.writeFileSync(path.join(gen, 'mesa.js'), '// GENERADO por scripts/build-mesa.mjs a partir de mesa/mesa-v1.html. No editar a mano.\n' + js.trim() + '\n');
const plantilla = fs.readFileSync(path.join(raiz, 'src/index.plantilla.html'), 'utf8');
if (!plantilla.includes('<!--MESA-->')) throw new Error('La plantilla no tiene <!--MESA-->');
fs.writeFileSync(path.join(raiz, 'index.html'), plantilla.replace('<!--MESA-->', () => marcado));
console.log(`Mesa generada: ${cambios.length + nBlob} cambios aplicados.`);
