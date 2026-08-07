// @vitest-environment jsdom
//
// v7.47, Fehler 1 ("Bild als EINZIGER Inhalt einer Tabellenzelle geht beim
// Speichern verloren"). Vom Code-Reviewer ohne jedes Pipe im Spiel gemessen:
//   "| x | ![alt](img:x) |"              -> nach Laden+Speichern -> "| x |  |"
//   "| x | Text ![alt](img:x) Text |"    -> HTML-Fallback greift, Bild bleibt
// Ursache (siehe ausführlicher Kopfkommentar bei "gfmSerializable" in
// DocEditor.jsx): BlockImage UND MathBlock sind beide group:"block" – eine
// Zelle, deren KOMPLETTER Inhalt nur aus einem solchen Block-Atom besteht,
// hat GAR KEINEN umschließenden Absatz mehr (markdown-it wrapt Zellinhalt
// grundsätzlich nicht in ein <p>, und tiptap-markdowns normalizeBlocks
// entfernt ein nach dem Herausheben leer gewordenes <p> zusätzlich ganz).
// "cellHasRenderableContent" hielt "cell.firstChild" dadurch für einen
// LEEREN Absatz (ein Atom hat immer childCount===0), obwohl es das Bild/
// die Formel SELBST war - der Inhalt fiel beim Speichern lautlos weg.
//
// Aktiv als ROT verifiziert (Auftrag: "aktiv verifizieren"): mit dem Stand
// VOR dem v7.47-Fix (gfmSerializable kannte nur "cellHasSpan"/
// "childCount > 1") lieferten die beiden ersten Tests unten exakt
// "| x |  |" bzw. "|  | 4 |" (Bild/Formel weg) statt des jetzt erwarteten
// HTML-Fallbacks - reproduziert per `git stash` gegen den unveränderten
// Stand, siehe Bericht.
//
// Fix: "gfmSerializable" wertet eine Zelle mit genau einem, NICHT-Absatz-
// Kind zusätzlich als nicht GFM-darstellbar (wie eine Zelle mit mehreren
// Absätzen) - der bereits vorhandene HTML-Fallback (getHTMLFromFragment)
// rendert das Atom über dessen eigene renderHTML()-Regel und rettet den
// Inhalt (Mechanismus bereits für "Bild mit Text" belegt, siehe unten).
//
// Ein Formelblock ($$…$$) lässt sich NICHT über eine rohe Markdown-Zeile
// als einziger Zellinhalt erzeugen (mathToPlaceholders/DISPLAY_MATH_START_RE
// verlangt "$$" am Zeilenanfang - innerhalb einer Pipe-Zeile bleibt "$$…$$"
// bewusst literal, siehe math.jsx). Ein MathBlock-Node kann trotzdem in
// einer Zelle landen (Formel-Knopf/Paste, während der Cursor in einer
// Zelle steht - ProseMirror darf jeden "block"-Node in eine Zelle mit
// content:"block+" einfügen) - die Tests unten bauen diesen Fall deshalb
// direkt über ProseMirror-JSON auf (kein Umweg über die Markdown-Ladephase
// nötig, der Serializer-Bug sitzt ohnehin NACH dem Laden).
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { Markdown } from "tiptap-markdown";
import { unescapeMd, MdTable, BlockImage, MathBlock } from "../src/components/DocEditor.jsx";

const TABLE_EXT = [MdTable, TableRow, TableHeader, TableCell];

function buildEditor(content, extraExtensions = []) {
  return new Editor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, blockquote: false }),
      ...extraExtensions,
      Markdown.configure({ html: true, bulletListMarker: "-", tightLists: true }),
    ],
    content,
  });
}

// Ein Zyklus "Editor öffnen + speichern" (wie in
// tests/docEditorTablePipeEscape.test.jsx#cycle) - akzeptiert sowohl einen
// Markdown-String als auch ein ProseMirror-JSON-Dokument als Inhalt.
function cycle(content, extraExtensions) {
  const editor = buildEditor(content, extraExtensions);
  const out = unescapeMd(editor.storage.markdown.getMarkdown());
  editor.destroy();
  return out;
}

// Baut ein minimales Tabellen-Dokument direkt als ProseMirror-JSON (für
// Zellinhalte, die auf dem Markdown-Ladepfad gar nicht entstehen können,
// s. o.) - eine Kopfzeile mit "F"/"V" plus eine Datenzeile mit den
// übergebenen Zellinhalten.
function mathTableDoc(firstCellContent) {
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "T" }] },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "F" }] }] },
              { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "V" }] }] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: firstCellContent },
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "4" }] }] },
            ],
          },
        ],
      },
    ],
  };
}

