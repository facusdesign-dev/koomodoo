-- =====================================================================
-- KOOMODOO · Auditoría de permisos de la base (SOLO LECTURA)
-- =====================================================================
-- Qué hace: revisa quién puede leer o escribir cada tabla, vista y
-- función, y devuelve UNA tabla de hallazgos ordenada por gravedad.
--
-- Es segura: solo hace SELECT sobre el catálogo del sistema (pg_class,
-- pg_policies, pg_proc, storage.buckets...). No lee filas de tus tablas
-- (no ve emails, teléfonos ni mensajes), no crea ni modifica nada.
--
-- Cómo usarla:
--   1. Supabase → tu proyecto → SQL Editor → New query.
--   2. Pegá TODO este archivo y apretá Run.
--   3. Copiá el resultado completo (hay un botón para copiar o exportar
--      CSV) y pegalo en el chat. Solo contiene nombres y reglas.
--
-- Cómo leer la columna "gravedad":
--   ALTA     cualquiera (o cualquier usuario logueado) puede leer o
--            escribir algo que no debería. Arreglar primero.
--   MEDIA    acceso amplio que conviene limitar.
--   REVISAR  puede estar bien o mal según la regla: hay que mirarlo.
--   INFO     informativo, sin problema aparente.
--
-- Complemento recomendado: Supabase → Advisors → Security Advisor.
-- =====================================================================

with
-- Tablas que el frontend usa y que guardan datos de personas o dinero.
sensibles as (
  select unnest(array[
    'profiles','orders','order_items','messages','products',
    'product_variants','notifications','followers','services','posts'
  ]) as tabla
),

-- Todas las tablas de public con sus permisos y estado de RLS.
tablas as (
  select
    c.oid,
    c.relname,
    c.relrowsecurity,
    (c.relname in (select tabla from sensibles)) as sensible,
    has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
    has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE') as anon_escribe,
    has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select,
    has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE') as auth_escribe,
    (select count(*) from pg_policies p
      where p.schemaname = 'public' and p.tablename = c.relname) as n_politicas
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
),

-- Políticas de acceso de public y de storage, marcando las "abiertas":
-- condición literal "true" o solo "estar logueado".
politicas as (
  select
    p.schemaname,
    p.tablename,
    p.policyname,
    p.cmd,
    array_to_string(p.roles, ',') as roles,
    p.qual,
    p.with_check,
    (
      coalesce(p.qual, '') = 'true'
      or coalesce(p.with_check, '') = 'true'
      or coalesce(p.qual, '') ~* '^\(*(\(select auth\.uid\(\) as uid\)|auth\.uid\(\)) is not null\)*$'
    ) as abierta,
    -- abierta también para visitantes sin sesión (condición literal true)
    (coalesce(p.qual, '') = 'true' or coalesce(p.with_check, '') = 'true') as abierta_total
  from pg_policies p
  where p.schemaname in ('public', 'storage')
),

-- Esquemas que la API de Supabase expone al público.
api as (
  select coalesce(
    (select regexp_replace(cfg, '^pgrst\.db_schemas=', '')
       from pg_roles r
       cross join lateral unnest(r.rolconfig) as cfg
      where r.rolname = 'authenticator'
        and starts_with(cfg, 'pgrst.db_schemas=')
      limit 1),
    'no se pudo leer (revisá Settings → API)'
  ) as esquemas
),

