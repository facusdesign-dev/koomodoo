begin;
do $$
declare b uuid; s uuid; p uuid; v uuid; o uuid; a uuid; opt public.shop_delivery;
 d jsonb; items jsonb; mode_name text; key uuid; stage text; total numeric;
begin
 select id into strict s from profiles where username='facusdesign';
 select id into strict b from profiles where username='puredetomate';
 perform set_config('request.jwt.claim.sub',s::text,true);
 p:=(public.publish_product('{"title":"Ensayo de entregas","currency":"UYU","media_urls":["https://example.invalid/qa.jpg"]}',
   '[{"label":"Prueba","price":70,"stock":5}]')->>'id')::uuid;
 insert into private.mp_cart_test_products values(p,b,'123');
 select id into strict v from public.product_variants where product_id=p;
 items:=jsonb_build_array(jsonb_build_object('variant_id',v,'quantity',1,'expected_unit_price',70));
 foreach mode_name in array array['pickup','local','agency'] loop
   set constraints mp_bind_test_cart deferred;
   insert into public.shop_delivery(seller_id,mode,zone,label,eta,currency,fee)
   values(s,mode_name,'Montevideo','Ensayo','1 día','UYU',case when mode_name='pickup' then 0 else 30 end) returning * into opt;
   d:=to_jsonb(opt)||jsonb_build_object('destination',case when mode_name='pickup' then '' else 'Destino ficticio' end);
   perform set_config('request.jwt.claim.sub',b::text,true);
   begin
     perform public.reserve_delivery_order(items,gen_random_uuid(),d||'{"fee":-1}');
     raise exception 'Tarifa alterada aceptada';
   exception when raise_exception then if sqlerrm not like 'La opción de entrega cambió%' then raise;end if; end;
   key:=gen_random_uuid();o:=(public.reserve_delivery_order(items,key,d)->>'id')::uuid;
   if (public.reserve_delivery_order(items,key,d)->>'id')::uuid<>o then raise exception 'Pedido duplicado';end if;
   set constraints mp_bind_test_cart immediate;
   total:=70+opt.fee;
   if not exists(select from orders where id=o and orders.total=70+opt.fee and delivery->>'zone'='Montevideo')
     or not exists(select from mp_sandbox_orders where cart_order_id=o and amount_cents=100*total) then raise exception 'Cobro incorrecto';end if;
   update shop_delivery set fee=99 where id=opt.id;
   perform set_config('request.jwt.claim.sub',s::text,true);
   begin perform public.advance_test_shipment(o,'ship','QA');raise exception 'Envío antes del pago';
   exception when raise_exception then if sqlerrm not like 'Se requiere%' then raise;end if;end;
   a:=(public.claim_mp_test_attempt(o,null)->>'attempt')::uuid;
   if not public.finish_mp_test_attempt(o,a,'approved',(80000000000000+opt.fee::int+length(mode_name))::text) then raise exception 'Pago no confirmado';end if;
   if mode_name='pickup' then perform public.advance_test_pickup(o,'ready');
   else
     if mode_name='agency' then
       begin perform public.advance_test_shipment(o,'ship','');raise exception 'Aceptó sin guía';
       exception when raise_exception then if sqlerrm not like 'Ingresá el número%' then raise;end if;end;
     end if;
     perform public.advance_test_shipment(o,'ship','QA-123');perform public.advance_test_shipment(o,'ship','QA-123');
   end if;
   perform set_config('request.jwt.claim.sub',b::text,true);
   if mode_name='pickup' then perform public.advance_test_pickup(o,'received');
   else perform public.advance_test_shipment(o,'receive','');perform public.advance_test_shipment(o,'receive','');end if;
   if not exists(select from orders where id=o and (pickup_received_at is not null or shipment_received_at is not null)
      and (delivery->>'fee')::numeric=opt.fee and status='paid')
      or (select count(*) from private.order_payment_receipts where order_id=o)<>1 then raise exception 'Cierre incorrecto';end if;
 end loop;
 if (select total_stock from product_variants where id=v)<>2 then raise exception 'Stock incorrecto';end if;
end $$;
rollback;
select 'PASS' as three_delivery_modes;
