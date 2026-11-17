create table public.live_room_likes (
  room_id uuid not null references public.live_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  liked boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key(room_id,user_id)
);
create index live_likes_count on public.live_room_likes(room_id) where liked;
create index live_likes_user on public.live_room_likes(user_id);
alter table public.live_room_likes enable row level security;
revoke all on public.live_room_likes from public,anon,authenticated;
grant select on public.live_room_likes to authenticated;
grant insert(room_id,user_id,liked),update(liked) on public.live_room_likes to authenticated;
grant all on public.live_room_likes to service_role;
create policy live_likes_read on public.live_room_likes for select to authenticated
  using(exists(select 1 from public.live_rooms r where r.id=room_id and r.status='live' and r.lease_until>now()));
create policy live_likes_insert on public.live_room_likes for insert to authenticated
  with check(user_id=(select auth.uid()) and exists(select 1 from public.live_rooms r
    where r.id=room_id and r.user_id<>(select auth.uid()) and r.status='live' and r.lease_until>now()));
create policy live_likes_update on public.live_room_likes for update to authenticated
  using(user_id=(select auth.uid()) and exists(select 1 from public.live_rooms r
    where r.id=room_id and r.user_id<>(select auth.uid()) and r.status='live' and r.lease_until>now()))
  with check(user_id=(select auth.uid()) and exists(select 1 from public.live_rooms r
    where r.id=room_id and r.user_id<>(select auth.uid()) and r.status='live' and r.lease_until>now()));
create function private.limit_live_like() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and old.updated_at>clock_timestamp()-interval '400 milliseconds' then
    raise exception 'Espera un instante antes de cambiar tu like';
  end if;
  new.updated_at=clock_timestamp();
  return new;
end $$;
revoke all on function private.limit_live_like() from public,anon,authenticated;
create trigger live_like_throttle before insert or update on public.live_room_likes
  for each row execute function private.limit_live_like();
alter publication supabase_realtime add table public.live_room_likes;
