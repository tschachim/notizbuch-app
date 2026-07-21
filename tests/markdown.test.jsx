import { describe, it, expect, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DocView, parseTree, renumberCitations, TASK_RE, IMG_LINE_RE } from "../src/lib/markdown.jsx";
import { setLinkProviders } from "../src/lib/linkProviders.jsx";

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
  // v7.28-Fix (Nutzer-Befund, Live): ein "###" ohne vorausgehendes "##"
  // fabrizierte hier früher einen Abschnitt "Allgemein", der im Markdown
  // selbst NICHT existierte (Anzeige != Datei, Chat-Ops konnten "Allgemein"
  // nicht adressieren). Jetzt: title:null statt eines erfundenen Namens –
  // umbenannter Test (bewusst umgeschrieben, siehe Kommentar unten bei
  // "Phantom-Abschnitt entfernt").
  it("Inhalt vor dem ersten ## landet im Vorspann, ### ohne ## erzeugt eine TITELLOSE Sektion (v7.28)", () => {
    const { pre, sections } = parseTree("# T\n\nfrei\n\n### Nur Sub\n\n- x");
    expect(pre.some((l) => l.text === "frei")).toBe(true);
    expect(sections[0].title).toBeNull();
    expect(sections[0].subs[0].title).toBe("Nur Sub");
  });

  describe("Phantom-Abschnitt 'Allgemein' entfernt (v7.28-Fix, Nutzer-Befund)", () => {
    it("verwaistes ### direkt am Dokumentanfang (nach der Titelzeile, kein Freitext dazwischen)", () => {
      const { sections } = parseTree("# T\n\n### Erstes Unterthema\n\n- x");
      expect(sections).toHaveLength(1);
      expect(sections[0].title).toBeNull();
      expect(sections[0].subs.map((s) => s.title)).toEqual(["Erstes Unterthema"]);
    });

    // Der konkrete Nutzer-Fall als Fixture: "# Test" (Kapitel) → Freitext →
    // "### DCF-Formel" OHNE ein dazwischenliegendes "## "-Hauptthema.
    it("Nutzer-Fixture: # Test (Kapitel) -> Freitext -> ### DCF-Formel ohne ##-Hauptthema", () => {
      const doc = "# Notizbuch\n\n# Test\n\nEinleitender Freitext zum Kapitel.\n\n### DCF-Formel\n\nWACC = ...";
      const { sections, chapters } = parseTree(doc);
      expect(chapters.map((c) => c.title)).toEqual(["Test"]);
      // Der Freitext direkt unter der Kapitelzeile gehört zu chapters[0].lines
      // (v7.15-Fix, unverändert) – NICHT zu einer Sektion.
      expect(chapters[0].lines.some((l) => l.text === "Einleitender Freitext zum Kapitel.")).toBe(true);
      expect(sections).toHaveLength(1);
      expect(sections[0].title).toBeNull();
      expect(sections[0].chapter).toBe(0);
      expect(sections[0].subs.map((s) => s.title)).toEqual(["DCF-Formel"]);
      expect(sections[0].subs[0].lines.some((l) => l.text === "WACC = ...")).toBe(true);
    });

    it("mehrere verwaiste ###-Gruppen in VERSCHIEDENEN Kapiteln bleiben getrennte, jeweils titellose Sektionen", () => {
      const doc =
        "# T\n\n# Kapitel A\n\n### SubA1\n\n### SubA2\n\n# Kapitel B\n\n### SubB1";
      const { sections, chapters } = parseTree(doc);
      expect(chapters.map((c) => c.title)).toEqual(["Kapitel A", "Kapitel B"]);
      // Alle drei ###-Zeilen landen unter EINER titellosen Sektion PRO
      // Kapitel (die erste ### im jeweiligen Kapitel eröffnet "cur", jede
      // weitere ### im selben Kapitel hängt als weiteres Sub darunter,
      // solange kein "##" dazwischenkommt – siehe parseTree).
      expect(sections).toHaveLength(2);
      expect(sections.map((s) => s.title)).toEqual([null, null]);
      expect(sections[0].chapter).toBe(0);
      expect(sections[0].subs.map((s) => s.title)).toEqual(["SubA1", "SubA2"]);
      expect(sections[1].chapter).toBe(1);
      expect(sections[1].subs.map((s) => s.title)).toEqual(["SubB1"]);
    });

    it("Misch-Dokument: echtes ## UND ein verwaistes ### DANACH bekommen unterschiedliche Sektionen (title vs. null)", () => {
      const doc = "# T\n\n## Echt\n\n- Punkt\n\n### Hängt an Echt\n\n- y";
      const { sections } = parseTree(doc);
      // Ein "###" NACH einem offenen "##" hängt (wie schon vor v7.28) unter
      // DIESEM Abschnitt, erzeugt also KEINE eigene Sektion.
      expect(sections).toHaveLength(1);
      expect(sections[0].title).toBe("Echt");
      expect(sections[0].subs.map((s) => s.title)).toEqual(["Hängt an Echt"]);
    });

    it("ein verwaistes ### NACH einem bereits abgeschlossenen ##-Abschnitt (getrennt durch eine neue Kapitelzeile) bekommt seine EIGENE titellose Sektion", () => {
      const doc = "# T\n\n## Echt\n\n- Punkt\n\n# Kapitel Zwei\n\n### Verwaist\n\n- z";
      const { sections, chapters } = parseTree(doc);
      expect(sections.map((s) => s.title)).toEqual(["Echt", null]);
      expect(chapters.map((c) => c.title)).toEqual([null, "Kapitel Zwei"]);
      expect(sections[1].chapter).toBe(1);
      expect(sections[1].subs.map((s) => s.title)).toEqual(["Verwaist"]);
    });

    // Bestandsschutz: ein Dokument mit einem ECHTEN, literalen "## Allgemein"
    // (ein Nutzer kann diesen Abschnittsnamen bewusst selbst vergeben) bleibt
    // ein ganz normaler, BETITELTER Abschnitt – der Fix betrifft ausschließlich
    // den FABRIZIERTEN Fall (kein "##" im Quelltext).
    it("Bestand: ein literales '## Allgemein' im Markdown bleibt ein normaler betitelter Abschnitt", () => {
      const { sections } = parseTree("# T\n\n## Allgemein\n\n- echter Inhalt");
      expect(sections).toHaveLength(1);
      expect(sections[0].title).toBe("Allgemein");
      expect(sections[0].lines.some((l) => l.text === "- echter Inhalt")).toBe(true);
    });
  });
});

