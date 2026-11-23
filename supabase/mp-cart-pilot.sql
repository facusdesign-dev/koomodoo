alter table public.orders add column is_payment_test boolean not null default false;
alter table public.mp_sandbox_orders add column cart_order_id uuid unique references public.orders(id);
drop index public.mp_one_card_pilot_per_buyer;
create unique index mp_one_card_pilot_per_buyer on public.mp_sandbox_orders(buyer_id)
where buyer_id is not null and archived_at is null and cart_order_id is null;

-- Operators explicitly designate disposable SKUs, a buyer and a test collector.
create table private.mp_cart_test_products (
  product_id uuid primary key references public.products(id) on delete cascade,
  buyer_id uuid not null references auth.users(id), collector text not null check(collector ~ '^[0-9]+$')
);
revoke all on private.mp_cart_test_products from public,anon,authenticated,service_role;
create function private.bind_test_cart() returns trigger language plpgsql security definer set search_path='' as $$
declare collector_id text; total_items int; matches int; collectors int;
begin
  if exists(select 1 from public.order_items i join private.mp_cart_test_products q on q.product_id=i.product_id
    where i.order_id=new.id and q.buyer_id<>new.buyer_id) then raise exception 'Producto reservado para ensayo'; end if;
  select count(*),count(q.product_id),count(distinct q.collector),min(q.collector)
    into total_items,matches,collectors,collector_id from public.order_items i
    left join private.mp_cart_test_products q on q.product_id=i.product_id and q.buyer_id=new.buyer_id
    where i.order_id=new.id;
  if matches=0 then return null; end if;
  if matches<>total_items or collectors<>1 or new.currency<>'UYU' or new.total<=0 or new.total>100 then
    raise exception 'Separá los productos de ensayo. Máximo 100 UYU por prueba.';
  end if;
  update public.orders set is_payment_test=true where id=new.id;
  insert into public.mp_sandbox_orders(reference,cart_order_id,buyer_id,seller_id,amount_cents)
    values(new.id,new.id,new.buyer_id,collector_id,(new.total*100)::integer);
  return null;
end $$;
create constraint trigger mp_bind_test_cart after insert on public.orders
  deferrable initially deferred for each row execute function private.bind_test_cart();
revoke all on function private.bind_test_cart() from public,anon,authenticated,service_role;

create function private.apply_test_cart_payment() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
  if new.cart_order_id is null then return new; end if;
  select * into strict o from public.orders where id=new.cart_order_id for update;
  if not o.is_payment_test or o.buyer_id<>new.buyer_id or o.total*100<>new.amount_cents or o.currency<>new.currency
    then raise exception 'Pedido de ensayo incompatible'; end if;
  if new.attempt_state='processing' and old.attempt_id is distinct from new.attempt_id and
     (o.status<>'pending_payment' or o.expires_at<=clock_timestamp()) then raise exception 'La reserva no está vigente'; end if;
  if new.attempt_state='approved' and old.attempt_state<>'approved' then
    if o.status<>'pending_payment' or o.expires_at<=clock_timestamp() then
      new.review_reason:='approved_after_reservation'; return new;
    end if;
    perform private.settle_verified_order(o.id,'mp-test:'||new.payment_id,o.total,o.currency);
  end if;
  return new;
end $$;
create trigger mp_apply_test_cart_payment before update of attempt_state on public.mp_sandbox_orders
for each row execute function private.apply_test_cart_payment();
revoke all on function private.apply_test_cart_payment() from public,anon,authenticated,service_role;
