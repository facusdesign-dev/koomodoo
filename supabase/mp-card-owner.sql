alter table public.mp_sandbox_orders add column buyer_id uuid references auth.users(id);
create unique index mp_one_card_pilot_per_buyer on public.mp_sandbox_orders(buyer_id)
where buyer_id is not null;
