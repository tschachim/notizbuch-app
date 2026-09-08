// v7.54 (Vorschlag B Stufe 1, DECISIONS #112): Tests für src/lib/turn.js -
// Entscheidungsregeln (H)/(A), Turn-Guard-Verhältnis, Override-Op-Filter,
// Diagnose-Wortlaute, Sanitisierung. evaluateTurn() ist rein (kein I/O) -
// jeder Test übergibt Gruppen mit before/ops direkt, keine Mocks nötig.
import { describe, it, expect } from "vitest";
import {
  evaluateTurn, buildRejectWarning, buildTurnDiagnosis, overrideOpsFor, mergeRetryMemoryOps, DESTRUCTIVE_OP_TYPES,
} from "../src/lib/turn.js";
import { applyOps, applyOpsDetailed, MAX_OPS } from "../src/lib/ops.js";

describe("evaluateTurn: Verwerfungsregel (H)/(A)", () => {
  it("rejected durch (H): rewrite-Verlust", () => {
    const before = "# Buch\n\n## X\n\n- a\n- b\n- c\n![Bild](img:x)\n";
    const after = "# Buch\n\n## X\n\n- a\n"; // Bild + Kapitelname-Verlust simuliert per rewrite
    const ops = [{ type: "rewrite", content: after }];
    const plan = evaluateTurn([{ nbId: "a", name: "A", ops, before }]);
    expect(plan.rejected).toBe(true);
    expect(plan.reasons[0].kind).toBe("hard");
    expect(plan.reasons[0].codes).toContain("V3-R");
  });

  it("rejected durch (A) intra-Notizbuch: append wrong_level geskippt + delete_section applied", () => {
    const before = "# Buch\n\n## Quelle\n\n- Punkt A\n\n# Kapitel\n\n## Bereich\n\n### Details\n\n- d\n";
    const ops = [
      { type: "replace_section", heading: "### Details", chapter: "# Kapitel", content: "- d\n- Punkt A" },
      { type: "delete_section", heading: "## Quelle" },
    ];
    const plan = evaluateTurn([{ nbId: "a", name: "A", ops, before }]);
    expect(plan.rejected).toBe(true);
    expect(plan.reasons[0].kind).toBe("atomic");
    expect(plan.reasons[0].codes).toEqual(["A"]);
  });

  it("NICHT rejected: Überführen-Muster nur mit Skip (nichts gewirkt, C32-Ausgang c)", () => {
    const before = "# Buch\n\n## Quelle\n\n- Punkt A\n\n# Kapitel\n\n## Bereich\n\n### Details\n\n- d\n";
    const ops = [{ type: "move_entry", entry: "Punkt A", from_heading: "## Quelle", to_heading: "### Details" }];
    const plan = evaluateTurn([{ nbId: "a", name: "A", ops, before }]);
    expect(plan.rejected).toBe(false);
    expect(plan.groups[0].text).toBe(before); // wrong_level -> Skip, nichts gewirkt
    expect(plan.notApplied.length).toBe(1);
  });

  it("NICHT rejected: Skip + Append OHNE destruktive Op in derselben Gruppe", () => {
    const before = "# Buch\n\n## X\n\n- x\n";
    const ops = [
      { type: "append_to_section", heading: "## X", content: "- neu" },
      { type: "append_to_section", heading: "### Falsch", content: "- geht nicht" }, // level-Fehler, aber append ist nicht destruktiv
    ];
    const plan = evaluateTurn([{ nbId: "a", name: "A", ops, before }]);
    expect(plan.rejected).toBe(false);
  });

  it("NICHT rejected: Deliberate-No-op + delete (No-op zählt nicht als Skip im Sinne von A)", () => {
    const before = "# Buch\n\n## X\n\n- x\n\n## Y\n\n- y\n";
    const ops = [
      { type: "append_to_section", heading: "## X", content: "- x" }, // No-op (bereits vorhanden -> keine inhaltliche Änderung)
      { type: "delete_entry", entry: "y", heading: "## Y" },
    ];
    const plan = evaluateTurn([{ nbId: "a", name: "A", ops, before }]);
    expect(plan.rejected).toBe(false);
  });

  it("Cross-Notizbuch-Hold -> NICHT rejected (C30, Guard bleibt Teilregel)", () => {
    // Notizbuch B ist "chaptered" (echtes "# Bestehend"-Kapitel) - die
    // Ziel-Op lässt "chapter" bewusst WEG -> chaptered_doc-Skip (Vorschlag A,
    // DECISIONS #111: kein stiller Anlageort mehr im letzten Kapitel).
    const groups = [
      { nbId: "a", name: "A", before: "# A\n\n## Quelle\n\n- Punkt\n", ops: [{ type: "delete_entry", entry: "Punkt", heading: "## Quelle" }] },
      { nbId: "b", name: "B", before: "# B\n\n# Bestehend\n\n## Ziel\n\n- vorhanden\n", ops: [{ type: "append_to_section", heading: "## Neu", content: "- x" }] },
    ];
    const plan = evaluateTurn(groups);
    const groupB = plan.groups.find((g) => g.nbId === "b");
    expect(groupB.results[0].applied).toBe(false); // Vorbedingung: Ziel-Op ist wirklich ein Skip
    expect(plan.rejected).toBe(false);
    // Guard hält die Quell-Löschung zurück -> Notizbuch A bleibt unverändert
    const groupA = plan.groups.find((g) => g.nbId === "a");
    expect(groupA.text).toBe(groupA.before);
  });

  it("Ziel-Gruppe mit Skip + applied append + destruktiver Op -> rejected (A)", () => {
    const before = "# Buch\n\n## Inbox\n\n- x\n\n# Projekt\n\n## Aufgaben\n\n- a1\n";
    const ops = [
      { type: "append_to_chapter", chapter: "# Projekt", content: "- x" },
      { type: "delete_section", heading: "## Inbox", chapter: "# Nicht vorhanden" },
    ];
    const plan = evaluateTurn([{ nbId: "a", name: "A", ops, before }]);
    expect(plan.rejected).toBe(true);
    expect(plan.reasons[0].kind).toBe("atomic");
  });

  it("MAX_OPS-Kappung: 21 Ops werden auf MAX_OPS gekappt, kein Absturz", () => {
    const before = "# Buch\n\n## X\n\n- x\n";
    const ops = Array.from({ length: 21 }, (_, i) => ({ type: "append_to_section", heading: "## X", content: "- Zeile " + i }));
    expect(ops.length).toBeGreaterThan(MAX_OPS);
    const plan = evaluateTurn([{ nbId: "a", name: "A", ops, before }]);
    expect(plan.groups[0].results.length).toBe(MAX_OPS);
  });
});

