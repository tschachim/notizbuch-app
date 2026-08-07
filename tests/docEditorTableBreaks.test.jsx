// @vitest-environment jsdom
//
// v7.44, Thema 1 ("Umbrüche und Aufzählungen in Tabellenzellen wäre aber
// schon schön…"). Der Auftrag verlangt ausdrücklich, die GESAMTE Kette
// Editor -> Markdown -> Renderer -> Editor an echten Beispielen zu prüfen
// (nicht nur den Renderer isoliert, siehe tests/markdown.test.jsx).
//
// Befund, der den Auftrag überhaupt erst auslöste: Der EDITOR serialisiert
// einen harten Zeilenumbruch in einer Tabellenzelle bereits seit v7.x als
// "<br>" (MdTable, DocEditor.jsx, state.inTable=true) UND lädt ein "<br>"
// beim Öffnen (html:true, Standard-hardBreak-Parsing) korrekt wieder als
// echten Zeilenumbruch-Knoten zurück – das war NIE der Bug. Die Lücke war
// ausschließlich der schreibgeschützte Dokument-Renderer (DocView,
// lib/markdown.jsx), der "<br>" bisher nirgends kannte. Diese Datei belegt
// den EDITOR-seitigen Teil der Kette empirisch (kein bloßes Vertrauen auf
// den Kopfkommentar von MdTable), tests/markdown.test.jsx deckt den
// Renderer-Teil ab.
//
// Zwei Test-Datei-eigene Konventionen (empirisch ermittelt, siehe
// tests/docEditorIndent.test.jsx für dasselbe Muster bei anderen Blöcken):
// (1) Der eigene MdTable-Serializer schreibt die Trennzeile MIT Leerzeichen
// ("| --- |", nicht "|---|") – die "md"-Strings hier stehen deshalb von
// vornherein in dieser kanonischen Form, sonst wäre ein Byte-Vergleich
// gegen die eigene Serialisierung nie erfüllbar. (2) Eine Tabelle als
// LETZTER Block des gesamten Dokuments hinterlässt (unabhängig von "<br>",
// reine Eigenheit von MdTable: jede Zeile inkl. der Trennzeile endet mit
// einem SOFORTIGEN state.ensureNewLine(), nicht mit dem sonst üblichen,
// erst vom NÄCHSTEN Block ausgelösten state.closeBlock/flushClose) einen
// einzelnen zusätzlichen Zeilenumbruch am Dokumentende – ALLE "md"-Strings
// unten hängen deshalb bewusst einen weiteren Absatz an (wie ein echtes
// Notizbuch es ohnehin täte), um diese vorbestehende, mit dieser Änderung
// nicht zusammenhängende Eigenheit nicht in jedem einzelnen Test erneut
// aufzulösen.
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

const renderDoc = (text) =>
  renderToStaticMarkup(
    <DocView text={text} collapsed={{}} onToggle={() => {}} imgMap={{}} onImgClick={() => {}} onToggleTask={() => {}} />
  );

describe("Editor <-> Renderer-Roundtrip: <br> in Tabellenzellen (v7.44)", () => {
  it("ein beim Laden erkanntes \"<br>\" wird zu einem ECHTEN hardBreak-Knoten in der Zelle (kein Literaltext)", () => {
    const md = "# T\n\n| Spalte |\n| --- |\n| Zeile1<br>Zeile2 |\n\nEnde.";
    const editor = buildEditor(md);
    let hardBreaks = 0;
    let cellText = "";
    editor.state.doc.descendants((n) => {
      if (n.type.name === "hardBreak") hardBreaks++;
      if (n.type.name === "tableCell") cellText = n.textContent;
    });
    editor.destroy();
    expect(hardBreaks).toBe(1);
    // textContent verschluckt harte Umbrüche (kein Trenner) – der Beleg ist
    // der Knotentyp oben, hier nur zusätzlich: kein rohes "<br>" als Text.
    expect(cellText).not.toContain("<br");
    expect(cellText).toBe("Zeile1Zeile2");
  });

  it("Speichern serialisiert den hardBreak wieder als \"<br>\" (Rohtext byte-identisch zum Original)", () => {
    const md = "# T\n\n| Spalte |\n| --- |\n| Zeile1<br>Zeile2 |\n\nEnde.";
    const editor = buildEditor(md);
    const out = unescapeMd(editor.storage.markdown.getMarkdown());
    editor.destroy();
    expect(out).toBe(md);
  });

  it("Idempotenz: erneutes Laden des gespeicherten Textes ergibt wieder denselben hardBreak UND denselben Rohtext (zweiter Zyklus stabil)", () => {
    const md = "# T\n\n| A | B |\n| --- | --- |\n| Zeile1<br>Zeile2 | `code` |\n\nEnde.";
    const editor1 = buildEditor(md);
    const out1 = unescapeMd(editor1.storage.markdown.getMarkdown());
    editor1.destroy();
    expect(out1).toBe(md);

    const editor2 = buildEditor(out1);
    let hardBreaks = 0;
    editor2.state.doc.descendants((n) => { if (n.type.name === "hardBreak") hardBreaks++; });
    const out2 = unescapeMd(editor2.storage.markdown.getMarkdown());
    editor2.destroy();
    expect(hardBreaks).toBe(1);
    expect(out2).toBe(out1);
  });

  it("DocView (Renderer) zeigt denselben gespeicherten Text als ECHTEN Zeilenumbruch, nicht als \"<br>\"-Literaltext", () => {
    const md = "# T\n\n| Spalte |\n| --- |\n| Zeile1<br>Zeile2 |\n\nEnde.";
    const editor = buildEditor(md);
    const out = unescapeMd(editor.storage.markdown.getMarkdown());
    editor.destroy();
    const html = renderDoc(out);
    expect(html).toMatch(/<br\s*\/?>/);
    expect(html).not.toContain("&lt;br&gt;");
    expect(html).toContain("Zeile1");
    expect(html).toContain("Zeile2");
  });

  it("eine Zelle mit Pipe-Zeichen, Umbruch UND einer Aufzählung übersteht die GESAMTE Kette (Editor -> Markdown -> Renderer -> Editor)", () => {
    // "MdTable escaped Pipes bereits" (Auftrag) – hier zusätzlich mit "<br>"
    // und zwei Bullet-Zeilen in derselben Zelle kombiniert.
    const md = "# T\n\n| Spalte |\n| --- |\n| A\\|B<br>- eins<br>- zwei |\n\nEnde.";
    const editor = buildEditor(md);
    const out = unescapeMd(editor.storage.markdown.getMarkdown());
    editor.destroy();
    expect(out).toBe(md); // Roundtrip-stabil

    const html = renderDoc(out);
    expect(html).toContain("A|B"); // Pipe unescaped sichtbar, keine zerrissene Tabelle
    expect(html).toMatch(/<ul[^>]*>/);
    expect(html).toContain("eins");
    expect(html).toContain("zwei");

    // Erneutes Laden bleibt stabil (Idempotenz über die volle Kette).
    const editor2 = buildEditor(out);
    const out2 = unescapeMd(editor2.storage.markdown.getMarkdown());
    editor2.destroy();
    expect(out2).toBe(out);
  });
});
