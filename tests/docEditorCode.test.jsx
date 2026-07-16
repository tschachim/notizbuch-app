// @vitest-environment jsdom
//
// Echter TipTap-Roundtrip-Test für monospaced Codeblöcke (v7.7, wie
// tests/docEditorMath.test.jsx für Formeln): Statt nur String-Helfer zu
// prüfen, läuft hier ein vollständiger markdown-it/TipTap-Zyklus über die
// ECHTE FencedCodeBlock-Node (siehe DocEditor.jsx – EIGENER Serializer mit
// Zaun-Verlängerung, Re-Review-Fix K1 vom 2026-07-17: der tiptap-markdown-
// Standard-Serializer schreibt immer exakt drei Backticks und korrumpiert
// dadurch progressiv, sobald der Code-Inhalt selbst eine ```-Zeile enthält).
// Nur DIESE Datei braucht jsdom (per-Datei-Override), der Rest der Suite
// bleibt bei environment:"node" (vitest.config.js).
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { FencedCodeBlock, MathInline, MathBlock, unescapeMd } from "../src/components/DocEditor.jsx";
import { mathToPlaceholders, MATH_INLINE_TAG } from "../src/lib/math.jsx";

function buildEditor(md) {
  return new Editor({
    extensions: [
      // codeBlock:false + FencedCodeBlock: exakt die Verdrahtung aus
      // DocEditor.jsx – ein Test mit dem unveränderten StarterKit-
      // codeBlock würde die K1-Korruption NICHT abdecken (der Bug sitzt
      // im Standard-Serializer, den FencedCodeBlock ersetzt).
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, blockquote: false }),
      FencedCodeBlock,
      MathInline,
      MathBlock,
      Markdown.configure({ html: true, bulletListMarker: "-", tightLists: true }),
    ],
    content: mathToPlaceholders(md),
  });
}

// Simuliert genau das, was der No-op-Vergleich in DocEditor.jsx prüft:
// laden, sofort wieder speichern, ohne irgendetwas zu ändern.
function roundtrip(md) {
  const editor = buildEditor(md);
  const out = unescapeMd(editor.storage.markdown.getMarkdown());
  editor.destroy();
  return out;
}

describe("Editor-Roundtrip: Codeblock No-op (reines Laden + Speichern ändert nichts)", () => {
  it("einfacher Codeblock mit Sprach-Label bleibt byte-identisch", () => {
    const md = "# T\n\n## A\n\n```js\nconst x = 1;\n```";
    expect(roundtrip(md)).toBe(md);
  });

  it("Codeblock OHNE Sprach-Label bleibt byte-identisch", () => {
    const md = "# T\n\n## A\n\n```\nplain text\n```";
    expect(roundtrip(md)).toBe(md);
  });

  it("mehrzeiliger Codeblock inkl. Leerzeilen im Inhalt bleibt byte-identisch", () => {
    const md = "# T\n\n## A\n\nVorher\n\n```python\ndef f():\n    return 1\n\n\ndef g():\n    return 2\n```\n\nNachher";
    expect(roundtrip(md)).toBe(md);
  });

  it("Codeblock im Dokument neben Text/Formel bleibt beides byte-identisch", () => {
    const md = "# T\n\n## A\n\nEs gilt $a^2+b^2=c^2$.\n\n```bash\necho \"hi\"\n```\n\nEnde.";
    expect(roundtrip(md)).toBe(md);
  });
});

