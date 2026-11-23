alter table public.mp_sandbox_orders add column preference_id text unique;
update public.mp_sandbox_orders
set preference_id='3858851547-9282b163-fea6-463d-b9ff-7662e6b0f3e2'
where reference='814c2dc1-bccf-4ed0-aa7f-e76fb476e1a4';
