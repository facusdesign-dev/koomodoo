begin;
do $$
declare s uuid; b uuid; p uuid; v uuid; o uuid; a uuid; old_metrics jsonb; new_metrics jsonb;
begin
 select id into strict s from auth.users order by created_at limit 1;
 select id into strict b from auth.users where id<>s order by created_at limit 1;
 perform set_config('request.jwt.claim.sub',s::text,true);
 select coalesce(jsonb_agg(to_jsonb(x) order by currency),'[]') into old_metrics from public.my_shop_metrics() x;
 p:=(public.publish_product('{"title":"QA checkout integrado","currency":"UYU","media_urls":["https://example.invalid/qa.jpg"]}',
   '[{"label":"Unica","price":50,"stock":5}]')->>'id')::uuid;
 update public.products set category='qa_fixture',variants=jsonb_build_object('subcategory','unit') where id=p;
 insert into private.shop_rates(category,subcategory,currency,reference_percent,source_url,effective_at)
 values('qa_fixture','unit','UYU',12,'https://example.invalid/test-only',now());
 insert into private.mp_cart_test_products values(p,b,'123');
 select id into strict v from public.product_variants where product_id=p;
 perform set_config('request.jwt.claim.sub',b::text,true);
 o:=(public.reserve_order(jsonb_build_array(jsonb_build_object('variant_id',v,'quantity',2)),gen_random_uuid())->>'id')::uuid;
 set constraints mp_bind_test_cart immediate;
 if not exists(select from public.mp_sandbox_orders where cart_order_id=o and amount_cents=10000 and buyer_id=b)
   or not exists(select from public.order_items where order_id=o and platform_fee=6 and platform_percent=6) then raise exception 'Binding or fee snapshot failed'; end if;
 a:=(public.claim_mp_test_attempt(o,null)->>'attempt')::uuid;
 if not public.finish_mp_test_attempt(o,a,'rejected','123') or (select stock from public.products where id=p)<>5 then raise exception 'Rejection changed stock';end if;
 a:=(public.claim_mp_test_attempt(o,a)->>'attempt')::uuid;
 if not public.finish_mp_test_attempt(o,a,'approved','98765432101234') then raise exception 'Settlement failed';end if;
 if public.finish_mp_test_attempt(o,a,'approved','98765432101234') then raise exception 'Duplicate accepted';end if;
 if not exists(select from public.orders where id=o and status='paid' and is_payment_test)
   or (select stock from public.products where id=p)<>3 then raise exception 'Order or inventory incorrect';end if;
 perform set_config('request.jwt.claim.sub',s::text,true);
 select coalesce(jsonb_agg(to_jsonb(x) order by currency),'[]') into new_metrics from public.my_shop_metrics() x;
 if old_metrics<>new_metrics then raise exception 'Test affected revenue';end if;
 -- Approval arriving after cancellation must be visible as a review, never a sale.
 set constraints mp_bind_test_cart deferred;
 perform set_config('request.jwt.claim.sub',b::text,true);
 o:=(public.reserve_order(jsonb_build_array(jsonb_build_object('variant_id',v,'quantity',1)),gen_random_uuid())->>'id')::uuid;
 set constraints mp_bind_test_cart immediate;
 a:=(public.claim_mp_test_attempt(o,null)->>'attempt')::uuid;
 perform public.cancel_order(o);
 if not public.finish_mp_test_attempt(o,a,'approved','98765432101235') then raise exception 'Late receipt not recorded'; end if;
 if not exists(select from public.orders where id=o and status='cancelled' and test_payment_state='review')
   or (select stock from public.products where id=p)<>3
   then raise exception 'Late approval must enter review without consuming stock'; end if;
end $$;
rollback;
select 'PASS' as cart_payment_pilot;
