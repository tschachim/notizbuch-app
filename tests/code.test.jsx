import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  FENCE_OPEN_RE, FENCE_CLOSE_RE, matchFenceBlock, splitFenceSegments,
  CodeBlockView, expandFencedCodeInNodes,
} from "../src/lib/code.jsx";
import { renderMathText, expandMathInNodes } from "../src/lib/math.jsx";

const html = (nodes) => renderToStaticMarkup(<>{nodes}</>);

describe("FENCE_OPEN_RE / FENCE_CLOSE_RE", () => {
  it("erkennt öffnende Zäune mit und ohne Sprach-Label", () => {
    expect(FENCE_OPEN_RE.test("```")).toBe(true);
    expect(FENCE_OPEN_RE.test("```js")).toBe(true);
    expect(FENCE_OPEN_RE.test("```bash")).toBe(true);
  });

  it("erkennt vier oder mehr Backticks als Zaun (Re-Review-Fix K1)", () => {
    expect(FENCE_OPEN_RE.test("````")).toBe(true);
    expect(FENCE_OPEN_RE.test("````js")).toBe(true);
    expect(FENCE_OPEN_RE.test("`````")).toBe(true);
  });

  it("erlaubt Leerzeichen im Info-String (CommonMark-legal, Re-Review-Fix W1 – vorher fälschlich abgelehnt)", () => {
    expect(FENCE_OPEN_RE.test("```python title=x")).toBe(true);
    expect(FENCE_OPEN_RE.test("```js and more")).toBe(true);
  });

  it("lehnt einen Backtick IM Info-String ab (CommonMark: Backticks sind dort verboten)", () => {
    expect(FENCE_OPEN_RE.test("```js`kaputt")).toBe(false);
  });

  it("erkennt normale Zeilen NICHT als Zaun", () => {
    expect(FENCE_OPEN_RE.test("normaler Text")).toBe(false);
    expect(FENCE_OPEN_RE.test("`inline`")).toBe(false);
    expect(FENCE_OPEN_RE.test("``")).toBe(false);
  });

  it("toleriert bis zu drei Leerzeichen Einrückung, lehnt vier Leerzeichen ODER einen Tab ab (Re-Review-Fix W2 – CommonMark-Grenze identisch zu markdown-it)", () => {
    expect(FENCE_OPEN_RE.test("   ```js")).toBe(true); // 3 Spaces: noch ein Zaun
    expect(FENCE_OPEN_RE.test("    ```js")).toBe(false); // 4 Spaces: eingerückter Codeblock für markdown-it
    expect(FENCE_OPEN_RE.test("\t```js")).toBe(false); // Tab: ebenfalls eingerückter Codeblock
  });

  it("FENCE_CLOSE_RE matcht nur reine Backtick-Zeilen (Grundform, ohne Längenprüfung)", () => {
    expect(FENCE_CLOSE_RE.test("```")).toBe(true);
    expect(FENCE_CLOSE_RE.test("````")).toBe(true);
    expect(FENCE_CLOSE_RE.test("```js")).toBe(false);
    expect(FENCE_CLOSE_RE.test("Text ```")).toBe(false);
    expect(FENCE_CLOSE_RE.test("\t```")).toBe(false); // dieselbe Tab-Grenze wie beim öffnenden Zaun
  });
});

