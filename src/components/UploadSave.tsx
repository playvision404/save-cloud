"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { detectSave } from "@/lib/saveDetector";

export default function UploadSave() {
  const [user, setUser] = useState<User | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [game, setGame] = useState("");
  const [platform, setPlatform] = useState("");
  const [gameId, setGameId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function loadUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      setUser(user);
    }

    loadUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function findGame(
    detectedGame: string,
    detectedPlatform: string
  ) {
    const { data, error } = await supabase
      .from("games")
      .select("id")
      .eq("name", detectedGame)
      .eq("platform", detectedPlatform)
      .single();

    if (error) {
      console.log("Spiel nicht gefunden:", error);
      return null;
    }

    return data.id as string;
  }

  async function uploadSave() {
    if (!user) {
      setMessage("Du musst eingeloggt sein");
      return;
    }

    if (!file) {
      setMessage("Bitte Save-Datei auswählen");
      return;
    }

    let currentGameId = gameId;

    if (!currentGameId) {
      currentGameId = await findGame(game, platform);
    }

    if (!currentGameId) {
      setMessage("Spiel wurde nicht gefunden");
      return;
    }

    const filePath = `${user.id}/${Date.now()}-${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from("saves")
      .upload(filePath, file);

    if (uploadError) {
      setMessage(uploadError.message);
      return;
    }

    const { error: databaseError } = await supabase.from("saves").insert({
      user_id: user.id,
      game_id: currentGameId,
      slot: 1,
      file_path: filePath,
      file_size: file.size,
      note: `${game} - ${platform}`,
    });

    if (databaseError) {
      setMessage(databaseError.message);
      return;
    }

    setMessage("Save erfolgreich hochgeladen!");
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;

    setFile(selected);
    setGameId(null);

    if (!selected) {
      return;
    }

    const result = await detectSave(selected);

    setGameId(result.gameId);

    if (result.gameName) {
      setGame(result.gameName);
    }

    if (result.platform) {
      setPlatform(result.platform);
    }
  }

  if (!user) {
    return null;
  }

  return (
    <div className="mt-10 border rounded p-5">
      <h2 className="text-2xl font-bold mb-4">Save hochladen</h2>

      <input
        className="border p-2 w-full mb-2"
        placeholder="Spiel"
        value={game}
        onChange={(event) => setGame(event.target.value)}
      />

      <input
        className="border p-2 w-full mb-2"
        placeholder="Plattform"
        value={platform}
        onChange={(event) => setPlatform(event.target.value)}
      />

      <input type="file" onChange={handleFileChange} />

      <button
        className="bg-green-600 text-white rounded p-2 mt-3"
        onClick={uploadSave}
      >
        Hochladen
      </button>

      <p className="mt-3">{message}</p>
    </div>
  );
}