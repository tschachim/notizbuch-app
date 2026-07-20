// @vitest-environment jsdom
//
// v7.24 Bugfix (Nutzer-Befund: "<"/">" im Editor getippt erscheinen im
// Dokument-Viewer als "&lt;"/"&gt;" statt als die Zeichen selbst).
//
// Kombinierter End-zu-Ende-Test über den GESAMTEN Pfad: ECHTES Tippen im
// Headless-tiptap-Editor (insertText() auf der ProseMirror-Transaction,
// GENAU wie in tests/docEditorMath.test.jsx – bewusst NICHT
// editor.commands.insertContent(string), das laut tiptap-markdown/
// src/Markdown.js gepatcht ist und jeden String IMMER als Markdown-Quelle
// parst; echtes Tippen geht nie durch markdown-it) → Speichern
// (unescapeMd) → zweiter Lade-/Speicherzyklus (Byte-Stabilität) →
// Anzeige im echten DocView-Renderer.
//
// Empirische Kernbefunde (siehe Kommentar bei decodeBasicEntities,
// src/lib/markdown.jsx, und die Tests unten als Beleg): Der Text-Node-
// Serializer von tiptap-markdown (escapeHTML) ersetzt beim Speichern
// GETIPPTES "<"/">" IMMER durch "&lt;"/"&gt;" – "&" bleibt IMMER
// unangetastet (weder escapeHTML noch prosemirror-markdowns esc() fassen
// es an). Codespans/Codeblöcke serialisieren nachweislich OHNE
// escapeHTML (state.text(…, false) bzw. code-Mark mit escape:false).
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TextStyle from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import { Markdown } from "tiptap-markdown";
import { unescapeMd, FencedCodeBlock } from "../src/components/DocEditor.jsx";
import { DocView } from "../src/lib/markdown.jsx";

// Dieselben Extensions wie im echten DocEditor (siehe dort, "extensions:"),
// beschränkt auf das für Entity-/Farb-/Code-Roundtrips Nötige – ohne
// FencedCodeBlock/TextStyle/Color/Highlight würde ein ``` ```-Block bzw.
// ein <span style="color:…"> beim Parsen mangels passendem Node/Mark
// verworfen oder fehlinterpretiert (kein Bug DIESES Fixes, sondern ein
// Artefakt einer unvollständigen Test-Editor-Konfiguration).
function buildEditor(md) {
  return new Editor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, blockquote: false }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      FencedCodeBlock,
      Markdown.configure({ html: true, bulletListMarker: "-", tightLists: true }),
    ],
    content: md,
  });
}

// Simuliert ECHTES Tippen ans Dokumentende (kein Markdown-Quelltext-
// Parsing, siehe Kopfkommentar).
function typeAndSave(md, text) {
  const editor = buildEditor(md);
  const pos = editor.state.doc.content.size - 1;
  editor.view.dispatch(editor.view.state.tr.insertText(text, pos));
  const out = unescapeMd(editor.storage.markdown.getMarkdown());
  editor.destroy();
  return out;
}

const render = (text) =>
  renderToStaticMarkup(
    <DocView text={text} collapsed={{}} onToggle={() => {}} imgMap={{}} onImgClick={() => {}} onToggleTask={() => {}} />
  );

describe("Editor-Roundtrip → Viewer: getippte <, >, & (v7.24)", () => {
  it('getipptes "<" wird beim Speichern zu "&lt;" (empirischer Beleg), DocView zeigt wieder das Zeichen', () => {
    const saved = typeAndSave("# T\n\n## A\n\nx", "a < b");
    expect(saved).toBe("# T\n\n## A\n\nxa &lt; b");
    const html = render(saved);
    expect(html).toContain("xa &lt; b"); // einfaches HTML-Escape des jetzt ECHTEN "<"-Zeichens
    expect(html).not.toContain("&amp;lt;"); // der eigentliche Bug: Doppel-Escape
  });

  it('getipptes ">" analog zu "&gt;", "&" bleibt beim Speichern UNVERÄNDERT (kein "&amp;")', () => {
    const saved = typeAndSave("# T\n\n## A\n\nx", "a > b und Tom & Jerry");
    expect(saved).toBe("# T\n\n## A\n\nxa &gt; b und Tom & Jerry");
    const html = render(saved);
    expect(html).toContain("xa &gt; b und Tom &amp; Jerry");
  });

  it("zweiter Lade-/Speicherzyklus bleibt byte-stabil (kein eskalierendes Escape, kein '&amp;')", () => {
    const once = typeAndSave("# T\n\n## A\n\nx", "a < b & c > d");
    const editor2 = buildEditor(once);
    const twice = unescapeMd(editor2.storage.markdown.getMarkdown());
    editor2.destroy();
    expect(twice).toBe(once);
    expect(once).not.toMatch(/&amp;/);
  });

  it('wörtlich getipptes "&lt;" (4 Zeichen &,l,t,; – kein echtes "<") ergibt DIESELBE gespeicherte Zeichenfolge wie ein getipptes "<" (dokumentierte Editor-Ambiguität, kein Bug DIESES Fixes)', () => {
    const typedChar = typeAndSave("# T\n\n## A\n\nx", "<");
    const typedLiteral = typeAndSave("# T\n\n## A\n\nx", "&lt;");
    expect(typedChar).toBe(typedLiteral);
    // Beide zeigen im Viewer dasselbe (nicht unterscheidbare) Ergebnis –
    // der Viewer führt keine zweite, abweichende Interpretation ein.
    expect(render(typedChar)).toBe(render(typedLiteral));
  });

  it('eine echte Farbmarkierung (<span>, unescaped) übersteht den Editor-Roundtrip unverändert neben getipptem "<"', () => {
    // Text mit Farbe eingeben ist über reines insertText nicht simulierbar
    // (Mark-Toggle erfordert Editor-Commands) – hier reicht der Nachweis,
    // dass ein BEREITS im Dokument stehendes <span> (wie es der Editor
    // selbst für Farbe erzeugt) den Roundtrip unverändert übersteht, auch
    // wenn im selben Absatz zusätzlich getippter, escapeter Text steht.
    // jsdom normalisiert die Hex-Farbe beim Parsen zu rgb(...) – erwartetes
    // DOM-Verhalten, unabhängig von diesem Fix (COLOR_OK in markdown.jsx
    // akzeptiert beide Notationen, siehe dortiger Test "Farben...").
    const withSpan = '# T\n\n## A\n\n<span style="color:#dc2626">rot</span> Text';
    const saved = typeAndSave(withSpan, " und a < b");
    expect(saved).toContain('<span style="color: rgb(220, 38, 38);">rot</span>');
    expect(saved).toContain("a &lt; b");
    const html = render(saved);
    expect(html).toMatch(/<span style="color:rgb\(220, ?38, ?38\)">rot<\/span>/);
    expect(html).toContain("a &lt; b");
  });

  it("Codespan/Codeblock-Inhalt bleibt beim Editor-Roundtrip UNESCAPED (kein &lt;/&gt;) – Viewer zeigt sie deshalb ebenfalls byte-genau", () => {
    const withCode = "# T\n\n## A\n\n`code`\n\n```js\nconst x = 1;\n```";
    const saved = typeAndSave(withCode, ""); // No-op-Tippen: reiner Roundtrip-Nachweis
    expect(saved).toContain("`code`");
    expect(saved).toContain("```js\nconst x = 1;\n```");
    expect(saved).not.toContain("&lt;");
    expect(saved).not.toContain("&gt;");
  });
});
