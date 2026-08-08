// @vitest-environment jsdom
//
// v7.48, Fehler 1 ("HTML-Fallback einer Tabellenzelle wird von der
// Leseansicht nicht gerendert"): v7.47 hatte eine Zelle mit einem Bild/einer
// Formel als EINZIGEM Inhalt über den bereits vorhandenen HTML-Fallback
// (getHTMLFromFragment, DocEditor.jsx) gerettet – die Dokument-ANSICHT
// (renderTable/renderBlocks, markdown.jsx) versteht aber ausschließlich das
// GFM-Pipe-Format ("| a | b |"). Rohes Block-HTML fiel dort in den normalen
// Absatz-Zweig und erschien als sichtbarer HTML-Klartext – die GANZE
// Tabelle verschwand aus der Ansicht (schlimmer als der v7.47-Ausgangsfehler,
// bei dem nur das Bild selbst verloren ging).
//
// Fix (siehe DECISIONS + Kopfkommentar bei gfmSerializable/DocEditor.jsx):
// Bild/Formel als einziger Zellinhalt bleiben jetzt GFM-Pipe-Format
// ("![Alt](img:id)" bzw. inline "$tex$") – renderInline (markdown.jsx)
// erkennt eine Bildreferenz jetzt auch MITTEN im Zelltext (IMG_INLINE_RE),
// nicht mehr nur zeilenverankert (IMG_LINE_RE). Formeln funktionierten
// inline in einer Zelle bereits vorher (MATH_TOKEN_RE ist kontextfrei).
//
// Diese Tests prüfen DIREKT die ANSICHT (DocView), nicht nur die
// Editor-Serialisierung (siehe tests/docEditorTableBlockCells.test.jsx für
// den Serializer-Nachweis) - ohne den Fix (IMG_INLINE_RE/InlineImg noch
// nicht vorhanden bzw. TableCell/renderTable reichen kein imgMap durch)
// bleibt der erste Test unten ROT (Bild erscheint als Literaltext
// "![alt](img:xyz)" statt als <img>, siehe manuelle Gegenprobe im Bericht).
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DocView } from "../src/lib/markdown.jsx";

const render = (text, imgMap = {}) =>
  renderToStaticMarkup(
    <DocView
      text={text}
      collapsed={{}}
      onToggle={() => {}}
      imgMap={imgMap}
      onImgClick={() => {}}
      onToggleTask={() => {}}
    />
  );