describe("MdTable: Bild als einziger Zellinhalt geht NICHT mehr verloren (v7.47-Regression)", () => {
  it("ein Bild OHNE jeden Begleittext in der Zelle bleibt beim Speichern erhalten (statt zu '| x |  |' zu werden)", () => {
    const md = "# T\n\n| A | B |\n| --- | --- |\n| x | ![alt](img:xyz) |\n\nEnde.";
    const out = cycle(md, [...TABLE_EXT, BlockImage]);
    expect(out).not.toBe("# T\n\n| A | B |\n| --- | --- |\n| x |  |\n\nEnde."); // der alte, kaputte Zustand
    expect(out).toContain("img:xyz");
    expect(out).toContain('alt="alt"');
  });

  it("Idempotenz: ein zweiter Lade-/Speicherzyklus des HTML-Fallbacks verändert nichts mehr", () => {
    const md = "# T\n\n| A | B |\n| --- | --- |\n| x | ![alt](img:xyz) |\n\nEnde.";
    const out1 = cycle(md, [...TABLE_EXT, BlockImage]);
    const out2 = cycle(out1, [...TABLE_EXT, BlockImage]);
    const out3 = cycle(out2, [...TABLE_EXT, BlockImage]);
    expect(out2).toBe(out1);
    expect(out3).toBe(out1);
    expect(out1).toContain("img:xyz");
  });

  it("das Bild bleibt auch nach dem Fallback ein ECHTER BlockImage-Node (kein Literaltext), Breite/Alt bleiben erhalten", () => {
    // Direkt als ProseMirror-JSON aufgebaut (statt über eine rohe Markdown-
    // Zeile "![Titel|w320](img:xyz)"): das "|w320"-Suffix landet NUR in der
    // eigenen, hier bewusst umgangenen state.esc-Serialisierung von
    // BlockImage - als ROHER Alt-Text getippt/geladen wäre das unescapte
    // "|" ohnehin ein KOMPLETT ANDERES, vorbestehendes Problem (markdown-its
    // GFM-Tabellenregel trennt Zeilen bereits VOR jeder Inline-Erkennung an
    // jedem rohen "|" auf - außerhalb des Umfangs dieses Fixes). Node-Attribute
    // (src/alt/width) sind hier deshalb wie im echten Editor-Zustand gesetzt.
    const doc = mathTableDoc([{ type: "image", attrs: { src: "img:xyz", alt: "Titel", width: 320 } }]);
    const editor = buildEditor(doc, [...TABLE_EXT, BlockImage]);
    const out = unescapeMd(editor.storage.markdown.getMarkdown());
    editor.destroy();
    // Erneut laden: das gerettete Bild muss als echter Node zurückkommen,
    // Breite (aus dem "width"-HTML-Attribut des Fallbacks) und Alt-Text
    // bleiben dabei erhalten.
    const editor2 = buildEditor(out, [...TABLE_EXT, BlockImage]);
    let found = null;
    editor2.state.doc.descendants((n) => { if (n.type.name === "image") found = n; });
    editor2.destroy();
    expect(found).not.toBeNull();
    expect(found.attrs.src).toBe("img:xyz");
    expect(found.attrs.alt).toBe("Titel");
    expect(found.attrs.width).toBe(320);
  });

  it("Bild MIT Text davor UND danach: HTML-Fallback greift weiterhin unverändert (Nicht-Regressions-Nachweis)", () => {
    const md = "# T\n\n| A | B |\n| --- | --- |\n| x | Text ![alt](img:xyz) Text |\n\nEnde.";
    const out = cycle(md, [...TABLE_EXT, BlockImage]);
    expect(out).toContain("img:xyz");
    expect(out).toContain("Text");
    // Zweiter Zyklus: bleibt stabil im Fallback (kein erneuter Datenverlust) -
    // ein Leerzeichen direkt vor/nach dem Bild kann sich beim HTML-Reparsing
    // dabei verschieben (DOM-Whitespace-Normalisierung, siehe Browser-
    // Verhalten bei Text-Knoten neben Block-Elementen) - eine vorbestehende,
    // mit diesem Fix nicht zusammenhängende Eigenheit des BEREITS VOR v7.47
    // funktionierenden Fallback-Pfads; hier zählt nur, dass nichts verloren geht.
    const out2 = cycle(out, [...TABLE_EXT, BlockImage]);
    expect(out2).toContain("img:xyz");
    expect(out2).toContain("Text");
  });

  it("Bild MIT Text NUR davor bleibt erhalten (zweites Kind zusätzlich zum Bild)", () => {
    const md = "# T\n\n| A | B |\n| --- | --- |\n| x | Text ![alt](img:xyz) |\n\nEnde.";
    const out = cycle(md, [...TABLE_EXT, BlockImage]);
    expect(out).toContain("img:xyz");
    expect(out).toContain("Text");
  });

  it("Bild MIT Text NUR danach bleibt erhalten (zweites Kind zusätzlich zum Bild)", () => {
    const md = "# T\n\n| A | B |\n| --- | --- |\n| x | ![alt](img:xyz) Text |\n\nEnde.";
    const out = cycle(md, [...TABLE_EXT, BlockImage]);
    expect(out).toContain("img:xyz");
    expect(out).toContain("Text");
  });
});

