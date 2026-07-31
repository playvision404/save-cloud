"use client";

import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { supabase } from "@/lib/supabase";
import { detectSave } from "@/lib/saveDetector";
import { useToast } from "@/components/ToastProvider";
import {
  MAX_VERSIONS_PER_SLOT,
  fetchSaves,
  fetchVersions,
  performUpload,
  snapshotToHistory,
} from "@/lib/saveUpload";
import type { Save, SaveVersion } from "@/lib/saveUpload";

type Props = {
  gameId: string;
  gameName: string;
};

export default function SlotView({ gameId, gameName }: Props) {
  const { showToast } = useToast();

  const [saves, setSaves] = useState<Save[]>([]);
  const [loadingSaves, setLoadingSaves] = useState(true);
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);
  const [deletingSlot, setDeletingSlot] = useState<number | null>(null);
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);
  const [openHistorySlot, setOpenHistorySlot] = useState<number | null>(null);
  const [versionsBySlot, setVersionsBySlot] = useState<Record<number, SaveVersion[]>>({});
  const [loadingHistorySlot, setLoadingHistorySlot] = useState<number | null>(null);

  async function loadSaves(currentGameId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    return fetchSaves(currentGameId, user.id);
  }

  useEffect(() => {
    let ignore = false;

    async function run() {
      setLoadingSaves(true);
      const { data: { user } } = await supabase.auth.getUser();
      const result = user ? await fetchSaves(gameId, user.id) : [];
      if (!ignore) {
        setSaves(result);
        setLoadingSaves(false);
      }
    }

    run();

    return () => {
      ignore = true;
    };
  }, [gameId]);

  async function reloadSaves() {
    const result = await loadSaves(gameId);
    setSaves(result);
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

  async function uploadSave(event: ChangeEvent<HTMLInputElement>, slot: number) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const detection = await detectSave(file);

    if (detection.gameId && detection.confidence >= 80 && detection.gameId !== gameId) {
      showToast(`Diese Datei sieht nach ${detection.gameName} aus.`);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      showToast("Login erforderlich");
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
        showToast(freshError.message);
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
      const result = await performUpload({
        file,
        userId: user.id,
        gameId,
        gameName,
        slot,
        detection,
        freshExisting,
      });

      if (!result.ok) {
        showToast(result.error);
        if (!freshExisting) {
          // Möglicherweise wurde der Slot durch eine Race Condition
          // gerade belegt (Unique-Constraint-Fehler) - Stand neu laden,
          // damit die UI nicht veraltet bleibt.
          await reloadSaves();
        }
        return;
      }

      if (freshExisting) {
        const versions = await fetchVersions(freshExisting.id);
        setVersionsBySlot((prev) => ({ ...prev, [slot]: versions }));
      }

      showToast(`"${file.name}" wurde in Slot ${slot} gespeichert.`, "success");
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
      const versions = await snapshotToHistory(save, gameId);
      setVersionsBySlot((prev) => ({ ...prev, [save.slot]: versions }));

      const { data: blob, error: downloadError } = await supabase.storage
        .from("saves")
        .download(version.file_path);

      if (downloadError || !blob) {
        showToast(downloadError?.message ?? "Version konnte nicht geladen werden");
        return;
      }

      const { error: uploadError } = await supabase.storage
        .from("saves")
        .upload(save.file_path, blob, { upsert: true });

      if (uploadError) {
        showToast(uploadError.message);
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
        showToast(databaseError.message);
        return;
      }

      showToast("Stand wiederhergestellt.", "success");
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
        showToast(storageError.message);
        return;
      }

      // save_versions-Zeilen werden per "on delete cascade" automatisch
      // mitgelöscht, sobald die saves-Zeile gelöscht wird.
      const { error: databaseError } = await supabase
        .from("saves")
        .delete()
        .eq("id", save.id);

      if (databaseError) {
        showToast(databaseError.message);
        return;
      }

      setVersionsBySlot((prev) => {
        const next = { ...prev };
        delete next[save.slot];
        return next;
      });

      showToast(`Save in Slot ${save.slot} gelöscht.`, "success");
      await reloadSaves();
    } finally {
      setDeletingSlot(null);
    }
  }

  return (
    <div className="mt-8 border rounded p-5">
      <h2 className="text-2xl font-bold">{gameName}</h2>

      {loadingSaves ? (
        <p className="text-sm text-gray-500 mt-3">Lädt Saves...</p>
      ) : (
        [1, 2].map((slot) => {
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
        })
      )}
    </div>
  );
}
