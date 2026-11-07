import { defineConfig } from 'vite';

// En modo «pruebas» la app habla con la imitación de Supabase del entorno de pruebas
// (PostgREST en :3000 y acceso simulado en :9999). En producción usa el proyecto real.
export default defineConfig(({ mode }) => ({
  server: mode === 'pruebas' ? {
    port: 5173,
    proxy: {
      '/auth/v1': { target: 'http://localhost:9999' },
      '/rest/v1': { target: 'http://localhost:3000', rewrite: p => p.replace(/^\/rest\/v1/, '') },
    },
  } : undefined,
  build: { target: 'es2020', sourcemap: false },
}));
