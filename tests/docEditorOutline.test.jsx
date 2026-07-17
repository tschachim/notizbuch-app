// @vitest-environment jsdom
//
// v7.14 (Nutzerwunsch "zweistufige Gliederung"): zwei Dinge werden hier
// geprüft, nach demselben Muster wie tests/docEditorMath.test.jsx /
// tests/docEditorCode.test.jsx / tests/docEditorLinks.test.jsx (echter
// TipTap/markdown-it-Zyklus statt String-Helfer nachzubauen):
// 1. extractOutline (reine Funktion, exportiert aus DocEditor.jsx) liefert
//    Level 1/2-Überschriften mit Text+Position aus dem ECHTEN ProseMirror-
//    Dokument.
// 2. "# Kapitel"-Zeilen überstehen den Lade-/Speicher-Roundtrip byte-stabil
//    – auch neben Formeln, Codeblöcken und generischen Links (StarterKit
//    hatte "heading: { levels: [1, 2, 3] }" bereits VOR v7.14 aktiv, d. h.
//    Level-1-Überschriften wurden schon vorher als echte heading-Nodes
//    geparst/serialisiert; v7.14 ergänzt nur den Toolbar-Knopf und die
//    Gliederungs-Leiste – dieser Test pinnt ab, dass der Roundtrip dadurch
//    nicht überraschend bricht).
// Nur DIESE Datei braucht jsdom (per-Datei-Override), der Rest der Suite
// bleibt bei environment:"node" (vitest.config.js).
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Markdown } from "tiptap-markdown";
import {
  extractOutline, FencedCodeBlock, LinkDecorations, MathInline, MathBlock, unescapeMd,
} from "../src/components/DocEditor.jsx";
import { mathToPlaceholders } from "../src/lib/math.jsx";

const LinkExt = Link.configure({
  openOnClick: false,
  autolink: true,
  linkOnPaste: true,
  isAllowedUri: (url, ctx) => ctx.defaultValidate(url) && /^https?:/i.test(url),
});

function buildEditor(md) {
  return new Editor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, blockquote: false }),
      FencedCodeBlock,
      LinkExt,
      LinkDecorations,
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

describe("extractOutline (reine Funktion, DocEditor.jsx)", () => {
  it("liefert Level 1 und 2 mit Text und aufsteigender Position, in Dokumentreihenfolge (Titelzeile ausgenommen)", () => {
    const md = "# T\n\n# Kapitel Eins\n\n## Abschnitt A\n\ntext\n\n## Abschnitt B\n\n# Kapitel Zwei\n\n## Abschnitt C";
    const editor = buildEditor(md);
    const outline = extractOutline(editor.state.doc);
    editor.destroy();
    // "# T" (Position 0, Notizbuch-Titelzeile) erscheint NICHT in der Liste.
    expect(outline.map((o) => [o.level, o.text])).toEqual([
      [1, "Kapitel Eins"],
      [2, "Abschnitt A"],
      [2, "Abschnitt B"],
      [1, "Kapitel Zwei"],
      [2, "Abschnitt C"],
    ]);
    for (let i = 1; i < outline.length; i++) {
      expect(outline[i].pos).toBeGreaterThan(outline[i - 1].pos);
    }
  });

  it("ignoriert Level 3 (Unterthemen gehören nicht in die Gliederungs-Leiste)", () => {
    const editor = buildEditor("# T\n\n# K\n\n## A\n\n### Unter\n\ntext");
    const outline = extractOutline(editor.state.doc);
    editor.destroy();
    expect(outline.map((o) => o.level)).toEqual([1, 2]);
    expect(outline.some((o) => o.text === "Unter")).toBe(false);
  });

  it("ein Dokument ohne jede Überschrift liefert eine leere Liste", () => {
    const editor = buildEditor("Nur Fließtext ohne Überschrift.");
    const outline = extractOutline(editor.state.doc);
    editor.destroy();
    expect(outline).toEqual([]);
  });

  it("wirft nie bei fehlendem/kaputtem Doc-Argument (Randfälle)", () => {
    expect(extractOutline(null)).toEqual([]);
    expect(extractOutline(undefined)).toEqual([]);
    expect(extractOutline({})).toEqual([]);
  });

  it("eine leere Überschrift (nur '# ' ohne Text) liefert einen Eintrag mit leerem text, keinen Absturz", () => {
    const editor = buildEditor("# T\n\n# \n\n## A");
    const outline = extractOutline(editor.state.doc);
    editor.destroy();
    expect(outline[0].level).toBe(1);
    expect(outline[0].text).toBe("");
  });

  // v7.14-Nachbesserung (Code-Review vor dem Commit): Parität zu
  // markdown.jsx#parseTree – die Titelzeile-Ausnahme gilt NUR für die
  // allererste Überschrift des Dokuments (Position 0), nicht für JEDE
  // Level-1-Überschrift.
  describe("Titel-Ausnahme: NUR die allererste Level-1-Überschrift ist der Titel", () => {
    it("ein Dokument OHNE separate Titelzeile listet seine erste Überschrift NICHT (sie IST die Titelzeile)", () => {
      const editor = buildEditor("# Kapitel Eins\n\n## Abschnitt A");
      const outline = extractOutline(editor.state.doc);
      editor.destroy();
      expect(outline.map((o) => [o.level, o.text])).toEqual([[2, "Abschnitt A"]]);
    });

    it("ein #-Kapitel DIREKT NACH der Titelzeile (kein ## davor) wird trotzdem korrekt gelistet – exakt das Review-Regressionsszenario", () => {
      // "# Titel / # Kapitel A / ## A1 / # Kapitel B / ## B1": Kapitel A
      // steht VOR dem ersten "##" – eine sawSection-Gate-Heuristik hätte es
      // fälschlich verschluckt (siehe DECISIONS #60, Nachbesserung).
      const md = "# Titel\n\n# Kapitel A\n\n## A1\n\n# Kapitel B\n\n## B1";
      const editor = buildEditor(md);
      const outline = extractOutline(editor.state.doc);
      editor.destroy();
      expect(outline.map((o) => [o.level, o.text])).toEqual([
        [1, "Kapitel A"],
        [2, "A1"],
        [1, "Kapitel B"],
        [2, "B1"],
      ]);
    });
  });
});

