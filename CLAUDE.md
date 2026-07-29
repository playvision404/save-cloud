@AGENTS.md

# Projektkontext für KI-Agenten

Kurzfassung: **Emulator Save Cloud** – Next.js 16 + Supabase App zum
Sichern/Synchronisieren von Emulator-Spielständen. Volle Beschreibung,
Datenbank-Schema (aus dem Code rekonstruiert) und offene Punkte stehen in
`README.md` — dort zuerst nachlesen, bevor Annahmen über Tabellen/Spalten
getroffen werden.

## Wichtige Hinweise, bevor du Code änderst

- **Kein SQL-Schema im Repo.** Alles zu Tabellen/Spalten in `README.md` ist
  aus den Supabase-Client-Queries im Code abgeleitet, nicht aus einer
  offiziellen Migration. Bei Unsicherheit im Zweifel den Nutzer fragen statt
  zu raten.
- **`src/components/GameList.tsx` ist aktuell toter Code** – nirgends
  importiert, nutzt teils Felder (`uploaded_at`, `games.icon`), die sonst im
  Projekt nicht vorkommen. Vor Wiederverwendung/Löschung mit dem Nutzer
  klären, das war absichtlich noch nicht entschieden.
- **`src/lib/saveDetector.ts`** ist die einzige aktive Save-Erkennung
  (fragt live gegen die `games`-Tabelle ab). Es gab früher eine parallele,
  mit hartcodierten (falschen) Werten inkonsistente Version
  (`saveDetection.ts`) — die wurde bereits entfernt. Keine neue,
  hartcodierte Erkennungslogik parallel dazu aufbauen.
- **Zwei Save-Slots pro Spiel** sind ein bewusstes Produktentscheidung
  (begrenzter Speicherplatz beim Nutzer, nicht "nur 2 implementiert, weil
  unfertig"), UI in `SlotView.tsx` iteriert über `[1, 2]`. **Nicht ändern.**
- **Versionsverlauf + Konfliktwarnung** (`SlotView.tsx`,
  `supabase/migrations/0001_save_versions_and_updated_at.sql`): Vor jedem
  Überschreiben eines Slots wird der alte Stand automatisch in
  `save_versions` gesichert (max. `MAX_VERSIONS_PER_SLOT`, aktuell 5, ältere
  werden gelöscht). Beim Hochladen wird `updated_at` gegen den zuletzt lokal
  bekannten Stand geprüft, um Konflikte durch parallele Geräte zu erkennen.
  Diese Logik lebt komplett in `snapshotToHistory()` / `uploadSave()` /
  `restoreVersion()` — beim Ändern der Upload-Logik immer alle drei
  zusammen betrachten, sonst brechen entweder Verlauf oder Konfliktwarnung.
- **Login-Gating**: `src/app/page.tsx` zeigt `SaveManager` nur bei
  eingeloggtem Nutzer (`user`-State via `supabase.auth.getUser()` +
  `onAuthStateChange`). Beim Ändern dieser Seite dieses Verhalten beibehalten.
- **ESLint-Regel `react-hooks/set-state-in-effect`** ist scharf gestellt
  (eslint-config-next 16, react-hooks 7). Datenladen in `useEffect` nach dem
  Ignore-Flag-Pattern umsetzen (Beispiel: `SlotView.tsx`), nicht eine
  `useCallback`-Funktion direkt im Effekt aufrufen und darin `setState`
  ausführen — das wird als Fehler geflaggt.
- Vor dem Abschluss einer Änderung immer `npm run lint` und
  `npx tsc --noEmit` laufen lassen; beides muss sauber durchlaufen.

## Wenn du unsicher bist, was im Repo aktuell existiert

Nicht vom Gedächtnis/vorherigen Chat-Verlauf ausgehen — den tatsächlichen
Dateibaum (`src/`, `scripts/`) neu einlesen. Der Code-Stand kann sich durch
parallele Sessions (z. B. Claude Code) zwischenzeitlich geändert haben.
