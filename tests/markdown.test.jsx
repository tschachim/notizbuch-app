import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DocView, parseTree, renumberCitations, TASK_RE, IMG_LINE_RE } from "../src/lib/markdown.jsx";

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

describe("parseTree", () => {
  it("liefert Abschnitte mit Original-Zeilenindizes (Grundlage fürs Checkbox-Toggling)", () => {
    const doc = "# T\n\n## A\n\n- [ ] eins\n\n### Sub\n\n- [x] zwei\n\n## B\n\n- drei";
    const { pre, sections } = parseTree(doc);
    expect(sections.map((s) => s.title)).toEqual(["A", "B"]);
    // H1 gehört zum Vorspann und behält Zeile 0
    expect(pre[0]).toEqual({ text: "# T", idx: 0 });
    // "- [ ] eins" steht im Original auf Zeile 4 – exakt dieser Index muss
    // beim Abhaken die richtige Markdown-Zeile treffen
    expect(sections[0].lines.find((l) => l.text.includes("eins"))).toEqual({ text: "- [ ] eins", idx: 4 });
    // ###-Unterthemen hängen unter dem Hauptabschnitt, mit Original-Index
    expect(sections[0].subs.map((s) => s.title)).toEqual(["Sub"]);
    expect(sections[0].subs[0].lines.find((l) => l.text.includes("zwei")).idx).toBe(8);
  });
  it("Inhalt vor dem ersten ## landet im Vorspann, ### ohne ## erzeugt 'Allgemein'", () => {
    const { pre, sections } = parseTree("# T\n\nfrei\n\n### Nur Sub\n\n- x");
    expect(pre.some((l) => l.text === "frei")).toBe(true);
    expect(sections[0].title).toBe("Allgemein");
    expect(sections[0].subs[0].title).toBe("Nur Sub");
  });
});

describe("renumberCitations", () => {
  it("nummeriert dokumentweit ab 1, gleiche URL = gleiche Nummer", () => {
    const md = "- a[0](https://b.de)\n- b[7](https://a.de) c[0](https://b.de)";
    expect(renumberCitations(md)).toBe("- a[1](https://b.de)\n- b[2](https://a.de) c[1](https://b.de)");
  });
  it("ist idempotent", () => {
    const once = renumberCitations("- x[0](https://a.de) y[0](https://b.de)");
    expect(renumberCitations(once)).toBe(once);
  });
  it("lässt Codespans in Ruhe", () => {
    const md = "- Doku: `[9](https://x.de)` bleibt[0](https://a.de)";
    expect(renumberCitations(md)).toBe("- Doku: `[9](https://x.de)` bleibt[1](https://a.de)");
  });
  it("unterstützt Wikipedia-URLs mit Klammern", () => {
    const md = "- s[0](https://de.wikipedia.org/wiki/Steak_(Fleisch))";
    expect(renumberCitations(md)).toBe("- s[1](https://de.wikipedia.org/wiki/Steak_(Fleisch))");
  });
});

describe("DocView: Grundgerüst", () => {
  it("rendert H1, Abschnitte, Stichpunkte, fett/kursiv/Code", () => {
    const html = render("# Titel\n\n## Thema\n\n- **fett** und *kursiv* und `code`");
    expect(html).toContain("Titel");
    expect(html).toContain("Thema");
    expect(html).toMatch(/<strong[^>]*>fett<\/strong>/);
    expect(html).toMatch(/<em>kursiv<\/em>/);
    expect(html).toMatch(/<code[^>]*>code<\/code>/);
  });

  it("_-Kursiv nur an Wortgrenzen (snake_case bleibt Text)", () => {
    const html = render("# T\n\n## A\n\n- snake_case_wort und _echt_ hier");
    expect(html).toContain("snake_case_wort");
    expect(html).toMatch(/<em>echt<\/em>/);
  });

  it("rendert nummerierte Listen, Trennlinien und ###-Unterthemen", () => {
    const html = render("# T\n\n## A\n\n1. erstens\n2. zweitens\n\n---\n\n### Unterthema\n\n- Punkt");
    expect(html).toMatch(/<ol[^>]*>/);
    expect(html).toContain("erstens");
    expect(html).toMatch(/<hr/);
    expect(html).toContain("Unterthema");
  });

  it("eingeklappte Abschnitte verstecken ihren Inhalt, Überschrift bleibt klickbar", () => {
    const open = renderToStaticMarkup(
      <DocView text={"# T\n\n## Geheim\n\n- Inhalt XYZ"} collapsed={{}} onToggle={() => {}}
        imgMap={{}} onImgClick={() => {}} onToggleTask={() => {}} />
    );
    const closed = renderToStaticMarkup(
      <DocView text={"# T\n\n## Geheim\n\n- Inhalt XYZ"} collapsed={{ "s:Geheim": true }} onToggle={() => {}}
        imgMap={{}} onImgClick={() => {}} onToggleTask={() => {}} />
    );
    expect(open).toContain("Inhalt XYZ");
    expect(closed).not.toContain("Inhalt XYZ");
    expect(closed).toContain("Geheim");
  });

  it("rendert Checkboxen mit korrektem checked-Zustand", () => {
    const html = render("# T\n\n## A\n\n- [ ] offen\n- [x] fertig");
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html.match(/checked=""/g) || html.match(/checked/g)).toBeTruthy();
    expect(html).toContain("offen");
    expect(html).toContain("fertig");
  });
});

