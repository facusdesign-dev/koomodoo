begin;
alter table public.orders add column pickup_ready_at timestamptz,
  add column pickup_received_at timestamptz,
  add check (pickup_received_at is null or pickup_ready_at is not null);

create function public.advance_test_pickup(p_order uuid,p_step text)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); o public.orders; recipient uuid; notice text;
begin
  select * into o from public.orders where id=p_order and u in (buyer_id,seller_id) for update;
  if not found or not o.is_payment_test or o.status<>'paid' or o.test_payment_state is distinct from 'approved'
    then raise exception 'Se requiere un pedido de ensayo pagado.'; end if;
  if p_step='ready' and u=o.seller_id then
    if o.pickup_ready_at is not null then return; end if;
    update public.orders set pickup_ready_at=now() where id=o.id;
    recipient:=o.buyer_id; notice:='Listo para retirar. Simulá la recepción en Mis pedidos.';
  elsif p_step='received' and u=o.buyer_id and o.pickup_ready_at is not null then
    if o.pickup_received_at is not null then return; end if;
    update public.orders set pickup_received_at=now() where id=o.id;
    recipient:=o.seller_id; notice:='Recepción confirmada. El pedido figura como entregado.';
  else raise exception 'No corresponde esa acción para este pedido.'; end if;
  insert into public.messages(from_user,to_user,text)
    values(u,recipient,'Ensayo sin entrega física · Pedido #'||left(o.id::text,8)||': '||notice);
end $$;
revoke all on function public.advance_test_pickup(uuid,text) from public,anon;
grant execute on function public.advance_test_pickup(uuid,text) to authenticated;
commit;