describe("matchFenceBlock", () => {
  it("findet einen einfachen Block mit Sprach-Label", () => {
    const r = matchFenceBlock(["```js", "const x = 1;", "```"], 0);
    expect(r).toEqual({ lang: "js", code: "const x = 1;", endIdx: 2 });
  });

  it("findet einen Block ohne Sprach-Label", () => {
    const r = matchFenceBlock(["```", "plain", "```"], 0);
    expect(r).toEqual({ lang: "", code: "plain", endIdx: 2 });
  });

  it("Info-String mit Leerzeichen: nur das ERSTE Wort wird als Sprach-Label übernommen (wie markdown-it, Re-Review-Fix W1/P2)", () => {
    const r = matchFenceBlock(["```python title=x", "code", "```"], 0);
    expect(r).toEqual({ lang: "python", code: "code", endIdx: 2 });
  });

  it("sammelt mehrzeiligen Inhalt inkl. Leerzeilen", () => {
    const r = matchFenceBlock(["```py", "a", "", "b", "```"], 0);
    expect(r).toEqual({ lang: "py", code: "a\n\nb", endIdx: 4 });
  });

  it("ein leerer Codeblock (Zaun direkt gefolgt vom Schluss-Zaun) liefert leeren String", () => {
    const r = matchFenceBlock(["```", "```"], 0);
    expect(r).toEqual({ lang: "", code: "", endIdx: 1 });
  });

  it("unterminiert (kein schließender Zaun) liefert null statt den Rest zu verschlucken", () => {
    expect(matchFenceBlock(["```js", "a", "b", "c"], 0)).toBeNull();
  });

  it("eine Zeile ohne Zaun-Start liefert null", () => {
    expect(matchFenceBlock(["normaler Text"], 0)).toBeNull();
  });

  it("Leerzeilen/Überschriften INNERHALB des Blocks brechen die Suche NICHT ab (anders als matchDisplayBlock)", () => {
    const r = matchFenceBlock(["```bash", "## Kommentar-artige Zeile", "", "echo hi", "```"], 0);
    expect(r).toEqual({ lang: "bash", code: "## Kommentar-artige Zeile\n\necho hi", endIdx: 4 });
  });

  it("startIdx muss selbst FENCE_OPEN_RE erfüllen, sonst null", () => {
    expect(matchFenceBlock(["a", "```", "b", "```"], 0)).toBeNull();
  });

  describe("Re-Review-Fix K1: Schluss-Zaun muss MINDESTENS so lang sein wie der öffnende (CommonMark-Regel)", () => {
    it("ein 4-Backtick-Öffnungszaun wird NICHT von einer 3-Backtick-Zeile geschlossen – die zählt als Inhalt", () => {
      const r = matchFenceBlock(["````js", "Beispiel:", "```", "inner", "```", "````"], 0);
      expect(r).toEqual({ lang: "js", code: "Beispiel:\n```\ninner\n```", endIdx: 5 });
    });

    it("ein 4-Backtick-Öffnungszaun OHNE passenden 4+-Backtick-Schluss bis Dokumentende bleibt unterminiert", () => {
      const r = matchFenceBlock(["````js", "```", "nur 3 Backticks als Schluss verfügbar"], 0);
      expect(r).toBeNull();
    });

    it("ein LÄNGERER Schluss-Zaun als der öffnende ist zulässig", () => {
      const r = matchFenceBlock(["```js", "code", "`````"], 0);
      expect(r).toEqual({ lang: "js", code: "code", endIdx: 2 });
    });

    it("der ERSTE ausreichend lange Schluss-Zaun gewinnt (kein Weitersuchen über ihn hinaus)", () => {
      const r = matchFenceBlock(["```js", "a", "```", "b", "````"], 0);
      expect(r).toEqual({ lang: "js", code: "a", endIdx: 2 });
    });
  });
});