describe("MdTable: Formelblock ($$…$$) als einziger Zellinhalt geht NICHT mehr verloren (v7.47-Regression)", () => {
  it("eine MathBlock-Node allein in der Zelle bleibt beim Speichern erhalten (statt zu '|  | 4 |' zu werden)", () => {
    const doc = mathTableDoc([{ type: "mathBlock", attrs: { tex: "x^2" } }]);
    const out = cycle(doc, [...TABLE_EXT, MathBlock]);
    expect(out).not.toContain("|  | 4 |"); // der alte, kaputte Zustand
    expect(out).toContain('data-tex="x^2"');
  });

  it("Idempotenz: ein zweiter Lade-/Speicherzyklus verändert nichts mehr, die Formel bleibt eine ECHTE Node", () => {
    const doc = mathTableDoc([{ type: "mathBlock", attrs: { tex: "x^2" } }]);
    const out1 = cycle(doc, [...TABLE_EXT, MathBlock]);
    const out2 = cycle(out1, [...TABLE_EXT, MathBlock]);
    expect(out2).toBe(out1);

    const editor = buildEditor(out1, [...TABLE_EXT, MathBlock]);
    let hasFormula = false;
    editor.state.doc.descendants((n) => { if (n.type.name === "mathBlock" && n.attrs.tex === "x^2") hasFormula = true; });
    editor.destroy();
    expect(hasFormula).toBe(true);
  });
});

describe("MdTable: unveränderte Fälle bleiben im schlanken GFM-Pipe-Format (kein unnötiger HTML-Fallback)", () => {
  it("eine gewöhnliche Textzelle bleibt reines GFM-Pipe (kein '<table'-Fallback)", () => {
    const md = "# T\n\n| A | B |\n| --- | --- |\n| x | ganz normaler Text |\n\nEnde.";
    const out = cycle(md, TABLE_EXT);
    expect(out).toBe(md);
    expect(out).not.toContain("<table");
  });

  it("eine leere Zelle bleibt leer, kein Fallback, kein Datenverlust in beide Richtungen", () => {
    const md = "# T\n\n| A | B |\n| --- | --- |\n| x |  |\n\nEnde.";
    const out = cycle(md, TABLE_EXT);
    expect(out).toBe(md);
    expect(out).not.toContain("<table");
  });

  it("eine Zelle mit <br>-Umbruch UND Aufzählung (v7.44-Funktion) bleibt reines GFM-Pipe", () => {
    const md = "# T\n\n| Spalte |\n| --- |\n| A<br>- eins<br>- zwei |\n\nEnde.";
    const out = cycle(md, TABLE_EXT);
    expect(out).toBe(md);
    expect(out).not.toContain("<table");
  });

  it("zwei Absätze in derselben Zelle (nur per Paste erreichbar) lösen weiterhin korrekt den HTML-Fallback aus (Nicht-Regressions-Nachweis)", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "T" }] },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "F" }] }] }],
            },
            {
              type: "tableRow",
              content: [{
                type: "tableCell",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "Eins" }] },
                  { type: "paragraph", content: [{ type: "text", text: "Zwei" }] },
                ],
              }],
            },
          ],
        },
      ],
    };
    const out = cycle(doc, TABLE_EXT);
    expect(out).toContain("Eins");
    expect(out).toContain("Zwei");
    expect(cycle(out, TABLE_EXT)).toBe(out); // stabil
  });
});
