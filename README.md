# Emulator Save Cloud

Ein Next.js + Supabase Projekt zum zentralen Sichern und Synchronisieren von
Emulator-Spielständen (`.sav`, `.srm`, `.state`, `.mcr`, ...) über verschiedene
Geräte hinweg. Statt Saves manuell per USB/SD-Karte zwischen Handheld, PC und
Retro-Konsolen-Emulatoren hin- und herzuschieben, lädt man sie hier hoch und
kann sie von überall wieder herunterladen.

## Tech-Stack

- **Next.js 16** (App Router, Turbopack) + React 19 + TypeScript
- **Supabase** für Auth (E-Mail/Passwort), Postgres-Datenbank und Storage
  (Bucket `saves`)
- **Tailwind CSS 4** fürs Styling
- Deployment ist auf **Netlify** vorgesehen (Zero-Upfront-Cost-Architektur:
  Next.js + Supabase Free Tier)

## Funktionsumfang (Stand: aktueller Code)

- Registrierung/Login per E-Mail + Passwort (`src/app/page.tsx`,
  `src/components/AuthStatus.tsx`)
- Plattform- und Spielauswahl (`PlatformSelector.tsx`, `GameSelector.tsx`),
  gespeist aus der `games`-Tabelle
- Pro Spiel gibt es **2 Save-Slots** (`SlotView.tsx`, bewusst fix — der
  Nutzer hat begrenzten Speicherplatz). Man kann pro Slot hochladen,
  ersetzen und löschen (Storage + DB-Zeile werden dabei synchron gehalten)
- **Versionsverlauf**: Vor jedem Überschreiben eines Slots wird der bisherige
  Stand automatisch als Verlaufs-Eintrag gesichert (`save_versions`-Tabelle
  + kopierte Datei im Storage). Es werden maximal
  `MAX_VERSIONS_PER_SLOT` (aktuell 5) alte Stände pro Slot behalten, ältere
  werden beim nächsten Upload automatisch gelöscht. Über "Verlauf" pro Slot
  lassen sich alte Stände einsehen und per "Wiederherstellen" zurückholen
  (der aktuelle Stand wird dabei ebenfalls zuerst gesichert, es geht also
  nichts verloren).
- **Konfliktwarnung**: Beim Hochladen wird der Slot frisch aus der DB
  geladen und dessen `updated_at` mit dem zuletzt lokal geladenen Stand
  verglichen. Weicht er ab (z. B. weil ein anderes Gerät zwischenzeitlich
  etwas hochgeladen hat), wird vor dem Überschreiben gewarnt.
- Automatische Save-Erkennung beim Upload (`src/lib/saveDetector.ts`):
  kombiniert Dateiendung, Dateigröße, Dateiname-Aliase und einen groben
  Blick in die ersten 256 Bytes der Datei, um Spiel/Plattform zu raten und
  eine Konfidenz (0–100 %) zu berechnen. Bei einer eindeutigen
  Fehlerkennung (≥80 % Konfidenz, aber falsches Spiel) wird der Upload
  mit einer Warnung abgebrochen.
- **Schnell-Upload** (`src/components/QuickUpload.tsx`): eigenes Upload-Feld
  oberhalb der klassischen Konsole→Spiel-Auswahl. Datei per Klick oder
  Drag & Drop auswählen, Erkennung schlägt automatisch ein Spiel vor
  (ab `AUTO_SELECT_CONFIDENCE`, aktuell 40 %). Der Vorschlag lässt sich
  über eine Suchleiste (Name/Plattform/Alias) manuell korrigieren oder
  ganz ohne Erkennung ein Spiel auswählen. Anschließend Slot wählen —
  dieselbe Verlaufs-/Überschreib-Logik wie in `SlotView.tsx` kommt zum
  Einsatz (beide teilen sich `src/lib/saveUpload.ts`). Nach dem Upload kann
  optional direkt zur Konsole/Spiel-Ansicht gesprungen werden.
- `src/lib/saveUpload.ts` bündelt die Upload-/Verlaufs-Logik
  (`fetchSaves`, `fetchSaveForSlot`, `snapshotToHistory`, `performUpload`),
  die von `SlotView.tsx` und `QuickUpload.tsx` gemeinsam genutzt wird.
  Neue Upload-Einstiegspunkte sollten diese Funktionen wiederverwenden statt
  eigene Kopien der Logik zu bauen.
- **Fehler-/Erfolgsmeldungen** laufen über ein leichtgewichtiges Toast-System
  (`src/components/ToastProvider.tsx`, im Root-Layout eingebunden). Alle
  Komponenten nutzen `useToast()` statt `alert()`. Bestätigungs-Dialoge
  ("wirklich löschen?", "wirklich überschreiben?") bleiben bewusst als
  natives `confirm()` — das sind Ja/Nein-Entscheidungen, keine reinen
  Meldungen.
- `src/components/GameList.tsx` existiert im Code, ist aber aktuell
  **nirgends eingebunden** (kein Import in `page.tsx`/`SaveManager.tsx`).
  Gedacht offenbar als "alle meine Saves auf einen Blick"-Übersicht mit
  Download-Funktion über `createSignedUrl`. Nutzt Felder (`uploaded_at`,
  `games.icon`), die sonst im Projekt nicht verwendet werden – vor
  Wiederverwendung prüfen, ob diese Spalten wirklich existieren.
