begin;
create temporary table qa_stock(seller uuid,buyer uuid,product jsonb,variant uuid,oid uuid,key uuid default gen_random_uuid());
insert into qa_stock(seller,buyer) select (array_agg(id order by created_at))[1],(array_agg(id order by created_at))[2] from auth.users;
grant all on qa_stock to authenticated;
select set_config('request.jwt.claim.sub',(select seller::text from qa_stock),true);
set local role authenticated;
update qa_stock set product=public.publish_product('{"title":"QA pago stock","currency":"UYU","media_urls":["https://example.invalid/qa.jpg"]}', '[{"label":"Unica","price":1000,"stock":5}]');
update qa_stock set variant=v.id from public.product_variants v where product_id=(product->>'id')::uuid;
reset role;
select set_config('request.jwt.claim.sub',(select buyer::text from qa_stock),true);
set local role authenticated;
update qa_stock set oid=(public.reserve_order(jsonb_build_array(jsonb_build_object('variant_id',variant,'quantity',2)),key)->>'id')::uuid;
do $$ declare v public.product_variants; p public.products; begin
  select * into v from public.product_variants where id=(select variant from qa_stock);
  select * into p from public.products where id=(select (product->>'id')::uuid from qa_stock);
  if v.stock<>3 or v.reserved_stock<>2 or v.total_stock<>5 or p.stock<>5 or p.available_stock<>3 or p.reserved_stock<>2 then raise exception 'FAIL: reservation changed physical stock'; end if;
  perform public.reserve_order(jsonb_build_array(jsonb_build_object('variant_id',variant,'quantity',2)),key) from qa_stock;
  if (select total_stock from public.product_variants where id=v.id)<>5 then raise exception 'FAIL: idempotency'; end if;
  begin
    perform private.settle_verified_order((select oid from qa_stock),'qa:forged',2000,'UYU');
    raise exception 'FAIL: buyer approved payment';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  begin
    perform private.settle_verified_order((select oid from qa_stock),'qa:amount',1,'UYU');
    raise exception 'FAIL: wrong amount';
  exception when raise_exception then if sqlerrm not like 'Importe o moneda%' then raise; end if; end;
  begin
    perform private.settle_verified_order((select oid from qa_stock),'qa:currency',2000,'USD');
    raise exception 'FAIL: wrong currency';
  exception when raise_exception then if sqlerrm not like 'Importe o moneda%' then raise; end if; end;
end $$;
-- Trusted payment simulated ONLY inside this rolled-back test, not a real charge.
select private.settle_verified_order(oid,'qa:approved:'||oid::text,2000,'UYU') from qa_stock;
select private.settle_verified_order(oid,'qa:approved:'||oid::text,2000,'UYU') from qa_stock;
do $$ begin
  if (select total_stock from public.product_variants where id=(select variant from qa_stock))<>3 or
     (select stock from public.products where id=(select (product->>'id')::uuid from qa_stock))<>3 or
     (select reserved_stock from public.product_variants where id=(select variant from qa_stock))<>0 then raise exception 'FAIL: approved payment did not settle exactly once'; end if;
end $$;
set local role authenticated;
do $$ begin
  begin
    perform public.cancel_order((select oid from qa_stock));
    raise exception 'FAIL: released paid stock';
  exception when raise_exception then if sqlerrm not like 'El pedido ya no tiene%' then raise; end if; end;
end $$;
update qa_stock set oid=(public.reserve_order(jsonb_build_array(jsonb_build_object('variant_id',variant,'quantity',1)),gen_random_uuid())->>'id')::uuid;
select public.cancel_order(oid) from qa_stock;
select public.cancel_order(oid) from qa_stock;
do $$ begin
  if (select total_stock from public.product_variants where id=(select variant from qa_stock))<>3 or
     (select stock from public.product_variants where id=(select variant from qa_stock))<>3 then raise exception 'FAIL: cancellation inflated physical stock'; end if;
end $$;
update qa_stock set oid=(public.reserve_order(jsonb_build_array(jsonb_build_object('variant_id',variant,'quantity',1)),gen_random_uuid())->>'id')::uuid;
reset role;
update public.orders set expires_at=clock_timestamp()-interval '1 second' where id=(select oid from qa_stock);
select private.release_reserved_order(oid,'expired') from qa_stock;
do $$ begin
  if (select stock from public.products where id=(select (product->>'id')::uuid from qa_stock))<>3 then raise exception 'FAIL: expiration inflated store stock'; end if;
  begin
    perform private.settle_verified_order((select oid from qa_stock),'qa:late',1000,'UYU');
    raise exception 'FAIL: late payment settled';
  exception when raise_exception then if sqlerrm not like 'Pago fuera%' then raise; end if; end;
  if has_function_privilege('service_role','private.settle_verified_order(uuid,text,numeric,text)','execute') then raise exception 'FAIL: unverified service payment entry exposed'; end if;
end $$;
rollback;
select 'PASS: physical stock unchanged on reservation; settlement once only; forged/incorrect/late payments denied; cancellation and expiry restore availability only; all QA rolled back' as result;
