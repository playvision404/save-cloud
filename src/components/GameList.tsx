"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Game = {
  id: string;
  name: string;
  platform: string;
};

export default function GameList() {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function loadGames() {

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("games")
        .select("id, name, platform");

      console.log("Games:", data);
      console.log("Fehler:", error);

      if (error) {
        setErrorMessage(error.message);
      } else {
        setGames(data ?? []);
      }

      setLoading(false);
    }

    loadGames();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      loadGames();
    });

    return () => {
      subscription.unsubscribe();
    };

  }, []);


  return (
    <div className="mt-10">

      <h2 className="text-2xl font-bold mb-3">
        Spiele
      </h2>


      {loading && (
        <p>Lade Spiele...</p>
      )}


      {errorMessage && (
        <p className="text-red-600">
          Fehler: {errorMessage}
        </p>
      )}


      {!loading && games.length === 0 && (
        <p>
          Keine Spiele vorhanden
        </p>
      )}


      {games.map((game) => (
        <div
          key={game.id}
          className="border rounded p-3 mb-2"
        >
          <b>{game.name}</b>

          <p>
            Plattform: {game.platform}
          </p>
        </div>
      ))}

    </div>
  );
}