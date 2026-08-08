// @vitest-environment jsdom
//
// v7.47 hatte den v7.47-eigenen Bug ("Bild als EINZIGER Inhalt einer
// Tabellenzelle geht beim Speichern verloren") über den bereits vorhandenen
// HTML-Fallback (getHTMLFromFragment) behoben: Inhalt blieb erhalten, ABER
// die Dokument-ANSICHT (markdown.jsx) kann rohes Block-HTML gar nicht
// rendern – die ganze Tabelle verschwand aus der Ansicht und ein roher
// HTML-Text erschien stattdessen (E2E-Finding 🔴, v7.48-Auftrag). Siehe
// DECISIONS für den vollständigen Befund ("HTML-Fallback war eine
// Sackgasse für die Ansicht").
//
// v7.48-Fix: Ein Bild oder ein Formelblock als EINZIGER Inhalt einer Zelle
// bleibt jetzt im schlanken GFM-Pipe-Format ("| x | ![alt](img:id) |" bzw.
// "| x | $tex$ |" – ein Formel-BLOCK wird dabei bewusst als INLINE-Formel
// serialisiert, ein abgesetzter Block ergibt in einer Tabellenzelle ohnehin
// keinen Sinn). Die Dokument-Ansicht (renderTable -> TableCell -> Inline)
// kann das GENAUSO rendern wie jede andere Zelle mit Text (siehe
// tests/markdownTableInlineMedia.test.jsx für den Ansichts-Nachweis) – der
// HTML-Fallback bleibt NUR noch für strukturell wirklich nicht darstellbare
// Fälle bestehen (verbundene Zellen/mehrere Absätze in einer Zelle – im
// Editor über die Toolbar nicht erzeugbar, nur per Copy&Paste erreichbar,
// siehe die Tests weiter unten, die das UNVERÄNDERT als
// Nicht-Regressions-Nachweis pinnen).
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { Markdown } from "tiptap-markdown";
import { unescapeMd, MdTable, BlockImage, MathBlock, MathInline } from "../src/components/DocEditor.jsx";
import { mathToPlaceholders } from "../src/lib/math.jsx";

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

