-- stock on variants remains AVAILABLE stock for compatibility with old clients.
-- total_stock is physical stock; it falls only after a trusted payment settlement.
begin;
set local lock_timeout='5s';
lock table public.products, public.product_variants, public.orders in access exclusive mode;
alter table public.product_variants
  add column reserved_stock integer not null default 0 check(reserved_stock>=0),
  add column total_stock integer generated always as (stock+reserved_stock) stored;
alter table public.products
  add column reserved_stock integer not null default 0 check(reserved_stock>=0),
  add column available_stock integer not null default 0 check(available_stock>=0);
-- Restore the physical count of any pending reservations created by old code.
update public.product_variants v set reserved_stock=held.units
from (select i.variant_id,sum(i.quantity)::integer units from public.order_items i
  join public.orders o on o.id=i.order_id where o.status='pending_payment' group by i.variant_id) held
where v.id=held.variant_id;

create function private.product_stock_totals() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from public.product_variants where product_id=new.id) then
    select coalesce(sum(total_stock),0),coalesce(sum(stock),0),coalesce(sum(reserved_stock),0)
      into new.stock,new.available_stock,new.reserved_stock
      from public.product_variants where product_id=new.id;
  end if;
  return new;
end $$;
revoke all on function private.product_stock_totals() from public,anon,authenticated,service_role;
create trigger product_stock_totals before update of stock on public.products
  for each row execute function private.product_stock_totals();
update public.products set stock=stock;

