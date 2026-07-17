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
  it("lässt generische Links (nicht-numerischer Titel) unangetastet (v7.8)", () => {
    const md = "- Info [Titel](https://a.de) und [2024-Bericht](https://b.de) sowie f[3](https://c.de)";
    expect(renumberCitations(md)).toBe(
      "- Info [Titel](https://a.de) und [2024-Bericht](https://b.de) sowie f[1](https://c.de)"
    );
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

describe("DocView: generische Links (v7.8)", () => {
  it("[Titel](url) wird zu einem klickbaren Link mit href/target/rel/title, kein <sup>", () => {
    const html = render(
      "# T\n\n## A\n\n- Siehe [Azure-Ticket](https://dev.azure.com/reasult/Reasult/_workitems/edit/33487) dazu."
    );
    expect(html).toMatch(
      /<a[^>]*href="https:\/\/dev\.azure\.com\/reasult\/Reasult\/_workitems\/edit\/33487"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*title="https:\/\/dev\.azure\.com\/reasult\/Reasult\/_workitems\/edit\/33487"[^>]*>Azure-Ticket<\/a>/
    );
    expect(html).not.toContain("<sup");
  });

  it("Fußnote [2](url) bleibt <sup>, generischer Link daneben wird normaler Link – beides in EINER Zeile", () => {
    const html = render("# T\n\n## A\n\n- Fakt[2](https://a.de/x) siehe auch [Quelle](https://b.de/y).");
    expect(html).toMatch(/<sup[^>]*><a[^>]*href="https:\/\/a\.de\/x"[^>]*>\[2\]<\/a><\/sup>/);
    expect(html).toMatch(/<a[^>]*href="https:\/\/b\.de\/y"[^>]*>Quelle<\/a>/);
  });

  it('javascript:- und data:-"Links" bleiben Klartext (kein <a>, nur http(s) erlaubt)', () => {
    const html = render(
      "# T\n\n## A\n\n- [Klick mich](javascript:alert(1))\n- [Bild anzeigen](data:text/html,x)"
    );
    expect(html).not.toContain("<a ");
    expect(html).toContain("[Klick mich](javascript:alert(1))");
    expect(html).toContain("[Bild anzeigen](data:text/html,x)");
  });

  it("Autolink <https://…> wird zum Link, Anzeigetext = URL", () => {
    const html = render("# T\n\n## A\n\n- Siehe <https://example.org/x> hier.");
    expect(html).toMatch(/<a[^>]*href="https:\/\/example\.org\/x"[^>]*>https:\/\/example\.org\/x<\/a>/);
    expect(html).not.toContain("&lt;https");
  });

  it("nackte URL mit abschließendem Satzzeichen: Punkt wird nicht mitverlinkt", () => {
    const html = render("# T\n\n## A\n\n- Siehe https://x.de/a. Danach.");
    expect(html).toMatch(/<a[^>]*href="https:\/\/x\.de\/a"[^>]*>https:\/\/x\.de\/a<\/a>/);
    expect(html).not.toContain('href="https://x.de/a."');
    expect(html).toMatch(/<\/a>\.\s*Danach/);
  });

  it("nackte URL mit runden Klammern (Wikipedia) bleibt komplett verlinkt", () => {
    const html = render("# T\n\n## A\n\n- Siehe https://de.wikipedia.org/wiki/Steak_(Fleisch) dazu.");
    expect(html).toMatch(/<a[^>]*href="https:\/\/de\.wikipedia\.org\/wiki\/Steak_\(Fleisch\)"[^>]*>/);
  });

  it("nackte URL in Klammern im Fließtext: die Satzklammer wird NICHT mitverlinkt", () => {
    const html = render("# T\n\n## A\n\n- Quelle (https://x.de/a) im Satz.");
    expect(html).toMatch(/<a[^>]*href="https:\/\/x\.de\/a"[^>]*>https:\/\/x\.de\/a<\/a>\)/);
  });

  it("nackte URL am Zeilenende wird komplett verlinkt", () => {
    const html = render("# T\n\n## A\n\n- Quelle: https://x.de/pfad");
    expect(html).toMatch(/<a[^>]*href="https:\/\/x\.de\/pfad"[^>]*>https:\/\/x\.de\/pfad<\/a>/);
  });

  it("Link in Tabellenzelle und Listen-Item funktioniert", () => {
    const html = render(
      "# T\n\n## A\n\n| A | B |\n| --- | --- |\n| [Titel](https://x.de/a) | y |\n\n- [Punkt](https://x.de/b)"
    );
    expect(html).toMatch(/<td[^>]*><a[^>]*href="https:\/\/x\.de\/a"[^>]*>Titel<\/a><\/td>/);
    expect(html).toMatch(/<li[^>]*><a[^>]*href="https:\/\/x\.de\/b"[^>]*>Punkt<\/a><\/li>/);
  });

  it("Link-Titel mit **fett** wird rekursiv gerendert", () => {
    const html = render("# T\n\n## A\n\n- [Sehr **wichtig**](https://x.de/a)");
    expect(html).toMatch(/<a[^>]*href="https:\/\/x\.de\/a"[^>]*>Sehr <strong[^>]*>wichtig<\/strong><\/a>/);
  });

  it("nackte URL innerhalb eines Codespans bleibt Code, kein Link", () => {
    const html = render("# T\n\n## A\n\n- Beispiel: `https://x.de/a` im Text.");
    expect(html).not.toContain("<a ");
    expect(html).toMatch(/<code[^>]*>https:\/\/x\.de\/a<\/code>/);
  });

  // Nachbesserung Finding 1 (Re-Review 2026-07-17, DocEditor.jsx
  // normalizeLinkUrl): eine vom Editor prozent-kodierte URL (Leerzeichen,
  // verschachtelte Klammern, Anführungszeichen, spitze Klammern) muss der
  // Viewer als VOLLSTÄNDIGEN Link erkennen – schließt den Kreis zum
  // Editor-Roundtrip-Test in tests/docEditorLinks.test.jsx.
  it("eine vom Editor prozent-kodierte URL (Leerzeichen/Klammern/Anführungszeichen/spitze Klammern) wird vollständig erkannt", () => {
    const html = render("# T\n\n## A\n\n[Titel](https://x.de/a%20b%28c%22d%3Ee)");
    expect(html).toMatch(/<a[^>]*href="https:\/\/x\.de\/a%20b%28c%22d%3Ee"[^>]*>Titel<\/a>/);
  });

  // Nachbesserung Finding 3 (Re-Review 2026-07-17): Titellänge in
  // INLINE_TOKEN_RE auf 300 Zeichen gecappt (Backtracking-Schutz, siehe
  // Kommentar dort). Dokumentierte Grenze: 300 Zeichen funktionieren noch
  // als vollständiger [Titel](url)-Link, 301 Zeichen matcht die Klammer-Form
  // nicht mehr und der Titeltext bleibt Klartext stehen (die eingebettete
  // bare-URL wird trotzdem separat als eigener Link erkannt – dieselbe
  // Fallback-Grammatik wie bei jedem anderen nicht matchenden "[…](url)",
  // z. B. bei verschachtelten Klammern).
  it("Titel mit genau 300 Zeichen wird noch als vollständiger Link erkannt, 301 Zeichen nicht mehr (Backtracking-Cap)", () => {
    const t300 = "x".repeat(300);
    const t301 = "x".repeat(301);
    const html300 = render("# T\n\n## A\n\n[" + t300 + "](https://x.de/a)");
    const html301 = render("# T\n\n## A\n\n[" + t301 + "](https://x.de/a)");
    expect(html300).toContain('<a href="https://x.de/a"');
    expect(html300).toContain(">" + t300 + "</a>");
    expect(html301).toContain("[" + t301 + "](");
    expect(html301).not.toContain(">" + t301 + "</a>");
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

describe("DocView: monospaced Codeblöcke (```-Fences, v7.7)", () => {
  it("rendert einen Codeblock monospaced, ohne sichtbare Zäune", () => {
    const html = render("# T\n\n## A\n\n```js\nconst x = 1;\n```");
    expect(html).toContain("const x = 1;");
    expect(html).not.toContain("```");
    expect(html).toMatch(/<pre[^>]*>/);
    expect(html).toContain("font-mono");
    expect(html).toContain("overflow-x-auto");
  });

  it("zeigt das Sprach-Label an (gespeichert, aber nicht gehighlightet)", () => {
    const html = render("# T\n\n## A\n\n```bash\necho hi\n```");
    expect(html).toContain("bash");
  });

  it("im Codeblock läuft KEINE Inline-/Math-/Bild-Verarbeitung – Inhalt bleibt byte-genau", () => {
    const html = render(
      "# T\n\n## A\n\n```text\n**nicht fett** $x^2$ [1](https://a.de) ![t](img:ab12)\n```"
    );
    expect(html).toContain("**nicht fett**");
    expect(html).toContain("$x^2$");
    expect(html).toContain("[1](https://a.de)");
    expect(html).toContain("![t](img:ab12)");
    expect(html).not.toContain("application/x-tex");
    expect(html).not.toMatch(/<strong/);
    expect(html).not.toContain("<sup");
  });

  it("Checklisten NACH einem Codeblock bleiben funktionsfähig (Original-Zeilenindex bleibt korrekt)", () => {
    const html = render(
      "# T\n\n## A\n\n```js\nx\n```\n\n- [ ] offen\n- [x] fertig"
    );
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).toContain("offen");
    expect(html).toContain("fertig");
  });

  it("ein mehrzeiliger Codeblock mit Leerzeilen im Inhalt bleibt vollständig erhalten", () => {
    const html = render("# T\n\n## A\n\n```py\ndef f():\n    return 1\n\n\ndef g():\n    return 2\n```");
    expect(html).toContain("def f():");
    expect(html).toContain("def g():");
  });

  it("ein unterminierter Zaun (kein schließendes ```) verschluckt NICHT den Rest des Abschnitts", () => {
    const html = render(
      "# T\n\n## A\n\n```js\nkeine schließende Zeile\n\n- Stichpunkt Eins\n- Stichpunkt Zwei"
    );
    expect(html).toContain("Stichpunkt Eins");
    expect(html).toContain("Stichpunkt Zwei");
    expect(html).toMatch(/<ul[^>]*>/);
  });

  it("mehrere Codeblöcke im selben Abschnitt werden unabhängig gerendert", () => {
    const html = render("# T\n\n## A\n\n```js\nfirst();\n```\n\nText dazwischen.\n\n```css\n.a{}\n```");
    expect(html).toContain("first();");
    expect(html).toContain(".a{}");
    expect(html).toContain("Text dazwischen.");
    expect((html.match(/<pre/g) || []).length).toBe(2);
  });

  it("ein Codeblock innerhalb eines ###-Unterthemas wird korrekt gerendert", () => {
    const html = render("# T\n\n## A\n\n### Sub\n\n```js\nx();\n```");
    expect(html).toContain("Sub");
    expect(html).toContain("x();");
  });

  it("ungültiges/leeres TeX-artiges Zeichen im Code lässt die Ansicht nicht abstürzen", () => {
    expect(() => render("# T\n\n## A\n\n```\n$$$$$$\n```")).not.toThrow();
  });

  it("ein 4-Backtick-Zaun um Inhalt mit eigenen 3-Backtick-Zeilen wird als EIN Block gerendert (K1-Szenario)", () => {
    const html = render("# T\n\n## A\n\n````js\nBeispiel:\n```\ninner\n```\n````");
    expect(html).toContain("Beispiel:");
    expect(html).toContain("inner");
    expect((html.match(/<pre/g) || []).length).toBe(1);
    expect(html).not.toContain("````");
  });

  it("ein Sprach-Label mit Leerzeichen zeigt nur das erste Wort an (Re-Review-Fix W1/P2)", () => {
    const html = render("# T\n\n## A\n\n```python title=x\ncode\n```");
    expect(html).toContain("python");
    expect(html).not.toContain("title=x");
  });

  it("ein 4-Leerzeichen- oder Tab-eingerückter ```-Block wird NICHT als Codeblock gerendert (Re-Review-Fix W2)", () => {
    const html4 = render("# T\n\n## A\n\n    ```js\n    x\n    ```");
    const htmlTab = render("# T\n\n## A\n\n\t```js\n\tx\n\t```");
    expect(html4).not.toMatch(/<pre/);
    expect(htmlTab).not.toMatch(/<pre/);
  });
});

describe("renumberCitations: Fenced-Codeblöcke bleiben unangetastet (v7.7)", () => {
  it("ein Fußnoten-artiger Link INNERHALB eines Codeblocks wird NICHT umnummeriert", () => {
    const md = "Text[9](https://a.de)\n\n```md\nBeispiel: [1](https://x.de)\n```";
    const out = renumberCitations(md);
    expect(out).toContain("Text[1](https://a.de)");
    expect(out).toContain("[1](https://x.de)"); // unverändert (war schon [1], bleibt [1])
    expect(out).toContain("```md\nBeispiel: [1](https://x.de)\n```");
  });

  it("eine URL, die vor UND nach einem Codeblock zitiert wird, bekommt beide Male dieselbe Nummer", () => {
    const md = "Erst[5](https://a.de)\n\n```js\nx\n```\n\nNochmal[9](https://a.de)";
    const out = renumberCitations(md);
    expect(out).toContain("Erst[1](https://a.de)");
    expect(out).toContain("Nochmal[1](https://a.de)");
  });

  it("ein Codeblock mit einer Zahl, die wie ein umzunummerierender Link aussieht, bleibt byte-identisch", () => {
    const md = "```text\n[42](https://sollte-nicht-umnummeriert-werden.example)\n```";
    expect(renumberCitations(md)).toBe(md);
  });

  it("ein unterminierter Zaun wird weiterhin normal umnummeriert (kein echter Codeblock)", () => {
    const md = "```js\nText[7](https://a.de) ohne schließenden Zaun";
    const out = renumberCitations(md);
    expect(out).toContain("[1](https://a.de)");
  });

  it("bleibt idempotent, auch mit Codeblöcken im Dokument", () => {
    const md = "a[3](https://a.de)\n\n```js\n[1](https://b.de)\n```\n\nb[3](https://a.de)";
    const once = renumberCitations(md);
    expect(renumberCitations(once)).toBe(once);
  });
});
