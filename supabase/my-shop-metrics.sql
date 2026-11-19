create function public.my_shop_metrics() returns table(currency text, sales bigint, gross numeric, units numeric)
language sql stable security invoker set search_path='' as $$
  select o.currency::text,count(*),sum(o.total)::numeric,
    sum((select coalesce(sum(i.quantity),0) from public.order_items i where i.order_id=o.id))::numeric
  from public.orders o where o.seller_id=(select auth.uid()) and o.status='paid'
  group by o.currency order by o.currency;
$$;
revoke all on function public.my_shop_metrics() from public, anon;
grant execute on function public.my_shop_metrics() to authenticated;
