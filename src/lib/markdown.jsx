/* ------------------------------------------------------------------ */
/* Markdown: Baum-Parser & Block-Renderer                              */
/* Basis aus der Referenz-App (Artifact v3.1); erweitert um:           */
/* ~~durchgestrichen~~, Schriftfarbe (<span style="color:…">),         */
/* Textmarker (<mark …>), nummerierte Listen und Checklisten mit       */
/* klickbaren Kästchen (Zeilen behalten dafür ihren Original-Index).   */
/* ------------------------------------------------------------------ */

import { ChevronDown } from "lucide-react";
import {
  MATH_TOKEN_RE, renderMathToken, renderKatexHtml,
  DISPLAY_MATH_START_RE, matchDisplayBlock,
} from "./math.jsx";
import { FENCE_OPEN_RE, matchFenceBlock, splitFenceSegments, CodeBlockView } from "./code.jsx";
import { providerFor, getLinkProviders, ProviderIcon, trimBareUrl } from "./linkProviders.jsx";

export const IMG_LINE_RE = /^!\[([^\]]*)\]\(img:([a-zA-Z0-9]+)\)$/;
export const IMG_REF_RE = /!\[[^\]]*\]\(img:([a-zA-Z0-9]+)\)/g;

export const TASK_RE = /^(\s*[-*]\s+\[)( |x|X)(\]\s+)(.*)$/;
const OL_RE = /^\s*\d+[.)]\s+(.*)$/;
const UL_RE = /^\s*[-*]\s+(.*)$/;
const TABLE_LINE_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEP_RE = /^\s*\|(\s*:?-+:?\s*\|)+\s*$/;

// Display-Math-Block-Erkennung: DISPLAY_MATH_START_RE/matchDisplayBlock
// leben zentral in math.jsx (EINE Regel für Dokument-Ansicht UND den
// Editor-Ladepfad, siehe dort und DECISIONS #46-49).

/* Zeilen behalten ihren Original-Index im Dokument, damit z. B. das
   Abhaken einer Checkbox die richtige Zeile im Markdown ändern kann.

   Kapitel-Ebene (v7.14, Nutzerwunsch "zweistufige Gliederung"): "# Titel"
   gruppiert mehrere "##"-Abschnitte zu einem Kapitel. "sections" bleibt
   dabei bewusst eine FLACHE Liste mit globalem Index (Scroll-Spy, gotoSection
   & alle bestehenden Konsumenten bleiben minimal-invasiv) – jede Section
   trägt zusätzlich "chapter" (Index in "chapters"). "chapters" ist
   [{ title, secFrom, secTo, lines }] mit HALBOFFENEM Bereich [secFrom,
   secTo). "lines" (v7.15-Fix, E2E-Finding 🟡) sind – analog zu
   sections/subs – die Zeilen DIREKT unter der Kapitelzeile, VOR dem ersten
   "##" dieses Kapitels (oder das gesamte Kapitel, falls es gar keinen
   "##"-Abschnitt hat): ein Kapitel darf also reinen Freitext OHNE jeden
   Abschnitt enthalten, DocView rendert "lines" direkt unter dem
   Kapitel-Kopf. "pre" bleibt dadurch AUSSCHLIESSLICH für Inhalt VOR dem
   allerersten Kapitel/Abschnitt (Titelzeile + echter Vorspann).

   Abwärtskompatibilität HART (Kernentscheidung, siehe DECISIONS – v7.14
   Nachbesserung nach Code-Review, löst die anfängliche "sawSection"-
   Heuristik ab): Die Notizbuch-Titelzeile wird über ihre POSITION erkannt,
   NICHT über den Verarbeitungszustand beim Durchlaufen. Ist die erste
   NICHT-LEERE Zeile des gesamten Dokuments eine "# "-Zeile (per Konvention
   immer der Fall, siehe System-Prompt: "# " + Notizbuchname), gilt GENAU
   diese eine Zeile (per Original-Index gemerkt, "titleLineIdx") als Titel
   und wird NIE zum Kapitel – unabhängig davon, ob vorher/nachher schon ein
   "##"/"###" aufgetaucht ist. JEDE ANDERE "# "-Zeile ist immer ein Kapitel,
   auch wenn sie VOR dem ersten "##" steht (Regressionsfall des Reviews:
   "# Titel\n# Kapitel A\n## A1\n# Kapitel B\n## B1" – Kapitel A stand vor
   dem ersten "##" und wurde von der alten sawSection-Logik fälschlich als
   Fließtext neben der Titelzeile behandelt, siehe Tests). Beginnt das
   Dokument NICHT mit einer "# "-Zeile (kein Alt-Dokument, sondern z. B. ein
   Test-Fixture ohne Titel), gibt es KEINE Titel-Ausnahme – dann ist JEDE
   "# "-Zeile ein Kapitel. Ein Dokument ganz ohne "# "-Zeile hat "chapters:
   []", ein Dokument mit genau einer "# "-Zeile ganz oben (jedes reale
   Alt-Dokument) ebenfalls – beides exakt das Verhalten vor v7.14.
   Sammeln sich vor dem ERSTEN echten Kapitel bereits Abschnitte an ("H2 vor
   dem ersten H1", z. B. Inhalt direkt unter der Titelzeile, bevor das erste
   "#"-Kapitel beginnt), bekommen sie ein IMPLIZITES titelloses Kapitel
   (title:null) – aber NUR, wenn es dafür auch wirklich schon Abschnitte
   gibt (kein leeres Phantom-Kapitel nur wegen der Titelzeile). DocView/
   App.jsx rendern ein Kapitel mit title:null bewusst flach (kein Kopf/
   Einrückung), damit ein Dokument OHNE jede echte "#"-Kapitelzeile
   weiterhin "chapters:[]" liefert (kein Sonderfall in den Renderern nötig).

   Wie schon bei "##"/"###" ist die Erkennung bewusst FENCE-BLIND (siehe
   DECISIONS #54): eine "# "-Zeile INNERHALB eines ```-Codeblocks wird hier
   nicht ausgenommen und kann fälschlich als Kapitelgrenze zählen – dieselbe
   dokumentierte, bewusst in Kauf genommene Grenze wie bei "##" gilt jetzt
   auch für "#".

   Dasselbe title:null-Muster gibt es seit v7.28 auch eine Ebene tiefer bei
   ABSCHNITTEN: ein "###"-Unterthema OHNE vorausgehendes "##" bekommt eine
   TITELLOSE Sektion (title:null) statt – wie vor v7.28 – einen fabrizierten
   Abschnitt "Allgemein" (Altlast der Referenz-App, siehe unten). DocView/
   App.jsx rendern auch das bewusst flach: kein Kopf/Klapp-Button für die
   Sektion selbst, ihre "###"-Unterthemen bleiben aber jeweils eigene,
   klappbare Blöcke. */
