/* ------------------------------------------------------------------ */
/* LaTeX-Formeln (KaTeX)                                               */
/*                                                                     */
/* Gemeinsamer Render-Helfer für Chat, Dokument-Ansicht (markdown.jsx) */
/* und den WYSIWYG-Editor (DocEditor.jsx – dort für die NodeViews und  */
/* den Lade-Pfad mathToPlaceholders). Syntax-Konvention überall gleich: */
/* inline $…$, abgesetzt $$…$$, \$ bleibt ein literales Dollarzeichen.  */
/*                                                                     */
/* WICHTIG: Kein CSS-Import hier (katex/dist/katex.min.css liegt in    */
/* src/index.css) – ein CSS-Import in src/lib würde die Node-Unit-     */
/* Tests brechen (kein Bundler/Loader für .css in Vitest).             */
/* ------------------------------------------------------------------ */

import katex from "katex";

// Währungs-Sicherheit (Pandoc-Regel): Die Notizbücher sind voller
// Finanzbeträge ("$50", "-38.000 vs. -50.000") – ein $ darf nur dann eine
// Formel öffnen, wenn direkt danach KEIN Leerzeichen folgt, und nur dann
// schließen, wenn direkt davor KEIN Leerzeichen steht UND direkt danach
// KEINE Ziffer folgt (sonst würde "$5 and $10" das zweite "$" als
// schließendes Zeichen missbrauchen). Unpaarige "$" bleiben Literaltext,
// weil der Regex dann schlicht nicht matcht.
// Reihenfolge der Alternativen ist Priorität: \$-Escape zuerst (sonst
// würde ein escapetes Dollarzeichen versehentlich als Formelgrenze
// gelesen), dann $$…$$ (mehrzeilig, nicht-gierig), dann einzeiliges $…$.
// Für Chat/Zitate (renderMathText/expandMathInNodes) gedacht, die
// Fließtext ohne zeilenbasierte Struktur rendern – DORT darf $$…$$
// bewusst über Zeilenumbrüche hinweg matchen (Chat ist kein Zeilen-
// renderer). Für den Editor-Ladepfad ist das NICHT sicher genug, siehe
// mathToPlaceholders weiter unten.
export const MATH_TOKEN_RE = /\\\$|\$\$[\s\S]+?\$\$|\$(?!\s)[^$\n]+?(?<!\s)\$(?!\d)/;

// Variante OHNE die \$-Escape-Alternative: für DocEditor.jsx, um bereits
// SERIALISIERTE Formel-Spans ($…$/$$…$$, direkt aus MathInline/MathBlock,
// ohne state.esc()) vor der nachträglichen Backslash-Entfernung (unescapeMd)
// zu schützen. Die \$-Alternative gehört hier NICHT rein: Node-Serializer
// erzeugen niemals ein "\$", und mit ihr würde ein wörtlich getippter
// "\$"-Text (vom Standard-Serializer zu "\\$" – drei Zeichen – escaped)
// fälschlich als Formel-Segment erkannt, wodurch die nötige Entfernung des
// FÜHRENDEN Backslashs übersprungen würde (siehe Test in math.test.jsx).
export const MATH_SERIALIZED_RE = /\$\$[\s\S]+?\$\$|\$(?!\s)[^$\n]+?(?<!\s)\$(?!\d)/;

// Display-Math-Block: Zeile beginnt mit $$ (führendes Leerzeichen erlaubt).
// Einzeilig, wenn dieselbe Zeile mit $$ endet (verankert per $-Anker, damit
// bei mehreren $$…$$-Paaren in einer Zeile das LETZTE als schließend gilt –
// die gesamte Zeile ist EIN Formel-Block, kein Aufteilen in Teilformeln).
// EINE Quelle der Wahrheit für Dokument-Ansicht (markdown.jsx) UND
// Editor-Ladepfad (mathToPlaceholders unten) – siehe matchDisplayBlock.
export const DISPLAY_MATH_START_RE = /^\s*\$\$/;
export const DISPLAY_MATH_ONELINE_RE = /^\s*\$\$(.*?)\$\$\s*$/;
export const DISPLAY_MATH_END_RE = /\$\$\s*$/;

