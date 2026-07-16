// @vitest-environment jsdom
//
// Echter TipTap-Roundtrip-Test für Formeln (Review-Finding 6): Statt nur
// den String-Output von mathToPlaceholders zu prüfen, läuft hier ein
// vollständiger markdown-it/TipTap-Zyklus (Laden über die echten
// MathInline/MathBlock-Node-Erweiterungen + Speichern über den echten
// unescapeMd) – genau der Pfad, an dem Review-Findings 1-3 gefunden
// wurden. Nutzt @tiptap/core headless (ohne React/useEditor), damit kein
// DOM-Rendering von DocEditor selbst nötig ist; nur DIESE Datei braucht
// jsdom (per-Datei-Override), der Rest der Suite bleibt bei
// environment:"node" (vitest.config.js).
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { Markdown } from "tiptap-markdown";
import { MathInline, MathBlock, MdTable, unescapeMd } from "../src/components/DocEditor.jsx";
import { mathToPlaceholders } from "../src/lib/math.jsx";

function buildEditor(md, extraExtensions = []) {
  return new Editor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, blockquote: false }),
      MathInline,
      MathBlock,
      ...extraExtensions,
      Markdown.configure({ html: true, bulletListMarker: "-", tightLists: true }),
    ],
    content: mathToPlaceholders(md),
  });
}

// Simuliert genau das, was der No-op-Vergleich in DocEditor.jsx prüft:
// laden, sofort wieder speichern, ohne irgendetwas zu ändern.
function roundtrip(md, extraExtensions = []) {
  const editor = buildEditor(md, extraExtensions);
  const out = unescapeMd(editor.storage.markdown.getMarkdown());
  editor.destroy();
  return out;
}

// Simuliert eine echte Bearbeitung: die erste gefundene Formel-Node (nach
// Typ) wird über setNodeMarkup aktualisiert – exakt der Codepfad, den
// commit() in mathNodeView benutzt.
function editFirstFormula(md, nodeType, newTex) {
  const editor = buildEditor(md);
  let pos = null;
  editor.state.doc.descendants((node, p) => {
    if (pos === null && node.type.name === nodeType) pos = p;
  });
  expect(pos).not.toBeNull();
  editor.chain().command(({ tr }) => {
    tr.setNodeMarkup(pos, undefined, { tex: newTex });
    return true;
  }).run();
  const out = unescapeMd(editor.storage.markdown.getMarkdown());
  editor.destroy();
  return out;
}

describe("Editor-Roundtrip: No-op (reines Laden + Speichern ändert nichts)", () => {
  it("Inline- und Display-Formel bleiben byte-identisch", () => {
    const md = "# T\n\n## A\n\nEs gilt $a^2+b^2=c^2$ und\n\n$$E=mc^2$$";
    expect(roundtrip(md)).toBe(md);
  });

  it("Formel mit Backslashes (\\frac, \\Delta) bleibt byte-identisch", () => {
    const md = "# T\n\n## A\n\n$\\frac{1}{2} + \\Delta$ Text danach.";
    expect(roundtrip(md)).toBe(md);
  });

  it("mehrzeiliger Display-Block bleibt byte-identisch", () => {
    const md = "# T\n\n## A\n\nVorher\n\n$$\na^2 + b^2\n= c^2\n$$\n\nNachher";
    expect(roundtrip(md)).toBe(md);
  });
});

