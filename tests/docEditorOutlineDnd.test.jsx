// @vitest-environment jsdom
//
// v7.26 (Nutzerwunsch "Kapitel und Abschnitte in der EDITOR-Gliederungsleiste
// per Drag&Drop umsortieren", NUR Edit-Modus): drei reine, exportierte
// Funktionen aus DocEditor.jsx, nach demselben Muster wie
// tests/docEditorOutline.test.jsx/tests/docEditorMath.test.jsx (echter
// TipTap/markdown-it-Zyklus statt String-Helfer nachzubauen):
//  1. computeOutlineRanges(doc) – Bereichs-Modell [from, to) je Eintrag.
//  2. validDropTargets(entries, draggedIndex) – reine, DOM-freie Regel-
//     Logik ("gültige Ziele je Drag-Level"), größtenteils OHNE Editor
//     testbar.
//  3. moveOutlineRange(editor, entries, draggedIndex, targetIndex) – die
//     eigentliche atomare Verschiebung (EINE Transaktion).
// Nur DIESE Datei braucht jsdom (per-Datei-Override), der Rest der Suite
// bleibt bei environment:"node" (vitest.config.js).
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { Markdown } from "tiptap-markdown";
import {
  extractOutline, computeOutlineRanges, validDropTargets, moveOutlineRange,
  FencedCodeBlock, MathInline, MathBlock, MdTable, unescapeMd,
} from "../src/components/DocEditor.jsx";
import { mathToPlaceholders } from "../src/lib/math.jsx";

function buildEditor(md) {
  return new Editor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, blockquote: false }),
      FencedCodeBlock,
      MathInline,
      MathBlock,
      MdTable.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({ html: true, bulletListMarker: "-", tightLists: true }),
    ],
    content: mathToPlaceholders(md),
  });
}

const save = (editor) => unescapeMd(editor.storage.markdown.getMarkdown());

// Positionen NIE hart verdrahten (fehleranfällig) – stattdessen aus dem
// ECHTEN extractOutline-Ergebnis nach Titel nachschlagen, exakt wie die
// Editor-Leiste selbst es täte.
const posOf = (outline, title) => outline.find((o) => o.text === title).pos;

/* ---------------------------------------------------------------------- */
/* computeOutlineRanges                                                    */
/* ---------------------------------------------------------------------- */

describe("computeOutlineRanges (reine Funktion, DocEditor.jsx, v7.26)", () => {
  it("Kapitel mit mehreren Abschnitten: H1-Bereich reicht bis zum NÄCHSTEN H1 (überspringt eigene H2-Kinder), H2-Bereich bis zur nächsten Überschrift gleich welchen Levels", () => {
    const md =
      "# T\n\n# Kapitel Eins\n\nVorspann-Text\n\n## Abschnitt A\n\ntext A\n\n## Abschnitt B\n\ntext B\n\n# Kapitel Zwei\n\n## Abschnitt C";
    const editor = buildEditor(md);
    const outline = extractOutline(editor.state.doc);
    const docEnd = editor.state.doc.content.size;
    const ranges = computeOutlineRanges(editor.state.doc);
    editor.destroy();
    const p = (t) => posOf(outline, t);

    expect(ranges).toEqual([
      { level: 1, title: "Kapitel Eins", from: p("Kapitel Eins"), to: p("Kapitel Zwei") },
      { level: 2, title: "Abschnitt A", from: p("Abschnitt A"), to: p("Abschnitt B") },
      { level: 2, title: "Abschnitt B", from: p("Abschnitt B"), to: p("Kapitel Zwei") },
      { level: 1, title: "Kapitel Zwei", from: p("Kapitel Zwei"), to: docEnd },
      { level: 2, title: "Abschnitt C", from: p("Abschnitt C"), to: docEnd },
    ]);
  });

  it("ein abschnittsloses (leeres) Kapitel bekommt trotzdem einen eigenen Bereich, der bis zum nächsten Kapitel reicht", () => {
    const md = "# T\n\n# Kapitel Eins\n\n## A\n\n# Leeres Kapitel\n\n# Kapitel Zwei\n\n## B";
    const editor = buildEditor(md);
    const outline = extractOutline(editor.state.doc);
    const ranges = computeOutlineRanges(editor.state.doc);
    editor.destroy();
    const p = (t) => posOf(outline, t);
    const leer = ranges.find((r) => r.title === "Leeres Kapitel");
    expect(leer).toEqual({ level: 1, title: "Leeres Kapitel", from: p("Leeres Kapitel"), to: p("Kapitel Zwei") });
  });

  it("ein H2 VOR dem ersten H1 (implizites Kapitel) bekommt einen Bereich bis zum ersten echten H1", () => {
    const md = "# T\n\n## Vorher\n\ntext\n\n# Kapitel Eins\n\n## A";
    const editor = buildEditor(md);
    const outline = extractOutline(editor.state.doc);
    const ranges = computeOutlineRanges(editor.state.doc);
    editor.destroy();
    const p = (t) => posOf(outline, t);
    expect(ranges[0]).toEqual({ level: 2, title: "Vorher", from: p("Vorher"), to: p("Kapitel Eins") });
  });

  it("die Titelzeile (Position 0) ist NIE Teil eines Bereichs – weder ziehbar noch Ziel", () => {
    const md = "# T\n\n# Kapitel Eins\n\n## A";
    const editor = buildEditor(md);
    const ranges = computeOutlineRanges(editor.state.doc);
    editor.destroy();
    expect(ranges.length).toBe(2);
    expect(ranges.every((r) => r.from > 0)).toBe(true);
  });

  it("das letzte Kapitel UND der letzte Abschnitt reichen bis zum Dokumentende", () => {
    const md = "# T\n\n# Einziges Kapitel\n\n## Einziger Abschnitt";
    const editor = buildEditor(md);
    const docEnd = editor.state.doc.content.size;
    const ranges = computeOutlineRanges(editor.state.doc);
    editor.destroy();
    expect(ranges[0].to).toBe(docEnd);
    expect(ranges[1].to).toBe(docEnd);
  });

  it("wirft nie bei fehlendem/kaputtem Doc-Argument und liefert eine leere Liste ohne jede Überschrift", () => {
    expect(computeOutlineRanges(null)).toEqual([]);
    expect(computeOutlineRanges(undefined)).toEqual([]);
    const editor = buildEditor("Nur Fließtext ohne Überschrift.");
    expect(computeOutlineRanges(editor.state.doc)).toEqual([]);
    editor.destroy();
  });
});