describe("Editor-Roundtrip: Codeblock-Inhalt bleibt vor Formel-/Escape-Pfaden geschützt (Roundtrip-Pflicht)", () => {
  it("Dollarzeichen im Code werden NICHT zu Formel-Nodes", () => {
    const md = "# T\n\n## A\n\n```bash\necho \"$HOME und $1 kosten $5\"\n```";
    const editor = buildEditor(md);
    let hasFormula = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "mathInline" || node.type.name === "mathBlock") hasFormula = true;
    });
    editor.destroy();
    expect(hasFormula).toBe(false);
    expect(roundtrip(md)).toBe(md);
  });

  it("$$-Zeile INNERHALB eines Codeblocks bleibt Text, wird NICHT zum Formel-Block", () => {
    const md = "# T\n\n## A\n\n```text\nPreis:\n$$\nkeine Formel, nur Text\n$$\n```";
    const editor = buildEditor(md);
    let hasFormula = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "mathBlock") hasFormula = true;
    });
    editor.destroy();
    expect(hasFormula).toBe(false);
    expect(roundtrip(md)).toBe(md);
  });

  it("Backslashes, die wie Serializer-Escapes aussehen (\\., \\-, \\_, \\*), bleiben im Code unangetastet", () => {
    const md = "# T\n\n## A\n\n```js\nconst re = /\\d+\\.\\d+/;\nconst n = a - 1_000 * 2;\n```";
    expect(roundtrip(md)).toBe(md);
  });

  it("Pipe-Zeichen im Code wird nicht als Tabellen-Trenner fehlinterpretiert", () => {
    const md = "# T\n\n## A\n\n```bash\nls | grep foo | wc -l\n```";
    expect(roundtrip(md)).toBe(md);
  });

  it("einzelne/inline Backticks im Code-Inhalt bleiben erhalten", () => {
    const md = "# T\n\n## A\n\n```md\nSchreibe `code` fuer Inline-Code.\n```";
    expect(roundtrip(md)).toBe(md);
  });

  it("spitze Klammern/HTML-artiger Text im Code werden nicht als Markup interpretiert", () => {
    const md = "# T\n\n## A\n\n```html\n<span style=\"color:red\">x</span>\n```";
    expect(roundtrip(md)).toBe(md);
  });
});

describe("Editor-Roundtrip: K1-Fix (Zaun-Verlängerung bei Backtick-Serien im Inhalt)", () => {
  it("ein Codeblock, dessen Inhalt selbst eine ```-Zeile enthält, bleibt über ZWEI Roundtrips byte-identisch", () => {
    // Genau das im Review empirisch belegte Korruptions-Szenario (P1):
    // ein 4-Backtick-Außenzaun um einen Inhalt mit zwei 3-Backtick-Zeilen.
    const md = "# T\n\n## A\n\n````js\nBeispiel:\n```\ninner\n```\n````";
    const once = roundtrip(md);
    expect(once).toBe(md); // No-op: byte-identisch, kein Zerfall
    const twice = roundtrip(once);
    expect(twice).toBe(once); // Idempotent: kein progressiver Zerfall bei erneutem Laden+Speichern
  });

  it("nachträglich in einen Codeblock getippter ```-Text erzwingt beim Speichern einen verlängerten Zaun", () => {
    // Simuliert den trivialen Trigger aus dem Review: Toolbar-Knopf
    // "Codeblock" -> Markdown-Beispiel MIT Fence-Zeilen eintippen -> speichern.
    const md = "# T\n\n## A\n\n```js\nold\n```";
    const editor = buildEditor(md);
    let pos = null;
    editor.state.doc.descendants((node, p) => {
      if (pos === null && node.type.name === "codeBlock") pos = p;
    });
    expect(pos).not.toBeNull();
    editor.chain().command(({ tr }) => {
      tr.insertText("Beispiel:\n```\ninner\n```", pos + 1, pos + 1 + "old".length);
      return true;
    }).run();
    const out = unescapeMd(editor.storage.markdown.getMarkdown());
    editor.destroy();
    expect(out).toBe("# T\n\n## A\n\n````js\nBeispiel:\n```\ninner\n```\n````");
    // Erneutes Laden dieses Ergebnisses bleibt stabil (kein Zerfall bei
    // der nächsten Bearbeitungsrunde).
    expect(roundtrip(out)).toBe(out);
  });

  it("zwei aufeinanderfolgende Codeblöcke mit unterschiedlich langen inneren Zäunen bleiben unabhängig korrekt", () => {
    const md = "# T\n\n## A\n\n````js\na\n```\nb\n```\n````\n\n```py\nc\n```";
    expect(roundtrip(md)).toBe(md);
  });
});

