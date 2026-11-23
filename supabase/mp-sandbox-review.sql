alter table public.mp_sandbox_orders add column review_reason text;
comment on column public.mp_sandbox_orders.review_reason is
  'Operator hold: sandbox webhooks may not credit an order under review.';
