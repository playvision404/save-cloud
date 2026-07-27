import { supabase } from "./supabase";

export type DetectedSave = {
  gameId: string | null;
  gameName: string | null;
  platform: string | null;
  confidence: number;
  format: string;
  reasons: string[];
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
  return parts.length > 1 ? `.${parts.at(-1)?.toLowerCase()}` : "";
}

function normalize(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replaceAll("-", " ");
}

async function analyzeBinary(file: File) {
  const buffer = await file.slice(0, 256).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

  const reasons: string[] = [];
  let bonus = 0;

  if (text.toLowerCase().includes("pokemon")) {
    bonus += 15;
    reasons.push("Pokemon-Metadaten im Dateiinhalt gefunden");
  }

  if (bytes.length >= 256) {
    bonus += 5;
    reasons.push("Binärstruktur konnte analysiert werden");
  }

  return { bonus, reasons };
}

export async function detectSave(file: File): Promise<DetectedSave> {
  const extension = getFileExtension(file.name);
  const fileName = normalize(file.name);
  const binary = await analyzeBinary(file);
  const reasons: string[] = [...binary.reasons];

  const { data, error } = await supabase
    .from("games")
    .select("id,name,platform,aliases,file_extensions,save_sizes");

  if (error || !data) {
    return {
      gameId: null,
      gameName: null,
      platform: null,
      confidence: 0,
      format: extension,
      reasons: ["Spieldaten konnten nicht geladen werden"]
    };
  }

  let best: GameRecord | null = null;
  let bestScore = binary.bonus;
  let bestReasons = reasons;

  for (const game of data as GameRecord[]) {
    let score = binary.bonus;
    const currentReasons = [...binary.reasons];

    if (game.file_extensions?.includes(extension)) {
      score += 30;
      currentReasons.push("Dateiformat passt");
    }

    if (game.save_sizes?.includes(file.size)) {
      score += 40;
      currentReasons.push("Dateigröße passt exakt");
    }

    if (game.aliases?.some(alias => fileName.includes(normalize(alias)))) {
      score += 30;
      currentReasons.push("Dateiname enthält Spielnamen");
    }

    if (score > bestScore) {
      bestScore = score;
      best = game;
      bestReasons = currentReasons;
    }
  }

  return {
    gameId: best?.id ?? null,
    gameName: best?.name ?? null,
    platform: best?.platform ?? null,
    confidence: Math.min(bestScore, 100),
    format: extension,
    reasons: bestReasons
  };
}