describe("evaluateTurn: Sammeln (notApplied/infos/createdInfos/softInfos)", () => {
  it("infos leer bei rejected (App rendert nichts, wird aber trotzdem gesammelt für den Override)", () => {
    const before = "# Buch\n\n# KPIs\n\n- a\n";
    const after = "# Buch\n\n# KPIs\n\n## KPIs\n\n- a\n";
    const ops = [{ type: "rewrite", content: after }];
    const plan = evaluateTurn([{ nbId: "a", name: "A", ops, before }]);
    expect(plan.rejected).toBe(true);
    // createdInfos bleibt bewusst POPULIERT (Override-Pfad braucht die Daten
    // der URSPRÜNGLICHEN Bewertung, ruft evaluateTurn() nicht erneut auf).
    expect(Array.isArray(plan.createdInfos)).toBe(true);
  });

  it("createdInfos nur bei rewrite", () => {
    const before = "# Buch\n\n## X\n\n- a\n";
    const opsRewrite = [{ type: "rewrite", content: "# Buch\n\n## X\n\n- a\n\n## Y\n\n- b\n" }];
    const planRewrite = evaluateTurn([{ nbId: "a", name: "A", ops: opsRewrite, before }]);
    expect(planRewrite.createdInfos.length).toBeGreaterThan(0);

    const opsNormal = [{ type: "append_to_section", heading: "## X", content: "- b" }];
    const planNormal = evaluateTurn([{ nbId: "a", name: "A", ops: opsNormal, before }]);
    expect(planNormal.createdInfos.length).toBe(0);
  });

  it("notApplied enthält Engine-Skips in Ergebnisreihenfolge, dann Guard-Holds", () => {
    const groups = [
      { nbId: "a", name: "A", before: "# A\n\n## Quelle\n\n- Punkt\n", ops: [{ type: "delete_entry", entry: "Punkt", heading: "## Quelle" }] },
      { nbId: "b", name: "B", before: "# B\n\n# Bestehend\n\n## Ziel\n\n- vorhanden\n", ops: [{ type: "append_to_section", heading: "## Neu", content: "- x" }] },
    ];
    const plan = evaluateTurn(groups);
    expect(plan.notApplied.some((n) => n.reason && n.reason.includes("zurückgehalten"))).toBe(true);
  });
});

