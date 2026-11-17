alter table public.stories add column duration_seconds smallint not null default 15 check (duration_seconds between 15 and 30);
grant insert(duration_seconds) on public.stories to authenticated;
create table public.story_likes (
  story_id uuid not null references public.stories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(story_id,user_id)
);
create index story_likes_user_idx on public.story_likes(user_id);
create table public.story_comments (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null check(length(btrim(text)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index story_comments_story_idx on public.story_comments(story_id,created_at desc);
create index story_comments_user_idx on public.story_comments(user_id);
alter table public.story_likes enable row level security;
alter table public.story_comments enable row level security;
revoke all on public.story_likes,public.story_comments from anon,authenticated;
grant select on public.story_likes,public.story_comments to anon,authenticated;
grant insert(story_id,user_id) on public.story_likes to authenticated;
grant insert(story_id,user_id,text) on public.story_comments to authenticated;
grant delete on public.story_likes,public.story_comments to authenticated;
create policy story_likes_active_read on public.story_likes for select to anon,authenticated using(exists(select 1 from public.stories s where s.id=story_id and s.expires_at>now()));
create policy story_comments_active_read on public.story_comments for select to anon,authenticated using(exists(select 1 from public.stories s where s.id=story_id and s.expires_at>now()));
create policy story_likes_own_insert on public.story_likes for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.stories s where s.id=story_id and s.expires_at>now()));
create policy story_comments_own_insert on public.story_comments for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.stories s where s.id=story_id and s.expires_at>now()));
create policy story_likes_own_delete on public.story_likes for delete to authenticated using(user_id=(select auth.uid()));
create policy story_comments_own_delete on public.story_comments for delete to authenticated using(user_id=(select auth.uid()));
alter publication supabase_realtime add table public.story_likes,public.story_comments;
create index stories_media_path_idx on public.stories(media_url);

alter table public.products add column revision bigint not null default 0;
create function private.bump_product_revision() returns trigger language plpgsql security invoker set search_path='' as $$
begin new.revision:=old.revision+1; return new; end $$;
revoke all on function private.bump_product_revision() from public,anon,authenticated,service_role;
create trigger product_content_revision before update of title,description,image_url,currency,category,condition,media_urls,variants,status on public.products for each row execute function private.bump_product_revision();

