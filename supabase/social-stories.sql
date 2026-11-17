-- Public, expiring stories. Media stays private and is read through short signed URLs.
create table public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  media_url text not null check (length(media_url) between 10 and 500),
  media_type text not null check (media_type in ('image','video')),
  caption text not null default '' check (length(caption) <= 500),
  product_id uuid references public.products(id) on delete set null,
  author_avatar text not null default '',
  author_avatar_type text not null default 'emoji' check (author_avatar_type in ('image','emoji')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  check (expires_at > created_at and expires_at <= created_at + interval '24 hours'),
  check (media_url like 'stories/' || user_id::text || '/%')
);
create index stories_active_idx on public.stories (expires_at, created_at desc);
create index stories_owner_idx on public.stories (user_id, created_at desc);
create index stories_product_idx on public.stories (product_id) where product_id is not null;
alter table public.stories enable row level security;
grant select on public.stories to anon, authenticated;
grant insert(user_id,media_url,media_type,caption,product_id,author_avatar,author_avatar_type), delete on public.stories to authenticated;
create policy stories_public_active on public.stories for select to anon, authenticated using (expires_at > now());
create policy stories_owner_create on public.stories for insert to authenticated with check (
  user_id = (select auth.uid()) and
  (product_id is null or exists (select 1 from public.products p where p.id = product_id and p.user_id = (select auth.uid()) and p.status = 'published'))
);
create policy stories_owner_delete on public.stories for delete to authenticated using (user_id = (select auth.uid()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('story-media','story-media',false,10485760,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime']);
create policy story_media_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'story-media' and (storage.foldername(name))[1] = 'stories' and (storage.foldername(name))[2] = (select auth.uid())::text
);
create policy story_media_read on storage.objects for select to anon, authenticated using (
  bucket_id = 'story-media' and (
    owner_id = (select auth.uid())::text or exists (select 1 from public.stories s where s.media_url = name and s.expires_at > now())
  )
);
create policy story_media_delete on storage.objects for delete to authenticated using (bucket_id = 'story-media' and owner_id = (select auth.uid())::text);

-- A follow and its notification commit together, even if the browser closes.
alter table public.notifications add column follow_id uuid unique references public.followers(id) on delete set null;
create index notifications_unread_idx on public.notifications(user_id) where read = false;
create or replace function private.notify_follow() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is distinct from new.follower_id then raise exception 'Invalid follower'; end if;
  insert into public.notifications(user_id,actor_id,type,read,follow_id)
  values(new.following_id,new.follower_id,'follow',false,new.id);
  return new;
end;
$$;
revoke all on function private.notify_follow() from public, anon, authenticated, service_role;
create trigger followers_notify after insert on public.followers for each row execute function private.notify_follow();
drop policy notifications_actor_insert on public.notifications;
revoke insert on public.notifications from authenticated;
grant update(read) on public.notifications to authenticated;
insert into public.notifications(user_id,actor_id,type,read,follow_id,created_at)
select f.following_id,f.follower_id,'follow',false,f.id,f.created_at
from public.followers f where not exists (
  select 1 from public.notifications n where n.user_id=f.following_id and n.actor_id=f.follower_id and n.type='follow'
);
alter publication supabase_realtime add table public.stories, public.notifications, public.followers;

-- Live rooms already have public active-room policies. Public comments are read-only to guests.
grant select on public.live_room_messages to anon;
create policy live_messages_public_read on public.live_room_messages for select to anon using (
  exists (select 1 from public.live_rooms r where r.id=room_id and r.status='live' and r.lease_until > now())
);
