// @vitest-environment jsdom
//
// v7.46, Fehler 1 ("Escaptes Pipe in einer Tabellenzelle: Inhalt geht
// verloren"). Ursache GENAU eingegrenzt (Auftrag: "markdown-it-Tabellenregel
// vs. gerendertes HTML vs. MdTable-Parse-Pfad") – siehe ausführlicher
// Kopfkommentar bei MdTable (DocEditor.jsx) und DECISIONS für die
// vollständige Herleitung. Kurzfassung: markdown-its GFM-Tabellenregel löst
// "\|" schon immer korrekt auf, AUCH innerhalb eines Codespans (offizielles
// GFM-Spec-Verhalten: "`\|`" in einer Zelle rendert zu "<code>|</code>" OHNE
// Backslash) – das LADEN war nie kaputt. Kaputt war das erneute SPEICHERN
// eines Codespans in einer Tabellenzelle: prosemirror-markdown behandelt
// den "code"-Mark mit "escape:false" und ruft für dessen Text NIE
// "state.esc()" auf – der MdTable-Patch, der "|" sonst in jeder Zelle
// zuverlässig maskiert, griff für Codespan-Inhalt deshalb nie. Ein
// ungemaskiertes "|" trennt beim nächsten Laden (markdown-its Tabellenregel
// kennt beim Zeilen-Split noch keine Codespans) die Zelle in eine
// zusätzliche Spalte auf; über mehrere Zyklen wächst die Spaltenzahl gegen
// die Kopfzeile, bis die Zeile(n) gar nicht mehr als gültige GFM-Tabelle
// erkannt werden und der gesamte Block zu einem einzigen Absatz zusammenfällt
// (siehe "mehrzyklischer Nachweis" unten – das ist der empirisch belegte,
// tatsächliche Verlustmechanismus hinter der im Auftrag vereinfacht
// dargestellten Kurzform "| x | a\|b | -> | x | a |").
//
// Verifiziert (Auftrag: "aktiv verifizieren, indem du den Fix kurz
// zurücknimmst"): Ohne den "state.text"-Patch in MdTable (DocEditor.jsx)
// ist GENAU der Test "Pipe innerhalb eines Codespans bleibt über mehrere
// Zyklen stabil" unten rot (Codespan-Inhalt verliert das Escape beim ersten
// Speichern, die Tabelle zerfällt spätestens im zweiten Zyklus zu einem
// Absatz) – alle übrigen Tests unten (reiner Text, <br>+Liste) waren bereits
// vorher grün, weil "state.esc" dafür ausreichte; sie bleiben als
// Nicht-Regressions-Nachweis stehen.
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { Markdown } from "tiptap-markdown";
import { renderToStaticMarkup } from "react-dom/server";
import { unescapeMd, MdTable } from "../src/components/DocEditor.jsx";
import { DocView } from "../src/lib/markdown.jsx";

function buildEditor(md) {
  return new Editor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, blockquote: false }),
      MdTable.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({ html: true, bulletListMarker: "-", tightLists: true }),
    ],
    content: md,
  });
}

// Ein Zyklus "Editor öffnen + speichern": lädt "md" in einen frischen
// Editor, liest ihn sofort wieder aus (kein simulierter Tastendruck nötig –
// der Bug sitzt im Parse-/Serialize-Pfad selbst, nicht in einer konkreten
// Bearbeitung, siehe Kopfkommentar).
function cycle(md) {
  const editor = buildEditor(md);
  const out = unescapeMd(editor.storage.markdown.getMarkdown());
  editor.destroy();
  return out;
}

const renderDoc = (text) =>
  renderToStaticMarkup(
    <DocView text={text} collapsed={{}} onToggle={() => {}} imgMap={{}} onImgClick={() => {}} onToggleTask={() => {}} />
  );

