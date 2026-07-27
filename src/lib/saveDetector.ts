import { supabase } from "./supabase";

export type DetectedSave = {
  gameId: string | null;
  gameName: string | null;
  platform: string | null;
  confidence: number;
};

type GameRecord = {
  id: string;
  name: string;
  platform: string;
  aliases: string[] | null;
  file_extensions: string[] | null;
  save_sizes: number[] | null;
};

function getFileExtension(fileName: string) {
  const parts = fileName.split(".");

  if (parts.length < 2) {
    return "";
  }

  return `.${parts.at(-1)?.toLowerCase() ?? ""}`;
}

export async function detectSave(file: File): Promise<DetectedSave> {
  const fileName = file.name.toLowerCase();
  const extension = getFileExtension(file.name);
  const fileSize = file.size;

  console.log("Analysiere Save:");
  console.log("Datei:", file.name);
  console.log("Größe:", fileSize);
  console.log("Endung:", extension);

  const { data, error } = await supabase
    .from("games")
    .select(`
      id,
      name,
      platform,
      aliases,
      file_extensions,
      save_sizes
    `);

  if (error || !data) {
    console.log("Fehler beim Laden der Spiele:", error);

    return {
      gameId: null,
      gameName: null,
      platform: null,
      confidence: 0,
    };
  }

  const games = data as GameRecord[];
  let bestGame: GameRecord | null = null;
  let bestScore = 0;

  for (const game of games) {
    let score = 0;

    if (game.file_extensions?.includes(extension)) {
      score += 30;
    }

    if (game.save_sizes?.includes(fileSize)) {
      score += 40;
    }

    const cleanFileName = fileName.replaceAll("_", " ").replaceAll("-", " ");

    if (
      game.aliases?.some((alias) =>
        cleanFileName.includes(alias.toLowerCase())
      )
    ) {
      score += 30;
    }

    console.log(game.name, "Score:", score);

    if (score > bestScore) {
      bestScore = score;
      bestGame = game;
    }
  }

  if (!bestGame) {
    return {
      gameId: null,
      gameName: null,
      platform: null,
      confidence: 0,
    };
  }

  return {
    gameId: bestGame.id,
    gameName: bestGame.name,
    platform: bestGame.platform,
    confidence: bestScore,
  };
}