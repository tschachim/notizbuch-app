/* ------------------------------------------------------------------ */
/* Monospaced Codeblöcke (```-Fences)                                  */
/*                                                                     */
/* Gemeinsame Fence-Erkennung + Render-Helfer für die Dokument-Ansicht  */
/* (markdown.jsx), den Chat (App.jsx) und den Editor-Ladepfad          */
/* (math.jsx: mathToPlaceholders, DocEditor.jsx: unescapeMd). EIGENE   */
/* DATEI statt in markdown.jsx oder math.jsx, weil BEIDE sie brauchen  */
/* und markdown.jsx bereits VON math.jsx importiert – ein Re-Import    */
/* wäre ein Zirkelbezug (siehe math.jsx-Kommentar zu                   */
/* IMG_LINE_RE_FOR_MATH). code.jsx selbst importiert nichts aus         */
/* markdown.jsx/math.jsx und bleibt damit das Blatt im Abhängigkeits-  */
/* baum (code.jsx ← math.jsx ← markdown.jsx, code.jsx ← markdown.jsx,  */
/* beides zirkelfrei).                                                 */
/*                                                                     */
/* v7.7 (Nutzerwunsch „voller Support, Darstellung UND Editieren“):    */
/* hebt die Codeblock-Deaktivierung aus DECISIONS #14 auf. Bewusst     */
/* KEIN Syntax-Highlighting (keine neue Abhängigkeit) – das            */
/* Sprach-Label nach dem öffnenden Zaun wird nur gespeichert/klein     */
/* angezeigt, nicht ausgewertet.                                       */
/* ------------------------------------------------------------------ */

import { cloneElement, isValidElement } from "react";