describe("splitFenceSegments", () => {
  const reconstruct = (text) => splitFenceSegments(text).map((s) => s.raw).join("\n");

  it("Text ohne Fence bleibt ein einziges Text-Segment", () => {
    const segs = splitFenceSegments("nur Text\nzweite Zeile");
    expect(segs).toEqual([{ code: false, raw: "nur Text\nzweite Zeile" }]);
  });

  it("ein einzelner Codeblock ohne umgebenden Text", () => {
    const segs = splitFenceSegments("```js\nx\n```");
    expect(segs).toEqual([{ code: true, lang: "js", text: "x", raw: "```js\nx\n```" }]);
  });

  it("Text, Codeblock, Text – Rekonstruktion ist byte-identisch", () => {
    const text = "a\n```python\nx\n```\nb";
    const segs = splitFenceSegments(text);
    expect(segs.map((s) => s.code)).toEqual([false, true, false]);
    expect(segs[1]).toMatchObject({ lang: "python", text: "x" });
    expect(reconstruct(text)).toBe(text);
  });

  it("zwei Codeblöcke hintereinander mit Text dazwischen – Rekonstruktion bleibt byte-identisch", () => {
    const text = "Vorher\n```js\na\n```\nZwischen\n```css\nb\n```\nNachher";
    expect(reconstruct(text)).toBe(text);
    const segs = splitFenceSegments(text);
    expect(segs.filter((s) => s.code)).toHaveLength(2);
  });

  it("unterminierter Zaun am Dokumentende bleibt Teil des Text-Segments (kein Verschlucken)", () => {
    const text = "Vorher\n```js\nkeine schließende Zeile";
    const segs = splitFenceSegments(text);
    expect(segs.every((s) => !s.code)).toBe(true);
    expect(reconstruct(text)).toBe(text);
  });

  it("leerer String liefert ein leeres Text-Segment", () => {
    expect(splitFenceSegments("")).toEqual([{ code: false, raw: "" }]);
  });

  it("Codeblock direkt am Dokumentanfang UND -ende (kein umgebender Text)", () => {
    const text = "```\nnur code\n```";
    expect(reconstruct(text)).toBe(text);
  });

  it("ein 4-Backtick-Zaun um Inhalt mit eigenen 3-Backtick-Zeilen wird als EIN Codeblock erkannt (K1-Szenario)", () => {
    const text = "````js\nBeispiel:\n```\ninner\n```\n````";
    const segs = splitFenceSegments(text);
    expect(segs).toEqual([
      { code: true, lang: "js", text: "Beispiel:\n```\ninner\n```", raw: text },
    ]);
    expect(reconstruct(text)).toBe(text);
  });
});

