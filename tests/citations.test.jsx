import { describe, it, expect } from "vitest";
import { renderWithCites, stripCiteTags, citeTagsToDocLinks } from "../src/lib/citations.jsx";

const SOURCES = [
  { url: "https://a.de/x", title: "Quelle A" },
  { url: "https://b.de/y", title: "Quelle B" },
  { url: "https://a.de/x", title: "Quelle A (Duplikat)" }, // Trefferliste ist bewusst NICHT dedupliziert
];

const textOf = (nodes) => nodes.filter((n) => typeof n === "string").join("");
const sups = (nodes) => nodes.filter((n) => n && n.type === "sup");

describe("renderWithCites", () => {
  it("macht aus cite-Tags Text + hochgestellte Links und dedupliziert Fußnoten per URL", () => {
    const { nodes, footnotes } = renderWithCites(
      'Fakt <cite index="1">eins</cite> und <cite index="3">nochmal A</cite> und <cite index="2">zwei</cite>.',
      SOURCES
    );
    expect(textOf(nodes)).toBe("Fakt eins und nochmal A und zwei.");
    // Index 1 und 3 zeigen auf dieselbe URL → gleiche Fußnote [1]
    expect(footnotes).toHaveLength(2);
    expect(footnotes[0]).toMatchObject({ num: 1, url: "https://a.de/x" });
    expect(footnotes[1]).toMatchObject({ num: 2, url: "https://b.de/y" });
    const links = sups(nodes).map((s) => s.props.children.props.href);
    expect(links).toEqual(["https://a.de/x", "https://a.de/x", "https://b.de/y"]);
  });

  it("kommagetrennte Indizes ergeben mehrere Fußnoten am selben Tag", () => {
    const { nodes, footnotes } = renderWithCites('A <cite index="1,2">belegt</cite>.', SOURCES);
    expect(sups(nodes)).toHaveLength(2);
    expect(footnotes.map((f) => f.url)).toEqual(["https://a.de/x", "https://b.de/y"]);
  });

  it("unauflösbare Indizes, kaputte Tags und Waisen leaken nie als Rohmarkup", () => {
    const { nodes, footnotes } = renderWithCites(
      'a <cite index="99">ohne Quelle</cite> b </cite> c <cite>ohne index</cite> d <cite index="">leer</cite>',
      SOURCES
    );
    const t = textOf(nodes);
    expect(t).toContain("ohne Quelle");
    expect(t).toContain("ohne index");
    expect(t).not.toMatch(/<\/?cite/);
    expect(footnotes).toHaveLength(0);
  });

  it("verlinkt keine javascript:-URLs (Defense-in-Depth)", () => {
    const { footnotes } = renderWithCites('x <cite index="1">y</cite>', [
      { url: "javascript:alert(1)", title: "Böse" },
    ]);
    expect(footnotes).toHaveLength(0);
  });

  it("Fußnoten-Links öffnen extern mit rel-Schutz", () => {
    const { nodes } = renderWithCites('x <cite index="1">y</cite>', SOURCES);
    const a = sups(nodes)[0].props.children.props;
    expect(a.target).toBe("_blank");
    expect(a.rel).toContain("noopener");
  });

  it("Text ohne Tags bleibt unverändert", () => {
    const { nodes, footnotes } = renderWithCites("Nur Text, 100 % harmlos.", SOURCES);
    expect(textOf(nodes)).toBe("Nur Text, 100 % harmlos.");
    expect(footnotes).toHaveLength(0);
  });
});

describe("stripCiteTags", () => {
  it("entfernt alle Tag-Varianten, behält den Inhalt", () => {
    expect(stripCiteTags('a <cite index="1">b</cite> c <cite foo="x" index="2">d</cite> </cite>'))
      .toBe("a b c d ");
  });
  it("lässt Nicht-Strings unangetastet", () => {
    expect(stripCiteTags(null)).toBe(null);
    expect(stripCiteTags(42)).toBe(42);
  });
});