create or replace function private.reserve_order(p_items jsonb,p_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid:=auth.uid(); normalized jsonb; previous public.orders; line record;
  v public.product_variants; p public.products; seller uuid; code text; total_amount numeric:=0; oid uuid;
begin
  if uid is null then raise exception 'Inicia sesion para crear un pedido.'; end if;
  if p_key is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Carrito invalido.'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(variant_id uuid,quantity integer) where variant_id is null or quantity is null or quantity not between 1 and 99) then raise exception 'Cantidad invalida.'; end if;
  select jsonb_agg(to_jsonb(x) order by variant_id) into normalized from
    (select variant_id,sum(quantity)::integer quantity from jsonb_to_recordset(p_items) as i(variant_id uuid,quantity integer) group by variant_id) x;
  perform pg_advisory_xact_lock(hashtextextended(uid::text||p_key::text,0));
  select * into previous from public.orders where buyer_id=uid and idempotency_key=p_key;
  if found then
    if previous.request<>normalized then raise exception 'La clave del pedido ya se uso con otro carrito.'; end if;
    return to_jsonb(previous);
  end if;
  perform p0.id from public.products p0 where p0.id in
    (select pv.product_id from public.product_variants pv join jsonb_to_recordset(normalized) as i(variant_id uuid,quantity integer) on pv.id=i.variant_id)
    order by p0.id for update;
  for line in select * from jsonb_to_recordset(normalized) as i(variant_id uuid,quantity integer) order by variant_id loop
    if line.quantity>99 then raise exception 'Cantidad maxima por variante: 99.'; end if;
    select * into v from public.product_variants where id=line.variant_id for update;
    if not found then raise exception 'La variante ya no existe.'; end if;
    select * into p from public.products where id=v.product_id;
    if p.status<>'published' then raise exception 'Producto no disponible.'; end if;
    if p.user_id=uid then raise exception 'No puedes comprar tus propios productos.'; end if;
    if seller is null then seller:=p.user_id; code:=p.currency; end if;
    if seller<>p.user_id or code<>p.currency then raise exception 'Crea un pedido por vendedor y moneda.'; end if;
    if exists(select 1 from jsonb_array_elements(p_items) item where (item->>'variant_id')::uuid=v.id
      and item ? 'expected_unit_price' and (item->>'expected_unit_price')::numeric is distinct from v.price) then
      raise exception 'El precio cambio. Revisa el carrito y confirma nuevamente.';
    end if;
    if v.stock<line.quantity then raise exception 'Stock insuficiente para % (%).',p.title,v.label; end if;
    total_amount:=total_amount+v.price*line.quantity;
    update public.product_variants set stock=stock-line.quantity,reserved_stock=reserved_stock+line.quantity where id=v.id;
  end loop;
  insert into public.orders(buyer_id,seller_id,currency,total,idempotency_key,request)
    values(uid,seller,code,total_amount,p_key,normalized) returning id into oid;
  for line in select * from jsonb_to_recordset(normalized) as i(variant_id uuid,quantity integer) loop
    select * into v from public.product_variants where id=line.variant_id;
    select * into p from public.products where id=v.product_id;
    insert into public.order_items(order_id,product_id,variant_id,product_title,variant_label,unit_price,quantity)
      values(oid,p.id,v.id,p.title,v.label,v.price,line.quantity);
    update public.products set stock=stock where id=p.id;
  end loop;
  return (select to_jsonb(o) from public.orders o where o.id=oid);
end $$;

create or replace function private.release_reserved_order(p_order uuid,p_status text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.orders; line record;
begin
  if p_status not in ('expired','cancelled') or p_status is null then raise exception 'Estado de liberacion invalido.'; end if;
  select * into o from public.orders where id=p_order for update;
  if not found then raise exception 'Pedido no disponible.'; end if;
  if o.status in ('expired','cancelled') then return to_jsonb(o); end if;
  if o.status<>'pending_payment' then raise exception 'El pedido ya no tiene una reserva liberable.'; end if;
  if p_status='expired' and o.expires_at>clock_timestamp() then raise exception 'La reserva todavia no vencio.'; end if;
  perform p.id from public.products p where p.id in(select product_id from public.order_items where order_id=o.id) order by p.id for update;
  for line in select * from public.order_items where order_id=o.id order by variant_id loop
    update public.product_variants set stock=stock+line.quantity,reserved_stock=reserved_stock-line.quantity
      where id=line.variant_id and reserved_stock>=line.quantity;
    if not found then raise exception 'La reserva requiere conciliacion de inventario.'; end if;
  end loop;
  update public.products set stock=stock where id in(select product_id from public.order_items where order_id=o.id);
  update public.orders set status=p_status,
    cancelled_at=case when p_status='cancelled' then clock_timestamp() else cancelled_at end,
    expired_at=case when p_status='expired' then clock_timestamp() else expired_at end
    where id=o.id returning * into o;
  return to_jsonb(o);
end $$;

create table private.order_payment_receipts (
  order_id uuid primary key references public.orders(id),
  payment_reference text not null unique check(length(payment_reference) between 3 and 200),
  amount numeric(14,2) not null check(amount>0),
  currency text not null,
  created_at timestamptz not null default now()
);
alter table private.order_payment_receipts enable row level security;
create policy payment_receipts_no_client_access on private.order_payment_receipts
  for all to anon,authenticated,service_role using(false) with check(false);
revoke all on private.order_payment_receipts from public,anon,authenticated,service_role;
-- NOT a payment verifier. Reserved for a future server handler AFTER verifying
-- the provider signature, approved status, recipient, amount and currency.
-- No public RPC and no client/service-role EXECUTE are granted at this stage.
create function private.settle_verified_order(p_order uuid,p_reference text,p_amount numeric,p_currency text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.orders; receipt private.order_payment_receipts; line record;
begin
  if p_reference is null or length(p_reference) not between 3 and 200 then raise exception 'Referencia de pago invalida.'; end if;
  select * into o from public.orders where id=p_order for update;
  if not found then raise exception 'Pedido no disponible.'; end if;
  if p_amount is distinct from o.total or p_currency is distinct from o.currency then raise exception 'Importe o moneda de pago no coinciden.'; end if;
  select * into receipt from private.order_payment_receipts where order_id=o.id;
  if found then
    if receipt.payment_reference<>p_reference or o.status<>'paid' then raise exception 'Pago incompatible con el pedido.'; end if;
    return to_jsonb(o);
  end if;
  if o.status<>'pending_payment' or o.expires_at<=clock_timestamp() then raise exception 'Pago fuera de una reserva vigente: conciliar o devolver, no descontar stock.'; end if;
  perform p.id from public.products p where p.id in(select product_id from public.order_items where order_id=o.id) order by p.id for update;
  for line in select * from public.order_items where order_id=o.id order by variant_id loop
    update public.product_variants set reserved_stock=reserved_stock-line.quantity
      where id=line.variant_id and reserved_stock>=line.quantity;
    if not found then raise exception 'La reserva requiere conciliacion de inventario.'; end if;
  end loop;
  insert into private.order_payment_receipts(order_id,payment_reference,amount,currency) values(o.id,p_reference,p_amount,p_currency);
  update public.products set stock=stock where id in(select product_id from public.order_items where order_id=o.id);
  update public.orders set status='paid' where id=o.id returning * into o;
  return to_jsonb(o);
end $$;
revoke all on function private.settle_verified_order(uuid,text,numeric,text) from public,anon,authenticated,service_role;
-- Preserve the existing public invoker wrappers and auth checks.
revoke all on function private.release_reserved_order(uuid,text) from public,anon,authenticated,service_role;
commit;
