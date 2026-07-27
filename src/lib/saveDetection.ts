export type SaveDetectionResult = {
  platform: string;
  confidence: number;
  format: string;
  possibleGames: string[];
  reason: string[];
};

const rules = [
  { ext: ['sav'], platform: 'Game Boy Advance', size: 32768, games: ['Pokemon Emerald', 'Pokemon FireRed', 'Pokemon LeafGreen'] },
  { ext: ['srm'], platform: 'RetroArch', size: 65536, games: ['RetroArch Battery Save'] },
  { ext: ['state'], platform: 'Emulator State', size: 0, games: [] },
  { ext: ['mcr'], platform: 'PlayStation', size: 131072, games: ['PS1 Games'] }
];

export async function analyzeSaveFile(file: File): Promise<SaveDetectionResult> {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const reasons: string[] = [];

  let best = {
    platform: 'Unknown',
    confidence: 10,
    format: extension,
    possibleGames: [] as string[],
    reason: reasons
  };

  for (const rule of rules) {
    if (rule.ext.includes(extension)) {
      let confidence = 50;
      reasons.push(`Dateiendung .${extension} erkannt`);

      if (rule.size > 0 && file.size === rule.size) {
        confidence += 40;
        reasons.push(`Dateigröße ${file.size} Bytes passt`);
      }

      best = {
        platform: rule.platform,
        confidence,
        format: extension,
        possibleGames: rule.games,
        reason: reasons
      };
    }
  }

  return best;
}