describe("citeTagsToDocLinks", () => {
  it("ersetzt Tags durch [0](url)-Platzhalter direkt hinter der Aussage", () => {
    const out = citeTagsToDocLinks('- Steak <cite index="2">56 °C</cite> garen', SOURCES);
    expect(out).toBe("- Steak 56 °C[0](https://b.de/y) garen");
  });

  it("setzt den Marker VOR abschließenden Weißraum der markierten Stelle", () => {
    const out = citeTagsToDocLinks('- <cite index="1">Fakt.\n</cite>', SOURCES);
    expect(out).toBe("- Fakt.[0](https://a.de/x)\n");
  });

  it("mehrere Indizes ergeben mehrere Marker, unauflösbare werden gestrippt", () => {
    expect(citeTagsToDocLinks('<cite index="1,2">x</cite>', SOURCES))
      .toBe("x[0](https://a.de/x)[0](https://b.de/y)");
    expect(citeTagsToDocLinks('<cite index="99">x</cite>', SOURCES)).toBe("x");
    expect(citeTagsToDocLinks('<cite index="1">x</cite>', [])).toBe("x");
  });

  it("ohne Quellenliste bleiben normale Inhalte byte-identisch", () => {
    const md = "## A\n\n- normaler Eintrag mit [1](https://x.de) Fußnote";
    expect(citeTagsToDocLinks(md, [])).toBe(md);
  });

  it("v7.7: ein Fenced-Codeblock im op-Inhalt bleibt byte-identisch erhalten (kein cite-Tag darin)", () => {
    // cite-Tags markieren laut System-Prompt ausschließlich recherchierte
    // AUSSAGEN, nie Code – ein Codeblock im selben op-Inhalt darf trotzdem
    // nicht angefasst werden, wenn er neben einer echten Zitat-Stelle steht.
    const md = 'Vorher <cite index="1">56 °C Kerntemperatur</cite>.\n\n```bash\necho "$HOME"\n```';
    const out = citeTagsToDocLinks(md, SOURCES);
    expect(out).toContain("```bash\necho \"$HOME\"\n```");
    expect(out).toContain("56 °C Kerntemperatur[0](https://a.de/x)");
    expect(out).not.toContain("<cite");
  });
});

