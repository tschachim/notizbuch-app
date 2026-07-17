/* ------------------------------------------------------------------ */
/* Zugangsdaten & Konfiguration                                        */
/*                                                                     */
/* Bewusste Entscheidung laut Auftrag: Ablage in localStorage pro      */
/* Gerät (private Geräte). Der Abmelden-Knopf löscht alles wieder.     */
/*                                                                     */
/* linkProviders (v7.9): Liste konfigurierter Link-Provider (Azure     */
/* DevOps/Confluence/eigene), inkl. PAT/E-Mail – wandert NIE über      */
/* saveSettings() hinaus (bleibt Teil desselben localStorage-Objekts   */
/* wie owner/repo/pat/apiKey, landet also ebenso wenig in einem Repo). */
/* sanitizeLinkProviders (lib/linkProviders.jsx, ein Blatt ohne eigene */
/* Abhängigkeiten – Import von hier aus ist zirkelfrei) filtert defensiv */
/* kaputte Einträge, damit ein manuell editiertes/älteres localStorage- */
/* Objekt die App nicht zum Absturz bringt.                            */
/* ------------------------------------------------------------------ */

import { sanitizeLinkProviders } from "./linkProviders.jsx";

const SETTINGS_KEY = "notizbuch:settings";

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s && typeof s === "object" && s.owner && s.repo && s.pat && s.apiKey) {
      return { ...s, linkProviders: sanitizeLinkProviders(s.linkProviders) };
    }
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
