-- =====================================================================
-- SRA Project Management v2 · 08 · Doble verificación opcional (interruptor)
-- Decisión de SRA (8 nov 2026): apagar la doble verificación por ahora.
-- Se controla con config 'seguridad' → "doble_verificacion": true | false.
-- Para volver a exigirla: update sra.config set valor = valor || '{"doble_verificacion": true}' where clave = 'seguridad';
-- =====================================================================

-- Verdadero si la sesión pasó la doble verificación, o si SRA la tiene apagada (siempre exige sesión iniciada)
create or replace function sra.mfa_ok() returns boolean
language sql stable security definer set search_path = sra, public as $$
  select auth.uid() is not null and (
    coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    or not coalesce((select (valor ->> 'doble_verificacion')::boolean from sra.config where clave = 'seguridad'), true))
$$;
comment on function sra.mfa_ok() is 'Sesión iniciada y, si config seguridad.doble_verificacion está encendida, con doble verificación (AAL2).';

-- La app pregunta si debe pedir el código (antes de tener acceso a los datos)
create or replace function sra.requiere_doble_verificacion() returns boolean
language sql stable security definer set search_path = sra, public as $$
  select coalesce((select (valor ->> 'doble_verificacion')::boolean from sra.config where clave = 'seguridad'), true)
$$;
revoke all on function sra.requiere_doble_verificacion() from public, anon;
grant execute on function sra.requiere_doble_verificacion() to authenticated, service_role;

update sra.config set valor = valor || '{"doble_verificacion": false}'::jsonb, actualizado_en = now() where clave = 'seguridad';
