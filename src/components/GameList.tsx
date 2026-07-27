"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type SaveGame = {
  id: string;
  slot: number;
  uploaded_at: string;
  file_path: string;
  games: {
    id: string;
    name: string;
    platform: string;
    icon: string | null;
  };
};

export default function GameList() {
  const [games, setGames] = useState<SaveGame[]>([]);
  const [loading, setLoading] = useState(true);

  const loadGames = useCallback(async () => {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setGames([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("saves")
      .select(`
        id,
        slot,
        uploaded_at,
        file_path,
        games (
          id,
          name,
          platform,
          icon
        )
      `)
      .eq("user_id", user.id)
      .order("uploaded_at", {
        ascending: false,
      });

    if (error) {
      console.error("Fehler beim Laden:", error);
      setLoading(false);
      return;
    }

    setGames((data ?? []) as unknown as SaveGame[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      loadGames();
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      loadGames();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [loadGames]);

  async function downloadSave(path: string) {
    const { data, error } = await supabase.storage
      .from("saves")
      .createSignedUrl(path, 60);

    if (error) {
      console.error("Download Fehler:", error);
      return;
    }

    window.open(data.signedUrl, "_blank");
  }

  if (loading) {
    return <p>Lade Saves...</p>;
  }

  if (games.length === 0) {
    return <p>Noch keine Saves vorhanden.</p>;
  }

  return (
    <div className="space-y-4">
      {games.map((save) => (
        <div key={save.id} className="border rounded-lg p-4">
          <h2 className="text-xl font-bold">{save.games.name}</h2>

          <p>Plattform: {save.games.platform}</p>
          <p>Slot {save.slot}</p>

          <button
            onClick={() => downloadSave(save.file_path)}
            className="mt-3 px-4 py-2 rounded bg-black text-white"
          >
            Download
          </button>
        </div>
      ))}
    </div>
  );
}