describe("Editor-Roundtrip: Kontextbewusstsein (Review-Finding 1)", () => {
  it("Codespan mit Dollar-Paar bleibt Codespan, wird NICHT zur Formel-Node", () => {
    const md = "# T\n\n## A\n\nSchreibe `$x$` für eine Inline-Formel.";
    const out = roundtrip(md);
    expect(out).toBe(md);
    expect(out).not.toContain("math-inline");
  });

  it("zwei $$ über mehrere Absätze hinweg werden NICHT zu einem Block gepaart", () => {
    const md = "# T\n\n## A\n\nDas war teuer $$ im Ernst.\n\nViel Text dazwischen.\n\nNochmal $$ Ende.";
    const out = roundtrip(md);
    expect(out).toBe(md); // bleibt komplett literal, keine Formel, kein zerrissenes Tag
  });

  it("Re-Review-Finding R1: exakt das Reviewer-Dokument (öffnende $$-Zeile, Überschrift, spätere $$-Zeile) bleibt byte-identisch und erzeugt keinen math-block", () => {
    // Empirisch vom Reviewer mit den echten Modulen belegter Korruptionsfall:
    // ohne Leerzeilen-/Überschriften-Abbruch in matchDisplayBlock paarte der
    // Editor-Ladepfad über zwei Absätze UND eine Überschrift hinweg zu einem
    // einzigen <math-block> mit Leerzeilen im data-tex - markdown-it
    // zerreißt so ein Tag nachweislich in Fragmente.
    const md = "$$unterminiert\n\n## Neuer Abschnitt\n\nText hier $$";
    const editor = buildEditor(md);
    let hasMathBlock = false;
    editor.state.doc.descendants((node) => { if (node.type.name === "mathBlock") hasMathBlock = true; });
    editor.destroy();
    expect(hasMathBlock).toBe(false);
    expect(roundtrip(md)).toBe(md);
  });

  it("Re-Review-Finding R1: Dollar-Slang ohne echte Formel wird über eine Leerzeile hinweg nicht gepaart (Editor-Roundtrip)", () => {
    const md = "# T\n\n## A\n\n$$$ teuer heute.\n\nMehr Text.\n\nrichtig $$$ günstig.";
    const out = roundtrip(md);
    expect(out).toBe(md);
  });

  it("Re-Review-Finding R2: Codespan gefolgt von einzeiligem $$…$$ auf derselben Zeile bleibt literal und splittet den Absatz NICHT auf", () => {
    const md = "# T\n\n## A\n\n`x` $$y$$";
    const editor = buildEditor(md);
    // Genau EIN paragraph-Kind im Abschnitt - kein aufgesplitteter Absatz
    // durch einen fälschlich eingebetteten Block-Node.
    const paragraphCount = editor.state.doc.content.content.filter((n) => n.type.name === "paragraph").length;
    editor.destroy();
    expect(paragraphCount).toBe(1);
    const out = roundtrip(md);
    expect(out).toBe(md);
  });

  it("Re-Review-Finding R2: Codespan gefolgt von einzeiligem $x$ wird trotzdem als echte Inline-Formel-Node geladen", () => {
    const md = "# T\n\n## A\n\n`code` und $x$ hier.";
    const editor = buildEditor(md);
    let hasFormula = false;
    editor.state.doc.descendants((node) => { if (node.type.name === "mathInline") hasFormula = true; });
    editor.destroy();
    expect(hasFormula).toBe(true);
    expect(roundtrip(md)).toBe(md);
  });

  it("eine Bildzeile mit Dollar im Titel bleibt eine intakte Bild-Referenz", () => {
    const md = "# T\n\n## A\n\n![Kosten $5 pro Stück](img:ab12cd)";
    const editor = buildEditor(md, [Image.configure({ allowBase64: true })]);
    const json = editor.getJSON();
    const hasImage = JSON.stringify(json).includes('"image"');
    editor.destroy();
    expect(hasImage).toBe(true);
  });
});

// Übt die echte NodeView-DOM-Interaktion aus (Klick öffnet das Eingabefeld,
// Enter committet) statt nur commit() isoliert zu simulieren – ProseMirror
// baut den DOM-Baum auch ohne echtes Mounten in document.body vollständig
// auf, editor.view.dom ist also voll funktionsfähig ansprechbar.
function openFormulaInput(editor) {
  const rendered = editor.view.dom.querySelector(".math-node-rendered");
  expect(rendered).not.toBeNull();
  rendered.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  const input = editor.view.dom.querySelector(".math-node-input");
  expect(input).not.toBeNull();
  return input;
}

