alter table public.mp_sandbox_orders
  add column attempt_id uuid,
  add column attempt_state text not null default 'ready'
    check (attempt_state in ('ready','processing','rejected','approved'));
grant update(attempt_id,attempt_state) on public.mp_sandbox_orders to service_role;

create function public.claim_mp_test_attempt(p_order uuid,p_previous uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.mp_sandbox_orders;
begin
  select * into strict o from public.mp_sandbox_orders where reference=p_order for update;
  if o.review_reason is not null or o.preference_id is not null then
    return jsonb_build_object('send',false,'state','review');
  end if;
  if o.payment_id is not null or o.attempt_state='approved' then
    return jsonb_build_object('send',false,'state','approved');
  end if;
  -- A stale tab cannot start a retry after a different attempt was rejected.
  if o.attempt_state='processing' or o.attempt_id is distinct from p_previous then
    return jsonb_build_object('send',false,'state',o.attempt_state);
  end if;
  update public.mp_sandbox_orders set attempt_id=gen_random_uuid(),attempt_state='processing'
    where reference=p_order returning * into o;
  return jsonb_build_object('send',true,'attempt',o.attempt_id,'amountCents',o.amount_cents,
    'currency',o.currency,'seller',o.seller_id);
end $$;
revoke all on function public.claim_mp_test_attempt(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_mp_test_attempt(uuid,uuid) to service_role;

create function public.finish_mp_test_attempt(p_order uuid,p_attempt uuid,p_state text,p_payment text)
returns boolean language sql security invoker set search_path='' as $$
  with saved as (
    update public.mp_sandbox_orders set attempt_state=p_state,
      payment_id=case when p_state='approved' then p_payment end,
      paid_at=case when p_state='approved' then clock_timestamp() end
    where reference=p_order and attempt_id=p_attempt and attempt_state='processing'
      and review_reason is null and payment_id is null and preference_id is null
      and p_state in ('approved','rejected') and p_payment ~ '^[0-9]+$'
    returning 1
  ) select exists(select from saved);
$$;
revoke all on function public.finish_mp_test_attempt(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.finish_mp_test_attempt(uuid,uuid,text,text) to service_role;
