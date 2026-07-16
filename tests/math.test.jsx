import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MATH_TOKEN_RE, renderKatexHtml, renderMathText, renderMathToken, KatexSpan, expandMathInNodes,
  mathToPlaceholders, MATH_INLINE_TAG, MATH_BLOCK_TAG, MATH_SERIALIZED_RE, matchDisplayBlock,
  ESCAPED_DOLLAR_SENTINEL,
} from "../src/lib/math.jsx";

// Minimaler Gegenpart zu escapeHtmlAttr aus math.jsx, um im Test zu prüfen,
// dass die Attribut-Escapierung wirklich verlustfrei umkehrbar ist (genau
// die fünf Entities, die ein HTML-Parser beim Auslesen von getAttribute()
// automatisch zurückübersetzt).
const decodeHtmlAttr = (s) =>
  s.replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&").replace(/&#124;/g, "|");

const html = (nodes) => renderToStaticMarkup(<>{nodes}</>);
const strings = (nodes) => nodes.filter((n) => typeof n === "string");

describe("renderKatexHtml", () => {
  it("rendert gültiges TeX zu KaTeX-Markup", () => {
    const out = renderKatexHtml("x^2+y^2=z^2", false);
    expect(out).toContain('class="katex"');
    expect(out).toContain("application/x-tex");
    expect(out).not.toContain("katex-display");
  });

  it("displayMode verpackt zusätzlich in katex-display", () => {
    const out = renderKatexHtml("x^2", true);
    expect(out).toContain("katex-display");
  });

  it("wirft NIE bei ungültigem TeX (throwOnError:false) und liefert eine Fehler-Markierung", () => {
    expect(() => renderKatexHtml("\\invalidcommandxyz{", false)).not.toThrow();
    const out = renderKatexHtml("\\invalidcommandxyz{", false);
    expect(out).toContain("katex-error");
  });

  it("Backslash-Befehle (\\frac, \\Delta) werden korrekt weitergereicht", () => {
    const out = renderKatexHtml("\\frac{1}{2} + \\Delta", false);
    expect(out).toContain("application/x-tex");
    expect(out).toContain("\\frac{1}{2} + \\Delta".replace(/&/g, "&amp;"));
  });

  it("kein XSS-Weg: spitze Klammern/Skript-artiger Text werden von KaTeX selbst escaped", () => {
    const out = renderKatexHtml("<script>alert(1)</script>", false);
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("leerer/undefined TeX crasht nicht", () => {
    expect(() => renderKatexHtml(undefined, false)).not.toThrow();
    expect(() => renderKatexHtml("", true)).not.toThrow();
  });

  it("Cache: wiederholte Aufrufe mit gleichem TeX/displayMode liefern identisches Markup (Review-Finding 5)", () => {
    const a = renderKatexHtml("x^2+y^2", false);
    const b = renderKatexHtml("x^2+y^2", false);
    expect(a).toBe(b);
    // displayMode ist Teil des Cache-Keys - inline und display dürfen sich
    // trotz gleichem TeX nicht denselben (falschen) Eintrag teilen.
    const c = renderKatexHtml("x^2+y^2", true);
    expect(c).not.toBe(a);
    expect(c).toContain("katex-display");
  });

  it("Cache-Überlauf (> 500 Einträge) bricht nichts – weiterhin korrektes Markup danach", () => {
    for (let i = 0; i < 520; i++) renderKatexHtml("x_" + i, false);
    const out = renderKatexHtml("x^2+y^2", false); // längst verdrängt/geleert
    expect(out).toContain("application/x-tex");
    expect(out).toContain("x^2+y^2");
  });
});

describe("MATH_TOKEN_RE / renderMathText: Grundfälle", () => {
  it("erkennt Inline-Formel $...$", () => {
    const nodes = renderMathText("Es gilt $a^2+b^2=c^2$ laut Pythagoras.");
    expect(strings(nodes).join("")).toBe("Es gilt  laut Pythagoras.");
    const out = html(nodes);
    expect(out).toContain("application/x-tex");
    expect(out).not.toContain("katex-display");
  });

  it("erkennt Display-Formel $$...$$", () => {
    const nodes = renderMathText("$$E=mc^2$$");
    const out = html(nodes);
    expect(out).toContain("katex-display");
    expect(out).toContain("E=mc^2".replace(/&/g, "&amp;"));
  });

  it("$$ über mehrere Zeilen wird als eine Display-Formel erkannt", () => {
    const nodes = renderMathText("Vorher\n$$\na^2 + b^2\n= c^2\n$$\nNachher");
    expect(nodes.length).toBeGreaterThan(1);
    const out = html(nodes);
    expect(out).toContain("katex-display");
    expect(out).toContain("Vorher");
    expect(out).toContain("Nachher");
  });

  it("Formel mit Backslashes (\\frac, \\Delta) übersteht die Tokenisierung unverändert", () => {
    const nodes = renderMathText("Rate: $\\frac{\\Delta v}{\\Delta t}$ pro Sekunde.");
    const out = html(nodes);
    expect(out).toContain("\\frac{\\Delta v}{\\Delta t}".replace(/&/g, "&amp;"));
  });

  it("ungültiges TeX wirft nie und liefert eine sichtbare Fehlermarkierung statt Absturz", () => {
    expect(() => renderMathText("$\\notacommandxx{$")).not.toThrow();
    const out = html(renderMathText("$\\notacommandxx{$"));
    expect(out).toContain("katex-error");
  });
});

describe("Währungs-Sicherheit (Pandoc-Regel)", () => {
  it('"$50" bleibt Literaltext (kein schließendes $)', () => {
    const nodes = renderMathText("Das kostet $50 im Laden.");
    expect(nodes).toEqual(["Das kostet $50 im Laden."]);
  });

  it('"von 50 $ bis 60 $" bleibt Literaltext (führendes/schließendes $ jeweils an Leerzeichen)', () => {
    const text = "Die Spanne liegt von 50 $ bis 60 $ ungefähr.";
    expect(renderMathText(text)).toEqual([text]);
  });

  it('"$5 and $10" wird NICHT als Formel erkannt (schließendes $ vor Ziffer verboten)', () => {
    const text = "It costs $5 and $10 total.";
    expect(renderMathText(text)).toEqual([text]);
  });

  it("negative Finanzbeträge ohne Dollarzeichen bleiben unangetastet", () => {
    const text = "Differenz: -38.000 vs. -50.000";
    expect(renderMathText(text)).toEqual([text]);
  });

  it("mehrere Dollarbeträge in einem Satz bleiben komplett Literaltext", () => {
    const text = "Budget: $100, $250 und $999 in Summe.";
    expect(renderMathText(text)).toEqual([text]);
  });
});

describe("\\$-Escape", () => {
  it("\\$ wird zu einem literalen Dollarzeichen (Backslash verschwindet)", () => {
    const nodes = renderMathText("Preis: \\$5 exakt.");
    expect(strings(nodes).join("")).toBe("Preis: $5 exakt.");
  });

  it("mehrere \\$-Escapes hintereinander", () => {
    const nodes = renderMathText("\\$1\\$2\\$3");
    expect(strings(nodes).join("")).toBe("$1$2$3");
  });

  it("Escape verhindert, dass ein nachfolgendes echtes Formelpaar das escapte $ mit einschließt", () => {
    // "\$" bleibt literal, "$x$" direkt danach ist trotzdem eine echte Formel.
    const nodes = renderMathText("\\$ und $x$ auch.");
    expect(nodes[0]).toBe("$");
    const out = html(nodes);
    expect(out).toContain("application/x-tex");
  });
});

describe("mehrere Formeln und gemischter Inhalt", () => {
  it("zwei Inline-Formeln im selben Satz", () => {
    const nodes = renderMathText("$a$ plus $b$ ergibt etwas.");
    const out = html(nodes);
    expect((out.match(/class="katex"/g) || []).length).toBe(2);
  });

  it("Formel direkt gefolgt von Währungsbetrag bleibt getrennt korrekt", () => {
    const nodes = renderMathText("$x^2$ kostet $50 extra.");
    const out = html(nodes);
    expect((out.match(/class="katex"/g) || []).length).toBe(1);
    expect(strings(nodes).join("")).toContain("kostet $50 extra.");
  });
});

describe("renderMathToken", () => {
  it("liefert für Escape-Token einen reinen String, für Formel-Token ein KatexSpan-Element", () => {
    expect(renderMathToken("\\$", "k1")).toBe("$");
    const el = renderMathToken("$x$", "k2");
    expect(el.type).toBe(KatexSpan);
    expect(el.props.tex).toBe("x");
    expect(el.props.displayMode).toBe(false);
    const disp = renderMathToken("$$y$$", "k3");
    expect(disp.props.tex).toBe("y");
    expect(disp.props.displayMode).toBe(true);
  });
});

describe("expandMathInNodes (Wiederverwendung für Chat-Bubbles mit Quellen-Fußnoten)", () => {
  it("lässt bereits vorhandene React-Elemente (Fußnoten-Links) unangetastet", () => {
    const footnote = <sup key="c0"><a href="https://a.de">[1]</a></sup>;
    const nodes = expandMathInNodes(["Fakt ", footnote, " und $x^2$ Formel."]);
    expect(nodes[1]).toBe(footnote);
    expect(html(nodes)).toContain("application/x-tex");
    expect(html(nodes)).toContain('href="https://a.de"');
  });

  it("erzeugt keine doppelten Keys, wenn mehrere String-Segmente je eine Formel enthalten", () => {
    const nodes = expandMathInNodes(["$a$", <sup key="s"> </sup>, "$b$"]);
    const keys = nodes.filter((n) => n && typeof n === "object" && n.key != null).map((n) => n.key);
    expect(new Set(keys).size).toBe(keys.length); // alle Keys eindeutig
  });

  it("Segmente ohne Formel bleiben unverändert als reiner String erhalten", () => {
    const nodes = expandMathInNodes(["Nur Text ohne Formel."]);
    expect(nodes).toEqual(["Nur Text ohne Formel."]);
  });
});

describe("mathToPlaceholders (Lade-Pfad des WYSIWYG-Editors)", () => {
  const extractAttr = (html, tag) => {
    const re = new RegExp("<" + tag + ' data-tex="([\\s\\S]*?)"></' + tag + ">");
    const m = re.exec(html);
    return m ? decodeHtmlAttr(m[1]) : null;
  };

  it("wandelt Inline-Formel in ein math-inline-Tag mit data-tex-Attribut um", () => {
    const out = mathToPlaceholders("Es gilt $a^2+b^2=c^2$ hier.");
    expect(out).toContain("<" + MATH_INLINE_TAG);
    expect(extractAttr(out, MATH_INLINE_TAG)).toBe("a^2+b^2=c^2");
    expect(out).not.toContain("$a^2");
  });

  it("wandelt Display-Formel in ein math-block-Tag um", () => {
    const out = mathToPlaceholders("$$E=mc^2$$");
    expect(out).toContain("<" + MATH_BLOCK_TAG);
    expect(extractAttr(out, MATH_BLOCK_TAG)).toBe("E=mc^2");
  });

  it("mehrzeilige Display-Formel behält die Zeilenumbrüche im Attribut", () => {
    const out = mathToPlaceholders("$$\na^2 + b^2\n= c^2\n$$");
    expect(extractAttr(out, MATH_BLOCK_TAG)).toBe("\na^2 + b^2\n= c^2\n");
  });

  it("escaped &, <, >, \" im TeX-Inhalt korrekt (verlustfrei umkehrbar)", () => {
    const tex = 'x < 5 & y > 3 "quoted"';
    const out = mathToPlaceholders("$" + tex + "$");
    expect(out).not.toContain('"quoted"'); // rohes " würde das Attribut sprengen
    expect(extractAttr(out, MATH_INLINE_TAG)).toBe(tex);
  });

  it("escaped das Pipe-Zeichen im TeX-Inhalt (Re-Review-Finding R5)", () => {
    // Ein rohes | im Attribut wäre innerhalb einer Tabellenzeile
    // ununterscheidbar von einem GFM-Zellentrenner und würde das Tag beim
    // Parsen in Zell-Fragmente zerreißen.
    const tex = "a|b";
    const out = mathToPlaceholders("$" + tex + "$");
    const tagMatch = /<math-inline data-tex="([^"]*)">/.exec(out);
    expect(tagMatch[1]).not.toContain("|");
    expect(extractAttr(out, MATH_INLINE_TAG)).toBe(tex);
  });

  it("ein Formel-Tag mit Pipe im Attribut übersteht eine GFM-Tabellenzeile unversehrt (Re-Review-Finding R5)", () => {
    const out = mathToPlaceholders("| $a|b$ | 4 |\n| --- | --- |\n| x | y |");
    // Genau ein Tag - keine Fragmentierung durch den rohen Pipe im Attribut.
    expect((out.match(/<math-inline/g) || []).length).toBe(1);
    expect(extractAttr(out, MATH_INLINE_TAG)).toBe("a|b");
  });

  it("ein bereits im Dokument vorhandenes Sentinel-Zeichen wird neutralisiert (Re-Review-Finding R4)", () => {
    // Stünde der Sentinel schon vorher im Text (z. B. aus einem Icon-Font-
    // Paste), würde unescapeMd ihn beim Speichern sonst bedingungslos zu
    // einem \$-Escape machen - eine stille Fremdzeichen-Umdeutung.
    const text = "Vorher " + ESCAPED_DOLLAR_SENTINEL + " danach, echte Formel $x$.";
    const out = mathToPlaceholders(text);
    expect(out).not.toContain(ESCAPED_DOLLAR_SENTINEL);
    expect(extractAttr(out, MATH_INLINE_TAG)).toBe("x");
  });

  it("Backslash-Formeln (\\frac, \\Delta) bleiben im Attribut unverändert erhalten", () => {
    const out = mathToPlaceholders("$\\frac{1}{2} + \\Delta$");
    expect(extractAttr(out, MATH_INLINE_TAG)).toBe("\\frac{1}{2} + \\Delta");
  });

  it("\\$-Escape wird durch den Sentinel ersetzt, NICHT konsumiert (Review-Finding 2)", () => {
    // Der Backslash darf NICHT verlorengehen: würde \$ hier zu einem
    // nackten $ aufgelöst, änderte die nächste echte Bearbeitung (die den
    // Roundtrip über den Standard-Serializer + unescapeMd laufen lässt)
    // die Dokument-Semantik still (siehe tests/docEditorMath.test.jsx für
    // den vollen Editor-Roundtrip-Beweis dieses Pfads inkl. Idempotenz).
    const out = mathToPlaceholders("Preis exakt \\$5.");
    expect(out).toBe("Preis exakt " + ESCAPED_DOLLAR_SENTINEL + "5.");
    expect(out).not.toContain("<" + MATH_INLINE_TAG);
    expect(out).not.toContain("$"); // kein rohes $ mehr, das später fehlgepaart werden könnte
  });

  it("zwei \\$-Escapes ohne Formel dazwischen enthalten am Ende keine Dollarzeichen mehr", () => {
    // Regressionsschutz für den beim Testschreiben gefundenen Bug: die
    // ursprüngliche HTML-Entity-Variante ("&#92;$") kollidierte hier mit
    // der Formel-Schutz-Erkennung in unescapeMd (siehe DECISIONS).
    const out = mathToPlaceholders("Zwei escapte: \\$a\\$ hier.");
    expect(out).toBe("Zwei escapte: " + ESCAPED_DOLLAR_SENTINEL + "a" + ESCAPED_DOLLAR_SENTINEL + " hier.");
    expect(out).not.toContain("$");
  });

  it("Währungsbeträge bleiben unangetastet (keine Tags eingefügt)", () => {
    const text = "Das kostet $50, nicht $100 – Spanne 50 $ bis 60 $.";
    expect(mathToPlaceholders(text)).toBe(text);
  });

  it("zwei Inline-Formeln in einer Zeile werden unabhängig konvertiert", () => {
    const out = mathToPlaceholders("$a$ plus $b$ hier.");
    expect((out.match(new RegExp("<" + MATH_INLINE_TAG, "g")) || []).length).toBe(2);
    expect(extractAttr(out, MATH_INLINE_TAG)).toBe("a"); // erster Treffer
  });

  it('ein "$$…$$"-Paar MITTEN in einer Zeile (nicht am Zeilenanfang) bleibt komplett literal', () => {
    // Bewusst NICHT als Block/Inline konvertiert (Review-Finding 1b): ein
    // eingebetteter Block-Node mitten in einem Absatz würde ProseMirror
    // dazu bringen, den Absatz beim Speichern in mehrere Zeilen zu
    // zerlegen. Siehe MATH_INLINE_ONLY_RE-Kommentar in math.jsx.
    const text = "$a$ plus $b$ ist $$a+b$$ am Ende.";
    const out = mathToPlaceholders(text);
    expect((out.match(new RegExp("<" + MATH_INLINE_TAG, "g")) || []).length).toBe(2);
    expect(out).not.toContain("<" + MATH_BLOCK_TAG);
    expect(out).toContain("$$a+b$$"); // unverändert literal erhalten
  });

  it("Text ohne Formeln bleibt byte-identisch", () => {
    const text = "Ganz normaler Text ohne jede Formel.";
    expect(mathToPlaceholders(text)).toBe(text);
  });

  describe("Kontextbewusstsein (Review-Finding 1: Codespans, Absatzgrenzen, Bildzeilen)", () => {
    it("$x$ INNERHALB eines Codespans wird NICHT zur Formel (Finding 1a)", () => {
      const text = "Schreibe `$x$` um eine Inline-Formel zu erzeugen.";
      const out = mathToPlaceholders(text);
      expect(out).toBe(text); // komplett unverändert, Codespan bleibt Byte-für-Byte erhalten
      expect(out).not.toContain("<" + MATH_INLINE_TAG);
    });

    it("eine $$-Zeile mit einem Codespan davor konvertiert trotzdem korrekt (Codespan-Split zerstört Zeilenstruktur nicht)", () => {
      const out = mathToPlaceholders("Text mit `code` hier.\n\n$$\nx^2\n$$\n\nDanach.");
      expect(out).toContain("`code`"); // Codespan unangetastet
      expect(extractAttr(out, MATH_BLOCK_TAG)).toBe("\nx^2\n");
      expect(out).toContain("Danach.");
    });

    it("zwei $$-Vorkommen über MEHRERE ABSÄTZE hinweg werden NICHT zu einem Block gepaart (Finding 1b)", () => {
      // Vorher: MATH_TOKEN_RE lief blind übers Gesamtdokument und paarte
      // die beiden $$ über drei Absätze hinweg zu einem Block mit einer
      // Leerzeile im data-tex-Attribut – markdown-it hätte das Tag an der
      // Leerzeile zerrissen (Zerstörung beim nächsten Speichern).
      const text = "Das war teuer $$ im Ernst.\n\nViel Text dazwischen.\n\nNochmal $$ Ende.";
      const out = mathToPlaceholders(text);
      expect(out).toBe(text); // komplett literal, keine Formel, kein Tag
      expect(out).not.toContain("<" + MATH_BLOCK_TAG);
      expect(out).not.toContain("<" + MATH_INLINE_TAG);
    });

    it("eine öffnende $$-Zeile ohne jede schließende Zeile im Dokument bleibt literal (nicht Rest verschlucken)", () => {
      const text = "Vorher.\n\n$$\nx^2\ny^2\nkeine schließende Zeile hier";
      const out = mathToPlaceholders(text);
      expect(out).toBe(text);
      expect(out).not.toContain("<" + MATH_BLOCK_TAG);
    });

    it("Re-Review-Finding R1: eine öffnende $$-Zeile, eine Überschrift UND zwei Absätze zwischen Start und (Nicht-)Ende bleiben komplett literal", () => {
      // Exakt der vom Reviewer beschriebene Auslöser: eine Zeile, die mit
      // $$ beginnt (ohne Ende auf derselben Zeile), zwei Absätzen Text und
      // einer Überschrift dazwischen, und einer späteren Zeile, die mit $$
      // endet. Vorher: EIN <math-block>-Tag mit zwei Leerzeilen und der
      // Überschrift im data-tex-Attribut - markdown-it zerreißt so ein Tag.
      const text =
        "$$unterminiert\n\n## Neuer Abschnitt\n\nText hier $$";
      const out = mathToPlaceholders(text);
      expect(out).toBe(text); // byte-identisch, keine Formel, kein Tag
      expect(out).not.toContain("<" + MATH_BLOCK_TAG);
      expect(out).not.toContain("<" + MATH_INLINE_TAG);
    });

    it("Re-Review-Finding R1: Dollar-Slang ohne echte Formel wird über eine Leerzeile hinweg NICHT gepaart", () => {
      const text = "$$$ teuer heute.\n\nMehr Text.\n\nrichtig $$$ günstig.";
      const out = mathToPlaceholders(text);
      expect(out).toBe(text);
      expect(out).not.toContain("<" + MATH_BLOCK_TAG);
    });

    it("Re-Review-Finding R2: Codespan gefolgt von einzeiligem $$…$$ auf DERSELBEN Zeile bleibt komplett literal", () => {
      // Vorher: der globale Codespan-Split zerschnitt die Zeile VOR dem
      // Zeilen-Split, sodass das Segment nach dem Codespan wie eine eigene
      // Zeile aussah und fälschlich als Display-Block-Start erkannt wurde -
      // ein Block-Node MITTEN in der ursprünglichen Zeile hätte ProseMirror
      // dazu gebracht, den Absatz beim Speichern in zwei Blöcke zu
      // zerlegen.
      const text = "`x` $$y$$";
      const out = mathToPlaceholders(text);
      expect(out).toBe(text);
      expect(out).not.toContain("<" + MATH_BLOCK_TAG);
      expect(out).toContain("`x`");
      expect(out).toContain("$$y$$");
    });

    it("Re-Review-Finding R2: Codespan gefolgt von einzeiligem $x$ auf derselben Zeile wird trotzdem als Inline-Formel erkannt", () => {
      const out = mathToPlaceholders("`code` und $x$ hier.");
      expect(out).toContain("`code`");
      expect(extractAttr(out, MATH_INLINE_TAG)).toBe("x");
    });

    it("eine Bildzeile mit $-Zeichen im Titel bleibt unangetastet (Finding 9)", () => {
      const text = "![Kosten $5 pro Stück](img:ab12cd)";
      expect(mathToPlaceholders(text)).toBe(text);
    });

    it("eine Bildzeile mit einem echten Formelpaar im Titel bleibt ebenfalls unangetastet (Finding 9)", () => {
      const text = "![Wachstum $x^2$ im Zeitverlauf](img:ab12cd)";
      const out = mathToPlaceholders(text);
      expect(out).toBe(text);
      expect(out).not.toContain("<" + MATH_INLINE_TAG);
    });

    it("Codespan UND Formel im selben Dokument (unterschiedliche Zeilen) funktionieren nebeneinander", () => {
      const out = mathToPlaceholders("Syntax: `$x$`.\n\nEchte Formel: $y^2$ hier.");
      expect(out).toContain("`$x$`");
      expect(extractAttr(out, MATH_INLINE_TAG)).toBe("y^2");
    });
  });

  describe("Fence-Bewusstsein (v7.7): ```-Codeblöcke werden VOR jeder Math-Erkennung übersprungen", () => {
    it("$…$ INNERHALB eines Fenced-Codeblocks wird NICHT zur Formel", () => {
      const text = "```bash\necho \"$HOME kostet $5\"\n```";
      const out = mathToPlaceholders(text);
      expect(out).toBe(text); // byte-identisch
      expect(out).not.toContain("<" + MATH_INLINE_TAG);
    });

    it("eine $$…$$-Zeile INNERHALB eines Fenced-Codeblocks wird NICHT zum Formel-Block", () => {
      const text = "```text\nPreis:\n$$\nkein LaTeX, nur Text\n$$\n```";
      const out = mathToPlaceholders(text);
      expect(out).toBe(text);
      expect(out).not.toContain("<" + MATH_BLOCK_TAG);
    });

    it("Formeln VOR und NACH einem Codeblock werden weiterhin ganz normal konvertiert", () => {
      const out = mathToPlaceholders("Vorher $a$.\n\n```js\ncode\n```\n\nNachher $b$.");
      expect(out).toContain("```js\ncode\n```"); // Codeblock unangetastet
      expect((out.match(new RegExp("<" + MATH_INLINE_TAG, "g")) || []).length).toBe(2);
    });

    it("P10 (Re-Review 2026-07-17): ein unterminierter Zaun übernimmt den GESAMTEN Rest des Dokuments roh (bildet markdown-its Verschlucken nach)", () => {
      // markdown-it liest beim ECHTEN Editor-Laden ALLES ab einer nicht
      // geschlossenen Zaun-Zeile bis Dokumentende als EINEN Codeblock (z. B.
      // eine abgeschnittene Modellantwort) - ein $x$ darunter darf deshalb
      // NICHT zu einem Formel-Platzhalter werden, sonst leakt der Tag als
      // Literaltext INNERHALB dieses von markdown-it erkannten
      // Riesen-Codeblocks (empirisch belegt, Re-Review-Finding P10).
      const text = "Vorher $a$ noch normal.\n\n```js\nText ohne schließenden Zaun, echte Formel $x$ hier.";
      const out = mathToPlaceholders(text);
      // Text VOR der unterminierten Zaun-Zeile wird weiterhin ganz normal konvertiert.
      expect((out.match(new RegExp("<" + MATH_INLINE_TAG, "g")) || []).length).toBe(1);
      expect(extractAttr(out, MATH_INLINE_TAG)).toBe("a");
      // Ab der Zaun-Zeile bleibt ALLES roh (kein Tag für "$x$" weiter unten).
      expect(out.endsWith("```js\nText ohne schließenden Zaun, echte Formel $x$ hier.")).toBe(true);
    });

    it("ein unterminierter Zaun ganz ohne weiteren Inhalt bleibt schlicht eine literale Zeile", () => {
      const text = "```js";
      expect(mathToPlaceholders(text)).toBe(text);
    });

    it("ein Codeblock mit einer Bildzeilen-artigen Zeile bleibt roh (kein img-Sonderpfad innerhalb des Blocks)", () => {
      const text = "```md\n![Titel $5](img:ab12cd)\n```";
      expect(mathToPlaceholders(text)).toBe(text);
    });

    it("mehrere Codeblöcke mit Formeln dazwischen werden unabhängig korrekt verarbeitet", () => {
      const out = mathToPlaceholders("```a\n$x$\n```\n\nEcht: $y$\n\n```b\n$z$\n```");
      // Nur EINE echte Formel ($y$) wird konvertiert, die beiden $x$/$z$ in
      // den Codeblöcken bleiben roher Text.
      expect((out.match(new RegExp("<" + MATH_INLINE_TAG, "g")) || []).length).toBe(1);
      expect(extractAttr(out, MATH_INLINE_TAG)).toBe("y");
      expect(out).toContain("```a\n$x$\n```");
      expect(out).toContain("```b\n$z$\n```");
    });

    it("ein Fence-Label MIT Leerzeichen schützt den Inhalt trotzdem vollständig (Re-Review-Fix W1/P2)", () => {
      // Vorher lehnte FENCE_OPEN_RE ein Label mit Leerzeichen fälschlich ab
      // (CommonMark erlaubt es ausdrücklich) - die Zeile wäre NICHT als
      // Zaun erkannt worden, wodurch $x$ im Inhalt zur Formel geworden
      // wäre, obwohl markdown-it die Zeile beim tatsächlichen Laden im
      // Editor sehr wohl als Zaun parst (Divergenz-Bug).
      const text = "```python title=x\n$x$ bleibt roh\n```";
      const out = mathToPlaceholders(text);
      expect(out).toBe(text);
      expect(out).not.toContain("<" + MATH_INLINE_TAG);
    });

    it("ein 4-Backtick-Zaun um Inhalt mit eigenen 3-Backtick-Zeilen wird als GANZER Block geschützt (K1-Szenario)", () => {
      const text = "````js\nBeispiel:\n```\n$x$ bleibt roh\n```\n````";
      const out = mathToPlaceholders(text);
      expect(out).toBe(text);
      expect(out).not.toContain("<" + MATH_INLINE_TAG);
    });

    it("ein 4-Leerzeichen-eingerückter ```-Block wird NICHT als Zaun erkannt (Re-Review-Fix W2 – markdown-it liest ihn als eingerückten Codeblock, nicht als Zaun)", () => {
      // Ohne $-Zeichen im Inhalt gibt es dabei nichts zu konvertieren -
      // der Text bleibt so oder so byte-identisch, aber NICHT weil er als
      // Zaun geschützt wurde, sondern weil einfach nichts zu tun war
      // (definiertes, getestetes Verhalten statt stillschweigender Annahme).
      const text = "    ```js\n    plain\n    ```";
      const out = mathToPlaceholders(text);
      expect(out).toBe(text);
    });

    it("ein Tab-eingerückter ```-Block wird NICHT als Zaun erkannt (Re-Review-Fix W2/P9)", () => {
      const text = "\t```js\n\tplain\n\t```";
      const out = mathToPlaceholders(text);
      expect(out).toBe(text);
    });
  });
});