// Öffnende Zaun-Zeile (CommonMark "fenced code block" – NUR Backtick-Zäune;
// ~~~-Zäune und eingerückter Code werden bewusst NICHT erkannt, siehe
// DECISIONS #54 Restrisiko, der Viewer rendert sie ohnehin nicht als
// Block). Einrückung bis zu drei Leerzeichen, KEIN Tab (Re-Review-Finding
// W2: CommonMark/markdown-it werten eine Zeile ab vier Spaces oder einem
// Tab als EINGERÜCKTEN Codeblock, nicht als Zaun – eine großzügigere
// Toleranz hier würde den Ladepfad Zeilen schützen lassen, die
// markdown-it beim tatsächlichen Öffnen im Editor GAR NICHT als Zaun
// liest, und umgekehrt Roundtrip-Korruption ermöglichen). Danach DREI
// ODER MEHR Backticks (group 1 – die Mindestlänge des SCHLUSS-Zauns
// richtet sich nach dieser Länge, siehe matchFenceBlock unten:
// CommonMark-Regel, identisch von markdown-it umgesetzt). Danach ein
// Info-String OHNE Backtick bis Zeilenende (group 2, noch ungetrimmt) –
// Re-Review-Finding W1: CommonMark verbietet im Info-String NUR
// Backticks, Leerzeichen sind ausdrücklich ERLAUBT (z. B.
// "```python title=x" ist gültiges, von markdown-it geparstes Markdown) –
// nur das ERSTE Wort wird als Sprach-Label übernommen (siehe
// matchFenceBlock; identisch zu markdown-it, das ebenfalls nur das erste
// Wort des Info-Strings für die "language-xxx"-Klasse verwendet).
export const FENCE_OPEN_RE = /^ {0,3}(`{3,})([^`\r\n]*)$/;
// Schließende Zaun-Zeile – GRUNDFORM ohne Längenprüfung gegen den
// öffnenden Zaun (die braucht die tatsächliche Öffnungslänge und läuft
// daher dynamisch in matchFenceBlock). Für Aufrufer gedacht, die nur grob
// "sieht wie ein Schluss-Zaun aus" prüfen wollen (z. B. Tests).
export const FENCE_CLOSE_RE = /^ {0,3}`{3,}[ \t]*$/;

// Sucht ab lines[startIdx] (muss FENCE_OPEN_RE erfüllen) die schließende
// Zaun-Zeile: mindestens so viele Backticks wie der öffnende Zaun lang war
// (Re-Review-Finding K1/CommonMark-Regel – siehe FencedCodeBlock in
// DocEditor.jsx, das beim Speichern exakt umgekehrt den Zaun bei
// Backtick-Serien im Inhalt VERLÄNGERT; nur wenn Lesen und Schreiben
// dieselbe Längen-Regel anwenden, bleibt der Roundtrip stabil). Gibt bei
// Erfolg { lang, code, endIdx } zurück (code = Inhalt ZWISCHEN den
// Zaun-Zeilen, byte-genau inkl. eventueller Leerzeilen), sonst null –
// NULL bedeutet "kein Block", nicht "Fehler": Der Aufrufer lässt die
// öffnende Zeile dann unverändert/normal weiterlaufen (sie matcht ohnehin
// keine der übrigen Block-Regeln), statt den Rest des Dokuments/
// Abschnitts zu verschlucken – gleiche konservative Philosophie wie
// matchDisplayBlock in math.jsx bei einem unterminierten "$$".
// Anders als bei Formeln ist hier KEINE Abbruchgrenze an Leerzeilen/
// Überschriften nötig: Der Zaun selbst ist ein eindeutiges Start/Ende-
// Paar, Leerzeilen und "#"-Zeilen INNERHALB eines Codeblocks sind legitimer
// Code-Inhalt (z. B. Kommentare, Markdown-Beispiele in einem Snippet).
export function matchFenceBlock(lines, startIdx) {
  const openM = FENCE_OPEN_RE.exec(lines[startIdx]);
  if (!openM) return null;
  const openLen = openM[1].length;
  const lang = openM[2].trim().split(/\s+/)[0] || "";
  const closeRe = new RegExp("^ {0,3}`{" + openLen + ",}[ \\t]*$");
  for (let j = startIdx + 1; j < lines.length; j++) {
    if (closeRe.test(lines[j])) {
      return { lang, code: lines.slice(startIdx + 1, j).join("\n"), endIdx: j };
    }
  }
  return null; // unterminiert
}

// Zerlegt einen (ggf. mehrzeiligen) Text in Segmente außerhalb/innerhalb
// GESCHLOSSENER Fenced-Code-Blöcke. Jedes Segment trägt "raw" (die
// Original-Teilstrecke inkl. Zeilenumbrüche) – eine byte-genaue
// Rekonstruktion ist damit immer segments.map(s => s.raw).join("\n").
// Codeblock-Segmente tragen zusätzlich "lang"/"text" (Inhalt OHNE die
// Zaun-Zeilen) für die Anzeige. Unterminierte Zäune zählen NICHT als Code
// (sie werden vom Renderer literal dargestellt, siehe matchFenceBlock)
// und bleiben Teil des umgebenden Text-Segments – konsistent mit der
// Dokument-Ansicht/dem Editor-Ladepfad.
export function splitFenceSegments(text) {
  const lines = String(text).split("\n");
  const segments = [];
  let i = 0;
  let textStart = 0;
  const flushText = (end) => {
    if (end > textStart) segments.push({ code: false, raw: lines.slice(textStart, end).join("\n") });
  };
  while (i < lines.length) {
    if (FENCE_OPEN_RE.test(lines[i])) {
      const block = matchFenceBlock(lines, i);
      if (block) {
        flushText(i);
        segments.push({
          code: true,
          lang: block.lang,
          text: block.code,
          raw: lines.slice(i, block.endIdx + 1).join("\n"),
        });
        i = block.endIdx + 1;
        textStart = i;
        continue;
      }
    }
    i++;
  }
  flushText(lines.length);
  return segments;
}

