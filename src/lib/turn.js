/* ------------------------------------------------------------------ */
/* Turn-Atomarität, Verwerfungsregel, Override (v7.54, DECISIONS #112)  */
/* ------------------------------------------------------------------ */
/* Ersetzt (rein, reproduzierbar) den bisherigen Drei-Phasen-Block in     */
/* App.jsx#send (Z. 1675-1748, v7.53): Phase 1 (applyOpsDetailed je       */
/* Gruppe), Phase 2 (turnGuard.js#planTurn, UNVERÄNDERT als Teilregel -   */
/* Leitplanke 0.1), Phase 3 (Neu-Anwendung der gefilterten Ops NACH einem */
/* Hold) plus NEU: Phase 4, verify.js#verifyTurn je Gruppe, und die       */
/* Entscheidung (4.3), ob der GESAMTE Turn verworfen wird. App.jsx macht  */
/* nur noch I/O (Commit/Rendering) - die gesamte Entscheidungslogik lebt  */
/* hier, reproduzierbar testbar ohne GitHub/Anthropic-API.               */
/* ------------------------------------------------------------------ */

import { applyOpsDetailed, DELIBERATE_NOOP_REASON } from "./ops.js";
import { planTurn } from "./turnGuard.js";
import { verifyTurn, sanitizeDiagFragment, DIAG_MAX, DESTRUCTIVE_OP_TYPES } from "./verify.js";

// Re-Export (EINE Quelle der Wahrheit, siehe verify.js-Kopfkommentar) - das
// Modulschnitt-Kapitel der Spezifikation führt DESTRUCTIVE_OP_TYPES als Export
// von turn.js; die eigentliche Definition liegt bei verify.js (V2/V3 brauchen
// sie ebenfalls, ein Import von turn.js aus verify.js wäre zirkulär).
export { DESTRUCTIVE_OP_TYPES };

const REJECT_LINE_MAX = 400;

