/* ------------------------------------------------------------------ */
/* Schnellnotizen (Post-its): 3-Wege-Merge & Cache-Format               */
/* v7.57.1, DECISIONS #119/#121 – E2E-Befund E2 (Datenverlust nach       */
/* Reload) + Review-Nachbesserung #121 (Migrationsfall siehe unten).     */
/*                                                                       */
/* Bisher galt beim Laden (App.jsx#connect/maybeRefresh) "Remote gewinnt */
/* pro Notizbuch, komplett" (siehe DECISIONS #33): ein lokal noch nicht  */
/* ins Daten-Repo geschriebener Text (localStorage-Cache) wurde von      */
/* JEDEM Remote-Stand überschrieben, auch von einer leeren Liste. Root-  */
/* Cause: es gab keine Basis, an der die App hätte erkennen können, ob   */
/* der lokale Stand NEUER als der zuletzt bestätigte Remote-Stand ist.   */
/*                                                                       */
/* mergeQuickNotes() führt deshalb einen 3-Wege-Merge (Basis/lokal/      */
/* remote) PRO NOTIZBUCH und PRO NOTIZ-ID durch – dieselbe Grund-Idee    */
/* wie ein Git-Merge: unveränderte Seiten weichen der geänderten Seite   */
/* (inkl. Löschung), ändern BEIDE Seiten dieselbe Notiz, gewinnt die     */
/* neuere (per "u"-Zeitstempel, siehe App.jsx#addQuickNote/               */
/* updateQuickNote), bei Gleichstand lokal. Ist die Basis für eine ID    */
/* unbekannt (nie gesehen, z. B. nach einem Cache-Formatwechsel oder     */
/* ganz am Anfang) UND existiert die ID nur auf EINER Seite, verhält     */
/* sich der Merge wie eine reine Vereinigung OHNE Löschung – lieber eine */
/* Notiz einmalig zu viel zeigen als eine echte Änderung stillschweigend */
/* verlieren (siehe Risiko-Abschnitt in DECISIONS #119). Existiert die   */
/* ID bei unbekannter Basis auf BEIDEN Seiten mit UNTERSCHIEDLICHEM      */
/* Inhalt (typischer Migrationsfall: dieses Gerät kennt sie noch vom     */
/* letzten Besuch, ein anderes hat sie seither geändert), gewinnt OHNE   */
/* belegten Zeitvorsprung (lu > ru) der REMOTE-Stand, nicht mehr lokal   */
/* (v7.57.1-Nachbesserung, DECISIONS #121 – siehe mergeOneNote unten).   */
/* ------------------------------------------------------------------ */

// Felder, die den INHALT einer Notiz ausmachen (Vergleichsgrundlage für
// "unverändert seit der Basis"). "u" (Zeitstempel) bewusst AUSSER Acht
// gelassen – er ist Buchhaltung, kein Inhalt, und zwei inhaltlich
// identische Notizen mit unterschiedlichem "u" (z. B. nach einem
// Format-Wechsel ohne Zeitstempel) sollen trotzdem als "gleich" gelten.
const NOTE_FIELDS = ["id", "text", "x", "y", "w", "h"];

function sameQuickNote(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  for (const f of NOTE_FIELDS) {
    if (a[f] !== b[f]) return false;
  }
  return true;
}

function toIdMap(list) {
  const m = new Map();
  if (!Array.isArray(list)) return m;
  for (const n of list) {
    if (n && typeof n === "object" && typeof n.id === "string" && n.id && !m.has(n.id)) m.set(n.id, n);
  }
  return m;
}

