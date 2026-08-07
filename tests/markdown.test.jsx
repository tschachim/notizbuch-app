// @vitest-environment jsdom
//
// v7.31 (file:-Links): braucht ein ECHTES DOM für den Klick+Zwischenablage-
// Test der FileLink-Komponente (createRoot/act unten) – renderToStaticMarkup
// (weiter unten, restliche Tests dieser Datei) läuft unverändert auch unter
// jsdom, per-Datei-Override wie in tests/docEditorLinks.test.jsx.
import { describe, it, expect, afterEach, vi } from "vitest";
// v7.39, beim Testschreiben gefunden: seit die FileLink-Klick-Tests (siehe
// FileLink-Blöcke unten) den Klick-Dispatch SYNCHRON statt wie zuvor über
// "await act(async () => { …; await Promise.resolve(); })" auslösen (nötig
// wurde, weil der Klick keine asynchrone Zwischenablage-Promise mehr anstößt,
// siehe markdown.jsx#FileLink), warnt React bei JEDEM act()-Aufruf "The
// current testing environment is not configured to support act(...)" -
// dieses Projekt nutzt "act" direkt aus "react" (kein @testing-library/
// react, das dieses Flag intern selbst setzt), ohne das von React dafür
// vorgesehene globale Flag zu setzen. FUNKTIONAL harmlos (act() flusht
// Effekte/State-Updates trotzdem korrekt), aber unnötiger Konsolen-Lärm bei
// JEDEM Testlauf - mit dem offiziell empfohlenen Flag behoben.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { DocView, parseTree, renumberCitations, TASK_RE, IMG_LINE_RE, indentLevel, splitCellLines } from "../src/lib/markdown.jsx";
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

