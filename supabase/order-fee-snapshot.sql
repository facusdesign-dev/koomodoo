create table private.shop_rates (
  id bigint generated always as identity primary key,
  category text not null, subcategory text not null, currency text not null,
  reference_percent numeric not null check(reference_percent between 0 and 100),
  source_url text not null, effective_at timestamptz not null,
  unique(category,subcategory,currency,effective_at)
);
revoke all on private.shop_rates from public, anon, authenticated;
alter table public.order_items add column rate_version bigint references private.shop_rates(id),
  add column platform_percent numeric, add column platform_fee numeric;
create function private.snapshot_shop_rate() returns trigger language plpgsql security definer set search_path='' as $$
declare r private.shop_rates;
begin
  select t.* into r from private.shop_rates t join public.products p on p.id=new.product_id
    and p.category=t.category and p.variants->>'subcategory'=t.subcategory and p.currency=t.currency
    where t.effective_at<=now() order by t.effective_at desc limit 1;
  new.rate_version:=r.id;
  new.platform_percent:=r.reference_percent/2;
  new.platform_fee:=round(new.unit_price*new.quantity*new.platform_percent/100,2);
  return new;
end;$$;
revoke all on function private.snapshot_shop_rate() from public,anon,authenticated;
create trigger snapshot_shop_rate before insert on public.order_items for each row execute function private.snapshot_shop_rate();
