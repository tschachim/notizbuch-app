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
