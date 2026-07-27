"use client";

import { useCallback, useEffect, useState } from "react";
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
};

export default function SlotView({ gameId, gameName }: Props) {
  const [saves, setSaves] = useState<Save[]>([]);
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);

  const loadSaves = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setSaves([]);
      return;
    }

    const { data, error } = await supabase
      .from("saves")
      .select("*")
      .eq("game_id", gameId)
      .eq("user_id", user.id)
      .order("slot");

    if (error) {
      console.log(error);
      return;
    }

    setSaves(data ?? []);
  }, [gameId]);

  useEffect(() => {
    queueMicrotask(() => {
      loadSaves();
    });
  }, [loadSaves]);

  async function uploadSave(event: ChangeEvent<HTMLInputElement>, slot: number) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const detection = await detectSave(file);

    console.log("Erkennung:", detection);

    if (
      detection.gameId &&
      detection.confidence >= 80 &&
      detection.gameId !== gameId
    ) {
      alert(
        `Die Datei sieht nach ${detection.gameName} (${detection.platform}) aus. Bitte wähle das richtige Spiel.`
      );
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      alert("Du musst eingeloggt sein");
      return;
    }

    setUploadingSlot(slot);

    try {
      const filePath = `${user.id}/${gameId}/slot-${slot}-${file.name}`;

      const { error: uploadError } = await supabase.storage
        .from("saves")
        .upload(filePath, file, {
          upsert: true,
        });

      if (uploadError) {
        alert(uploadError.message);
        return;
      }

      const { error: databaseError } = await supabase.from("saves").insert({
        user_id: user.id,
        game_id: gameId,
        slot,
        file_path: filePath,
        file_size: file.size,
        file_name: file.name,
        note: gameName,
      });

      if (databaseError) {
        alert(databaseError.message);
        return;
      }

      await loadSaves();
    } finally {
      setUploadingSlot(null);
    }
  }

  async function downloadSave(save: Save) {
    const { data, error } = await supabase.storage
      .from("saves")
      .createSignedUrl(save.file_path, 60);

    if (error) {
      alert(error.message);
      return;
    }

    const response = await fetch(data.signedUrl);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = save.file_name ?? "savefile";
    link.click();

    URL.revokeObjectURL(url);
  }

  return (
    <div className="mt-8 border rounded p-5">
      <h2 className="text-2xl font-bold mb-4">{gameName}</h2>

      {[1, 2].map((slotNumber) => {
        const save = saves.find((item) => item.slot === slotNumber);

        return (
          <div key={slotNumber} className="border rounded p-4 mb-4">
            <h3 className="text-xl font-bold">Slot {slotNumber}</h3>

            {save ? (
              <>
                <p>{save.file_name}</p>

                <button
                  className="bg-blue-600 text-white rounded p-2 mt-2"
                  onClick={() => downloadSave(save)}
                >
                  Download
                </button>
              </>
            ) : (
              <>
                <p>Kein Save vorhanden</p>

                <label className="inline-block bg-green-600 text-white rounded p-2 mt-2 cursor-pointer">
                  {uploadingSlot === slotNumber
                    ? "Lädt hoch..."
                    : "Save hochladen"}

                  <input
                    type="file"
                    hidden
                    onChange={(event) => uploadSave(event, slotNumber)}
                  />
                </label>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}