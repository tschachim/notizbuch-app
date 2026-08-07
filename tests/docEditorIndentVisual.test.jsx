// @vitest-environment jsdom
//
// v7.42 (Nutzer-Befund "Einzug vergrößern hat keine sichtbare Auswirkung im
// Editor, nur in der Anzeige nach dem Speichern"). Root-Cause (siehe
// DECISIONS #86): indentAttrSpec.renderHTML (DocEditor.jsx) schrieb
// "data-indent" zwar korrekt ins DOM, aber src/index.css hatte dafür KEINE
// EINZIGE "[data-indent]"-Regel – rein optisch passierte deshalb nichts.
// ZUSÄTZLICH greift renderHTML() bei Bild UND Formelblock ohnehin NIE: beide
// haben eine EIGENE NodeView (Bild-Anfasser bzw. Formel-Bearbeitung), die ihr
// DOM selbst baut – ProseMirror rendert bei einer NodeView ausschließlich
// deren "dom" statt des Schema-toDOM, "data-indent" käme dort NIE an.
//
// Diese Datei prüft NUR das, was am ECHTEN, gerenderten ProseMirror-DOM
// (editor.view.dom, siehe @tiptap/core – ein "new Editor()" ohne "element"-
// Option baut trotzdem eine vollständige, wenn auch nicht in document.body
// eingehängte EditorView) beobachtbar ist: das Vorhandensein/den Wert des
// "data-indent"-Attributs auf allen DREI Knotentypen, UND sofortige/
// rückgängige Änderungen ohne Neuaufbau. jsdom rechnet KEIN Layout (siehe
// AUFTRAG) – ob "margin-left" tatsächlich einen sichtbaren Versatz erzeugt,
// lässt sich hier NICHT prüfen (getComputedStyle liefert in jsdom keine
// aufgelösten CSS-Regeln aus externen Stylesheets). Die CSS-Regeln selbst
// werden deshalb SEPARAT über den Quelltext von src/index.css verifiziert
// (siehe unten) – das ist ehrlich das Maximum, was ohne echten Browser
// beweisbar ist.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { Markdown } from "tiptap-markdown";
import {
  FencedCodeBlock, BlockImage, IndentParagraph, IndentMarkdownIt, IndentKeymap, MdTable,
  MathInline, MathBlock, SplitMixedTaskLists, changeIndent,
} from "../src/components/DocEditor.jsx";
import { mathToPlaceholders } from "../src/lib/math.jsx";

// Exakt dieselbe Verdrahtung wie tests/docEditorIndent.test.jsx (dort im
// Detail begründet) – hier dupliziert statt importiert, wie es die
// bestehenden docEditorXxx.test.jsx-Dateien bereits durchgängig handhaben
// (kein gemeinsames Test-Helfer-Modul in diesem Projekt).
function buildEditor(md, extra = []) {
  return new Editor({
    extensions: [
      IndentKeymap,
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, blockquote: false, paragraph: false }),
      IndentParagraph,
      FencedCodeBlock,
      BlockImage,
      SplitMixedTaskLists,
      TaskList,
      TaskItem.configure({ nested: true }),
      MdTable.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      MathInline,
      MathBlock,
      IndentMarkdownIt,
      ...extra,
      Markdown.configure({ html: true, bulletListMarker: "-", tightLists: true }),
    ],
    content: mathToPlaceholders(md),
  });
}