/* --------------------------------- evaluateTurn ----------------------------- */
// groups: [{ nbId, name, ops, before }] - "before" ist der Phase-1-Snapshot
// (docCache.current[nbId] zum Zeitpunkt des send()-Aufrufs, siehe App.jsx).
// Rein, wirft nie absichtlich (defensive Guards statt try/catch, damit ein
// echter Fehler in einer neuen Invariante NICHT stillschweigend verschluckt
// wird - anders als verify.js selbst, das explizit "wirft nie" verspricht,
// ist evaluateTurn() der Ort, an dem ein Programmierfehler sichtbar bleiben
// soll).
export function evaluateTurn(groups, opts = {}) {
  const list = (Array.isArray(groups) ? groups : []).filter((g) => g && typeof g === "object" && g.nbId != null);

  // Phase 1: unveränderter Snapshot je Gruppe.
  const phase1 = list.map((g) => {
    const before = typeof g.before === "string" ? g.before : "";
    const ops = Array.isArray(g.ops) ? g.ops : [];
    const detailed = applyOpsDetailed(before, ops);
    return { nbId: g.nbId, name: g.name || String(g.nbId), before, ops, text: detailed.text, results: detailed.results };
  });

  // Phase 2: Cross-Notizbuch-Turn-Guard (turnGuard.js, UNVERÄNDERT).
  const guard = planTurn(phase1);

  // Phase 3 + 4: gefilterte Ops erneut anwenden (nur wenn der Guard tatsächlich
  // etwas zurückgehalten hat - ohne Hold ist Phase 1 bereits Phase 3, keine
  // zweite Anwendung nötig, Leitplanke "byte-identisch"), dann verifyTurn().
  const groupsOut = phase1.map((g) => {
    const filtered = guard.filteredOps.get(g.nbId) || g.ops;
    const held = filtered.length !== g.ops.length;
    const detailed2 = held ? applyOpsDetailed(g.before, filtered) : { text: g.text, results: g.results };
    const finalOps = filtered;
    const text = detailed2.text;
    const results = detailed2.results;
    const verify = verifyTurn(g.before, text, finalOps, { notebookName: g.name, results });
    return {
      nbId: g.nbId, name: g.name, before: g.before, ops: g.ops, finalOps,
      text, results, verify, changed: text !== g.before, lostLines: verify.stats.lostLines,
    };
  });

  // Sammeln (4.1 Schritt 5): notApplied = Engine-Skips je Gruppe (in
  // Ergebnisreihenfolge), danach die Guard-Holds (bereits im richtigen
  // {type,heading,notebook,reason}-Format, siehe turnGuard.js#planTurn).
  const notApplied = [];
  for (const g of groupsOut) {
    for (const r of g.results) {
      if (r && r.applied === false && r.reason !== DELIBERATE_NOOP_REASON) {
        notApplied.push({ type: r.type, heading: r.heading, notebook: g.name, reason: r.reason });
      }
    }
  }
  for (const n of guard.notApplied || []) notApplied.push(n);

  const infos = [];
  const createdInfos = [];
  const softInfos = [];
  for (const g of groupsOut) {
    for (const r of g.results) {
      if (r && r.applied === true && r.note) infos.push({ type: r.type, heading: r.heading, notebook: g.name, reason: r.note });
    }
    const hasRewrite = g.finalOps.some((o) => o && o.type === "rewrite");
    if (hasRewrite && g.verify.created && g.verify.created.length) {
      const label = g.verify.created.map((c) => (c.level === 1 ? "# " : "## ") + c.title).join(", ");
      const chapterPart = g.verify.created[0].chapter ? ' in „' + g.verify.created[0].chapter + '“' : "";
      createdInfos.push({ type: null, heading: null, notebook: g.name, reason: "rewrite hat angelegt: " + label + chapterPart });
    }
    // Nacharbeit Runde 3 (🟡, dreifaches Präfix): verify.js liefert Soft-
    // Texte jetzt bereits EINHEITLICH mit "Prüfhinweis: " (ohne ℹ️) - turn.js
    // stellt kein zweites Präfix mehr davor, buildOpsInfo (App.jsx) ergänzt
    // als EINZIGER verbleibender Absender "ℹ️ Hinweis: ". Vorher: "ℹ️
    // Hinweis: Prüfhinweis: ℹ️ Prüfhinweis: …" (drei Präfixe für denselben
    // Sachverhalt).
    for (const s of g.verify.soft || []) softInfos.push({ reason: s.text });
  }

  // Entscheidung (4.3): (H) irgendeine Gruppe mit verify.hard.length>0, oder
  // (A) zugleich Skip (nach Guard-Filter) + applied:true + destruktiver
  // finalOps-Typ IN DERSELBEN Gruppe.
  //
  // Nacharbeit Runde 3 (🟡, #65-Muster bei hard+atomic in DERSELBEN Gruppe):
  // die Atomaritätsprüfung (A) lief bisher NUR im "else"-Zweig NACH einem
  // hard-Kurzschluss ("continue") - trägt eine Gruppe ZUGLEICH einen
  // hard-Verstoß UND das (A)-Muster, bekam der Reason bisher NUR kind:"hard"
  // OHNE das atomic-Flag; overrideOpsFor() filterte dadurch KEINE
  // destruktiven Ops heraus, obwohl die Ziel-Op weiterhin skippt (Override
  // hätte die Quelle gelöscht, ohne das Ziel je geschrieben zu haben). Fix:
  // (A) wird für JEDE Gruppe VOR dem hard-Kurzschluss berechnet und als
  // "atomic"-Flag am Reason mitgeführt - overrideOpsFor/App.jsx#
  // overrideButtonLabel prüfen künftig "kind === 'atomic' || atomic" statt
  // nur "kind === 'atomic'".
  const reasons = [];
  for (const g of groupsOut) {
    const skip = g.results.find((r) => r && r.applied === false && r.reason !== DELIBERATE_NOOP_REASON);
    const appliedOne = g.results.find((r) => r && r.applied === true);
    const hasDestructiveFinal = g.finalOps.some((o) => o && DESTRUCTIVE_OP_TYPES.has(o.type));
    const atomic = !!(skip && appliedOne && hasDestructiveFinal);
    if (g.verify.hard && g.verify.hard.length) {
      const text = g.verify.hard.map((v) => v.code + " – " + v.text).join("; ");
      reasons.push({ nbId: g.nbId, name: g.name, kind: "hard", atomic, codes: g.verify.hard.map((v) => v.code), text: sanitizeDiagFragment(text) });
      continue;
    }
    if (atomic) {
      const skipLabel = (skip.type || "Op") + (skip.heading ? ' „' + sanitizeDiagFragment(skip.heading) + '“' : "");
      const appliedLabel = (appliedOne.type || "Op") + (appliedOne.heading ? ' „' + sanitizeDiagFragment(appliedOne.heading) + '“' : "");
      const text = "A – Turn nicht teilweise übernommen – " + skipLabel + " übersprungen (Grund siehe unten), während " + appliedLabel + " bereits gewirkt hätte";
      reasons.push({ nbId: g.nbId, name: g.name, kind: "atomic", atomic: true, codes: ["A"], text: sanitizeDiagFragment(text) });
    }
  }

  return {
    rejected: reasons.length > 0,
    reasons,
    groups: groupsOut,
    notApplied,
    infos,
    createdInfos,
    softInfos,
    guard,
  };
}

