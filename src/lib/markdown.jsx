/* ------------------------------------------------------------------ */
/* Markdown: Baum-Parser & Block-Renderer                              */
/* Basis aus der Referenz-App (Artifact v3.1); erweitert um:           */
/* ~~durchgestrichen~~, Schriftfarbe (<span style="color:…">),         */
/* Textmarker (<mark …>), nummerierte Listen und Checklisten mit       */
/* klickbaren Kästchen (Zeilen behalten dafür ihren Original-Index).   */
/* ------------------------------------------------------------------ */

import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import {
  MATH_TOKEN_RE, renderMathToken, renderKatexHtml,
  DISPLAY_MATH_START_RE, matchDisplayBlock,
} from "./math.jsx";
import { FENCE_OPEN_RE, matchFenceBlock, splitFenceSegments, CodeBlockView, computeFenceLineMask } from "./code.jsx";
import { providerFor, getLinkProviders, ProviderIcon, trimBareUrl } from "./linkProviders.jsx";
import { FILE_URL_RE, fileUrlToWinPath, buildProtocolUrl } from "./filelinks.js";

export const IMG_LINE_RE = /^!\[([^\]]*)\]\(img:([a-zA-Z0-9]+)\)$/;
export const IMG_REF_RE = /!\[[^\]]*\]\(img:([a-zA-Z0-9]+)\)/g;

