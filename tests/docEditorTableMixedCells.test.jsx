// @vitest-environment jsdom
//
// v7.48, Review-Nachbesserung (Fehler 1 war mit dem ersten v7.48-Fix nur
// TEILWEISE behoben): Der erste Fix deckte ausschließlich eine Zelle ab,
// deren EINZIGER Inhalt ein Bild-/Formel-Atom war (cell.childCount === 1).
// Fügt der Nutzer ein Bild/eine Formel dagegen in eine Zelle ein, die
// BEREITS Text enthält (z. B. Cursor hinter "b", dann Formel-Knopf), spaltet
// ProseMirror den umschließenden Absatz auf (BlockImage/MathBlock sind
// group:"block") – die Zelle hat danach MEHRERE Kinder (Absatz-Fragmente
// PLUS das Atom). Für den Nutzer optisch derselbe Effekt wie der ursprünglich
// gemeldete Blocker: HTML-Fallback → Hinweiskasten statt Bild/Formel in der
// Ansicht. Empirisch verifiziert (siehe Bericht), welche Kindstruktur
// ProseMirror beim Einfügen an unterschiedlichen Cursor-Positionen erzeugt –
// die Fixtures unten bilden GENAU diese Strukturen nach.
//
// Fix: siehe Kopfkommentar bei "gfmSerializable"/"renderCellChildrenInline"
// (DocEditor.jsx) – eine Zelle bleibt GFM-Pipe-darstellbar, wenn jedes Kind
// ein Absatz oder ein unterstütztes Atom ist UND (mindestens ein Atom
// vorhanden ist ODER höchstens ein einziger nicht-leerer Absatz existiert).
// "Echte" mehrere Absätze OHNE jedes Atom (nur per Paste erreichbar) bleiben
// bewusst UNVERÄNDERT im HTML-Fallback (siehe
// tests/docEditorTableBlockCells.test.jsx, Nicht-Regressions-Test).
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { Markdown } from "tiptap-markdown";
import { renderToStaticMarkup } from "react-dom/server";
import { unescapeMd, MdTable, BlockImage, MathBlock, MathInline } from "../src/components/DocEditor.jsx";
import { DocView } from "../src/lib/markdown.jsx";
import { mathToPlaceholders } from "../src/lib/math.jsx";

const TABLE_EXT = [MdTable, TableRow, TableHeader, TableCell, BlockImage, MathBlock, MathInline];

function buildEditor(content) {
  return new Editor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, blockquote: false }),
      ...TABLE_EXT,
      Markdown.configure({ html: true, bulletListMarker: "-", tightLists: true }),
    ],
    content,
  });
}

function cycle(content) {
  const editor = buildEditor(content);
  const out = unescapeMd(editor.storage.markdown.getMarkdown());
  editor.destroy();
  return out;
}

// Für einen ZWEITEN (und jeden weiteren) Zyklus, sobald "md" bereits rohes
// "$…$" enthält: der erste Zyklus baut die Formel bewusst über ProseMirror-
// JSON auf (ein Formelblock/eine Inline-Formel entsteht NICHT über eine rohe
// Markdown-Zeile, siehe tests/docEditorTableBlockCells.test.jsx), aber ein
// GESPEICHERTES Dokument mit "$…$" darin geht beim ECHTEN Wiederöffnen IMMER
// über mathToPlaceholders (siehe DocEditor.jsx#content) - OHNE das bleibt
// "$…$" in "cycle()" bloßer, unerkannter Fließtext, und ein erneutes
// Speichern würde den (dann irrtümlich für Text gehaltenen) Backslash aus
// "\vert" über die normale Text-Escape-Logik VERDOPPELN - ein Test-Artefakt,
// kein echter Bug (aktiv beobachtet, bevor dieser Helfer eingeführt wurde).
function realCycle(md) {
  return cycle(mathToPlaceholders(md));
}

const renderDoc = (text, imgMap = {}) =>
  renderToStaticMarkup(
    <DocView text={text} collapsed={{}} onToggle={() => {}} imgMap={imgMap} onImgClick={() => {}} onToggleTask={() => {}} />
  );