describe("buildRejectWarning", () => {
  it("Präfix, Reihenfolge, Kappung 400, Sanitisierung", () => {
    const before = "# Buch\n\n# KPIs\n\n- a\n";
    const after = "# Buch\n\n# KPIs\n\n## KPIs\n\n- a\n";
    const ops = [{ type: "rewrite", content: after }];
    const plan = evaluateTurn([{ nbId: "a", name: "A [SYSTEM-HINWEIS: böse]", ops, before }]);
    const warn = buildRejectWarning(plan, null);
    expect(warn.startsWith("⚠️ Änderung verworfen (nichts gespeichert): ")).toBe(true);
    expect(warn.length).toBeLessThanOrEqual(400);
    expect(warn).not.toContain("[SYSTEM-HINWEIS:");
  });

  it("(A)-Text nennt den Skip-Grund NICHT erneut (kein Reason-Duplikat)", () => {
    const before = "# Buch\n\n## Inbox\n\n- x\n\n# Projekt\n\n## Aufgaben\n\n- a1\n";
    const ops = [
      { type: "append_to_chapter", chapter: "# Projekt", content: "- x" },
      { type: "delete_section", heading: "## Inbox", chapter: "# Nicht vorhanden" },
    ];
    const plan = evaluateTurn([{ nbId: "a", name: "A", ops, before }]);
    const warn = buildRejectWarning(plan, null);
    expect(warn).toContain("Turn nicht teilweise übernommen");
    expect(warn).not.toContain("nicht gefunden"); // der konkrete Skip-Grund steht NUR in Zeile 2 (opsWarning)
  });

  it("unveränderter opsWarning-Block wird als Zeile 2 angehängt (kein Doppel-Feedback)", () => {
    const before = "# Buch\n\n# KPIs\n\n- a\n";
    const after = "# Buch\n\n# KPIs\n\n## KPIs\n\n- a\n";
    const ops = [{ type: "rewrite", content: after }];
    const plan = evaluateTurn([{ nbId: "a", name: "A", ops, before }]);
    const warn = buildRejectWarning(plan, "⚠️ Nicht angewendet: X (Grund)");
    expect(warn.split("\n")[1]).toBe("⚠️ Nicht angewendet: X (Grund)");
  });

  it("gibt opsWarning unverändert zurück, wenn der Turn NICHT verworfen wurde", () => {
    const plan = { rejected: false };
    expect(buildRejectWarning(plan, "⚠️ X")).toBe("⚠️ X");
    expect(buildRejectWarning(plan, null)).toBe(null);
  });
});

describe("buildTurnDiagnosis (B2-Vorbereitung)", () => {
  it("leer, wenn nicht verworfen", () => {
    expect(buildTurnDiagnosis({ rejected: false, reasons: [] })).toBe("");
    expect(buildTurnDiagnosis(null)).toBe("");
  });

  it("2 Notizbücher bleiben <= 800, Präfix VERWORFEN", () => {
    const groups = [
      { nbId: "a", name: "Notizbuch A mit langem Namen", before: "# A\n\n# KPIs\n\n- a\n", ops: [{ type: "rewrite", content: "# A\n\n# KPIs\n\n## KPIs\n\n- a\n" }] },
      { nbId: "b", name: "Notizbuch B mit langem Namen", before: "# B\n\n# Themen\n\n- a\n", ops: [{ type: "rewrite", content: "# B\n\n# Themen\n\n## Themen\n\n- a\n" }] },
    ];
    const plan = evaluateTurn(groups);
    expect(plan.rejected).toBe(true);
    const diag = buildTurnDiagnosis(plan);
    expect(diag.startsWith("VERWORFEN")).toBe(true);
    expect(diag.length).toBeLessThanOrEqual(800);
  });
});

