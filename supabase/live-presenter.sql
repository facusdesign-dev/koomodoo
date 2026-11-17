alter table public.live_rooms
  add column video_filter text not null default 'natural' check(video_filter in ('natural','clear','warm')),
  add column beauty_level smallint not null default 0 check(beauty_level between 0 and 60),
  add column video_quality text not null default 'standard' check(video_quality in ('economy','standard','high'));
-- Existing owner-only live-room UPDATE policy also applies to these columns.
grant update(video_filter,beauty_level,video_quality) on public.live_rooms to authenticated;
