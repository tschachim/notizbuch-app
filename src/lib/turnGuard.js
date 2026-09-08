/* ------------------------------------------------------------------ */
/* Cross-Notizbuch-Turn-Guard (v7.53 Teil 3, DECISIONS #111 Entscheidung 5) */
/* ------------------------------------------------------------------ */
import { MAX_OPS, DELIBERATE_NOOP_REASON } from "./ops.js";

// Anlass: v7.53 (Stufe 2 von Vorschlag A) macht Ziel-Ops auch MIT korrekt
// gesetztem "chapter" in bestimmten Fällen (wrong_level/title/R-CONTENT/
// ambiguous …) zu einem Skip. App.jsx#send committet die Notizbuch-Gruppen
// eines Turns bisher UNABHÄNGIG voneinander: eine bereits erfolgreich
// angewendete Quell-Löschung in Notizbuch X, während die zugehörige Ziel-Op
// in Notizbuch Y an einer dieser neuen Invarianten scheitert, ist das
// #65-Muster – der Inhalt landet nirgends mehr im aktuellen Dokumentstand,
// nur noch in der Git-Historie.
//
// Dieses Modul liefert dafür einen rein lesenden, reinen Plan (KEINE
// Dokument-Mutation, KEIN I/O) – App.jsx#send führt die eigentliche
// Neu-Anwendung/den Commit selbst aus (siehe dortiger Kommentar zu den drei
// Phasen). Regel (bewusst klein, additiv, siehe DECISIONS #111 Entscheidung
// 5): scheitert in EINER Gruppe G eine TARGET_WRITE-Op (append_to_section,
// replace_section, append_to_chapter – die Ops, die typischerweise das
// ZIEL eines Verschiebens sind), werden in JEDER ANDEREN Gruppe alle
// SOURCE_DESTRUCTIVE-Ops (delete_section, delete_entry, delete_chapter,
// replace_section – die Ops, die typischerweise die QUELLE eines
// Verschiebens löschen) zurückgehalten, unabhängig davon, ob sie selbst
// ohnehin schon anwendbar gewesen wären (Typ-basiert, nicht Ergebnis-
// basiert – "im Zweifel eher zu vorsichtig als zu spät" gilt hier stärker
// als ein exakter Reason-Text). "rewrite" ist bewusst NICHT in
// SOURCE_DESTRUCTIVE enthalten: ein rewrite-Verlust-Guard ist eine größere
// Änderung (Vorher/Nachher-Diff nötig, um "destruktiv" zu erkennen) und
// bleibt laut DECISIONS #111 ein offenes Restrisiko bis Vorschlag B.
// memory_*-Ops sind nie betroffen – sie laufen bereits VOR diesem Modul über
// App.jsx#splitOps in einen eigenen Pfad (commitMemory), nie durch
// applyOpsDetailed/planCrossNotebookHold.

// Op-Typen, die typischerweise ein VERSCHIEBE-ZIEL adressieren – ein
// applied:false hier ist der Auslöser des Guards.
const TARGET_WRITE_TYPES = new Set(["append_to_section", "replace_section", "append_to_chapter"]);

// Op-Typen, die typischerweise eine VERSCHIEBE-QUELLE löschen – diese
// werden in den ÜBRIGEN Gruppen zurückgehalten, wenn irgendwo eine
// TARGET_WRITE-Op scheitert. replace_section steht bewusst in BEIDEN Sets:
// als Ziel (überschreibt einen Abschnitt) UND als potenziell destruktive
// Quelle (überschreibt/verwirft bestehenden Inhalt) – siehe Spec Teil 3.
const SOURCE_DESTRUCTIVE_TYPES = new Set(["delete_section", "delete_entry", "delete_chapter", "replace_section"]);

// v7.53 Teil 3: eigene, bracket-sichere Sanitisierung für die HIER neu
// zusammengesetzten Warn-Texte (Notizbuchname/Op-Typ/Heading/Skip-Grund der
// AUSLÖSENDEN Op landen als eingebettete Fragmente in einem NEUEN Satz,
// siehe holdReason() unten) – describeOpItems() in App.jsx sanitisiert nur
// die TOP-LEVEL-Felder eines notApplied-Eintrags (type/heading/notebook),
// NICHT den bereits fertig zusammengesetzten reason-String selbst (der wird
// dort unverändert in Klammern angehängt). ops.js exportiert sein eigenes
// sanitizeForWarning() nicht – ein eigenständiger, aber IDENTISCHER Baustein
// hier vermeidet einen App.jsx-Import in ein src/lib-Modul UND einen neuen
// Export nur für diesen einen Zweck. Schicht 2 (lib/anthropic.js#callClaude)
// bleibt als Sicherheitsnetz zusätzlich bestehen (siehe DECISIONS,
// zweischichtige Sanitisierung).
const GUARD_TEXT_MAX = 160;
function sanitizeGuardText(s) {
  const noNul = String(s || "").split(String.fromCharCode(0)).join("");
  const collapsed = noNul.replace(/\s+/g, " ").trim();
  const bracketsSafe = collapsed.replace(/\[/g, "(").replace(/\]/g, ")");
  return bracketsSafe.length > GUARD_TEXT_MAX ? bracketsSafe.slice(0, GUARD_TEXT_MAX) + "…" : bracketsSafe;
}

