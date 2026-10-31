-- Songwriter: Datenbank für den Cloud-Sync
-- In Supabase → SQL Editor → New query einfügen und "Run" drücken. Mehrfaches Ausführen schadet nicht.

-- 1) Songs (Inhalt als JSON, eine Zeile pro Song oder Idee)
create table if not exists public.songs (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data        jsonb,
  updated_at  bigint not null,
  deleted     boolean not null default false
);

alter table public.songs enable row level security;

drop policy if exists "songs: eigene lesen" on public.songs;
drop policy if exists "songs: eigene anlegen" on public.songs;
drop policy if exists "songs: eigene ändern" on public.songs;
drop policy if exists "songs: eigene löschen" on public.songs;

create policy "songs: eigene lesen"   on public.songs for select to authenticated using (user_id = auth.uid());
create policy "songs: eigene anlegen" on public.songs for insert to authenticated with check (user_id = auth.uid());
create policy "songs: eigene ändern"  on public.songs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "songs: eigene löschen" on public.songs for delete to authenticated using (user_id = auth.uid());

-- 2) Aufnahmen: privater Bucket, jede Person nur im eigenen Ordner <user-id>/
insert into storage.buckets (id, name, public)
values ('audio', 'audio', false)
on conflict (id) do nothing;

drop policy if exists "audio: eigene lesen" on storage.objects;
drop policy if exists "audio: eigene hochladen" on storage.objects;
drop policy if exists "audio: eigene ersetzen" on storage.objects;
drop policy if exists "audio: eigene löschen" on storage.objects;

create policy "audio: eigene lesen" on storage.objects for select to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "audio: eigene hochladen" on storage.objects for insert to authenticated
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "audio: eigene ersetzen" on storage.objects for update to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "audio: eigene löschen" on storage.objects for delete to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
