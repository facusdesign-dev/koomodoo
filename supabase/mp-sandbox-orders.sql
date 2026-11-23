-- Isolated checkout rehearsals. Never joined to production inventory or revenue.
create table public.mp_sandbox_orders (
  reference uuid primary key default gen_random_uuid(),
  seller_id text not null check (seller_id ~ '^[0-9]+$'),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'UYU' check (currency = 'UYU'),
  payment_id text unique,
  paid_at timestamptz,
  check ((payment_id is null) = (paid_at is null))
);
alter table public.mp_sandbox_orders enable row level security;
revoke all on public.mp_sandbox_orders from public, anon, authenticated, service_role;
grant select, insert on public.mp_sandbox_orders to service_role;
grant update(payment_id, paid_at) on public.mp_sandbox_orders to service_role;