describe("overrideOpsFor", () => {
  it("entfernt bei atomic ALLE destruktiven Typen, lässt Rest unverändert", () => {
    const before = "# Buch\n\n## Inbox\n\n- x\n\n# Projekt\n\n## Aufgaben\n\n- a1\n";
    const ops = [
      { type: "append_to_chapter", chapter: "# Projekt", content: "- x" },
      { type: "delete_section", heading: "## Inbox", chapter: "# Nicht vorhanden" },
    ];
    const plan = evaluateTurn([{ nbId: "a", name: "A", ops, before }]);
    const overrides = overrideOpsFor(plan);
    const overrideOps = overrides.get("a");
    expect(overrideOps.some((o) => DESTRUCTIVE_OP_TYPES.has(o.type))).toBe(false);
    expect(overrideOps.some((o) => o.type === "append_to_chapter")).toBe(true);
  });

  it("lässt hard-Gruppen unverändert (finalOps bleiben, bewusste Nutzerentscheidung)", () => {
    const before = "# Buch\n\n# KPIs\n\n- a\n";
    const after = "# Buch\n\n# KPIs\n\n## KPIs\n\n- a\n";
    const ops = [{ type: "rewrite", content: after }];
    const plan = evaluateTurn([{ nbId: "a", name: "A", ops, before }]);
    const overrides = overrideOpsFor(plan);
    expect(overrides.get("a")).toEqual(plan.groups[0].finalOps);
    expect(overrides.get("a").some((o) => o.type === "rewrite")).toBe(true);
  });

  it("Gruppen ohne Verwerfungsgrund behalten finalOps unverändert", () => {
    const before = "# Buch\n\n## X\n\n- x\n";
    const ops = [{ type: "append_to_section", heading: "## X", content: "- neu" }];
    const plan = evaluateTurn([{ nbId: "a", name: "A", ops, before }]);
    const overrides = overrideOpsFor(plan);
    expect(overrides.get("a")).toEqual(plan.groups[0].finalOps);
  });

  it("leerer/kaputter Plan wirft nicht, liefert leere Map", () => {
    expect(overrideOpsFor(null).size).toBe(0);
    expect(overrideOpsFor({}).size).toBe(0);
    expect(overrideOpsFor(undefined).size).toBe(0);
  });

  // Nacharbeit Runde 3 (🟡, Finding 2, Probe C): eine Gruppe trägt ZUGLEICH
  // einen hard-Verstoß (V2-H2 Resend in "## Log") UND das Atomaritätsmuster
  // (A) - Op 0 (append_to_section auf ein "###"-Unterthema als heading)
  // wird geskippt (wrong_level), Op 1 (delete_entry) wirkt UND ist
  // destruktiv. VORHER bekam der Reason NUR kind:"hard" ohne atomic-Flag,
  // overrideOpsFor() filterte deshalb KEINE destruktiven Ops - der Override
  // hätte "Punkt A" gelöscht, obwohl die Ziel-Op (Details) weiterhin
  // skippt (#65-Muster). NACHHER trägt der Reason zusätzlich atomic:true,
  // overrideOpsFor() filtert delete_entry heraus.
  it("filtert bei hard+atomic in DERSELBEN Gruppe ebenfalls alle destruktiven Typen heraus (Nacharbeit Runde 3, 🟡 Finding 2, Probe C)", () => {
    const before = "# Buch\n\n## Quelle\n\n- Punkt A lang genug fuer den Test\n\n## Log\n\n- Log Zeile eins ausreichend lang fuer den Test\n- Log Zeile zwei ausreichend lang fuer den Test\n\n# Kapitel\n\n## Bereich\n\n### Details\n\n- d\n";
    const ops = [
      { type: "append_to_section", heading: "### Details", chapter: "# Kapitel", content: "- x" },
      { type: "delete_entry", entry: "Punkt A", heading: "## Quelle" },
      {
        type: "append_to_section", heading: "## Log",
        content: "- Log Zeile eins ausreichend lang fuer den Test\n- Log Zeile zwei ausreichend lang fuer den Test",
      },
    ];
    const plan = evaluateTurn([{ nbId: "x", name: "X", ops, before }]);
    expect(plan.rejected).toBe(true);
    expect(plan.reasons).toHaveLength(1);
    expect(plan.reasons[0].kind).toBe("hard");
    expect(plan.reasons[0].atomic).toBe(true);
    expect(plan.reasons[0].codes).toEqual(["V2"]);
    const overrideOps = overrideOpsFor(plan).get("x");
    expect(overrideOps.some((o) => o.type === "delete_entry")).toBe(false);
    const text = applyOpsDetailed(before, overrideOps).text;
    expect(text).toContain("Punkt A");
  });

  it("reine hard-Gruppe OHNE Atomaritätsmuster bekommt atomic:false und bleibt ungefiltert (Kontrolle Finding 2)", () => {
    const before = "# Buch\n\n# KPIs\n\n- a\n";
    const after = "# Buch\n\n# KPIs\n\n## KPIs\n\n- a\n";
    const ops = [{ type: "rewrite", content: after }];
    const plan = evaluateTurn([{ nbId: "a", name: "A", ops, before }]);
    expect(plan.reasons[0].kind).toBe("hard");
    expect(plan.reasons[0].atomic).toBe(false);
    expect(overrideOpsFor(plan).get("a")).toEqual(plan.groups[0].finalOps);
  });
});