describe("Editor <-> Renderer-Roundtrip: maskiertes Pipe in Tabellenzellen (v7.46)", () => {
  it("eine einzelne Maskierung in der Zelle bleibt über drei Zyklen byte-identisch", () => {
    const md = "# T\n\n| x | y |\n| --- | --- |\n| p | a\\|b |\n\nEnde.";
    const out1 = cycle(md);
    const out2 = cycle(out1);
    const out3 = cycle(out2);
    expect(out1).toBe(md);
    expect(out2).toBe(md);
    expect(out3).toBe(md);
  });

  it("mehrere Maskierungen in derselben Zelle bleiben über drei Zyklen byte-identisch", () => {
    const md = "# T\n\n| x | y |\n| --- | --- |\n| p | a\\|b\\|c |\n\nEnde.";
    const out1 = cycle(md);
    const out2 = cycle(out1);
    const out3 = cycle(out2);
    expect(out1).toBe(md);
    expect(out2).toBe(md);
    expect(out3).toBe(md);
  });

  it("ein maskiertes Pipe direkt am Zellanfang bleibt stabil", () => {
    const md = "# T\n\n| x | y |\n| --- | --- |\n| p | \\|abc |\n\nEnde.";
    expect(cycle(md)).toBe(md);
    expect(cycle(cycle(md))).toBe(md);
  });

  it("ein maskiertes Pipe direkt am Zellende bleibt stabil", () => {
    const md = "# T\n\n| x | y |\n| --- | --- |\n| p | abc\\| |\n\nEnde.";
    expect(cycle(md)).toBe(md);
    expect(cycle(cycle(md))).toBe(md);
  });

  it("maskiertes Pipe in der ERSTEN Spalte bleibt stabil (nicht nur in der letzten)", () => {
    const md = "# T\n\n| x | y |\n| --- | --- |\n| a\\|b | p |\n\nEnde.";
    expect(cycle(md)).toBe(md);
    expect(cycle(cycle(md))).toBe(md);
  });

  it("maskiertes Pipe zusammen mit einem <br>-Umbruch UND einer Aufzählung in derselben Zelle (v7.44-Funktion) bleibt stabil", () => {
    // Kombiniert das v7.44-Feature (Umbrüche/Aufzählungen in Zellen, siehe
    // docEditorTableBreaks.test.jsx) mit einer zusätzlichen Maskierung, die
    // NICHT Teil des <br>-getrennten Aufzählungstexts ist.
    const md = "# T\n\n| Spalte |\n| --- |\n| A\\|B<br>- eins<br>- zwei |\n\nEnde.";
    const out1 = cycle(md);
    expect(out1).toBe(md);
    const html = renderDoc(out1);
    expect(html).toContain("A|B");
    expect(html).toMatch(/<ul[^>]*>/);
    expect(html).toContain("eins");
    expect(html).toContain("zwei");
    // Mehrzyklisch: zweites/drittes Laden+Speichern verändert nichts mehr.
    const out2 = cycle(out1);
    const out3 = cycle(out2);
    expect(out2).toBe(md);
    expect(out3).toBe(md);
  });

  it("Pipe INNERHALB eines Codespans bleibt über mehrere Zyklen stabil (der eigentliche v7.46-Fix)", () => {
    // GFM-Spec-konform (siehe Kopfkommentar): "`\|`" lädt als Codespan mit
    // LITERALEM "|" (kein Backslash im Codespan-Inhalt) – DAS ist bereits
    // beim allerersten Laden korrekt (siehe DocView-Assertion unten). Die
    // Regression zeigte sich erst beim ERNEUTEN Speichern (Backslash fehlte
    // wieder in der serialisierten Zeile) UND vollends beim ZWEITEN Zyklus
    // (Tabelle zerfiel zu einem Absatz, siehe Kopfkommentar).
    const md = "# T\n\n| x | y |\n| --- | --- |\n| p | `a\\|b` code |\n\nEnde.";
    const editor = buildEditor(md);
    let cellHtml = null;
    editor.state.doc.descendants((n) => {
      if (n.type.name === "tableCell") cellHtml = n.textContent;
    });
    editor.destroy();
    // GFM-Spec: der Codespan enthält das literale Pipe-Zeichen, ohne Backslash.
    expect(cellHtml).toBe("a|b code");

    const out1 = cycle(md);
    expect(out1).toBe(md); // Byte-identisch: das Escape ÜBERLEBT das Speichern.

    const out2 = cycle(out1);
    const out3 = cycle(out2);
    expect(out2).toBe(md);
    expect(out3).toBe(md); // Kein Zerfall der Tabelle über weitere Zyklen.

    // Tabellenstruktur bleibt über alle drei Zyklen erhalten (kein Zerfall
    // zu einem einzelnen Absatz, siehe Kopfkommentar).
    const html = renderDoc(out3);
    expect(html).toContain("<table");
    expect(html).toContain("a|b");
  });

  it("normaler Text (kein Codespan) mit maskiertem Pipe war schon vorher stabil (Nicht-Regressions-Nachweis)", () => {
    const md = "# T\n\n| x | y |\n| --- | --- |\n| p | a\\|b |\n\nEnde.";
    const editor = buildEditor(md);
    let cellText = null;
    editor.state.doc.descendants((n) => { if (n.type.name === "tableCell") cellText = n.textContent; });
    editor.destroy();
    expect(cellText).toBe("a|b");
    expect(cycle(md)).toBe(md);
  });
});
