import { supabase } from "./supabase";
import type { DetectedSave } from "./saveDetector";

export type Save = {
  id: string;
  slot: number;
  file_path: string;
  file_size: number;
  file_name?: string;
  detected_platform?: string;
  detected_format?: string;
  detection_confidence?: number;
  detection_reasons?: string[];
  updated_at?: string;
};

export type SaveVersion = {
  id: string;
  save_id: string;
  slot: number;
  file_path: string;
  file_size: number;
  file_name?: string;
  detected_platform?: string;
  detected_format?: string;
  detection_confidence?: number;
  detection_reasons?: string[];
  created_at: string;
};

// Wie viele alte Stände pro Slot behalten werden, bevor der älteste
// automatisch gelöscht wird (Speicherplatz ist begrenzt).
export const MAX_VERSIONS_PER_SLOT = 5;

export async function fetchSaves(gameId: string, userId: string): Promise<Save[]> {
  const { data, error } = await supabase
    .from("saves")
    .select("*")
    .eq("game_id", gameId)
    .eq("user_id", userId)
    .order("slot");

  if (error) {
    console.error(error);
    return [];
  }

  return data ?? [];
}

export async function fetchSaveForSlot(
  gameId: string,
  userId: string,
  slot: number
): Promise<Save | null> {
  const { data, error } = await supabase
    .from("saves")
    .select("*")
    .eq("game_id", gameId)
    .eq("user_id", userId)
    .eq("slot", slot)
    .maybeSingle();

  if (error) {
    console.error(error);
    return null;
  }

  return data;
}

export async function fetchVersions(saveId: string): Promise<SaveVersion[]> {
  const { data, error } = await supabase
    .from("save_versions")
    .select("*")
    .eq("save_id", saveId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return [];
  }

  return data ?? [];
}

// Sichert den aktuell aktiven Storage-Stand eines Slots als Verlaufs-
// Eintrag, BEVOR er überschrieben wird, und löscht überzählige alte
// Versionen (mehr als MAX_VERSIONS_PER_SLOT werden nicht behalten).
export async function snapshotToHistory(
  existing: Save,
  gameId: string
): Promise<SaveVersion[]> {
  const versionPath = `${existing.file_path}/versions/${Date.now()}`;

  const { error: copyError } = await supabase.storage
    .from("saves")
    .copy(existing.file_path, versionPath);

  if (copyError) {
    throw new Error(`Verlauf konnte nicht gesichert werden: ${copyError.message}`);
  }

  const { data: { user } } = await supabase.auth.getUser();

  const { error: insertError } = await supabase.from("save_versions").insert({
    save_id: existing.id,
    user_id: user?.id,
    game_id: gameId,
    slot: existing.slot,
    file_path: versionPath,
    file_size: existing.file_size,
    file_name: existing.file_name,
    detected_platform: existing.detected_platform,
    detected_format: existing.detected_format,
    detection_confidence: existing.detection_confidence,
    detection_reasons: existing.detection_reasons,
  });

  if (insertError) {
    throw new Error(`Verlauf konnte nicht gesichert werden: ${insertError.message}`);
  }

  const allVersions = await fetchVersions(existing.id);
  const surplus = allVersions.slice(MAX_VERSIONS_PER_SLOT);

  for (const old of surplus) {
    await supabase.storage.from("saves").remove([old.file_path]);
    await supabase.from("save_versions").delete().eq("id", old.id);
  }

  return allVersions.slice(0, MAX_VERSIONS_PER_SLOT);
}

type UploadParams = {
  file: File;
  userId: string;
  gameId: string;
  gameName: string;
  slot: number;
  detection: DetectedSave;
  // Bereits frisch aus der DB geladener, aktuell aktiver Save für diesen
  // Slot (null, falls der Slot noch leer ist). Muss unmittelbar vor dem
  // Aufruf frisch geladen worden sein, siehe fetchSaveForSlot().
  freshExisting: Save | null;
};

// Führt den eigentlichen Upload aus: sichert einen evtl. vorhandenen Stand
// im Verlauf, lädt die neue Datei in den Storage und schreibt/aktualisiert
// die saves-Zeile. Enthält absichtlich KEINE Konflikt-Abfrage/Dialoge -
// die liegt bei den aufrufenden Komponenten, da die passende UX je nach
// Einstiegspunkt (SlotView vs. Schnell-Upload) unterschiedlich ist.
export async function performUpload({
  file,
  userId,
  gameId,
  gameName,
  slot,
  detection,
  freshExisting,
}: UploadParams): Promise<{ ok: true } | { ok: false; error: string }> {
  const filePath = `${userId}/${gameId}/slot-${slot}`;

  if (freshExisting) {
    try {
      await snapshotToHistory(freshExisting, gameId);
    } catch (snapshotError) {
      return { ok: false, error: (snapshotError as Error).message };
    }
  }

  const { error: uploadError } = await supabase.storage
    .from("saves")
    .upload(filePath, file, { upsert: true });

  if (uploadError) {
    return { ok: false, error: uploadError.message };
  }

  const payload = {
    user_id: userId,
    game_id: gameId,
    slot,
    file_path: filePath,
    file_size: file.size,
    file_name: file.name,
    note: gameName,
    detected_platform: detection.platform,
    detected_format: detection.format,
    detection_confidence: detection.confidence,
    detection_reasons: detection.reasons,
  };

  const { error: databaseError } = freshExisting
    ? await supabase.from("saves").update(payload).eq("id", freshExisting.id)
    : await supabase.from("saves").insert(payload);

  if (databaseError) {
    return { ok: false, error: databaseError.message };
  }

  return { ok: true };
}
