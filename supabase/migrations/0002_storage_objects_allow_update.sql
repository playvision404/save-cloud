-- Fehlende UPDATE-Policy für den saves-Bucket nachgetragen.
--
-- Ohne diese Policy schlug jeder upload(..., { upsert: true }) auf einen
-- bereits existierenden Pfad fehl (z. B. "Ersetzen" eines Slots in
-- SlotView.tsx, oder das Zurückschreiben der Datei beim Wiederherstellen
-- einer alten Version) — ein Upsert benötigt intern UPDATE-Rechte, es
-- gab bisher aber nur Policies für SELECT, INSERT und DELETE.
--
-- Bereits live auf dem Supabase-Projekt angewendet.
create policy "Nutzer aktualisiert nur eigenen Ordner"
  on storage.objects for update
  using (bucket_id = 'saves' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'saves' and (storage.foldername(name))[1] = auth.uid()::text);
