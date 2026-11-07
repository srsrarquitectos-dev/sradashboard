# SRA Project Management v2

Mesa de trabajo de Santiago Rubiano Arquitectos, conectada a Supabase.

## Cómo está armada

| Parte | Dónde |
| --- | --- |
| Base de datos (esquema, reglas de acceso, funciones, catálogos, tareas programadas) | `db/sql/01` a `07` |
| Mesa v1 original (sin tocar) | `mesa/mesa-v1.html` |
| Generador de la v2 a partir de la v1 (aplica cambios comprobados, uno por uno) | `scripts/build-mesa.mjs` |
| Acceso: correo + contraseña, app autenticadora (TOTP), aviso de privacidad | `src/acceso.js` |
| Capa de datos: la mesa lee y guarda en las tablas `sra.*` con tiempo real | `src/datos.js` |
| Arranque y servicios (descargas, fotos en almacenamiento privado) | `src/main.js` |
| Aviso de privacidad (Ley 1581) | `public/privacidad.html` |
| Publicación (Firebase Hosting, con cabeceras de seguridad) | `firebase.json` |

## Comandos

```bash
npm install
npm run build      # genera la mesa v2 y la deja en dist/
npm run dev        # pruebas locales contra la imitación de Supabase (ver .env.pruebas.example)
```

## Seguridad

- En el navegador solo va la clave **publicable** de Supabase (`.env.production`). La clave secreta (service_role) y la contraseña de la base **nunca** se guardan en este repositorio.
- Toda lectura y escritura pasa por las reglas de la base: sin sesión con doble verificación no se ve nada, y nada se borra.
- Los datos personales del equipo no están en el repositorio: viven solo en Supabase.