/* ---------------------------------------------------------------------- */
/* validDropTargets                                                        */
/* ---------------------------------------------------------------------- */

describe("validDropTargets (reine Funktion, DocEditor.jsx, v7.26)", () => {
  // Modell: Kapitel A (mit A1, A2), Kapitel B (LEER, keine H2), Kapitel C
  // (mit C1) – Bereiche/Positionen aus einem ECHTEN Dokument bezogen (siehe
  // computeOutlineRanges-Tests oben), damit hier keine erfundenen, ggf.
  // inkonsistenten Positionen getestet werden.
  const md = "# T\n\n# A\n\n## A1\n\n## A2\n\n# B\n\n# C\n\n## C1";
  function ranges() {
    const editor = buildEditor(md);
    const r = computeOutlineRanges(editor.state.doc);
    editor.destroy();
    return r;
  }
  const idxOf = (entries, title) => entries.findIndex((e) => e.title === title);
  // Index === entries.length steht für "ans Dokumentende" (siehe Kopf-
  // kommentar von validDropTargets) – als lesbare Konstante statt einer
  // magischen Zahl in den Erwartungen unten.
  const DOC_END = (entries) => entries.length;

  it("H1 (Kapitel A): gültige Ziele sind NUR vor einem ANDEREN H1 oder Dokumentende – NIE eine H2-Grenze, und NICHT vor B (dort sitzt A bereits, No-op)", () => {
    const entries = ranges();
    const valid = validDropTargets(entries, idxOf(entries, "A"));
    expect(valid).toEqual([idxOf(entries, "C"), DOC_END(entries)]);
  });

  it("H1 ans Dokumentende: das LETZTE Kapitel (C) darf NICHT mehr ans Ende (No-op, es ist schon das letzte) – wohl aber vor A oder B", () => {
    const entries = ranges();
    const valid = validDropTargets(entries, idxOf(entries, "C"));
    expect(valid).toEqual([idxOf(entries, "A"), idxOf(entries, "B")]);
    expect(valid).not.toContain(DOC_END(entries));
  });

  it("H2 (Abschnitt A2, letzter Abschnitt in Kapitel A): darf vor A (in den impliziten Vorspann VOR das erste Kapitel), vor A1 (Umsortieren), vor C, vor C1 UND ans Dokumentende – NICHT vor sich selbst UND NICHT vor B (A2 sitzt schon direkt davor, No-op)", () => {
    const entries = ranges();
    const valid = validDropTargets(entries, idxOf(entries, "A2"));
    // "vor B" fehlt bewusst: A2 ist der letzte Abschnitt in Kapitel A und
    // grenzt schon direkt an B – das wäre ein No-op (siehe dragged.to).
    expect(valid).toEqual([
      idxOf(entries, "A"),
      idxOf(entries, "A1"),
      idxOf(entries, "C"),
      idxOf(entries, "C1"),
      DOC_END(entries),
    ]);
    expect(valid).not.toContain(idxOf(entries, "B"));
  });

  it("H2 darf in ein BISHER ABSCHNITTSLOSES Kapitel (B) verschoben werden – dessen einzige Grenze ('vor C') ist ein gültiges Ziel", () => {
    const entries = ranges();
    const valid = validDropTargets(entries, idxOf(entries, "A1"));
    expect(valid).toContain(idxOf(entries, "C")); // "vor C" == "Ende von B" == "in B hinein"
  });

  it("No-op-Filter beidseitig: weder der eigene Startindex noch der direkt danach folgende (identische Position) sind gültige Ziele", () => {
    const entries = ranges();
    const i = idxOf(entries, "A1");
    const valid = validDropTargets(entries, i);
    expect(valid).not.toContain(i); // Drop auf sich selbst
    expect(valid).not.toContain(i + 1); // direkt vor die eigene aktuelle Position (A2)
  });

  it("wirft nie und liefert [] bei kaputten/fehlenden Argumenten", () => {
    expect(validDropTargets(null, 0)).toEqual([]);
    expect(validDropTargets(undefined, 0)).toEqual([]);
    expect(validDropTargets([], 0)).toEqual([]);
    const entries = ranges();
    expect(validDropTargets(entries, -1)).toEqual([]);
    expect(validDropTargets(entries, 999)).toEqual([]);
  });
});