// v7.14 (Nutzerwunsch "zweistufige Gliederung"): "# Titel" gruppiert
// mehrere ##-Abschnitte zu einem Kapitel. "sections" bleibt eine flache
// Liste mit globalem Index (jede Section trägt zusätzlich "chapter").
// Helfer: chapters ohne "lines" vergleichen, wenn ein Test nicht den
// Freitext-Inhalt selbst prüft (sonst müssten Tests, die die Kapitelform
// prüfen, jede Leerzeilen-"Dead-Zone" mitpinnen).
const chapShape = (chapters) => chapters.map(({ title, secFrom, secTo }) => ({ title, secFrom, secTo }));

describe("parseTree: Kapitel (# , v7.14)", () => {
  it("ohne echtes #-Kapitel bleibt chapters leer – Alt-Verhalten byte-/verhaltensgleich (die Titelzeile wird NIE zum Kapitel)", () => {
    const { sections, chapters } = parseTree("# T\n\n## A\n\n## B");
    expect(chapters).toEqual([]);
    // "chapter" bleibt bei fehlenden Kapiteln ungenutzt (-1, siehe Kommentar
    // in parseTree) – Konsumenten prüfen immer zuerst chapters.length.
    expect(sections.every((s) => s.chapter === -1)).toBe(true);
  });

  it("gruppiert ##-Abschnitte zu Kapiteln, globale sec-Indizes bleiben erhalten, H2 vor dem ersten H1 landet im impliziten titellosen Kapitel", () => {
    const doc = "# T\n\n## Vorspann\n\n# Kapitel Eins\n\n## Alpha\n\n## Beta\n\n# Kapitel Zwei\n\n## Gamma";
    const { sections, chapters } = parseTree(doc);
    expect(sections.map((s) => s.title)).toEqual(["Vorspann", "Alpha", "Beta", "Gamma"]);
    expect(chapShape(chapters)).toEqual([
      { title: null, secFrom: 0, secTo: 1 },
      { title: "Kapitel Eins", secFrom: 1, secTo: 3 },
      { title: "Kapitel Zwei", secFrom: 3, secTo: 4 },
    ]);
    // Globaler Index (für "sec-"+si-Anker) bleibt fortlaufend über alle
    // Kapitel hinweg, unabhängig von der Kapitel-Zugehörigkeit.
    expect(sections.map((s) => s.chapter)).toEqual([0, 1, 1, 2]);
  });

  it("nur H1 ohne H2: leere Kapitel (secFrom === secTo) sind erlaubt", () => {
    const doc = "# T\n\n## A\n\n# Kapitel Eins\n\n# Kapitel Zwei\n\n## B";
    const { sections, chapters } = parseTree(doc);
    expect(chapShape(chapters)).toEqual([
      { title: null, secFrom: 0, secTo: 1 },
      { title: "Kapitel Eins", secFrom: 1, secTo: 1 },
      { title: "Kapitel Zwei", secFrom: 1, secTo: 2 },
    ]);
    expect(sections.map((s) => s.chapter)).toEqual([0, 2]);
  });

  it("H1 mit ###-Unterthemen in Abschnitten: subs bleiben unter ihrem Abschnitt, unabhängig vom Kapitel", () => {
    const doc = "# T\n\n## A\n\n### SubA\n\n- x\n\n# Kapitel Eins\n\n## B\n\n### SubB\n\n- y";
    const { sections, chapters } = parseTree(doc);
    expect(sections.map((s) => s.title)).toEqual(["A", "B"]);
    expect(sections[0].subs.map((s) => s.title)).toEqual(["SubA"]);
    expect(sections[1].subs.map((s) => s.title)).toEqual(["SubB"]);
    expect(chapters.map((c) => c.title)).toEqual([null, "Kapitel Eins"]);
    expect(sections.map((s) => s.chapter)).toEqual([0, 1]);
  });

  it("### mitten in einer Zeile bzw. #### bleiben unverändert unstrukturell (fence-blinde Grenze bewusst geteilt mit ##)", () => {
    // Kein Zeilenanfang -> keine Struktur, egal welche Ebene.
    const { sections, chapters } = parseTree("# T\n\n## A\n\nText mit # mittendrin\n\n#### Zu tief");
    expect(chapters).toEqual([]);
    expect(sections[0].lines.some((l) => l.text === "Text mit # mittendrin")).toBe(true);
    expect(sections[0].lines.some((l) => l.text === "#### Zu tief")).toBe(true);
  });

  // v7.14-Nachbesserung (Code-Review vor dem Commit, 🔴-Finding): Die
  // anfängliche "sawSection"-Heuristik erkannte eine "# "-Kapitelzeile nur,
  // wenn VORHER schon ein "##" gesehen wurde – stand das erste echte Kapitel
  // VOR dem ersten "##" (der Normalfall direkt nach der Titelzeile), wurde
  // es fälschlich zu Fließtext neben dem Titel. Ersetzt durch eine reine
  // Positions-Regel: NUR die allererste nicht-leere Zeile des Dokuments ist
  // (wenn sie "# " ist) der Titel, JEDE weitere "# "-Zeile ist ein Kapitel –
  // unabhängig davon, ob vor oder nach dem ersten "##". Die folgenden Tests
  // bauen die Fixtures BEWUSST OHNE ein "##" vor der ersten Kapitelzeile
  // (die vorherigen Tests oben hatten alle diese Form und hätten den Bug
  // nicht gefangen).
  describe("Titel-Ausnahme per Position (Nachbesserung, Kapitel VOR dem ersten ##)", () => {
    it("exakt das Review-Regressionsszenario: # Titel / # Kapitel A / ## A1 / # Kapitel B / ## B1", () => {
      const doc = "# Titel\n\n# Kapitel A\n\n## A1\n\n# Kapitel B\n\n## B1";
      const { sections, chapters, pre } = parseTree(doc);
      expect(sections.map((s) => s.title)).toEqual(["A1", "B1"]);
      // Kein implizites Kapitel nötig: Kapitel A beginnt direkt, ohne
      // vorangehende, verwaiste Abschnitte.
      expect(chapShape(chapters)).toEqual([
        { title: "Kapitel A", secFrom: 0, secTo: 1 },
        { title: "Kapitel B", secFrom: 1, secTo: 2 },
      ]);
      expect(sections.map((s) => s.chapter)).toEqual([0, 1]);
      // Die Titelzeile "# Titel" bleibt die einzige "#"-Zeile in "pre".
      expect(pre.some((l) => l.text === "# Titel")).toBe(true);
      expect(pre.some((l) => l.text === "# Kapitel A")).toBe(false);
      expect(pre.some((l) => l.text === "# Kapitel B")).toBe(false);
    });

    it("nur EIN Kapitel direkt nach der Titelzeile (kein ## davor) wird erkannt", () => {
      const doc = "# Titel\n\n# Kapitel A\n\n## A1";
      const { sections, chapters } = parseTree(doc);
      expect(chapShape(chapters)).toEqual([{ title: "Kapitel A", secFrom: 0, secTo: 1 }]);
      expect(sections.map((s) => s.title)).toEqual(["A1"]);
      expect(sections[0].chapter).toBe(0);
    });

    it("ein Dokument OHNE separate Titelzeile behandelt seine erste '# '-Zeile trotzdem als Titel (nicht als Kapitel)", () => {
      // Ungewöhnlicher, aber möglicher Fall: das Dokument beginnt direkt mit
      // einer "#"-Zeile, die zugleich die erste nicht-leere Zeile ist – sie
      // zählt konsistent zur selben Positions-Regel als "Titel" (dokumentierte
      // Vereinfachung, siehe parseTree-Kommentar); "A" davor bekommt ein
      // implizites titelloses Kapitel, "Kapitel Zwei" wird normal erkannt.
      const doc = "# Kapitel Eins\n\n## A\n\n# Kapitel Zwei\n\n## B";
      const { sections, chapters } = parseTree(doc);
      expect(chapShape(chapters)).toEqual([
        { title: null, secFrom: 0, secTo: 1 },
        { title: "Kapitel Zwei", secFrom: 1, secTo: 2 },
      ]);
      expect(sections.map((s) => s.chapter)).toEqual([0, 1]);
    });
  });

  // v7.15-Fix (E2E-Finding 🟡 "Kapitel-Inhalt ohne ##-Unterabschnitt rutscht
  // an den Dokumentanfang"): Kapitel bekommen jetzt eigene "lines" (analog zu
  // sections/subs) für Freitext DIREKT unter der Kapitelzeile, VOR dem
  // ersten "##" dieses Kapitels bzw. ganz ohne jeden "##"-Abschnitt. "pre"
  // bleibt ausschließlich für Inhalt VOR dem allerersten Kapitel/Abschnitt.
  describe("Kapitel-Freitext ohne ##-Abschnitt (v7.15-Fix)", () => {
    it("exaktes Repro: ein Kapitel am Dokumentende mit NUR Freitext (kein ##) bekommt seine Zeilen, NICHT pre", () => {
      const doc = "# Titel\n\n## Inbox\n\n- alter Eintrag\n\n# QA-Test Neu\n\nAbsatztext hier.";
      const { pre, sections, chapters } = parseTree(doc);
      expect(sections.map((s) => s.title)).toEqual(["Inbox"]);
      // Zwei Kapitel: das implizite (enthält "Inbox") + "QA-Test Neu" (0
      // Abschnitte, aber Freitext).
      expect(chapShape(chapters)).toEqual([
        { title: null, secFrom: 0, secTo: 1 },
        { title: "QA-Test Neu", secFrom: 1, secTo: 1 },
      ]);
      expect(chapters[1].lines.some((l) => l.text === "Absatztext hier.")).toBe(true);
      // Der Kern des Bugs: der Freitext darf NICHT in "pre" landen.
      expect(pre.some((l) => l.text === "Absatztext hier.")).toBe(false);
    });

    it("Freitext VOR dem ersten ## eines Kapitels UND Abschnitte danach: Freitext gehört zum Kapitel, nicht zu pre oder zum ersten Abschnitt", () => {
      const doc = "# Titel\n\n# Kapitel A\n\nEinleitungstext.\n\n## A1\n\n- Punkt";
      const { pre, sections, chapters } = parseTree(doc);
      expect(chapShape(chapters)).toEqual([{ title: "Kapitel A", secFrom: 0, secTo: 1 }]);
      expect(chapters[0].lines.some((l) => l.text === "Einleitungstext.")).toBe(true);
      expect(pre.some((l) => l.text === "Einleitungstext.")).toBe(false);
      // Der Einleitungstext gehört NICHT zum Abschnitt A1.
      expect(sections[0].lines.some((l) => l.text === "Einleitungstext.")).toBe(false);
      expect(sections[0].lines.some((l) => l.text === "- Punkt")).toBe(true);
    });

    it("Alt-Verhalten ohne jedes #-Kapitel bleibt unverändert: Freitext vor dem ersten ## bleibt in pre", () => {
      const doc = "# T\n\nFreier Vorspann-Text.\n\n## A\n\n- x";
      const { pre, chapters } = parseTree(doc);
      expect(chapters).toEqual([]);
      expect(pre.some((l) => l.text === "Freier Vorspann-Text.")).toBe(true);
    });
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

// v7.14 (Nutzerwunsch "zweistufige Gliederung"): H1-Kapitel über den
// H2-Abschnitten, im Dokument genauso klappbar wie bisher H2.
describe("DocView: Kapitel (#, v7.14)", () => {
  const CH_DOC =
    "# T\n\n## Vorspann\n\n- VorspannText\n\n" +
    "# Kapitel Eins\n\n## Alpha\n\n- AlphaText\n\n## Beta\n\n- BetaText\n\n" +
    "# Kapitel Zwei\n\n## Gamma\n\n- GammaText";

  it("Alt-Dokument ohne echtes #-Kapitel rendert exakt wie bisher (kein zusätzlicher Kopf, kein h1-Doppel)", () => {
    const html = render("# T\n\n## A\n\n- x\n\n## B\n\n- y");
    expect(html).not.toContain("chap-");
    expect(html).toContain('id="sec-0"');
    expect(html).toContain('id="sec-1"');
    // Die Titelzeile "# T" erscheint genau EINMAL als h1 (aus "pre"), nicht
    // zusätzlich als Kapitel-Kopf.
    expect(html.match(/<h1[^>]*>T<\/h1>/g)).toHaveLength(1);
  });

  it("echte Kapitel bekommen einen eigenen, klappbaren Kopf mit chap-Anker; das implizite Vorspann-Kapitel bleibt flach ohne Kopf", () => {
    const html = render(CH_DOC);
    expect(html).toContain('id="chap-1"');
    expect(html).toContain("Kapitel Eins");
    expect(html).toContain('id="chap-2"');
    expect(html).toContain("Kapitel Zwei");
    // Kein Kopf/Anker fürs implizite Kapitel 0 (Vorspann bleibt flach).
    expect(html).not.toContain('id="chap-0"');
    // Globale sec-Indizes bleiben über alle Kapitel hinweg fortlaufend.
    expect(html).toContain('id="sec-0"');
    expect(html).toContain('id="sec-3"');
    expect(html).toContain("VorspannText");
    expect(html).toContain("AlphaText");
    expect(html).toContain("BetaText");
    expect(html).toContain("GammaText");
  });

  // v7.14-Nachbesserung (Code-Review vor dem Commit, 🔴-Finding): Die
  // Fixture oben ("## Vorspann" VOR "# Kapitel Eins") hätte den Bug der
  // ursprünglichen sawSection-Heuristik NICHT gefangen – dieser Test baut
  // das Kapitel bewusst OHNE ein "##" davor auf (Review-Regressionsszenario).
  it("Kapitel direkt nach der Titelzeile (kein ## davor) wird korrekt gruppiert – kein loses zweites <h1>, kein Kapitel verschluckt", () => {
    const doc = "# Titel\n\n# Kapitel A\n\n## A1\n\n- A1Text\n\n# Kapitel B\n\n## B1\n\n- B1Text";
    const html = render(doc);
    // Genau EIN <h1> im gesamten Dokument (die Titelzeile) – "Kapitel A"
    // erscheint NICHT als loses zweites <h1> (das war der 🔴-Fehler).
    expect(html.match(/<h1[^>]*>/g)).toHaveLength(1);
    expect(html).toContain('id="chap-0"');
    expect(html).toContain("Kapitel A");
    expect(html).toContain('id="chap-1"');
    expect(html).toContain("Kapitel B");
    expect(html).not.toContain('id="chap-2"');
    expect(html).toContain("A1Text");
    expect(html).toContain("B1Text");
  });

  // v7.15-Fix (E2E-Finding 🟡): exakter Live-Repro (Editor: H1-Knopf "QA-Test
  // Neu" ans Ende + Absatztext direkt darunter ohne ##, gespeichert).
  it("Freitext direkt unter einer #-Kapitelzeile (ohne ##) erscheint unter dem chap-Kopf, NICHT vor dem ersten Abschnitt", () => {
    const doc = "# Titel\n\n## Inbox\n\n- alter Eintrag\n\n# QA-Test Neu\n\nAbsatztext hier.";
    const html = render(doc);
    // Genau EIN <h1> (Titelzeile) – der Freitext hängt NICHT lose in "pre".
    expect(html.match(/<h1[^>]*>/g)).toHaveLength(1);
    expect(html).toContain('id="chap-1"');
    expect(html).toContain("QA-Test Neu");
    expect(html).toContain("Absatztext hier.");
    // Reihenfolge: der Freitext steht NACH "alter Eintrag" (Inbox-Abschnitt)
    // im HTML, nicht davor (vorher rutschte er an den Dokumentanfang).
    expect(html.indexOf("alter Eintrag")).toBeLessThan(html.indexOf("Absatztext hier."));
  });

  // v7.15-Re-Review (🟡): Die übliche Leerzeile nach der Kapitelzeile landet
  // ebenfalls in chap.lines – sie darf KEINEN leeren pt-2-Div (Extra-Abstand
  // vor dem ersten Abschnitt) erzeugen. Nur echter Freitext rendert den Div.
  it("Kapitel mit nur der üblichen Leerzeile vor dem ersten ## erzeugt keinen leeren Freitext-Div", () => {
    const html = render("# T\n\n# Kap A\n\n## A1\n\n- A1Text\n\n# Kap B\n\n## B1\n\n- B1Text");
    expect(html).not.toContain('<div class="pt-2"></div>');
    expect(html).toContain("A1Text");
    expect(html).toContain("B1Text");
    // Gegenprobe: echter Freitext unter der Kapitelzeile rendert den Div weiterhin.
    const mitText = render("# T\n\n# Kap A\n\nEinleitung.\n\n## A1\n\n- A1Text");
    expect(mitText).toContain("Einleitung.");
    expect(mitText).not.toContain('<div class="pt-2"></div>');
  });

  it('Klapp-Zustand nutzt den Schlüssel "c:"+Titel, getrennt von den bestehenden "s:"-Schlüsseln', () => {
    const closed = renderToStaticMarkup(
      <DocView text={CH_DOC} collapsed={{ "c:Kapitel Eins": true }} onToggle={() => {}}
        imgMap={{}} onImgClick={() => {}} onToggleTask={() => {}} />
    );
    // Kapitel-Kopf bleibt sichtbar (klickbar zum Wiederaufklappen) …
    expect(closed).toContain("Kapitel Eins");
    // … aber ALLE seine Abschnitte samt ihrer eigenen Köpfe verschwinden.
    expect(closed).not.toContain("AlphaText");
    expect(closed).not.toContain("BetaText");
    expect(closed).not.toContain(">Alpha<");
    expect(closed).not.toContain(">Beta<");
    // Andere Kapitel/das implizite Vorspann-Kapitel bleiben unberührt.
    expect(closed).toContain("VorspannText");
    expect(closed).toContain("GammaText");
    expect(closed).toContain("Kapitel Zwei");
  });

  it("ein leeres Kapitel (noch keine ##-Abschnitte) bekommt trotzdem einen sichtbaren, klappbaren Kopf", () => {
    const html = render("# T\n\n## A\n\n- x\n\n# Leeres Kapitel\n\n# Kapitel Zwei\n\n## B\n\n- y");
    expect(html).toContain("Leeres Kapitel");
    expect(html).toContain('id="chap-1"');
  });

  it("Alt-Klappzustände (\"s:\"-Schlüssel) bleiben unverändert gültig, auch innerhalb eines Kapitels", () => {
    const closed = renderToStaticMarkup(
      <DocView text={CH_DOC} collapsed={{ "s:Alpha": true }} onToggle={() => {}}
        imgMap={{}} onImgClick={() => {}} onToggleTask={() => {}} />
    );
    // Nur der Inhalt von Alpha ist weg, der Kopf "Alpha" bleibt sichtbar
    // (wie ein einzelner eingeklappter ##-Abschnitt schon immer).
    expect(closed).toContain(">Alpha<");
    expect(closed).not.toContain("AlphaText");
    expect(closed).toContain("BetaText");
    expect(closed).toContain("Kapitel Eins");
  });
});

// v7.28-Fix (Nutzer-Befund, Live): ein "###"-Unterthema ohne vorausgehendes
// "##" bekam bisher einen fabrizierten Abschnittskopf "Allgemein", der im
// Markdown selbst nicht existierte. Jetzt: title:null -> KEIN erfundener
// Kopf/Klapp-Button, die Unterthemen erscheinen direkt, jedes mit eigenem,
// klappbarem H3-Kopf.
describe("DocView: Phantom-Abschnitt 'Allgemein' entfernt (v7.28)", () => {
  // Exakt der Nutzer-Befund: "# Test" (Kapitel) -> Freitext -> "### DCF-Formel"
  // OHNE ein dazwischenliegendes "## "-Hauptthema.
  const USER_DOC =
    "# Notizbuch\n\n# Test\n\nEinleitender Freitext zum Kapitel.\n\n### DCF-Formel\n\nWACC = ...";

  it("kein 'Allgemein'-Text im Output, der ###-Kopf ist klappbar, der sec-Anker existiert", () => {
    const html = render(USER_DOC);
    expect(html).not.toContain("Allgemein");
    expect(html).toContain("DCF-Formel");
    expect(html).toContain("WACC = ...");
    // Die titellose Sektion behält ihren globalen Anker (Scroll-Spy/
    // gotoSection adressieren weiterhin über den Index).
    expect(html).toContain('id="sec-0"');
    // Das Kapitel "Test" bekommt ganz normal seinen eigenen Kopf (echter
    // Titel, davon ist der Fix nicht betroffen).
    expect(html).toContain('id="chap-0"');
    expect(html).toContain("Test");
    expect(html).toContain("Einleitender Freitext zum Kapitel.");
  });

  it("der ###-Kopf der titellosen Sektion bleibt einzeln klappbar (Klapp-Key \"s:/\"+Sub-Titel)", () => {
    const closed = renderToStaticMarkup(
      <DocView text={USER_DOC} collapsed={{ "s:/DCF-Formel": true }} onToggle={() => {}}
        imgMap={{}} onImgClick={() => {}} onToggleTask={() => {}} />
    );
    // Der H3-Kopf selbst bleibt sichtbar (klickbar zum Wiederaufklappen) …
    expect(closed).toContain("DCF-Formel");
    // … aber sein Inhalt verschwindet.
    expect(closed).not.toContain("WACC = ...");
  });

  it("Alt-Klappzustand mit dem frueheren \"s:Allgemein/…\"-Schlüssel verliert seine Wirkung (selbstheilend)", () => {
    // Ein state.json aus VOR v7.28 kann noch diesen Schlüssel enthalten –
    // da die Sektion nicht mehr "Allgemein" heißt (title:null), greift er
    // nicht mehr: der Inhalt bleibt sichtbar, bis der Nutzer neu klappt.
    const html = renderToStaticMarkup(
      <DocView text={USER_DOC} collapsed={{ "s:Allgemein/DCF-Formel": true }} onToggle={() => {}}
        imgMap={{}} onImgClick={() => {}} onToggleTask={() => {}} />
    );
    expect(html).toContain("WACC = ...");
  });

  it("mehrere verwaiste ###-Unterthemen ohne führendes ## erscheinen jeweils als eigener, unabhängig klappbarer Block", () => {
    const doc = "# T\n\n### Erstes\n\n- einsInhalt\n\n### Zweites\n\n- zweiInhalt";
    const html = render(doc);
    expect(html).not.toContain("Allgemein");
    expect(html).toContain("Erstes");
    expect(html).toContain("Zweites");
    expect(html).toContain("einsInhalt");
    expect(html).toContain("zweiInhalt");
    // Nur "Zweites" eingeklappt: "Erstes" bleibt komplett unberührt.
    const partial = renderToStaticMarkup(
      <DocView text={doc} collapsed={{ "s:/Zweites": true }} onToggle={() => {}}
        imgMap={{}} onImgClick={() => {}} onToggleTask={() => {}} />
    );
    expect(partial).toContain("einsInhalt");
    expect(partial).toContain("Zweites");
    expect(partial).not.toContain("zweiInhalt");
  });

  it("Bestand: ein literales '## Allgemein' bleibt ein ganz normaler, betitelter (und klappbarer) Abschnitt", () => {
    const html = render("# T\n\n## Allgemein\n\n- echter Inhalt");
    expect(html).toContain("Allgemein");
    expect(html).toContain("echter Inhalt");
    const closed = renderToStaticMarkup(
      <DocView text={"# T\n\n## Allgemein\n\n- echter Inhalt"} collapsed={{ "s:Allgemein": true }} onToggle={() => {}}
        imgMap={{}} onImgClick={() => {}} onToggleTask={() => {}} />
    );
    expect(closed).toContain("Allgemein");
    expect(closed).not.toContain("echter Inhalt");
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

// v7.24 Bugfix (Nutzer-Befund): Der WYSIWYG-Editor (tiptap-markdown,
// html:true – siehe DocEditor.jsx) escaped GETIPPTES "<"/">" beim
// Speichern zu "&lt;"/"&gt;" (Schutz gegen versehentliches HTML-Parsing
// beim nächsten Laden). Der Viewer gab diese Zeichenfolgen bisher 1:1 als
// Text aus – React escaped den (bereits als Entity vorliegenden) Text beim
// Rendern ein zweites Mal, sichtbar wurde buchstäblich "&lt;" statt "<".
// Die Fixtures unten sind bewusst EXAKT die vom echten tiptap-markdown-
// Serializer erzeugten Zeichenfolgen (empirisch verifiziert per Headless-
// Editor-Probe, siehe tests/docEditorEntities.test.jsx – dort läuft der
// komplette Zyklus tippen→speichern→DocView UND belegt, dass genau diese
// Strings entstehen). "&" wird vom Editor NIE escaped (weder escapeHTML
// noch prosemirror-markdowns esc() fassen "&" an) – deshalb bleibt ein
// bloßes "&" hier unverändert Text, kein "&amp;" im gespeicherten Markdown.
describe("DocView: Editor-Entities (v7.24 Bugfix, &lt;/&gt; aus getipptem </>))", () => {
  it('zeigt getipptes "<" wieder als "<" (einfaches HTML-Escape, KEIN Doppel-Escape "&amp;lt;")', () => {
    const html = render("# T\n\n## A\n\na &lt; b");
    expect(html).toContain("a &lt; b"); // korrekt: einfach codiertes "<"-Zeichen
    expect(html).not.toContain("&amp;lt;"); // der eigentliche Bug: Doppel-Escape
  });

  it('zeigt getipptes ">" wieder als ">", "&" bleibt unangetastet ("Tom & Jerry")', () => {
    const html = render("# T\n\n## A\n\na &gt; b und Tom & Jerry");
    expect(html).toContain("a &gt; b und Tom &amp; Jerry"); // "&" einfach codiert (echtes Zeichen)
    expect(html).not.toContain("&amp;gt;");
  });

  it("funktioniert in Listen, Checklisten und Tabellenzellen (alle über Inline/renderInline)", () => {
    const html = render(
      "# T\n\n## A\n\n- Punkt: a &lt; b\n- [ ] c &gt; d\n\n| X |\n| - |\n| e &lt; f |"
    );
    expect(html).toContain("a &lt; b");
    expect(html).toContain("c &gt; d");
    expect(html).toContain("e &lt; f");
  });

  it("H1/H2/H3-Überschriften (Notizbuchtitel, Abschnitt, Kapitel, Unterthema) dekodieren ebenfalls", () => {
    const html = render(
      "# Titel &lt;X&gt;\n\n# Kapitel &lt;C&gt;\n\n## Abschnitt &gt; hier\n\n### Unter &lt; Thema\n\n- x"
    );
    // Die dekodierten Zeichen "<"/">" landen als ECHTE Zeichen im JSX-
    // Textknoten – renderToStaticMarkup (React) escaped Textinhalte beim
    // Serialisieren zu HTML immer einfach (gültiges HTML kennt kein rohes
    // "<" in Textknoten), das ist also die KORREKTE Anzeige, kein Bug.
    expect(html).toContain("Titel &lt;X&gt;");
    expect(html).toContain("Kapitel &lt;C&gt;");
    expect(html).toContain("Abschnitt &gt; hier");
    expect(html).toContain("Unter &lt; Thema");
  });

  it('literal getipptes "&amp;" (5 Zeichen, kein echter Entity-Ursprung im Editor) bleibt UNVERÄNDERT sichtbar – kein stilles Umdeuten zu "&"', () => {
    // Bewusste Design-Entscheidung (siehe Kommentar bei decodeBasicEntities,
    // markdown.jsx): "&amp;" steht NIE für ein escaptes "&" (der Editor
    // escaped "&" nie), sondern ist entweder wörtlicher Nutzertext oder
    // fremder Import – wird deshalb NICHT dekodiert.
    const html = render("# T\n\n## A\n\nBitte &amp; nicht anfassen");
    expect(html).toContain("&amp;amp; nicht anfassen");
  });

  it('ein wörtlich getippter (escapeter) "<span>"-Text wird NICHT zur echten Formatierung – bleibt sichtbarer Text', () => {
    // Ein Nutzer, der über HTML schreibt ("Ich habe ein <span> benutzt"),
    // bekommt sein getipptes "<"/">" vom Editor zu "&lt;span&gt;" escaped.
    // Der Tokenizer (INLINE_TOKEN_RE) läuft VOR der Dekodierung – "&lt;span&gt;"
    // matcht die Tag-Alternative nie (die verlangt ein ECHTES "<"), wird also
    // nie fälschlich in ein echtes <span>-Element verwandelt.
    const html = render("# T\n\n## A\n\nText mit &lt;span&gt;kaputt&lt;/span&gt; drin");
    expect(html).toContain("&lt;span&gt;kaputt&lt;/span&gt;");
    expect(html).not.toMatch(/<span>kaputt<\/span>/);
  });

  it("eine ECHTE (unescapte) <span>-Farbmarkierung neben escaptem Text funktioniert weiterhin (Regression)", () => {
    const html = render(
      '# T\n\n## A\n\n<span style="color:#dc2626">rot</span> und &lt;span&gt; ist kein Tag'
    );
    expect(html).toContain('style="color:#dc2626"');
    expect(html).toMatch(/<span style="color:#dc2626">rot<\/span>/);
    expect(html).toContain("&lt;span&gt; ist kein Tag");
  });

  it("Codespans und Codeblöcke bleiben byte-genau – KEINE Dekodierung (Serializer escaped dort nachweislich nicht)", () => {
    const html = render(
      "# T\n\n## A\n\nInline: `&lt;raw&gt;` Text.\n\n```text\n&lt;raw&gt;\n```"
    );
    // Codespan wie Codeblock: "&lt;raw&gt;" bleibt WÖRTLICHER Text (nicht zu
    // "<raw>" dekodiert) – React escaped diesen unveränderten String beim
    // Serialisieren zusätzlich einfach, sichtbar als "&amp;lt;raw&amp;gt;"
    // in der rohen HTML-Ausgabe (entspricht literal "&lt;raw&gt;" im Browser).
    expect(html).toMatch(/<code[^>]*>&amp;lt;raw&amp;gt;<\/code>/);
    expect(html).toContain("<pre");
    // Zweimal wörtlich: einmal im Codespan, einmal im Codeblock.
    expect((html.match(/&amp;lt;raw&amp;gt;/g) || []).length).toBe(2);
  });

  it("Formeln ($…$) bleiben unangetastet – Entity-Dekodierung greift dort nicht ein (Regression)", () => {
    const html = render("# T\n\n## A\n\nEs gilt $a^2+b^2=c^2$ hier.");
    expect(html).toContain("application/x-tex");
  });

  it("URLs (href) werden NIE dekodiert – ein & im Query-String bleibt unverändert (Regression)", () => {
    const html = render("# T\n\n## A\n\n[Titel](https://x.de/a?b=1&c=2)");
    expect(html).toMatch(/href="https:\/\/x\.de\/a\?b=1&amp;c=2"/);
  });

  it("generischer Link-Titel mit escaptem < wird korrekt dekodiert angezeigt, URL bleibt unangetastet", () => {
    const html = render("# T\n\n## A\n\n[Mehr &lt; Info](https://x.de/a)");
    expect(html).toContain("Mehr &lt; Info"); // dekodiertes "<", von React einfach HTML-escaped
    expect(html).toMatch(/href="https:\/\/x\.de\/a"/);
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

// v7.9 (Nutzerwunsch "DevOps/Confluence-Icons"): providerFor bestimmt das
// Icon ausschließlich aus dem URL-Präfix (lib/linkProviders.jsx), OHNE
// jeden Netzzugriff – die Registry wird hier über setLinkProviders() wie
// von App.jsx befüllt, afterEach räumt sie wieder auf (Modul-Singleton
// bleibt sonst über die Tests dieser Datei hinweg gesetzt). WICHTIG: der
// Wrapper-Umschalter jedes Abschnitts (ChevronDown, lucide-react) rendert
// selbst schon ein `<svg aria-hidden="true">` – ein bloßes
// toContain("<svg") wäre daher IMMER true, sobald ein Abschnitt existiert.
// Die Tests prüfen deshalb gezielt den Wrapper-Span unseres Icons
// (ICON_WRAP, eindeutige Klassenkombination) bzw. die Markenfarben.
describe("DocView: Link-Provider-Icons (v7.9)", () => {
  afterEach(() => setLinkProviders([]));

  const ICON_WRAP = 'class="inline-flex items-center align-middle mr-1" aria-hidden="true"';

  it("ein dev.azure.com-Link bekommt (eingebauter Provider, keine Konfiguration nötig) ein Icon VOR dem Link", () => {
    const html = render("# T\n\n## A\n\n[Ticket](https://dev.azure.com/acme/Proj/_workitems/edit/1)");
    expect(html).toContain(ICON_WRAP);
    expect(html).toMatch(
      /aria-hidden="true"><svg[^>]*fill="#0078D4"[\s\S]*?<\/svg><\/span><a[^>]*href="https:\/\/dev\.azure\.com\/acme\/Proj\/_workitems\/edit\/1"/
    );
  });

  it("dieselbe URL als nackte Fließtext-URL bekommt ebenfalls ein Icon", () => {
    const html = render("# T\n\n## A\n\n- Siehe https://dev.azure.com/acme/Proj/_workitems/edit/1 dazu.");
    expect(html).toContain(ICON_WRAP);
    expect(html).toContain('fill="#0078D4"');
  });

  it("eine Quellen-Fußnote mit derselben dev.azure.com-URL bekommt KEIN Icon", () => {
    const html = render("# T\n\n## A\n\nFakt[3](https://dev.azure.com/acme/Proj/_workitems/edit/1) dazu.");
    expect(html).not.toContain(ICON_WRAP);
    expect(html).not.toContain('fill="#0078D4"');
    expect(html).toMatch(/<sup/);
  });

  it("ein konfigurierter custom-Provider zeigt sein Emoji-Icon statt eines SVGs", () => {
    setLinkProviders([
      { id: "c1", type: "custom", name: "Intranet", prefix: "https://intranet.example/", icon: "🏠" },
    ]);
    const html = render("# T\n\n## A\n\n[Seite](https://intranet.example/x)");
    expect(html).toContain(ICON_WRAP);
    expect(html).toContain("🏠");
    expect(html).not.toContain('fill="#0078D4"');
    expect(html).not.toContain('fill="#2684FF"');
  });

  it("ohne passenden Provider erscheint gar kein Icon", () => {
    const html = render("# T\n\n## A\n\n[Extern](https://example.org/x)");
    expect(html).not.toContain(ICON_WRAP);
    expect(html).toMatch(/<a[^>]*href="https:\/\/example\.org\/x"/);
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
