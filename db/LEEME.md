# SRA Project Management v2 · Base de datos

Base de datos PostgreSQL para Supabase con las reglas de acceso dentro de la base: cada persona solo puede leer y cambiar lo que su rol permite, aunque intente saltarse la pantalla. Toda consulta exige sesión con doble verificación (código de 6 dígitos).

Esta entrega es la base de datos. La aplicación v2 (pantallas conectadas a esta base) es el siguiente paso de desarrollo.

## Qué contiene

| Archivo | Qué hace |
| --- | --- |
| `sql/01_esquema.sql` | Tipos y 33 tablas: personas, proyectos, etapas, entregas, tareas, horas, jornadas, reuniones, obra, auditoría |
| `sql/02_funciones.sql` | Roles, festivos de Colombia, días hábiles, fechas efectivas, horas extra, cadena de revisión, plan de obra, cronómetro, vistas |
| `sql/03_seguridad.sql` | Disparadores de protección y auditoría, permisos y 92 reglas de acceso por fila, archivos privados |
| `sql/04_catalogos.sql` | Tipos, subtipos y plantillas de etapas actuales, configuración de jornada y festivos 2025–2035 |
| `sql/05_tareas_programadas.sql` | Programación de los jueves, cierre de cronómetros olvidados y festivos de cada año |
| `migracion/importar_mesa_v1.js` | Convierte el respaldo de la mesa actual en SQL para cargarlo en la v2 |
| `migracion/datos_actuales_2026-11-06.sql` | Los datos de la mesa al 6 de noviembre de 2026, ya convertidos (sin contraseñas) |
| `prueba/` | Simulación mínima de Supabase y las 21 pruebas de reglas de acceso |

## Instalación en Supabase

1. **Crear el proyecto** en Supabase (plan Pro), en la región más cercana disponible.
2. **Autenticación** (Authentication › Sign In / Providers):
   - Activar correo electrónico y **desactivar el registro público** (solo entra quien el administrador invite).
   - En Multi-Factor Authentication, activar **TOTP** (app autenticadora).
3. **SQL Editor**: ejecutar en orden `01_esquema.sql`, `02_funciones.sql`, `03_seguridad.sql` y `04_catalogos.sql`.
4. **Database › Extensions**: activar `pg_cron`, y ejecutar `05_tareas_programadas.sql`.
5. **Settings › API › Exposed schemas**: agregar `sra`.
6. **Cargar los datos actuales**: ejecutar `migracion/datos_actuales_2026-11-06.sql` (o generar uno nuevo, ver abajo).
7. **Correos y acceso**: escribir el correo de cada persona en `sra.personas.email`; invitarla desde Authentication › Users › Invite. En su primer ingreso la app llama `sra.enlazar_mi_cuenta()` y le pide activar la doble verificación.

## Migrar datos más recientes

1. En la mesa actual: **Administrador › Descargar respaldo** (archivo JSON, no incluye contraseñas).
2. Convertirlo: `node migracion/importar_mesa_v1.js "Respaldo SRA Project Management AAAA-MM-DD.json" datos.sql`
3. Ejecutar `datos.sql` en el SQL Editor. Correrlo dos veces no duplica nada.

El script avisa lo que necesita revisión manual: fotos de obra (se descargan de la mesa y se suben al bucket privado `obra`), tipos que no estén en el catálogo y fechas inválidas.

## Quién puede hacer qué

| Acción | Administrador | CEO | Director del panel | Encargado o coencargado | Residente | Equipo |
| --- | --- | --- | --- | --- | --- | --- |
| Ver proyectos del panel | Todos | Todos | Su panel | Sus paneles | Sus paneles | Sus paneles |
| Crear proyectos y personas | Sí | No | No | No | No | No |
| Editar datos y etapas del proyecto | Sí | No | No | Sí | No | No |
| Pasar entrega a revisión | Sí | No | No | Sí | Sí (obras) | No |
| Aprobar como director | Sí | No | Sí | No | No | No |
| Dar el GO al cliente | Sí | Sí | No | No | No | No |
| Aprobar plan de obra | Sí | Sí | No | No | No | No |
| Ver valores del presupuesto | Sí | Sí | No | Sí | Sí | No |
| Ver horas y jornadas | Todas | Todas | Las propias | Las propias | Las propias | Las propias |
| Corregir o anular horas | Sí, con motivo | No | No | No | No | No |
| Leer la auditoría | Sí | Sí | No | No | No | No |
| Borrar registros | Nadie | Nadie | Nadie | Nadie | Nadie | Nadie |

Mientras no haya director o CEO asignado, el administrador hace esa revisión.

## Funciones para la aplicación

- `sra.mover_entrega(entrega, estado, nota, link)`: cadena encargado → director → CEO (GO) → cliente; obras: residente → CEO. Comentario obligatorio al devolver.
- `sra.mover_plan(proyecto, estado, nota)`: borrador → enviado → aprobado o devuelto; el CEO puede reabrir.
- `sra.registrar_avance(proyecto)`: guarda el avance ponderado del día para la curva S.
- `sra.detener_cronometro()`: reparte el tiempo por día en registros de horas.
- `sra.enlazar_mi_cuenta()`: enlaza el usuario de Supabase con su persona por correo.
- Vistas: `sra.v_proyectos` (fin efectivo, etapa actual, avance), `sra.v_entregas` (fecha efectiva con festivos y cambios de alcance), `sra.v_tareas`, `sra.v_jornadas` (horas ordinarias y extra).

## Pruebas

Probado en PostgreSQL 16. Con la simulación de `prueba/00_simular_supabase.sql`, las 21 pruebas de `prueba/pruebas_reglas.sql` dan el resultado esperado. Entre ellas:

- Sin doble verificación no se ve nada.
- Un integrante no puede crear proyectos, ver horas ajenas ni darse el rol de administrador.
- La cadena de revisión respeta cada rol.
- Nada se borra.
- No hay bitácora sin plan de obra aprobado.
- Los festivos de 2026 coinciden con los 18 oficiales.
- Las horas extra se calculan después de las 5:40 p. m. y el cronómetro se parte por día.

## Pendiente de decisión

- Si el tiempo antes de las 8:20 a. m. cuenta como hora extra (hoy cuenta como ordinario, igual que en la mesa).
- Si las horas en festivo o fin de semana se marcan aparte.
- Plazos de conservación de horas y jornadas (abogado y contador).