hallazgos as (

  -- A. Estado de cada tabla ------------------------------------------
  select
    'A. Tablas'::text as seccion,
    (case
       when not t.relrowsecurity and (t.anon_select or t.anon_escribe) then 'ALTA'
       when not t.relrowsecurity and (t.auth_select or t.auth_escribe) then 'MEDIA'
       when t.relrowsecurity and t.n_politicas = 0 then 'REVISAR'
       else 'INFO'
     end)::text as gravedad,
    t.relname::text as objeto,
    ((case
        when not t.relrowsecurity then 'RLS DESACTIVADO: solo los permisos de la tabla protegen los datos'
        when t.n_politicas = 0 then 'RLS activado pero sin políticas: nadie accede por la API'
        else 'RLS activado'
      end) || (case when t.sensible then ' · TABLA SENSIBLE' else '' end))::text as hallazgo,
    ('permisos de tabla (antes de RLS) · visitantes (anon): '
       || coalesce(nullif(concat_ws(' y ',
            case when t.anon_select then 'leen' end,
            case when t.anon_escribe then 'escriben' end), ''), 'sin acceso')
       || ' | usuarios logueados: '
       || coalesce(nullif(concat_ws(' y ',
            case when t.auth_select then 'leen' end,
            case when t.auth_escribe then 'escriben' end), ''), 'sin acceso')
       || ' | políticas: ' || t.n_politicas)::text as detalle
  from tablas t

  union all

  -- B. Políticas de public: abiertas, y todas las de tablas sensibles --
  select
    'B. Políticas'::text,
    (case
       when p.abierta and p.cmd <> 'SELECT' then 'ALTA'
       when p.abierta then 'MEDIA'
       else 'REVISAR'
     end)::text,
    (p.tablename || ' · ' || p.policyname)::text,
    (case
       when p.abierta and p.cmd <> 'SELECT'
         then 'Política abierta de ESCRITURA (' || p.cmd || '): no filtra por dueño'
       when p.abierta then 'Política abierta de lectura: la ve cualquiera que cumpla el rol'
       else 'Política de tabla sensible: confirmar que filtra por dueño'
     end)::text,
    ('roles: ' || p.roles
       || ' | USING: ' || coalesce(p.qual, '—')
       || ' | WITH CHECK: ' || coalesce(p.with_check, '—'))::text
  from politicas p
  where p.schemaname = 'public'
    and (p.abierta or p.tablename in (select tabla from sensibles))

  union all

  -- C. Columnas con datos personales que alguien puede leer ----------
  select
    'C. Datos personales'::text,
    (case
       when x.anon_lee and (x.sin_rls or x.lectura_abierta_anon) then 'ALTA'
       when x.auth_lee and (x.sin_rls or x.lectura_abierta_auth) then 'MEDIA'
       else 'REVISAR'
     end)::text,
    (x.relname || '.' || x.columna)::text,
    ('Columna sensible con permiso de lectura para '
       || concat_ws(' y ',
            case when x.anon_lee then 'visitantes (anon)' end,
            case when x.auth_lee then 'usuarios logueados' end))::text,
    (case
       when x.es_vista and x.sin_rls then 'Es una vista con permisos del dueño: ignora RLS, se ve de verdad'
       when x.es_vista then 'Es una vista que respeta RLS (security_invoker)'
       when x.sin_rls then 'RLS DESACTIVADO en la tabla: se ve de verdad'
       when x.lectura_abierta_anon then 'Una política abierta de lectura la deja ver a cualquiera, sin sesión'
       when x.lectura_abierta_auth then 'Una política abierta de lectura la deja ver a cualquier usuario logueado'
       else 'RLS activado: depende de las políticas de la tabla'
     end)::text
  from (
    select
      c.relname,
      a.attname as columna,
      (c.relkind in ('v', 'm')) as es_vista,
      (case
         when c.relkind in ('v', 'm')
           then not (coalesce(c.reloptions::text, '') ~* 'security_invoker=(true|on)')
         else not c.relrowsecurity
       end) as sin_rls,
      has_column_privilege('anon', c.oid, a.attnum, 'SELECT') as anon_lee,
      has_column_privilege('authenticated', c.oid, a.attnum, 'SELECT') as auth_lee,
      exists (
        select 1 from politicas p
         where p.schemaname = 'public' and p.tablename = c.relname
           and p.abierta_total and p.cmd in ('SELECT', 'ALL')
           and p.roles ~ '(public|anon)'
      ) as lectura_abierta_anon,
      exists (
        select 1 from politicas p
         where p.schemaname = 'public' and p.tablename = c.relname
           and p.abierta and p.cmd in ('SELECT', 'ALL')
           and p.roles ~ '(public|authenticated)'
      ) as lectura_abierta_auth
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm')
      and a.attnum > 0
      and not a.attisdropped
      and a.attname ~* '(^|_)(email|mail|correo|phone|telefono|celular|whatsapp|address|direccion|dni|cedula|documento|nacimiento|birth|token|secret|password|api_key)($|_)'
  ) x
  where x.anon_lee or x.auth_lee

  union all

  -- D. Vistas ----------------------------------------------------------
  select
    'D. Vistas'::text,
    (case
       when v.invoker then 'INFO'
       when v.anon_select or v.auth_select then 'REVISAR'
       else 'INFO'
     end)::text,
    v.relname::text,
    (case
       when v.invoker then 'Vista que respeta RLS (security_invoker)'
       else 'Vista con permisos del dueño: ignora el RLS de las tablas base'
     end)::text,
    ('visitantes (anon) leen: ' || case when v.anon_select then 'SÍ' else 'no' end
       || ' | logueados leen: ' || case when v.auth_select then 'SÍ' else 'no' end
       || ' | columnas: ' || coalesce(v.columnas, ''))::text
  from (
    select
      c.relname,
      (coalesce(c.reloptions::text, '') ~* 'security_invoker=(true|on)') as invoker,
      has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
      has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select,
      (select string_agg(a.attname, ', ' order by a.attnum)
         from pg_attribute a
        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as columnas
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm')
  ) v

  union all

  -- E. Funciones que corren con permisos elevados (SECURITY DEFINER) --
  select
    'E. Funciones (RPC)'::text,
    (case
       when f.anon_exec and not f.search_path_fijo then 'ALTA'
       when f.anon_exec then 'REVISAR'
       when not f.search_path_fijo then 'MEDIA'
       else 'INFO'
     end)::text,
    f.firma::text,
    ('SECURITY DEFINER ejecutable por '
       || coalesce(nullif(concat_ws(' y ',
            case when f.anon_exec then 'visitantes (anon)' end,
            case when f.auth_exec then 'usuarios logueados' end), ''), 'nadie por la API')
       || case when f.search_path_fijo then '' else ' · SIN search_path fijo' end)::text,
    ('devuelve: ' || f.devuelve
       || ' | debe validar auth.uid() adentro (revisar el código de la función)')::text
  from (
    select
      p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as firma,
      pg_get_function_result(p.oid) as devuelve,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
      (coalesce(p.proconfig::text, '') ilike '%search_path%') as search_path_fijo
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosecdef
      and p.prorettype <> 'trigger'::regtype
      and not exists (
        select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
      )
  ) f

  union all

  -- F. Buckets de almacenamiento ---------------------------------------
  select
    'F. Archivos (buckets)'::text,
    (case when b.public then 'REVISAR' else 'INFO' end)::text,
    b.id::text,
    (case
       when b.public then 'Bucket PÚBLICO: cualquiera con el enlace ve los archivos'
       else 'Bucket privado'
     end)::text,
    ('límite por archivo: ' || coalesce(b.file_size_limit::text, 'sin límite')
       || ' | tipos permitidos: '
       || coalesce(array_to_string(b.allowed_mime_types, ','), 'cualquiera'))::text
  from storage.buckets b

  union all

  -- G. Políticas sobre los archivos (storage.objects) -------------------
  select
    'G. Políticas de archivos'::text,
    (case
       when p.abierta and p.cmd <> 'SELECT' then 'ALTA'
       when p.abierta then 'INFO'
       else 'REVISAR'
     end)::text,
    (p.tablename || ' · ' || p.policyname)::text,
    (case
       when p.abierta and p.cmd <> 'SELECT'
         then 'Política abierta de ESCRITURA (' || p.cmd || '): cualquiera puede subir o borrar'
       when p.abierta then 'Lectura abierta (normal en buckets públicos)'
       else 'Política de archivos: confirmar que filtra por carpeta o dueño'
     end)::text,
    ('roles: ' || p.roles
       || ' | USING: ' || coalesce(p.qual, '—')
       || ' | WITH CHECK: ' || coalesce(p.with_check, '—'))::text
  from politicas p
  where p.schemaname = 'storage' and p.tablename = 'objects'

  union all

  -- H. Esquemas que expone la API ---------------------------------------
  select
    'H. API de Supabase'::text,
    (case when api.esquemas ~* '(^|,)\s*private\s*(,|$)' then 'ALTA' else 'INFO' end)::text,
    'Esquemas expuestos'::text,
    api.esquemas::text,
    'Si aparece private u otro esquema interno, sus funciones quedan alcanzables por la API'::text
  from api

  union all

  -- I. Tablas que emiten cambios en tiempo real -------------------------
  select
    'I. Tiempo real (Realtime)'::text,
    (case when not c.relrowsecurity then 'ALTA' else 'INFO' end)::text,
    (pt.schemaname || '.' || pt.tablename)::text,
    'Publicada en supabase_realtime'::text,
    ('RLS: ' || case when c.relrowsecurity then 'activado'
                     else 'DESACTIVADO: los cambios pueden llegar a cualquiera' end)::text
  from pg_publication_tables pt
  join pg_namespace n on n.nspname = pt.schemaname
  join pg_class c on c.relnamespace = n.oid and c.relname = pt.tablename
  where pt.pubname = 'supabase_realtime'

  union all

  -- J. Tablas esperadas que no existen en la base -----------------------
  select
    'J. Tablas faltantes'::text,
    'REVISAR'::text,
    s.tabla::text,
    'El frontend la usa pero no existe en el esquema public'::text,
    'Puede tener otro nombre o estar en otro proyecto de Supabase'::text
  from sensibles s
  where not exists (select 1 from tablas t where t.relname = s.tabla)
)

select seccion, gravedad, objeto, hallazgo, detalle
from hallazgos
order by
  case gravedad when 'ALTA' then 0 when 'MEDIA' then 1 when 'REVISAR' then 2 else 3 end,
  seccion,
  objeto;
