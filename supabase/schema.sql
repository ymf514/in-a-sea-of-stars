-- In a Sea of Stars — Supabase schema
-- Run once in Supabase → SQL Editor (safe to re-run).
--
-- Visitors (anon key, in the browser) may only:
--   · read visible notes / released stars / predictions
--   · add a note, release a star (rate-limited), upload that star's image
-- They can never update, delete, hide, or read other visitors' client ids.
-- Moderation: Table Editor → set status = 'hidden'. Predictions are written with the
-- service-role key by a local tool only (never shipped to the browser).

-- ------------------------------------------------------------------ tables

create table if not exists public.released_stars (
  id          text primary key check (id ~ '^upload_[a-z0-9]{10}$'),
  title       text not null check (char_length(title) between 1 and 120),
  x           real not null check (abs(x) <= 200),
  z           real not null check (abs(z) <= 200),
  client_id   text not null check (char_length(client_id) between 1 and 40),
  status      text not null default 'visible' check (status in ('visible', 'hidden')),
  created_at  timestamptz not null default now()
);

create table if not exists public.responses (
  id          uuid primary key default gen_random_uuid(),
  star_id     text not null check (star_id ~ '^(star|upload)_[a-z0-9]{3,20}$'),
  text        text not null check (char_length(btrim(text)) between 1 and 500),
  client_id   text not null check (char_length(client_id) between 1 and 40),
  status      text not null default 'visible' check (status in ('visible', 'hidden')),
  created_at  timestamptz not null default now()
);
create index if not exists responses_star_idx on public.responses (star_id, created_at);

-- Machine readings. null = not yet read / unrecognised — never "unrelated".
create table if not exists public.predictions (
  star_id          text primary key,
  tm               jsonb,
  clip             jsonb,
  mn               jsonb,
  analysis_status  text not null default 'pending'
                   check (analysis_status in ('pending', 'analyzing', 'completed', 'uncertain', 'failed')),
  model_version    text,
  updated_at       timestamptz not null default now()
);

-- ------------------------------------------------------------------ privileges

alter table public.released_stars enable row level security;
alter table public.responses      enable row level security;
alter table public.predictions    enable row level security;

revoke all on public.released_stars, public.responses, public.predictions from anon, authenticated;

-- Column-level: visitors never see client_id or status, and cannot set status.
grant select (id, title, x, z, created_at) on public.released_stars to anon, authenticated;
grant insert (id, title, x, z, client_id)  on public.released_stars to anon, authenticated;
grant select (star_id, text, created_at)   on public.responses      to anon, authenticated;
grant insert (star_id, text, client_id)    on public.responses      to anon, authenticated;
grant select on public.predictions to anon, authenticated;

drop policy if exists "read visible stars" on public.released_stars;
create policy "read visible stars" on public.released_stars for select using (status = 'visible');
drop policy if exists "release a star" on public.released_stars;
create policy "release a star" on public.released_stars for insert with check (status = 'visible');

drop policy if exists "read visible notes" on public.responses;
create policy "read visible notes" on public.responses for select using (status = 'visible');
drop policy if exists "leave a note" on public.responses;
create policy "leave a note" on public.responses for insert with check (status = 'visible');

drop policy if exists "read predictions" on public.predictions;
create policy "read predictions" on public.predictions for select using (true);

-- ------------------------------------------------------------------ rate limits

create or replace function public.limit_rate() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  per_client int; overall int; win interval;
  mine int; everyone int;
begin
  if tg_table_name = 'responses' then
    per_client := 4;  overall := 60; win := interval '1 minute';
    select count(*) filter (where client_id = new.client_id), count(*)
      into mine, everyone from public.responses where created_at > now() - win;
  else
    per_client := 6;  overall := 40; win := interval '1 hour';
    select count(*) filter (where client_id = new.client_id), count(*)
      into mine, everyone from public.released_stars where created_at > now() - win;
  end if;
  if mine >= per_client or everyone >= overall then
    raise exception 'The sea needs a moment. Please try again shortly.' using errcode = 'P0001';
  end if;
  new.created_at := now();
  new.status := 'visible';
  return new;
end $$;

drop trigger if exists responses_rate on public.responses;
create trigger responses_rate before insert on public.responses
  for each row execute function public.limit_rate();
drop trigger if exists released_rate on public.released_stars;
create trigger released_rate before insert on public.released_stars
  for each row execute function public.limit_rate();

-- ------------------------------------------------------------------ image storage

-- Public bucket: images are viewable by URL; size and type enforced by Supabase.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('released-stars', 'released-stars', true, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- An image may only be uploaded for a star row created in the last 10 minutes,
-- so the rate limit on released_stars also limits uploads. No update / delete.
drop policy if exists "upload a released star image" on storage.objects;
create policy "upload a released star image" on storage.objects for insert to anon, authenticated
with check (
  bucket_id = 'released-stars'
  and name ~ '^upload_[a-z0-9]{10}\.jpg$'
  and exists (
    select 1 from public.released_stars s
    where s.id = split_part(name, '.', 1) and s.created_at > now() - interval '10 minutes'
  )
);