describe("DocView: Farben nur mit validierten Werten (XSS-Schutz)", () => {
  it("übernimmt gültige Farben, verwirft alles andere", () => {
    const html = render(
      '# T\n\n## A\n\n- <span style="color:#dc2626">rot</span> <mark data-color="#fde047">gelb</mark>'
    );
    expect(html).toContain("color:#dc2626");
    expect(html).toContain("background-color:#fde047");
    const evil = render(
      '# T\n\n## A\n\n- <span style="color:expression(alert(1))">x</span>'
    );
    expect(evil).not.toContain("expression");
  });

  it("fremde HTML-Tags erscheinen als Literaltext, nie als Markup", () => {
    const html = render('# T\n\n## A\n\n- <script>alert(1)</script> <img src=x onerror=y>');
    expect(html).not.toMatch(/<script>/);
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("DocView: Tabellen (GFM)", () => {
  const TABLE = "# T\n\n## A\n\n| Kopf1 | Kopf2 |\n|---|---|\n| a | b \\| c |\n| kurz |";
  it("rendert thead/tbody, escaped Pipe bleibt Literal, ragged rows werden aufgefüllt", () => {
    const html = render(TABLE);
    expect(html).toContain("<thead>");
    expect(html).toContain("Kopf1");
    expect(html).toContain("b | c");
    // kurze Zeile auf Kopfbreite gepolstert: 2 Zellen in jeder tbody-Zeile
    const rows = html.split("<tbody>")[1].split("</tbody>")[0].match(/<tr[^>]*>/g);
    expect(rows).toHaveLength(2);
    expect(html.split("<tbody>")[1].match(/<td/g)).toHaveLength(4);
  });
  it("Tabelle ohne Trennzeile hat keinen thead", () => {
    const html = render("# T\n\n## A\n\n| a | b |\n| c | d |");
    expect(html).not.toContain("<thead>");
    expect(html.match(/<td/g)).toHaveLength(4);
  });
});

describe("DocView: Bilder & Quellen-Fußnoten", () => {
  it("Bildzeile mit |w-Suffix: Breite gesetzt, Titel nur als alt/title-Attribut ohne Suffix", () => {
    const html = render("# T\n\n## A\n\n![Mein Titel|w320](img:ab12)", { ab12: "data:image/png;base64,x" });
    expect(html).toContain('width:320px');
    expect(html).toContain('alt="Mein Titel"');
    expect(html).toContain('title="Mein Titel"');
    expect(html).not.toContain("|w320");
  });
  it("Bild-Titel erscheint NICHT als sichtbare (fette) Bildunterschrift; kursive Folgezeile bleibt sichtbar", () => {
    // Konvention: Titel im Alt-Text, direkt darunter eine eigene kursive Zeile.
    const html = render(
      "# T\n\n## A\n\n![Mein Titel](img:ab12)\n\n*Eine Bildunterschrift*",
      { ab12: "data:image/png;base64,x" }
    );
    expect(html).not.toContain("<figcaption");
    // Der Titel steckt nur im alt/title-Attribut, nicht als eigener Textknoten
    expect(html).not.toMatch(/>Mein Titel</);
    expect(html).toContain('alt="Mein Titel"');
    expect(html).toMatch(/<em>Eine Bildunterschrift<\/em>/);
  });
  it("fehlendes Bild zeigt Platzhalter statt kaputtem img", () => {
    const html = render("# T\n\n## A\n\n![Titel](img:fehlt)");
    expect(html).toContain("Bild wird geladen");
    expect(html).not.toContain("<img");
  });
  it("Fußnoten-Link [n](https://…) wird zur hochgestellten Zahl", () => {
    const html = render("# T\n\n## A\n\n- Fakt[2](https://a.de/x) dazu");
    expect(html).toMatch(/<sup[^>]*><a[^>]*href="https:\/\/a\.de\/x"/);
    expect(html).toContain("[2]");
  });
  it("normale eckige Klammern bleiben Text", () => {
    const html = render("# T\n\n## A\n\n- Array[0] und [kein Link](nix)");
    expect(html).toContain("Array[0]");
    expect(html).toContain("[kein Link](nix)");
  });
});

describe("exportierte Regexe", () => {
  it("TASK_RE erkennt offene/erledigte Aufgaben inkl. Einrückung", () => {
    expect(TASK_RE.test("- [ ] offen")).toBe(true);
    expect(TASK_RE.test("  - [x] fertig")).toBe(true);
    expect(TASK_RE.test("- [y] kaputt")).toBe(false);
  });
  it("IMG_LINE_RE matcht nur reine Bildzeilen mit img:-Referenz", () => {
    expect(IMG_LINE_RE.test("![t](img:abc123)")).toBe(true);
    expect(IMG_LINE_RE.test("![t](https://x.de/a.png)")).toBe(false);
    expect(IMG_LINE_RE.test("Text ![t](img:abc) Text")).toBe(false);
  });
});

describe("DocView: LaTeX-Formeln (KaTeX)", () => {
  it("Inline-Formel $…$ in einem Stichpunkt wird gerendert, kein rohes $ bleibt stehen", () => {
    const html = render("# T\n\n## A\n\n- Es gilt $a^2+b^2=c^2$ laut Pythagoras.");
    expect(html).toContain("application/x-tex");
    expect(html).toContain("katex");
    expect(html).not.toContain("$a^2");
  });

  it("Display-Block $$…$$ auf eigener Zeile wird als eigener Block gerendert (nicht in <p>)", () => {
    const html = render("# T\n\n## A\n\n$$E=mc^2$$");
    expect(html).toContain("katex-display");
    expect(html).not.toMatch(/<p[^>]*><span[^>]*katex-display/);
  });

  it("einzeiliges $$…$$ funktioniert genauso wie mehrzeilig", () => {
    const single = render("# T\n\n## A\n\n$$a^2 + b^2 = c^2$$");
    const multi = render("# T\n\n## A\n\n$$\na^2 + b^2 = c^2\n$$");
    expect(single).toContain("katex-display");
    expect(multi).toContain("katex-display");
    expect(single).toContain("a^2 + b^2 = c^2");
    expect(multi).toContain("a^2 + b^2 = c^2");
  });

  it("Display-Block über mehrere Zeilen sammelt bis zur schließenden $$-Zeile", () => {
    const html = render("# T\n\n## A\n\nVorher\n\n$$\n\\frac{1}{2}\n+ \\Delta\n$$\n\nNachher");
    expect(html).toContain("Vorher");
    expect(html).toContain("Nachher");
    expect(html).toContain("katex-display");
    expect(html).toContain("frac{1}{2}");
  });

  it('"$$x$$ mehr Text" auf einer Zeile verschluckt NICHT den Rest des Abschnitts (Review-Finding 4)', () => {
    const html = render("# T\n\n## A\n\n$$x^2$$ mehr Text\n\nDanach ein eigener Absatz.");
    expect(html).toContain("katex-display"); // $$x^2$$ trotzdem als Formel erkannt (eingebettet)
    expect(html).toContain("mehr Text");
    expect(html).toContain("Danach ein eigener Absatz.");
  });

  it("eine unterminierte $$-Zeile (kein Ende im Dokument) verschluckt NICHT den restlichen Abschnitt (Review-Finding 4)", () => {
    const html = render("# T\n\n## A\n\n$$\nkeine schließende Zeile\n\n- Stichpunkt Eins\n- Stichpunkt Zwei");
    // Kein Absturz, kein Formel-Rendering (mangels Ende), aber die
    // nachfolgenden Stichpunkte müssen als normale Liste erscheinen statt
    // als TeX in einem KaTeX-Block zu verschwinden.
    expect(html).toContain("Stichpunkt Eins");
    expect(html).toContain("Stichpunkt Zwei");
    expect(html).toMatch(/<ul[^>]*>/);
  });

  it("Formeln stehen nicht im Weg von fett/kursiv – beides funktioniert im selben Satz", () => {
    const html = render("# T\n\n## A\n\n- **Wichtig**: $x_i$ ist der *i-te* Wert.");
    expect(html).toMatch(/<strong[^>]*>Wichtig<\/strong>/);
    expect(html).toMatch(/<em>i-te<\/em>/);
    expect(html).toContain("application/x-tex");
  });

  it("Formeln in einer Tabellenzelle werden gerendert", () => {
    const html = render("# T\n\n## A\n\n| Formel | Wert |\n|---|---|\n| $x^2$ | 4 |");
    expect(html).toContain("<table");
    expect(html).toContain("application/x-tex");
  });

  it("Formeln in einer Checkliste/Aufgabe werden gerendert, Checkbox bleibt funktionsfähig", () => {
    const html = render("# T\n\n## A\n\n- [ ] Beweise $E=mc^2$");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("application/x-tex");
  });

  it("Formeln funktionieren zusammen mit Schriftfarbe/Textmarker (Farb-Spans bleiben unangetastet)", () => {
    const html = render(
      '# T\n\n## A\n\n- <span style="color:#dc2626">Wichtig: $x^2$</span>'
    );
    expect(html).toContain("color:#dc2626");
    expect(html).toContain("application/x-tex");
  });

  it("Codespans schützen ihren Inhalt vor Formel-Erkennung (kein Rendering innerhalb `…`)", () => {
    const html = render("# T\n\n## A\n\n- Schreibe `$x$` um eine Inline-Formel zu erzeugen.");
    expect(html).not.toContain("application/x-tex");
    expect(html).toMatch(/<code[^>]*>\$x\$<\/code>/);
  });

  it('Codespan-Zeile, die mit "$$" beginnt, bleibt Codespan (kein Display-Block)', () => {
    const html = render("# T\n\n## A\n\n`$$x$$` ist eine Formel-Notation.");
    expect(html).not.toContain("katex-display");
    expect(html).toMatch(/<code[^>]*>\$\$x\$\$<\/code>/);
  });

  it("Währungsbeträge bleiben unangetastet (keine Formel-Fehlinterpretation)", () => {
    const html = render("# T\n\n## A\n\n- Das kostet $50, nicht $100.\n- Spanne von 50 $ bis 60 $.");
    expect(html).not.toContain("application/x-tex");
    expect(html).toContain("$50");
    expect(html).toContain("$100");
  });

  it("\\$-Escape bleibt literales Dollarzeichen im Dokument", () => {
    const html = render("# T\n\n## A\n\n- Preis exakt \\$5.");
    expect(html).toContain("$5");
    expect(html).not.toContain("application/x-tex");
  });

  it("ungültiges TeX lässt die Ansicht nicht abstürzen", () => {
    expect(() => render("# T\n\n## A\n\n$$\\notacommand{$$")).not.toThrow();
  });

  it("Bild-Referenzen (img:) bleiben unbeeinflusst, wenn im selben Dokument Formeln vorkommen", () => {
    const html = render(
      "# T\n\n## A\n\n$$x^2$$\n\n![Titel](img:ab12)",
      { ab12: "data:image/png;base64,x" }
    );
    expect(html).toContain("katex-display");
    expect(html).toContain('alt="Titel"');
  });
});

describe("renumberCitations & CITE_LINK_RE: fassen TeX-Inhalte nicht an", () => {
  it("Formel mit eckigen Klammern/Backslashes bleibt beim Umnummerieren unverändert", () => {
    const md = "- $\\left[1,2\\right]$ Intervall, Quelle[3](https://a.de) und nochmal Quelle[9](https://a.de)";
    const out = renumberCitations(md);
    expect(out).toContain("$\\left[1,2\\right]$");
    expect(out).toContain("Quelle[1](https://a.de)");
    expect(out.match(/\(https:\/\/a\.de\)/g)).toHaveLength(2);
  });

  it("eine Formel direkt vor einer echten Fußnote wird nicht mit ihr verwechselt", () => {
    const md = "Satz $E=mc^2$[1](https://phys.example/e)";
    const out = renumberCitations(md);
    expect(out).toBe("Satz $E=mc^2$[1](https://phys.example/e)");
  });
});