// Entscheidet EINE Notiz-ID: b = Basis (zuletzt bestätigter Remote-Stand),
// l = lokal, r = remote – jeweils die Notiz oder undefined (existiert auf
// dieser Seite nicht/wurde dort gelöscht).
function mergeOneNote(b, l, r) {
  // Lokal deckungsgleich mit der Basis (keine lokale Änderung, auch keine
  // lokale Löschung, wenn b undefined war): Remote entscheidet – das
  // schließt eine Remote-Löschung (r undefined) ausdrücklich ein.
  if (sameQuickNote(l, b)) return r || null;
  // Remote deckungsgleich mit der Basis: die ausstehende lokale Änderung
  // (inkl. einer lokalen Löschung) gewinnt.
  if (sameQuickNote(r, b)) return l || null;
  // Ab hier sind BEIDE Seiten von der Basis abgewichen (oder die Basis ist
  // für diese ID unbekannt und beide Seiten haben unterschiedlichen
  // Inhalt). Eine Seite hat die Notiz gelöscht (undefined), die andere
  // hat sie bearbeitet: die Bearbeitung gewinnt – ein Wiederauftauchen ist
  // das kleinere Übel gegenüber einem stillen Verlust der Bearbeitung.
  if (l && !r) return l;
  if (r && !l) return r;
  if (!l && !r) return null;
  // Beide Seiten haben dieselbe ID unabhängig bearbeitet: neuerer
  // "u"-Zeitstempel gewinnt, bei Gleichstand/fehlendem Zeitstempel lokal.
  const lu = typeof l.u === "number" ? l.u : 0;
  const ru = typeof r.u === "number" ? r.u : 0;
  // v7.57.1-Nachbesserung (Review-Fund 🔴, DECISIONS #121): War die Basis für
  // GENAU DIESE ID unbekannt (b === undefined – der Regelfall direkt nach
  // einem Cache-Formatwechsel v0/v1 → v2, siehe parseQuickNotesCache), UND
  // haben BEIDE Seiten unterschiedlichen Inhalt für dieselbe ID (kein
  // ID-Kollisionsfall, sondern der GEWÖHNLICHE Fall "dieses Gerät kennt die
  // ID schon aus einer früheren Sitzung, ein ANDERES Gerät hat sie seither
  // geändert"), entschied die Gleichstand-Regel oben bisher IMMER lokal –
  // ALTE Geräte stempelten "u" gar nicht, ein Gleichstand (0 >= 0) war also
  // der Normalfall, nicht die Ausnahme. Das überschrieb bei JEDER Migration
  // eine seit der letzten Sitzung DIESES Geräts entstandene fremde Änderung
  // (Live-Beleg: Probe M1 – Notiz am Handy ergänzt, während der PC offline
  // war; der PC gewann nach dem Update fälschlich mit seinem alten Text).
  // Ohne einen BELEGTEN Zeitvorsprung (lu > ru, nicht nur >=) gewinnt bei
  // unbekannter Basis jetzt der Remote-Stand – wie vor v7.57.1. Ein
  // Kollateralschaden bleibt möglich (siehe Restrisiko in DECISIONS #121:
  // eine Eingabe GENAU im Update-Moment kann einmalig verlierbar sein), ist
  // aber der kleinere Fehler gegenüber dem stillen Verlust einer fremden
  // Bearbeitung bei JEDER Migration.
  if (b === undefined) return lu > ru ? l : r;
  return lu >= ru ? l : r;
}

// 3-Wege-Merge für EIN Notizbuch (drei Listen). Reihenfolge des Ergebnisses:
// Remote-Reihenfolge zuerst, danach rein lokale (noch nicht synchronisierte)
// Notizen in ihrer lokalen Reihenfolge angehängt.
export function mergeQuickNotesForNb(baseList, localList, remoteList) {
  const b = toIdMap(baseList);
  const l = toIdMap(localList);
  const r = toIdMap(remoteList);

  const order = [];
  const seenIds = new Set();
  for (const list of [remoteList, localList]) {
    if (!Array.isArray(list)) continue;
    for (const n of list) {
      if (n && typeof n.id === "string" && n.id && !seenIds.has(n.id)) {
        seenIds.add(n.id);
        order.push(n.id);
      }
    }
  }

  const out = [];
  for (const id of order) {
    const merged = mergeOneNote(b.get(id), l.get(id), r.get(id));
    if (merged) out.push(merged);
  }
  return out;
}

// Filtert eine Roh-Struktur { nbId: Notiz[] } auf wohlgeformte Einträge:
// nur Arrays je Notizbuch, nur Notizen mit nichtleerer string-id, keine
// doppelten IDs innerhalb eines Notizbuchs (erste gewinnt). Robust gegen
// kaputte/fremde Daten (localStorage manuell verändert, altes Format,
// defekter State-Import) – GIGO-Philosophie wie im Rest des Repos:
// lieber leise überspringen als werfen.
export function normalizeQuickNotesMap(x) {
  if (!x || typeof x !== "object" || Array.isArray(x)) return {};
  const out = {};
  for (const [nbId, list] of Object.entries(x)) {
    if (!Array.isArray(list)) continue;
    const seen = new Set();
    const notes = [];
    for (const n of list) {
      if (!n || typeof n !== "object" || typeof n.id !== "string" || !n.id || seen.has(n.id)) continue;
      seen.add(n.id);
      notes.push(n);
    }
    out[nbId] = notes;
  }
  return out;
}

