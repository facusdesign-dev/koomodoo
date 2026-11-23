alter table public.mp_sandbox_orders add column archived_at timestamptz;
drop index public.mp_one_card_pilot_per_buyer;
create unique index mp_one_card_pilot_per_buyer on public.mp_sandbox_orders(buyer_id)
where buyer_id is not null and archived_at is null;