-- Atomic full-publication edit. Never rewrite order snapshots or reserved units.
create function private.edit_publication(p_id uuid,p_revision bigint,p_content jsonb,p_inventory jsonb,p_removed jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.products; v public.product_variants; line jsonb; amount numeric; units numeric; label_text text; vid uuid;
begin
  if auth.uid() is null then raise exception 'Inicia sesion para editar.'; end if;
  select * into p from public.products where id=p_id for update;
  if not found or p.user_id<>auth.uid() then raise exception 'Solo el propietario puede editar esta publicacion.'; end if;
  if p.revision is distinct from p_revision then raise exception 'La publicacion cambio. Cierra y vuelve a abrir el editor.'; end if;
  if length(btrim(coalesce(p_content->>'title',''))) not between 3 and 120 or length(coalesce(p_content->>'description',''))>4000 then raise exception 'Revisa titulo y descripcion.'; end if;
  if coalesce(p_content->>'currency','') not in ('UYU','ARS','USD','BRL','CLP','EUR') or length(coalesce(p_content->>'category','')) not between 1 and 80 or coalesce(p_content->>'condition','') not in ('Nuevo','Usado','Reacondicionado') then raise exception 'Revisa categoria, moneda y condicion.'; end if;
  if jsonb_typeof(p_content->'media_urls') is distinct from 'array' or jsonb_array_length(p_content->'media_urls') not between 1 and 8 then raise exception 'Carga entre 1 y 8 fotos.'; end if;
  if exists(select 1 from jsonb_array_elements_text(p_content->'media_urls') u where u !~ '^https://') then raise exception 'Guarda las fotos antes de editar.'; end if;
  if jsonb_typeof(p_content->'variants') is distinct from 'object' or octet_length((p_content->'variants')::text)>30000 then raise exception 'Detalles del producto invalidos.'; end if;
  if jsonb_typeof(p_inventory) is distinct from 'array' or jsonb_array_length(p_inventory) not between 1 and 100 or jsonb_typeof(p_removed) is distinct from 'array' then raise exception 'Revisa las variantes.'; end if;
  if (select count(distinct btrim(value->>'label')) from jsonb_array_elements(p_inventory))<>jsonb_array_length(p_inventory) then raise exception 'Las variantes deben tener nombres diferentes.'; end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_inventory) where nullif(value->>'id','') is not null)<>(select count(*) from jsonb_array_elements(p_inventory) where nullif(value->>'id','') is not null) then raise exception 'Variantes duplicadas.'; end if;
  perform id from public.product_variants where product_id=p.id order by id for update;
  -- Every existing variant must be accounted for, with its original revision.
  for v in select * from public.product_variants where product_id=p.id order by id loop
    select value into line from jsonb_array_elements(p_inventory||p_removed) where value->>'id'=v.id::text;
    if line is null or (line->>'revision')::bigint is distinct from v.revision then raise exception 'El inventario cambio. Reabre el editor para no sobrescribir ventas o reservas.'; end if;
  end loop;
  for line in select value from jsonb_array_elements(p_removed) loop
    select * into v from public.product_variants where id=(line->>'id')::uuid and product_id=p.id;
    if not found then raise exception 'Variante eliminada invalida.'; end if;
    if v.reserved_stock>0 or exists(select 1 from public.order_items i where i.variant_id=v.id) then raise exception 'Una variante con pedidos no se elimina. Conserva su registro y usa stock 0 si ya no se vende.'; end if;
    delete from public.product_variants where id=v.id;
  end loop;
  for line in select value from jsonb_array_elements(p_inventory) loop
    if nullif(line->>'id','') is not null then
      select * into v from public.product_variants where id=(line->>'id')::uuid and product_id=p.id;
      if not found then raise exception 'Variante ajena o eliminada.'; end if;
      update public.product_variants set label='__kmd_edit_'||id::text where id=v.id;
    end if;
  end loop;
  for line in select value from jsonb_array_elements(p_inventory) loop
    label_text:=btrim(coalesce(line->>'label','')); amount:=(line->>'price')::numeric; units:=(line->>'stock')::numeric;
    if length(label_text) not between 1 and 180 or left(label_text,11)='__kmd_edit_' or amount is null or amount not between 0.01 and 999999999999.99 or amount<>round(amount,2) or units is null or units not between 0 and 2147483647 or units<>trunc(units) or jsonb_typeof(coalesce(line->'attributes','{}'))<>'object' then raise exception 'Revisa nombre, precio, stock y atributos de cada variante.'; end if;
    if nullif(line->>'id','') is null then
      insert into public.product_variants(product_id,label,sku,attributes,price,stock) values(p.id,label_text,left(coalesce(line->>'sku',''),80),coalesce(line->'attributes','{}'),amount,units::integer);
    else
      update public.product_variants set label=label_text,sku=left(coalesce(line->>'sku',''),80),attributes=coalesce(line->'attributes','{}'),price=amount,stock=units::integer where id=(line->>'id')::uuid and product_id=p.id;
    end if;
  end loop;
  update public.products set title=btrim(p_content->>'title'),description=p_content->>'description',category=p_content->>'category',currency=p_content->>'currency',condition=p_content->>'condition',media_urls=p_content->'media_urls',image_url=p_content->'media_urls'->>0,variants=p_content->'variants',price=(select min(price) from public.product_variants where product_id=p.id),stock=stock where id=p.id;
  return (select jsonb_build_object('product',to_jsonb(p0),'variants',(select jsonb_agg(to_jsonb(v0) order by label) from public.product_variants v0 where product_id=p.id)) from public.products p0 where id=p.id);
end $$;
revoke all on function private.edit_publication(uuid,bigint,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.edit_publication(uuid,bigint,jsonb,jsonb,jsonb) to authenticated;
create function public.edit_publication(p_id uuid,p_revision bigint,p_content jsonb,p_inventory jsonb,p_removed jsonb default '[]') returns jsonb language sql security invoker set search_path='' as $$select private.edit_publication(p_id,p_revision,p_content,p_inventory,p_removed);$$;
revoke all on function public.edit_publication(uuid,bigint,jsonb,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.edit_publication(uuid,bigint,jsonb,jsonb,jsonb) to authenticated;
