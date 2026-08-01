-- Diese Migration wurde bereits live auf Supabase angewendet.
--
-- WICHTIG: saves.file_hash, saves.updated_by_device, saves.deleted_at und
-- save_versions.file_hash / save_versions.device_label existierten zum
-- Zeitpunkt dieser Migration BEREITS in der DB (offenbar durch eine
-- parallele Session direkt gegen Supabase angelegt, nicht über dieses
-- Repo). Diese Migration legt sie daher nicht erneut an, sondern baut nur
-- auf ihnen auf. Siehe CLAUDE.md für den Hinweis, bei Unsicherheit den
-- echten DB-Stand per Supabase-Connector zu prüfen statt sich auf die
-- Migrationsdateien in diesem Repo zu verlassen.

-- Speicherplatz-Kontingent pro Nutzer (Free-Tier-Default 200 MB)
alter table public.subscriptions
  add column if not exists max_storage_bytes bigint not null default 209715200;

-- Automatisch eine subscriptions-Zeile für jeden neuen Nutzer anlegen,
-- damit die Kontingent-Anzeige nicht auf eine fehlende Zeile trifft.
create or replace function public.handle_new_user_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.subscriptions (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_subscription on auth.users;

create trigger on_auth_user_created_subscription
  after insert on auth.users
  for each row
  execute function public.handle_new_user_subscription();

-- Bestehende Nutzer ohne subscriptions-Zeile nachträglich versorgen
insert into public.subscriptions (user_id)
select u.id from auth.users u
left join public.subscriptions s on s.user_id = u.id
where s.user_id is null;