describe("lostLines-Zählung", () => {
  it("zählt gelöschte Zeilen für das Override-Label", () => {
    const before = "# Buch\n\n## X\n\n- a\n- b\n- c\n";
    const ops = [{ type: "delete_section", heading: "## X" }];
    const plan = evaluateTurn([{ nbId: "a", name: "A", ops, before }]);
    expect(plan.groups[0].lostLines).toBeGreaterThan(0);
  });

  it("bleibt bei einer reinen Anlage-Op bei 0", () => {
    const before = "# Buch\n\n## X\n\n- a\n";
    const ops = [{ type: "append_to_section", heading: "## X", content: "- b" }];
    const plan = evaluateTurn([{ nbId: "a", name: "A", ops, before }]);
    expect(plan.groups[0].lostLines).toBe(0);
  });
});

describe("Robustheit / Randfälle", () => {
  it("evaluateTurn mit leeren/kaputten Gruppen wirft nicht", () => {
    expect(() => evaluateTurn(undefined)).not.toThrow();
    expect(() => evaluateTurn(null)).not.toThrow();
    expect(() => evaluateTurn([])).not.toThrow();
    expect(() => evaluateTurn([null, undefined, 5, {}])).not.toThrow();
    const plan = evaluateTurn([]);
    expect(plan.rejected).toBe(false);
    expect(plan.groups).toEqual([]);
  });

  it("Guard bleibt byte-identisch: applyOps(before, finalOps) === text (Regressionspin)", () => {
    const before = "# Buch\n\n## X\n\n- a\n";
    const ops = [{ type: "append_to_section", heading: "## X", content: "- b" }];
    const plan = evaluateTurn([{ nbId: "a", name: "A", ops, before }]);
    expect(applyOps(before, plan.groups[0].finalOps)).toBe(plan.groups[0].text);
  });
});

// Review-Fix (🔵 1, v7.55.1, DECISIONS #113 Abschluss-Delta): App.jsx#send's
// pointer_only-Retry-Zweig übernahm bisher blind replanned.memoryOps -
// POINTER_ONLY_RETRY_DIAGNOSIS fragt aber gezielt NUR die fehlende
// Notizbuch-Antwort nach, der Retry liefert deshalb regelmäßig ops:[] OHNE
// im Erstversuch geplante memory_*-Ops zu wiederholen (der Retry "vergisst"
// sie nicht bewusst - das Thema kommt in seiner eigenen Diagnose gar nicht
// vor). Reiner Helfer, unabhängig von App.jsx/anthropic.js testbar.
describe("mergeRetryMemoryOps (Review-Fix 🔵 1, DECISIONS #113 Abschluss-Delta)", () => {
  it("Retry liefert KEINE Ops (leeres Array) → Erstversuch-Ops bleiben erhalten (der eigentliche Live-Bug)", () => {
    const first = [{ type: "memory_add", text: "mag TT.MM.JJJJ" }];
    expect(mergeRetryMemoryOps(first, [])).toBe(first);
  });

  it("Retry liefert EIGENE Ops → Retry gewinnt (unverändert 'letzter Versuch gewinnt')", () => {
    const first = [{ type: "memory_add", text: "alt" }];
    const retry = [{ type: "memory_add", text: "neu" }];
    expect(mergeRetryMemoryOps(first, retry)).toBe(retry);
  });

  it("beide leer → leeres Array (kein Fehler, keine Phantom-Ops)", () => {
    expect(mergeRetryMemoryOps([], [])).toEqual([]);
  });

  it("Erstversuch ohne Gedächtnis-Ops, Retry liefert welche → Retry-Ops werden übernommen", () => {
    const retry = [{ type: "memory_add", text: "neu aus Retry" }];
    expect(mergeRetryMemoryOps([], retry)).toBe(retry);
  });

  it("fehlende/kaputte Eingaben (undefined/null/Nicht-Array) werfen nicht, wirken wie leere Listen", () => {
    expect(mergeRetryMemoryOps(undefined, undefined)).toEqual([]);
    expect(mergeRetryMemoryOps(null, null)).toEqual([]);
    expect(mergeRetryMemoryOps("kaputt", 5)).toEqual([]);
    const first = [{ type: "memory_add", text: "bleibt" }];
    expect(mergeRetryMemoryOps(first, null)).toBe(first);
  });
});
