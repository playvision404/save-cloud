"use client";

import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { supabase } from "@/lib/supabase";
import { detectSave } from "@/lib/saveDetector";
import { useToast } from "@/components/ToastProvider";
import {
  MAX_VERSIONS_PER_SLOT,
  TRASH_RETENTION_DAYS,
  downloadFile,
  fetchSaves,
  fetchTrash,
  fetchVersions,
  performUpload,
  permanentlyDeleteSave,
  restoreFromTrash,
  snapshotToHistory,
  softDeleteSave,
  updateNote,
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
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);
  const [openHistorySlot, setOpenHistorySlot] = useState<number | null>(null);
  const [versionsBySlot, setVersionsBySlot] = useState<Record<number, SaveVersion[]>>({});
  const [loadingHistorySlot, setLoadingHistorySlot] = useState<number | null>(null);

  const [editingNoteSlot, setEditingNoteSlot] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const [trashOpen, setTrashOpen] = useState(false);
  const [trash, setTrash] = useState<Save[]>([]);
  const [loadingTrash, setLoadingTrash] = useState(false);
  const [trashActionId, setTrashActionId] = useState<string | null>(null);

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

  async function loadTrash() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    return fetchTrash(gameId, user.id);
  }

  async function toggleTrash() {
    if (trashOpen) {
      setTrashOpen(false);
      return;
    }

    setTrashOpen(true);
    setLoadingTrash(true);
    try {
      const result = await loadTrash();
      setTrash(result);
    } finally {
      setLoadingTrash(false);
    }
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

  async function handleDownload(path: string, fileName: string, hash?: string | null) {
    setDownloadingId(path);
    try {
      const result = await downloadFile(path, fileName, hash);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      if (result.hashMismatch) {
        showToast(
          "Achtung: Die heruntergeladene Datei stimmt nicht mit der gespeicherten " +
          "Prüfsumme überein. Bitte erneut herunterladen.",
        );
      }
    } finally {
      setDownloadingId(null);
    }
  }

  function startEditingNote(save: Save) {
    setEditingNoteSlot(save.slot);
    setNoteDraft(save.note ?? "");
  }

  async function saveNote(save: Save) {
    setSavingNote(true);
    try {
      const result = await updateNote(save.id, noteDraft);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      setEditingNoteSlot(null);
      await reloadSaves();
    } finally {
      setSavingNote(false);
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
        const geraet = freshExisting.updated_by_device ?? "einem anderen Gerät";
        const weiter = confirm(
          `Achtung: Dieser Slot wurde am ${zeitpunkt} von ${geraet} ` +
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

      if (result.duplicate) {
        showToast("Datei ist identisch mit dem aktuellen Stand — nichts geändert.", "success");
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
          file_hash: version.file_hash,
          updated_by_device: version.device_label,
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

  async function moveToTrash(save: Save) {
    if (
      !confirm(
        `Save in Slot ${save.slot} in den Papierkorb verschieben? ` +
        `Wird dort noch ${TRASH_RETENTION_DAYS} Tage aufbewahrt und kann ` +
        `in dieser Zeit wiederhergestellt werden.`
      )
    ) {
      return;
    }

    setDeletingSlot(save.slot);

    try {
      const result = await softDeleteSave(save);
      if (!result.ok) {
        showToast(result.error);
        return;
      }

      showToast(`Save in Slot ${save.slot} in den Papierkorb verschoben.`, "success");
      await reloadSaves();
    } finally {
      setDeletingSlot(null);
    }
  }

  async function handleRestoreFromTrash(save: Save) {
    setTrashActionId(save.id);
    try {
      const result = await restoreFromTrash(save);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      showToast("Save wiederhergestellt.", "success");
      setTrash((prev) => prev.filter((item) => item.id !== save.id));
      await reloadSaves();
    } finally {
      setTrashActionId(null);
    }
  }

  async function handlePermanentDelete(save: Save) {
    if (!confirm("Endgültig löschen? Das kann nicht rückgängig gemacht werden.")) {
      return;
    }

    setTrashActionId(save.id);
    try {
      const result = await permanentlyDeleteSave(save);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      showToast("Endgültig gelöscht.", "success");
      setTrash((prev) => prev.filter((item) => item.id !== save.id));
    } finally {
      setTrashActionId(null);
    }
  }

  return (
    <div className="mt-8 border rounded p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{gameName}</h2>
        <button className="text-sm text-gray-500 underline" onClick={toggleTrash}>
          {trashOpen ? "Papierkorb verbergen" : "Papierkorb"}
        </button>
      </div>

      {trashOpen && (
        <div className="mt-3 border rounded p-4 bg-gray-50">
          <p className="font-bold mb-2">Papierkorb</p>
          <p className="text-xs text-gray-500 mb-3">
            Einträge werden {TRASH_RETENTION_DAYS} Tage aufbewahrt und danach beim
            nächsten Öffnen der App automatisch endgültig gelöscht.
          </p>

          {loadingTrash && <p className="text-sm text-gray-500">Lädt Papierkorb...</p>}

          {!loadingTrash && trash.length === 0 && (
            <p className="text-sm text-gray-500">Papierkorb ist leer.</p>
          )}

          {!loadingTrash &&
            trash.map((save) => (
              <div key={save.id} className="flex items-center justify-between text-sm py-1">
                <span>
                  Slot {save.slot} — {save.file_name ?? "unbekannt"}
                  {save.deleted_at &&
                    ` (gelöscht am ${new Date(save.deleted_at).toLocaleDateString("de-DE")})`}
                </span>
                <span className="flex gap-3">
                  <button
                    className="text-blue-600 underline disabled:opacity-50"
                    disabled={trashActionId === save.id}
                    onClick={() => handleRestoreFromTrash(save)}
                  >
                    Wiederherstellen
                  </button>
                  <button
                    className="text-red-600 underline disabled:opacity-50"
                    disabled={trashActionId === save.id}
                    onClick={() => handlePermanentDelete(save)}
                  >
                    Endgültig löschen
                  </button>
                </span>
              </div>
            ))}
        </div>
      )}

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
          const isEditingNote = editingNoteSlot === slot;

          return (
            <div key={slot} className="border rounded p-4 mt-4">
              <h3 className="font-bold">Slot {slot}</h3>

              {save ? (
                <>
                  <p>{save.file_name}</p>
                  <p>🎮 {save.detected_platform ?? "unbekannt"}</p>
                  <p>💾 {save.detected_format ?? "-"}</p>
                  <p>🔍 {save.detection_confidence ?? 0}%</p>
                  {save.updated_by_device && (
                    <p className="text-xs text-gray-500">
                      Zuletzt von: {save.updated_by_device}
                    </p>
                  )}

                  {isEditingNote ? (
                    <div className="mt-2">
                      <input
                        className="border rounded p-1 w-full text-sm"
                        value={noteDraft}
                        onChange={(event) => setNoteDraft(event.target.value)}
                        placeholder="Notiz, z. B. 'vor Endboss'"
                      />
                      <div className="flex gap-3 mt-1">
                        <button
                          className="text-blue-600 underline text-sm disabled:opacity-50"
                          disabled={savingNote}
                          onClick={() => saveNote(save)}
                        >
                          Speichern
                        </button>
                        <button
                          className="text-gray-500 underline text-sm"
                          onClick={() => setEditingNoteSlot(null)}
                        >
                          Abbrechen
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm mt-1">
                      📝 {save.note || <span className="text-gray-400">keine Notiz</span>}{" "}
                      <button
                        className="text-blue-600 underline text-xs"
                        onClick={() => startEditingNote(save)}
                      >
                        bearbeiten
                      </button>
                    </p>
                  )}

                  <div className="flex gap-3 mt-2 flex-wrap">
                    <button
                      className="text-green-700 underline disabled:opacity-50"
                      disabled={downloadingId === save.file_path}
                      onClick={() =>
                        handleDownload(save.file_path, save.file_name ?? "save.sav", save.file_hash)
                      }
                    >
                      {downloadingId === save.file_path ? "Lädt..." : "Download"}
                    </button>

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
                      onClick={() => moveToTrash(save)}
                    >
                      {isDeleting ? "Verschiebt..." : "In Papierkorb"}
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
                              className="flex items-center justify-between text-sm gap-2"
                            >
                              <span>
                                {new Date(version.created_at).toLocaleString("de-DE")}
                                {" — "}
                                {version.file_name ?? "unbekannt"}
                                {version.device_label && ` (${version.device_label})`}
                              </span>

                              <span className="flex gap-3 shrink-0">
                                <button
                                  className="text-green-700 underline disabled:opacity-50"
                                  disabled={downloadingId === version.file_path}
                                  onClick={() =>
                                    handleDownload(
                                      version.file_path,
                                      version.file_name ?? "save.sav",
                                      version.file_hash
                                    )
                                  }
                                >
                                  Download
                                </button>
                                <button
                                  className="text-blue-600 underline disabled:opacity-50"
                                  disabled={restoringVersionId === version.id}
                                  onClick={() => restoreVersion(save, version)}
                                >
                                  {restoringVersionId === version.id
                                    ? "Stellt wieder her..."
                                    : "Wiederherstellen"}
                                </button>
                              </span>
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