// v7.45-Fix (Datenkorruption, E2E-Finding 🔴): Das ursprüngliche "\]\s+"
// verlangte nach "]" MINDESTENS ein Leerzeichen – ein bewusst LEER
// angelegter Checkbox-Punkt ("- [ ]" ohne jeden Folgetext, z. B. per Enter
// im Editor erzeugt) endet aber je nach Speicherpfad OHNE dieses
// Leerzeichen (siehe DECISIONS: prosemirror-markdown schreibt zwar "[ ] ",
// aber ein "trim()" am Dokumentende in App.jsx#saveEdit frisst das
// Leerzeichen der LETZTEN Zeile; markdown-it selbst schneidet es beim
// erneuten Laden über ALLE Positionen hinweg ohnehin ab, siehe unten) –
// "- [ ]" fiel dadurch durch UL_RE in den normalen Aufzählungs-Zweig und
// "[ ]" erschien als bedeutungsloser Literaltext.
//
// Die Alternative "\]\s*$" (zusätzlich zu "\]\s+") lässt eine leere Klammer
// GENAU dann ohne jedes Leerzeichen zu, wenn NACH ihr nichts mehr folgt
// (Zeilenende) – "\]\s+" bleibt für JEDEN Fall mit echtem Folgetext
// weiterhin verbindlich. Das verhindert eine sonst neu eingeführte
// Fehldeutung: Ein (in der Praxis nie absichtlich getipptes, aber
// theoretisch denkbares) "- [ ]Text" OHNE jedes Trennzeichen zwischen "]"
// und "Text" bleibt bewusst weiterhin KEINE Checkbox (wie schon vor diesem
// Fix) – markdown-it-task-lists verlangt beim Laden ebenfalls zwingend ein
// Leerzeichen direkt nach "] ", ein hier abweichend permissiveres "\]\s*"
// ohne Endanker hätte Editor und Viewer auseinanderlaufen lassen (siehe
// DECISIONS #91 für den vollständigen Soll/Ist-Vergleich).
//
// Die vier Capture-Gruppen (Marker+"[", Zustand, "]"+Trennzeichen, Rest-
// text) bleiben UNVERÄNDERT in Bedeutung und Reihenfolge – toggleTask
// (App.jsx) baut die Zeile aus genau diesen vier Teilen wieder zusammen
// und renderBlocks (unten) liest taskM[2]/taskM[4].
export const TASK_RE = /^(\s*[-*]\s+\[)( |x|X)(\]\s+|\]\s*$)(.*)$/;
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

   FENCE-AWARE seit v7.33 (DECISIONS #75, supersedet #54/#60 – E2E-Finding
   🔴 A): "#"/"##"/"###"-Zeilen INNERHALB eines geschlossenen ```-Codeblocks
   zählen NICHT mehr als Struktur-Grenze (Kapitel/Abschnitt/Unterthema) –
   sie bleiben Inhalt des jeweils AKTUELLEN Kontexts (pre/Kapitel/Abschnitt/
   Unterthema), computeFenceLineMask (code.jsx, EINE Quelle der Wahrheit mit
   ops.js) markiert sie vorab. Vorher zerriss z. B. ein Bash-Kommentar
   ("# Löscht alle .tmp-Dateien …") als Codeblock-Inhalt den Block in
   mehrere Phantom-Kapitel UND rendererte die Zäune selbst als Klartext
   (renderBlocks bekam wegen des Section-Zerfalls nie mehr den kompletten,
   zusammenhängenden Block zu sehen, siehe DECISIONS #75). UNTERMINIERTE
   Zäune bleiben bewusst UNMARKIERT (siehe computeFenceLineMask) – ab dort
   gilt wieder die alte, fence-blinde Erkennung bis Dokumentende (ein
   vergessener Schluss-Zaun soll nicht das halbe Dokument strukturlos
   machen).

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
  // ihr Original-Index von der Kapitel-Erkennung ausgenommen. KEINE
  // Fence-Sonderbehandlung nötig (Konsistenz-Hinweis, wie in ops.js#
  // titleLineIdx dokumentiert): Ein Fence müsste bereits VOR der ersten
  // nicht-leeren Zeile geöffnet UND wieder geschlossen sein, damit
  // "firstContentIdx" überhaupt in einem Codeblock läge – strukturell
  // unmöglich, die erste nicht-leere Zeile IST der öffnende Zaun selbst
  // (matcht nie "^#\s+", da er mit Backticks beginnt).
  const firstContentIdx = lines.findIndex((l) => l.trim() !== "");
  const titleLineIdx =
    firstContentIdx !== -1 && /^#\s+/.test(lines[firstContentIdx]) ? firstContentIdx : -1;

  // Fence-Maske (v7.33, DECISIONS #75): Zeilen INNERHALB eines
  // geschlossenen ```-Codeblocks (Zaun-Zeilen inklusive) zählen unten NIE
  // als #/##/###-Struktur-Grenze, unabhängig vom aktuellen Kontext
  // (pre/Kapitel/Abschnitt/Unterthema) – sie fallen stattdessen normal in
  // die curSub/cur/chapters/pre-Zweige weiter unten, GENAU wie jede andere
  // Nicht-Struktur-Zeile. Dadurch bleibt ein mehrzeiliger Fence über
  // Struktur-Zeilen hinweg IMMER im selben "lines"-Array desselben
  // Abschnitts – renderBlocks (siehe dort) erkennt ihn dann wieder
  // zusammenhängend, weil seine Zeilen positionsgleich aufeinanderfolgen.
  const fenceMask = computeFenceLineMask(lines);

  lines.forEach((line, idx) => {
    if (!fenceMask[idx] && /^###\s+/.test(line)) {
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
    } else if (!fenceMask[idx] && /^##\s+/.test(line)) {
      cur = { title: line.replace(/^##\s+/, "").trim(), lines: [], subs: [], chapter: chapterIdx };
      sections.push(cur);
      curSub = null;
    } else if (!fenceMask[idx] && idx !== titleLineIdx && /^#\s+/.test(line)) {
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

// file:-Links (v7.31, Nutzer-Befund Live): "[Titel](file:///…)" soll wie ein
// generischer http(s)-Link gerendert werden, NIE als Klartext. Die
// file:-Grammatik (FILE_URL_RE) lebt in filelinks.js (BLATT, siehe dortiger
// Kopfkommentar) – markdown.jsx importiert sie NUR für die
// "[Titel](url)"-Alternative unten (Klammer-Form). NICHT eingemischt in
// LINK_URL_RE selbst: CITE_LINK_RE/renumberCitations (weiter unten) bleiben
// dadurch STRUKTURELL http(s)-only (unverändert, wie im Auftrag gefordert) –
// eine Quellen-Fußnote [n](url) kann nie ein file:-Link sein.
// LINK_OR_FILE_URL_SRC deckt NUR http(s) ODER GENAU unsere file:-Grammatik ab
// – strukturell bleibt jedes andere Schema (javascript:/data:/…) unmöglich.
const LINK_OR_FILE_URL_SRC = "(?:" + LINK_URL_RE.source + "|" + FILE_URL_RE.source + ")";
const INLINE_TOKEN_RE = new RegExp(
  "(\\*\\*[^*\\n]+\\*\\*|~~[^~\\n]+~~|\\*[^*\\n]+\\*|(?<![\\w\\d])_[^_\\n]+_(?![\\w\\d])|`[^`\\n]+`" +
  "|\\[[^\\]\\n]{1,300}\\]\\(" + LINK_OR_FILE_URL_SRC + "\\)" +
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
const GENERIC_LINK_TOKEN_RE = new RegExp("^\\[([^\\]\\n]{1,300})\\]\\((" + LINK_OR_FILE_URL_SRC + ")\\)$");

// file:-Link-Komponente (v7.31, Direkt-Navigation v7.36 – siehe DECISIONS
// #79 "Review-Nachbesserung 5" für den vollständigen Live-Befund): Browser
// blockieren die Navigation von einer https-Seite (GitHub Pages) zu file://
// aus Sicherheitsgründen – ein Klick tut dort meist NICHTS Sichtbares (nur
// eine lokal geöffnete App oder eine Browser-Extension navigiert wirklich).
// Deshalb kopiert der Klick ZUSÄTZLICH den Windows-Pfad (Backslash-Form,
// fileUrlToWinPath aus filelinks.js) in die Zwischenablage, mit kurzem
// Inline-Feedback. KEIN preventDefault: die Navigation zum href MUSS ganz
// normal stattfinden – der Klick tut NUR zusätzlich etwas, verhindert
// nichts. Kein Provider-Icon (file:-Ziele haben keinen Provider, providerFor
// prüft ohnehin nur http(s), siehe linkProviders.jsx).
//
// v7.35 → v7.36: DIREKTE TOP-LEVEL-NAVIGATION statt Iframe-Trigger.
// v7.35 hatte den Klick ZUSÄTZLICH über ein unsichtbares <iframe> das eigene
// "notizbuch-open:"-Protokoll auslösen lassen (buildProtocolUrl,
// filelinks.js), während href weiterhin die file:-URL blieb. LIVE-BEFUND
// nach der v7.35-Installation (siehe DECISIONS #79): Der Handler UND die
// Windows-Protokollauflösung funktionieren nachweislich (Direktaufruf sowie
// "Start-Process notizbuch-open:...​" lösen zuverlässig aus, Log-Eintrag
// entsteht) – aber der Iframe-Trigger löst im echten Browser NICHTS aus,
// weder Variante "verstecktes iframe" noch "programmatisch erzeugter Anchor
// + .click()" (beide mit echter User-Geste getestet). Genau die in v7.35
// als "GEPLANTE, NICHT umgesetzte Option" dokumentierte Bedingung ist damit
// eingetreten: Chromium lässt externe Custom-Protocol-Starts aus einem
// Iframe/programmatischen Klick nicht mehr zu – nur eine ECHTE, vom Nutzer
// direkt angeklickte <a href>-TOP-LEVEL-Navigation zu einem Custom-Scheme
// wird noch akzeptiert (derselbe Weg, den z. B. VS Code für "vscode://…"
// nutzt). Deshalb jetzt: href IST bei einem Laufwerkspfad direkt die
// "notizbuch-open:v1?path=…"-Kontrakt-URL (buildProtocolUrl liefert null
// für UNC-Ziele – der Handler lehnt UNC grundsätzlich ab, SMB-Credential-
// Leak-Risiko –, dann bleibt href wie bisher die file:-URL). Der Klick ist
// damit eine ganz normale Browser-Navigation, kein JS-Trigger mehr nötig
// (triggerProtocolOpen/Iframe-Mechanik ersatzlos entfernt).
//
// Bewusst in Kauf genommen (siehe DECISIONS #79): Auf einem Rechner OHNE
// installierten Handler (Opt-in-Setup, siehe tools/notizbuch-open-setup.ps1)
// zeigt der Klick jetzt eine browsereigene Fehlermeldung ("Für dieses
// Protokoll ist keine App verknüpft" o. Ä.) statt still nichts zu tun –
// die frühere v7.35-Begründung für das Iframe ("keine sichtbare Fehlerseite
// beim Klick") ist durch den Live-Befund überholt: das Iframe verhinderte
// die Fehlerseite nur, weil es GENERELL nichts auslöste, auch nicht bei
// installiertem Handler. Ein funktionierender Klick für Nutzer MIT Handler
// war die ausdrückliche Priorität, eine zusätzliche Fehlermeldung für
// Nutzer OHNE Handler der bewusst akzeptierte Preis dafür.
//
// KEIN target="_blank": Bei einem Klick auf einen Custom-Scheme-Link in
// einem NEUEN Tab (target="_blank") bliebe dieser neue, leere Tab nach dem
// Hand-off an die externe App bestehen (der Browser kann ihn nicht einfach
// wieder schließen) – ein sichtbarer, verwirrender Nebeneffekt. Ohne
// target bleibt es bei genau der aktuellen Seite/demselben Tab (siehe auch
// bestehenden Test "KEIN target=_blank/rel-Attribut" unten).
//
// KEINE Zwischenablage-Kopie mehr (v7.39, Live-Befund + Nutzerwunsch nach
// erfolgreichem Live-Test): Bis v7.38 kopierte JEDER Klick zusätzlich den
// Windows-Pfad in die Zwischenablage (navigator.clipboard.writeText) – ein
// Rückfallweg aus der Zeit, in der der Protokollstart selbst noch nicht
// zuverlässig funktionierte (siehe DECISIONS #79, "Architektur-Wechsel
// v7.38"). Seit der Protokollstart LIVE bestätigt funktioniert (auch mit
// Leerzeichen im Pfad), ist die Kopie nicht mehr Rückfallweg, sondern reiner
// Schaden: sie überschreibt ungefragt den bisherigen Zwischenablage-Inhalt
// des Nutzers UND der Hinweistext "Pfad kopiert" irritiert, weil gar nichts
// mehr kopiert wird. Ersatzlos entfernt – kein anderer Code-Pfad in der App
// braucht den bisher aus winPath abgeleiteten Zwischenablage-Wert (winPath
// wird unten NUR NOCH für den Tooltip/title gebraucht, siehe dort).
function FileLink({ url, title }) {
  const winPath = fileUrlToWinPath(url);
  // protocolUrl ist null für ein UNC-Ziel (buildProtocolUrl lehnt UNC-Pfade
  // bewusst ab, siehe SICHERHEIT-Kommentar in filelinks.js/SMB-Credential-
  // Leak-Risiko) – href bleibt in diesem Fall unverändert die file:-URL.
  // Ein Klick darauf navigiert zwar (kein preventDefault, siehe unten),
  // öffnet aus dem https-Kontext dieser App heraus aber NACHWEISLICH NICHTS
  // (Browser dürfen nicht von https zu file:// navigieren, siehe
  // Kopfkommentar filelinks.js) – das Inline-Feedback unten wird deshalb
  // NUR gezeigt, wenn tatsächlich ein Öffnen-Versuch stattfindet (v7.39,
  // Auftrag Punkt 3: "wird geöffnet …" darf nicht erscheinen, wenn
  // nachweislich nichts geöffnet wird). NICHT dieselbe Wortwahl wie unten,
  // aber KEIN Over-Engineering (Auftrag): kein zusätzlicher abweichender
  // Hinweistext für diesen seltenen Randfall – die Datei bleibt trotzdem
  // klickbar/mit Tooltip erkennbar, nur eben ohne das kurze Erfolgs-Feedback.
  const protocolUrl = buildProtocolUrl(url);
  const href = protocolUrl ?? url;
  const [opening, setOpening] = useState(false);
  // Timer-ID in einem Ref (Review-Fix 🔵 Finding 4, v7.31 – Logik
  // UNVERÄNDERT beibehalten, siehe Auftrag Punkt 2): ein zweiter Klick VOR
  // Ablauf des Timers löschte bisher NICHT den bereits laufenden Timer –
  // der ERSTE Timer blendete das Feedback dann verfrüht aus, obwohl der
  // ZWEITE Klick es gerade erst wieder eingeblendet hatte. clearTimeout vor
  // jedem neuen Start UND beim Unmount (useEffect-Cleanup unten, falls der
  // Nutzer wegnavigiert/das Dokument neu rendert, bevor die Zeit um ist).
  const timerRef = useRef(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  // Anzeigedauer AUF 1 S VERKÜRZT (v7.39, bewusste Entscheidung, Auftrag
  // Punkt 2): Die bisherigen 1,5 s waren auf "Pfad kopiert" zugeschnitten –
  // ein Hinweis, den man sich kurz merken musste, um ihn danach aktiv zu
  // NUTZEN (Einfügen aus der Zwischenablage). "wird geöffnet …" ist dagegen
  // eine rein transiente Status-Info OHNE eigene Folgehandlung des Nutzers –
  // 1 s reicht, um den Klick als registriert wahrzunehmen, während Windows
  // parallel sichtbar das externe Programm startet, ohne dass der Hinweis
  // unnötig lange stehen bleibt.
  const handleClick = () => {
    // UNC-Ziel: siehe Kommentar bei protocolUrl oben – kein Feedback, weil
    // nachweislich nichts geöffnet wird.
    if (!protocolUrl) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setOpening(true);
    timerRef.current = setTimeout(() => {
      setOpening(false);
      timerRef.current = null;
    }, 1000);
  };
  return (
    <>
      <a href={href} title={winPath} className={DOC_LINK_CLASS} onClick={handleClick}>
        {renderInline(title)}
      </a>
      {opening && <span className="ml-1 text-xs text-emerald-600 align-middle">wird geöffnet …</span>}
    </>
  );
}

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
      // Reine Ziffern UND http(s)-Ziel = Quellen-Fußnote (bisheriges
      // Verhalten, von renumberCitations dokumentweit durchnummeriert – DAS
      // bleibt strikt http(s)-only, siehe CITE_LINK_RE weiter unten); jeder
      // andere Titel ODER ein file:-Ziel ist ein generischer Link. v7.31:
      // ein file:-Link ist IMMER ein generischer Link, NIE eine Fußnote,
      // auch bei rein numerischem Titel ([3](file:///…) bleibt normaler
      // Link) – renumberCitations nummeriert file:-Links ohnehin nie um
      // (CITE_LINK_RE matcht sie strukturell nicht), eine Fußnoten-Optik
      // dafür wäre also irreführend (keine echte, umnummerierbare Quelle).
      const isFileLink = /^file:\/\//i.test(url);
      if (/^\d+$/.test(title) && !isFileLink) {
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
      } else if (isFileLink) {
        parts.push(<FileLink key={k++} url={url} title={title} />);
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

/* ---------------- Umbrüche/Aufzählungen in Tabellenzellen (v7.44) ---------------- */
/* Nutzerwunsch ("Umbrüche und Aufzählungen in Tabellenzellen wäre aber
   schon schön…"), Diagnose war nur zur Hälfte richtig: Der EDITOR
   serialisiert einen harten Zeilenumbruch in einer Tabellenzelle bereits
   als "<br>" (MdTable/DocEditor.jsx setzt dafür state.inTable=true, GFM
   selbst kennt zwar keine echte mehrzeilige Zelle, aber "<br>" als
   Inline-HTML ist eine verbreitete, auch von markdown-it (html:true)
   unterstützte Konvention). Die LÜCKE war ausschließlich der Renderer
   hier: "<br>" kam in dieser Datei nirgends vor, renderTable schob den
   Zelltext unverändert durch <Inline>, ein "<br>" erschien deshalb als
   Literaltext statt als Umbruch.

   splitCellLines zerlegt den rohen Zelltext an "<br>"/"<br/>"/"<br />"
   (case-insensitiv, wie im Editor-Output plus robust gegenüber von Hand
   editiertem/eingefügtem Markdown) – ABER schützt zwei Konstrukte davor,
   selbst aufgetrennt zu werden (Auftrag: "ein <br> INNERHALB eines
   Codespans oder einer Formel bleibt Literaltext"):
   - Codespans (`…`): reiner Verbatim-Text, ein "<br>" darin ist Teil des
     Codes, kein Umbruch.
   - Formeln ($…$/$$…$$, MATH_TOKEN_RE): TeX-Quelltext, ebenfalls Verbatim.
   ZUSÄTZLICH (nicht im Auftrag ausdrücklich verlangt, aber ohne das würde
   ein hart umbrochener Farb-/Marker-Span kaputtes HTML erzeugen): auch
   ein "<span>…</span>"/"<mark>…</mark>"-Block wird als GANZES geschützt
   (via findClose, derselbe Helfer wie in renderInline) – ein "<br>", der
   SELTEN (z. B. bei hart umbrochenem farbigem Text) INNERHALB eines
   solchen Spans steht, würde dessen öffnendes/schließendes Tag sonst auf
   zwei getrennte "Zeilen" verteilen; jede Hälfte für sich wäre dann ein
   kaputtes, unbalanciertes Tag (siehe renderInline: ein Tag ohne
   Gegenstück bleibt dort ohnehin Literaltext – kein Absturz, aber
   hässlich). Alles ANDERE (Links, generischer Text, `**`/`~~`/`_`) bleibt
   UNGESCHÜTZT: ein "<br>" DAZWISCHEN ist der Normalfall (neue Zeile
   zwischen zwei Sätzen/Listenpunkten) und MUSS einen echten Umbruch
   erzeugen. Bewusst akzeptierte Grenze: ein "<br>" mitten IN einem
   "[Titel](url)" (z. B. absichtlich hart umbrochener Linktitel – in der
   Praxis extrem unüblich) wird trotzdem aufgetrennt; das Ergebnis ist
   dann zwar keine funktionierende Verlinkung mehr auf beiden Zeilen,
   aber auch kein kaputtes HTML (Klammern sind kein Markup) – reines
   GIGO, wie an vielen anderen Stellen dieser Datei bereits (z. B.
   INLINE_TOKEN_RE-Titel-Cap) toleriert.
   Ohne jedes "<br>" liefert die Funktion IMMER genau EIN Element, dessen
   Inhalt byte-identisch zum Original ist (jeder Zweig der Schleife hängt
   exakt das anwendete Fragment an) – das bestehende Verhalten für
   "normale" (bisher einzige mögliche) Zellen bleibt dadurch unverändert. */
// Exportiert (wie indentLevel/decodeBasicEntities oben), damit Tests die
// reine Split-Logik (inkl. Codespan-/Formel-/Span-Schutz) direkt prüfen
// können, statt sie über gerendertes HTML zurückzurechnen.
export const CELL_BR_RE = /^<br\s*\/?>/i;
export function splitCellLines(text) {
  const s = String(text ?? "");
  const lines = [""];
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    const codeM = /^`[^`\n]+`/.exec(rest);
    if (codeM) { lines[lines.length - 1] += codeM[0]; i += codeM[0].length; continue; }
    const mathM = MATH_TOKEN_RE.exec(rest);
    if (mathM && mathM.index === 0) { lines[lines.length - 1] += mathM[0]; i += mathM[0].length; continue; }
    const tagM = /^<(span|mark)\b[^>]*>/.exec(rest); // dieselbe Tag-Konvention wie renderInline (case-sensitiv, nur lowercase)
    if (tagM) {
      const closeAt = findClose(rest, tagM[0].length, tagM[1]);
      if (closeAt !== -1) {
        const whole = rest.slice(0, closeAt + tagM[1].length + 3); // "</" + tag + ">"
        lines[lines.length - 1] += whole;
        i += whole.length;
        continue;
      }
      // Kaputtes/unbekanntes Tag ohne Gegenstück: kein Sonderfall nötig,
      // fällt unten Zeichen für Zeichen in den Default-Zweig (renderInline
      // zeigt es später ohnehin literal, siehe dort).
    }
    const brM = CELL_BR_RE.exec(rest);
    if (brM) { lines.push(""); i += brM[0].length; continue; }
    lines[lines.length - 1] += rest[0];
    i += 1;
  }
  return lines;
}

// Eine mit "- "/"* " bzw. "N. "/"N) " beginnende Zeile INNERHALB einer
// Zelle wird zur kompakten <ul>/<ol> gruppiert (Auftrag: "Aufzählungen …
// kompakt, ohne die Zeilenhöhe der Tabelle zu sprengen" + "auch
// nummerierte Zeilen sinnvoll abdecken"). UL_RE/OL_RE sind dieselben
// Regeln wie im Block-Renderer (renderBlocks) weiter unten – KEINE eigene
// Kopie, damit eine Zelle exakt dieselbe Listensyntax akzeptiert wie ein
// normaler Absatz. my-0/space-y-0 statt der Block-Varianten mb-3/space-y-1
// (renderBlocks) hält die Tabellenzeile kompakt, wie gefordert.
function renderCellLines(lines) {
  const nodes = [];
  let i = 0;
  let k = 0;
  // Trennt zwei AUFEINANDERFOLGENDE einfache Zeilen durch einen ECHTEN
  // <br/> (dieselbe Optik wie im Editor getippt) – ein <ul>/<ol> ist
  // dagegen bereits selbst block-level und braucht KEINEN zusätzlichen
  // <br/> davor/danach (siehe die beiden Zweige unten).
  let afterPlainLine = false;
  while (i < lines.length) {
    const line = lines[i];
    if (UL_RE.test(line)) {
      const items = [];
      while (i < lines.length && UL_RE.test(lines[i])) {
        items.push(<li key={k++}><Inline text={lines[i].replace(/^\s*[-*]\s+/, "")} /></li>);
        i++;
      }
      nodes.push(<ul key={k++} className="list-disc pl-4 my-0 space-y-0">{items}</ul>);
      afterPlainLine = false;
      continue;
    }
    if (OL_RE.test(line)) {
      const numM = /^\s*(\d+)[.)]\s+/.exec(line);
      const start = numM ? parseInt(numM[1], 10) : 1;
      const items = [];
      while (i < lines.length && OL_RE.test(lines[i])) {
        items.push(<li key={k++}><Inline text={lines[i].replace(/^\s*\d+[.)]\s+/, "")} /></li>);
        i++;
      }
      nodes.push(
        <ol key={k++} start={start > 1 ? start : undefined} className="list-decimal pl-4 my-0 space-y-0">
          {items}
        </ol>
      );
      afterPlainLine = false;
      continue;
    }
    // Einfache Zeile (auch eine LEERE, z. B. "<br><br>" fuer eine
    // bewusste Leerzeile in der Zelle, oder ein abschliessendes "<br>" ohne
    // Folgetext, das der EDITOR selbst so nie erzeugt, siehe MdTable/
    // ProseMirror-Standardverhalten - GIGO/von Hand editiertes Markdown
    // kann das aber): <Inline> mit leerem Text rendert einfach nichts, das
    // vorangestellte <br/> (bei zwei Leerzeilen hintereinander also ZWEI
    // <br/> in Folge) sorgt trotzdem fuer die sichtbare Luecke.
    if (afterPlainLine) nodes.push(<br key={k++} />);
    nodes.push(<Inline key={k++} text={line} />);
    afterPlainLine = true;
    i++;
  }
  return nodes;
}

// Zell-Inhalt: der Normalfall (keine "<br>" in der Zelle) liefert exakt
// dasselbe Markup wie vor v7.44 (<Inline text={text} />, KEIN zusätzlicher
// Wrapper) – reine Fallunterscheidung, keine Verhaltensänderung für
// bestehende Tabellen ohne Umbrüche.
function TableCell({ text }) {
  const lines = splitCellLines(text);
  if (lines.length <= 1) return <Inline text={text} />;
  return <>{renderCellLines(lines)}</>;
}

function renderTable(tlines, key, level) {
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
    <div key={key} className="overflow-x-auto my-3" style={indentStyle(level)}>
      <table className="border-collapse text-sm">
        {header && (
          <thead>
            <tr>{header.map((c, i) => <th key={i} className={thCls}><TableCell text={c} /></th>)}</tr>
          </thead>
        )}
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri}>
              {row.map((c, ci) => <td key={ci} className={tdCls}><TableCell text={c} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Einrückung (v7.41, Auftrag "Einrückungen") ---------------- */
/* Konvention (siehe DECISIONS): 2 Leerzeichen pro Ebene am Zeilenanfang,
   maximal 6 Ebenen (12 Leerzeichen). Ein Tab zählt wie 2 Leerzeichen beim
   LESEN (die App SCHREIBT selbst nie Tabs, siehe DocEditor.jsx). Reine,
   exportierte Funktion – testbar ohne DOM/React, und vom Editor-Ladepfad
   (DocEditor.jsx#IndentMarkdownIt) wiederverwendet, damit Renderer und
   Editor exakt dieselbe Ebenen-Arithmetik anwenden. */
export function indentLevel(line) {
  let spaces = 0;
  for (const ch of String(line)) {
    if (ch === " ") spaces += 1;
    else if (ch === "\t") spaces += 2;
    else break;
  }
  return Math.min(6, Math.floor(spaces / 2));
}

// Padding-Ansatz statt echter <ul>-Verschachtelung (siehe renderBlocks
// unten): 1,5rem pro Ebene als linker Zusatz-Einzug, kombiniert mit den
// bestehenden pl-5/pl-1-Klassen der Listen (die reservieren bereits den
// Platz für Aufzählungszeichen/Checkbox – ohne sie würde eine tief
// eingerückte Liste ihr Aufzählungszeichen an den linken Rand verlieren).
const INDENT_REM_PER_LEVEL = 1.5;
function indentStyle(level) {
  return level > 0 ? { marginLeft: level * INDENT_REM_PER_LEVEL + "rem" } : undefined;
}

// Optische Abstufung des Aufzählungszeichens nach Ebene (wie Word/Excel) –
// rein kosmetisch, ändert nichts am gespeicherten Markdown. Tailwind kennt
// "list-disc" als feste Utility-Klasse, für "circle"/"square" gibt es
// keine eigene Utility – Arbiträrwert-Syntax statt einer neuen Abhängigkeit.
function bulletClass(level) {
  if (level >= 2) return "[list-style-type:square]";
  if (level === 1) return "[list-style-type:circle]";
  return "list-disc";
}

/* ---------------- Block-Rendering ---------------- */

function renderBlocks(lines, imgMap, onImgClick, keyPrefix, onToggleTask) {
  const blocks = [];
  let list = null; // { type: "ul" | "ol" | "task", level, items: [] }
  let key = 0;
  const kp = keyPrefix || "b";

  const flush = () => {
    if (list && list.items.length) {
      const style = indentStyle(list.level);
      if (list.type === "ol") {
        // BUGFIX (Code-Review vor v7.41-Commit, 🟡 Finding 2): Ein
        // Ebenenwechsel beendet die laufende Liste (siehe ensure() unten) –
        // OHNE "start" fängt jedes neue <ol> nativ wieder bei 1 an, auch
        // wenn die Quelle z. B. bei "2." weiterzählt (Geschwister auf
        // derselben Ebene, getrennt durch eine tiefer eingerückte
        // Zwischen-Liste). "start" nur setzen, wenn tatsächlich > 1 nötig
        // ist – der Normalfall (Liste beginnt bei 1) bleibt unverändert.
        blocks.push(
          <ol key={kp + key++} start={list.start > 1 ? list.start : undefined} style={style} className="list-decimal pl-5 mb-3 space-y-1">
            {list.items}
          </ol>
        );
      } else if (list.type === "task") {
        blocks.push(<ul key={kp + key++} style={style} className="pl-1 mb-3 space-y-1">{list.items}</ul>);
      } else {
        blocks.push(<ul key={kp + key++} style={style} className={bulletClass(list.level) + " pl-5 mb-3 space-y-1"}>{list.items}</ul>);
      }
    }
    list = null;
  };
  // Ebene ZUSÄTZLICH zum Typ berücksichtigen (Auftrag "Einrückungen"): ein
  // Ebenenwechsel beendet die laufende Liste genau wie ein Typwechsel –
  // Padding-Ansatz (siehe oben), jede Ebene bekommt ihr EIGENES <ul>/<ol>
  // mit passendem Einzug statt echter DOM-Verschachtelung. "start" (nur für
  // "ol" relevant, sonst ignoriert) ist die im Markdown tatsächlich
  // notierte Nummer des ERSTEN Punkts einer NEUEN Liste – bei einer
  // Fortsetzung (Typ/Ebene unverändert) wird der Parameter ignoriert, das
  // bereits gesetzte list.start bleibt stehen.
  const ensure = (type, level, start) => {
    if (!list || list.type !== type || list.level !== level) { flush(); list = { type, level, items: [], start }; }
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
      blocks.push(renderTable(tlines, kp + key++, indentLevel(line)));
    } else if (mathBlock) {
      flush();
      blocks.push(
        <div
          key={kp + key++}
          className="my-3 overflow-x-auto"
          style={indentStyle(indentLevel(line))}
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
        <figure key={kp + key++} className="my-3" style={indentStyle(indentLevel(line))}>
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
      ensure("task", indentLevel(line));
      const checked = taskM[2].toLowerCase() === "x";
      // v7.45.1 (Review-Finding 🔵): Eine INHALTSLEERE Checkbox (taskM[4]
      // === "", seit v7.45 ausdrücklich legitimer Nutzerinhalt statt
      // Datenkorruption, siehe DECISIONS #91) ließ dieses <span> bisher
      // komplett leer (0×0) – die Checkbox selbst blieb über <input>
      // klickbar, aber daneben gab es weder eine sichtbare noch eine
      // klickbare Fläche, die den Punkt als eigene Zeile erkennbar machte.
      // "inline-block" + Mindesthöhe/-breite geben NUR dem leeren Fall
      // spürbaren Platz (eine Zeile mit echtem Text braucht das Minimum
      // ohnehin nie, ihr eigener Inhalt ist stets höher/breiter) – bewusst
      // KEIN zusätzlicher Klick-Handler hier: nach wie vor löst
      // ausschließlich das <input> selbst onToggleTask aus (unveränderter
      // Vertrag mit App.jsx#toggleTask), dies ist eine rein optische/
      // Trefferflächen-Korrektur.
      const emptyLabel = !taskM[4];
      const labelClass = [
        checked ? "line-through text-slate-400" : "",
        emptyLabel ? "inline-block min-h-[1.375rem] min-w-[1rem]" : "",
      ].filter(Boolean).join(" ");
      list.items.push(
        <li key={kp + key++} className="flex items-start gap-2 text-slate-700 leading-relaxed">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onToggleTask && onToggleTask(idx, !checked)}
            className="mt-1 shrink-0 accent-indigo-600 cursor-pointer"
          />
          <span className={labelClass}>
            <Inline text={taskM[4]} />
          </span>
        </li>
      );
    } else if (OL_RE.test(line)) {
      // Führende Nummer mitnehmen (siehe ensure()/flush() oben) – nur
      // relevant, wenn HIER tatsächlich eine neue Liste beginnt (Typ-/
      // Ebenenwechsel), eine Fortsetzung ignoriert den Parameter.
      const numM = /^\s*(\d+)[.)]\s+/.exec(line);
      ensure("ol", indentLevel(line), numM ? parseInt(numM[1], 10) : 1);
      list.items.push(
        <li key={kp + key++} className="text-slate-700 leading-relaxed">
          <Inline text={line.replace(/^\s*\d+[.)]\s+/, "")} />
        </li>
      );
    } else if (UL_RE.test(line)) {
      ensure("ul", indentLevel(line));
      list.items.push(
        <li key={kp + key++} className="text-slate-700 leading-relaxed">
          <Inline text={line.replace(/^\s*[-*]\s+/, "")} />
        </li>
      );
    } else if (/^-{3,}$/.test(line.trim())) {
      flush();
      blocks.push(<hr key={kp + key++} style={indentStyle(indentLevel(line))} className="my-4 border-slate-200" />);
    } else if (line.trim() === "") {
      flush();
    } else {
      flush();
      // BUGFIX (Code-Review vor v7.41-Commit, 🔵 Finding 7): führende
      // Leerzeichen/Tabs sind seit diesem Feature AUSSCHLIESSLICH
      // Einzugs-Metadaten (bereits über indentLevel() ausgewertet, siehe
      // style oben) – sie gehören NICHT zusätzlich in den sichtbaren Text.
      // Bisher blieben sie im <p>-Inhalt stehen (HTML kollabiert sie zwar
      // visuell, aber inkonsistent zu den Listen-Zweigen, die ihr Präfix
      // bereits beim Extrahieren strippen, siehe OL_RE/UL_RE/TASK_RE oben).
      blocks.push(
        <p key={kp + key++} style={indentStyle(indentLevel(line))} className="text-slate-700 leading-relaxed mb-2">
          <Inline text={line.replace(/^[ \t]+/, "")} />
        </p>
      );
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
