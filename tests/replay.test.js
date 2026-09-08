// v7.54 (Vorschlag B Stufe 1, DECISIONS #112, Spec 7.2): Replay-Korpus -
// jeder Fall in evals/corpus/*.json wird gegen applyOpsDetailed() (rohes
// Engine-Ergebnis) UND evaluateTurn() (Gate) laufen gelassen. Sicherheits-
// versprechen: NIE ein stiller schädlicher Commit - entweder verwirft das
// Gate, ODER der Text bleibt unverändert, ODER das rohe Engine-Ergebnis
// respektiert bereits die Dokument-Invarianten des Falls.
import fs from "node:fs";
import { describe, it, expect } from "vitest";
import { applyOpsDetailed, applyOps } from "../src/lib/ops.js";
import { evaluateTurn } from "../src/lib/turn.js";

const corpusDir = new URL("../evals/corpus/", import.meta.url);
const files = fs.readdirSync(corpusDir).filter((f) => f.endsWith(".json")).sort();

function loadCase(file) {
  const raw = fs.readFileSync(new URL(file, corpusDir), "utf8");
  return JSON.parse(raw);
}

function invariantsHold(text, expect_) {
  const mustNotContain = expect_.mustNotContain || [];
  const mustKeepLines = expect_.mustKeepLines || [];
  const maxCountOf = expect_.maxCountOf || {};
  for (const frag of mustNotContain) if (text.includes(frag)) return false;
  for (const line of mustKeepLines) if (!text.includes(line)) return false;
  for (const [frag, max] of Object.entries(maxCountOf)) {
    const count = text.split(frag).length - 1;
    if (count > max) return false;
  }
  return true;
}

// Nur die drei mechanisch eindeutig unterscheidbaren Ausgänge werden
// klassifiziert - "applied_with_note" (Kollisions-Umleitung, v7.52-ℹ️-Kanal)
// und "commit" (regulär angewendet) sind aus Sicht des Gates identisch
// (angewendet, nicht verworfen); die feinere Unterscheidung ist reine
// Beschreibung des ENGINE-Verhaltens (siehe recorded note-Texte), kein vom
// Gate selbst geprüftes Kriterium. Korpus-Dateien listen deshalb bewusst
// BEIDE Label als zulässig, wo eine Note vorkommt.
function classifyOutcome(plan, doc, text) {
  if (plan.rejected) return "rejected";
  if (text === doc) return "skip";
  return "commit";
}

describe("Replay-Korpus (evals/corpus/*.json)", () => {
  it("Korpus ist nicht versehentlich leer", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s", (file) => {
    const c = loadCase(file);
    expect(c.id).toBeTruthy();
    expect(typeof c.doc).toBe("string");
    expect(Array.isArray(c.recordedOps)).toBe(true);

    const { text } = applyOpsDetailed(c.doc, c.recordedOps);
    const plan = evaluateTurn([{ nbId: "x", name: c.notebook || "Notizbuch", ops: c.recordedOps, before: c.doc }]);

    // (5) Regressionspin: applyOps === applyOpsDetailed(...).text
    expect(applyOps(c.doc, c.recordedOps)).toBe(text);

    // (1) nie ein stiller schädlicher Commit
    const safe = plan.rejected || text === c.doc || invariantsHold(text, c.expect);
    expect(safe, "Fall '" + c.id + "': weder verworfen noch unverändert noch invariant-konform").toBe(true);

    // (2) der eingetretene Ausgang ist einer der erwarteten
    const outcome = classifyOutcome(plan, c.doc, text);
    expect(c.expect.outcome, "Fall '" + c.id + "': Ausgang '" + outcome + "' nicht in expect.outcome").toContain(outcome);

    // (3) bei Commit OHNE Verwerfung gelten die Dokument-Invarianten
    if (!plan.rejected && text !== c.doc) {
      expect(invariantsHold(text, c.expect), "Fall '" + c.id + "': Invarianten verletzt trotz Commit").toBe(true);
    }

    // (4) bei rejected: codes/kinds enthalten die erwarteten Mindestmengen.
    // "V3" im Korpus meint sowohl die nicht-rewrite-Variante (Code "V3") als
    // auch die rewrite-Ratio-Variante (Code "V3-R", eigener Code seit der
    // Invarianten-Matrix) - Prefix-Vergleich statt exaktem String, die
    // KORPUS-FÄLLE-Kurzschreibweise unterscheidet die beiden bewusst nicht.
    if (plan.rejected) {
      const codes = plan.reasons.flatMap((r) => r.codes);
      const kinds = plan.reasons.map((r) => r.kind);
      for (const code of c.expect.hardIfApplied || []) {
        const hit = codes.some((cd) => cd === code || cd.startsWith(code + "-"));
        expect(hit, "Fall '" + c.id + "': erwarteter Code " + code + " fehlt in " + JSON.stringify(codes)).toBe(true);
      }
      for (const kind of c.expect.rejectKinds || []) {
        expect(kinds, "Fall '" + c.id + "': erwarteter Kind " + kind + " fehlt in " + JSON.stringify(kinds)).toContain(kind);
      }
    }

    // (6) Anlage-Parität (K-🔵13): für Gruppen OHNE rewrite - jede
    // created-Überschrift (source "op") kommt normHeadV-gleich in
    // mindestens einem results[].note mit "neu angelegt" vor, UND jede
    // solche Note nennt eine created-Überschrift (Relation, keine 1:1-
    // Gleichheit der Anzahl - eine Op kann Kapitel+Abschnitt in EINER Note
    // anlegen).
    const hasRewrite = c.recordedOps.some((o) => o && o.type === "rewrite");
    if (!hasRewrite) {
      const created = plan.groups[0].verify.created.filter((cr) => cr.source === "op");
      const anlageNotes = plan.groups[0].results.filter((r) => r && r.applied && r.note && r.note.includes("neu angelegt"));
      const normV = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
      for (const cr of created) {
        const found = anlageNotes.some((n) => n.note.toLowerCase().includes(normV(cr.title)));
        expect(found, "Fall '" + c.id + "': created „" + cr.title + "“ hat keine passende Anlage-Note").toBe(true);
      }
      for (const n of anlageNotes) {
        const found = created.some((cr) => n.note.toLowerCase().includes(normV(cr.title)));
        expect(found, "Fall '" + c.id + "': Anlage-Note „" + n.note + "“ nennt keine created-Überschrift").toBe(true);
      }
    }
  });
});

describe("Kontrollfälle sind nicht-vakuös", () => {
  it("control-rewrite-umgliederung.json committet tatsächlich (keine Verwerfung)", () => {
    const c = loadCase("control-rewrite-umgliederung.json");
    const plan = evaluateTurn([{ nbId: "x", name: c.notebook, ops: c.recordedOps, before: c.doc }]);
    expect(plan.rejected).toBe(false);
    expect(plan.groups[0].text).not.toBe(c.doc);
    expect(c.expect.outcome).toEqual(["commit"]);
  });

  it("control-mehrop-sequenz.json committet tatsächlich (keine Verwerfung)", () => {
    const c = loadCase("control-mehrop-sequenz.json");
    const plan = evaluateTurn([{ nbId: "x", name: c.notebook, ops: c.recordedOps, before: c.doc }]);
    expect(plan.rejected).toBe(false);
    expect(plan.groups[0].text).not.toBe(c.doc);
    expect(c.expect.outcome).toEqual(["commit"]);
  });
});
