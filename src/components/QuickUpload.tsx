"use client";

import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { supabase } from "@/lib/supabase";
import { detectSave } from "@/lib/saveDetector";
import type { DetectedSave } from "@/lib/saveDetector";
import { useToast } from "@/components/ToastProvider";
import { fetchSaveForSlot, performUpload } from "@/lib/saveUpload";
import type { Save } from "@/lib/saveUpload";

type GameOption = {
  id: string;
  name: string;
  platform: string;
  aliases: string[] | null;
};

type Props = {
  // Wird nach erfolgreichem Upload aufgerufen, damit die übergeordnete
  // Seite z. B. direkt zu Konsole/Spiel springen kann (Verlauf ansehen etc.)
  onUploaded?: (game: { id: string; name: string; platform: string }) => void;
};

// Ab welcher Konfidenz die automatische Erkennung als Vorschlag
// vorausgewählt wird (der Nutzer kann sie trotzdem jederzeit über die
// Suche korrigieren).
const AUTO_SELECT_CONFIDENCE = 40;

export default function QuickUpload({ onUploaded }: Props) {
  const { showToast } = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detection, setDetection] = useState<DetectedSave | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [allGames, setAllGames] = useState<GameOption[]>([]);
  const [loadingGames, setLoadingGames] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [selectedGame, setSelectedGame] = useState<GameOption | null>(null);

  const [slotSaves, setSlotSaves] = useState<Record<number, Save | null>>({});
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let ignore = false;

    supabase
      .from("games")
      .select("id,name,platform,aliases")
      .order("name")
      .then(({ data, error }) => {
        if (error) {
          console.error(error);
          return;
        }
        if (!ignore) {
          setAllGames(data ?? []);
          setLoadingGames(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  async function handleFile(selected: File) {
    setFile(selected);
    setDetection(null);
    setSelectedGame(null);
    setSlotSaves({});
    setSuccessMessage(null);
    setShowSearch(false);
    setSearchTerm("");

    setDetecting(true);
    try {
      const result = await detectSave(selected);
      setDetection(result);

      if (result.gameId && result.confidence >= AUTO_SELECT_CONFIDENCE) {
        const match = allGames.find((game) => game.id === result.gameId);
        if (match) {
          setSelectedGame(match);
        } else {
          // Spielkatalog evtl. noch nicht geladen - Erkennung trotzdem
          // anzeigen, Suche bleibt als Fallback offen.
          setShowSearch(true);
        }
      } else {
        setShowSearch(true);
      }
    } finally {
      setDetecting(false);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) {
      handleFile(dropped);
    }
  }

  useEffect(() => {
    if (!selectedGame || !file) return;

    let ignore = false;

    async function run() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || ignore || !selectedGame) return;

      setLoadingSlots(true);

      const [slot1, slot2] = await Promise.all([
        fetchSaveForSlot(selectedGame.id, user.id, 1),
        fetchSaveForSlot(selectedGame.id, user.id, 2),
      ]);

      if (!ignore) {
        setSlotSaves({ 1: slot1, 2: slot2 });
        setLoadingSlots(false);
      }
    }

    run();

    return () => {
      ignore = true;
    };
  }, [selectedGame, file]);

  async function uploadToSlot(slot: number) {
    if (!file || !selectedGame || !detection) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      showToast("Login erforderlich");
      return;
    }

    const existing = slotSaves[slot] ?? null;

    if (existing) {
      const weiter = confirm(
        `Slot ${slot} bei ${selectedGame.name} enthält bereits "${existing.file_name ?? "eine Datei"}". ` +
        `Überschreiben? Der bisherige Stand wird automatisch im Verlauf gesichert.`
      );
      if (!weiter) return;
    }

    setUploadingSlot(slot);

    try {
      const result = await performUpload({
        file,
        userId: user.id,
        gameId: selectedGame.id,
        gameName: selectedGame.name,
        slot,
        detection,
        freshExisting: existing,
      });

      if (!result.ok) {
        showToast(result.error);
        if (!existing) {
          // Möglicherweise wurde der Slot durch eine Race Condition
          // gerade belegt (Unique-Constraint-Fehler) - Status neu laden.
          const [slot1, slot2] = await Promise.all([
            fetchSaveForSlot(selectedGame.id, user.id, 1),
            fetchSaveForSlot(selectedGame.id, user.id, 2),
          ]);
          setSlotSaves({ 1: slot1, 2: slot2 });
        }
        return;
      }

      if (result.duplicate) {
        showToast("Datei ist identisch mit dem aktuellen Stand — nichts geändert.", "success");
        return;
      }

      setSuccessMessage(
        `"${file.name}" wurde als Slot ${slot} für ${selectedGame.name} gespeichert.`
      );
      showToast(`"${file.name}" wurde in Slot ${slot} gespeichert.`, "success");
      onUploaded?.(selectedGame);

      // Formular für den nächsten Upload zurücksetzen
      setFile(null);
      setDetection(null);
      setSelectedGame(null);
      setSlotSaves({});
      setShowSearch(false);
      setSearchTerm("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } finally {
      setUploadingSlot(null);
    }
  }

  const searchResults = searchTerm.trim()
    ? allGames.filter((game) => {
        const term = searchTerm.toLowerCase();
        return (
          game.name.toLowerCase().includes(term) ||
          game.platform.toLowerCase().includes(term) ||
          (game.aliases ?? []).some((alias) => alias.toLowerCase().includes(term))
        );
      })
    : allGames;

  return (
    <div className="border-2 border-dashed rounded p-6 mt-8">
      <h2 className="text-2xl font-bold mb-1">Schnell-Upload</h2>
      <p className="text-sm text-gray-600 mb-4">
        Datei auswählen oder hierher ziehen — Spiel und Konsole werden
        automatisch erkannt.
      </p>

      {loadingGames && (
        <p className="text-sm text-gray-500 mb-3">Lädt Spielkatalog...</p>
      )}

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`cursor-pointer rounded p-8 text-center border ${
          dragOver ? "bg-blue-50 border-blue-400" : "border-gray-300"
        }`}
      >
        <input
          ref={fileInputRef}
          hidden
          type="file"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected) handleFile(selected);
          }}
        />
        {file ? (
          <p className="font-medium">{file.name}</p>
        ) : (
          <p className="text-gray-500">Klicken oder Datei hierher ziehen</p>
        )}
      </div>

      {detecting && <p className="mt-3 text-sm text-gray-500">Erkenne Spiel...</p>}

      {!detecting && detection && (
        <div className="mt-4 rounded border p-4">
          {detection.gameId ? (
            <>
              <p>
                🎮 Erkannt: <strong>{detection.gameName}</strong> ({detection.platform})
              </p>
              <p className="text-sm text-gray-500">
                Konfidenz: {detection.confidence}%
                {detection.reasons.length > 0 && ` — ${detection.reasons.join(", ")}`}
              </p>
            </>
          ) : (
            <p>Konnte kein Spiel automatisch erkennen.</p>
          )}

          {selectedGame && (
            <p className="mt-2 text-green-700">
              Ausgewählt: <strong>{selectedGame.name}</strong> ({selectedGame.platform})
            </p>
          )}

          <div className="flex gap-4 mt-2">
            <button
              className="text-blue-600 underline text-sm"
              onClick={() => setShowSearch((prev) => !prev)}
            >
              {showSearch ? "Suche verbergen" : "Falsch erkannt? Spiel manuell suchen"}
            </button>

            <button
              className="text-gray-500 underline text-sm"
              onClick={() => {
                setFile(null);
                setDetection(null);
                setSelectedGame(null);
                setSlotSaves({});
                setShowSearch(false);
                setSearchTerm("");
                if (fileInputRef.current) {
                  fileInputRef.current.value = "";
                }
              }}
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {!detecting && file && showSearch && (
        <div className="mt-4">
          <input
            className="border rounded p-2 w-full"
            placeholder="Spiel oder Konsole suchen..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />

          <div className="flex flex-col gap-1 mt-2 max-h-56 overflow-y-auto">
            {searchResults.map((game) => (
              <button
                key={game.id}
                onClick={() => {
                  setSelectedGame(game);
                  setShowSearch(false);
                }}
                className={`text-left border rounded p-2 ${
                  selectedGame?.id === game.id ? "bg-blue-600 text-white" : ""
                }`}
              >
                {game.name} <span className="text-sm opacity-70">({game.platform})</span>
              </button>
            ))}

            {searchResults.length === 0 && (
              <p className="text-sm text-gray-500">Kein Spiel gefunden.</p>
            )}
          </div>
        </div>
      )}

      {selectedGame && file && (
        <div className="mt-4">
          <p className="font-bold mb-2">In welchen Slot hochladen?</p>

          {loadingSlots ? (
            <p className="text-sm text-gray-500">Lädt Slot-Status...</p>
          ) : (
            <div className="flex gap-3">
              {[1, 2].map((slot) => {
                const existing = slotSaves[slot];
                return (
                  <button
                    key={slot}
                    disabled={uploadingSlot !== null}
                    onClick={() => uploadToSlot(slot)}
                    className="border rounded p-3 text-left disabled:opacity-50"
                  >
                    <p className="font-bold">Slot {slot}</p>
                    <p className="text-sm text-gray-600">
                      {uploadingSlot === slot
                        ? "Lädt hoch..."
                        : existing
                        ? `belegt: ${existing.file_name ?? "Datei"}`
                        : "leer"}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {successMessage && (
        <p className="mt-4 text-green-700">{successMessage}</p>
      )}
    </div>
  );
}