// 3-Wege-Merge über ALLE Notizbücher. base/local/remote sind jeweils
// { nbId: Notiz[] } oder null/undefined.
//
// remote === null/undefined: das Feld fehlt im Remote-Stand komplett
// (state.json vor der Schnellnotizen-Funktion bzw. anderes Gerät ohne
// diese Version) – lokaler Stand bleibt UNVERÄNDERT (Migrationsfall,
// unverändert seit v6.3, siehe DECISIONS #33).
//
// base === null/undefined (bzw. fehlt für ein Notizbuch/eine ID): "Basis
// unbekannt" – der Merge verhält sich für JEDE betroffene ID wie eine
// reine Vereinigung ohne Löschung (siehe mergeOneNote: eine mit der
// [unbekannten, also implizit "leeren"] Basis "übereinstimmende" Seite ist
// automatisch die, die die ID nicht kennt).
export function mergeQuickNotes(base, local, remote) {
  const l = normalizeQuickNotesMap(local);
  if (remote === null || remote === undefined) return l;
  const b = normalizeQuickNotesMap(base);
  const r = normalizeQuickNotesMap(remote);
  // v7.57.1-NACHBESSERUNG Runde 3 (Review-Fund 🔵, DECISIONS #122): Reihen-
  // folge REMOTE-ZUERST statt Basis-zuerst – Grund: "out" wird unten per
  // Object.keys()-Iteration in genau DIESER Set-Reihenfolge befüllt, und
  // lastSavedState in App.jsx ist der ROHE Remote-JSON-String. Wichen die
  // Notizbuch-SCHLÜSSEL zweier Geräte nur in der REIHENFOLGE ab (z. B. weil
  // beide gleichzeitig ein neues Notizbuch mit eigenem Post-it anlegten,
  // siehe P6), lieferte "Basis zuerst" auf JEDEM Gerät eine ANDERE
  // Reihenfolge als der jeweils zuletzt geschriebene Remote-Stand – jedes
  // Gerät hielt seinen eigenen JSON-String für "neu" und schrieb ihn zurück,
  // das andere Gerät sah beim nächsten Poll wieder einen fremden String und
  // schrieb ebenfalls zurück: eine ENDLOSE Schreibschleife ohne inhaltliche
  // Änderung (Review-Probe "Ping-Pong", 5 verschiedene SHAs in 120 s). Mit
  // Remote zuerst übernimmt das Merge-Ergebnis IMMER die Reihenfolge, die
  // der zuletzt gelesene Remote-Stand schon hatte (rein lokale, noch nicht
  // synchronisierte Notizbücher hängen unverändert dahinter) – ein Gerät,
  // das nichts inhaltlich Neues beiträgt, erzeugt dadurch keinen abweichenden
  // JSON-String mehr und schreibt nicht mehr zurück (Probe danach: 1 SHA in
  // 120 s). War schon in v7.57 vor #119 vorhanden (nicht regressiv), aber
  // #119s neuer 3-Wege-Merge führt über P6 direkt in die auslösende
  // Datenlage.
  // v7.57.1-NACHBESSERUNG Runde 4 (Review-Fund 🔵, DECISIONS #123): NUR
  // remote/lokale Schlüssel bilden die Notizbuch-Menge, NICHT zusätzlich die
  // Basis. Ein Notizbuch, das auf BEIDEN Seiten (lokal UND remote) gelöscht
  // wurde, existiert nur noch in der Basis – mergeQuickNotesForNb(baseListe,
  // undefined, undefined) liefert dafür `[]` (die Notiz-ID-Vereinigung aus
  // "order" bleibt leer, siehe dort), der Schlüssel selbst blieb aber bisher
  // als Zombie-Eintrag `"p": []` im Ergebnis stehen und wurde dauerhaft nach
  // state.json UND in den Cache zurückgeschrieben (harmlos, aber unnötiger
  // Extra-Commit). Fehlt ein Notizbuch sowohl lokal als auch remote, gehört
  // es schlicht NICHT ins Ergebnis.
  const nbIds = new Set([...Object.keys(r), ...Object.keys(l)]);
  const out = {};
  for (const nbId of nbIds) {
    out[nbId] = mergeQuickNotesForNb(b[nbId], l[nbId], r[nbId]);
  }
  return out;
}

// ---- localStorage-Cache-Format (v2: { v:2, notes, base } als EIN Paar) ----
// v0 war ein rohes Array (nur das Root-Notizbuch, vor Multi-Notizbuch), v1
// ein flaches { nbId: Notiz[] } ohne Basis. Beide migrieren mit
// base = {} (== "unbekannt", siehe oben) – KEINE Löschungen beim ersten
// Merge nach dem Formatwechsel, siehe DECISIONS #119.
export function parseQuickNotesCache(raw, rootNbId = "wissensbasis") {
  if (Array.isArray(raw)) {
    return { notes: normalizeQuickNotesMap({ [rootNbId]: raw }), base: {} };
  }
  if (raw && typeof raw === "object") {
    // v2 erkennt man an "v"===2 (Zahl) – ein v1-Notizbuch mit der Slug-ID
    // "v" hätte dort ein ARRAY stehen, nie die Zahl 2, Kollision damit
    // praktisch ausgeschlossen.
    if (raw.v === 2 && raw.notes && typeof raw.notes === "object" && !Array.isArray(raw.notes)) {
      return { notes: normalizeQuickNotesMap(raw.notes), base: normalizeQuickNotesMap(raw.base) };
    }
    return { notes: normalizeQuickNotesMap(raw), base: {} };
  }
  return { notes: {}, base: {} };
}

export function serializeQuickNotesCache(notes, base) {
  return { v: 2, notes: normalizeQuickNotesMap(notes), base: normalizeQuickNotesMap(base) };
}