function pressEnter(input) {
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
}

describe("Formel-Eingabefeld validiert Dollarzeichen (Review-Finding 3)", () => {
  it("Inline: ein rohes $ im TeX wird beim Bestätigen verweigert, Node bleibt unverändert", () => {
    const md = "# T\n\n## A\n\n$x$";
    const editor = buildEditor(md);
    const input = openFormulaInput(editor);
    input.value = "a $ b";
    pressEnter(input);
    // Commit verweigert: Node behält den alten TeX-Wert ("x"), das Feld
    // bleibt offen und trägt die Fehler-Klasse.
    let tex = null;
    editor.state.doc.descendants((node) => { if (node.type.name === "mathInline") tex = node.attrs.tex; });
    expect(tex).toBe("x");
    expect(input.classList.contains("math-node-input-error")).toBe(true);
    expect(editor.view.dom.querySelector(".math-node-input")).not.toBeNull(); // Feld noch offen
    editor.destroy();
  });

  it("Inline: gültiges TeX ohne $ wird ganz normal übernommen", () => {
    const md = "# T\n\n## A\n\n$x$";
    const editor = buildEditor(md);
    const input = openFormulaInput(editor);
    input.value = "y^2";
    pressEnter(input);
    let tex = null;
    editor.state.doc.descendants((node) => { if (node.type.name === "mathInline") tex = node.attrs.tex; });
    expect(tex).toBe("y^2");
    expect(editor.view.dom.querySelector(".math-node-input")).toBeNull(); // Feld wieder geschlossen
    editor.destroy();
  });

  it("Display: ein doppeltes $$ im TeX wird verweigert, ein einzelnes $ ist erlaubt", () => {
    const md = "# T\n\n## A\n\n$$x$$";
    const editor = buildEditor(md);
    const input = openFormulaInput(editor);
    input.value = "a $$ b"; // doppeltes $$ -> ungültig für einen Block
    pressEnter(input);
    let tex = null;
    editor.state.doc.descendants((node) => { if (node.type.name === "mathBlock") tex = node.attrs.tex; });
    expect(tex).toBe("x"); // unverändert
    expect(input.classList.contains("math-node-input-error")).toBe(true);

    // einzelnes $ ist für MathBlock unkritisch (siehe Review-Vorschlag)
    input.value = "a $ b";
    pressEnter(input);
    editor.state.doc.descendants((node) => { if (node.type.name === "mathBlock") tex = node.attrs.tex; });
    expect(tex).toBe("a $ b");
    editor.destroy();
  });

  it("Fehler-Stil verschwindet, sobald wieder getippt wird", () => {
    const md = "# T\n\n## A\n\n$x$";
    const editor = buildEditor(md);
    const input = openFormulaInput(editor);
    input.value = "a $ b";
    pressEnter(input);
    expect(input.classList.contains("math-node-input-error")).toBe(true);
    input.value = "a b";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(input.classList.contains("math-node-input-error")).toBe(false);
    editor.destroy();
  });
});

describe("Editor-Roundtrip: echte Bearbeitung überlebt Formeln mit Backslashes", () => {
  it("Inline-Formel: setNodeMarkup (simuliert commit()) liefert korrektes $tex$", () => {
    const md = "# T\n\n## A\n\n$\\frac{1}{2}$";
    const out = editFirstFormula(md, "mathInline", "\\Delta x");
    expect(out).toBe("# T\n\n## A\n\n$\\Delta x$");
  });

  it("Display-Formel: setNodeMarkup liefert korrektes $$tex$$", () => {
    const md = "# T\n\n## A\n\n$$E=mc^2$$";
    const out = editFirstFormula(md, "mathBlock", "\\sum_{i=1}^n i");
    expect(out).toBe("# T\n\n## A\n\n$$\\sum_{i=1}^n i$$");
  });
});