// Harte Abbruchgrenze für die mehrzeilige Suche in matchDisplayBlock: eine
// Leerzeile oder eine Überschriftenzeile (#/##/###). OHNE diesen Abbruch
// würde matchDisplayBlock im EDITOR-Ladepfad (der ein ganzes Dokument bzw.
// -Segment am Stück sieht, anders als der Viewer, der über parseTree schon
// VORHER in Abschnitte zerlegt) über Leerzeilen/Abschnittsgrenzen hinweg zu
// einem einzigen Block mit einer Leerzeile im data-tex-Attribut paaren –
// markdown-it (html:true) zerreißt so ein Tag nachweislich in Fragmente
// (Re-Review-Finding R1, empirisch mit den echten Modulen belegt: eine
// öffnende "$$"-Zeile ohne echte Formel dahinter – z. B. Dollar-Slang wie
// "$$$ teuer" – gepaart mit einer beliebigen späteren "$$"-Zeile über
// Absätze/Überschriften hinweg). Eine Leerzeile IM TeX ist ohnehin
// ungültiges LaTeX, der Abbruch kostet also nichts; Überschriften-Zeilen
// zusätzlich auszuschließen verhindert außerdem, dass der Editor über
// Abschnittsgrenzen hinweg paart, selbst wenn (ungewöhnlich) keine
// Leerzeile dazwischen steht.
const DISPLAY_MATH_BOUNDARY_RE = /^\s*$|^#{1,3}\s/;

// Sucht ab lines[startIdx] einen Display-Block (Zeile beginnt mit $$, bis
// zur Zeile die mit $$ endet – auch einzeilig). Gibt bei Erfolg
// { tex, endIdx } zurück, sonst null – NULL bedeutet dabei ausdrücklich
// "kein Block", nicht "Fehler": Der Aufrufer muss die Startzeile dann
// unverändert/normal weiterverarbeiten, NICHT den Rest des Dokuments
// verschlucken. Vier Fälle liefern null:
// 1. Die Zeile beginnt gar nicht mit $$.
// 2. Auf derselben Zeile folgt nach dem öffnenden $$ noch ein weiteres $$,
//    aber die Zeile endet nicht direkt danach (z. B. "$$x$$ mehr Text") –
//    das ist KEIN eigener Block, sondern gehört dem Inline-Pfad (der
//    $$…$$ mitten im Fließtext als eingebetteten Display-Span erkennt).
// 3. Es gibt bis zum Dokumentende keine schließende $$-Zeile – dann bleibt
//    die öffnende Zeile literal stehen, statt den kompletten Rest des
//    Abschnitts als TeX zu verschlucken (Review-Finding 4).
// 4. Beim Suchen der Schlusszeile wird zuerst eine Leerzeile oder
//    Überschriftenzeile erreicht (Re-Review-Finding R1) – dann bricht die
//    Suche sofort ab, statt darüber hinweg nach einer (falschen)
//    Schlusszeile weiterzusuchen.
export function matchDisplayBlock(lines, startIdx) {
  const line = lines[startIdx];
  if (!DISPLAY_MATH_START_RE.test(line)) return null;
  const oneLiner = DISPLAY_MATH_ONELINE_RE.exec(line);
  if (oneLiner) return { tex: oneLiner[1], endIdx: startIdx };
  const afterOpen = line.replace(DISPLAY_MATH_START_RE, "");
  if (afterOpen.includes("$$")) return null; // Fall 2
  const texLines = [afterOpen];
  for (let j = startIdx + 1; j < lines.length; j++) {
    if (DISPLAY_MATH_END_RE.test(lines[j])) {
      texLines.push(lines[j].replace(DISPLAY_MATH_END_RE, ""));
      return { tex: texLines.join("\n"), endIdx: j };
    }
    if (DISPLAY_MATH_BOUNDARY_RE.test(lines[j])) return null; // Fall 4
    texLines.push(lines[j]);
  }
  return null; // Fall 3
}

// Nur echte Fehlermeldungen escapen (Sicherheitsnetz, siehe unten) –
// KaTeX selbst escaped seine Ausgabe bereits (siehe renderKatexHtml).
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Modul-Cache: dieselbe Formel wird in Chat/Dokument oft mehrfach pro
// Render-Durchlauf und bei jedem Tastendruck im (davon unabhängigen)
// Chat-Eingabefeld erneut gerendert – katex.renderToString kostet ca.
// 0,5-2 ms pro Formel, spürbar bei formellastigen Notizen. Key aus
// displayMode + tex; ein simples "alles leeren" bei > 500 Einträgen statt
// LRU hält die Logik einfach (Formel-Mengen in einem Notizbuch/Chat sind
// klein, ein voller Cache ist ein sehr seltener Rand­fall).
const KATEX_CACHE = new Map();
const KATEX_CACHE_MAX = 500;