describe("DocView: Tabelle mit Bild-/Formel-Zelle (v7.48-Fix, vorher 🔴-Finding)", () => {
  const IMG_SRC = "data:image/png;base64,QUFB";
  const md =
    "# T\n\n## A\n\n| Kopf | Wert |\n| --- | --- |\n| QA-Text | ![QA-Bild](img:xyz) |\n| Formel | $x^2+y^2$ |";

  it("rendert eine ECHTE Tabelle (kein HTML-Klartext) mit Bild UND Formel in ihren Zellen", () => {
    const html = render(md, { xyz: IMG_SRC });
    // Es entsteht wirklich ein <table>-Element (nicht nur ein Absatz).
    expect(html).toContain("<table");
    expect(html).toContain("QA-Text");
    // Das Bild ist ein echtes <img> mit aufgelöstem src, nicht Literaltext.
    expect(html).toContain("<img");
    expect(html).toContain(IMG_SRC);
    expect(html).not.toContain("![QA-Bild]");
    expect(html).not.toContain("img:xyz");
    // Die Formel ist als KaTeX gerendert, nicht als rohes "$…$".
    expect(html).toContain("katex");
    expect(html).not.toContain("$x^2+y^2$");
    // Kein roher HTML-Fallback-Text (die eigentliche Regression).
    expect(html).not.toContain("<table style=");
    expect(html).not.toContain("colgroup");
  });

  it("ein Bild in einer Zelle bleibt klickbar (onImgClick-Callback erreichbar wie beim Block-Bild)", () => {
    // renderToStaticMarkup kann keine Events auslösen - hier reicht der
    // strukturelle Nachweis, dass das <img> überhaupt entsteht (das
    // Klick-Verhalten selbst nutzt denselben Callback wie das etablierte,
    // bereits getestete Block-Bild, siehe markdown.jsx#InlineImg).
    const html = render(md, { xyz: IMG_SRC });
    expect(html).toContain("cursor-pointer");
  });

  it("ein Bild OHNE eingetragenes imgMap (noch nicht geladen) zeigt einen Platzhalter statt Literaltext oder Absturz", () => {
    const html = render(md, {}); // "xyz" nicht in imgMap enthalten
    expect(html).not.toContain("![QA-Bild]");
    expect(html).not.toContain("<img");
    expect(html).toContain("Bild wird geladen");
  });

  it("eine gewöhnliche Zelle OHNE Bild/Formel bleibt unverändert (keine Regression durch die neue Inline-Bild-Erkennung)", () => {
    const html = render(
      "# T\n\n## A\n\n| Kopf |\n| --- |\n| ganz normaler Text |",
      {}
    );
    expect(html).toContain("ganz normaler Text");
    expect(html).not.toContain("<img");
  });

  it("ein Bild MITTEN in normalem Fließtext (außerhalb einer Tabelle) bleibt weiterhin Literaltext (bewusst NICHT geändert, siehe DECISIONS)", () => {
    // Die neue Inline-Bild-Erkennung ist bewusst auf Tabellenzellen
    // beschränkt (TableCell reicht "media" durch, normale Absätze/Listen
    // NICHT) - ein Bild MITTEN im Text eines Absatzes bleibt exakt wie vor
    // v7.48 Literaltext (die App-Konvention verlangt seit v7.2 ohnehin eine
    // eigene Zeile für ein Bild, siehe IMG_LINE_RE).
    const html = render("# T\n\n## A\n\nText davor ![x](img:xyz) Text danach", {
      xyz: IMG_SRC,
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("img:xyz");
  });
});

describe("DocView: strukturell nicht darstellbare Tabelle (z. B. per Paste, HTML-Fallback) zeigt einen Hinweis statt einer HTML-Wüste", () => {
  it("ein roher <table>-HTML-Block (Fallback für verbundene Zellen) wird NICHT als Klartext angezeigt", () => {
    // Exakt die Form, die getHTMLFromFragment (DocEditor.jsx) für eine
    // strukturell nicht GFM-darstellbare Tabelle erzeugt (verbundene
    // Zellen/mehrere Absätze - nur per Copy&Paste erreichbar, siehe
    // DECISIONS) - landet als EINE Zeile im Markdown-Dokument.
    const rawHtml =
      '<table style="min-width: 50px;"><colgroup><col></colgroup><tbody><tr>' +
      "<th><p>QA-Text</p></th></tr></tbody></table>";
    const html = render("# T\n\n## A\n\n" + rawHtml);
    // Der Hinweistext erscheint sichtbar …
    expect(html).toContain("nicht dargestellt werden");
    // … der rohe HTML-Quelltext dagegen NICHT als sichtbarer Klartext.
    expect(html).not.toContain("min-width: 50px");
    expect(html).not.toContain("colgroup");
    expect(html).not.toContain("QA-Text");
  });

  it("ein normaler Absatz, der zufällig mit '<table' beginnt, bleibt sichtbarer Text (Review-Fund: verschwand vorher fälschlich hinter dem Hinweiskasten)", () => {
    // RAW_TABLE_HTML_RE prüfte ursprünglich NUR den Zeilenanfang - ein ganz
    // normaler Satz wie "<table> ist ein HTML-Element." löste dadurch
    // fälschlich den Hinweiskasten aus und der Nutzertext verschwand aus der
    // Ansicht (Daten blieben im Markdown erhalten, aber die ANSICHT "aß" den
    // Satz - ein neues, kleines Gegenstück zum eigentlich gemeldeten
    // Problem). Der ECHTE HTML-Fallback endet IMMER auf derselben Zeile mit
    // "</table>" (siehe RAW_TABLE_HTML_RE-Kommentar) - dieser Satz tut das
    // nicht und muss deshalb normaler, sichtbarer Text bleiben.
    const html = render("# T\n\n## A\n\n<table> ist ein HTML-Element.");
    expect(html).toContain("ist ein HTML-Element");
    expect(html).not.toContain("nicht dargestellt werden");
  });

  it("eine Zeile, die mit '<table' beginnt, aber NICHT auf derselben Zeile mit '</table>' endet, bleibt sichtbarer Text (kein echter Fallback, GIGO)", () => {
    // Der ECHTE HTML-Fallback (MdTable/DocEditor.jsx) schreibt IMMER die
    // komplette, in sich geschlossene Tabelle als eine Zeile - eine Zeile
    // ohne schließendes "</table>" kann von diesem Mechanismus gar nicht
    // stammen (z. B. von Hand editiertes/unterbrochenes Markdown).
    const html = render("# T\n\n## A\n\n<table><tr><td>x</td></tr>");
    // React escaped den Klartext beim Rendern (kein echtes Markup) - genau
    // das ist der Beleg, dass die Zeile normal als Absatz-Text lief statt
    // als HTML-Fallback erkannt zu werden.
    expect(html).toContain("&lt;table&gt;&lt;tr&gt;");
    expect(html).not.toContain("nicht dargestellt werden");
  });
});