describe('Editor-Roundtrip: \\$-Escape übersteht eine unabhängige Bearbeitung (Review-Finding 2)', () => {
  it('"\\$5" bleibt nach dem Ändern einer ANDEREN Formel im selben Dokument unverändert \\$5 (keine stille Bedeutungsänderung)', () => {
    const md = "# T\n\n## A\n\nPreis: \\$5 exakt.\n\n$x$";
    const out = editFirstFormula(md, "mathInline", "y");
    expect(out).toBe("# T\n\n## A\n\nPreis: \\$5 exakt.\n\n$y$");
    // Die Kernaussage: \$5 ist weiterhin ESCAPED (kein rohes $5, das später
    // versehentlich mit einem weiteren $ zu einer Formel gepaart werden
    // könnte) UND kein <math-inline>-Node ist daraus entstanden.
    expect(out).toContain("\\$5");
  });

  it("No-op-Vergleich bleibt korrekt: mehrfaches Laden+Speichern ohne Änderung ist stabil", () => {
    const md = "# T\n\n## A\n\nZwei escapte: \\$a\\$ hier.";
    const once = roundtrip(md);
    const twice = roundtrip(once);
    expect(once).toBe(twice); // idempotent, keine schleichende Drift
  });
});

describe("Editor-Roundtrip: Formel in einer Tabellenzelle (MdTable-Bugfix, Review-Vorschlag 7)", () => {
  // Re-Review-Finding R3: die ECHTE MdTable-Erweiterung importieren statt
  // sie (samt cellHasRenderableContent/gfmSerializable) im Test nachzubauen
  // - sonst driftet der Test unbemerkt, sollte sich die echte Implementierung
  // ändern (exakt das Muster aus Review-Finding 6, hier auf die Tabelle
  // verschoben).
  const TABLE_EXT = [MdTable, TableRow, TableHeader, TableCell];

  it("eine Formel in einer Tabellenzelle wird beim Speichern NICHT verschluckt", () => {
    const md = "# T\n\n## A\n\n| F | V |\n| --- | --- |\n| $x^2$ | 4 |";
    const out = roundtrip(md, TABLE_EXT);
    expect(out).toContain("$x^2$");
    expect(out).toContain("| 4 |");
  });

  it("eine Zelle, deren einziger Inhalt ein harter Zeilenumbruch ist, wird leer serialisiert (Review-Vorschlag 7)", () => {
    // Umschalt+Enter in einer sonst leeren Zelle darf beim Speichern KEINEN
    // echten Zeilenumbruch mitten in die Pipe-Zeile schreiben - das würde
    // die Tabelle beim nächsten Öffnen zerreißen.
    const editor = buildEditor("# T\n\n## A\n\n| F | V |\n| --- | --- |\n| x | y |", TABLE_EXT);
    let cellPos = null;
    editor.state.doc.descendants((node, pos) => {
      if (cellPos === null && node.type.name === "tableCell") cellPos = pos;
    });
    expect(cellPos).not.toBeNull();
    // Inhalt der ersten Datenzelle ("x") durch NUR einen harten Zeilenumbruch
    // ersetzen (simuliert Umschalt+Enter in einer geleerten Zelle).
    const cellNode = editor.state.doc.nodeAt(cellPos);
    const paraPos = cellPos + 1;
    const paraNode = editor.state.doc.nodeAt(paraPos);
    editor.chain().command(({ tr }) => {
      tr.replaceWith(paraPos + 1, paraPos + 1 + paraNode.content.size, editor.schema.nodes.hardBreak.create());
      return true;
    }).run();
    const out = unescapeMd(editor.storage.markdown.getMarkdown());
    const dataRow = out.split("\n").find((l) => l.includes("| y |"));
    expect(dataRow).toBeDefined();
    // Genau eine Pipe-Zeile für diese Datenzeile - kein zusätzlicher
    // Zeilenumbruch mitten in der Zeile.
    expect(dataRow.split("\n")).toHaveLength(1);
    expect(dataRow).toMatch(/^\|\s*\|\s*y\s*\|$/);
  });
});