describe("Editor-Ladepfad: P10-Fix (Re-Review 2026-07-17) – unterminierter Zaun leakt keinen Formel-Platzhalter mehr", () => {
  it("$x$ NACH einer unterminierten Zaun-Zeile wird beim Laden NICHT zu einer echten mathInline-Node (kein Tag-Leak in den von markdown-it verschluckten Codeblock)", () => {
    // GIGO-Fall wie im Review beschrieben: eine abgeschnittene Modell-
    // antwort ohne schließenden Zaun. markdown-it liest ALLES darunter als
    // EINEN Codeblock - ohne den P10-Fix in mathToPlaceholders würde $x$
    // vorher zu einem <math-inline>-Tag, das dann als Literaltext INNERHALB
    // dieses Codeblocks landet, statt korrekt roh zu bleiben.
    const md = "# T\n\n## A\n\nVorher $a$ noch normal.\n\n```js\nkein Ende hier, echte Formel $x$ drin.";
    const editor = buildEditor(md);
    let mathCount = 0;
    let codeText = null;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "mathInline") mathCount++;
      if (node.type.name === "codeBlock") codeText = node.textContent;
    });
    editor.destroy();
    // Genau EINE echte Formel (das "$a$" VOR dem unterminierten Zaun) -
    // kein zweiter mathInline-Knoten für das "$x$" danach.
    expect(mathCount).toBe(1);
    expect(codeText).not.toBeNull();
    expect(codeText).not.toContain(MATH_INLINE_TAG);
    expect(codeText).toContain("$x$");
  });

  it("Formel vor dem unterminierten Zaun bleibt erhalten; der Zaun wird beim Speichern strukturell geschlossen (kein $x$-Leak, danach stabil)", () => {
    // GIGO-Input (kein Schluss-Zaun) - anders als bei einem vollständigen
    // Dokument ist das gespeicherte Ergebnis hier NICHT byte-identisch zum
    // Original: markdown-it verschluckt den Rest in EINEN Codeblock-KNOTEN,
    // und jeder ProseMirror-Knoten serialisiert sich zwangsläufig mit einem
    // SCHLIESSENDEN Zaun (strukturell unmöglich, "unterminiert" zu bleiben,
    // sobald er als Node existiert - siehe Re-Review-Finding P10). Im
    // echten DocEditor.jsx betrifft das die No-op-Erkennung NICHT (die
    // vergleicht gegen die frisch beim Laden serialisierte Baseline, nicht
    // gegen das Roh-Markdown, siehe DocEditor.jsx onCreate/save). Wichtig
    // ist NUR: kein Formel-Tag leakt in den Codeblock, die echte Formel
    // DAVOR bleibt erhalten, und ein zweiter Speichervorgang ist stabil.
    const md = "# T\n\n## A\n\nVorher $a$ noch normal.\n\n```js\nkein Ende hier, echte Formel $x$ drin.";
    const once = roundtrip(md);
    expect(once).toBe(md + "\n```"); // Schluss-Zaun wird strukturell ergänzt
    expect(once).not.toContain(MATH_INLINE_TAG);
    expect(once).toContain("$a$"); // die echte Formel VOR dem Zaun bleibt erhalten
    expect(once).toContain("$x$"); // im Code roh erhalten, keine Formel geworden
    const twice = roundtrip(once);
    expect(twice).toBe(once); // ab hier stabil (once ist ein normales, korrekt geschlossenes Dokument)
  });
});

describe("Editor-Roundtrip: echte Bearbeitung eines Codeblocks", () => {
  it("Text im Codeblock ändern und speichern liefert den neuen Inhalt im Fence", () => {
    const md = "# T\n\n## A\n\n```js\nold();\n```";
    const editor = buildEditor(md);
    let pos = null;
    editor.state.doc.descendants((node, p) => {
      if (pos === null && node.type.name === "codeBlock") pos = p;
    });
    expect(pos).not.toBeNull();
    editor.chain().command(({ tr }) => {
      tr.insertText("new();", pos + 1, pos + 1 + "old();".length);
      return true;
    }).run();
    const out = unescapeMd(editor.storage.markdown.getMarkdown());
    editor.destroy();
    expect(out).toBe("# T\n\n## A\n\n```js\nnew();\n```");
  });

  it("toggleCodeBlock verwandelt einen Absatz in einen Codeblock", () => {
    const md = "# T\n\n## A\n\nNormaler Text";
    const editor = buildEditor(md);
    editor.chain().focus().setTextSelection(editor.state.doc.content.size - 1).toggleCodeBlock().run();
    const out = unescapeMd(editor.storage.markdown.getMarkdown());
    editor.destroy();
    expect(out).toBe("# T\n\n## A\n\n```\nNormaler Text\n```");
  });
});
