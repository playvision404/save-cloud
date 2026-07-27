"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Game = {
  id: string;
  name: string;
  platform: string;
};

type Props = {
  platform: string;
  selectedGame: string | null;
  onSelect: (game: Game) => void;
};

export default function GameSelector({
  platform,
  selectedGame,
  onSelect,
}: Props) {

  const [games, setGames] = useState<Game[]>([]);


  useEffect(() => {

    async function loadGames() {

      if (!platform) {
        setGames([]);
        return;
      }


      const { data, error } = await supabase
        .from("games")
        .select("id, name, platform")
        .eq("platform", platform)
        .order("name");


      if (error) {
        console.log(error);
        return;
      }


      setGames(data ?? []);

    }


    loadGames();

  }, [platform]);



  if (!platform) {
    return null;
  }



  return (
    <div className="mt-8">

      <h2 className="text-2xl font-bold mb-3">
        Spiel auswählen
      </h2>


      <div className="flex flex-col gap-2">

        {games.map((game) => (

          <button
            key={game.id}
            onClick={() => onSelect(game)}
            className={`border rounded p-3 text-left ${
              selectedGame === game.id
                ? "bg-blue-600 text-white"
                : ""
            }`}
          >

            <p className="font-bold">
              {game.name}
            </p>

            <p>
              {game.platform}
            </p>

          </button>

        ))}


        {games.length === 0 && (
          <p>
            Keine Spiele für diese Plattform gefunden
          </p>
        )}

      </div>

    </div>
  );
}