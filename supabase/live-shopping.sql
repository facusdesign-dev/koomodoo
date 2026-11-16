-- LiveKit carries media; Postgres stores catalogue, chat and lifecycle only.
create table public.live_rooms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 100),
  status text not null default 'preparing' check (status in ('preparing','live','ended')),
  pinned_product_id uuid references public.products(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  lease_until timestamptz not null default now() + interval '90 seconds'
);
create unique index live_rooms_one_active_host on public.live_rooms(user_id) where status <> 'ended';
create index live_rooms_directory on public.live_rooms(status, lease_until, created_at desc);
create index live_rooms_pin on public.live_rooms(pinned_product_id);
create table public.live_room_products (
  room_id uuid not null references public.live_rooms(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  position smallint not null check (position between 0 and 11),
  primary key(room_id, product_id),
  unique(room_id, position)
);
create index live_room_products_product on public.live_room_products(product_id);
create table public.live_room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.live_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null check (char_length(btrim(text)) between 1 and 300),
  created_at timestamptz not null default now()
);
create index live_messages_room_time on public.live_room_messages(room_id,created_at desc,id);
create index live_messages_user_time on public.live_room_messages(user_id,created_at desc);

alter table public.live_rooms enable row level security;
alter table public.live_room_products enable row level security;
alter table public.live_room_messages enable row level security;
revoke all on public.live_rooms, public.live_room_products, public.live_room_messages from public, anon, authenticated;
grant select on public.live_rooms, public.live_room_products to anon, authenticated;
grant update(pinned_product_id) on public.live_rooms to authenticated;
grant select on public.live_room_messages to authenticated;
grant insert(room_id,user_id,text) on public.live_room_messages to authenticated;
grant all on public.live_rooms, public.live_room_products, public.live_room_messages to service_role;
create policy live_rooms_read on public.live_rooms for select to anon, authenticated
  using ((status='live' and lease_until>now()) or user_id=(select auth.uid()));
create policy live_rooms_owner_pin on public.live_rooms for update to authenticated
  using (user_id=(select auth.uid()) and status='live' and lease_until>now())
  with check (user_id=(select auth.uid()) and status='live' and lease_until>now());
create policy live_products_read on public.live_room_products for select to anon, authenticated
  using (exists(select 1 from public.live_rooms r where r.id=room_id));
create policy live_messages_read on public.live_room_messages for select to authenticated
  using (exists(select 1 from public.live_rooms r where r.id=room_id and r.status='live' and r.lease_until>now()));
create policy live_messages_send on public.live_room_messages for insert to authenticated
  with check (user_id=(select auth.uid()) and exists(select 1 from public.live_rooms r
    where r.id=room_id and r.status='live' and r.lease_until>now()));

create function private.check_live_product() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_table_name='live_room_products' then
    if not exists(select 1 from public.products p join public.live_rooms r on r.id=new.room_id
      where p.id=new.product_id and p.user_id=r.user_id and p.status='published') then
      raise exception 'El producto debe estar publicado y pertenecer al vendedor del vivo';
    end if;
  elsif new.pinned_product_id is not null then
    if not exists(select 1 from public.live_room_products lp join public.products p on p.id=lp.product_id
      where lp.room_id=new.id and lp.product_id=new.pinned_product_id
        and p.user_id=new.user_id and p.status='published') then
      raise exception 'Solo podes destacar un producto de este vivo';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.check_live_product() from public, anon, authenticated;
create trigger live_product_ownership before insert or update on public.live_room_products
  for each row execute function private.check_live_product();
create trigger live_pin_ownership before update of pinned_product_id on public.live_rooms
  for each row execute function private.check_live_product();

create function private.limit_live_chat() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 4097));
  if exists(select 1 from public.live_room_messages where user_id=new.user_id
      and created_at>now()-interval '3 seconds') then
    raise exception 'Espera unos segundos antes de volver a comentar';
  end if;
  new.text=btrim(new.text);
  return new;
end $$;
revoke all on function private.limit_live_chat() from public, anon, authenticated;
create trigger live_chat_throttle before insert on public.live_room_messages
  for each row execute function private.limit_live_chat();

alter publication supabase_realtime add table public.live_rooms, public.live_room_messages;
