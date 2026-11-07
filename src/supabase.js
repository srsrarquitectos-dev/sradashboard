import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error('Falta configurar VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY.');

// La sesión vive en la pestaña (sessionStorage) salvo que la persona marque «Mantener la sesión abierta».
const RECORDAR = 'sra_recordar';
const seguro = fn => { try { return fn(); } catch { return null; } };
export const recordar = {
  get: () => seguro(() => localStorage.getItem(RECORDAR) === '1'),
  set: v => seguro(() => (v ? localStorage.setItem(RECORDAR, '1') : localStorage.removeItem(RECORDAR))),
};
const almacen = {
  getItem: k => seguro(() => sessionStorage.getItem(k) ?? localStorage.getItem(k)),
  setItem: (k, v) => seguro(() => {
    if (recordar.get()) { localStorage.setItem(k, v); sessionStorage.removeItem(k); }
    else { sessionStorage.setItem(k, v); localStorage.removeItem(k); }
  }),
  removeItem: k => seguro(() => { sessionStorage.removeItem(k); localStorage.removeItem(k); }),
};

// Tipo de enlace de correo con el que se abrió la página (invitación o recuperación), antes de que Supabase lo lea
export const tipoEnlace = (() => { try { return new URLSearchParams(location.hash.slice(1)).get('type') || ''; } catch { return ''; } })();

export const sb = createClient(url, key, {
  db: { schema: 'sra' },
  auth: { storage: almacen, storageKey: 'sra-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
  realtime: { params: { eventsPerSecond: 5 } },
});