describe("matchDisplayBlock (geteilte Grundlage für Dokument-Ansicht UND Editor-Ladepfad)", () => {
  it("einzeilig: $$…$$ auf einer Zeile", () => {
    const r = matchDisplayBlock(["$$x^2$$"], 0);
    expect(r).toEqual({ tex: "x^2", endIdx: 0 });
  });

  it("mehrzeilig: sammelt bis zur schließenden $$-Zeile", () => {
    const r = matchDisplayBlock(["$$", "a^2", "= b", "$$", "Danach"], 0);
    expect(r).toEqual({ tex: "\na^2\n= b\n", endIdx: 3 });
  });

  it('"$$x$$ mehr Text" (Text NACH der schließenden $$) ist KEIN Block (Finding 4)', () => {
    expect(matchDisplayBlock(["$$x$$ mehr Text"], 0)).toBeNull();
  });

  it("unterminiert (keine schließende Zeile im Dokument) liefert null statt den Rest zu verschlucken (Finding 4)", () => {
    const lines = ["$$", "a", "b", "c"];
    expect(matchDisplayBlock(lines, 0)).toBeNull();
  });

  it("Zeile ohne $$-Start liefert null", () => {
    expect(matchDisplayBlock(["normaler Text"], 0)).toBeNull();
  });

  it("bricht bei einer LEERZEILE ab, statt darüber hinweg weiterzusuchen (Re-Review-Finding R1)", () => {
    // Der genaue Auslöser aus dem Re-Review: eine öffnende "$$"-Zeile ohne
    // echte Formel dahinter (Dollar-Slang), plus irgendeine spätere Zeile,
    // die mit "$$" endet, getrennt durch eine Leerzeile.
    const lines = ["$$$ teuer", "", "richtig $$$"];
    expect(matchDisplayBlock(lines, 0)).toBeNull();
  });

  it("bricht bei einer Überschriftenzeile (#/##/###) ab", () => {
    const lines = ["$$unterminiert", "## Neuer Abschnitt", "Text hier $$"];
    expect(matchDisplayBlock(lines, 0)).toBeNull();
  });

  it("eine Leerzeile MITTEN in einem sonst gültigen Block verhindert das Paaren", () => {
    const lines = ["$$", "a^2", "", "b^2", "$$"];
    expect(matchDisplayBlock(lines, 0)).toBeNull();
  });
});

