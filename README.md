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
- **Download**: Jeder Slot und jeder Verlaufs-Eintrag hat einen
  Download-Button (`downloadFile()` in `saveUpload.ts`). Prüft dabei die
  gespeicherte SHA-256-Prüfsumme gegen den heruntergeladenen Inhalt und
  warnt bei Abweichung (kaputte Übertragung).
- **Editierbare Notizen** pro Save (`saves.note`) — wird beim ersten
  Hochladen automatisch mit dem Spielnamen befüllt, danach vom Nutzer frei
  editierbar. Ein erneuter Upload überschreibt die Notiz **nicht** mehr.
- **Papierkorb statt Sofort-Löschen**: "In Papierkorb" setzt nur
  `saves.deleted_at`, Storage/Verlauf bleiben erhalten. Im Papierkorb
  (Toggle pro Spiel) lässt sich wiederherstellen oder endgültig löschen.
  Einträge älter als `TRASH_RETENTION_DAYS` (7 Tage) werden beim nächsten
  Öffnen der App automatisch endgültig gelöscht (`purgeExpiredTrash()` in
  `SaveManager.tsx`) — es gibt bewusst **keinen Server-Cronjob** dafür, um
  keine zusätzliche Infrastruktur zu brauchen. Das heißt: Wird die App
  länger nicht geöffnet, bleiben abgelaufene Papierkorb-Einträge bis zum
  nächsten Öffnen liegen (zählen bis dahin auch gegen das Speicherkontingent).
- **Duplikat-Erkennung**: Vor jedem Upload wird ein SHA-256-Hash der Datei
  berechnet. Ist er identisch mit dem aktuell aktiven Stand (gleiche Größe
  + gleicher Hash), passiert nichts — kein neuer Verlaufseintrag, kein
  Storage-Traffic.
- **Geräte-Kennung**: Beim ersten Upload fragt die App einmalig (via
  `window.prompt`, siehe `src/lib/device.ts`) nach einem Namen für das
  aktuelle Gerät, gespeichert in `localStorage`. Wird bei jedem Upload als
  `updated_by_device` mitgeschrieben, damit die Konfliktwarnung sagt
  "aktualisiert von AYN Thor" statt nur "von einem anderen Gerät".
- **Speicherplatz-Anzeige** (`src/components/StorageUsage.tsx`): zeigt
  genutzten vs. verfügbaren Speicher (`subscriptions.max_storage_bytes`,
  Free-Tier-Default 200 MB, automatisch bei Registrierung angelegt).
  Rechnet aktive Saves + Papierkorb + kompletten Verlauf mit ein, da all
  das im Storage-Bucket Platz belegt.
- **Passwort-Reset**: "Passwort vergessen?"-Link ruft
  `resetPasswordForEmail` auf; der Link in der E-Mail führt zurück auf die
  App, die den `PASSWORD_RECOVERY`-Auth-Event erkennt und ein Formular für
  ein neues Passwort zeigt (`src/app/page.tsx`).
- **Explizit NICHT gebaut**: automatischer Hintergrund-Sync (z. B. ein
  Watcher, der einen lokalen Batocera-Ordner beobachtet und automatisch
  hochlädt). Das ist technisch eine eigenständige native/CLI-Anwendung
  außerhalb eines Browsers und kein Feature, das in dieser Next.js-Web-App
  umsetzbar ist — bräuchte ein separates Projekt, das `performUpload()`
  aus `saveUpload.ts` als Bibliothek wiederverwenden könnte.
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

## Datenbank-Schema

Die SQL-Migrationen liegen unter `supabase/migrations/` (bereits live auf
Supabase angewendet). **Wichtig:** Nicht jede Spalte in der DB stammt aus
einer Migration in diesem Repo — im Verlauf der Entwicklung sind mehrfach
Spalten/Tabellen aufgetaucht, die extern (vermutlich über eine parallele
Claude-Code- oder Studio-Session direkt gegen Supabase) angelegt wurden,
bevor der passende Code oder eine Migrationsdatei dafür existierte
(`file_hash`, `updated_by_device`, `deleted_at` auf `saves`;
`save_detection_profiles`; `subscriptions`). Bei Unsicherheit über den
aktuellen Schema-Stand: über den Supabase-Connector `execute_sql` gegen
`information_schema.columns` prüfen, nicht auf die Migrationsdateien
alleine verlassen.

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
| `file_hash` | text, nullable — SHA-256 der Datei, für Duplikat-Erkennung + Integritätscheck beim Download |
| `updated_by_device` | text, nullable — Geräte-Name aus `localStorage` (siehe `src/lib/device.ts`) |
| `deleted_at` | timestamptz, nullable — Papierkorb-Flag; `null` = aktiv, gesetzt = im Papierkorb |

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
| `file_hash` | text, nullable — SHA-256 dieser Version |
| `device_label` | text, nullable — entspricht `saves.updated_by_device`, hier nur anders benannt |

**`subscriptions`** (jetzt aktiv genutzt für die Speicherplatz-Anzeige)
| Spalte | Typ |
|---|---|
| `user_id` | uuid/PK, FK → `auth.users.id` |
| `tier` | text, Default `'free'` |
| `max_slots` | int, Default `2` — **wird vom Code aktuell nicht gelesen**, die 2-Slot-Grenze ist weiterhin hart in `SlotView.tsx` + per CHECK-Constraint auf `saves.slot` kodiert |
| `max_storage_bytes` | bigint, Default `209715200` (200 MB) — wird von `StorageUsage.tsx` gelesen |
| `started_at` | timestamptz, Default `now()` |

Wird per DB-Trigger automatisch bei jeder Neuregistrierung angelegt
(`handle_new_user_subscription()`, siehe Migration `0004`).

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
  aktuellen Code-Pfad, Policy trotzdem nachgezogen in
  `supabase/migrations/0003_platforms_policy_and_docs.sql`.
- Storage-Bucket `saves` ist privat, mit Policies für SELECT/INSERT/DELETE
  **und UPDATE** (Update-Policy war ursprünglich vergessen — ohne sie
  schlägt jeder `upload(..., { upsert: true })` auf einen bereits
  existierenden Pfad fehl. Siehe
  `supabase/migrations/0002_storage_objects_allow_update.sql`).
- `save_detection_profiles` existiert weiterhin (Migration
  `add_save_detection_profiles`, nicht in diesem Repo enthalten, offenbar
  direkt in Supabase Studio erstellt), wird aber vom Frontend-Code
  weiterhin **nicht** verwendet (siehe `COMMENT ON TABLE` aus Migration
  `0003`). `subscriptions` wird inzwischen für `max_storage_bytes`
  aktiv genutzt (Speicherplatz-Anzeige) — `max_slots` bleibt weiterhin
  ungenutzt, die 2-Slot-Grenze ist bewusst hart kodiert.

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