// katex.renderToString mit trust:false erzeugt garantiert kein <script>,
// keine \href/\includegraphics-Ausbrüche und keine anklickbaren Links aus
// dem TeX-Quelltext; jeglicher Nutzertext im Ergebnis-Markup (auch in der
// <annotation>) läuft durch KaTeX' eigenes XML/HTML-Escaping. Es gibt also
// keinen dangerouslySetInnerHTML-XSS-Weg über Formelinhalte. throwOnError:
// false liefert bei kaputtem TeX statt eines Errors ein <span class=
// "katex-error"> mit der Fehlermeldung – die App darf an ungültiger Nutzer-
// oder Modell-Eingabe nie abstürzen.
export function renderKatexHtml(tex, displayMode) {
  const texStr = String(tex ?? "");
  const key = (displayMode ? "1" : "0") + texStr;
  const cached = KATEX_CACHE.get(key);
  if (cached !== undefined) return cached;
  let html;
  try {
    html = katex.renderToString(texStr, {
      throwOnError: false,
      trust: false,
      displayMode: !!displayMode,
    });
  } catch (e) {
    // Sollte wegen throwOnError:false praktisch nie greifen; Sicherheitsnetz
    // falls KaTeX selbst (z. B. bei pathologischem Input) doch wirft.
    html = '<span class="katex-error">' + escapeHtml(texStr) + "</span>";
  }
  if (KATEX_CACHE.size >= KATEX_CACHE_MAX) KATEX_CACHE.clear();
  KATEX_CACHE.set(key, html);
  return html;
}

// Eine KaTeX-Formel als React-Span (inline UND display – KaTeX verpackt
// displayMode selbst in ein <span class="katex-display">, ein <div>-Wrapper
// ist dafür nicht nötig; ein <span> lässt sich damit gefahrlos auch mitten
// in einem <p> platzieren, ohne ungültiges HTML (div-in-p) zu erzeugen).
export function KatexSpan({ tex, displayMode, className }) {
  return (
    <span
      className={"katex-wrap" + (className ? " " + className : "")}
      dangerouslySetInnerHTML={{ __html: renderKatexHtml(tex, displayMode) }}
    />
  );
}

// Einen von MATH_TOKEN_RE gematchten Rohtext-Treffer in ein React-Segment
// verwandeln: "\$" → literales Dollarzeichen (Backslash wird konsumiert),
// "$$…$$" → Display-Formel, "$…$" → Inline-Formel.
export function renderMathToken(tok, key) {
  if (tok === "\\$") return "$";
  if (tok.startsWith("$$")) {
    return <KatexSpan key={key} tex={tok.slice(2, -2)} displayMode />;
  }
  return <KatexSpan key={key} tex={tok.slice(1, -1)} displayMode={false} />;
}

// Erweitert ein bereits gemischtes Array aus Strings und React-Knoten (wie es
// z. B. renderWithCites in citations.jsx liefert – Text durchsetzt mit
// hochgestellten Quellen-Links) um Formel-Erkennung in den String-Segmenten;
// vorhandene Nicht-String-Elemente (die Fußnoten-Links) bleiben unangetastet.
// Ein gemeinsamer Zähler über das GESAMTE Array hinweg verhindert doppelte
// React-Keys, die entstünden, würde man jedes Segment isoliert mit
// renderMathText verarbeiten (Zähler startet dort jeweils bei 0).
export function expandMathInNodes(nodes) {
  const out = [];
  let k = 0;
  for (const n of nodes) {
    if (typeof n !== "string") { out.push(n); continue; }
    let s = n;
    while (s.length) {
      const m = MATH_TOKEN_RE.exec(s);
      if (!m) { out.push(s); break; }
      if (m.index > 0) out.push(s.slice(0, m.index));
      out.push(renderMathToken(m[0], "m" + k++));
      s = s.slice(m.index + m[0].length);
    }
  }
  return out;
}

// Zerlegt einen beliebigen Textstring in React-Knoten: Literaltext bleibt
// String, Formeln werden zu KatexSpan-Elementen. Für Chat-Bubbles (App.jsx)
// und Zitat-Fußnoten (citations.jsx) gedacht, die keine zeilenbasierte
// Vorverarbeitung wie die Dokument-Ansicht durchlaufen – hier müssen daher
// sowohl $…$ als auch $$…$$ direkt im Fließtext erkannt werden.
export function renderMathText(text) {
  return expandMathInNodes([String(text ?? "")]);
}