/* ---------------------------------------------------------------------- */
/* moveOutlineRange                                                        */
/* ---------------------------------------------------------------------- */

describe("moveOutlineRange (reine Funktion, DocEditor.jsx, v7.26)", () => {
  it("H1 vor ein anderes H1: verschiebt das GESAMTE Kapitel (samt Abschnitten) atomar, Reihenfolge der Gliederung stimmt danach", () => {
    const md = "# T\n\n# Kapitel Eins\n\n## A\n\n- x\n\n# Kapitel Zwei\n\n## B\n\n- y\n\n# Kapitel Drei\n\n## C";
    const editor = buildEditor(md);
    const entries = computeOutlineRanges(editor.state.doc);
    const dragged = entries.findIndex((e) => e.title === "Kapitel Drei");
    const target = entries.findIndex((e) => e.title === "Kapitel Eins");
    const ok = moveOutlineRange(editor, entries, dragged, target);
    expect(ok).toBe(true);
    const outline = extractOutline(editor.state.doc);
    expect(outline.map((o) => o.text)).toEqual(["Kapitel Drei", "C", "Kapitel Eins", "A", "Kapitel Zwei", "B"]);
    expect(save(editor)).toBe(
      "# T\n\n# Kapitel Drei\n\n## C\n\n# Kapitel Eins\n\n## A\n\n- x\n\n# Kapitel Zwei\n\n## B\n\n- y"
    );
    editor.destroy();
  });

  it("H1 ans Dokumentende: ein mittleres Kapitel wird zum letzten", () => {
    const md = "# T\n\n# Kapitel Eins\n\n## A\n\n# Kapitel Zwei\n\n## B\n\n# Kapitel Drei\n\n## C";
    const editor = buildEditor(md);
    const entries = computeOutlineRanges(editor.state.doc);
    const dragged = entries.findIndex((e) => e.title === "Kapitel Eins");
    const target = entries.length; // Dokumentende
    const ok = moveOutlineRange(editor, entries, dragged, target);
    expect(ok).toBe(true);
    expect(save(editor)).toBe(
      "# T\n\n# Kapitel Zwei\n\n## B\n\n# Kapitel Drei\n\n## C\n\n# Kapitel Eins\n\n## A"
    );
    editor.destroy();
  });

  it("H2 innerhalb desselben Kapitels: Umsortieren dreier Abschnitte", () => {
    const md = "# T\n\n# Kapitel\n\n## Abschnitt A\n\nText A\n\n## Abschnitt B\n\nText B\n\n## Abschnitt C\n\nText C";
    const editor = buildEditor(md);
    const entries = computeOutlineRanges(editor.state.doc);
    const dragged = entries.findIndex((e) => e.title === "Abschnitt C");
    const target = entries.findIndex((e) => e.title === "Abschnitt A");
    const ok = moveOutlineRange(editor, entries, dragged, target);
    expect(ok).toBe(true);
    expect(save(editor)).toBe(
      "# T\n\n# Kapitel\n\n## Abschnitt C\n\nText C\n\n## Abschnitt A\n\nText A\n\n## Abschnitt B\n\nText B"
    );
    editor.destroy();
  });

  it("H2 KAPITELÜBERGREIFEND in ein ANDERES (nicht-leeres) Kapitel verschieben", () => {
    const md = "# T\n\n# Kapitel Eins\n\n## A1\n\nText A1\n\n## A2\n\nText A2\n\n# Kapitel Zwei\n\n## B1\n\nText B1";
    const editor = buildEditor(md);
    const entries = computeOutlineRanges(editor.state.doc);
    const dragged = entries.findIndex((e) => e.title === "A2");
    const target = entries.findIndex((e) => e.title === "B1");
    const ok = moveOutlineRange(editor, entries, dragged, target);
    expect(ok).toBe(true);
    const outline = extractOutline(editor.state.doc);
    expect(outline.map((o) => o.text)).toEqual(["Kapitel Eins", "A1", "Kapitel Zwei", "A2", "B1"]);
    expect(save(editor)).toBe(
      "# T\n\n# Kapitel Eins\n\n## A1\n\nText A1\n\n# Kapitel Zwei\n\n## A2\n\nText A2\n\n## B1\n\nText B1"
    );
    editor.destroy();
  });

  it("H2 in ein BISHER ABSCHNITTSLOSES (leeres) Kapitel verschieben", () => {
    const md = "# T\n\n# Kapitel Eins\n\n## A\n\nText A\n\n# Leeres Kapitel\n\n# Kapitel Drei\n\n## C\n\nText C";
    const editor = buildEditor(md);
    const entries = computeOutlineRanges(editor.state.doc);
    const dragged = entries.findIndex((e) => e.title === "A");
    // "Ende von Leeres Kapitel" == "vor Kapitel Drei" (siehe validDropTargets-Test oben).
    const target = entries.findIndex((e) => e.title === "Kapitel Drei");
    const ok = moveOutlineRange(editor, entries, dragged, target);
    expect(ok).toBe(true);
    expect(save(editor)).toBe(
      "# T\n\n# Kapitel Eins\n\n# Leeres Kapitel\n\n## A\n\nText A\n\n# Kapitel Drei\n\n## C\n\nText C"
    );
    editor.destroy();
  });

  it("H2 aus dem impliziten Vorspann (H2 vor dem ersten echten H1) in ein Kapitel verschieben", () => {
    const md = "# T\n\n## Vorher\n\nVorher-Text\n\n# Kapitel Eins\n\n## Abschnitt A\n\nText A";
    const editor = buildEditor(md);
    const entries = computeOutlineRanges(editor.state.doc);
    const dragged = entries.findIndex((e) => e.title === "Vorher");
    const target = entries.findIndex((e) => e.title === "Abschnitt A");
    const ok = moveOutlineRange(editor, entries, dragged, target);
    expect(ok).toBe(true);
    expect(save(editor)).toBe(
      "# T\n\n# Kapitel Eins\n\n## Vorher\n\nVorher-Text\n\n## Abschnitt A\n\nText A"
    );
    editor.destroy();
  });

  it("No-op-Drops (auf sich selbst bzw. direkt vor die eigene aktuelle Position) verändern das Dokument NICHT – keine leere Transaktion in der History", () => {
    const md = "# T\n\n# Kapitel Eins\n\n# Kapitel Zwei";
    const editor = buildEditor(md);
    const entries = computeOutlineRanges(editor.state.doc);
    const before = save(editor);
    const canUndoBefore = editor.can().undo();
    const dragged = entries.findIndex((e) => e.title === "Kapitel Eins");
    const target = entries.findIndex((e) => e.title === "Kapitel Zwei"); // == dragged.to, No-op

    const r1 = moveOutlineRange(editor, entries, dragged, dragged); // Drop auf sich selbst
    const r2 = moveOutlineRange(editor, entries, dragged, target); // Drop direkt vor die aktuelle Position

    expect(r1).toBe(false);
    expect(r2).toBe(false);
    expect(save(editor)).toBe(before); // byte-identisch, keine Baseline-Verfälschung
    expect(editor.can().undo()).toBe(canUndoBefore); // keine neue Transaktion gelandet
    editor.destroy();
  });

  it("ein H1-Drag auf eine H2-Grenze (mitten in ein Kapitel) wird abgelehnt, selbst wenn direkt aufgerufen (Verteidigung in der Tiefe)", () => {
    const md = "# T\n\n# Kapitel Eins\n\n## A\n\n# Kapitel Zwei\n\n## B";
    const editor = buildEditor(md);
    const before = save(editor);
    const entries = computeOutlineRanges(editor.state.doc);
    const dragged = entries.findIndex((e) => e.title === "Kapitel Eins");
    const target = entries.findIndex((e) => e.title === "B"); // H2-Grenze, für H1 ungültig
    const ok = moveOutlineRange(editor, entries, dragged, target);
    expect(ok).toBe(false);
    expect(save(editor)).toBe(before);
    editor.destroy();
  });

  it("Undo stellt das Dokument nach einer Verschiebung EXAKT wieder her (ein Undo-Schritt genügt)", () => {
    const md = "# T\n\n# Kapitel Eins\n\n## A\n\n# Kapitel Zwei\n\n## B";
    const editor = buildEditor(md);
    const before = save(editor);
    const entries = computeOutlineRanges(editor.state.doc);
    const dragged = entries.findIndex((e) => e.title === "Kapitel Zwei");
    const target = entries.findIndex((e) => e.title === "Kapitel Eins");
    moveOutlineRange(editor, entries, dragged, target);
    expect(save(editor)).not.toBe(before);
    expect(editor.can().undo()).toBe(true);

    editor.commands.undo();
    expect(save(editor)).toBe(before);
    editor.destroy();
  });

  it("liefert false und lässt das Dokument unangetastet bei fehlendem Editor bzw. leeren/kaputten Argumenten", () => {
    const md = "# T\n\n# Kapitel Eins\n\n# Kapitel Zwei";
    const editor = buildEditor(md);
    const entries = computeOutlineRanges(editor.state.doc);
    const before = save(editor);
    expect(moveOutlineRange(null, entries, 0, 1)).toBe(false);
    expect(moveOutlineRange(editor, [], 0, 1)).toBe(false);
    expect(moveOutlineRange(editor, entries, 99, 1)).toBe(false); // dragged existiert nicht
    expect(moveOutlineRange(editor, entries, 0, "x")).toBe(false); // targetIndex kein number
    expect(save(editor)).toBe(before);
    editor.destroy();
  });

  it("Roundtrip nach einer Kapitel-Verschiebung bleibt byte-korrekt – inklusive Formel, Codeblock UND Tabelle im verschobenen Kapitel", () => {
    const kapitelZweiBody =
      "## B\n\nEs gilt $x^2$ hier.\n\n```js\nconst y = 1;\n```\n\n| F | V |\n| --- | --- |\n| $x^2$ | 4 |";
    const md = "# T\n\n# Kapitel Eins\n\n## A\n\n- x\n\n# Kapitel Zwei\n\n" + kapitelZweiBody;
    const editor = buildEditor(md);
    const entries = computeOutlineRanges(editor.state.doc);
    const dragged = entries.findIndex((e) => e.title === "Kapitel Zwei");
    const target = entries.findIndex((e) => e.title === "Kapitel Eins");
    const ok = moveOutlineRange(editor, entries, dragged, target);
    expect(ok).toBe(true);
    const out = save(editor);
    editor.destroy();
    expect(out).toBe(
      "# T\n\n# Kapitel Zwei\n\n" + kapitelZweiBody + "\n\n# Kapitel Eins\n\n## A\n\n- x"
    );
  });

  it("2-Zyklen-Stabilität: das Ergebnis einer Verschiebung bleibt auch bei einem ZWEITEN, unveränderten Lade-/Speicherzyklus byte-identisch (keine schleichende Drift)", () => {
    const md = "# T\n\n# Kapitel Eins\n\n## A\n\nEs gilt $x^2$ hier.\n\n# Kapitel Zwei\n\n## B\n\n```js\nx();\n```";
    const editor1 = buildEditor(md);
    const entries = computeOutlineRanges(editor1.state.doc);
    const dragged = entries.findIndex((e) => e.title === "Kapitel Zwei");
    const target = entries.findIndex((e) => e.title === "Kapitel Eins");
    moveOutlineRange(editor1, entries, dragged, target);
    const once = save(editor1);
    editor1.destroy();

    const editor2 = buildEditor(once);
    const twice = save(editor2);
    editor2.destroy();

    expect(twice).toBe(once);
  });
});