// C3-Nachlauf (v7.54, E2E-Fund v7.53): das Modell schrieb den Zitat-Marker
// vereinzelt mit runder statt spitzer Klammer UND ohne Schluss-Tag - Rohmarkup
// blieb im Chat sichtbar (das Dokument war korrekt, dort landet derselbe Text
// über citeTagsToDocLinks). Modellvarianz, kein Code-Typo im Bestand (siehe
// citations.jsx-Kopfkommentar/DECISIONS #112).
describe("Toleranz gegen Klammer-Variante (C3, v7.54)", () => {
  // Fixture EXAKT aus dem Vorfall (byteweise verifiziert: "(" = 0x28, kein
  // Schluss-Tag nach dem ersten ODER zweiten Marker).
  const INCIDENT_TEXT =
    'Der Eiffelturm ist heute (cite index="1">330 Meter hoch, seitdem 2022 die Antenne per Hubschrauber ausgetauscht wurde. Ohne die Antenne misst die reine Eisenkonstruktion (cite index="2">300,65 Meter.';
  const TWO_SOURCES = [
    { url: "https://a.example/turm", title: "Quelle A" },
    { url: "https://b.example/turm", title: "Quelle B" },
  ];

  it("renderWithCites: kein rohes (cite/<cite mehr in den Text-Knoten, ZWEI Fußnoten", () => {
    const { nodes, footnotes } = renderWithCites(INCIDENT_TEXT, TWO_SOURCES);
    for (const n of nodes) {
      if (typeof n === "string") expect(n).not.toMatch(/[<(]cite/);
    }
    const t = textOf(nodes);
    expect(t).toBe(
      "Der Eiffelturm ist heute 330 Meter hoch, seitdem 2022 die Antenne per Hubschrauber ausgetauscht wurde. Ohne die Antenne misst die reine Eisenkonstruktion 300,65 Meter."
    );
    expect(footnotes).toHaveLength(2);
    expect(footnotes[0]).toMatchObject({ num: 1, url: "https://a.example/turm" });
    expect(footnotes[1]).toMatchObject({ num: 2, url: "https://b.example/turm" });
  });

  it("Fußnote 1 endet vor dem zweiten Marker (der Text-Knoten VOR der ersten Fußnote enthält NICHT die zweite Aussage)", () => {
    const { nodes } = renderWithCites(INCIDENT_TEXT, TWO_SOURCES);
    const firstSupIdx = nodes.findIndex((n) => n && n.type === "sup");
    expect(firstSupIdx).toBeGreaterThan(-1);
    const textBeforeFirstSup = nodes.slice(0, firstSupIdx).filter((n) => typeof n === "string").join("");
    expect(textBeforeFirstSup).toContain("330 Meter hoch");
    expect(textBeforeFirstSup).not.toContain("300,65 Meter");
  });

  it("stripCiteTags erkennt die Klammer-Form", () => {
    const out = stripCiteTags(INCIDENT_TEXT);
    expect(out).not.toMatch(/[<(]cite/);
    expect(out).toContain("330 Meter hoch");
    expect(out).toContain("300,65 Meter.");
  });

  it("Regression: korrekt geschlossene <cite>-Form bleibt unverändert funktionsfähig", () => {
    const { nodes, footnotes } = renderWithCites(
      'Fakt <cite index="1">eins</cite> und <cite index="2">zwei</cite>.',
      TWO_SOURCES
    );
    expect(textOf(nodes)).toBe("Fakt eins und zwei.");
    expect(footnotes).toHaveLength(2);
  });

  it("citeTagsToDocLinks: Dokument-Fußnoten [0](url) auch bei Klammer-Form/fehlendem Schluss-Tag, zweiter Marker nicht verschluckt", () => {
    const out = citeTagsToDocLinks(INCIDENT_TEXT, TWO_SOURCES);
    expect(out).not.toMatch(/[<(]cite/);
    expect(out).toContain("Eisenkonstruktion[0](https://a.example/turm)");
    expect(out).toContain("300,65 Meter.[0](https://b.example/turm)");
    // beide Marker wurden aufgelöst, keiner verschluckt die andere Quelle
    expect((out.match(/\[0\]/g) || []).length).toBe(2);
  });

  it("Sicherheit: normale Prosa mit runden Klammern bleibt unangetastet, kein ')' wird als Schluss gewertet", () => {
    const prose = "Der Wert steht schon im Notizbuch (siehe oben) und ändert sich nicht.";
    expect(stripCiteTags(prose)).toBe(prose);
    const { nodes, footnotes } = renderWithCites(prose, TWO_SOURCES);
    expect(textOf(nodes)).toBe(prose);
    expect(footnotes).toHaveLength(0);
    expect(citeTagsToDocLinks(prose, TWO_SOURCES)).toBe(prose);
  });
});

// Nacharbeit Runde 4 (🟡 Finding B, Review-Fund): die runde Öffner-Variante
// verlangte in stripCiteTags bisher KEIN "index=" und stoppte erst am
// NÄCHSTEN ">" irgendwo im String, nicht nur direkt hinter "cite" - Prosa mit
// einer harmlosen runden Klammer, gefolgt (irgendwo später) von einem "größer
// als"-Zeichen, verlor dadurch den kompletten Text dazwischen. stripCiteTags
// läuft auf JEDEM op.content (auch OHNE Websuche, anthropic.js), der History
// UND dem Archiv - kein Rand-, sondern ein echter Datenverlustpfad. Die drei
// Fixtures decken die drei Auslöser ab: ein Satzende-">" (Vergleichszeichen
// in Prosa), ein Blockquote-"> " nach "cited" (KEIN Leerzeichen zwischen
// "cite" und dem Rest, matcht OPEN_RE/STRIP_ROUND_OPEN_RE deshalb schon
// strukturell nicht) und ein Doppelpunkt statt "index=" ("(cite: …)").
describe("stripCiteTags-Blast-Radius: runde Klammer OHNE index=\"…\" bleibt unangetastet (Finding B, Nacharbeit Runde 4)", () => {
  const PROSE_FIXTURES = [
    "Wir nutzen (cite) als Kürzel. 3 > 2 gilt.",
    '(cited in Meier 2020)\n> Zitat',
    "(cite: Meier 2020)",
  ];

  it.each(PROSE_FIXTURES)("stripCiteTags: byteidentisch – %s", (text) => {
    expect(stripCiteTags(text)).toBe(text);
  });

  it.each(PROSE_FIXTURES)("citeTagsToDocLinks: byteidentisch (ohne Quellen) – %s", (text) => {
    expect(citeTagsToDocLinks(text, [])).toBe(text);
  });

  it.each(PROSE_FIXTURES)("renderWithCites: Text-Knoten byteidentisch, keine Fußnoten – %s", (text) => {
    const { nodes, footnotes } = renderWithCites(text, SOURCES);
    expect(textOf(nodes)).toBe(text);
    expect(footnotes).toHaveLength(0);
  });

  // Das Vorfalls-Fixture (C3-Nachlauf, oben) bleibt von diesem Fix
  // unberührt: "(cite index=\"1\">" trägt weiterhin explizit "index=", die
  // STRIP_ROUND_OPEN_RE-Regel greift dort unverändert (siehe die 19
  // bestehenden Tests in diesem File).
});

// Nacharbeit Runde 4 (🔵 Finding E, Review-Fund): ein erstes, UNGESCHLOSSENES
// cite gefolgt von einem zweiten, geschlossenen cite ließ "nextOpen" bisher
// nur berechnen, wenn GAR KEIN "</cite>" existierte - lag ein "</cite>" (das
// eigentlich zum ZWEITEN Zitat gehört) VOR der eigentlichen Grenze, wurde es
// fälschlich dem ERSTEN zugeschlagen; das zweite Öffner-Tag blieb als
// Rohtext im ersten Zitat-Inhalt stecken, dessen Quelle wurde nie aufgelöst.
describe("Verschachtelte cites: erstes ungeschlossen, zweites geschlossen (Finding E, Nacharbeit Runde 4)", () => {
  const THREE_SOURCES = [
    { url: "https://a.example/quelle-eins", title: "Quelle Eins" },
    { url: "https://b.example/ungenutzt", title: "Quelle Zwei (ungenutzt)" },
    { url: "https://c.example/quelle-drei", title: "Quelle Drei" },
  ];
  const NESTED_TEXT = 'A (cite index="1">eins (cite index="3">drei</cite> Rest.';

  it("renderWithCites: BEIDE Quellen werden Fußnoten (1 und 3), keine wird verschluckt", () => {
    const { nodes, footnotes } = renderWithCites(NESTED_TEXT, THREE_SOURCES);
    expect(textOf(nodes)).toBe("A eins drei Rest.");
    expect(footnotes).toHaveLength(2);
    expect(footnotes[0]).toMatchObject({ num: 1, url: "https://a.example/quelle-eins" });
    expect(footnotes[1]).toMatchObject({ num: 2, url: "https://c.example/quelle-drei" });
    expect(sups(nodes)).toHaveLength(2);
  });

  it("Regressionsschutz: der Text-Knoten VOR der ersten Fußnote enthält NICHT 'drei' (zweite Quelle nicht verschluckt)", () => {
    const { nodes } = renderWithCites(NESTED_TEXT, THREE_SOURCES);
    const firstSupIdx = nodes.findIndex((n) => n && n.type === "sup");
    expect(firstSupIdx).toBeGreaterThan(-1);
    const textBeforeFirstSup = nodes.slice(0, firstSupIdx).filter((n) => typeof n === "string").join("");
    expect(textBeforeFirstSup).toContain("eins");
    expect(textBeforeFirstSup).not.toContain("drei");
  });

  it("citeTagsToDocLinks: beide Quellen als [0](url), keine verschluckt", () => {
    const out = citeTagsToDocLinks(NESTED_TEXT, THREE_SOURCES);
    expect(out).not.toMatch(/[<(]cite/);
    expect(out).toContain("eins[0](https://a.example/quelle-eins)");
    expect(out).toContain("drei[0](https://c.example/quelle-drei)");
    expect((out.match(/\[0\]/g) || []).length).toBe(2);
  });
});

// Nacharbeit Runde 5 (🟡 N1, Review-Fund): OPEN_RE war für die RUNDE
// Öffner-Variante bisher lax (ein gemeinsames "[^>]*" für BEIDE
// Öffner-Zeichen, siehe Kopfkommentar in citations.jsx) und lief bis zum
// NÄCHSTEN ">" irgendwo im restlichen Fließtext - ein Modell-Typo mit
// strayer ")" direkt nach dem index-Attribut fraß dadurch Dokumenttext bis
// zu einem völlig unbeteiligten ">" (Blockquote-Zeichen ODER
// Vergleichszeichen). renderWithCites/citeTagsToDocLinks nutzen OPEN_RE
// DIREKT (nicht die bereits in Runde 4 geschärfte STRIP_ROUND_OPEN_RE) - der
// Runde-4-Fix deckte deshalb nur stripCiteTags ab. Seit Runde 5 ist die
// runde Variante in OPEN_RE selbst genauso streng: ein solches
// verstümmeltes Tag matcht gar nicht mehr und bleibt komplett unangetastet
// (byte-identisch in allen drei Funktionen, keine Fußnote).
describe("OPEN_RE-Härtung der runden Variante: verstümmeltes Tag bleibt unangetastet (Finding N1, Nacharbeit Runde 5)", () => {
  const N1_SOURCES = [
    { url: "https://a.example/turm", title: "Quelle A" },
    { url: "https://b.example/turm", title: "Quelle B" },
  ];
  const N1_PROBES = [
    // stray ")" direkt nach index="1", danach folgt normaler Text, dann ein
    // Blockquote-"> " in einer NEUEN Zeile - verschluckte bisher alles
    // dazwischen bis zu diesem ">".
    'Der Turm ist (cite index="1") 330 Meter hoch.\n> Zitat danach',
    // stray ")" direkt nach index="1", danach ein Vergleichszeichen "3 > 2"
    // im SELBEN Satz - verschluckte bisher den Rest bis dorthin.
    'Wert (cite index="1")330 Meter. 3 > 2 gilt.',
    // Kombinierte Variante aus dem Finding-Text: stray ")" + Zeilenumbruch +
    // Blockquote direkt danach, ohne weiteren Text dazwischen.
    '(cite index="1") 330 Meter\n> Zitat',
  ];

  it.each(N1_PROBES)("stripCiteTags: byteidentisch – %s", (text) => {
    expect(stripCiteTags(text)).toBe(text);
  });

  it.each(N1_PROBES)("citeTagsToDocLinks: byteidentisch – %s", (text) => {
    expect(citeTagsToDocLinks(text, N1_SOURCES)).toBe(text);
  });

  it.each(N1_PROBES)("renderWithCites: Text-Knoten byteidentisch, keine Fußnoten – %s", (text) => {
    const { nodes, footnotes } = renderWithCites(text, N1_SOURCES);
    expect(textOf(nodes)).toBe(text);
    expect(footnotes).toHaveLength(0);
  });

  // Regressionsschutz: das C3-Vorfalls-Fixture (wohlgeformtes rundes Tag,
  // ">" DIREKT hinter dem index-Attribut, siehe "Toleranz gegen
  // Klammer-Variante" oben) bleibt von der Verschärfung unberührt - das ist
  // bereits durch die 19+ bestehenden Tests in dieser Datei abgedeckt, hier
  // nur ein zusätzlicher, expliziter Beleg direkt neben den N1-Sonden.
  it("Regression: wohlgeformtes rundes Tag (direktes '>' nach index=) löst weiterhin eine Fußnote aus", () => {
    const { nodes, footnotes } = renderWithCites('Fakt (cite index="1">belegt</cite>.', N1_SOURCES);
    expect(textOf(nodes)).toBe("Fakt belegt.");
    expect(footnotes).toHaveLength(1);
  });
});
