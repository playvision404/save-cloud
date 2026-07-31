-- Aufräumen: fehlende platforms-Policy nachtragen + unbenutzte Tabellen
-- direkt in der DB dokumentieren, damit niemand fälschlich annimmt, sie
-- wären schon ans Frontend angebunden.

-- platforms hatte RLS aktiviert, aber keine einzige Policy - war dadurch
-- für niemanden außer der Service-Role lesbar. Aktuell nutzt kein
-- Code-Pfad diese Tabelle direkt (das Frontend liest Plattformen über
-- games.platform), aber die Lücke sollte trotzdem nicht bestehen bleiben.
create policy "Alle duerfen Plattformen lesen"
  on public.platforms for select
  using (true);

comment on table public.save_detection_profiles is
  'Noch nicht vom Frontend genutzt (Stand: 2026-07-30). saveDetector.ts fragt '
  'stattdessen live gegen die games-Tabelle ab. Vor Verwendung mit dem Projekt-'
  'Owner klären, ob dies die geplante Ablösung der Erkennungslogik ist.';

comment on table public.subscriptions is
  'Noch nicht vom Frontend genutzt (Stand: 2026-07-30). Die 2-Slot-Grenze ist '
  'aktuell hart in SlotView.tsx sowie per CHECK-Constraint auf saves.slot '
  'kodiert, liest max_slots aus dieser Tabelle nicht. Für ein Tarif-Modell '
  'müsste beides verknüpft werden.';
