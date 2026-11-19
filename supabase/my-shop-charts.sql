create function public.my_shop_charts() returns jsonb
language sql stable security invoker set search_path='' as $$
  with months as (
    select generate_series(date_trunc('month',now() at time zone 'America/Montevideo')-interval '5 months',
      date_trunc('month',now() at time zone 'America/Montevideo'),interval '1 month') as month
  ), paid as (
    select id,created_at from public.orders where seller_id=(select auth.uid()) and status='paid'
  ), series as (
    select m.month,count(p.id) sales from months m left join paid p
      on date_trunc('month',p.created_at at time zone 'America/Montevideo')=m.month group by m.month
  ), ranking as (
    select i.product_id,(array_agg(i.product_title order by p.created_at desc,i.id))[1] title,sum(i.quantity) units
    from paid p join public.order_items i on i.order_id=p.id group by i.product_id
    order by units desc,i.product_id limit 5
  )
  select jsonb_build_object('months',(select jsonb_agg(jsonb_build_object('month',to_char(month,'YYYY-MM'),'sales',sales) order by month) from series),
    'ranking',coalesce((select jsonb_agg(to_jsonb(r) order by units desc,product_id) from ranking r),'[]'::jsonb));
$$;
revoke all on function public.my_shop_charts() from public,anon;
grant execute on function public.my_shop_charts() to authenticated;