// Reiner Plan: welche Op-Indizes werden je Notizbuch-Gruppe zurückgehalten,
// UND weswegen (die auslösende Ziel-Op – für den Warn-Text). "groups" =
// [{ nbId, name, ops, results }] – "results" stammt aus applyOpsDetailed()
// auf dem NOCH UNVERÄNDERTEN docCache-Stand (App.jsx#send Phase 1, VOR jedem
// Commit); "index" in results[] entspricht 1:1 der Position in "ops"
// (applyOpsDetailed nummeriert seine results-Liste exakt in Op-Reihenfolge).
// Rückgabe: Map<nbId, { held: Set<index>, because: { notebook, type,
// heading, reason } }> – NUR für Gruppen mit tatsächlichen Holds; Gruppen
// ohne Hold tauchen im Ergebnis gar nicht auf (leere Map bei <2 Gruppen oder
// wenn nirgends eine TARGET_WRITE-Op scheitert).
//
// Bei MEHREREN auslösenden Gruppen (z. B. beide Gruppen eines Turns haben je
// eine gescheiterte TARGET_WRITE-Op, siehe Test "beide Gruppen mit Skips ->
// beide halten"): jede Gruppe kann von MEHREREN Auslösern betroffen sein,
// "held" ist dann die VEREINIGUNG aller betroffenen Indizes; "because" trägt
// den ERSTEN gefundenen Auslöser (Dokumentreihenfolge der übergebenen
// "groups" – dieselbe "erster Treffer gewinnt"-Konvention wie im Rest der
// App) – der Warn-Text nennt damit IMMER einen konkreten, tatsächlich
// zutreffenden Grund, auch wenn theoretisch mehrere zugleich gelten.
export function planCrossNotebookHold(groups) {
  const list = Array.isArray(groups) ? groups.filter((g) => g && typeof g === "object") : [];
  const holds = new Map();
  if (list.length < 2) return holds; // Guard braucht mindestens zwei Notizbücher im selben Turn.

  for (const g of list) {
    const results = Array.isArray(g.results) ? g.results : [];
    // v7.53 Nacharbeit Runde 3 (Review-Fund 🔵 6): ein bewusster No-op
    // (Op wäre inhaltlich identisch mit dem Bestand, applyOne() hat also
    // NICHTS geändert – reason === DELIBERATE_NOOP_REASON, siehe ops.js)
    // ist KEIN Auslöser für den Guard. Ohne diesen Ausschluss würde z. B.
    // ein nach einem SHA-Konflikt erneut gesendetes, inzwischen bereits
    // vorhandenes replace_section eine Wiederholungsschleife erzeugen: der
    // No-op-Skip hielte die Quell-Löschung in JEDER anderen Notizbuch-
    // Gruppe unnötig zurück, obwohl am Ziel inhaltlich nichts fehlt.
    const trigger = results.find(
      (r) => r && TARGET_WRITE_TYPES.has(r.type) && r.applied === false && r.reason !== DELIBERATE_NOOP_REASON
    );
    if (!trigger) continue;

    for (const other of list) {
      if (other.nbId === g.nbId) continue; // niemals die eigene Gruppe halten
      const otherResults = Array.isArray(other.results) ? other.results : [];
      const destructiveIdx = [];
      otherResults.forEach((r, idx) => {
        if (r && SOURCE_DESTRUCTIVE_TYPES.has(r.type)) destructiveIdx.push(idx);
      });
      if (!destructiveIdx.length) continue;

      let entry = holds.get(other.nbId);
      if (!entry) {
        entry = {
          held: new Set(),
          because: { notebook: g.name, type: trigger.type, heading: trigger.heading, reason: trigger.reason },
        };
        holds.set(other.nbId, entry);
      }
      for (const idx of destructiveIdx) entry.held.add(idx);
    }
  }
  return holds;
}

