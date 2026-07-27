import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";

dotenv.config({
  path: ".env.local",
});


const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);


const games = JSON.parse(
  fs.readFileSync("games.json", "utf8")
);



async function importGames() {

  console.log(
    `Starte Import von ${games.length} Spielen...`
  );


  for (const game of games) {

    console.log("\n--------------------------------");
    console.log(
      "Importiere:",
      game.name
    );


    // Plattform suchen

    const {
      data: platforms,
      error: platformError
    } = await supabase
      .from("platforms")
      .select("id,name");


    if (platformError) {

      console.log(
        "Fehler beim Laden der Plattformen:",
        platformError.message
      );

      continue;
    }



    const platform =
      platforms?.find(
        (p) =>
          p.name.trim().toLowerCase()
          ===
          game.platform.trim().toLowerCase()
      );



    if (!platform) {

      console.log(
        "Plattform nicht gefunden:",
        game.platform
      );

      continue;

    }



    console.log(
      "Plattform:",
      platform.name
    );



    // Prüfen ob Spiel schon existiert

    const {
      data: existingGame,
      error: existingError
    } =
      await supabase
      .from("games")
      .select("id")
      .eq(
        "name",
        game.name
      )
      .eq(
        "platform_id",
        platform.id
      )
      .maybeSingle();



    if(existingError){

      console.log(
        "Fehler beim Prüfen:",
        existingError.message
      );

      continue;

    }



    const gameData = {

      name:
        game.name,

      platform:
        game.platform,

      platform_id:
        platform.id,

      aliases:
        game.aliases ?? [],

      file_extensions:
        game.file_extensions ?? [],

      save_sizes:
        game.save_sizes ?? []

    };



    let result;



    if(existingGame){


      console.log(
        "Spiel existiert → aktualisiere"
      );


      result =
        await supabase
        .from("games")
        .update(gameData)
        .eq(
          "id",
          existingGame.id
        );


    } else {


      console.log(
        "Neues Spiel → erstelle"
      );


      result =
        await supabase
        .from("games")
        .insert(gameData);


    }



    if(result.error){

      console.log(
        "Fehler:",
        result.error.message
      );


    } else {


      console.log(
        "✓ Erfolgreich:",
        game.name
      );


    }


  }



  console.log(
    "\nImport abgeschlossen!"
  );

}



importGames();