// Monospaced Darstellung eines Codeblocks – für Dokument-Ansicht UND Chat
// gemeinsam, an die bestehende Codespan-Optik angelehnt (font-mono,
// dezenter Hintergrund, Rahmen, abgerundet). WICHTIG: overflow-x-auto nur
// im eigenen Container (Nutzerauftrag: die Seite/Bubble darf dadurch nie
// quer scrollen) – whitespace-pre erhält Einrückung/Zeilenumbrüche exakt,
// ohne dass lange Zeilen den Rest des Layouts verschieben. Kein Syntax-
// Highlighting (bewusst schlicht, keine neue Abhängigkeit); das
// Sprach-Label wird nur angezeigt, wenn vorhanden.
export function CodeBlockView({ lang, code, className }) {
  return (
    <div className={"my-2 max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-slate-50" + (className ? " " + className : "")}>
      {lang && (
        <div className="px-3 pt-1 font-mono text-[10px] uppercase tracking-wide text-slate-400">{lang}</div>
      )}
      <pre className="m-0 whitespace-pre px-3 py-2 font-mono text-sm text-slate-800">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// Inline-Codespans (`x`) – wie Codeblöcke können sie keine Zeilenumbrüche
// enthalten, ein Split ohne "\n" im Zeichensatz genügt (gleiche Regel wie
// renumberCitations/mathToPlaceholders' Codespan-Schutz).
const INLINE_CODE_SPLIT_RE = /(`[^`\n]+`)/;

// Erweitert ein gemischtes Node-Array (Strings + bereits gerenderte
// Elemente, z. B. Quellen-Fußnoten aus citations.jsx/renderWithCites) für
// den Chat: In jedem String-Segment werden ZUERST Fenced-Codeblöcke,
// DANN Inline-Codespans herausgezogen und monospaced gerendert; NUR der
// verbleibende "echte" Text läuft durch expandRest (z. B. Formel-
// Erkennung) – exakt die geforderte Reihenfolge "erst Fences, dann Math
// auf den Nicht-Code-Segmenten". expandRest bekommt einen reinen
// Text-String und muss ein Array aus Strings/React-Elementen liefern
// (Signatur wie math.jsx' expandMathInNodes/renderMathText).
//
// Key-Handling: expandRest wird bei mehreren Text-Segmenten (z. B. Text
// vor UND nach einem Codeblock) MEHRFACH mit je eigenem Null-basiertem
// Key-Zähler aufgerufen – ohne Gegenmaßnahme kollidieren React-Keys
// zwischen den Segmenten (z. B. zwei Formeln, je die erste in ihrem
// Segment, beide mit Key "m0"). Alle von expandRest gelieferten Elemente
// werden daher mit einem hier geführten, über die GESAMTE Ausgabe
// eindeutigen Key neu versehen (cloneElement) – reine Strings brauchen
// keinen Key und bleiben unangetastet.
export function expandFencedCodeInNodes(nodes, expandRest) {
  const out = [];
  let k = 0;
  const pushRekeyed = (list) => {
    for (const node of list) {
      out.push(isValidElement(node) ? cloneElement(node, { key: "cx" + k++ }) : node);
    }
  };
  for (const n of nodes) {
    if (typeof n !== "string") { out.push(n); continue; }
    for (const seg of splitFenceSegments(n)) {
      if (seg.code) {
        out.push(<CodeBlockView key={"cx" + k++} lang={seg.lang} code={seg.text} />);
        continue;
      }
      seg.raw.split(INLINE_CODE_SPLIT_RE).forEach((part, i) => {
        if (i % 2) {
          out.push(
            <code key={"cx" + k++} className="font-mono text-sm bg-slate-100 border border-slate-200 rounded px-1">
              {part.slice(1, -1)}
            </code>
          );
        } else if (part) {
          pushRekeyed(expandRest(part));
        }
      });
    }
  }
  return out;
}
