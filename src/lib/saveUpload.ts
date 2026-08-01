import { supabase } from "./supabase";
import { getDeviceName } from "./device";
import type { DetectedSave } from "./saveDetector";

export type Save = {
  id: string;
  slot: number;
  file_path: string;
  file_size: number;
  file_name?: string;
  note?: string | null;
  detected_platform?: string;
  detected_format?: string;
  detection_confidence?: number;
  detection_reasons?: string[];
  updated_at?: string;
  file_hash?: string | null;
  updated_by_device?: string | null;
  deleted_at?: string | null;
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
  file_hash?: string | null;
  device_label?: string | null;
};

// Wie viele alte Stände pro Slot behalten werden, bevor der älteste
// automatisch gelöscht wird (Speicherplatz ist begrenzt).
export const MAX_VERSIONS_PER_SLOT = 5;

// Wie lange ein gelöschter Save im Papierkorb bleibt, bevor er beim
// nächsten Öffnen der App automatisch endgültig gelöscht wird. Es gibt
// (bewusst, um keine zusätzliche Server-Infrastruktur zu brauchen) keinen
// serverseitigen Cronjob dafür - die Bereinigung passiert client-seitig
// beim Laden der Save-Übersicht, siehe purgeExpiredTrash().
export const TRASH_RETENTION_DAYS = 7;

export async function fetchSaves(gameId: string, userId: string): Promise<Save[]> {
  const { data, error } = await supabase
    .from("saves")
    .select("*")
    .eq("game_id", gameId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("slot");

  if (error) {
    console.error(error);
    return [];
  }

  return data ?? [];
}

export async function fetchTrash(gameId: string, userId: string): Promise<Save[]> {
  const { data, error } = await supabase
    .from("saves")
    .select("*")
    .eq("game_id", gameId)
    .eq("user_id", userId)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });

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
    .is("deleted_at", null)
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

export async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// Lädt eine Datei aus dem Storage herunter und stößt den Browser-Download
// an. Prüft dabei (falls vorhanden) die gespeicherte Prüfsumme gegen den
// tatsächlich heruntergeladenen Inhalt, um eine unbemerkt kaputte
// Übertragung zu erkennen.
export async function downloadFile(
  path: string,
  fileName: string,
  expectedHash?: string | null
): Promise<{ ok: true; hashMismatch: boolean } | { ok: false; error: string }> {
  const { data: blob, error } = await supabase.storage.from("saves").download(path);

  if (error || !blob) {
    return { ok: false, error: error?.message ?? "Download fehlgeschlagen" };
  }

  let hashMismatch = false;
  if (expectedHash) {
    const buffer = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    const actualHash = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    hashMismatch = actualHash !== expectedHash;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  return { ok: true, hashMismatch };
}

export async function updateNote(
  saveId: string,
  note: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("saves").update({ note }).eq("id", saveId);
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

// Verschiebt einen Save in den Papierkorb (nur DB-Flag, Storage bleibt
// unangetastet), statt ihn sofort endgültig zu löschen.
export async function softDeleteSave(
  save: Save
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase
    .from("saves")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", save.id);

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function restoreFromTrash(
  save: Save
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase
    .from("saves")
    .update({ deleted_at: null })
    .eq("id", save.id);

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

// Löscht einen Save unwiderruflich: Storage-Datei, kompletter Verlauf
// (Storage + DB) und die saves-Zeile selbst.
export async function permanentlyDeleteSave(
  save: Save
): Promise<{ ok: true } | { ok: false; error: string }> {
  const versions = await fetchVersions(save.id);
  const versionPaths = versions.map((version) => version.file_path);

  const { error: storageError } = await supabase.storage
    .from("saves")
    .remove([save.file_path, ...versionPaths]);

  if (storageError) {
    return { ok: false, error: storageError.message };
  }

  const { error: databaseError } = await supabase.from("saves").delete().eq("id", save.id);

  if (databaseError) {
    return { ok: false, error: databaseError.message };
  }

  return { ok: true };
}

// Räumt beim Laden der Übersicht beiläufig Papierkorb-Einträge auf, die
// älter als TRASH_RETENTION_DAYS sind. Es gibt keinen Server-Cronjob dafür
// (kein zusätzlicher Infrastruktur-Aufwand) - die Bereinigung passiert
// also nur, wenn die App tatsächlich geöffnet wird.
export async function purgeExpiredTrash(userId: string) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - TRASH_RETENTION_DAYS);

  const { data, error } = await supabase
    .from("saves")
    .select("*")
    .eq("user_id", userId)
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoff.toISOString());

  if (error || !data || data.length === 0) return;

  for (const save of data) {
    await permanentlyDeleteSave(save);
  }
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
    file_hash: existing.file_hash,
    device_label: existing.updated_by_device,
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

// Führt den eigentlichen Upload aus: erkennt unveränderte Duplikate,
// sichert einen evtl. vorhandenen Stand im Verlauf, lädt die neue Datei in
// den Storage und schreibt/aktualisiert die saves-Zeile. Enthält
// absichtlich KEINE Konflikt-Abfrage/Dialoge - die liegt bei den
// aufrufenden Komponenten, da die passende UX je nach Einstiegspunkt
// (SlotView vs. Schnell-Upload) unterschiedlich ist.
export async function performUpload({
  file,
  userId,
  gameId,
  gameName,
  slot,
  detection,
  freshExisting,
}: UploadParams): Promise<
  { ok: true; duplicate: boolean } | { ok: false; error: string }
> {
  const filePath = `${userId}/${gameId}/slot-${slot}`;
  const hash = await computeFileHash(file);

  // Duplikat-Erkennung: identische Datei (gleiche Größe + gleicher Hash)
  // wie der aktuell aktive Stand - nichts tun, keinen neuen Verlaufs-
  // eintrag anlegen, keinen unnötigen Storage-Traffic erzeugen.
  if (
    freshExisting &&
    freshExisting.file_hash &&
    freshExisting.file_hash === hash &&
    freshExisting.file_size === file.size
  ) {
    return { ok: true, duplicate: true };
  }

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
    // Notiz nur beim allerersten Anlegen automatisch setzen - bei einem
    // Update lassen wir eine vom Nutzer selbst vergebene Notiz unangetastet.
    ...(freshExisting ? {} : { note: gameName }),
    detected_platform: detection.platform,
    detected_format: detection.format,
    detection_confidence: detection.confidence,
    detection_reasons: detection.reasons,
    file_hash: hash,
    updated_by_device: getDeviceName(),
    deleted_at: null,
  };

  const { error: databaseError } = freshExisting
    ? await supabase.from("saves").update(payload).eq("id", freshExisting.id)
    : await supabase.from("saves").insert(payload);

  if (databaseError) {
    if (databaseError.code === "23505") {
      return {
        ok: false,
        error:
          "Dieser Slot wurde gerade eben von einem anderen Gerät belegt. " +
          "Bitte Seite neu laden und erneut versuchen.",
      };
    }
    return { ok: false, error: databaseError.message };
  }

  return { ok: true, duplicate: false };
}