/* -------------------------------------------------------------------- */
/* WYSIWYG-Editor (DocEditor.jsx): Formeln als eigene HTML-Tags          */
/*                                                                       */
/* tiptap-markdown kennt $…$/$$…$$ nicht als Markdown-Syntax. Wie schon  */
/* <span style="color:…">/<mark data-color="…"> (DECISIONS #15) nutzen  */
/* wir den html:true-Modus: markdown-it reicht rohe, unbekannte Tags     */
/* unverändert durch, TipTaps eigener DOM-Parser wandelt sie danach      */
/* anhand von parseHTML()-Regeln der MathInline/MathBlock-Node-          */
/* Erweiterungen in atomare Nodes um. Der TeX-Quelltext steckt als       */
/* HTML-Attribut im Tag – der Browser/jsdom decodiert die Entities beim  */
/* Auslesen (el.getAttribute) automatisch zurück, ein eigenes Encoding   */
/* (Base64 o. Ä.) ist dafür nicht nötig (siehe Tests: Klammern, Anführ-  */
/* ungszeichen, Zeilenumbrüche in mehrzeiligen $$…$$-Blöcken überstehen  */
/* den Roundtrip unverändert).                                          */
/*                                                                       */
/* KONTEXTBEWUSSTSEIN (Review-Finding 1, verschärft in Re-Review R1/R2): */
/* Anders als MATH_TOKEN_RE (das für Chat/Zitate bewusst über den        */
/* GESAMTEN Fließtext läuft) darf der Editor-Ladepfad NICHT blind übers  */
/* Roh-Markdown matchen – der Viewer schützt Codespans und verankert     */
/* $$…$$ zeilenweise, der Editor muss exakt dieselbe Regel anwenden,     */
/* sonst schreibt das bloße ÖFFNEN eines Dokuments (nach der nächsten    */
/* echten Bearbeitung) Codespan-Inhalte oder gepaarte $$ still um.       */
/* mathToPlaceholders arbeitet dafür zeilenweise auf dem UNGETEILTEN     */
/* Dokument (matchDisplayBlock braucht die echten Zeilengrenzen, siehe   */
/* dort) und wendet drei Schutzmaßnahmen an, bevor irgendetwas           */
/* konvertiert wird: (1) $$…$$ wird AUSSCHLIESSLICH über matchDisplay-   */
/* Block (zeilenverankert, s. o. inkl. Abbruch an Leerzeilen/Über-       */
/* schriften, Re-Review R1) erkannt – niemals über den gesamten Text     */
/* hinweg. (2) Codespan-Schutz (wie renumberCitations, markdown.jsx)     */
/* wird NUR PRO ZEILE für den Inline-Durchlauf angewendet, NICHT global  */
/* vor dem Zeilen-Split (Re-Review R2): ein globaler Split vor der       */
/* Zeilenaufteilung würde ein Zeilen-FRAGMENT nach einem Codespan-Ende   */
/* wie den Anfang einer eigenen Zeile behandeln und es fälschlich als    */
/* Display-Block-Start erkennen können, obwohl es das im Original nie    */
/* war. Codespans können keine Zeilenumbrüche enthalten, ein Split pro   */
/* Zeile ist dafür ausreichend. Ein $$-Paar MITTEN in einer normalen     */
/* Zeile bleibt bewusst unangetastet (Bare-$$-Wache in                   */
/* MATH_INLINE_ONLY_RE): Ein eingebetteter Formel-BLOCK-Node mitten in   */
/* einem Absatz würde von ProseMirror aus dem Absatz herausgelöst und    */
/* diesen beim Speichern in mehrere Zeilen zerlegen – Struktur-          */
/* Korruption. (3) Bildzeilen (![Titel](img:id)) werden komplett         */
/* ausgenommen, damit ein $ im Bildtitel nicht mitten in die Markdown-   */
/* Bildsyntax hineingeschrieben wird, bevor sie geparst ist.             */
/* -------------------------------------------------------------------- */

export const MATH_INLINE_TAG = "math-inline";
export const MATH_BLOCK_TAG = "math-block";

