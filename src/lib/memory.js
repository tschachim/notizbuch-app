/* ------------------------------------------------------------------ */
/* Globales, notizbuchübergreifendes Gedächtnis (v7.16)                */
/*                                                                     */
/* Eigene Datei "data/memory.md" im Daten-Repo (Konstante MEMORY_PATH  */
/* lebt in App.jsx, wie STATE_PATH) – überlebt die Chat-Archivierung   */
/* by design: archiveChat (siehe App.jsx) und chatToMarkdown (siehe    */
/* lib/archive.js) fassen NUR den Chat (state.json) an, memory.md ist  */
/* eine eigenständige Datei und wird dabei nirgends berührt.           */
/*                                                                     */
/* applyMemoryOps ist die reine Kernfunktion (analog zu ops.js#applyOps */
/* fürs Dokument), aber ohne Abschnitts-Struktur: das Gedächtnis ist   */
/* ein flacher Stichpunkt-Text. Das GitHub-Schreiben mit SHA-Konflikt- */
/* Behandlung lebt bewusst in App.jsx (commitMemory), analog zu        */
/* commitDocNb dort – dieses Modul bleibt dadurch UI-/Netz-frei und    */
/* ohne Mocks vollständig testbar.                                     */
/* ------------------------------------------------------------------ */

// Ab dieser Zeichenzahl bittet der System-Prompt das Modell, das
// Gedächtnis bei nächster Gelegenheit selbst zu konsolidieren
// (memory_replace) statt endlos weiter anzuhängen (siehe anthropic.js).
export const MEMORY_SOFT_LIMIT = 8000;

export const memoryTooLarge = (text) => String(text || "").length > MEMORY_SOFT_LIMIT;

// Harte Prompt-Schutzkappe (v7.16, Review-Nachbesserung 🔵): oberhalb
// dieser Zeichenzahl kürzt lib/anthropic.js#memoryBlock den Gedächtnis-Text
// NUR im an das Modell gesendeten System-Prompt – die Datei data/memory.md
// SELBST bleibt dabei ungekürzt (kein Datenverlust, reine Prompt-
// Schutzkappe gegen unkontrolliertes Tokenwachstum, z. B. wenn der Soft-
// Hinweis oben ignoriert wird oder der Nutzer über die Einstellungen sehr
// viel Text einträgt). Deutlich über MEMORY_SOFT_LIMIT: der Soft-Hinweis
// bittet das Modell VORHER freiwillig zu konsolidieren, der Hard-Cap greift
// erst, wenn das nicht geschehen ist.
export const MEMORY_HARD_LIMIT = 24000;

// Nullbytes dürfen nie in die Datei gelangen (wie chatToMarkdown/
// lib/archive.js#noNul) – aus JEDEM Text entfernen, der die Datei
// erreichen könnte: sowohl der Basistext als auch jeder Op-Inhalt.
// Über String.fromCharCode(0) statt einem Escape-Literal gebildet, damit
// im Quelltext selbst kein rohes Steuerzeichen steht.
const NUL = String.fromCharCode(0);
const noNul = (s) => String(s || "").split(NUL).join("");

// Leerzeilen-Tidy analog zu ops.js#tidy: kollabiert 3+ aufeinanderfolgende
// Leerzeilen auf eine, trimmt Rand-Whitespace. Ein nicht-leerer Text
// bekommt einen abschließenden Zeilenumbruch (übliche Textdatei-
// Konvention, wie applyOps/tidy es fürs Dokument tut); ein leerer Text
// bleibt "" – memory_replace mit leerem content löscht das Gedächtnis
// damit bewusst vollständig, statt eine Datei mit nur einem "\n" zu
// hinterlassen.
function tidy(text) {
  const t = noNul(text).replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t ? t + "\n" : "";
}

function applyOne(text, op) {
  if (!op || typeof op !== "object") return text;
  const content = typeof op.content === "string" ? noNul(op.content).trim() : "";

  if (op.type === "memory_replace") {
    // Konsolidierung: ersetzt den GESAMTEN Text, UNABHÄNGIG vom bisherigen
    // Stand ("text" wird hier absichtlich nicht gelesen). Das ist wichtig
    // für den Retry bei SHA-Konflikten in App.jsx#commitMemory: dieselbe
    // Op erneut auf einen inzwischen frischeren Stand angewendet liefert
    // deterministisch dasselbe Ergebnis – kein zweiter Konflikt-Sonderfall
    // nötig.
    return tidy(content);
  }

  if (op.type === "memory_append") {
    if (!content) return text; // nichts anzuhängen – Text bleibt wie er ist
    const cur = tidy(text);
    return cur ? tidy(cur + "\n\n" + content) : tidy(content);
  }

  // Unbekannter/fremder op.type (z. B. ein versehentlich durchgereichtes
  // Notizbuch-Op): Op überspringen, Text unverändert. App.jsx filtert vor
  // dem Aufruf zwar bereits über splitOps, diese Funktion bleibt aber auch
  // ohne saubere Vorfilterung defensiv (Verteidigung in der Tiefe).
  return text;
}

// Wendet ops in Reihenfolge auf text an; nur "memory_append" und
// "memory_replace" werden verstanden (siehe applyOne). Eine kaputte
// einzelne Op (z. B. ein unerwarteter Wurf) bricht die gesamte Anwendung
// nicht ab – sie wird übersprungen, wie bei ops.js#applyOps. Deckel bei
// 20 Ops pro Aufruf (dieselbe defensive Grenze wie im Dokument-Pfad).
export function applyMemoryOps(text, ops) {
  let out = noNul(text);
  for (const op of (Array.isArray(ops) ? ops : []).slice(0, 20)) {
    try { out = applyOne(out, op); } catch (e) { /* Op überspringen */ }
  }
  return out;
}