// Baut aus dem "because"-Fragment eines Holds den fertigen notApplied-Grund
// (Wortlaut aus dem Auftrag, verbindlich) – alle eingebetteten Felder
// (Op-Typ/Heading der AUSLÖSENDEN Op, deren Notizbuchname, deren eigener
// Skip-Grund) laufen EINZELN durch sanitizeGuardText(), bevor sie in den
// neuen Satz eingebettet werden (Klammer-/SYSTEM-HINWEIS-sicher, auch wenn
// der Skip-Grund selbst schon über ops.js#sanitizeForWarning lief – zweite,
// unabhängige Schicht statt blindem Vertrauen in die Quelle).
export function holdReason(because) {
  const b = because || {};
  const type = sanitizeGuardText(b.type);
  const heading = sanitizeGuardText(b.heading);
  const notebook = sanitizeGuardText(b.notebook);
  // v7.53 Nacharbeit Runde 3 (Review-Fund 🔵 9b): ein leeres "reason"-
  // Fragment (weil "because" defensiv unvollständig war/because.reason
  // selbst leer ist) ergäbe ohne Fallback "übersprungen ()" – eine leere
  // Klammer ohne jeden Aussagewert. "ohne Grund" ist ein bewusst neutraler
  // Platzhalter statt der Leerklammer (praktisch nur erreichbar über einen
  // defensiven/unvollständigen "because"-Aufruf, siehe Tests).
  const reason = sanitizeGuardText(b.reason) || "ohne Grund";
  const headingPart = heading ? ' „' + heading + '“' : "";
  return "zurückgehalten – Ziel-Op " + type + headingPart + ' in „' + notebook + '“ übersprungen (' + reason +
    "); Quelle bleibt unverändert, Ziel-Op korrigieren und Quell-Op erneut senden";
}

// Höherwertiger, ebenfalls reiner Helfer (App.jsx#send lagert die Filter-/
// notApplied-Logik hierher aus, statt sie inline zu bauen – DRY UND einzeln
// testbar): "groups" wie bei planCrossNotebookHold(), Rückgabe
// { holds, filteredOps: Map<nbId, ops[]>, notApplied: [...] }. "filteredOps"
// enthält für JEDE übergebene Gruppe eine Op-Liste (bei einem Hold OHNE die
// zurückgehaltenen Indizes, sonst unverändert die Original-Liste) – der
// Aufrufer wendet diese Liste per applyOpsDetailed() ERNEUT an – auf den
// LIVE-Cache-Stand ("base", nicht den Phase-1-Snapshot; siehe App.jsx#send
// und DECISIONS #111, Nacharbeit Runde 3) (Phase 3). Führt
// SELBST keine Dokument-Operation aus (kein applyOpsDetailed-Aufruf hier) –
// bleibt dadurch unabhängig von einem konkreten Dokumentstand testbar.
export function planTurn(groups) {
  const list = Array.isArray(groups) ? groups.filter((g) => g && typeof g === "object") : [];
  const holds = planCrossNotebookHold(list);
  const filteredOps = new Map();
  const notApplied = [];

  for (const g of list) {
    // v7.53 Nacharbeit Runde 3 (Review-Fund 🟡 2): SELBE Kappung wie
    // ops.js#applyOpsDetailed – "g.results" (aus Phase 1) hat maximal
    // MAX_OPS Einträge, "index" in "held" bezieht sich also NUR auf diesen
    // Bereich. Ohne dieses .slice() hier würde das nachfolgende
    // ops.filter(...) auf der UNGEKAPPTEN Liste arbeiten: entfernt man
    // daraus gehaltene Indizes < MAX_OPS, rücken Ops JENSEITS von Index
    // MAX_OPS - 1 (nie von Phase 1 bewertet, auch potenziell destruktive)
    // in den neuen Kappungsbereich nach und würden in Phase 3 UNGEPRÜFT
    // committet – genau die Lücke, die dieser Guard eigentlich schließen
    // soll. .slice() nur ANWENDEN, wenn tatsächlich gekappt werden muss
    // (sonst dieselbe Referenz wie vorher – erhält den bestehenden
    // "keine Kopie nötig, wenn nichts gefiltert wird"-Vertrag/die
    // zugehörigen toBe()-Pins in tests/turnGuard.test.js unverändert).
    const opsAll = Array.isArray(g.ops) ? g.ops : [];
    const ops = opsAll.length > MAX_OPS ? opsAll.slice(0, MAX_OPS) : opsAll;
    const entry = holds.get(g.nbId);
    if (!entry) {
      filteredOps.set(g.nbId, ops);
      continue;
    }
    filteredOps.set(g.nbId, ops.filter((_, idx) => !entry.held.has(idx)));
    const reason = holdReason(entry.because);
    // KEIN Array.isArray-Fallback für "g.results" nötig: existiert "entry"
    // (also holds.get(g.nbId)), hat planCrossNotebookHold() für GENAU
    // dieses g bereits ein g.results als gültiges Array mit mindestens
    // einem destruktiven Treffer gelesen (sonst wäre destructiveIdx dort
    // leer geblieben und g hätte nie einen Eintrag bekommen) – "results[idx]"
    // bleibt trotzdem defensiv per "|| {}" abgesichert (Set-Iteration und
    // Array-Länge sind unabhängige Datenquellen). Dokumentreihenfolge der
    // Indizes (Set behält Einfüge-Reihenfolge, die hier aufsteigend ist,
    // siehe planCrossNotebookHold) – deterministische Reihenfolge der
    // notApplied-Einträge.
    for (const idx of entry.held) {
      const rr = g.results[idx] || {};
      notApplied.push({ type: rr.type, heading: rr.heading, notebook: g.name, reason });
    }
  }
  return { holds, filteredOps, notApplied };
}