describe("CodeBlockView", () => {
  it("rendert den Code-Inhalt monospaced mit whitespace-pre und horizontalem Scroll-Container", () => {
    const out = html(<CodeBlockView lang="js" code={"const x = 1;\nconst y = 2;"} />);
    expect(out).toContain("const x = 1;");
    expect(out).toContain("const y = 2;");
    expect(out).toMatch(/<pre[^>]*whitespace-pre[^>]*>/);
    expect(out).toContain("overflow-x-auto");
    expect(out).toContain("font-mono");
  });

  it("zeigt das Sprach-Label an, wenn vorhanden", () => {
    const out = html(<CodeBlockView lang="bash" code="echo hi" />);
    expect(out).toContain("bash");
  });

  it("ohne Sprach-Label wird kein leeres Label-Element gerendert", () => {
    const out = html(<CodeBlockView lang="" code="x" />);
    const out2 = html(<CodeBlockView code="x" />);
    // Genau ein <pre>-Block, kein zusätzliches Label-<div>
    expect((out.match(/<div/g) || []).length).toBe(1);
    expect((out2.match(/<div/g) || []).length).toBe(1);
  });

  it("HTML-Sonderzeichen im Code werden nicht als Markup interpretiert (React escaped automatisch)", () => {
    const out = html(<CodeBlockView lang="html" code='<script>alert(1)</script>' />);
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("keine Zäune (```) sind im gerenderten Output sichtbar", () => {
    const out = html(<CodeBlockView lang="js" code="const x = 1;" />);
    expect(out).not.toContain("```");
  });
});

describe("expandFencedCodeInNodes (Chat-Segmentierer: erst Fences, dann Math auf den Nicht-Code-Segmenten)", () => {
  const mathExpand = (t) => expandMathInNodes([t]);

  it("Text ohne Codeblock läuft unverändert durch expandRest (Formeln funktionieren weiterhin)", () => {
    const out = expandFencedCodeInNodes(["Es gilt $x^2$ hier."], mathExpand);
    expect(html(out)).toContain("application/x-tex");
  });

  it("ein Fenced-Codeblock wird als CodeBlockView gerendert, keine sichtbaren Zäune", () => {
    const out = expandFencedCodeInNodes(["Vorher\n```js\nconst x = 1;\n```\nNachher"], mathExpand);
    const rendered = html(out);
    expect(rendered).toContain("const x = 1;");
    expect(rendered).not.toContain("```");
    expect(rendered).toContain("Vorher");
    expect(rendered).toContain("Nachher");
  });

  it("Formeln FEUERN NICHT innerhalb eines Codeblocks ($ bleibt literaler Code-Text)", () => {
    const out = expandFencedCodeInNodes(["```bash\necho \"$HOME kostet $5\"\n```"], mathExpand);
    const rendered = html(out);
    expect(rendered).not.toContain("application/x-tex");
    expect(rendered).toContain("$HOME");
    expect(rendered).toContain("$5");
  });

  it("Inline-Codespans (`x`) werden monospaced gerendert, Formeln darin feuern nicht", () => {
    const out = expandFencedCodeInNodes(["Schreibe `$x$` für eine Formel."], mathExpand);
    const rendered = html(out);
    expect(rendered).not.toContain("application/x-tex");
    expect(rendered).toMatch(/<code[^>]*>\$x\$<\/code>/);
  });

  it("ein Inline-Codespan schützt seinen Inhalt, während Formeln DANEBEN normal erkannt werden", () => {
    const out = expandFencedCodeInNodes(["`code` und $y^2$ hier."], mathExpand);
    const rendered = html(out);
    expect(rendered).toContain("application/x-tex");
    expect(rendered).toMatch(/<code[^>]*>code<\/code>/);
  });

  it("bereits gerenderte Elemente (Fußnoten-Links aus renderWithCites) bleiben unangetastet", () => {
    const footnote = <sup key="c0"><a href="https://a.de">[1]</a></sup>;
    const out = expandFencedCodeInNodes(["Fakt ", footnote, " Ende."], mathExpand);
    expect(out).toContain(footnote);
    expect(html(out)).toContain('href="https://a.de"');
  });

  it("keine doppelten Keys, wenn MEHRERE Text-Segmente (getrennt durch einen Codeblock) je eine Formel enthalten", () => {
    // Genau das Szenario, das der gemeinsame Key-Zähler abfangen muss: ohne
    // ihn würden zwei separate expandRest-Aufrufe je bei Key "m0" starten.
    const out = expandFencedCodeInNodes(
      ["Erst $a$ hier.\n\n```js\ncode\n```\n\nDann $b$ auch."],
      mathExpand
    );
    const elements = out.filter((n) => n && typeof n === "object" && n.key != null);
    const keys = elements.map((n) => n.key);
    expect(new Set(keys).size).toBe(keys.length);
    // Beide Formeln UND der Codeblock müssen im Ergebnis auftauchen.
    expect((html(out).match(/class="katex"/g) || []).length).toBe(2);
    expect(html(out)).toContain("code");
  });

  it("unterminierter Zaun bleibt literaler Text (kein Codeblock, keine verschluckten Folgezeilen)", () => {
    const out = expandFencedCodeInNodes(["Vorher.\n```js\nkeine schließende Zeile"], mathExpand);
    const rendered = html(out);
    expect(rendered).toContain("keine schließende Zeile");
    expect(rendered).not.toMatch(/<pre/);
  });

  it("renderMathText (Nutzer-Nachrichten) funktioniert als expandRest genauso", () => {
    const out = expandFencedCodeInNodes(["```\nplain\n```\n\nText mit $z$."], (t) => renderMathText(t));
    const rendered = html(out);
    expect(rendered).toContain("plain");
    expect(rendered).toContain("application/x-tex");
  });

  it("leerer String erzeugt keinen Absturz und keine Elemente", () => {
    expect(expandFencedCodeInNodes([""], mathExpand)).toEqual([]);
  });

  it("ein 4-Backtick-Zaun mit eigenen 3-Backtick-Zeilen im Chat wird als EIN Codeblock gerendert (K1-Szenario)", () => {
    const out = expandFencedCodeInNodes(["````js\nBeispiel:\n```\ninner\n```\n````"], mathExpand);
    const rendered = html(out);
    expect(rendered).toContain("Beispiel:");
    expect(rendered).toContain("inner");
    expect((rendered.match(/<pre/g) || []).length).toBe(1); // EIN Codeblock, kein Zerfall in mehrere
  });
});