describe("MATH_SERIALIZED_RE (DocEditor.jsx: unescapeMd darf Formeln nicht anfassen)", () => {
  // Simuliert exakt die Situation in DocEditor.jsx: der Editor-Serializer
  // schreibt Formeln als $tex$/$$tex$$ OHNE state.esc(); die anschließende
  // unescapeMd-Bereinigung darf diese Segmente nicht anfassen, MUSS aber
  // Backslash-Escapes AUSSERHALB von Formeln weiterhin entfernen.
  const split = (s) => new RegExp("(" + MATH_SERIALIZED_RE.source + ")");
  const unescapeMd = (md) =>
    md.split(split(md)).map((seg, i) => (i % 2 ? seg : seg.replace(/\\([\\`*_{}[\]()#+\-.!>~=])/g, "$1"))).join("");

  it("lässt \\{ \\} (Mengen-Notation) INNERHALB einer Formel unangetastet", () => {
    const md = "$\\{1,2,3\\}$";
    expect(unescapeMd(md)).toBe(md);
  });

  it("entfernt Serializer-Escapes AUSSERHALB von Formeln weiterhin normal", () => {
    const md = "$\\frac{1}{2}$ und normaler\\_Text mit Escape";
    expect(unescapeMd(md)).toBe("$\\frac{1}{2}$ und normaler_Text mit Escape");
  });

  it("KEINE \\$-Alternative: ein wörtlich getippter, vom Serializer escapter Backslash vor $ wird trotzdem korrekt entfernt", () => {
    // Default-Serializer escaped einen literal getippten Backslash: "\$" (2 Zeichen,
    // kein Formel-Bezug) wird zu "\\$" (3 Zeichen) im rohen getMarkdown()-Output.
    const serialized = "\\\\$"; // 3 Zeichen: \ \ $
    expect(unescapeMd(serialized)).toBe("\\$"); // 2 Zeichen: \ $ – korrekt wiederhergestellt
  });

  it("MATH_SERIALIZED_RE matcht KEIN \\$-Escape-Token (Unterschied zu MATH_TOKEN_RE)", () => {
    expect(MATH_TOKEN_RE.test("\\$")).toBe(true);
    expect(new RegExp("^(?:" + MATH_SERIALIZED_RE.source + ")$").test("\\$")).toBe(false);
  });
});

describe("MATH_TOKEN_RE direkt (Regressionsschutz für Chat/markdown.jsx-Wiederverwendung)", () => {
  it("matcht genau die drei Alternativen", () => {
    expect(MATH_TOKEN_RE.test("\\$")).toBe(true);
    expect(MATH_TOKEN_RE.test("$$x$$")).toBe(true);
    expect(MATH_TOKEN_RE.test("$x$")).toBe(true);
    expect(MATH_TOKEN_RE.test("$ x$")).toBe(false); // Leerzeichen direkt nach öffnendem $
    expect(MATH_TOKEN_RE.test("$x $")).toBe(false); // Leerzeichen direkt vor schließendem $
  });
});