/* ------------------------------ buildRejectWarning --------------------------- */
// Pillentext (4.5): Zeile 1 = Präfix + je Gruppe "«Name»: " + bereits fertig
// zusammengesetzter Reason-Text (kind-übergreifend), Kappung 400 Zeichen.
// Zeile 2 = der UNVERÄNDERTE opsWarning-Block (Leitplanke 0.2, kein
// Doppel-Feedback) - nur angehängt, wenn vorhanden.
export function buildRejectWarning(plan, opsWarning) {
  if (!plan || !plan.rejected) return opsWarning || null;
  const groupTexts = (plan.reasons || []).map((r) => sanitizeDiagFragment(r.name) + ": " + r.text);
  let line1 = "⚠️ Änderung verworfen (nichts gespeichert): " + groupTexts.join("; ");
  if (line1.length > REJECT_LINE_MAX) line1 = line1.slice(0, REJECT_LINE_MAX - 1) + "…";
  return opsWarning ? line1 + "\n" + opsWarning : line1;
}

/* ------------------------------ buildTurnDiagnosis (B2) ---------------------- */
// Für den In-Turn-Retry (B2, v7.55) vorbereitet - B1 exportiert die Funktion
// bereits (Modulschnitt-Tabelle), genutzt wird sie erst in anthropic.js#
// callClaude#retryWith (Stufe B2). Budget: 800 gesamt, je Gruppe mindestens
// 250 Zeichen.
export function buildTurnDiagnosis(plan) {
  if (!plan || !plan.rejected || !plan.reasons || !plan.reasons.length) return "";
  const perGroup = Math.max(250, Math.floor(DIAG_MAX / plan.reasons.length));
  const parts = plan.reasons.map((r) => {
    let text = "„" + sanitizeDiagFragment(r.name) + "“: " + r.text;
    if (text.length > perGroup) text = text.slice(0, perGroup - 1) + "…";
    return text;
  });
  let out = "VERWORFEN – nichts gespeichert. " + parts.join(" ");
  if (out.length > DIAG_MAX) out = out.slice(0, DIAG_MAX - 1) + "…";
  return out;
}

/* --------------------------------- overrideOpsFor ---------------------------- */
// Override-Ops (4.4, K-🟡7): Gruppen mit einem atomic-Grund (kind:"atomic"
// ODER kind:"hard" MIT gesetztem atomic-Flag - Nacharbeit Runde 3, 🟡, siehe
// evaluateTurn oben) verlieren ALLE Ops mit type in DESTRUCTIVE_OP_TYPES
// (dieselbe Filter-Mechanik wie der Guard) - der Override vollzieht damit
// NIE das #65-/#103-2-Muster (Quelle weg, Ziel nie geschrieben), auch dann
// nicht, wenn dieselbe Gruppe ZUSÄTZLICH einen hard-Verstoß trägt. Gruppen
// mit AUSSCHLIESSLICH hard-Gründen (kein atomic-Muster) ODER ohne
// Reject-Grund behalten finalOps unverändert (bewusste Nutzerentscheidung
// bzw. nichts zu überschreiben). "plan.reasons" trägt maximal EINEN Eintrag
// je Gruppe (siehe evaluateTurn: "continue" nach dem hard-Treffer).
export function overrideOpsFor(plan) {
  const map = new Map();
  if (!plan || !Array.isArray(plan.groups)) return map;
  for (const g of plan.groups) {
    const reason = (plan.reasons || []).find((r) => r.nbId === g.nbId);
    if (reason && (reason.kind === "atomic" || reason.atomic)) {
      map.set(g.nbId, g.finalOps.filter((o) => !(o && DESTRUCTIVE_OP_TYPES.has(o.type))));
    } else {
      map.set(g.nbId, g.finalOps);
    }
  }
  return map;
}