- `scripts/importGames.ts`: Node-Skript (via `tsx`) zum Befüllen der
  `games`-Tabelle aus `games.json`. Braucht `SUPABASE_SERVICE_ROLE_KEY` in
  `.env.local`. Kein npm-Script dafür hinterlegt, manuell ausführen:
  `npx tsx scripts/importGames.ts`

## Datenbank-Schema (aus dem Code erschlossen)

Es liegt **keine SQL-Migrationsdatei im Repo** – das folgende Schema ist aus
den tatsächlichen Supabase-Queries im Code rekonstruiert und sollte vor
produktivem Einsatz gegen den echten Supabase-Stand geprüft/ergänzt werden
(insbesondere Row-Level-Security-Policies!).

**`platforms`**
| Spalte | Typ (vermutet) |
|---|---|
| `id` | uuid/PK |
| `name` | text |

**`games`**
| Spalte | Typ (vermutet) |
|---|---|
| `id` | uuid/PK |
| `name` | text |
| `platform` | text (redundant zu `platform_id`, wird für Anzeige/Filter genutzt) |
| `platform_id` | uuid, FK → `platforms.id` |
| `aliases` | text[] |
| `file_extensions` | text[] (inkl. Punkt, z. B. `.sav`) |
| `save_sizes` | int[] (Bytes) |

**`saves`**
| Spalte | Typ (vermutet) |
|---|---|
| `id` | uuid/PK |
| `user_id` | uuid, FK → `auth.users.id` |
| `game_id` | uuid, FK → `games.id` |
| `slot` | int (1 oder 2) |
| `file_path` | text (Pfad im Storage-Bucket `saves`) |
| `file_size` | int |
| `file_name` | text |
| `note` | text |
| `detected_platform` | text, nullable |
| `detected_format` | text, nullable |
| `detection_confidence` | int, nullable |
| `detection_reasons` | text[], nullable |
| `uploaded_at` | timestamptz (nur von `GameList.tsx` gelesen — Default `now()` vermutet) |
| `updated_at` | timestamptz, wird per DB-Trigger automatisch bei jedem Update gesetzt (siehe Migration) — Basis für die Konfliktwarnung |

**`save_versions`** (Verlaufstabelle, siehe Migration)
| Spalte | Typ |
|---|---|
| `id` | uuid/PK |
| `save_id` | uuid, FK → `saves.id` (on delete cascade) |
| `user_id` | uuid, FK → `auth.users.id` |
| `game_id` | uuid, FK → `games.id` |
| `slot` | int |
| `file_path` | text (Pfad der historischen Datei im `saves`-Bucket) |
| `file_size` | int |
| `file_name` | text |
| `detected_platform` / `detected_format` / `detection_confidence` / `detection_reasons` | wie bei `saves` |
| `created_at` | timestamptz, Default `now()` |

Die SQL-Migrationen liegen unter `supabase/migrations/` und sind bereits
live auf dem Supabase-Projekt angewendet (Stand: aktuelles Repo).

**Tatsächlich verifizierter DB-Stand (direkt per Supabase-Connector geprüft,
nicht nur aus dem Code geraten):**
- `saves` hat einen `UNIQUE (user_id, game_id, slot)`-Constraint und
  `CHECK (slot >= 1 AND slot <= 2)` — die 2-Slot-Grenze ist also auch auf
  DB-Ebene erzwungen, nicht nur im Frontend.
- `saves`, `games`, `save_versions`, `subscriptions` haben RLS mit
  Policies, die Zugriff auf `auth.uid() = user_id` beschränken.
  Ausnahme: `games` hat zusätzlich eine öffentliche Lese-Policy (jede:r darf
  alle Spiele sehen, nicht nur eigene) — vermutlich beabsichtigt, da
  `games.json` zentral importierte Spiele enthält.
- `platforms` hatte RLS aktiviert, aber **keine einzige Policy** → war
  dadurch für niemanden außer der Service-Role lesbar. Betrifft keinen
  aktuellen Code-Pfad (das Frontend liest Plattformen über `games.platform`,
  nicht über die `platforms`-Tabelle direkt), Policy trotzdem nachgezogen
  in `supabase/migrations/0003_platforms_policy_and_docs.sql`.
- Storage-Bucket `saves` ist privat, mit Policies für SELECT/INSERT/DELETE
  **und UPDATE** (Update-Policy war ursprünglich vergessen — ohne sie
  schlägt jeder `upload(..., { upsert: true })` auf einen bereits
  existierenden Pfad fehl, z. B. "Ersetzen" eines Slots oder das
  Zurückschreiben beim Wiederherstellen. Siehe
  `supabase/migrations/0002_storage_objects_allow_update.sql`).
- Es existiert außerdem eine `save_detection_profiles`-Tabelle (Migration
  `add_save_detection_profiles`, nicht in diesem Repo enthalten, offenbar
  direkt in Supabase Studio erstellt) und eine `subscriptions`-Tabelle mit
  `tier`/`max_slots` (Default: `free`/`2`) — beide existieren in der DB,
  werden aber vom aktuellen Frontend-Code **nicht** verwendet. Direkt in
  der DB per `COMMENT ON TABLE` dokumentiert (siehe Migration `0003`),
  damit das nicht wieder in Vergessenheit gerät.

## Entwicklung

```bash
npm install
npm run dev       # http://localhost:3000
npm run lint
npx tsc --noEmit
```

Benötigt `.env.local` mit:
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # nur für scripts/importGames.ts
```
