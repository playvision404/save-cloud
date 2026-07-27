use client";

import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { supabase } from "@/lib/supabase";
import { detectSave } from "@/lib/saveDetector";

type Props = { gameId: string; gameName: string };

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
};

export default function SlotView({ gameId, gameName }: Props) {
  const [saves, setSaves] = useState<Save[]>([]);
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);

  const loadSaves = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return setSaves([]);

    const { data } = await supabase.from("saves").select("*").eq("game_id", gameId).eq("user_id", user.id).order("slot");
    setSaves(data ?? []);
  }, [gameId]);

  useEffect(() => { loadSaves(); }, [loadSaves]);

  async function uploadSave(event: ChangeEvent<HTMLInputElement>, slot: number) {
    const file = event.target.files?.[0];
    if (!file) return;

    const detection = await detectSave(file);
    if (detection.gameId && detection.confidence >= 80 && detection.gameId !== gameId) {
      alert(`Diese Datei sieht nach ${detection.gameName} aus.`);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return alert("Login erforderlich");

    setUploadingSlot(slot);
    try {
      const filePath = `${user.id}/${gameId}/slot-${slot}-${file.name}`;
      const { error } = await supabase.storage.from("saves").upload(filePath, file, { upsert: true });
      if (error) return alert(error.message);

      await supabase.from("saves").insert({
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
        detection_reasons: detection.reasons
      });

      await loadSaves();
    } finally {
      setUploadingSlot(null);
    }
  }

  return <div className="mt-8 border rounded p-5"><h2 className="text-2xl font-bold">{gameName}</h2>{[1,2].map(slot => { const save=saves.find(s=>s.slot===slot); return <div key={slot} className="border rounded p-4 mt-4"><h3>Slot {slot}</h3>{save ? <><p>{save.file_name}</p><p>🎮 {save.detected_platform ?? "unbekannt"}</p><p>💾 {save.detected_format ?? "-"}</p><p>🔍 {save.detection_confidence ?? 0}%</p></> : <label className="cursor-pointer">Save hochladen<input hidden type="file" onChange={e=>uploadSave(e,slot)}/></label>}</div>})}</div>;
}