// Baut ein minimales Tabellen-Dokument mit GENAU EINER Datenzelle mit dem
// übergebenen Kindinhalt (zweite Spalte bleibt einfacher Text, wie in
// tests/docEditorTableBlockCells.test.jsx#mathTableDoc).
function tableDoc(firstCellContent, opts = {}) {
  const headerFirst = opts.headerContent || [{ type: "paragraph", content: [{ type: "text", text: "F" }] }];
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
              { type: "tableHeader", content: headerFirst },
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

describe("MdTable: Bild/Formel in einer Zelle MIT bereits vorhandenem Text (v7.48-Nachbesserung)", () => {
  it("Text DAVOR (Cursor hinter 'b', Formel eingefügt) bleibt GFM-Pipe-Format, kein HTML-Fallback", () => {
    // Exakt die von ProseMirror erzeugte Struktur beim Einfügen am Ende
    // eines Absatzes (empirisch verifiziert): der Text-Absatz bleibt VOR
    // dem Atom stehen, KEIN Absatz-Rest danach.
    const doc = tableDoc([
      { type: "paragraph", content: [{ type: "text", text: "b" }] },
      { type: "mathBlock", attrs: { tex: "x^2" } },
    ]);
    const out = cycle(doc);
    expect(out).not.toContain("<table");
    expect(out).toContain("| b $x^2$ | 4 |");

    // Idempotenz über den ECHTEN Lade-Pfad (siehe realCycle-Kommentar oben).
    expect(realCycle(out)).toBe(out);

    // Ansicht: eine ECHTE Tabelle mit Text UND gerenderter Formel in
    // DERSELBEN Zelle, kein Hinweiskasten.
    const html = renderDoc(out);
    expect(html).toContain("<table");
    expect(html).toContain(">b");
    expect(html).toContain("katex");
    expect(html).not.toContain("nicht dargestellt werden");
  });

  it("Text DANACH (Formel vor bereits vorhandenem Text) bleibt GFM-Pipe-Format", () => {
    const doc = tableDoc([
      { type: "mathBlock", attrs: { tex: "x^2" } },
      { type: "paragraph", content: [{ type: "text", text: "nach" }] },
    ]);
    const out = cycle(doc);
    expect(out).not.toContain("<table");
    expect(out).toContain("| $x^2$ nach | 4 |");
    expect(realCycle(out)).toBe(out);

    const html = renderDoc(out);
    expect(html).toContain("<table");
    expect(html).toContain("nach");
    expect(html).toContain("katex");
  });

  it("Text DAVOR UND DANACH (Formel mitten im Text) bleibt GFM-Pipe-Format", () => {
    const doc = tableDoc([
      { type: "paragraph", content: [{ type: "text", text: "vor" }] },
      { type: "mathBlock", attrs: { tex: "x^2" } },
      { type: "paragraph", content: [{ type: "text", text: "nach" }] },
    ]);
    const out = cycle(doc);
    expect(out).not.toContain("<table");
    expect(out).toContain("| vor $x^2$ nach | 4 |");
    expect(realCycle(out)).toBe(out);
    expect(realCycle(realCycle(out))).toBe(out);

    const html = renderDoc(out);
    expect(html).toContain("<table");
    expect(html).toContain("vor");
    expect(html).toContain("nach");
    expect(html).toContain("katex");
    expect(html).not.toContain("nicht dargestellt werden");
  });

  it("bereits vorhandenes Leerzeichen am Fragment-Rand erzeugt KEIN Doppel-Leerzeichen", () => {
    const doc = tableDoc([
      { type: "paragraph", content: [{ type: "text", text: "vor " }] }, // trailing space
      { type: "mathBlock", attrs: { tex: "x^2" } },
      { type: "paragraph", content: [{ type: "text", text: " nach" }] }, // leading space
    ]);
    const out = cycle(doc);
    expect(out).toContain("| vor $x^2$ nach | 4 |"); // genau EIN Leerzeichen je Seite
    expect(out).not.toContain("vor  $x^2$"); // kein Doppel-Leerzeichen
  });

  it("Bild MIT Text davor (Cursor hinter Text, Bild-Knopf) bleibt GFM-Pipe-Format", () => {
    const doc = tableDoc([
      { type: "paragraph", content: [{ type: "text", text: "b" }] },
      { type: "image", attrs: { src: "img:xyz", alt: "a" } },
    ]);
    const out = cycle(doc);
    expect(out).not.toContain("<table");
    expect(out).toContain("| b ![a](img:xyz) | 4 |");
    expect(cycle(out)).toBe(out);

    const html = renderDoc(out, { xyz: "data:image/png;base64,AAA" });
    expect(html).toContain("<img");
    expect(html).not.toContain("![a]");
    expect(html).not.toContain("nicht dargestellt werden");
  });

  it("mehrere Atome in derselben Zelle (Bild + Formel gemischt, kein Text) bleiben GFM-Pipe-Format", () => {
    const doc = tableDoc([
      { type: "image", attrs: { src: "img:xyz", alt: "a" } },
      { type: "mathBlock", attrs: { tex: "y^2" } },
    ]);
    const out = cycle(doc);
    expect(out).not.toContain("<table");
    expect(out).toContain("| ![a](img:xyz) $y^2$ | 4 |");
    expect(realCycle(out)).toBe(out);

    const html = renderDoc(out, { xyz: "data:image/png;base64,AAA" });
    expect(html).toContain("<table");
    expect(html).toContain("<img");
    expect(html).toContain("katex");
    expect(html).not.toContain("nicht dargestellt werden");
  });

  it("eine Kopfzelle mit Text UND einem Bild bleibt GFM-Pipe-Format", () => {
    const doc = tableDoc(
      [{ type: "paragraph", content: [{ type: "text", text: "4" }] }],
      {
        headerContent: [
          { type: "paragraph", content: [{ type: "text", text: "Kopf" }] },
          { type: "image", attrs: { src: "img:xyz", alt: "h" } },
        ],
      }
    );
    const out = cycle(doc);
    expect(out).not.toContain("<table");
    expect(out).toContain("| Kopf ![h](img:xyz) | V |");
    expect(cycle(out)).toBe(out);

    const html = renderDoc(out, { xyz: "data:image/png;base64,AAA" });
    expect(html).toContain("<th");
    expect(html).toContain("<img");
    expect(html).not.toContain("nicht dargestellt werden");
  });

  it("eine Zelle mit <br>-Umbruch (v7.44) UND einem zusätzlichen Bild bleibt GFM-Pipe-Format", () => {
    const doc = tableDoc([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Zeile1" },
          { type: "hardBreak" },
          { type: "text", text: "Zeile2" },
        ],
      },
      { type: "image", attrs: { src: "img:xyz", alt: "b" } },
    ]);
    const out = cycle(doc);
    expect(out).not.toContain("<table");
    expect(out).toContain("| Zeile1<br>Zeile2 ![b](img:xyz) | 4 |");
    expect(cycle(out)).toBe(out);

    const html = renderDoc(out, { xyz: "data:image/png;base64,AAA" });
    expect(html).toContain("Zeile1");
    expect(html).toContain("Zeile2");
    expect(html).toContain("<img");
    expect(html).not.toContain("nicht dargestellt werden");
  });

  it("eine Formel mit rohem '|' im TeX weicht INNERHALB einer Tabellenzelle auf '\\vert' aus (kein zerlegtes Pipe)", () => {
    const doc = tableDoc([{ type: "mathBlock", attrs: { tex: "|x|" } }]);
    const out = cycle(doc);
    expect(out).not.toContain("<table");
    // Kein rohes "|" im TeX-Teil - sonst würde die Pipe-Zeile eine
    // zusätzliche Spalte bekommen (siehe DECISIONS). "\vert" bekommt hier
    // GENAU EIN Trennzeichen (vor dem Buchstaben "x"), aber KEINS vor dem
    // schließenden "$" - ein Leerzeichen DIREKT vor dem schließenden "$"
    // würde MATH_TOKEN_RE (math.jsx) die Formel unsichtbar machen (siehe
    // Kopfkommentar bei texSafeForTableCell/DocEditor.jsx).
    expect(out).toContain("$\\vert x\\vert$");
    const dataLine = out.split("\n").find((l) => l.includes("vert"));
    expect(dataLine.trim().split(/(?<!\\)\|/).length).toBe(4); // "", F, V, "" - genau 2 Spalten

    expect(realCycle(out)).toBe(out); // idempotent über den echten Lade-Pfad

    // Ansicht: die Formel rendert trotzdem korrekt als Betragsstriche
    // (nicht als "katex-error" wegen kaputtem TeX, UND nicht als rohes
    // "$…$"-Literal wegen eines versehentlich unsichtbar gemachten Tokens).
    const html = renderDoc(out);
    expect(html).toContain("katex");
    expect(html).not.toContain("katex-error");
    expect(html).not.toContain("$\\vert");
    expect(html).not.toContain("nicht dargestellt werden");
  });

  it("eine Formel mit '|' GEFOLGT von einer Ziffer braucht kein Trennzeichen (TeX-Control-Words verschlucken nur Buchstaben)", () => {
    const doc = tableDoc([{ type: "mathBlock", attrs: { tex: "x|2" } }]);
    const out = cycle(doc);
    expect(out).toContain("$x\\vert2$"); // kein Leerzeichen vor der Ziffer nötig
    expect(realCycle(out)).toBe(out);
    const html = renderDoc(out);
    expect(html).toContain("katex");
    expect(html).not.toContain("katex-error");
  });

  it("eine INLINE getippte Formel (mathInline) MIT '|' NEBEN Text in einer Zelle weicht ebenfalls auf '\\vert' aus", () => {
    // Direkt als mathInline-Node (Toolbar-Knopf "Formel inline") statt
    // mathBlock - andere Node-Art, aber IDENTISCHES Pipe-Risiko, weil ihr
    // Serializer ebenfalls state.write("$"+tex+"$") ohne Schutz aufrief.
    const doc = tableDoc([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Norm " },
          { type: "mathInline", attrs: { tex: "|x|" } },
        ],
      },
    ]);
    const editor = buildEditor(doc);
    const out = unescapeMd(editor.storage.markdown.getMarkdown());
    editor.destroy();
    expect(out).not.toContain("<table");
    expect(out).toContain("Norm $\\vert x\\vert$");
    expect(realCycle(out)).toBe(out);

    const html = renderDoc(out);
    expect(html).toContain("katex");
    expect(html).not.toContain("katex-error");
  });
});
