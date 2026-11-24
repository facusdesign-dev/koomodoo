begin;
create table public.shop_delivery (
 id uuid primary key default gen_random_uuid(), seller_id uuid not null references auth.users,
 mode text not null check(mode in ('pickup','local','agency')), zone text not null check(length(trim(zone)) between 1 and 60),
 label text not null check(length(trim(label)) between 1 and 100), eta text not null check(length(trim(eta)) between 1 and 100),
 currency text not null check(currency in ('UYU','USD')), fee numeric(12,2) not null check(fee>=0 and fee<1000000),
 enabled boolean not null default true
);
create index shop_delivery_seller on public.shop_delivery(seller_id,currency);
alter table public.shop_delivery enable row level security;
revoke all on public.shop_delivery from anon,authenticated;
grant select on public.shop_delivery to anon,authenticated;
grant insert,update,delete on public.shop_delivery to authenticated;
create policy delivery_read on public.shop_delivery for select using(enabled or seller_id=auth.uid());
create policy delivery_owner on public.shop_delivery for all to authenticated using(seller_id=auth.uid()) with check(seller_id=auth.uid());
alter table public.orders add column delivery jsonb, add column shipped_at timestamptz, add column tracking_code text,
 add column shipment_received_at timestamptz;
create function private.snapshot_delivery() returns trigger language plpgsql security definer set search_path='' as $$
declare d jsonb:=nullif(current_setting('koomodoo.delivery',true),'')::jsonb; r public.shop_delivery;
begin
 if d is null then
   if exists(select from public.shop_delivery where seller_id=new.seller_id) then raise exception 'Elegí una modalidad disponible para este local.'; end if;
   return new;
 end if;
 select * into r from public.shop_delivery where id=(d->>'id')::uuid and seller_id=new.seller_id and currency=new.currency and enabled for share;
 if not found or (d->>'fee')::numeric is distinct from r.fee or r.zone is distinct from d->>'zone'
   or r.label is distinct from d->>'label' or r.eta is distinct from d->>'eta' or r.mode is distinct from d->>'mode'
   then raise exception 'La opción de entrega cambió. Revisá el carrito.'; end if;
 if r.mode<>'pickup' and length(trim(coalesce(d->>'destination',''))) not between 3 and 200 then raise exception 'Indicá la dirección o sucursal de destino.';end if;
 new.delivery:=jsonb_build_object('id',r.id,'mode',r.mode,'zone',r.zone,'label',r.label,'eta',r.eta,'fee',r.fee,
   'subtotal',new.total,'destination',case when r.mode<>'pickup' then trim(d->>'destination') end);
 new.total:=new.total+r.fee;return new;
end $$;
create trigger snapshot_delivery before insert on public.orders for each row execute function private.snapshot_delivery();
create function public.reserve_delivery_order(p_items jsonb,p_key uuid,p_delivery jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare o jsonb;
begin
 if jsonb_typeof(p_delivery) is distinct from 'object' then raise exception 'Elegí la entrega.';end if;
 perform set_config('koomodoo.delivery',p_delivery::text,true);
 o:=private.reserve_order(p_items,p_key);
 perform set_config('koomodoo.delivery','',true);
 if o->'delivery'->>'id' is distinct from p_delivery->>'id' or
 coalesce(o->'delivery'->>'destination','')<>trim(coalesce(p_delivery->>'destination','')) then raise exception 'Este intento ya corresponde a otra entrega.';end if;
 return o;
end $$;
revoke all on function public.reserve_delivery_order(jsonb,uuid,jsonb) from public,anon;
grant execute on function public.reserve_delivery_order(jsonb,uuid,jsonb) to authenticated;
create function private.check_pickup_mode() returns trigger language plpgsql set search_path='' as $$
begin
 if new.delivery->>'mode' in ('local','agency') then raise exception 'Este pedido tiene envío, no retiro.';end if;return new;
end $$;
create trigger check_pickup_mode before update of pickup_ready_at,pickup_received_at on public.orders for each row execute function private.check_pickup_mode();
create function public.advance_test_shipment(p_order uuid,p_step text,p_tracking text default '') returns void
language plpgsql security definer set search_path='' as $$
declare o public.orders; u uuid:=auth.uid(); dest uuid; msg text;
begin
 select * into o from public.orders where id=p_order and u in (buyer_id,seller_id) for update;
 if not found or not o.is_payment_test or o.status<>'paid' or o.test_payment_state is distinct from 'approved'
   or coalesce(o.delivery->>'mode','') not in ('local','agency') then raise exception 'Se requiere un envío de ensayo pagado.';end if;
 if p_step='ship' and u=o.seller_id then
   if o.shipped_at is not null then return;end if;
   if o.delivery->>'mode'='agency' and length(trim(coalesce(p_tracking,''))) not between 1 and 100 then raise exception 'Ingresá el número de guía.';end if;
   update public.orders set shipped_at=now(),tracking_code=case when delivery->>'mode'='agency' then trim(p_tracking) end where id=o.id;
   dest:=o.buyer_id;msg:='En camino. Consultá los detalles en Mis pedidos.';
 elsif p_step='receive' and u=o.buyer_id and o.shipped_at is not null then
   if o.shipment_received_at is not null then return;end if;
   update public.orders set shipment_received_at=now() where id=o.id;dest:=o.seller_id;msg:='Recepción confirmada.';
 else raise exception 'No corresponde esa acción.';end if;
 insert into public.messages(from_user,to_user,text) values(u,dest,'Ensayo sin envío físico · Pedido #'||left(o.id::text,8)||': '||msg);
end $$;
revoke all on function public.advance_test_shipment(uuid,text,text) from public,anon;
grant execute on function public.advance_test_shipment(uuid,text,text) to authenticated;
create or replace function public.has_shop_delivery(p_seller uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select from public.shop_delivery where seller_id=p_seller);
$$;
revoke all on function public.has_shop_delivery(uuid) from public;
grant execute on function public.has_shop_delivery(uuid) to anon,authenticated;
commit;