describe("Einzug SOFORT im Editor-DOM sichtbar (v7.42, Auftrag Teil A)", () => {
  it("ein bereits eingerückt geladener Absatz trägt data-indent direkt auf dem gerenderten <p>", () => {
    const editor = buildEditor("# T\n\n  Eingerueckter Absatz");
    const p = editor.view.dom.querySelector('p[data-indent="1"]');
    editor.destroy();
    expect(p).toBeTruthy();
    expect(p.textContent).toBe("Eingerueckter Absatz");
  });

  it("ein bereits eingerückt geladenes Bild trägt data-indent auf dem NodeView-Wrapper (.img-resize-wrap) – renderHTML allein würde hier NICHT ankommen", () => {
    const editor = buildEditor("# T\n\n  ![Titel](data:image/png;base64,AAA)");
    const wrap = editor.view.dom.querySelector('.img-resize-wrap[data-indent="1"]');
    editor.destroy();
    expect(wrap).toBeTruthy();
    // Das eigentliche <img> selbst bekommt das Attribut NICHT (nur der
    // Wrapper, den apply() in BlockImage.addNodeView() spiegelt) – die
    // generische CSS-Regel sitzt bewusst auf dem Wrapper, nicht auf <img>.
    expect(wrap.querySelector("img")).toBeTruthy();
  });

  it("ein bereits eingerückt geladener Formelblock trägt data-indent auf dem NodeView-Wrapper (.math-node-block)", () => {
    const editor = buildEditor("# T\n\n  $$x^2$$");
    const wrap = editor.view.dom.querySelector('.math-node-block[data-indent="1"]');
    editor.destroy();
    expect(wrap).toBeTruthy();
  });

  it("Ebene 0 (kein Einzug) trägt bei ALLEN drei Knotentypen KEIN data-indent-Attribut", () => {
    const editor = buildEditor("# T\n\nAbsatz\n\n![Bild](data:image/png;base64,AAA)\n\n$$x^2$$");
    const anyIndentAttr = editor.view.dom.querySelector("[data-indent]");
    editor.destroy();
    expect(anyIndentAttr).toBeNull();
  });

  it("changeIndent(+1) macht data-indent SOFORT sichtbar, ohne dass der Editor neu aufgebaut wird (Absatz, Bild UND Formel in EINER Auswahl)", () => {
    const md = "# T\n\nAbsatz\n\n![Bild](data:image/png;base64,AAA)\n\n$$x^2$$";
    const editor = buildEditor(md);
    editor.commands.selectAll();
    const applied = changeIndent(editor, 1);
    expect(applied).toBe(true);
    expect(editor.view.dom.querySelector('p[data-indent="1"]')).toBeTruthy();
    expect(editor.view.dom.querySelector('.img-resize-wrap[data-indent="1"]')).toBeTruthy();
    expect(editor.view.dom.querySelector('.math-node-block[data-indent="1"]')).toBeTruthy();
    editor.destroy();
  });

  it("changeIndent(-1) entfernt das Attribut wieder SOFORT (Rücksprung auf Ebene 0, kein Neuladen nötig)", () => {
    const md = "# T\n\n  Absatz\n\n  ![Bild](data:image/png;base64,AAA)\n\n  $$x^2$$";
    const editor = buildEditor(md);
    editor.commands.selectAll();
    const applied = changeIndent(editor, -1);
    expect(applied).toBe(true);
    expect(editor.view.dom.querySelector("[data-indent]")).toBeNull();
    editor.destroy();
  });

  it("mehrfaches changeIndent(+1) erhöht den sichtbaren Wert schrittweise bis zur Obergrenze 6, jeder Schritt sofort im DOM", () => {
    const editor = buildEditor("# T\n\nAbsatz");
    editor.commands.setTextSelection(4);
    for (let level = 1; level <= 6; level++) {
      const applied = changeIndent(editor, 1);
      expect(applied).toBe(true);
      expect(editor.view.dom.querySelector('p[data-indent="' + level + '"]')).toBeTruthy();
    }
    // Obergrenze erreicht: ein weiterer Klick ändert nichts mehr am DOM.
    const beyond = changeIndent(editor, 1);
    expect(beyond).toBe(false);
    expect(editor.view.dom.querySelector('p[data-indent="6"]')).toBeTruthy();
    editor.destroy();
  });

  it("eine reine Formel-INLINE (MathInline, kein Block) bekommt NIE ein data-indent-Attribut auf ihrem Wrapper (kein indent-Attribut im Schema)", () => {
    const editor = buildEditor("# T\n\nText mit $x^2$ mittendrin");
    const inlineWrap = editor.view.dom.querySelector(".math-node-inline");
    editor.destroy();
    expect(inlineWrap).toBeTruthy();
    expect(inlineWrap.hasAttribute("data-indent")).toBe(false);
  });
});

describe("CSS-Regeln für den sichtbaren Einzug (v7.42) – Quelltext-Prüfung, da jsdom kein Layout berechnet", () => {
  // jsdom kann kein Layout auflösen (getComputedStyle liefert keine aus
  // externen .css-Dateien geladenen Regeln) – eine "der Absatz steht jetzt
  // X Pixel weiter rechts"-Behauptung lässt sich hier NICHT verifizieren.
  // Stattdessen wird der Quelltext von src/index.css direkt geprüft: exakt
  // dieselben 1,5rem/Ebene wie die Dokument-Ansicht (lib/markdown.jsx,
  // INDENT_REM_PER_LEVEL) – sonst würde der Inhalt beim Speichern springen.
  const css = readFileSync(join(process.cwd(), "src/index.css"), "utf8");

  // Objekte mit $-benannten Platzhaltern statt Positions-Arrays: vitest
  // interpoliert "%i"/"%s" bei mehreren Platzhaltern pro Zeile sonst NICHT
  // zuverlässig 1:1 auf die Werte DIESER Zeile (beim Schreiben dieses Tests
  // selbst beobachtet – Titel zeigten teils die Werte der NÄCHSTEN Zeile).
  it.each([
    { level: 1, margin: "1.5rem" },
    { level: 2, margin: "3rem" },
    { level: 3, margin: "4.5rem" },
    { level: 4, margin: "6rem" },
    { level: 5, margin: "7.5rem" },
    { level: 6, margin: "9rem" },
  ])('Ebene $level hat eine [data-indent="$level"]-Regel mit margin-left: $margin', ({ level, margin }) => {
    const re = new RegExp(
      '\\[data-indent="' + level + '"\\]\\s*\\{[^}]*margin-left:\\s*' + margin.replace(".", "\\.") + '\\s*;'
    );
    expect(css).toMatch(re);
  });

  it("es gibt KEINE Regel für Ebene 0 oder Ebene 7 (Klemmung 1..6, wie indentAttrSpec)", () => {
    expect(css).not.toMatch(/\[data-indent="0"\]/);
    expect(css).not.toMatch(/\[data-indent="7"\]/);
  });

  // Review-Fund zu v7.42: Die Werte oben allein reichen NICHT.
  // ".tiptap-doc .math-node-block { margin: 0.75rem 0 }" setzt per
  // Kurzschreibweise margin-left:0 und hat DIESELBE Spezifitaet (0,2,0) wie
  // ".tiptap-doc [data-indent=n]" – dass der Einzug einer Formel trotzdem
  // gewinnt, haengt allein an der Quellreihenfolge. Wandert der
  // math-node-block-Block spaeter nach unten, verliert die Formel ihren
  // Einzug, waehrend alle Wert-Tests oben gruen blieben.
  it("die [data-indent]-Regeln stehen NACH .math-node-block (gleiche Spezifität – die Quellreihenfolge entscheidet)", () => {
    const mathIdx = css.indexOf(".math-node-block {");
    const indentIdx = css.indexOf('[data-indent="1"]');
    expect(mathIdx).toBeGreaterThan(-1);
    expect(indentIdx).toBeGreaterThan(mathIdx);
  });
});
