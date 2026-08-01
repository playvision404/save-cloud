"use client";

const STORAGE_KEY = "save-cloud:device-name";

function guessDefaultName(): string {
  if (typeof navigator === "undefined") return "Unbekanntes Gerät";
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "Android-Gerät";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS-Gerät";
  if (/Windows/i.test(ua)) return "Windows-PC";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Linux/i.test(ua)) return "Linux-PC";
  return "Unbekanntes Gerät";
}

// Fragt einmalig (und danach nur noch auf Wunsch) nach einem Namen für
// dieses Gerät, damit Konfliktwarnungen und der Verlauf zeigen können,
// WELCHES Gerät zuletzt etwas hochgeladen hat, statt nur "ein anderes
// Gerät". Wird in localStorage gemerkt.
export function getDeviceName(): string {
  if (typeof window === "undefined") return "Server";

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored) return stored;

  const suggestion = guessDefaultName();
  const input = window.prompt(
    "Wie soll dieses Gerät heißen? (z. B. \"AYN Thor\", \"PC\", \"Laptop\") " +
    "— hilft dabei, Änderungen von anderen Geräten zu erkennen.",
    suggestion
  );

  const name = (input && input.trim()) || suggestion;
  window.localStorage.setItem(STORAGE_KEY, name);
  return name;
}

export function setDeviceName(name: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, name.trim() || guessDefaultName());
}
