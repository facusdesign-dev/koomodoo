alter table public.orders add column test_payment_state text
  check (test_payment_state in ('processing','rejected','approved','review'));

create function private.reflect_test_cart_payment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.cart_order_id is not null then
    update public.orders set test_payment_state=case
      when new.review_reason is not null then 'review'
      when new.attempt_state='ready' then null else new.attempt_state end
      where id=new.cart_order_id and is_payment_test;
  end if;
  return null;
end $$;
revoke all on function private.reflect_test_cart_payment() from public,anon,authenticated,service_role;
create trigger reflect_test_cart_payment after update of attempt_state,review_reason
on public.mp_sandbox_orders for each row execute function private.reflect_test_cart_payment();
update public.orders o set test_payment_state=case when s.review_reason is not null then 'review'
  when s.attempt_state='ready' then null else s.attempt_state end
from public.mp_sandbox_orders s where s.cart_order_id=o.id and o.is_payment_test;