// Re-Review-Finding R5: zusaetzlich das Pipe-Zeichen als numerische
// Entity codieren. Ein rohes | im Attributwert waere innerhalb einer
// Tabellenzeile ununterscheidbar von einem GFM-Zellentrenner - markdown-it
// zerteilt die Pipe-Tabellenzeile textbasiert VOR jeder HTML-Interpretation
// und wuerde das Tag in Zell-Fragmente zerreissen. getAttribute() dekodiert
// &#124; wie jede andere numerische Entity zuverlaessig zurueck. Bekannte
// Restgrenze (siehe DECISIONS): der Node-Serializer schreibt das Pipe beim
// SPEICHERN roh in "$tex$" zurueck (kein state.esc()) - eine Formel mit
// Pipe in einer Tabellenzelle bleibt nach dem naechsten Speichern verwundbar,
// exakt wie unescapte Pipes in normalem Zellentext schon vorher (GIGO).
function escapeHtmlAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\|/g, "&#124;");
}

// Bildzeilen bleiben unangetastet (Review-Finding 9). Bewusst dupliziert
// statt aus markdown.jsx importiert: math.jsx wird umgekehrt VON
// markdown.jsx importiert (MATH_TOKEN_RE, matchDisplayBlock,
// renderKatexHtml) – ein Re-Import wäre ein Zirkelbezug. Exakte Kopie von
// IMG_LINE_RE (markdown.jsx), ohne die dort ungenutzten Capture-Groups.
const IMG_LINE_RE_FOR_MATH = /^!\[[^\]]*\]\(img:[a-zA-Z0-9]+\)$/;

// Sentinel für \$-Escapes auf dem Editor-Ladepfad (Review-Finding 2): Ein
// Zeichen aus dem privaten Unicode-Bereich (kommt in echten Notizen
// praktisch nie vor) ersetzt \$ komplett, statt den Backslash als Text
// durchzureichen. Ein erster Anlauf hat \$ als HTML-Entity ("&#92;$")
// codiert, damit markdown-it sie zu einem echten Backslash-TEXTzeichen
// dekodiert; das brach aber bei ZWEI $-Escapes im selben Satz ohne
// Formel dazwischen (z. B. "\$a\$"): Der Standard-Serializer verdoppelt
// jeden echten Backslash beim Speichern, und die anschließende Formel-
// Schutz-Erkennung in unescapeMd (MATH_SERIALIZED_RE, welche $…$-
// Muster im bereits serialisierten Text vor der Backslash-Bereinigung
// schützt) las "$a\\$" dabei fälschlich als EINE geschützte Formel und
// ließ das doppelte Escape unaufgelöst stehen – kein sauberer Roundtrip.
// Der Sentinel ist dagegen für JEDE andere Regel in dieser Datei komplett
// unsichtbar (kein $, kein Backslash, keine Markdown-Bedeutung) und wird
// erst ganz am Ende, in DocEditor.jsx' unescapeMd, unbedingt (ohne jede
// Fallunterscheidung) zurück in "\$" verwandelt – dort kann er mit
// nichts anderem kollidieren (siehe tests/docEditorMath.test.jsx, der
// Idempotenz-Test deckt genau dieses Szenario ab).
//
// String.fromCharCode statt eines \u-Escapes im Quelltext: unmissver-
// ständlich aus einer Zahl berechnet, kein Risiko, dass ein rohes
// Sonderzeichen im Quelltext landet.
export const ESCAPED_DOLLAR_SENTINEL = String.fromCharCode(0xe000);

// Re-Review-Finding R4: Stünde der Sentinel bereits VOR der Verarbeitung
// im Dokument (z. B. aus eingefügtem Text mit privaten Icon-Fonts –
// sehr selten, aber denkbar), würde unescapeMd ihn beim nächsten
// Speichern bedingungslos zu einem \$-Escape machen – eine stille
// Fremdzeichen-Umdeutung. mathToPlaceholders neutralisiert daher jedes
// bereits vorhandene Sentinel-Vorkommen, BEVOR es selbst welche erzeugt:
// Ersetzung durch das Unicode-Replacement-Character (U+FFFD) – die
// Standardkonvention für „hier stand ein nicht darstellbares/
// unerwünschtes Zeichen“.
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);

// Nur für den Editor-Ladepfad: Escape + eine "$$"-Wache + einzeiliges
// $…$ – BEWUSST OHNE die $$…$$-Alternative aus MATH_TOKEN_RE (siehe
// Modul-Kommentar oben). Die "$$"-Wache ist nötig, weil sonst die
// Einzel-Dollar-Alternative opportunistisch in ein $$-Paar hineinbeißen
// würde: Ohne sie würde "$$x$$" als "$" (Literal) + Formel("x") + "$"
// (Literal) fehlinterpretiert, statt komplett unangetastet zu bleiben.
const MATH_INLINE_ONLY_RE = /\\\$|\$\$|\$(?!\s)[^$\n]+?(?<!\s)\$(?!\d)/;