export function parseTree(text) {
  const lines = text.split("\n");
  const pre = [];
  const sections = [];
  const chapters = [];
  let cur = null;
  let curSub = null;
  let chapterIdx = -1; // Index in chapters; -1 = noch kein REALES Kapitel eröffnet

  // Titelzeile per POSITION bestimmen (siehe Kopfkommentar): NUR wenn die
  // erste nicht-leere Zeile des Dokuments eine "# "-Zeile ist, ist GENAU
  // ihr Original-Index von der Kapitel-Erkennung ausgenommen.
  const firstContentIdx = lines.findIndex((l) => l.trim() !== "");
  const titleLineIdx =
    firstContentIdx !== -1 && /^#\s+/.test(lines[firstContentIdx]) ? firstContentIdx : -1;

  lines.forEach((line, idx) => {
    if (/^###\s+/.test(line)) {
      // v7.28-Fix (Nutzer-Befund, Live): ein "###"-Unterthema OHNE
      // vorausgehendes "##" bekam hier früher einen FABRIZIERTEN Abschnitt
      // "Allgemein" (Altlast der Referenz-App) – ein Titel, der im
      // Markdown selbst NIRGENDS steht. Anzeige/Leiste wichen dadurch vom
      // Dokument ab, und Chat-Ops konnten "Allgemein" nicht adressieren
      // (delete_section "Allgemein" fand nie ein "## Allgemein" und blieb
      // ein wirkungsloser No-op mit ⚠️). Jetzt exakt dasselbe Muster wie
      // beim impliziten titellosen KAPITEL weiter unten: title:null statt
      // eines erfundenen Namens – DocView/App.jsx rendern das bewusst
      // flach (kein Kopf/Klapp-Button), siehe dort.
      if (!cur) { cur = { title: null, lines: [], subs: [], chapter: chapterIdx }; sections.push(cur); }
      curSub = { title: line.replace(/^###\s+/, "").trim(), lines: [] };
      cur.subs.push(curSub);
    } else if (/^##\s+/.test(line)) {
      cur = { title: line.replace(/^##\s+/, "").trim(), lines: [], subs: [], chapter: chapterIdx };
      sections.push(cur);
      curSub = null;
    } else if (idx !== titleLineIdx && /^#\s+/.test(line)) {
      // Strukturelle Kapitelzeile (siehe Kopfkommentar) – jede "# "-Zeile
      // außer der einen Titelzeile, unabhängig davon, ob schon ein "##"
      // gesehen wurde.
      if (chapterIdx >= 0) chapters[chapterIdx].secTo = sections.length;
      else if (sections.length > 0) chapters.push({ title: null, secFrom: 0, secTo: sections.length, lines: [] }); // implizit, nur wenn nicht leer
      chapters.push({ title: line.replace(/^#\s+/, "").trim(), secFrom: sections.length, secTo: sections.length, lines: [] });
      chapterIdx = chapters.length - 1;
      cur = null;
      curSub = null;
    } else if (curSub) {
      curSub.lines.push({ text: line, idx });
    } else if (cur) {
      cur.lines.push({ text: line, idx });
    } else if (chapterIdx >= 0) {
      // v7.15-Fix (E2E-Finding 🟡): Freitext NACH einer #-Kapitelzeile, aber
      // VOR dem ersten ##-Abschnitt dieses Kapitels (oder ganz ohne jeden
      // ##-Abschnitt) gehört zum KAPITEL, nicht zu "pre" – vorher landete
      // er fälschlich ganz oben im Dokument, weit weg von seinem Kapitel-
      // Kopf (Repro: H1-Knopf im Editor + Absatztext direkt darunter ohne
      // ##, gespeichert – der Text erschien vor dem ersten Abschnitt
      // "Inbox" statt unter dem neuen Kapitel-Kopf).
      chapters[chapterIdx].lines.push({ text: line, idx });
    } else {
      pre.push({ text: line, idx });
    }
  });
  if (chapterIdx >= 0) chapters[chapterIdx].secTo = sections.length;
  // Abschnitte, die VOR dem ersten echten Kapitel entstanden sind, tragen
  // noch chapter:-1 (Wert von chapterIdx beim jeweiligen Push) – sie gehören
  // zum impliziten Kapitel 0 (das ist laut obiger Logik IMMER chapters[0],
  // sobald es überhaupt Kapitel gibt: der erste Kapitel-Durchlauf legt,
  // falls nötig, stets zuerst den impliziten Eintrag an). Gibt es gar keine
  // Kapitel, bleibt "chapter" ungenutzt – Konsumenten prüfen zuerst
  // chapters.length.
  if (chapters.length) {
    sections.forEach((s) => { if (s.chapter < 0) s.chapter = 0; });
  }
  return { pre, sections, chapters };
}

/* ---------------- HTML-Entity-Dekodierung (v7.24 Bugfix) ---------------- */
/* Nutzer-Befund: "<"/">" im Editor getippt erscheinen im Dokument-Viewer
   als "&lt;"/"&gt;" statt als die Zeichen selbst.

   Empirisch verifiziert (headless tiptap-Editor-Proben, siehe
   tests/markdown.test.jsx "Editor-Entities (v7.24 Bugfix)" – KEIN reines
   Markdown-Quelltext-Parsing, sondern echtes insertText() auf der
   ProseMirror-Transaction, damit die Probe wirklich GETIPPTEN Text und
   nicht das Parsen einer Markdown-Quelle misst): tiptap-markdown erzwingt
   html:true (Kopfkommentar der Datei, für <span>/<mark>/Formel-Tags nötig)
   und schützt sich dagegen, dass ein roher, getippter "<"/">" beim
   nächsten Laden versehentlich als HTML interpretiert wird – der TEXT-
   Node-Serializer (tiptap-markdown/src/extensions/nodes/text.js,
   escapeHTML) ersetzt daher IMMER "<"→"&lt;" und ">"→"&gt;". "&" bleibt
   dagegen IMMER unangetastet: weder escapeHTML noch prosemirror-markdowns
   eigenes esc() (zuständig für `*_~[]\`\\`) fassen ein "&" an. Ein von
   DIESEM Editor erzeugtes "&amp;" gibt es folglich NICHT – auch kein
   Doppel-Escape "&amp;lt;": ein wörtlich getipptes "&lt;" (vier Zeichen,
   kein "<") bleibt beim Speichern unverändert "&lt;", ununterscheidbar von
   einem getippten "<". Diese Ambiguität entsteht bereits IM EDITOR selbst
   (jedes Laden interpretiert gespeichertes "&lt;" wieder als "<") – der
   Viewer hier übernimmt bewusst dieselbe Lesart, statt eine zweite,
   abweichende Interpretation einzuführen.
   Codeblöcke/Codespans serialisieren NACHWEISLICH OHNE escapeHTML
   (CodeBlockExtension/FencedCodeBlock: `state.text(node.textContent,
   false)`; der code-Mark: `escape:false` in prosemirror-markdown,
   umgeht den Text-Node-Serializer komplett) – ihr Inhalt bleibt deshalb
   unangetastet und ruft diese Funktion nie auf (siehe CodeBlockView,
   code.jsx, und der `` `…` ``-Zweig unten in renderInline).

   Deshalb bewusst eine MINIMALE Whitelist – NUR die zwei nachweislich vom
   Editor erzeugten Entities, kein "&amp;"/"&quot;"/"&#39;" und keine
   generische Entity-Bibliothek: Ein Nutzer, der selbst wörtlich "&amp;"
   tippt oder einfügt (z. B. Copy&Paste von HTML-Quelltext), soll seinen
   Text nicht stillschweigend zu "&" umgedeutet bekommen. */
const HTML_ENTITY_RE = /&lt;|&gt;/g;
const HTML_ENTITY_MAP = { "&lt;": "<", "&gt;": ">" };
export function decodeBasicEntities(text) {
  return typeof text === "string" ? text.replace(HTML_ENTITY_RE, (m) => HTML_ENTITY_MAP[m]) : text;
}

/* ---------------- Inline-Rendering (rekursiv) ---------------- */

// Nur echte Farbwerte in Inline-Styles übernehmen (kein Weg für XSS).
const COLOR_OK = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\))$/;

// _-Emphase nur an Wortgrenzen (wie GFM): Unterstriche mitten im Wort –
// etwa in URLs von Quellen-Fußnoten – sind keine Auszeichnung.
//
// Links (v7.8, Nutzerwunsch "generische Links funktionieren"): VIER Formen
// werden erkannt, ausnahmslos nur mit http(s)-Schema (Defense-in-Depth wie
// schon bei renderWithCites, citations.jsx – kein javascript:/data:/…):
// (1) [Titel](url) – eine ECHTE OBERMENGE der bisherigen Quellen-Fußnote
//     [n](url): welche der beiden Darstellungen greift (hochgestellte Zahl
//     vs. normaler Link), entscheidet renderInline anhand des Titels
//     (reine Ziffern → Fußnote), NICHT diese Regex. renumberCitations
//     (weiter unten) bleibt UNVERÄNDERT und nummerierts weiterhin
//     ausschließlich [\d+](url) um – ein generischer Link wie
//     [2024-Bericht](url) ist für CITE_LINK_RE kein Treffer (Titel ist
//     nicht rein numerisch) und bleibt beim Umnummerieren unangetastet.
// (2) <url> – CommonMark-Autolink (auch das, was tiptap-markdown für einen
//     Link mit Text==URL serialisiert, siehe DocEditor.jsx).
// (3) eine nackte URL im Fließtext (letzte Alternative unten; renderInline
//     kürzt sie danach um abschließende Satzzeichen/eine unausgeglichene
//     schließende Klammer, GFM-ähnlich – siehe trimBareUrl).
// (4) <span>/<mark> (Farbe/Textmarker) wie bisher.
// Die Alternativen-REIHENFOLGE in dieser Regex entscheidet nur, welche
// Alternative an EIN UND DERSELBEN Position gewinnt (praktisch nur <url>
// vs. <span>/<mark>, beide beginnen mit "<" – inhaltlich überschneidungsfrei,
// da nur Erstere ein http(s)-Schema verlangt). Welche Alternative überhaupt
// zum Zug kommt, entscheidet dagegen die POSITION des frühesten Treffers
// im String (renderInline sucht je Durchlauf den am weitesten links
// stehenden Treffer): ein Codespan oder [Titel](url), der früher im Text
// beginnt als eine darin enthaltene nackte URL, konsumiert diese automatisch
// mit – z. B. bleibt eine URL INNERHALB eines Codespans Code (siehe Tests).
//
// Grammatik für die URL in [Titel](url)/[n](url): GENAU eine Ebene
// balancierter runder Klammern (Wikipedia: `.../Steak_(Fleisch)`), sonst
// weder Klammern noch Whitespace. Exportiert (Nachbesserung v7.8,
// Finding 1 des Re-Reviews), damit DocEditor.jsx (normalizeLinkUrl) beim
// Validieren einer neu eingegebenen URL EXAKT dieselbe Regel prüft statt
// eine zweite, per Hand synchron zu haltende Kopie zu pflegen (analog
// MATH_SERIALIZED_RE aus math.jsx, das DocEditor.jsx schon per
// `new RegExp(MATH_SERIALIZED_RE.source)` wiederverwendet statt zu
// duplizieren).
export const LINK_URL_RE = /https?:\/\/(?:[^\s()]|\([^\s()]*\))+/;
// Titellänge auf 300 Zeichen gecappt (Nachbesserung v7.8, Finding 3 des
// Re-Reviews): reale Linktitel sind kurz, aber ein UNGECAPPTES `[^\]\n]+`
// vor einer NICHT schließenden "]" lässt die Regex-Engine bei jedem
// Startindex ("[") den kompletten Rest der Zeile durchprobieren, bevor sie
// aufgibt – quadratisches Backtracking (gemessen: eine Zeile aus 20 000 "["
// ohne "]" brauchte 356 ms, 50 000 "[" 2,3 s pro INLINE_TOKEN_RE.exec).
// {1,300} begrenzt den Backtracking-Aufwand pro Startposition auf eine
// Konstante, macht den Gesamtaufwand wieder linear in der Zeilenlänge –
// ein Titel über 300 Zeichen ist ohnehin kein sinnvoller Linktitel und
// bleibt (wie bisher bei kaputten/unbekannten Mustern) einfach Klartext.
// Grammatik für eine NACKTE URL im Fließtext (letzte Alternative unten) –
// bewusst LOOSER als LINK_URL_RE (jedes Nicht-Whitespace/Nicht-"<>"-
// Zeichen, AUCH unbalancierte Klammern): die genaue Grenze zieht erst
// trimBareUrl (siehe renderInline unten) NACH dem Match. Exportiert (Review-
// Fix "Grammatik-Drift", v7.12): linkProviders.jsx dupliziert dieselbe
// Grammatik als NAKED_URL_SRC (Zirkelbezug-Grund wie bei LINK_URL_RE oben –
// linkProviders.jsx darf nicht von hier importieren) – ein Test
// (tests/resolveProviderLinkTitles.test.jsx) pinnt beide Module gegeneinander
// (`BARE_URL_INLINE_SRC === NAKED_URL_SRC`), damit künftige Änderungen HIER
// nicht unbemerkt von der Kopie dort abweichen.
export const BARE_URL_INLINE_SRC = "https?:\\/\\/[^\\s<>]+";
const INLINE_TOKEN_RE = new RegExp(
  "(\\*\\*[^*\\n]+\\*\\*|~~[^~\\n]+~~|\\*[^*\\n]+\\*|(?<![\\w\\d])_[^_\\n]+_(?![\\w\\d])|`[^`\\n]+`" +
  "|\\[[^\\]\\n]{1,300}\\]\\(" + LINK_URL_RE.source + "\\)" +
  "|<https?:\\/\\/[^\\s>]+>|<(?:span|mark)\\b[^>]*>|" + BARE_URL_INLINE_SRC + ")"
);

// Formeln ($…$, $$…$$, \$) werden NICHT als weitere Alternative in
// INLINE_TOKEN_RE eingebaut (Regex-Source-Konkatenation wäre fehleranfällig
// und würde die Formel-Regel aus math.jsx duplizieren). Stattdessen prüft
// renderInline beide Regexe parallel und lässt die früher beginnende
// gewinnen – bei Gleichstand die Formel. Das garantiert, dass fett/kursiv/
// Links eine Formel nie mitten durchschneiden: Läuft z. B. **fett** VOR
// einer Formel, gewinnt fett und reicht seinen Inhalt rekursiv an
// renderInline zurück, das die Formel darin beim nächsten Durchlauf erneut
// erkennt. Beginnt dagegen die Formel zuerst (z. B. "$x_i$" mit Unterstrich
// für den Index), kann die _-Emphase sie nicht anschneiden: Deren Regel
// verlangt ohnehin einen Unterstrich an einer Wortgrenze – ein Index-
// Unterstrich direkt hinter einem Buchstaben erfüllt das nie.

/* ---------------- Quellen-Fußnoten im Dokument ---------------- */
/* Konvention: [n](https://…) direkt hinter der belegten Aussage – ein
   Markdown-Link mit reiner Zahl als Text. Er übersteht den WYSIWYG-
   Roundtrip (Link-Extension) und wird hier als hochgestellte Zahl
   gerendert. Die Nummern vergibt renumberCitations dokumentweit.
   Die URL darf eine Ebene runder Klammern enthalten (Wikipedia!).
   WICHTIG (v7.8): CITE_LINK_RE/renumberCitations bleiben strikt auf DIESE
   Konvention beschränkt (Titel = \d+) – generische Links mit sprechendem
   Titel (siehe INLINE_TOKEN_RE oben) laufen zwar durch denselben Link-
   Mark im Editor, aber NIE durch renumberCitations, damit ein frei
   gewählter Titel nicht versehentlich dokumentweit durch eine Nummer
   ersetzt wird. */

// URL-Grammatik wiederverwendet aus LINK_URL_RE (siehe Kommentar bei
// INLINE_TOKEN_RE oben) – dieselbe Klammer-Regel wie beim generischen Link.
const CITE_LINK_RE = new RegExp("\\[(\\d+)\\]\\((" + LINK_URL_RE.source + ")\\)", "g");

// Fußnoten von Dokumentanfang bis -ende durchnummerieren: gleiche URL =
// gleiche Nummer (erste Fundstelle bestimmt die Reihenfolge). Wird bei
// jedem Schreiben angewendet, damit Einfügungen sauber umnummerieren.
// Codespans bleiben unangetastet (der Renderer zeigt sie literal).
// Fenced-Codeblöcke (```…```, v7.7) werden VORAB per splitFenceSegments
// komplett ausgenommen – ein "[1](https://…)" innerhalb eines Codeblocks
// (z. B. Beispiel-Markdown in einem Snippet) darf nicht umnummeriert
// werden, der Block bleibt byte-genau erhalten. numByUrl lebt bewusst
// AUSSERHALB der Segment-Schleife: die Nummerierung muss über Fence-
// Grenzen hinweg konsistent bleiben (dieselbe URL vor UND nach einem
// Codeblock bekommt weiterhin dieselbe Nummer).
export function renumberCitations(md) {
  const numByUrl = new Map();
  const renumberOutsideFences = (text) =>
    text
      .split(/(`[^`\n]+`)/)
      .map((seg, i) =>
        i % 2
          ? seg
          : seg.replace(CITE_LINK_RE, (m, num, url) => {
              if (!numByUrl.has(url)) numByUrl.set(url, numByUrl.size + 1);
              return "[" + numByUrl.get(url) + "](" + url + ")";
            })
      )
      .join("");
  return splitFenceSegments(String(md))
    .map((seg) => (seg.code ? seg.raw : renumberOutsideFences(seg.raw)))
    .join("\n");
}

// Passendes schließendes Tag finden (gleichnamige Verschachtelung mitzählen).
function findClose(text, from, tag) {
  const open = "<" + tag;
  const close = "</" + tag + ">";
  let depth = 1;
  let i = from;
  while (i < text.length) {
    const nextOpen = text.indexOf(open, i);
    const nextClose = text.indexOf(close, i);
    if (nextClose === -1) return -1;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + open.length;
    } else {
      depth--;
      if (!depth) return nextClose;
      i = nextClose + close.length;
    }
  }
  return -1;
}

// Aus dem öffnenden Tag nur die erlaubten Farb-Styles übernehmen.
function extractStyles(openTag, tag) {
  const style = {};
  const styleM = /style="([^"]*)"/.exec(openTag);
  const dataColorM = /data-color="([^"]*)"/.exec(openTag);
  for (const decl of styleM ? styleM[1].split(";") : []) {
    const at = decl.indexOf(":");
    if (at === -1) continue;
    const prop = decl.slice(0, at).trim().toLowerCase();
    const val = decl.slice(at + 1).trim();
    if (!COLOR_OK.test(val)) continue;
    if (tag === "span" && prop === "color") style.color = val;
    if (tag === "mark" && prop === "background-color") style.backgroundColor = val;
  }
  if (tag === "mark" && !style.backgroundColor && dataColorM && COLOR_OK.test(dataColorM[1])) {
    style.backgroundColor = dataColorM[1];
  }
  return style;
}

// GFM-ähnliches Trailing-Trimming für eine NACKTE URL im Fließtext (v7.8):
// abschließende Satzzeichen gehören fast immer zum umgebenden Satz, nicht
// zur URL ("Siehe https://x.de/a." soll den Punkt NICHT mitverlinken).
// Eine schließende ")" ist die Ausnahme: Sie bleibt Teil der URL, wenn sie
// eine im bereits akzeptierten Teil der URL offene "(" schließt (Wikipedia-
// Artikel mit Klammer im Titel, z. B. .../wiki/Steak_(Fleisch)) – sonst
// wird auch sie abgetrennt (z. B. eine URL in Klammern im Fließtext:
// "(https://x.de/a)" soll die Satzklammer nicht mitverlinken). v7.12
// (Review-Fix "Grammatik-Drift"): lebt jetzt EINMAL in linkProviders.jsx
// (dort exportiert, auch für resolveProviderLinkTitles/den Auto-Titel-
// Auflöser gebraucht) und wird hier importiert (siehe oben) – zirkelfrei,
// da linkProviders.jsx nichts aus dieser Datei importiert.

// Gemeinsame Optik für generische Links (Autolink, nackte URL UND
// [Titel](url) mit sprechendem Titel) – bewusst ANDERS als die kompakte
// Fußnoten-Optik (kleine hochgestellte Zahl), damit ein Link im Fließtext
// als solcher erkennbar ist. break-all verhindert, dass eine lange URL das
// mobile Layout sprengt (gleiche Sorge wie beim "break-words" der DocView).
const DOC_LINK_CLASS =
  "text-indigo-700 underline decoration-indigo-300 hover:decoration-indigo-600 break-all";

// Provider-Icon vor einem generischen Link (v7.9, Nutzerwunsch
// "DevOps/Confluence-Icons"): NUR aus dem URL-Präfix bestimmt (providerFor,
// lib/linkProviders.jsx – reine String-Prüfung, KEIN Netzzugriff, siehe
// Sicherheitsregel 2 im Auftrag), NIE vor einer Quellen-Fußnote (die läuft
// über einen eigenen Zweig in renderInline, der diese Komponente gar nicht
// aufruft, siehe unten). getLinkProviders() liest die Modul-Registry, die
// App.jsx beim Settings-Load/-Save befüllt (setLinkProviders) – kein neues
// Prop quer durch DocView hindurch nötig, analog zum bereits bestehenden
// Muster für Bild-/Toggle-Callbacks, nur eben ohne Callback (reiner Lesezugriff).
function ProviderLinkIcon({ url }) {
  const provider = providerFor(url, getLinkProviders());
  if (!provider) return null;
  return (
    <span className="inline-flex items-center align-middle mr-1" aria-hidden="true">
      <ProviderIcon provider={provider} />
    </span>
  );
}

// Zerlegt einen von INLINE_TOKEN_RE bereits erkannten "[Titel](url)"-Treffer
// in Titel/URL. War bislang eine zweite, im renderInline-Zweig ad-hoc
// gebaute Kopie derselben Obermengen-Regex (Review-Finding 3 des
// Re-Reviews: eine ungecappte Kopie hier hätte den Backtracking-Schutz von
// INLINE_TOKEN_RE oben wirkungslos gemacht, sobald dieser Zweig erreicht
// wird) – jetzt EIN Modul-Level-Konstrukt mit demselben {1,300}-Titel-Cap
// und derselben LINK_URL_RE-Klammergrammatik, einmalig kompiliert statt bei
// jedem Aufruf neu (wie TASK_RE/OL_RE oben).
const GENERIC_LINK_TOKEN_RE = new RegExp("^\\[([^\\]\\n]{1,300})\\]\\((" + LINK_URL_RE.source + ")\\)$");

function renderInline(text) {
  const parts = [];
  let k = 0;
  let s = text;
  while (s.length) {
    const otherM = INLINE_TOKEN_RE.exec(s);
    const mathM = MATH_TOKEN_RE.exec(s);
    // Bei Gleichstand gewinnt die Formel (siehe Kommentar bei INLINE_TOKEN_RE).
    const isMath = mathM && (!otherM || mathM.index <= otherM.index);
    const m = isMath ? mathM : otherM;
    // decodeBasicEntities NUR auf bereits als "kein Token" feststehenden
    // Text (v7.24 Bugfix, siehe Kommentar dort): INLINE_TOKEN_RE/MATH_TOKEN_RE
    // laufen HIER VORHER auf dem NOCH UNDEKODIERTEN "s" – ein escapetes
    // "&lt;span&gt;" (wörtlich getippter Text) matcht die Tag-Alternative
    // nie (die verlangt ein echtes "<"), wird also nie fälschlich zum
    // Formatierungs-Tag, selbst nachdem es hier zu sichtbarem "<span>"
    // dekodiert wird.
    if (!m) { parts.push(decodeBasicEntities(s)); break; }
    if (m.index > 0) parts.push(decodeBasicEntities(s.slice(0, m.index)));
    const tok = m[0];
    const after = m.index + tok.length;

    if (isMath) {
      parts.push(renderMathToken(tok, k++));
      s = s.slice(after);
      continue;
    }

    if (tok.startsWith("<")) {
      // Autolink <https://…> (v7.8): Anzeigetext = URL. Geprüft VOR der
      // <span>/<mark>-Erkennung, weil beide mit "<" beginnen – inhaltlich
      // überschneidungsfrei, da hier zusätzlich ein http(s)-Schema direkt
      // nach "<" verlangt wird (span/mark-Tags erfüllen das nie).
      const autoM = /^<(https?:\/\/[^\s>]+)>$/.exec(tok);
      if (autoM) {
        parts.push(<ProviderLinkIcon key={k++} url={autoM[1]} />);
        parts.push(
          <a
            key={k++}
            href={autoM[1]}
            target="_blank"
            rel="noopener noreferrer"
            title={autoM[1]}
            className={DOC_LINK_CLASS}
          >
            {autoM[1]}
          </a>
        );
        s = s.slice(after);
        continue;
      }
      const tag = tok.startsWith("<span") ? "span" : "mark";
      const closeAt = findClose(s, after, tag);
      if (closeAt === -1) {
        // kaputtes/unbekanntes Tag: als Text stehen lassen
        parts.push(tok);
        s = s.slice(after);
        continue;
      }
      const inner = renderInline(s.slice(after, closeAt));
      const style = extractStyles(tok, tag);
      parts.push(
        tag === "span"
          ? <span key={k++} style={style}>{inner}</span>
          : <mark key={k++} style={style} className="rounded px-0.5">{inner}</mark>
      );
      s = s.slice(closeAt + tag.length + 3); // "</" + tag + ">"
      continue;
    }

    if (tok.startsWith("http")) {
      // Nackte URL im Fließtext (v7.8): abschließende Satzzeichen/eine
      // unausgeglichene ")" gehören NICHT zur URL (trimBareUrl oben). Nur
      // der getrimmte Teil wird konsumiert – der Rest (z. B. ein
      // abgeschnittener Punkt) bleibt als normaler Text stehen und läuft
      // beim nächsten Schleifendurchlauf einfach mit durch.
      const url = trimBareUrl(tok);
      parts.push(<ProviderLinkIcon key={k++} url={url} />);
      parts.push(
        <a key={k++} href={url} target="_blank" rel="noopener noreferrer" title={url} className={DOC_LINK_CLASS}>
          {url}
        </a>
      );
      s = s.slice(m.index + url.length);
      continue;
    }

    if (tok.startsWith("[")) {
      const cm = GENERIC_LINK_TOKEN_RE.exec(tok);
      if (!cm) { parts.push(tok); s = s.slice(after); continue; }
      const [, title, url] = cm;
      // Reine Ziffern = Quellen-Fußnote (bisheriges Verhalten, von
      // renumberCitations dokumentweit durchnummeriert); jeder andere
      // Titel ist ein generischer Link mit eigener Optik (DOC_LINK_CLASS)
      // und rekursiv gerendertem Titel (damit z. B. **fett** im Linktext
      // funktioniert).
      if (/^\d+$/.test(title)) {
        parts.push(
          <sup key={k++} className="ml-0.5">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title={url}
              className="text-indigo-600 hover:underline font-medium no-underline"
            >
              [{title}]
            </a>
          </sup>
        );
      } else {
        parts.push(<ProviderLinkIcon key={k++} url={url} />);
        parts.push(
          <a key={k++} href={url} target="_blank" rel="noopener noreferrer" title={url} className={DOC_LINK_CLASS}>
            {renderInline(title)}
          </a>
        );
      }
    } else if (tok.startsWith("**")) {
      parts.push(<strong key={k++} className="font-semibold text-slate-900">{renderInline(tok.slice(2, -2))}</strong>);
    } else if (tok.startsWith("~~")) {
      parts.push(<s key={k++} className="text-slate-400">{renderInline(tok.slice(2, -2))}</s>);
    } else if (tok.startsWith("`")) {
      parts.push(<code key={k++} className="font-mono text-sm bg-slate-100 border border-slate-200 rounded px-1">{tok.slice(1, -1)}</code>);
    } else {
      parts.push(<em key={k++}>{renderInline(tok.slice(1, -1))}</em>);
    }
    s = s.slice(after);
  }
  return parts;
}

function Inline({ text }) {
  return <>{renderInline(text)}</>;
}

/* ---------------- Tabellen (GFM-Pipe-Format) ---------------- */

// Zelle: an unescapten Pipes trennen, \| in Zellen bleibt ein Pipe.
const splitRow = (line) =>
  line.trim().replace(/^\|/, "").replace(/\|\s*$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));

function renderTable(tlines, key) {
  let header = null;
  let bodyLines = tlines;
  if (tlines.length >= 2 && TABLE_SEP_RE.test(tlines[1])) {
    header = splitRow(tlines[0]);
    bodyLines = tlines.slice(2);
  }
  let body = bodyLines.filter((l) => !TABLE_SEP_RE.test(l)).map(splitRow);
  // Wie GFM: Datenzeilen auf die Kopfbreite bringen (kürzen bzw. mit
  // Leerzellen auffüllen), sonst verrutschen die Spalten.
  if (header) {
    body = body.map((row) =>
      row.length > header.length
        ? row.slice(0, header.length)
        : [...row, ...Array(header.length - row.length).fill("")]
    );
  }
  const thCls = "border border-slate-200 bg-slate-50 px-2 py-1 text-left font-semibold text-slate-800";
  const tdCls = "border border-slate-200 px-2 py-1 text-slate-700 align-top";
  return (
    <div key={key} className="overflow-x-auto my-3">
      <table className="border-collapse text-sm">
        {header && (
          <thead>
            <tr>{header.map((c, i) => <th key={i} className={thCls}><Inline text={c} /></th>)}</tr>
          </thead>
        )}
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri}>
              {row.map((c, ci) => <td key={ci} className={tdCls}><Inline text={c} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Block-Rendering ---------------- */

function renderBlocks(lines, imgMap, onImgClick, keyPrefix, onToggleTask) {
  const blocks = [];
  let list = null; // { type: "ul" | "ol" | "task", items: [] }
  let key = 0;
  const kp = keyPrefix || "b";

  const flush = () => {
    if (list && list.items.length) {
      if (list.type === "ol") {
        blocks.push(<ol key={kp + key++} className="list-decimal pl-5 mb-3 space-y-1">{list.items}</ol>);
      } else if (list.type === "task") {
        blocks.push(<ul key={kp + key++} className="pl-1 mb-3 space-y-1">{list.items}</ul>);
      } else {
        blocks.push(<ul key={kp + key++} className="list-disc pl-5 mb-3 space-y-1">{list.items}</ul>);
      }
    }
    list = null;
  };
  const ensure = (type) => {
    if (!list || list.type !== type) { flush(); list = { type, items: [] }; }
  };

  // Für matchDisplayBlock: reine Textzeilen ohne die {text, idx}-Hülle,
  // einmal vorab gebaut statt pro Zeile neu zu mappen.
  const rawLines = lines.map((l) => l.text);

  for (let li = 0; li < lines.length; li++) {
    const { text: line, idx } = lines[li];
    const imgM = IMG_LINE_RE.exec(line.trim());
    const taskM = TASK_RE.exec(line);
    // null bedeutet "kein sauberer, zeilenverankerter Block" (siehe
    // matchDisplayBlock in math.jsx) – die Zeile fällt dann bewusst durch
    // zu den späteren Zweigen (i. d. R. der normale Absatz-Zweig ganz
    // unten), wo renderInline/Inline "$$x$$ mehr Text" als eingebetteten
    // Display-Span erkennt bzw. eine unterminierte $$-Zeile literal lässt
    // (Review-Finding 4 – vorher wurde hier der Rest des Abschnitts als
    // TeX verschluckt). Codespans sind reines Inline-Markup (siehe
    // renderInline). Fenced-Codeblöcke (```…```, v7.7 – DECISIONS #14
    // damit aufgehoben) werden separat über fenceM erkannt (siehe unten);
    // sie stehen ZEILENANFANG-verankert wie mathBlock und werden deshalb
    // hier genauso vorab geprüft, bevor die Zeile in die übrigen Zweige
    // fallen kann.
    const mathBlock = DISPLAY_MATH_START_RE.test(line) ? matchDisplayBlock(rawLines, li) : null;
    // Unterminierter Zaun (kein ausreichend langer schließender Zaun bis
    // Abschnittsende, li läuft hier nie über die aktuelle Section/Sub-
    // Section hinaus, siehe parseTree) liefert null – die Zeile fällt dann
    // bewusst durch zu den normalen Zweigen unten und wird literal als
    // Absatz gerendert (keine INLINE_TOKEN_RE-Alternative matcht eine
    // ununterbrochene Backtick-Folge ohne weiteren Backtick später in der
    // Zeile, unabhängig von deren Länge), statt den Rest des Abschnitts zu
    // verschlucken (gleiche Philosophie wie matchDisplayBlock).
    const fenceM = FENCE_OPEN_RE.test(line) ? matchFenceBlock(rawLines, li) : null;
    if (fenceM) {
      // Inhalt bleibt byte-genau erhalten: KEIN renderInline, keine
      // Math-/Bild-/Fußnoten-/Checklisten-Logik innerhalb eines Codeblocks.
      flush();
      blocks.push(<CodeBlockView key={kp + key++} lang={fenceM.lang} code={fenceM.code} />);
      li = fenceM.endIdx;
    } else if (TABLE_LINE_RE.test(line)) {
      flush();
      const tlines = [line];
      while (li + 1 < lines.length && TABLE_LINE_RE.test(lines[li + 1].text)) {
        li++;
        tlines.push(lines[li].text);
      }
      blocks.push(renderTable(tlines, kp + key++));
    } else if (mathBlock) {
      flush();
      blocks.push(
        <div
          key={kp + key++}
          className="my-3 overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: renderKatexHtml(mathBlock.tex, true) }}
        />
      );
      li = mathBlock.endIdx;
    } else if (imgM) {
      flush();
      const [, altRaw, id] = imgM;
      // Optionaler Größen-Suffix aus dem Editor: "Titel|w320" → 320 px breit.
      const wM = /^(.*?)\|w(\d+)$/.exec(altRaw);
      const alt = wM ? wM[1] : altRaw;
      const width = wM ? parseInt(wM[2], 10) : null;
      const src = imgMap[id];
      // Der Titel (alt) bleibt bewusst nur als alt/title am <img> – keine
      // sichtbare figcaption mehr (v7.2, Nutzerwunsch): direkt darunter
      // folgt per Konvention die kursive Bildunterschrift als eigene
      // Markdown-Zeile, die fette figcaption wirkte wie ein Duplikat. Der
      // Titel steckt weiterhin im Markdown (![Titel](img:…)) – Roundtrip
      // bleibt unverändert, es wird nur nicht mehr zusätzlich gerendert.
      blocks.push(
        <figure key={kp + key++} className="my-3">
          {src ? (
            <img
              src={src}
              alt={alt}
              title={alt || undefined}
              onClick={() => onImgClick && onImgClick(src)}
              style={width ? { width: width + "px", maxWidth: "100%" } : undefined}
              className={(width ? "" : "max-h-64 ") + "rounded-lg border border-slate-200 shadow-sm cursor-pointer"}
            />
          ) : (
            <div className="h-24 flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-400 font-sans">
              Bild wird geladen …
            </div>
          )}
        </figure>
      );
    } else if (/^#\s+/.test(line)) {
      flush();
      blocks.push(<h1 key={kp + key++} className="text-xl font-bold text-slate-900 mb-2">{decodeBasicEntities(line.replace(/^#\s+/, ""))}</h1>);
    } else if (taskM) {
      ensure("task");
      const checked = taskM[2].toLowerCase() === "x";
      list.items.push(
        <li key={kp + key++} className="flex items-start gap-2 text-slate-700 leading-relaxed">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onToggleTask && onToggleTask(idx, !checked)}
            className="mt-1 shrink-0 accent-indigo-600 cursor-pointer"
          />
          <span className={checked ? "line-through text-slate-400" : ""}>
            <Inline text={taskM[4]} />
          </span>
        </li>
      );
    } else if (OL_RE.test(line)) {
      ensure("ol");
      list.items.push(
        <li key={kp + key++} className="text-slate-700 leading-relaxed">
          <Inline text={line.replace(/^\s*\d+[.)]\s+/, "")} />
        </li>
      );
    } else if (UL_RE.test(line)) {
      ensure("ul");
      list.items.push(
        <li key={kp + key++} className="text-slate-700 leading-relaxed">
          <Inline text={line.replace(/^\s*[-*]\s+/, "")} />
        </li>
      );
    } else if (/^-{3,}$/.test(line.trim())) {
      flush();
      blocks.push(<hr key={kp + key++} className="my-4 border-slate-200" />);
    } else if (line.trim() === "") {
      flush();
    } else {
      flush();
      blocks.push(<p key={kp + key++} className="text-slate-700 leading-relaxed mb-2"><Inline text={line} /></p>);
    }
  }
  flush();
  return blocks;
}

export function DocView({ text, collapsed, onToggle, imgMap, onImgClick, onToggleTask, anchorPrefix }) {
  const { pre, sections, chapters } = parseTree(text);
  const ap = anchorPrefix || "sec-";

  // Ein einzelnes ###-Unterthema unter einem Abschnitt – als Helfer
  // extrahiert (v7.28), weil er sowohl unter einer betitelten Sektion
  // (Klapp-Key "s:"+sec.title+"/"+sub.title, unverändert) als auch unter
  // einer TITELLOSEN Sektion gebraucht wird (verwaistes "###" ohne
  // vorausgehendes "##", siehe parseTree) – dort übergibt renderSection den
  // Key OHNE Sektionstitel ("s:/"+sub.title). Der aufrufende Renderer
  // bestimmt sk komplett, dieser Helfer kennt nur noch Sub/si/bi.
  const renderSub = (sk, sub, si, bi) => {
    const sc = !!collapsed[sk];
    return (
      <div key={sk + bi} className="mt-3 pl-3 border-l-2 border-slate-100">
        <button onClick={() => onToggle(sk)} className="flex items-center gap-1.5 text-left">
          <ChevronDown size={14} className={"text-slate-400 " + (sc ? "-rotate-90" : "")} />
          <span className="text-sm font-semibold text-slate-800">{decodeBasicEntities(sub.title)}</span>
        </button>
        {!sc && <div className="pt-1">{renderBlocks(sub.lines, imgMap, onImgClick, "s" + si + "b" + bi, onToggleTask)}</div>}
      </div>
    );
  };

  // Ein einzelner ##-Abschnitt (Kapitel-Zugehörigkeit spielt für seine
  // eigene Darstellung keine Rolle, siehe parseTree-Kopfkommentar): dieselbe
  // Optik wie vor v7.14, jetzt als Helfer, damit sie sowohl flach (kein
  // Kapitel bzw. implizites titelloses Kapitel) als auch innerhalb eines
  // Kapitel-Rahmens identisch aussieht.
  const renderSection = (sec, si) => {
    if (sec.title === null) {
      // Titellose Sektion (v7.28-Fix, Nutzer-Befund): entsteht in
      // parseTree, wenn ein "###"-Unterthema OHNE vorausgehendes "##" im
      // Dokument steht (früher fabrizierte parseTree hier fälschlich einen
      // Abschnitt "Allgemein", der im Markdown gar nicht existierte –
      // Anzeige != Datei). KEIN erfundener Kopf/Klapp-Button – "lines"
      // (praktisch immer leer, da vor dem ersten "###" hier nichts anderes
      // hinlangen kann außer über curSub/cur-Zuordnung in parseTree, aber
      // defensiv trotzdem gerendert) und "subs" erscheinen direkt, jedes
      // "###"-Unterthema behält seinen eigenen klappbaren H3-Kopf. Der
      // Anker (id=ap+si) bleibt trotzdem stehen: "sections" ist weiterhin
      // die FLACHE Liste mit globalem Index, Scroll-Spy/gotoSection/
      // gotoChapter in App.jsx adressieren ausschließlich darüber.
      return (
        <div key={"nullsec" + si} id={ap + si} className="mt-5">
          {renderBlocks(sec.lines, imgMap, onImgClick, "s" + si, onToggleTask)}
          {sec.subs.map((sub, bi) =>
            // Klapp-Key OHNE Sektionstitel: "s:/"+Sub-Titel statt bisher
            // "s:Allgemein/"+Sub-Titel. Alt-Klappzustände mit dem alten
            // "s:Allgemein/…"-Schlüssel in state.json verlieren dadurch
            // ihre Wirkung (kein Abschnitt heißt mehr so) – selbstheilend
            // beim nächsten Klick (der neue Key wird dann normal
            // persistiert), siehe DECISIONS. Kollisionsrisiko bewusst in
            // Kauf genommen (identisch zur bisherigen Grenze bei
            // "Allgemein/…"): gleichnamige verwaiste Subs in
            // VERSCHIEDENEN Kapiteln/Sektionen teilen sich diesen
            // Klapp-Zustand.
            renderSub("s:/" + sub.title, sub, si, bi)
          )}
        </div>
      );
    }
    const key = "s:" + sec.title;
    const isC = !!collapsed[key];
    return (
      <div key={key + si} id={ap + si} className="mt-5">
        <button
          onClick={() => onToggle(key)}
          className="w-full flex items-center gap-1.5 text-left pb-1 border-b border-slate-200"
        >
          <ChevronDown size={16} className={"text-slate-400 " + (isC ? "-rotate-90" : "")} />
          {/* Klapp-Key oben bleibt bewusst UNDEKODIERT (roher sec.title,
              stabil über state.json/collapsedAll hinweg persistiert) – nur
              die sichtbare Beschriftung wird dekodiert (v7.24 Bugfix). */}
          <span className="text-base font-semibold text-slate-900">{decodeBasicEntities(sec.title)}</span>
        </button>
        {!isC && (
          <div className="pt-2">
            {renderBlocks(sec.lines, imgMap, onImgClick, "s" + si, onToggleTask)}
            {sec.subs.map((sub, bi) => renderSub("s:" + sec.title + "/" + sub.title, sub, si, bi))}
          </div>
        )}
      </div>
    );
  };

  // Kapitel-Bereich [secFrom, secTo) rendern; leere Kapitel (noch keine
  // Abschnitte, z. B. gerade erst per Chat angelegt) bekommen trotzdem
  // einen Kopf, damit sie im Dokument sichtbar/klappbar sind.
  const sectionsOf = (chap) =>
    sections.slice(chap.secFrom, chap.secTo).map((sec, i) => renderSection(sec, chap.secFrom + i));

  const body = !chapters.length
    ? sections.map((sec, si) => renderSection(sec, si))
    : chapters.map((chap, ci) => {
        // Implizites titelloses Kapitel ("H2 vor dem ersten H1"): FLACH
        // gerendert wie vor v7.14 – kein zusätzlicher Kopf/Einrückung, sonst
        // bekäme jedes Dokument ohne "#"-Kapitel plötzlich einen leeren
        // Vorspann-Rahmen (siehe parseTree-Kommentar).
        if (chap.title === null) return sectionsOf(chap);
        const ck = "c:" + chap.title;
        const cIsC = !!collapsed[ck];
        return (
          <div key={"chap" + ci}>
            <div id={"chap-" + ci} className="mt-6">
              <button
                onClick={() => onToggle(ck)}
                className="w-full flex items-center gap-1.5 text-left pb-1.5 border-b-2 border-slate-300"
              >
                <ChevronDown size={17} className={"text-slate-500 shrink-0 " + (cIsC ? "-rotate-90" : "")} />
                <span className="text-lg font-bold text-slate-900">{decodeBasicEntities(chap.title)}</span>
              </button>
            </div>
            {/* Eingeklapptes Kapitel verbirgt ALLE seine Abschnitte (samt
                ihrer eigenen Köpfe) – anders als ein eingeklappter ##-
                Abschnitt, der seinen eigenen Kopf sichtbar behält. Freitext
                DIREKT unter der Kapitelzeile (v7.15-Fix) klappt genauso mit
                ein/aus und steht VOR den (eingerückten) Abschnitten. */}
            {!cIsC && (
              <>
                {/* Nur bei ECHTEM Inhalt rendern: die übliche Leerzeile nach
                    der Kapitelzeile landet ebenfalls in chap.lines und würde
                    sonst einen leeren pt-2-Div (Extra-Abstand) erzeugen
                    (Re-Review-Finding v7.15). */}
                {chap.lines.some((l) => l.text.trim() !== "") && (
                  <div className="pt-2">{renderBlocks(chap.lines, imgMap, onImgClick, "chap" + ci, onToggleTask)}</div>
                )}
                {sectionsOf(chap)}
              </>
            )}
          </div>
        );
      });

  return (
    // Gleiche Schriftart/-größe wie der Chat (Nutzerwunsch); Hierarchie nur
    // noch über Größe/Gewicht der Überschriften.
    // break-words: lange Code-Tokens/URLs dürfen die Seite auf dem Handy
    // nicht über die Gerätebreite hinausschieben.
    <div className="font-sans text-sm break-words">
      {renderBlocks(pre, imgMap, onImgClick, "pre", onToggleTask)}
      {body}
    </div>
  );
}
