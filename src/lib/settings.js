/* ------------------------------------------------------------------ */
/* Zugangsdaten & Konfiguration                                        */
/*                                                                     */
/* Bewusste Entscheidung laut Auftrag: Ablage in localStorage pro      */
/* Gerät (private Geräte). Der Abmelden-Knopf löscht alles wieder.     */
/* ------------------------------------------------------------------ */

const SETTINGS_KEY = "notizbuch:settings";

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s && typeof s === "object" && s.owner && s.repo && s.pat && s.apiKey) return s;
    return null;
  } catch (e) {
    return null;
  }
}

export function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function clearSettings() {
  localStorage.removeItem(SETTINGS_KEY);
}
