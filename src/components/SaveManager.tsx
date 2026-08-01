"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

import PlatformSelector from "@/components/PlatformSelector";
import GameSelector from "@/components/GameSelector";
import SlotView from "@/components/SlotView";
import QuickUpload from "@/components/QuickUpload";
import StorageUsage from "@/components/StorageUsage";
import { purgeExpiredTrash } from "@/lib/saveUpload";


type Game = {
  id: string;
  name: string;
  platform: string;
};


export default function SaveManager() {

  const [platforms, setPlatforms] = useState<string[]>([]);
  const [selectedPlatform, setSelectedPlatform] = useState("");

  const [selectedGame, setSelectedGame] = useState<Game | null>(null);



  useEffect(() => {

    async function loadPlatforms() {

      const {
        data,
        error,
      } = await supabase
        .from("games")
        .select("platform");


      if (error) {
        console.log(error);
        return;
      }


      const uniquePlatforms =
        Array.from(
          new Set(
            data.map(
              (item) => item.platform
            )
          )
        );


      setPlatforms(uniquePlatforms);

    }


    loadPlatforms();

    // Beiläufige Bereinigung abgelaufener Papierkorb-Einträge (siehe
    // TRASH_RETENTION_DAYS in saveUpload.ts) - es gibt keinen Server-
    // Cronjob dafür, das passiert nur wenn die App geöffnet wird.
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        purgeExpiredTrash(user.id);
      }
    });

  }, []);




  function changePlatform(platform:string){

    setSelectedPlatform(platform);

    // Spiel zurücksetzen wenn Konsole geändert wird
    setSelectedGame(null);

  }


  function handleQuickUploaded(game: { id: string; name: string; platform: string }) {
    setSelectedPlatform(game.platform);
    setSelectedGame({ id: game.id, name: game.name, platform: game.platform });
  }




  return (

    <div>

      <h1 className="text-3xl font-bold mt-10">
        Meine Save Cloud
      </h1>

      <StorageUsage />

      <QuickUpload onUploaded={handleQuickUploaded} />

      <h2 className="text-2xl font-bold mt-10 mb-2">
        Oder über Konsole/Spiel durchsuchen
      </h2>

      <PlatformSelector
        platforms={platforms}
        selected={selectedPlatform}
        onSelect={changePlatform}
      />



      <GameSelector
        platform={selectedPlatform}
        selectedGame={
          selectedGame?.id ?? null
        }
        onSelect={
          (game)=>setSelectedGame(game)
        }
      />



      {selectedGame && (

        <SlotView
          gameId={selectedGame.id}
          gameName={selectedGame.name}
        />

      )}


    </div>

  );
}