// Eine Zeile (garantiert ohne Zeilenumbruch, kein $$-Block – das prüft der
// Aufrufer vorher) auf Escape/Inline-Formeln abklopfen.
function mathToPlaceholdersInlineOnly(line) {
  let out = "";
  let s = line;
  while (s.length) {
    const m = MATH_INLINE_ONLY_RE.exec(s);
    if (!m) { out += s; break; }
    out += s.slice(0, m.index);
    const tok = m[0];
    if (tok === "\\$") {
      // Review-Finding 2: den Backslash NICHT konsumieren (das würde die
      // Escape-Semantik bei der nächsten echten Bearbeitung stillschweigend
      // verlieren) – durch den Sentinel ersetzen, siehe Kommentar dort.
      out += ESCAPED_DOLLAR_SENTINEL;
    } else if (tok === "$$") {
      out += "$$"; // Bare-$$-Wache: unverändert durchreichen, siehe oben
    } else {
      out += "<" + MATH_INLINE_TAG + ' data-tex="' + escapeHtmlAttr(tok.slice(1, -1)) + '"></' + MATH_INLINE_TAG + ">";
    }
    s = s.slice(m.index + tok.length);
  }
  return out;
}

// Eine einzelne Zeile (matchDisplayBlock hat sie NICHT als Block
// erkannt): codespan-geschützt inline verarbeiten. Codespans können
// keine Zeilenumbrüche enthalten, ein Split PRO ZEILE ist daher
// ausreichend UND sicherer als ein globaler Split vor dem Zeilen-Split
// (Re-Review-Finding R2, siehe Modul-Kommentar oben): nur die geraden
// Segmente (kein Codespan-Inhalt) laufen durch
// mathToPlaceholdersInlineOnly.
const CODESPAN_SPLIT_RE = /(`[^`\n]+`)/;
function mathToPlaceholdersLine(line) {
  return line
    .split(CODESPAN_SPLIT_RE)
    .map((seg, i) => (i % 2 ? seg : mathToPlaceholdersInlineOnly(seg)))
    .join("");
}

// Wandelt $/$$/\$-Formeln aus rohem Markdown VOR dem tiptap-markdown-
// Parsing in <math-inline>/<math-block>-Tags um (gleiche Vorverarbeitung
// wie resolveImgs für img:-Referenzen in DocEditor.jsx: Konvertieren vorm
// Laden, das Gegenstück serialisiert beim Speichern direkt zurück zu
// $…$/$$…$$ – siehe die addStorage().markdown.serialize der beiden Node-
// Erweiterungen). Arbeitet zeilenweise auf dem UNGETEILTEN Dokument
// (siehe Modul-Kommentar oben, Re-Review R1/R2).
export function mathToPlaceholders(md) {
  // Re-Review-Finding R4: ein im Dokument bereits vorhandenes Sentinel-
  // Zeichen (siehe ESCAPED_DOLLAR_SENTINEL) neutralisieren, BEVOR
  // irgendetwas verarbeitet wird – sonst würde unescapeMd es beim
  // nächsten Speichern bedingungslos zu einem \$-Escape machen.
  const safe = String(md ?? "").split(ESCAPED_DOLLAR_SENTINEL).join(REPLACEMENT_CHAR);
  const lines = safe.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (IMG_LINE_RE_FOR_MATH.test(line.trim())) {
      out.push(line);
      continue;
    }
    if (DISPLAY_MATH_START_RE.test(line)) {
      const block = matchDisplayBlock(lines, i);
      if (block) {
        out.push("<" + MATH_BLOCK_TAG + ' data-tex="' + escapeHtmlAttr(block.tex) + '"></' + MATH_BLOCK_TAG + ">");
        i = block.endIdx;
        continue;
      }
      // Kein sauberer, zeilenverankerter Block (siehe matchDisplayBlock-
      // Kommentar) – die Zeile bleibt GANZ unangetastet, auch ohne
      // Inline-Durchlauf, um jedes Risiko einer mittigen $$-Einbettung
      // auszuschließen (Review-Finding 1b). Der Viewer rendert dieselbe
      // Zeile ohnehin literal bzw. inline-eingebettet (siehe dort).
      out.push(line);
      continue;
    }
    out.push(mathToPlaceholdersLine(line));
  }
  return out.join("\n");
}
