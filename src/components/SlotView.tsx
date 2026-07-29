"use client";

import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { supabase } from "@/lib/supabase";
import { detectSave } from "@/lib/saveDetector";

type Props = {
  gameId: string;
  gameName: string;
};

type Save = {
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

type SaveVersion = {
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
const MAX_VERSIONS_PER_SLOT = 5;

export default function SlotView({ gameId, gameName }: Props) {
  const [saves, setSaves] = useState<Save[]>([]);
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);
  const [deletingSlot, setDeletingSlot] = useState<number | null>(null);
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);
  const [openHistorySlot, setOpenHistorySlot] = useState<number | null>(null);
  const [versionsBySlot, setVersionsBySlot] = useState<Record<number, SaveVersion[]>>({});
  const [loadingHistorySlot, setLoadingHistorySlot] = useState<number | null>(null);

  async function fetchSaves(currentGameId: string) {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return [];
    }

    const { data, error } = await supabase
      .from("saves")
      .select("*")
      .eq("game_id", currentGameId)
      .eq("user_id", user.id)
      .order("slot");

    if (error) {
      console.error(error);
      return [];
    }

    return data ?? [];
  }

  useEffect(() => {
    let ignore = false;

    fetchSaves(gameId).then((result) => {
      if (!ignore) {
        setSaves(result);
      }
    });

    return () => {
      ignore = true;
    };
  }, [gameId]);

  async function reloadSaves() {
    const result = await fetchSaves(gameId);
    setSaves(result);
  }

  async function fetchVersions(saveId: string) {
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

  async function toggleHistory(save: Save) {
    if (openHistorySlot === save.slot) {
      setOpenHistorySlot(null);
      return;
    }

    setOpenHistorySlot(save.slot);
    setLoadingHistorySlot(save.slot);

    try {
      const versions = await fetchVersions(save.id);
      setVersionsBySlot((prev) => ({ ...prev, [save.slot]: versions }));
    } finally {
      setLoadingHistorySlot(null);
    }
  }

  // Sichert den aktuell aktiven Storage-Stand eines Slots als Verlaufs-
  // Eintrag, BEVOR er überschrieben wird, und löscht überzählige alte
  // Versionen (mehr als MAX_VERSIONS_PER_SLOT werden nicht behalten).
  async function snapshotToHistory(existing: Save) {
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

  async function uploadSave(event: ChangeEvent<HTMLInputElement>, slot: number) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const detection = await detectSave(file);

    if (detection.gameId && detection.confidence >= 80 && detection.gameId !== gameId) {
      alert(`Diese Datei sieht nach ${detection.gameName} aus.`);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      alert("Login erforderlich");
      return;
    }

    const localExisting = saves.find((item) => item.slot === slot);

    // Konfliktprüfung: frischen Stand aus der DB holen und mit dem
    // Stand vergleichen, den diese Seite zuletzt geladen hat. Weicht er
    // ab, hat vermutlich ein anderes Gerät zwischenzeitlich etwas
    // hochgeladen.
    let freshExisting: Save | null = null;

    if (localExisting) {
      const { data: freshRow, error: freshError } = await supabase
        .from("saves")
        .select("*")
        .eq("id", localExisting.id)
        .single();

      if (freshError) {
        alert(freshError.message);
        return;
      }

      freshExisting = freshRow;

      if (
        freshExisting?.updated_at &&
        localExisting.updated_at &&
        freshExisting.updated_at !== localExisting.updated_at
      ) {
        const zeitpunkt = new Date(freshExisting.updated_at).toLocaleString("de-DE");
        const weiter = confirm(
          `Achtung: Dieser Slot wurde am ${zeitpunkt} von einem anderen Gerät ` +
          `aktualisiert (${freshExisting.file_name ?? "unbekannte Datei"}).\n\n` +
          `Trotzdem mit deiner Datei überschreiben? Der andere Stand wird ` +
          `automatisch im Verlauf gesichert.`
        );

        if (!weiter) {
          await reloadSaves();
          return;
        }
      }
    }

    setUploadingSlot(slot);

    try {
      // Stabiler Pfad pro Slot (ohne Originaldateiname), damit ein erneuter
      // Upload die alte Datei im Storage sauber überschreibt statt eine
      // zusätzliche, verwaiste Datei zu erzeugen.
      const filePath = `${user.id}/${gameId}/slot-${slot}`;

      if (freshExisting) {
        try {
          const versions = await snapshotToHistory(freshExisting);
          setVersionsBySlot((prev) => ({ ...prev, [slot]: versions }));
        } catch (snapshotError) {
          alert((snapshotError as Error).message);
          return;
        }
      }

      const { error: uploadError } = await supabase.storage
        .from("saves")
        .upload(filePath, file, { upsert: true });

      if (uploadError) {
        alert(uploadError.message);
        return;
      }

      const payload = {
        user_id: user.id,
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

      // Existiert bereits ein Save für diesen Slot, wird er aktualisiert
      // (per ID) statt einen zweiten Datenbankeintrag anzulegen.
      const { error: databaseError } = freshExisting
        ? await supabase.from("saves").update(payload).eq("id", freshExisting.id)
        : await supabase.from("saves").insert(payload);

      if (databaseError) {
        alert(databaseError.message);
        return;
      }

      await reloadSaves();
    } finally {
      setUploadingSlot(null);
    }
  }

  async function restoreVersion(save: Save, version: SaveVersion) {
    if (
      !confirm(
        `Stand vom ${new Date(version.created_at).toLocaleString("de-DE")} ` +
        `wiederherstellen? Der aktuelle Stand wird vorher automatisch im ` +
        `Verlauf gesichert.`
      )
    ) {
      return;
    }

    setRestoringVersionId(version.id);

    try {
      // Aktuellen Stand zuerst sichern, damit beim Wiederherstellen
      // nichts verloren geht.
      const versions = await snapshotToHistory(save);
      setVersionsBySlot((prev) => ({ ...prev, [save.slot]: versions }));

      const { data: blob, error: downloadError } = await supabase.storage
        .from("saves")
        .download(version.file_path);

      if (downloadError || !blob) {
        alert(downloadError?.message ?? "Version konnte nicht geladen werden");
        return;
      }

      const { error: uploadError } = await supabase.storage
        .from("saves")
        .upload(save.file_path, blob, { upsert: true });

      if (uploadError) {
        alert(uploadError.message);
        return;
      }

      const { error: databaseError } = await supabase
        .from("saves")
        .update({
          file_size: version.file_size,
          file_name: version.file_name,
          detected_platform: version.detected_platform,
          detected_format: version.detected_format,
          detection_confidence: version.detection_confidence,
          detection_reasons: version.detection_reasons,
        })
        .eq("id", save.id);

      if (databaseError) {
        alert(databaseError.message);
        return;
      }

      await reloadSaves();
      const refreshedVersions = await fetchVersions(save.id);
      setVersionsBySlot((prev) => ({ ...prev, [save.slot]: refreshedVersions }));
    } finally {
      setRestoringVersionId(null);
    }
  }

  async function deleteSave(save: Save) {
    if (!confirm(`Save in Slot ${save.slot} wirklich löschen? Der gesamte Verlauf wird mitgelöscht.`)) {
      return;
    }

    setDeletingSlot(save.slot);

    try {
      const versions = await fetchVersions(save.id);
      const versionPaths = versions.map((version) => version.file_path);

      const { error: storageError } = await supabase.storage
        .from("saves")
        .remove([save.file_path, ...versionPaths]);

      if (storageError) {
        alert(storageError.message);
        return;
      }

      // save_versions-Zeilen werden per "on delete cascade" automatisch
      // mitgelöscht, sobald die saves-Zeile gelöscht wird.
      const { error: databaseError } = await supabase
        .from("saves")
        .delete()
        .eq("id", save.id);

      if (databaseError) {
        alert(databaseError.message);
        return;
      }

      setVersionsBySlot((prev) => {
        const next = { ...prev };
        delete next[save.slot];
        return next;
      });

      await reloadSaves();
    } finally {
      setDeletingSlot(null);
    }
  }

  return (
    <div className="mt-8 border rounded p-5">
      <h2 className="text-2xl font-bold">{gameName}</h2>

      {[1, 2].map((slot) => {
        const save = saves.find((item) => item.slot === slot);
        const isUploading = uploadingSlot === slot;
        const isDeleting = deletingSlot === slot;
        const historyOpen = openHistorySlot === slot;
        const versions = versionsBySlot[slot] ?? [];
        const historyLoading = loadingHistorySlot === slot;

        return (
          <div key={slot} className="border rounded p-4 mt-4">
            <h3 className="font-bold">Slot {slot}</h3>

            {save ? (
              <>
                <p>{save.file_name}</p>
                <p>🎮 {save.detected_platform ?? "unbekannt"}</p>
                <p>💾 {save.detected_format ?? "-"}</p>
                <p>🔍 {save.detection_confidence ?? 0}%</p>

                <div className="flex gap-3 mt-2">
                  <label className="cursor-pointer text-blue-600 underline">
                    {isUploading ? "Lädt hoch..." : "Ersetzen"}
                    <input
                      hidden
                      type="file"
                      disabled={isUploading || isDeleting}
                      onChange={(event) => uploadSave(event, slot)}
                    />
                  </label>

                  <button
                    className="text-red-600 underline disabled:opacity-50"
                    disabled={isUploading || isDeleting}
                    onClick={() => deleteSave(save)}
                  >
                    {isDeleting ? "Löscht..." : "Löschen"}
                  </button>

                  <button
                    className="text-gray-700 underline disabled:opacity-50"
                    disabled={isUploading || isDeleting}
                    onClick={() => toggleHistory(save)}
                  >
                    {historyOpen ? "Verlauf verbergen" : "Verlauf"}
                  </button>
                </div>

                {historyOpen && (
                  <div className="mt-3 border-t pt-3">
                    {historyLoading && <p className="text-sm text-gray-500">Lädt Verlauf...</p>}

                    {!historyLoading && versions.length === 0 && (
                      <p className="text-sm text-gray-500">
                        Noch keine älteren Stände für diesen Slot.
                      </p>
                    )}

                    {!historyLoading && versions.length > 0 && (
                      <ul className="space-y-2">
                        {versions.map((version) => (
                          <li
                            key={version.id}
                            className="flex items-center justify-between text-sm"
                          >
                            <span>
                              {new Date(version.created_at).toLocaleString("de-DE")}
                              {" — "}
                              {version.file_name ?? "unbekannt"}
                            </span>

                            <button
                              className="text-blue-600 underline disabled:opacity-50"
                              disabled={restoringVersionId === version.id}
                              onClick={() => restoreVersion(save, version)}
                            >
                              {restoringVersionId === version.id
                                ? "Stellt wieder her..."
                                : "Wiederherstellen"}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    <p className="text-xs text-gray-400 mt-2">
                      Es werden maximal {MAX_VERSIONS_PER_SLOT} ältere Stände pro Slot behalten.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <label className="cursor-pointer">
                {isUploading ? "Lädt hoch..." : "Save hochladen"}
                <input
                  hidden
                  type="file"
                  disabled={isUploading}
                  onChange={(event) => uploadSave(event, slot)}
                />
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}