describe("MdTable: Bild als einziger Zellinhalt bleibt GFM-Pipe-Format (v7.48-Fix)", () => {
  it("ein Bild OHNE jeden Begleittext bleibt eine gewöhnliche Pipe-Zeile (kein HTML-Fallback mehr)", () => {
    const md = "# T\n\n| A | B |\n| --- | --- |\n| x | ![alt](img:xyz) |\n\nEnde.";
    const out = cycle(md, [...TABLE_EXT, BlockImage]);
    // Byte-identisch zum Original - GFM-Pipe-Format bleibt GFM-Pipe-Format,
    // kein unnötiger HTML-Umweg mehr für genau diesen Fall.
    expect(out).toBe(md);
    expect(out).not.toContain("<table");
  });

  it("Idempotenz: mehrere Lade-/Speicherzyklen verändern nichts mehr", () => {
    const md = "# T\n\n| A | B |\n| --- | --- |\n| x | ![alt](img:xyz) |\n\nEnde.";
    const out1 = cycle(md, [...TABLE_EXT, BlockImage]);
    const out2 = cycle(out1, [...TABLE_EXT, BlockImage]);
    const out3 = cycle(out2, [...TABLE_EXT, BlockImage]);
    expect(out1).toBe(md);
    expect(out2).toBe(md);
    expect(out3).toBe(md);
  });

  it("das Bild bleibt beim Wiedereinlesen ein ECHTER BlockImage-Node (kein Literaltext), Breite/Alt bleiben erhalten", () => {
    // Direkt als ProseMirror-JSON aufgebaut (statt über eine rohe Markdown-
    // Zeile): Node-Attribute (src/alt/width) sind so wie im echten
    // Editor-Zustand gesetzt, unabhängig vom Serializer-Weg.
    const doc = mathTableDoc([{ type: "image", attrs: { src: "img:xyz", alt: "Titel", width: 320 } }]);
    const editor = buildEditor(doc, [...TABLE_EXT, BlockImage]);
    const out = unescapeMd(editor.storage.markdown.getMarkdown());
    editor.destroy();
    // Jetzt GFM-Pipe-Format mit dem "|wNNN"-Größensuffix, kein HTML mehr.
    // Das "|" DES SUFFIXES wird dabei wie jedes andere Pipe in einer
    // Tabellenzeile maskiert ("\|") - splitRow (markdown.jsx) löst das beim
    // Lesen wieder korrekt zu einem echten "|" auf (siehe BlockImage-Attribut-
    // Parser, der die "|wNNN"-Konvention danach wieder herausliest).
    expect(out).not.toContain("<table");
    expect(out).toContain("![Titel\\|w320](img:xyz)");

    // Erneut laden: das Bild muss als echter Node zurückkommen, Breite/Alt
    // bleiben dabei erhalten (Roundtrip über das Pipe-Format).
    const editor2 = buildEditor(out, [...TABLE_EXT, BlockImage]);
    let found = null;
    editor2.state.doc.descendants((n) => { if (n.type.name === "image") found = n; });
    editor2.destroy();
    expect(found).not.toBeNull();
    expect(found.attrs.src).toBe("img:xyz");
    expect(found.attrs.alt).toBe("Titel");
    expect(found.attrs.width).toBe(320);
  });

  it("ein Pipe-Zeichen IM Alt-Text wird maskiert und bleibt über den Roundtrip lesbar (Escaping-Test)", () => {
    // Ohne Maskierung würde "a|b" im Alt-Text die Pipe-Tabellenzeile in eine
    // zusätzliche Spalte auftrennen (dieselbe Gefahr wie bei normalem
    // Zelltext, siehe v7.46) - state.esc (in writeInlineAtom gebunden) muss
    // das "|" hier GENAUSO maskieren.
    const doc = mathTableDoc([{ type: "image", attrs: { src: "img:xyz", alt: "a|b", width: null } }]);
    const editor = buildEditor(doc, [...TABLE_EXT, BlockImage]);
    const out = unescapeMd(editor.storage.markdown.getMarkdown());
    editor.destroy();
    expect(out).toContain("![a\\|b](img:xyz)");
    // Zwei Spalten in der Datenzeile bleiben zwei Spalten (keine
    // Fehl-Auftrennung durch das ungemaskierte Pipe im Alt-Text).
    const dataLine = out.split("\n").find((l) => l.includes("img:xyz"));
    expect(dataLine.trim().split(/(?<!\\)\|/).length).toBe(4); // "", A, B, ""

    // Erneut laden: Alt-Text kommt unverändert (mit echtem "|", ohne
    // Backslash) zurück.
    const editor2 = buildEditor(out, [...TABLE_EXT, BlockImage]);
    let found = null;
    editor2.state.doc.descendants((n) => { if (n.type.name === "image") found = n; });
    editor2.destroy();
    expect(found.attrs.alt).toBe("a|b");
  });

  it("ein Bild als einziger Inhalt EINER KOPFZELLE bleibt ebenfalls GFM-Pipe-Format", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "T" }] },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", content: [{ type: "image", attrs: { src: "img:xyz", alt: "Kopf" } }] },
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "V" }] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "4" }] }] },
              ],
            },
          ],
        },
      ],
    };
    const out = cycle(doc, [...TABLE_EXT, BlockImage]);
    expect(out).not.toContain("<table");
    expect(out).toContain("![Kopf](img:xyz)");
  });

  it("Bild MIT Text davor UND danach: HTML-Fallback greift weiterhin unverändert (Nicht-Regressions-Nachweis)", () => {
    // Text+Bild in derselben Zelle sind ZWEI/DREI getrennte Block-Kinder
    // (BlockImage ist group:"block", siehe Kopfkommentar bei
    // gfmSerializable/DocEditor.jsx) - strukturell etwas ANDERES als der
    // hier gefixte bare-Atom-Fall (genau EIN Kind). Bleibt bewusst
    // unverändert im HTML-Fallback (kein Auftrag, das zu ändern).
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

describe("MdTable: Formelblock ($$…$$) als einziger Zellinhalt bleibt GFM-Pipe-Format (v7.48-Fix)", () => {
  it("eine MathBlock-Node allein in der Zelle wird als INLINE-Formel ($…$) serialisiert (kein HTML-Fallback mehr)", () => {
    const doc = mathTableDoc([{ type: "mathBlock", attrs: { tex: "x^2" } }]);
    const out = cycle(doc, [...TABLE_EXT, MathBlock]);
    expect(out).not.toContain("<table");
    // Ein abgesetzter Block ($$…$$) ergibt in einer Zeile keinen Sinn -
    // bewusst als Inline-Formel serialisiert (siehe DECISIONS).
    expect(out).toContain("| $x^2$ | 4 |");
    expect(out).not.toContain("$$x^2$$");
  });

  it("Idempotenz über den ECHTEN Lade-Pfad (mathToPlaceholders): die Formel bleibt stabil - liest beim Wiedereinlesen bewusst als INLINE-Formel (mathInline), nicht mehr als mathBlock", () => {
    const doc = mathTableDoc([{ type: "mathBlock", attrs: { tex: "x^2" } }]);
    const out1 = cycle(doc, [...TABLE_EXT, MathBlock]);

    // Ab hier über den ECHTEN App-Ladepfad weiter (mathToPlaceholders VOR
    // dem Parsen, wie DocEditor.jsx#content das immer tut, siehe dort) -
    // "out1" enthält jetzt rohes "$x^2$" in einer Pipe-Zeile, das OHNE diese
    // Vorverarbeitung (wie im Rest dieser Testdatei bewusst ausgespart, das
    // JSON-Fixture existiert ja GENAU deshalb) nur Literaltext bliebe.
    const editor2 = buildEditor(mathToPlaceholders(out1), [...TABLE_EXT, MathBlock, MathInline]);
    const out2 = unescapeMd(editor2.storage.markdown.getMarkdown());
    // Ein abgesetzter Formel-BLOCK in einer Tabellenzelle ist konzeptionell
    // eine Inline-Formel (siehe Auftrag/DECISIONS) - der Node-Typ wechselt
    // beim ersten Roundtrip deshalb bewusst von "mathBlock" zu "mathInline",
    // der TeX-Inhalt bleibt dabei unverändert erhalten.
    let hasInlineFormula = false;
    let hasMathBlock = false;
    editor2.state.doc.descendants((n) => {
      if (n.type.name === "mathInline" && n.attrs.tex === "x^2") hasInlineFormula = true;
      if (n.type.name === "mathBlock") hasMathBlock = true;
    });
    editor2.destroy();
    expect(hasInlineFormula).toBe(true);
    expect(hasMathBlock).toBe(false);
    expect(out2).toBe(out1); // stabil - ab hier keine weitere Änderung mehr

    // Ein dritter Zyklus über denselben echten Pfad bleibt ebenfalls stabil.
    const editor3 = buildEditor(mathToPlaceholders(out2), [...TABLE_EXT, MathBlock, MathInline]);
    const out3 = unescapeMd(editor3.storage.markdown.getMarkdown());
    editor3.destroy();
    expect(out3).toBe(out1);
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

  it("eine eigenständige Liste als einziger Zellinhalt (per Paste, im Editor nicht erzeugbar) bleibt weiterhin im HTML-Fallback abgesichert", () => {
    // Kein Regressionsfall des v7.48-Fixes: INLINE_ATOM_TYPES kennt
    // ausschließlich "image"/"mathBlock" - jeder andere bare Block-Atomtyp
    // (hier: eine komplette bulletList als einziges Zellkind) bleibt bewusst
    // über den HTML-Fallback abgesichert (kein Datenverlust), GENAU wie vor
    // v7.47/v7.48.
    const doc = mathTableDoc([{
      type: "bulletList",
      content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Punkt" }] }] }],
    }]);
    const out = cycle(doc, [...TABLE_EXT, BlockImage]);
    expect(out).toContain("<table");
    expect(out).toContain("Punkt");
  });
});