describe("Editor-Roundtrip: # Kapitel (v7.14) bleibt byte-stabil", () => {
  it("ein einfaches Dokument mit zwei #-Kapiteln bleibt byte-identisch", () => {
    const md = "# T\n\n## A\n\n- x\n\n# Kapitel Zwei\n\n## B\n\n- y";
    expect(roundtrip(md)).toBe(md);
  });

  it("# Kapitel direkt neben Inline- UND Display-Formeln bleibt byte-identisch", () => {
    const md = "# T\n\n## A\n\nEs gilt $x^2$ hier.\n\n# Kapitel Zwei\n\n## B\n\n$$E=mc^2$$";
    expect(roundtrip(md)).toBe(md);
  });

  it("# Kapitel direkt neben einem Fenced-Codeblock bleibt byte-identisch", () => {
    const md = "# T\n\n## A\n\n```js\nconst x = 1;\n```\n\n# Kapitel Zwei\n\n## B\n\n- y";
    expect(roundtrip(md)).toBe(md);
  });

  it("# Kapitel direkt neben einem generischen Link bleibt byte-identisch", () => {
    const md = "# T\n\n## A\n\nSiehe [Titel](https://example.org/a) dazu.\n\n# Kapitel Zwei\n\n## B\n\n- y";
    expect(roundtrip(md)).toBe(md);
  });

  it("ein leeres #-Kapitel (keine ##-Abschnitte darin) bleibt byte-identisch", () => {
    const md = "# T\n\n## A\n\n- x\n\n# Leeres Kapitel\n\n# Kapitel Zwei\n\n## B\n\n- y";
    expect(roundtrip(md)).toBe(md);
  });

  it("toggleHeading(level:1) auf einem Absatz erzeugt beim Speichern eine echte '# '-Zeile", () => {
    const editor = buildEditor("# T\n\n## A\n\nEinfacher Absatz");
    // Cursor ans Ende des Dokuments (in den letzten Absatz) und diesen zu
    // einer Level-1-Überschrift machen (exakt der Toolbar-Knopf-Befehl).
    editor.chain().focus("end").toggleHeading({ level: 1 }).run();
    const out = unescapeMd(editor.storage.markdown.getMarkdown());
    editor.destroy();
    expect(out).toContain("# Einfacher Absatz");
  });
});
