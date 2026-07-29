-- Erweiterung für Versionierung + Konfliktwarnung
-- Führe diese Datei einmalig in deinem Supabase-Projekt aus
-- (SQL Editor in Supabase Studio, oder via Supabase-CLI/MCP).

-- 1) updated_at auf saves, damit wir Konflikte zwischen Geräten erkennen können
alter table public.saves
  add column if not exists updated_at timestamptz not null default now();

-- Trigger, der updated_at bei jedem Update automatisch aktualisiert
-- (damit die App sich nicht selbst darum kümmern muss / nicht vergessen kann)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists saves_set_updated_at on public.saves;

create trigger saves_set_updated_at
  before update on public.saves
  for each row
  execute function public.set_updated_at();

-- 2) Verlaufstabelle: eine Zeile pro alter Version eines Slots
create table if not exists public.save_versions (
  id uuid primary key default gen_random_uuid(),
  save_id uuid not null references public.saves(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  slot int not null,
  file_path text not null,
  file_size int not null,
  file_name text,
  detected_platform text,
  detected_format text,
  detection_confidence int,
  detection_reasons text[],
  created_at timestamptz not null default now()
);

create index if not exists save_versions_save_id_idx
  on public.save_versions (save_id, created_at desc);

alter table public.save_versions enable row level security;

drop policy if exists "Nutzer sehen nur eigene Versionen" on public.save_versions;
create policy "Nutzer sehen nur eigene Versionen"
  on public.save_versions for select
  using (auth.uid() = user_id);

drop policy if exists "Nutzer legen nur eigene Versionen an" on public.save_versions;
create policy "Nutzer legen nur eigene Versionen an"
  on public.save_versions for insert
  with check (auth.uid() = user_id);

drop policy if exists "Nutzer löschen nur eigene Versionen" on public.save_versions;
create policy "Nutzer löschen nur eigene Versionen"
  on public.save_versions for delete
  using (auth.uid() = user_id);

-- Hinweis: Falls auf public.saves noch keine RLS-Policies existieren,
-- unbedingt nachziehen (analog zu obigen 3 Policies, Tabelle "saves"),
-- sonst können Nutzer fremde Saves lesen/ändern!
