create table public.posts(id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade, content text not null default '', media_url text not null default '' check(media_url='' or media_url like 'https://%'), media_type text not null default '' check(media_type in ('','image','video')),author_name text,author_handle text,author_avatar text,author_avatar_type text,created_at timestamptz not null default now());
alter table public.posts enable row level security;
grant select on public.posts to anon,authenticated;
grant insert on public.posts to authenticated;
create policy posts_read on public.posts for select using(true);
create policy posts_write on public.posts for insert to authenticated with check(user_id=(select auth.uid()));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('post-media','post-media',true,52428800,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime']);
create policy post_media_insert on storage.objects for insert to authenticated with check(bucket_id='post-media' and (storage.foldername(name))[1]='posts' and (storage.foldername(name))[2]=(select auth.uid())::text);
create function private.notify_story_like() returns trigger language plpgsql security definer set search_path='' as $$
begin
if new.user_id is distinct from (select auth.uid()) then raise exception 'Invalid actor'; end if;
insert into public.notifications(user_id,actor_id,type,read) select user_id,new.user_id,'story_like',false from public.stories where id=new.story_id and user_id<>new.user_id;
return new;
end; $$;
revoke all on function private.notify_story_like() from public,anon,authenticated;
create trigger story_like_notify after insert on public.story_likes for each row execute function private.notify_story_like();
create view public.trending_products with (security_barrier=true) as select i.product_id,sum(i.quantity) as units from public.order_items i join public.orders o on o.id=i.order_id join public.products p on p.id=i.product_id where o.status='paid' and p.status='published' and o.created_at>=now()-interval '30 days' group by i.product_id;
grant select on public.trending_products to anon,authenticated;