// Datei-weiter Hook: seit v7.36 hat ein FileLink mit einem Laufwerks-Pfad
// als href DIREKT die "notizbuch-open:…"-Protokoll-URL (siehe
// markdown.jsx#FileLink, kein Iframe/JS-Trigger mehr, siehe DECISIONS #79
// "Review-Nachbesserung 5"). Erwartetes Nebengeräusch: jsdom protokolliert
// für jeden per dispatchEvent ausgelösten Klick auf ein solches <a>-Element
// "Not implemented: navigation to another Document" auf stderr (jsdom kann
// eine echte Navigation zu einem fremden URL-Schema nicht ausführen – genau
// das ist ja auch der Zweck: im echten Browser übernimmt an dieser Stelle
// der lokal registrierte Handler). Das ist eine bekannte, harmlose
// jsdom-Einschränkung, KEIN Testfehler, und wird von keinem der Tests unten
// fälschlich als Fehlschlag gewertet.
afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("### mitten in einer Zeile bzw. #### bleiben unverändert unstrukturell (Zeilenanfang-Pflicht, unabhängig vom v7.33-Fence-Aware-Fix)", () => {
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

  // v7.33 (E2E-Finding 🔴 A/C10/D6, DECISIONS #75, supersedet #54/#60):
  // "#"/"##"/"###"-Zeilen INNERHALB eines geschlossenen ```-Codeblocks
  // zählen NICHT mehr als Struktur-Grenze. Die beiden konkreten Live-Repros
  // (Bash-Kommentarzeile, "$"-Preis-Zeile) sind hier als eigene Fälle
  // gepinnt (siehe auch docs/TESTFAELLE.md C10/D6).
  describe("Fence-Aware Struktur-Erkennung (v7.33-Fix)", () => {
    it("Live-Repro 1: eine Bash-Kommentarzeile ('# Löscht …') im Codeblock erzeugt KEIN Phantom-Kapitel", () => {
      const doc =
        "# T\n\n# Skripte\n\n## Aufräumen\n\n```bash\n" +
        "# Löscht alle .tmp-Dateien im aktuellen Verzeichnis (rekursiv)\n" +
        'find . -name "*.tmp" -delete\n```\n\n- danach fertig';
      const { sections, chapters } = parseTree(doc);
      expect(chapters.map((c) => c.title)).toEqual(["Skripte"]);
      expect(sections.map((s) => s.title)).toEqual(["Aufräumen"]);
      // Der komplette Codeblock (Zaun + Kommentarzeile + Kommando) bleibt IN
      // EINEM Rutsch im Abschnitt "Aufräumen" – kein Zerreißen in mehrere
      // Absätze/Sektionen.
      expect(sections[0].lines.map((l) => l.text)).toEqual([
        "", "```bash",
        "# Löscht alle .tmp-Dateien im aktuellen Verzeichnis (rekursiv)",
        'find . -name "*.tmp" -delete', "```", "", "- danach fertig",
      ]);
    });

    it("Live-Repro 2: eine '#'-Zeile mit '$'-Preisangabe im Codeblock erzeugt KEIN Phantom-Kapitel", () => {
      const doc = "# T\n\n## A\n\n```\n# Preis: $5 | Menge: 3\n```\n\n- Rest";
      const { sections, chapters } = parseTree(doc);
      expect(chapters).toEqual([]);
      expect(sections.map((s) => s.title)).toEqual(["A"]);
      expect(sections[0].lines.some((l) => l.text === "# Preis: $5 | Menge: 3")).toBe(true);
      expect(sections[0].lines.some((l) => l.text === "- Rest")).toBe(true);
    });

    it("eine '##'-Zeile im Codeblock erzeugt KEINEN Phantom-Abschnitt (bleibt im umgebenden Abschnitt)", () => {
      const doc = "# T\n\n## A\n\n```\n## nicht echt\ncode\n```\n\n## B\n\n- b";
      const { sections } = parseTree(doc);
      expect(sections.map((s) => s.title)).toEqual(["A", "B"]);
      expect(sections[0].lines.some((l) => l.text === "## nicht echt")).toBe(true);
      expect(sections[0].lines.some((l) => l.text === "code")).toBe(true);
    });

    it("eine '###'-Zeile im Codeblock erzeugt KEIN Phantom-Unterthema (bleibt Absatz-Inhalt des Abschnitts)", () => {
      const doc = "# T\n\n## A\n\n```\n### nicht echt\ncode\n```\n\n- danach";
      const { sections } = parseTree(doc);
      expect(sections).toHaveLength(1);
      expect(sections[0].subs).toEqual([]);
      expect(sections[0].lines.some((l) => l.text === "### nicht echt")).toBe(true);
    });

    it("ein Codeblock DIREKT nach einer Kapitelzeile (ohne '##' davor) bleibt Kapitel-Freitext, kein Phantom-Kapitel", () => {
      const doc = "# T\n\n# Kapitel A\n\n```\n# not real\n```\n\n# Kapitel B\n\n## Zwei";
      const { chapters, sections } = parseTree(doc);
      expect(chapters.map((c) => c.title)).toEqual(["Kapitel A", "Kapitel B"]);
      expect(chapters[0].lines.map((l) => l.text)).toEqual(["", "```", "# not real", "```", ""]);
      expect(sections.map((s) => s.title)).toEqual(["Zwei"]);
    });

    it("mehrzeiliger Fence mit MEHREREN Struktur-artigen Zeilen bleibt vollständig EIN Block (kein Zerfall)", () => {
      const doc =
        "# T\n\n## A\n\n```\n# eins\n## zwei\n### drei\n```\n\n## B\n\n- b";
      const { sections } = parseTree(doc);
      expect(sections.map((s) => s.title)).toEqual(["A", "B"]);
      expect(sections[0].lines.map((l) => l.text)).toEqual([
        "", "```", "# eins", "## zwei", "### drei", "```", "",
      ]);
    });

    it("verschachtelter 4-Backtick-Zaun um Inhalt mit eigenen 3-Backtick-Zeilen bleibt EIN Block, Struktur-Zeilen darin unwirksam", () => {
      const doc = "# T\n\n## A\n\n````\n# nicht real\n```\ninner\n```\n````\n\n## B";
      const { sections } = parseTree(doc);
      expect(sections.map((s) => s.title)).toEqual(["A", "B"]);
      expect(sections[0].lines.some((l) => l.text === "# nicht real")).toBe(true);
      expect(sections[0].lines.some((l) => l.text === "inner")).toBe(true);
    });

    it("UNTERMINIERTER Zaun bleibt bewusst fence-blind: eine '#'-Zeile danach ist weiterhin eine echte Kapitelgrenze", () => {
      // Kein schließender Zaun bis Dokumentende -> matchFenceBlock liefert
      // null -> computeFenceLineMask maskiert NICHTS ab hier (siehe
      // Kopfkommentar computeFenceLineMask/code.jsx) -> altes, unverändertes
      // Verhalten: die "#"-Zeile bleibt eine strukturelle Kapitelgrenze.
      const doc = "# T\n\n## A\n\n```\nkeine schließende Zeile\n\n# Kapitel B\n\n## Zwei";
      const { chapters, sections } = parseTree(doc);
      // "A" steht VOR dem ersten echten Kapitel -> bekommt wie gehabt ein
      // implizites titelloses Kapitel (v7.14-Verhalten, unverändert).
      expect(chapters.map((c) => c.title)).toEqual([null, "Kapitel B"]);
      expect(sections.map((s) => s.title)).toEqual(["A", "Zwei"]);
      expect(sections.map((s) => s.chapter)).toEqual([0, 1]);
    });

    it("DocView: Bash-Kommentarzeile im Codeblock rendert EINEN zusammenhängenden CodeBlockView, KEIN Phantom-Kapitel/-Überschrift", () => {
      const html = render(
        "# T\n\n# Skripte\n\n## Aufräumen\n\n```bash\n" +
        "# Löscht alle .tmp-Dateien im aktuellen Verzeichnis (rekursiv)\n" +
        'find . -name "*.tmp" -delete\n```'
      );
      expect((html.match(/<pre/g) || []).length).toBe(1);
      expect(html).toContain("Löscht alle .tmp-Dateien");
      expect(html).not.toContain("```");
      // Nur EIN Kapitel-Header ("Skripte") und EIN Abschnitts-Header
      // ("Aufräumen") – kein zusätzlicher, aus der Kommentarzeile
      // fabrizierter h1/h2.
      const { chapters, sections } = parseTree(
        "# T\n\n# Skripte\n\n## Aufräumen\n\n```bash\n" +
        "# Löscht alle .tmp-Dateien im aktuellen Verzeichnis (rekursiv)\n" +
        'find . -name "*.tmp" -delete\n```'
      );
      expect(chapters.map((c) => c.title)).toEqual(["Skripte"]);
      expect(sections.map((s) => s.title)).toEqual(["Aufräumen"]);
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

// v7.41 (Auftrag "Einrückungen", Nutzerwunsch): 2 Leerzeichen = eine Ebene,
// Tab zählt beim Lesen wie 2 Leerzeichen, maximal 6 Ebenen.
describe('indentLevel (v7.41, Auftrag "Einrückungen")', () => {
  it("0 Leerzeichen -> Ebene 0", () => {
    expect(indentLevel("Text ohne Einzug")).toBe(0);
  });
  it("2 Leerzeichen -> Ebene 1", () => {
    expect(indentLevel("  Text")).toBe(1);
  });
  it("ungerade Leerzeichenzahl rundet ab: 3 Leerzeichen -> Ebene 1", () => {
    expect(indentLevel("   Text")).toBe(1);
  });
  it("4 Leerzeichen -> Ebene 2", () => {
    expect(indentLevel("    Text")).toBe(2);
  });
  it("12 Leerzeichen (6 Ebenen) -> Ebene 6", () => {
    expect(indentLevel(" ".repeat(12) + "Text")).toBe(6);
  });
  it("Kappung: mehr als 12 Leerzeichen bleibt bei Ebene 6", () => {
    expect(indentLevel(" ".repeat(13) + "Text")).toBe(6);
    expect(indentLevel(" ".repeat(20) + "Text")).toBe(6);
    expect(indentLevel(" ".repeat(40) + "Text")).toBe(6);
  });
  it("ein Tab zählt wie 2 Leerzeichen", () => {
    expect(indentLevel("\tText")).toBe(1);
    expect(indentLevel("\t\tText")).toBe(2);
  });
  it("gemischt Tab+Leerzeichen zählt beide Anteile zusammen (1 Tab + 2 Leerzeichen = 4 -> Ebene 2)", () => {
    expect(indentLevel("\t  Text")).toBe(2);
  });
  it("eine leere Zeile hat Ebene 0 (kein Absturz bei fehlendem Inhalt)", () => {
    expect(indentLevel("")).toBe(0);
  });
  it("führende Leerzeichen NACH nicht-whitespace zählen nicht mehr mit (nur der Zeilenanfang)", () => {
    expect(indentLevel("kein Einzug  aber Leerzeichen mitten drin")).toBe(0);
  });
});

// v7.41 (Auftrag "Einrückungen"): der Padding-Ansatz aus dem Kopfkommentar
// von renderBlocks (lib/markdown.jsx) – Listenpunkte/Absätze/Bilder/
// Tabellen/Trennlinien bekommen ihren Einzug über einen linken
// margin-left-Zusatz, KEINE echte <ul>-Verschachtelung.
describe('DocView: Einrückung (v7.41, Auftrag "Einrückungen")', () => {
  it("ein eingerückter Absatz bekommt margin-left proportional zur Ebene (2 Leerzeichen = 1,5rem)", () => {
    const html = render("# T\n\n## A\n\nUnverändert\n\n  Eingerückt eine Ebene");
    const pTags = [...html.matchAll(/<p[^>]*>([^<]*)<\/p>/g)];
    const plain = pTags.find((m) => m[1].includes("Unverändert"));
    const indented = pTags.find((m) => m[1].includes("Eingerückt"));
    expect(plain[0]).not.toMatch(/margin-left/);
    expect(indented[0]).toMatch(/margin-left:1\.5rem/);
  });

  it("Ebene 2 (4 Leerzeichen) ergibt 3rem, Ebene 6 (12+ Leerzeichen) 9rem", () => {
    const html = render("# T\n\n## A\n\n    Ebene zwei\n\n" + " ".repeat(20) + "Ebene sechs (gekappt)");
    expect(html).toContain('style="margin-left:3rem"');
    expect(html).toContain('style="margin-left:9rem"');
    expect(html).toContain("Ebene zwei");
    expect(html).toContain("Ebene sechs");
  });

  it("ein eingerücktes Bild (figure) bekommt denselben Einzug", () => {
    const html = render("# T\n\n## A\n\n  ![Titel](img:xyz)", { xyz: "data:image/png;base64,AAA" });
    expect(html).toMatch(/<figure[^>]*style="margin-left:1\.5rem"/);
  });

  it("eine eingerückte Tabelle bekommt den Einzug auf ihrem Wrapper-Div", () => {
    const html = render("# T\n\n## A\n\n  | a | b |\n  | --- | --- |\n  | 1 | 2 |");
    expect(html).toMatch(/<div class="overflow-x-auto my-3" style="margin-left:1\.5rem">/);
  });

  it("eine eingerückte Trennlinie (---) bekommt denselben Einzug", () => {
    const html = render("# T\n\n## A\n\nText\n\n  ---\n\nmehr Text");
    expect(html).toMatch(/<hr[^>]*style="margin-left:1\.5rem"/);
  });

  it("Überschriften werden NIE eingerückt (indentLevel gilt nicht für #/##/###-Zeilen)", () => {
    // Eine EINGERÜCKTE "#"-Zeile wird von parseTree/renderBlocks gar nicht
    // erst als Überschrift erkannt (zeilenanfangs-verankerte Regex ohne
    // Leerraum-Toleranz) - sie fällt bewusst auf den normalen, dann
    // eingerückten Absatz-Zweig zurück statt eine Struktur-Zeile zu werden.
    // Das ist HIER der Beleg dafür, dass ein Einzugs-Feature Überschriften
    // strukturell nicht antasten kann.
    const html = render("# T\n\n  # sieht aus wie eine Überschrift, ist aber Text");
    expect(html).not.toMatch(/<h1[^>]*>\s*#/);
    expect(html).toContain('<p style="margin-left:1.5rem"');
    expect(html).toContain("sieht aus wie eine Überschrift");
  });

  it("ein Ebenenwechsel MITTEN in einer Liste beendet die laufende Liste und beginnt eine neue (Padding-Ansatz)", () => {
    const html = render("# T\n\n## A\n\n- Ebene null\n  - Ebene eins\n- wieder Ebene null");
    const uls = [...html.matchAll(/<ul[^>]*>/g)];
    // Typwechsel UND Ebenenwechsel: drei getrennte <ul>-Blöcke (0,1,0), nicht
    // eine einzige zusammengefasste Liste.
    expect(uls.length).toBe(3);
    expect(uls[0][0]).not.toMatch(/margin-left/);
    expect(uls[1][0]).toMatch(/margin-left:1\.5rem/);
    expect(uls[2][0]).not.toMatch(/margin-left/);
  });

  // BUGFIX (Code-Review vor v7.41-Commit, 🟡 Finding 2): Ein Ebenenwechsel
  // beendet die laufende Liste (siehe Test oben) – bei einer NUMMERIERTEN
  // Liste fing das neue <ol> danach ohne "start" immer wieder bei "1." an,
  // selbst wenn die Quelle bei "2."/"3." weiterzählte.
  it("eine nummerierte Liste zählt nach einem Ebenenwechsel korrekt weiter, statt wieder bei 1. zu beginnen", () => {
    const html = render("# T\n\n## A\n\n1. Eins\n   1. Unter\n2. Zwei\n3. Drei");
    const ols = [...html.matchAll(/<ol[^>]*>[\s\S]*?<\/ol>/g)].map((m) => m[0]);
    expect(ols).toHaveLength(3);
    // Erste Liste (nur "Eins"): beginnt bei 1, kein explizites "start" nötig.
    expect(ols[0]).not.toMatch(/start=/);
    expect(ols[0]).toContain("Eins");
    // Zweite Liste (eingerückt, nur "Unter"): ebenfalls bei 1, kein "start".
    expect(ols[1]).not.toMatch(/start=/);
    expect(ols[1]).toContain("Unter");
    // Dritte Liste ("Zwei", "Drei"): MUSS bei 2 weiterzählen, sonst würde
    // <ol> nativ wieder bei 1/2 statt 2/3 rendern.
    expect(ols[2]).toMatch(/start="2"/);
    expect(ols[2]).toContain("Zwei");
    expect(ols[2]).toContain("Drei");
  });

  it("eine gewöhnliche, ununterbrochene nummerierte Liste bekommt weiterhin KEIN start-Attribut", () => {
    const html = render("# T\n\n## A\n\n1. Eins\n2. Zwei\n3. Drei");
    expect(html).not.toMatch(/start=/);
  });

  it("gemischt Checkliste/Aufzählung mit unterschiedlicher Einrückung bleibt sauber getrennt", () => {
    const html = render("# T\n\n## A\n\n- [ ] Checkbox oben\n  - Bullet eingerückt\n  - [ ] Checkbox eingerückt");
    // Drei Blöcke: task(0), ul(1), task(1) - Typ- UND Ebenenwechsel.
    const blocks = [...html.matchAll(/<ul[^>]*>/g)];
    expect(blocks.length).toBe(3);
    expect(blocks[1][0]).toMatch(/margin-left:1\.5rem/);
    expect(blocks[2][0]).toMatch(/margin-left:1\.5rem/);
  });

  it("tiefere Aufzählungsebenen bekommen ein anderes Aufzählungszeichen (Ebene 0 disc, 1 circle, ab 2 square)", () => {
    const html = render("# T\n\n## A\n\n- null\n  - eins\n    - zwei");
    expect(html).toContain('class="list-disc pl-5');
    expect(html).toContain('class="[list-style-type:circle] pl-5');
    expect(html).toContain('class="[list-style-type:square] pl-5');
  });

  it("Einrückung INNERHALB eines Codeblocks bleibt unangetastet (kein margin-left, Inhalt byte-genau)", () => {
    const html = render("# T\n\n## A\n\n```\n    stark eingerueckte Codezeile\n```");
    expect(html).not.toMatch(/margin-left/);
    expect(html).toContain("    stark eingerueckte Codezeile");
  });

  // BUGFIX (Code-Review vor v7.41-Commit, 🟡 Finding 5a): Der bisherige Test
  // rief onToggleTask NIE auf und verglich lediglich den Eingabe-String mit
  // sich selbst (keine echte Aussagekraft, hätte einen kaputten idx nicht
  // gefunden). Jetzt ECHTES DOM (createRoot/act/click, Muster wie beim
  // FileLink-Test unten in dieser Datei) mit wirklichen Klicks auf BEIDE
  // Checkboxen – prüft, dass onToggleTask für Eltern- UND (eingerückten)
  // Kindpunkt mit dem jeweils KORREKTEN Original-Zeilenindex aufgerufen wird.
  it("Checkbox-Zeilenindex (fürs Abhaken) bleibt bei eingerückten Checklisten korrekt", () => {
    const doc = "# T\n\n## A\n\n- [ ] Elternpunkt\n  - [ ] Kindpunkt";
    const onToggleTask = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <DocView text={doc} collapsed={{}} onToggle={() => {}} imgMap={{}} onImgClick={() => {}} onToggleTask={onToggleTask} />
      );
    });
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes).toHaveLength(2);

    act(() => { checkboxes[0].click(); });
    // Zeile 4 (0-basiert) ist "- [ ] Elternpunkt".
    expect(onToggleTask).toHaveBeenLastCalledWith(4, true);

    act(() => { checkboxes[1].click(); });
    // Zeile 5 ist der EINGERÜCKTE Kindpunkt "  - [ ] Kindpunkt" – der idx
    // darf durch die Einrückung/das neue Attribut nicht verschoben werden.
    expect(onToggleTask).toHaveBeenLastCalledWith(5, true);
    expect(onToggleTask).toHaveBeenCalledTimes(2);

    act(() => root.unmount());
    container.remove();
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

  // v7.45-Fix (Datenkorruption, E2E-Finding 🔴 – siehe DECISIONS #91): eine
  // INHALTSLEERE Checkbox-Zeile ("- [ ]" ganz ohne abschließendes
  // Leerzeichen, z. B. per Enter im Editor erzeugt und dann durch
  // App.jsx#saveEdit's Dokumentend-trim() oder einfach ohne jedes
  // Leerzeichen gespeichert) muss GENAUSO als Checkbox erkannt werden wie
  // die klassische Form MIT Leerzeichen – ohne den Fix war "\]\s+"
  // zwingend, "- [ ]" fiel durch UL_RE in den normalen Aufzählungs-Zweig.
  describe("TASK_RE erkennt eine INHALTSLEERE Checkbox ohne abschließendes Leerzeichen (v7.45)", () => {
    it("bare '- [ ]' am Zeilenende (kein Leerzeichen nach der Klammer)", () => {
      const m = TASK_RE.exec("- [ ]");
      expect(m).not.toBeNull();
      expect(m[1]).toBe("- [");
      expect(m[2]).toBe(" ");
      expect(m[3]).toBe("]");
      expect(m[4]).toBe("");
    });

    it("bare '- [x]'/'- [X]' (erledigt, leer) werden ebenfalls erkannt", () => {
      expect(TASK_RE.test("- [x]")).toBe(true);
      expect(TASK_RE.test("- [X]")).toBe(true);
      expect(TASK_RE.exec("- [x]")[2]).toBe("x");
    });

    it("weiterhin MIT abschließendem Leerzeichen erkannt (Kompatibilität zum bisherigen Verhalten)", () => {
      const m = TASK_RE.exec("- [ ] ");
      expect(m[3]).toBe("] ");
      expect(m[4]).toBe("");
    });

    it("'*' als Marker, leer, ohne Leerzeichen", () => {
      expect(TASK_RE.test("* [ ]")).toBe(true);
    });

    it("mehrfach eingerückt, leer, ohne Leerzeichen", () => {
      const m = TASK_RE.exec("      - [ ]");
      expect(m).not.toBeNull();
      expect(m[1]).toBe("      - [");
    });

    it("bewusste Grenze: '- [ ]Text' OHNE jedes Trennzeichen bleibt weiterhin KEINE Checkbox (Konsistenz zu markdown-it-task-lists, siehe DECISIONS #91)", () => {
      expect(TASK_RE.test("- [ ]Text")).toBe(false);
      expect(TASK_RE.test("- [x]Text")).toBe(false);
    });

    it("echter Text nach der Klammer bleibt unverändert im Verhalten (Regressionsschutz)", () => {
      const m = TASK_RE.exec("- [ ] Erledige X");
      expect(m[3]).toBe("] ");
      expect(m[4]).toBe("Erledige X");
    });
  });

  it("IMG_LINE_RE matcht nur reine Bildzeilen mit img:-Referenz", () => {
    expect(IMG_LINE_RE.test("![t](img:abc123)")).toBe(true);
    expect(IMG_LINE_RE.test("![t](https://x.de/a.png)")).toBe(false);
    expect(IMG_LINE_RE.test("Text ![t](img:abc) Text")).toBe(false);
  });
});

// v7.45-Fix (Datenkorruption, E2E-Finding 🔴 – siehe DECISIONS #91): eine
// leere Checkbox muss an JEDER Position (mittig, verschachtelt, als letzter
// Punkt des Dokuments, als einziger Punkt) als echte Checkbox gerendert
// werden, NICHT als Aufzählungspunkt mit dem Literaltext "[ ]".
describe("DocView: inhaltsleere Checkbox an jeder Position (v7.45)", () => {
  it("mittig, verschachtelt UND als letzter Punkt des Dokuments (ohne abschließenden Zeilenumbruch) rendern alle als echte Checkbox", () => {
    // Zeilen-Indizes (0-basiert): 0 "# T", 1 "", 2 "## A", 3 "",
    // 4 "- [ ] Eins", 5 "- [ ]" (mittig), 6 "- [ ] Zwei",
    // 7 "  - [ ]" (verschachtelt/eingerückt), 8 "- [ ]" (letzte Zeile,
    // KEIN abschließendes "\n").
    const doc =
      "# T\n\n## A\n\n- [ ] Eins\n- [ ]\n- [ ] Zwei\n  - [ ]\n- [ ]";
    const html = render(doc);
    expect(html.match(/type="checkbox"/g)).toHaveLength(5);
    // Keine der leeren Checkboxen darf als Literaltext "[ ]" im Fließtext
    // auftauchen (das wäre das gemeldete Symptom: <li ...>[ ]</li>).
    expect(html).not.toContain("[ ]<");
    expect(html).not.toContain(">[ ]");
  });

  // v7.45.1 (Review-Finding 🔵): Ohne eigenen Text hatte das <span> neben
  // der Checkbox bisher 0×0 Ausdehnung – die Checkbox selbst blieb zwar
  // über <input> klickbar, der Punkt als Ganzes war aber schwer als eigene
  // Zeile wahrzunehmen. Eine Mindesthöhe/-breite gibt ihm jetzt sichtbaren
  // Platz, NUR wenn er wirklich leer ist – ein Punkt MIT echtem Text bleibt
  // unverändert (sein eigener Inhalt ist ohnehin größer als das Minimum).
  it("eine leere Checkbox bekommt eine Mindesthöhe/-breite fürs Label (Klickfläche/Sichtbarkeit), eine Checkbox MIT Text bleibt unverändert", () => {
    const htmlEmpty = render("# T\n\n## A\n\n- [ ]");
    expect(htmlEmpty).toMatch(/<span class="inline-block min-h-\[1\.375rem\] min-w-\[1rem\]">/);
    const htmlText = render("# T\n\n## A\n\n- [ ] Text");
    expect(htmlText).not.toContain("min-h-[1.375rem]");
    expect(htmlText).toMatch(/<span class="">/);
  });

  it("ein Dokument, dessen EINZIGER Inhalt eine leere Checkbox ist, rendert trotzdem eine Checkbox (kein Absturz, kein Literaltext)", () => {
    const html = render("# T\n\n## A\n\n- [ ]");
    expect(html.match(/type="checkbox"/g)).toHaveLength(1);
    expect(html).not.toContain("[ ]<");
  });

  it("eine bereits erledigte (checked), aber leere Checkbox ('- [x]') rendert ebenfalls korrekt, inkl. checked-Attribut", () => {
    const html = render("# T\n\n## A\n\n- [x]");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked=");
  });

  it("'*' als Marker, leer, wird ebenfalls erkannt", () => {
    const html = render("# T\n\n## A\n\n* [ ]");
    expect(html.match(/type="checkbox"/g)).toHaveLength(1);
  });

  // Regressionsschutz für die Geister-Checkbox-Heilung (v7.41.2, siehe
  // DECISIONS #91 "Randbedingung"): dropEmptyCheckboxLines (DocEditor.jsx)
  // entfernt bewusst ein leeres "- [ ]" AM ANFANG eines Listenblocks direkt
  // beim Speichern – das betrifft nur den EDITOR-Speicherpfad, NICHT die
  // reine Anzeige hier. TASK_RE/DocView zeigen eine leere Checkbox ÜBERALL
  // an, unabhängig von ihrer Position – die Positionsregel gehört
  // ausschließlich zu dropEmptyCheckboxLines (siehe
  // tests/docEditorGhostCheckbox.test.jsx), nicht zum Viewer.
  it("auch eine leere Checkbox GANZ AM ANFANG einer Liste rendert hier als Checkbox (Positionsregel gilt nur beim Speichern, nicht in der Anzeige)", () => {
    const html = render("# T\n\n## A\n\n- [ ]\n- Notiz");
    expect(html.match(/type="checkbox"/g)).toHaveLength(1);
  });

  // Klick-Test (echtes DOM, Muster wie "Checkbox-Zeilenindex" oben in
  // dieser Datei): eine leere Checkbox mittig, verschachtelt UND als
  // letzter Punkt hakt beim Klick GENAU ihre eigene, richtige Zeile ab –
  // nicht die eines Nachbarpunkts.
  it("Klick auf eine leere Checkbox (mittig/verschachtelt/letzte Zeile) meldet den KORREKTEN Original-Zeilenindex", () => {
    const doc = "# T\n\n## A\n\n- [ ] Eins\n- [ ]\n- [ ] Zwei\n  - [ ]\n- [ ]";
    const onToggleTask = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <DocView text={doc} collapsed={{}} onToggle={() => {}} imgMap={{}} onImgClick={() => {}} onToggleTask={onToggleTask} />
      );
    });
    const boxes = container.querySelectorAll('input[type="checkbox"]');
    expect(boxes).toHaveLength(5);

    act(() => { boxes[1].click(); }); // "- [ ]" mittig, Zeile 5
    expect(onToggleTask).toHaveBeenLastCalledWith(5, true);

    act(() => { boxes[3].click(); }); // "  - [ ]" verschachtelt, Zeile 7
    expect(onToggleTask).toHaveBeenLastCalledWith(7, true);

    act(() => { boxes[4].click(); }); // "- [ ]" letzte Zeile, Zeile 8
    expect(onToggleTask).toHaveBeenLastCalledWith(8, true);

    expect(onToggleTask).toHaveBeenCalledTimes(3);
    act(() => root.unmount());
    container.remove();
  });

  // Simuliert App.jsx#toggleTask (m[1] + Zustand + m[3] + m[4]) direkt
  // gegen TASK_RE, um zu belegen, dass das Abhaken einer INHALTSLEEREN
  // Checkbox eine korrekte, stabile Zeile erzeugt (kein zusätzliches
  // Leerzeichen, kein verlorener Text) – App.jsx selbst ist laut
  // Projekt-Konvention nicht Teil der Unit-Test-Coverage (E2E deckt die UI
  // ab), die zugrunde liegende Logik (TASK_RE) aber sehr wohl.
  it("Abhaken einer leeren Checkbox (App.jsx#toggleTask-Logik nachgebaut) erzeugt eine stabile, korrekt formatierte Zeile", () => {
    const toggleLine = (line, checked) => {
      const m = TASK_RE.exec(line);
      return m[1] + (checked ? "x" : " ") + m[3] + m[4];
    };
    expect(toggleLine("- [ ]", true)).toBe("- [x]");
    expect(toggleLine("- [x]", false)).toBe("- [ ]");
    expect(toggleLine("  - [ ]", true)).toBe("  - [x]");
    // Ein Umschalten hin und zurück liefert wieder exakt die Ausgangszeile.
    expect(toggleLine(toggleLine("- [ ]", true), false)).toBe("- [ ]");
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

  // BUGFIX (Re-Review vor v7.41-Commit, 🔵 Finding D): Der Absatz neben
  // einer eingerückten Formel bekam schon vorher margin-left, die Formel
  // selbst blieb bündig, obwohl "  $$x$$" seit dem Einzugs-Fix (Finding 6)
  // den Editor-Roundtrip bereits überlebt – die ANSICHT zog nur nicht nach.
  it("eine eingerückte Display-Formel bekommt in der Ansicht denselben Einzug wie ein Absatz auf derselben Ebene", () => {
    const html = render("# T\n\n## A\n\n  $$x^2$$");
    expect(html).toMatch(/style="margin-left:1\.5rem"/);
  });

  it("eine NICHT eingerückte Display-Formel bekommt weiterhin KEINEN margin-left (keine Regression)", () => {
    const html = render("# T\n\n## A\n\n$$x^2$$");
    expect(html).not.toMatch(/margin-left/);
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

// v7.31 (Nutzer-Befund Live + Nutzerwunsch): "[Titel](file:///…)" wird als
// generischer Link gerendert (nicht als Klartext, siehe Auftrag) – eigene
// Komponente FileLink (Klick zeigt seit v7.39 nur noch ein kurzes "wird
// geöffnet …"-Feedback, KEINE Zwischenablage-Kopie mehr, siehe zweiter
// describe-Block unten). CITE_LINK_RE/renumberCitations bleiben dabei
// UNANGETASTET (siehe Block oben) – ein file:-Link mit numerischem Titel
// bleibt deshalb IMMER ein normaler Link, nie eine <sup>-Fußnote.
describe("DocView: file:-Links (v7.31, href = Protokoll-URL seit v7.36)", () => {
  it("[Titel](file:///C:/…) wird zu einem klickbaren Link, href ist die notizbuch-open-Protokoll-URL, title bleibt der Backslash-Pfad, kein <sup>", () => {
    const html = render("# T\n\n## A\n\n- Siehe [Bericht](file:///C:/Users/x/Bericht.docx) dazu.");
    // v7.36: href ist NICHT mehr die file:-URL, sondern buildProtocolUrl(url)
    // (siehe FileLink, markdown.jsx) - der Live-Befund zeigte, dass NUR eine
    // echte Top-Level-Navigation zu einem Custom-Scheme im Browser
    // zuverlässig auslöst (siehe DECISIONS #79, Review-Nachbesserung 5).
    // title bleibt bewusst der lesbare Backslash-Pfad (Tooltip).
    expect(html).toMatch(
      /<a[^>]*href="notizbuch-open:v1\?path=C%3A%5CUsers%5Cx%5CBericht\.docx"[^>]*title="C:\\Users\\x\\Bericht\.docx"[^>]*>Bericht<\/a>/
    );
    expect(html).not.toContain("<sup");
    // KEIN target="_blank"/rel-Attribut (anders als bei http(s)-Links) –
    // ein neuer Tab bliebe nach dem Hand-off an die externe App leer stehen,
    // siehe FileLink, markdown.jsx.
    expect(html).not.toContain('target="_blank"');
  });

  it("ein UNC-Ziel (file://server/share/…) wird ebenfalls verlinkt, href bleibt die file:-URL (buildProtocolUrl liefert null)", () => {
    const html = render("# T\n\n## A\n\n[Datei](file://server/share/datei.md)");
    // UNC-Ziele werden vom Handler grundsätzlich abgelehnt (SMB-Credential-
    // Leak-Risiko) - buildProtocolUrl liefert dafür bewusst null, FileLink
    // faellt dann auf die unveraenderte file:-URL zurueck (siehe ??-Fallback
    // in FileLink).
    expect(html).toMatch(/<a[^>]*href="file:\/\/server\/share\/datei\.md"[^>]*>Datei<\/a>/);
  });

  it("ein rein numerischer Titel bleibt bei einem file:-Ziel ein NORMALER Link, NIE eine Fußnote", () => {
    const html = render("# T\n\n## A\n\nFakt[3](file:///C:/Users/x/Beleg.pdf) hier.");
    expect(html).not.toContain("<sup");
    expect(html).toMatch(/<a[^>]*href="notizbuch-open:v1\?path=C%3A%5CUsers%5Cx%5CBeleg\.pdf"[^>]*>3<\/a>/);
  });

  it("eine gleiche URL als http(s)-Fußnote bleibt <sup> (Kontrast-Test, unverändert)", () => {
    const html = render("# T\n\n## A\n\nFakt[3](https://example.org/beleg) hier.");
    expect(html).toMatch(/<sup[^>]*><a[^>]*href="https:\/\/example\.org\/beleg"[^>]*>\[3\]<\/a><\/sup>/);
  });

  it("kein Provider-Icon vor einem file:-Link (providerFor prüft nur http(s))", () => {
    const html = render("# T\n\n## A\n\n[Ticket](file:///C:/Users/x/dev.azure.com.txt)");
    expect(html).not.toContain("provider-link-icon");
  });

  it("javascript:/data:-Ziele bleiben weiterhin Klartext (die neue file:-Alternative öffnet KEINE dritte, unsichere Alternative)", () => {
    const html = render(
      "# T\n\n## A\n\n- [Klick mich](javascript:alert(1))\n- [Bild anzeigen](data:text/html,x)"
    );
    expect(html).not.toContain("<a ");
    expect(html).toContain("[Klick mich](javascript:alert(1))");
  });

  it("eine file:-URL mit rohem Leerzeichen (kein %-Encoding) bleibt Klartext (Grammatik verlangt Whitespace-Freiheit)", () => {
    const html = render("# T\n\n## A\n\n[Bericht](file:///C:/Users/x/a b.docx)");
    expect(html).not.toContain("<a ");
  });

  it("Titel mit **fett** in einem file:-Link wird rekursiv gerendert", () => {
    const html = render("# T\n\n## A\n\n[Sehr **wichtig**](file:///C:/Users/x/a.docx)");
    expect(html).toMatch(/<a[^>]*href="notizbuch-open:v1\?path=C%3A%5CUsers%5Cx%5Ca\.docx"[^>]*>Sehr <strong[^>]*>wichtig<\/strong><\/a>/);
  });
});

// Klick-Feedback OHNE Zwischenablage (v7.39, Nutzer-Feedback nach
// erfolgreichem Live-Test): braucht ein ECHTES DOM (createRoot/act statt
// renderToStaticMarkup, siehe Datei-Kopf). Bis v7.38 kopierte JEDER Klick
// zusätzlich den Windows-Pfad in die Zwischenablage – seit der
// Protokollstart LIVE bestätigt zuverlässig funktioniert, ist das ERSATZLOS
// entfernt (siehe markdown.jsx#FileLink, Kopfkommentar "KEINE
// Zwischenablage-Kopie mehr"): die Kopie überschrieb sonst ungefragt den
// bisherigen Zwischenablage-Inhalt des Nutzers, ohne noch einen Zweck zu
// erfüllen. Mehrere Tests unten setzen navigator.clipboard bewusst MIT
// einem Spy, nur um AKTIV zu pinnen, dass er NIE aufgerufen wird (Schutz
// gegen eine versehentliche Rückkehr der Kopie).
describe("FileLink: Klick zeigt kurz 'wird geöffnet …' an, OHNE die Zwischenablage anzufassen (v7.39)", () => {
  let container;
  let root;

  const mount = (md) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <DocView text={md} collapsed={{}} onToggle={() => {}} imgMap={{}} onImgClick={() => {}} onToggleTask={() => {}} />
      );
    });
  };

  afterEach(() => {
    if (root) act(() => root.unmount());
    if (container) container.remove();
    root = null;
    container = null;
    delete navigator.clipboard;
    vi.useRealTimers();
  });

  it("ein Klick zeigt kurz 'wird geöffnet …' an, das nach ~1 s wieder verschwindet", () => {
    vi.useFakeTimers();

    mount("# T\n\n## A\n\n[Bericht](file:///C:/Users/x/Mein%20Bericht.docx)");
    const link = container.querySelector("a");
    expect(link).toBeTruthy();
    expect(container.textContent).not.toContain("wird geöffnet");

    act(() => {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(container.textContent).toContain("wird geöffnet …");

    act(() => { vi.advanceTimersByTime(1000); });
    expect(container.textContent).not.toContain("wird geöffnet");
  });

  // Aktiv gepinnt (Auftrag Punkt 4: "es darf NICHT mehr kopiert werden"):
  // navigator.clipboard ist vorhanden UND funktionsfähig, wird aber bei
  // KEINEM Klick mehr aufgerufen – Regressionsschutz gegen eine
  // versehentliche Rückkehr der v7.31-v7.38-Kopie.
  it("navigator.clipboard.writeText wird NIE aufgerufen, auch wenn die Clipboard-API vorhanden ist", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    mount("# T\n\n## A\n\n[Bericht](file:///C:/Users/x/Mein%20Bericht.docx)");
    const link = container.querySelector("a");
    act(() => {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(writeText).not.toHaveBeenCalled();
  });

  it("KEIN preventDefault: die Standard-Navigation des <a>-Elements wird nicht unterbunden", () => {
    mount("# T\n\n## A\n\n[Bericht](file:///C:/Users/x/Bericht.docx)");
    const link = container.querySelector("a");
    const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      link.dispatchEvent(evt);
    });
    expect(evt.defaultPrevented).toBe(false);
  });

  it("ohne navigator.clipboard (ältere Browser/kein sicherer Kontext) funktioniert der Klick trotzdem, kein Crash", () => {
    delete navigator.clipboard; // Umgebung ohne Clipboard-API
    mount("# T\n\n## A\n\n[Bericht](file:///C:/Users/x/Bericht.docx)");
    const link = container.querySelector("a");
    expect(() => {
      act(() => {
        link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
    }).not.toThrow();
    expect(container.textContent).toContain("wird geöffnet …");
  });

  // Review-Fix 🔵 Finding 4 (v7.31, Logik unverändert beibehalten, siehe
  // Auftrag Punkt 2): ein zweiter Klick VOR Ablauf des ersten Timers muss
  // den bereits laufenden Ausblend-Timer zurücksetzen (clearTimeout,
  // timerRef in FileLink) – sonst blendet der ERSTE Timer das Feedback
  // verfrüht aus, obwohl der ZWEITE Klick es gerade erst wieder
  // eingeblendet hat. Zeiten an die neue 1-s-Anzeigedauer angepasst.
  it("ein zweiter Klick VOR Ablauf des ersten Timers setzt den Ausblend-Timer zurück (kein verfrühtes Verschwinden)", () => {
    vi.useFakeTimers();

    mount("# T\n\n## A\n\n[Bericht](file:///C:/Users/x/Bericht.docx)");
    const link = container.querySelector("a");

    act(() => {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(container.textContent).toContain("wird geöffnet …");

    act(() => { vi.advanceTimersByTime(600); }); // noch VOR den ursprünglichen 1000 ms
    expect(container.textContent).toContain("wird geöffnet …");

    // Zweiter Klick bei t=600: OHNE den Fix würde der vom ERSTEN Klick
    // gestartete Timer trotzdem bei t=1000 feuern und das Feedback
    // ausblenden, obwohl der zweite Klick es gerade erneuert hat.
    act(() => {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    // t=600+500=1100 – NACH dem ursprünglichen 1000-ms-Zeitpunkt des ERSTEN
    // Timers, aber VOR dem neuen (bei 600+1000=1600): bleibt sichtbar NUR,
    // wenn der alte Timer korrekt gecleart wurde.
    act(() => { vi.advanceTimersByTime(500); });
    expect(container.textContent).toContain("wird geöffnet …");

    // Restliche Zeit bis zum NEUEN Timer (500 ms mehr = insgesamt 1000 ms
    // nach dem zweiten Klick) – jetzt verschwindet das Feedback.
    act(() => { vi.advanceTimersByTime(500); });
    expect(container.textContent).not.toContain("wird geöffnet");
  });

  // v7.39, Auftrag Punkt 3: bei einem UNC-Ziel liefert buildProtocolUrl
  // null, href bleibt die file:-URL, ein Klick öffnet aus dem https-Kontext
  // heraus NACHWEISLICH nichts – "wird geöffnet …" wäre hier eine
  // Falschaussage und bleibt deshalb unterdrückt.
  it("bei einem UNC-Ziel (buildProtocolUrl liefert null) wird KEIN Feedback angezeigt – es öffnet sich nachweislich nichts", () => {
    mount("# T\n\n## A\n\n[Datei](file://server/share/datei.md)");
    const link = container.querySelector("a");
    act(() => {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(container.textContent).not.toContain("wird geöffnet");
  });
});

// Direkt-Navigation statt Iframe-Trigger (v7.36, siehe DECISIONS #79
// "Review-Nachbesserung 5" für den Live-Befund, der diesen Wechsel
// ausgelöst hat): Die frühere Iframe-Trigger-Mechanik (v7.35,
// triggerProtocolOpen) ist ERSATZLOS entfernt – href IST jetzt direkt die
// Protokoll-URL (Laufwerkspfad) bzw. bleibt die file:-URL (UNC-Ziel), ein
// Klick ist eine ganz normale Top-Level-Navigation, kein JS-Trigger mehr
// nötig. Die reinen HTML-Assertions (href-Wert für Laufwerks-/UNC-Fall,
// title bleibt der Backslash-Pfad) stehen bereits im Block "DocView:
// file:-Links" oben (renderToStaticMarkup deckt das ab, keine echte
// Interaktion nötig) – hier zusätzlich per ECHTEM DOM/Klick verifiziert,
// dass genau dieselbe href auch im interaktiv gemounteten Baum ankommt und
// die Klick-Mechanik (kein preventDefault, kein window.open) dabei
// unverändert funktioniert. Clipboard-Assertions (v7.31-v7.38) entfernt,
// siehe Block oben für die aktive Pin-Gegenprobe.
describe("FileLink: href ist die Protokoll-URL, Klick navigiert direkt (v7.36)", () => {
  let container;
  let root;

  const mount = (md) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <DocView text={md} collapsed={{}} onToggle={() => {}} imgMap={{}} onImgClick={() => {}} onToggleTask={() => {}} />
      );
    });
  };

  afterEach(() => {
    if (root) act(() => root.unmount());
    if (container) container.remove();
    root = null;
    container = null;
    vi.useRealTimers();
  });

  it("ein Laufwerks-Pfad-Link hat als href direkt die notizbuch-open-Kontrakt-URL (kein Iframe/JS-Trigger nötig)", () => {
    mount("# T\n\n## A\n\n[Bericht](file:///C:/Users/x/Mein%20Bericht.docx)");
    const link = container.querySelector("a");
    expect(link.getAttribute("href")).toBe(
      "notizbuch-open:v1?path=C%3A%5CUsers%5Cx%5CMein%20Bericht.docx"
    );
    // title bleibt der lesbare Backslash-Pfad (der href ist es nicht mehr):
    expect(link.getAttribute("title")).toBe("C:\\Users\\x\\Mein Bericht.docx");

    act(() => {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    // Keine Iframe-Mechanik mehr vorhanden:
    expect(document.querySelectorAll("iframe").length).toBe(0);
  });

  it("ein UNC-Ziel behält href als file:-URL (buildProtocolUrl liefert null)", () => {
    mount("# T\n\n## A\n\n[Datei](file://server/share/datei.md)");
    const link = container.querySelector("a");
    expect(link.getAttribute("href")).toBe("file://server/share/datei.md");
  });

  it("KEIN preventDefault bei einem Laufwerks-Pfad-Link: die Navigation zur Protokoll-URL wird nicht unterbunden", () => {
    mount("# T\n\n## A\n\n[Bericht](file:///C:/Users/x/Bericht.docx)");
    const link = container.querySelector("a");
    const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      link.dispatchEvent(evt);
    });
    expect(evt.defaultPrevented).toBe(false);
  });

  it("KEIN window.open (kein Popup-Blocker-Konflikt, kein neuer Tab) – der Klick löst nur die normale <a>-Navigation aus", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    mount("# T\n\n## A\n\n[Bericht](file:///C:/Users/x/Bericht.docx)");
    const link = container.querySelector("a");
    act(() => {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(openSpy).not.toHaveBeenCalled();
  });
});

// v7.44, Thema 1 (Nutzerwunsch "Umbrüche und Aufzählungen in
// Tabellenzellen wäre aber schon schön…"). Der EDITOR serialisiert einen
// harten Zeilenumbruch in einer Tabellenzelle bereits als "<br>" (siehe
// tests/docEditorTableBreaks.test.jsx für den Beleg über die volle Kette)
// – die Lücke war ausschließlich dieser Renderer, der "<br>" bisher
// nirgends kannte. splitCellLines ist die reine Split-Funktion dahinter,
// direkt getestet (kein Umweg über gerendertes HTML).
describe("splitCellLines (v7.44): <br>-Erkennung in Tabellenzellen", () => {
  it("ohne jedes <br> liefert genau EIN Element, byte-identisch zum Original (Regressionsschutz für normale Zellen)", () => {
    expect(splitCellLines("Normaler Zelltext ohne Umbruch")).toEqual(["Normaler Zelltext ohne Umbruch"]);
    expect(splitCellLines("")).toEqual([""]);
  });

  it("trennt an <br>, <br/> und <br /> gleichermaßen", () => {
    expect(splitCellLines("Zeile1<br>Zeile2")).toEqual(["Zeile1", "Zeile2"]);
    expect(splitCellLines("Zeile1<br/>Zeile2")).toEqual(["Zeile1", "Zeile2"]);
    expect(splitCellLines("Zeile1<br />Zeile2")).toEqual(["Zeile1", "Zeile2"]);
  });

  it("case-insensitiv (robust gegenüber von Hand editiertem/eingefügtem Markdown)", () => {
    expect(splitCellLines("Zeile1<BR>Zeile2")).toEqual(["Zeile1", "Zeile2"]);
    expect(splitCellLines("Zeile1<Br/>Zeile2")).toEqual(["Zeile1", "Zeile2"]);
  });

  it("zwei aufeinanderfolgende <br> ergeben eine leere Zwischenzeile (kein Verschlucken)", () => {
    expect(splitCellLines("A<br><br>B")).toEqual(["A", "", "B"]);
  });

  it("mehrere Aufzählungspunkte UND ein abschließender Text werden alle als eigene Zeilen erkannt", () => {
    expect(splitCellLines("Text<br>- eins<br>- zwei<br>Ende")).toEqual(["Text", "- eins", "- zwei", "Ende"]);
  });

  it('ein "<br>" INNERHALB eines Codespans bleibt Literaltext (kein Split)', () => {
    expect(splitCellLines("`a<br>b`")).toEqual(["`a<br>b`"]);
    // Codespan schützt nur seinen EIGENEN Inhalt – ein <br> DANACH splittet weiterhin.
    expect(splitCellLines("`a<br>b`<br>Rest")).toEqual(["`a<br>b`", "Rest"]);
  });

  it('ein "<br>" INNERHALB einer Formel ($…$/$$…$$) bleibt Literaltext (kein Split)', () => {
    expect(splitCellLines("$a<br>b$")).toEqual(["$a<br>b$"]);
    expect(splitCellLines("$$a<br>b$$")).toEqual(["$$a<br>b$$"]);
  });

  it('ein "<br>" INNERHALB eines Farb-/Marker-Spans bleibt geschützt (kein kaputtes Tag durch Auftrennen)', () => {
    const withSpan = '<span style="color:#dc2626">Zeile1<br>Zeile2</span>';
    expect(splitCellLines(withSpan)).toEqual([withSpan]);
    const withMark = '<mark data-color="#fff59d">A<br>B</mark>';
    expect(splitCellLines(withMark)).toEqual([withMark]);
    // Ein <br> AUSSERHALB des Spans splittet weiterhin normal.
    expect(splitCellLines('<span style="color:#111">A</span><br>B')).toEqual([
      '<span style="color:#111">A</span>',
      "B",
    ]);
  });

  it("ein unbekanntes/kaputtes Tag ohne Gegenstück blockiert das Splitten NICHT (fällt in den Default-Zweig)", () => {
    // "<span" ohne schließendes "</span>" im Rest der Zelle: findClose
    // liefert -1, der Text läuft normal weiter, ein nachfolgendes <br>
    // splittet trotzdem ganz normal (renderInline zeigt das kaputte Tag
    // später ohnehin literal, siehe dort).
    expect(splitCellLines('<span style="color:#111">A<br>B')).toEqual([
      '<span style="color:#111">A',
      "B",
    ]);
  });
});

describe("Tabellenzellen: Umbrüche und Aufzählungen werden gerendert (v7.44)", () => {
  it("ein einzelner Umbruch erzeugt einen echten <br/>, kein Literaltext", () => {
    const html = render("# T\n\n## A\n\n| Spalte |\n|---|\n| Zeile1<br>Zeile2 |");
    expect(html).toMatch(/<br\s*\/?>/);
    expect(html).not.toContain("&lt;br&gt;");
    expect(html).toContain("Zeile1");
    expect(html).toContain("Zeile2");
  });

  it("eine bestehende Zelle OHNE <br> rendert weiterhin unverändert (kein Wrapper, keine Regression)", () => {
    const html = render("# T\n\n## A\n\n| Spalte |\n|---|\n| Normaler Text |");
    expect(html).toContain("Normaler Text");
    expect(html).not.toMatch(/<br\s*\/?>/);
    expect(html).not.toMatch(/<ul[^>]*>/);
  });

  it('mit "- " beginnende, durch <br> getrennte Zeilen werden zu einer kompakten <ul>', () => {
    const html = render("# T\n\n## A\n\n| Spalte |\n|---|\n| Text<br>- eins<br>- zwei |");
    expect(html).toMatch(/<ul[^>]*class="[^"]*list-disc[^"]*"[^>]*>/);
    expect(html).toContain("<li");
    expect(html).toContain("eins");
    expect(html).toContain("zwei");
    // Genau zwei Listenpunkte, kein dritter aus dem einleitenden "Text".
    expect((html.match(/<li[^>]*>/g) || []).length).toBe(2);
  });

  it('"* " wird als Aufzählung genauso erkannt wie "- " (dieselbe UL_RE wie im Block-Renderer)', () => {
    const html = render("# T\n\n## A\n\n| Spalte |\n|---|\n| Text<br>* eins<br>* zwei |");
    expect(html).toMatch(/<ul[^>]*>/);
    expect((html.match(/<li[^>]*>/g) || []).length).toBe(2);
  });

  it("nummerierte Zeilen (1. / 2. …) werden zu einer <ol>, Start-Nummer wird respektiert", () => {
    const html = render("# T\n\n## A\n\n| Spalte |\n|---|\n| Text<br>5. Fuenf<br>6. Sechs |");
    expect(html).toMatch(/<ol[^>]*start="5"[^>]*>/);
    expect((html.match(/<li[^>]*>/g) || []).length).toBe(2);
  });

  it("eine bei 1 beginnende Nummerierung bekommt KEIN start-Attribut (Normalfall, wie im Block-Renderer)", () => {
    const html = render("# T\n\n## A\n\n| Spalte |\n|---|\n| 1. eins<br>2. zwei |");
    expect(html).toMatch(/<ol[^>]*>/);
    expect(html).not.toMatch(/<ol[^>]*start=/);
  });

  it("gemischter Inhalt: Text, Umbruch, zwei Aufzählungspunkte, Codespan – alles in einer Zelle", () => {
    const html = render("# T\n\n## A\n\n| Spalte |\n|---|\n| Einleitung<br>- Punkt mit `code`<br>- zweiter Punkt |");
    expect(html).toContain("Einleitung");
    expect(html).toMatch(/<ul[^>]*>/);
    expect(html).toMatch(/<code[^>]*>code<\/code>/);
    expect(html).toContain("zweiter Punkt");
  });

  it("eine Zelle mit escaptem Pipe-Zeichen UND Umbruch/Aufzählung: Pipe bleibt sichtbar, Tabelle zerreißt nicht", () => {
    const html = render("# T\n\n## A\n\n| Spalte |\n|---|\n| A\\|B<br>- eins<br>- zwei |");
    expect(html).toContain("A|B");
    expect(html).toMatch(/<ul[^>]*>/);
    expect(html).toContain("eins");
    expect(html).toContain("zwei");
    // Nur EINE Tabelle mit EINER Datenzeile – ein zerrissenes Pipe hätte
    // eine zusätzliche Spalte/Zeile erzeugt.
    expect((html.match(/<tbody>/g) || []).length).toBe(1);
    expect((html.match(/<tr>/g) || []).length).toBe(2); // Header + eine Datenzeile
  });

  it('ein "<br>" INNERHALB eines Codespans bleibt in der ANSICHT Literaltext (kein Zeilenumbruch, kein Absturz)', () => {
    const html = render("# T\n\n## A\n\n| Spalte |\n|---|\n| `a<br>b` |");
    expect(html).toMatch(/<code[^>]*>a&lt;br&gt;b<\/code>/);
  });

  it('ein "<br>" INNERHALB einer Formel bleibt in der ANSICHT Teil des TeX-Quelltexts (kein Split, kein zweites <td>)', () => {
    const html = render("# T\n\n## A\n\n| Spalte |\n|---|\n| $a<br>b$ |");
    expect(html).toContain("application/x-tex");
    expect((html.match(/<td[^>]*>/g) || []).length).toBe(1);
  });
});
