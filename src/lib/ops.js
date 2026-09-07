/* ------------------------------------------------------------------ */
/* Dokument-Operationen (Abschnitte auf ##-Ebene)                      */
/* 1:1 aus der Referenz-App (Artifact v3.1) übernommen.                */
/* v7.14: Kapitel-Grenzen ("# ") berücksichtigt (Verschluck-Fix) +      */
/* optionales "chapter"-Feld zur Kapitel-Eingrenzung.                  */
/* v7.23 (Verschiebe-Auftrag, Live-Befund): append_to_section/          */
/* replace_section legen ein referenziertes, aber fehlendes Kapitel     */
/* jetzt selbst an, statt die Op zu überspringen - delete_section       */
/* bleibt beim v7.14-Skip (siehe applyOne/explainSkip unten, DECISIONS).*/
/* v7.32 (delete_chapter-Op, Live-Befund): neuer Op-Typ, der ein GANZES */
/* #-Kapitel (Kopfzeile + ALLE ##-Abschnitte + Freitext) in einem       */
/* Schritt entfernt - vorher blieb nach mehreren delete_section-Ops     */
/* eine verwaiste "# "-Kapitelzeile stehen, die kein delete_section     */
/* traf (kein ##-Abschnitt dieses Namens). Siehe DECISIONS #74.         */
/* v7.32.1 (Review-Fix): findDeletableChapter() setzt die Suche NACH    */
/* einer zuerst getroffenen Notizbuch-Titelzeile fort, statt ein GLEICH-*/
/* NAMIGES echtes Kapitel darunter für dauerhaft unlöschbar zu erklären.*/
/* v7.33 (Finding A, DECISIONS #75, supersedet #54/#60): findChapter/    */
/* findSection/tidy sind jetzt FENCE-AWARE – eine "#"/"##"-Zeile         */
/* INNERHALB eines geschlossenen ```-Codeblocks zählt nicht mehr als     */
/* Kapitel-/Abschnitts-/BOUNDARY-Grenze (computeFenceLineMask aus         */
/* code.jsx, dieselbe Maske wie markdown.jsx#parseTree). Vorher konnte    */
/* eine Op an einer solchen Phantom-Grenze im Code enden und den Rest     */
/* des Codeblocks (falsch) stehen lassen bzw. löschen/ersetzen.           */
/* v7.40 (append_to_chapter-Op, zwei Live-Befunde – siehe DECISIONS #80): */
/* neuer Op-Typ, der content als KAPITEL-FREITEXT direkt unter eine       */
/* #-Kapitelzeile hängt (vor dem ersten ##-Abschnitt des Kapitels) - die  */
/* Ops-Engine konnte Stichpunkte bisher NUR in ##-Abschnitte schreiben    */
/* (append_to_section), das Modell musste dafür zwangsläufig einen       */
/* ##-Abschnitt erfinden und duplizierte dabei reflexartig den           */
/* Kapitelnamen ("# KPIs" mit redundantem "## KPIs" darin). Nutzt         */
/* dieselbe Titelzeilen-/Adressierungs-Logik wie delete_chapter - der     */
/* bisherige Helfer findDeletableChapter() dient jetzt BEIDEN Op-Typen    */
/* und heißt deshalb neutraler findAddressableChapter().                 */
/* v7.50 (delete_entry/move_entry-Ops, Live-Vorfall bison.box – siehe     */
/* DECISIONS #103): zwei neue, ZEILEN-genaue Op-Typen für EINZELNE        */
/* Einträge (eine Zeile, ggf. mit stärker eingerückten Kinderzeilen) -    */
/* bisher gab es dafür NUR die abschnitts-/kapitel-granularen Ops         */
/* (delete_section/delete_chapter hätten den GANZEN Abschnitt/das GANZE   */
/* Kapitel gelöscht). Live-Vorfall: ein Versuch, EINEN Inbox-Eintrag      */
/* unter ein anderes Kapitel zu verschieben, zerstörte per rewrite die    */
/* komplette Inbox; ein zweiter Versuch nutzte delete_section auf         */
/* "Inbox" als Lösch-Schritt - hätte ebenfalls den GANZEN Abschnitt        */
/* gelöscht (schlug nur zufällig fehl) und hinterließ den Eintrag          */
/* dupliziert. delete_entry entfernt GENAU EINEN, per exaktem oder         */
/* (nur wenn kein exakter Treffer existiert) eindeutigem Substring-Match   */
/* gefundenen Eintrag samt seiner Kinderzeilen; move_entry verschiebt ihn  */
/* ATOMAR (Quelle+Ziel in EINEM Op, ALLE Prüfungen laufen VOLLSTÄNDIG vor  */
/* jeder Änderung am Zeilen-Array) innerhalb EINES Notizbuchs - die        */
/* Ziel-Einfügung nutzt dieselben Such-Helfer (findChapter/findSection/    */
/* firstSectionInChapter/findAddressableChapter/padEnd) wie               */
/* append_to_section/append_to_chapter, um NICHT von deren geprüftem       */
/* Anlage-Verhalten abzuweichen. Sicherheitsgarantie: eine #/##-           */
/* Strukturzeile wird NIE als Eintrag gematcht (BOUNDARY_RE-Filter, wie    */
/* überall in dieser Datei) - bei Mehrdeutigkeit (>1 Treffer) wird NICHTS  */
/* angefasst, nie geraten (siehe applyOne/explainSkip unten).             */
/* v7.50.1 (Review-Fix, kritischer Fund, siehe DECISIONS #104):            */
/* entryBlockRange() (Ermittlung des Eintragsblocks für delete_entry/       */
/* move_entry) war ENTGEGEN dem eigenen Fence-Awareness-Grundsatz dieser    */
/* Datei NICHT fence-aware - ein eingerücktes ```-Kind mit einer Leerzeile  */
/* oder einer Spalte-0-Codezeile DARIN riss den Block MITTEN im Codeblock   */
/* auseinander (delete_entry: Datenverlust an Codeinhalt; move_entry: nur   */
/* der öffnende Zaun wanderte mit, Rest blieb als Waise in der Quelle).     */
/* entryBlockRange() bezieht einen an der Trefferzeile/ihren Kindern         */
/* anschließenden GESCHLOSSENEN Fence-Block jetzt IMMER GANZ oder GAR NICHT  */
/* ein (matchFenceBlock aus code.jsx); dedentBlock() klammert die Einrück-   */
/* ungs-Reduktion zusätzlich PRO ZEILE auf deren eigene Einrückung, damit    */
/* Fence-Innenzeilen mit geringerer Einrückung als die Trefferzeile beim     */
/* Ziel-Insert von move_entry nicht am Anfang beschnitten werden.           */
/* v7.50.2 (Nachbesserungs-Finding, Struktur-Injektion, siehe DECISIONS      */
/* #103/#104): dedentBlock() konnte eine eingerückte Zeile, die WEGEN ihrer  */
/* Einrückung bisher NICHT als "#"/"##"-Strukturzeile galt (z. B. ein als    */
/* Kind eingerücktes "# Kommentar mit Raute" unter einem Listenpunkt), durch */
/* die volle Dedentierung auf Spalte 0 ERST zu einer ECHTEN Kapitelzeile     */
/* machen - aus Inhalt wurde Struktur, der Zielabschnitt endete am Ziel      */
/* vorzeitig (tidy() fügte sogar eine Leerzeile davor ein). Matcht die       */
/* volle Dedentierung einer Zeile BOUNDARY_RE, die Originalzeile aber nicht, */
/* bleibt jetzt PRO ZEILE (nicht nur bei der Trefferzeile) ein führendes     */
/* Whitespace-Zeichen stehen - Fence-Innenzeilen bleiben davon unberührt     */
/* (dort schützt bereits der mitwandernde Zaun selbst, siehe v7.50.1).       */
/* v7.52 (Live-Vorfall "KPIs"-Duplikat, DECISIONS #106): dieselbe Fehler-    */
/* familie wie #80 (v7.40) und #103 (v7.50) trat ERNEUT auf - ein Kapitel   */
/* "# KPIs" trug seine Einträge als reinen Kapitel-FREITEXT (kein eigenes    */
/* "## KPIs"), das Modell schickte trotzdem append_to_section/               */
/* replace_section mit heading:"## KPIs" - "wird angelegt, falls er fehlt"   */
/* (v7.23) legte klaglos ein redundantes "## KPIs" INNERHALB von "# KPIs"    */
/* an (applied:true, KEINE Warn-Pille). Wurzel: findSection unterschied      */
/* "Abschnitt fehlt komplett" nicht von "ein GLEICHNAMIGES #-Kapitel OHNE    */
/* eigenen ##-Abschnitt existiert bereits". Neuer, rein lesender Resolver    */
/* resolveSectionTarget() trifft GENAU diese Unterscheidung (von applyOne    */
/* UND explainSkip/explainNote gemeinsam genutzt, kein zweiter               */
/* Entscheidungspfad - Grundprinzip dieser Datei): bei einer Kollision       */
/* landet content in der Kapitel-PRÄAMBEL (insertIntoChapterPreamble, aus    */
/* dem bestehenden append_to_chapter-Zweig extrahiert) statt in einem neuen  */
/* ##-Duplikat; replace_section ersetzt dabei NIE bereits vorhandenen        */
/* Kapitel-Freitext (nur eine leere Präambel darf befüllt werden - sonst     */
/* Skip mit Verweis auf die neuen entry-Ops). entryScope() (delete_entry/    */
/* move_entry) trifft dieselbe Umleitungs-Entscheidung ("redirected") für    */
/* EINZELNE Einträge. NEUER Op-Typ replace_entry ersetzt GENAU EINE bereits  */
/* bestehende Eintragszeile (samt Kinderzeilen) TEXTUELL, ohne sie zu        */
/* verschieben - fehlte bisher für "ändere diese eine Kapitel-Freitext-      */
/* Zeile" (Turn 2 des Live-Vorfalls: ein Klammer-Zusatz an eine bestehende   */
/* Zeile anhängen). NEUES Feld "note" (nur bei applied:true, rein lesend     */
/* über explainNote()) macht implizite Kapitel-/Abschnitts-Anlagen UND die   */
/* neue Kollisions-Umleitung für App.jsx/den Nutzer sichtbar - vorher lief   */
/* eine solche Anlage "erfolgreich" (applied:true) OHNE jede Meldung.        */
/* ------------------------------------------------------------------ */

import { computeFenceLineMask, matchFenceBlock } from "./code.jsx";

const HEAD_RE = /^##\s+/;
// EIN "#" gefolgt von Whitespace – matcht bewusst NICHT "## "/"### " (nach
// dem ersten "#" verlangt \s sofort ein Leerzeichen, "##…"/"###…" haben an
// dieser Stelle aber ein weiteres "#").
const CHAPTER_RE = /^#\s+/;
// Bereichs-Grenze für findSection (v7.14, Verschluck-Fix): "#" ODER "##",
// NICHT "###" – matcht also Kapitel- UND Abschnittszeilen, aber keine
// Unterthemen (die gehören zum Inhalt eines Abschnitts). Vorher endete ein
// Abschnitt NUR an der nächsten "## "-Zeile; eine "# "-Kapitelzeile HINTER
// dem letzten Abschnitt eines Kapitels wurde dadurch fälschlich zum
// Vorgänger-Abschnitt gezählt und bei replace_section/delete_section
// GELÖSCHT bzw. bei append_to_section übersprungen (die neue Zeile landete
// vor der Kapitelzeile statt danach). Seit v7.33 FENCE-AWARE (siehe oben) –
// alle Aufrufer (findChapter/findSection/tidy) prüfen zusätzlich die
// Fence-Maske, BEVOR sie BOUNDARY_RE/HEAD_RE/CHAPTER_RE gegen eine Zeile
// testen.
const BOUNDARY_RE = /^#{1,2}\s/;

export const normHead = (h) => String(h || "").replace(/^#+\s*/, "").trim().toLowerCase();
export const dispHead = (h) => String(h || "").replace(/^#+\s*/, "").trim();

// Sucht den Zeilenbereich [s, e) einer "# "-Kapitelzeile (normHead-tolerant,
// wie bei Abschnitten – "# Projekte" und "Projekte" treffen dieselbe
// Kapitelzeile). e ist die nächste "# "-Zeile oder das Dokumentende. null,
// wenn kein Kapitel mit diesem Titel existiert. "fromIdx" (optional, v7.32.1
// Review-Fix 🟡): Startindex der Suche nach der ERSTEN passenden Zeile –
// Default 0 (bisheriges Verhalten, unverändert für alle Aufrufer ohne
// dritten Parameter). Wird von findAddressableChapter() unten genutzt, um
// NACH einer bereits gefundenen Notizbuch-Titelzeile weiterzusuchen.
// v7.33 (Finding A, DECISIONS #75): fence-aware – computeFenceLineMask wird
// aus "lines" berechnet (derselbe Zeilenstand, den auch die Suche selbst
// nutzt) und maskiert sowohl die START- als auch die END-Suche: eine
// "# "-Zeile INNERHALB eines geschlossenen ```-Codeblocks kann weder eine
// gesuchte Kapitelzeile SEIN noch das Kapitel BEENDEN.
function findChapter(lines, chapterHeading, fromIdx) {
  const t = normHead(chapterHeading);
  if (!t) return null;
  const mask = computeFenceLineMask(lines);
  const from = typeof fromIdx === "number" ? fromIdx : 0;
  let s = -1;
  for (let i = from; i < lines.length; i++) {
    if (!mask[i] && CHAPTER_RE.test(lines[i]) && normHead(lines[i]) === t) { s = i; break; }
  }
  if (s === -1) return null;
  let e = lines.length;
  for (let j = s + 1; j < lines.length; j++) {
    if (!mask[j] && CHAPTER_RE.test(lines[j])) { e = j; break; }
  }
  return [s, e];
}

// Position der Notizbuch-TITELZEILE (v7.32, delete_chapter-Titelschutz) –
// IDENTISCHE Logik/Konvention wie markdown.jsx#parseTree#titleLineIdx (dort
// die maßgebliche Referenz, siehe deren Kopfkommentar): Ist die erste
// NICHT-LEERE Zeile des Dokuments eine "# "-Zeile, gilt GENAU diese eine
// Zeile (per Original-Index) als Titel – unabhängig vom Namen. Beginnt das
// Dokument NICHT mit einer "# "-Zeile (z. B. Test-Fixture ohne Titel oder
// eine Zeile, die mit "##"/Fließtext beginnt), gibt es KEINE Titel-Ausnahme:
// -1, jede "# "-Zeile ist dann ein normales, löschbares Kapitel. ops.js
// kannte diese Ausnahme bisher NICHT (findChapter/findSection behandeln JEDE
// "# "-Zeile gleich) – für delete_chapter ist sie aber sicherheitskritisch,
// siehe applyOne/explainSkip unten und DECISIONS #74.
// KEINE Fence-Maske nötig (v7.33-Konsistenz-Prüfung, siehe DECISIONS #75 und
// derselbe Kommentar in markdown.jsx#parseTree): "firstContentIdx" wäre nur
// dann eine Fence-interne Zeile, wenn der Fence bereits VOR der ersten
// nicht-leeren Zeile geöffnet UND geschlossen wäre – unmöglich, da die erste
// nicht-leere Zeile selbst der öffnende Zaun wäre (matcht nie CHAPTER_RE).
function titleLineIdx(lines) {
  const firstContentIdx = lines.findIndex((l) => l.trim() !== "");
  return firstContentIdx !== -1 && CHAPTER_RE.test(lines[firstContentIdx]) ? firstContentIdx : -1;
}

// Liefert das für delete_chapter/append_to_chapter adressierte Kapitel-Feld
// (v7.32, v7.40 um append_to_chapter erweitert): bevorzugt "chapter"
// (konsistent zum bestehenden chapter-Feld bei den anderen Ops), fällt bei
// fehlendem/leerem "chapter" auf "heading" zurück – Robustheits-Fallback
// gegen Modell-Varianz (manche Antworten könnten das allgemeinere
// heading-Feld statt des korrekten chapter-Felds benutzen). Von applyOne UND
// explainSkip genutzt (nicht dupliziert), damit beide GARANTIERT denselben
// Kapitel-String sehen – Grundprinzip dieser Datei, siehe explainSkip-
// Kopfkommentar weiter unten.
function chapterFieldFor(op) {
  if (typeof op.chapter === "string" && op.chapter.trim()) return op.chapter;
  if (typeof op.heading === "string" && op.heading.trim()) return op.heading;
  return "";
}

// Sucht das für delete_chapter/append_to_chapter ADRESSIERTE Kapitel UNTER
// Berücksichtigung der Titelzeilen-Ausnahme (v7.32.1, Review-Fix 🟡,
// Live-Befund-Nachbesserung; v7.40: umbenannt von findDeletableChapter, da
// jetzt auch append_to_chapter diesen Helfer nutzt – reine Namensänderung,
// Verhalten unverändert): Ein Kapitel mit dem GLEICHEN Namen wie die
// Notizbuch-Titelzeile (z. B. Titel "# Projekte" UND weiter unten ein
// reguläres "# Projekte"-Kapitel – laut parseTree/titleLineIdx ist JEDE
// "# "-Zeile außer der einen Titelzeile ein normales Kapitel) wäre sonst
// per delete_chapter DAUERHAFT unlöschbar bzw. bei append_to_chapter würde
// versehentlich in den Dokument-Vorspann statt in ein echtes Kapitel
// geschrieben: findChapter() liefert bei der globalen Suche IMMER zuerst die
// Titelzeile (erster Treffer im Dokument), der reine Positionsvergleich in
// applyOne hätte das fälschlich als echtes Kapitel behandelt, obwohl weiter
// unten ein echtes, gleichnamiges Kapitel existiert. Trifft der erste
// Treffer die Titelzeile, wird die Suche deshalb AB der Zeile DANACH
// fortgesetzt (findChapter-"fromIdx"); nur wenn dort ebenfalls nichts
// gefunden wird, bleibt es beim Titelzeilen-Skip (delete_chapter) bzw. gilt
// das Kapitel als NICHT vorhanden (append_to_chapter legt es dann neu an,
// siehe applyOne). Ein bereits GEFUNDENES echtes Kapitel unterhalb der
// Titelzeile ist niemals selbst wieder die Titelzeile (die Suche startet ja
// erst NACH deren Index) – ein erneuter Titel-Vergleich danach ist daher
// nicht nötig. Von applyOne UND explainSkip genutzt (kein zweiter
// Schreibpfad), damit beide GARANTIERT dieselbe Entscheidung treffen.
// Rückgabe: { range: [s,e]|null, titleBlocked: bool } – titleBlocked ist nur
// bei range===null gesetzt und unterscheidet "gar kein Kapitel dieses
// Namens" (false) von "nur als Titelzeile getroffen, sonst nirgends" (true)
// – delete_chapter braucht dafür zwei unterschiedliche explainSkip-
// Meldungen, append_to_chapter behandelt BEIDE Fälle gleich (Kapitel neu
// anlegen, siehe applyOne).
function findAddressableChapter(lines, chapterField) {
  const first = findChapter(lines, chapterField);
  if (!first) return { range: null, titleBlocked: false };
  const tIdx = titleLineIdx(lines);
  if (first[0] !== tIdx) return { range: first, titleBlocked: false };
  const again = findChapter(lines, chapterField, tIdx + 1);
  return again ? { range: again, titleBlocked: false } : { range: null, titleBlocked: true };
}

// range (optional): [from, to) grenzt die Suche auf ein einzelnes Kapitel
// ein (siehe findChapter oben). Ohne range: globale Suche wie bisher –
// erster Treffer im gesamten Dokument gewinnt (unverändertes Verhalten für
// Ops ohne "chapter"-Feld). v7.33 (Finding A, DECISIONS #75): fence-aware –
// wie findChapter oben maskiert computeFenceLineMask sowohl die HEAD_RE-
// Start- als auch die BOUNDARY_RE-End-Suche.
function findSection(lines, heading, range) {
  const t = normHead(heading);
  if (!t) return null;
  const mask = computeFenceLineMask(lines);
  const from = range ? range[0] : 0;
  const to = range ? range[1] : lines.length;
  let s = -1;
  for (let i = from; i < to; i++) {
    if (!mask[i] && HEAD_RE.test(lines[i]) && normHead(lines[i]) === t) { s = i; break; }
  }
  if (s === -1) return null;
  let e = to;
  for (let j = s + 1; j < to; j++) {
    if (!mask[j] && BOUNDARY_RE.test(lines[j])) { e = j; break; }
  }
  return [s, e];
}

// Sucht die Zeile des ERSTEN "## "-Abschnitts INNERHALB eines Kapitel-
// Bereichs [s, e) (v7.40, append_to_chapter-Op, siehe DECISIONS #80) – wie
// von findChapter/findAddressableChapter geliefert. Grenze der KAPITEL-
// PRÄAMBEL: alles vor dieser Zeile (Kopfzeile selbst + evtl. Freitext)
// gehört zum Kapitel, aber VOR jedem ##-Abschnitt – genau der Bereich, in
// den append_to_chapter schreibt. Gibt es KEINEN ##-Abschnitt im Kapitel,
// ist range[1] (Kapitelende) selbst die Einfüge-Grenze (Präambel = ganzes
// Kapitel). Fence-aware wie findSection/findChapter: eine "## "-Zeile
// INNERHALB eines geschlossenen ```-Codeblocks zählt NICHT als Abschnitt.
function firstSectionInChapter(lines, range) {
  const mask = computeFenceLineMask(lines);
  for (let i = range[0] + 1; i < range[1]; i++) {
    if (!mask[i] && HEAD_RE.test(lines[i])) return i;
  }
  return range[1];
}

// v7.52 (Live-Vorfall "KPIs"-Duplikat, DECISIONS #106): rein lesender
// Resolver, der VOR jeder Kapitel-/Abschnitts-Mutation entscheidet, ob ein
// referenziertes "heading" tatsächlich einen EIGENEN ##-Abschnitt anlegen
// darf, oder ob es stattdessen ein GLEICHNAMIGES #-Kapitel OHNE eigenen
// ##-Abschnitt trifft – dort würde "wird angelegt, falls er fehlt" (v7.23,
// s. o.) sonst ein redundantes "## X" INNERHALB von "# X" erzeugen. Live-
// Vorfall: das Kapitel "# KPIs" trug seine Einträge als reinen Kapitel-
// FREITEXT (kein "## KPIs"); das Modell schickte trotzdem
// {"heading":"## KPIs","chapter":"# KPIs"} und die Engine legte
// klaglos einen zweiten, redundanten "## KPIs"-Abschnitt an (applied:true,
// KEINE Warn-Pille – der Nutzer bemerkte das Duplikat nur zufällig).
// applyOne UND explainSkip/explainNote nutzen AUSSCHLIESSLICH dieses
// Ergebnis für die Kollisions-Entscheidung (Grundprinzip der Datei, siehe
// Kopfkommentar) – KEIN zweiter, potenziell abweichender Entscheidungspfad.
// Mutiert "lines" NIE.
//
// Rückgabe:
//  disp           - dispHead(heading)
//  chapterField    - das rohe "chapter"-Feld (leer, wenn nicht gesetzt/nur
//                     Whitespace) – wie überall in dieser Datei
//  chapterRange    - Bereich von "chapter", falls gesetzt UND gefunden
//                     (OHNE Titelzeilen-Ausnahme – Altverhalten von
//                     findChapter, siehe dessen Kommentar)
//  chapterMissing  - chapterField gesetzt, aber chapterRange null
//  chapterIsTitle  - chapterRange gefunden UND ist die Notizbuch-Titelzeile
//  sectionRange    - der GENAU adressierte "## heading"-Abschnitt: bei
//                     gesetztem, GEFUNDENEM chapterRange auf dieses Kapitel
//                     eingegrenzt; ohne chapter (bzw. wenn chapterRange
//                     null WEIL kein chapter angegeben war) global gesucht
//                     – wie die bisherige Suche. Bei chapterMissing (siehe
//                     unten) IMMER null (Review-Fix 🟡, Runde 1, siehe
//                     Kommentar unten) – KEINE globale Suche, da ein noch
//                     anzulegendes Kapitel per Definition keinen eigenen
//                     Abschnitt haben kann.
//  collision       - 'chapter' | null – nur gesetzt, wenn sectionRange null
//                     ist UND "heading" stattdessen ein echtes #-Kapitel
//                     (kein ##-Duplikat!) trifft
//  collisionRange  - das getroffene Kapitel (null, wenn es bei einer
//                     Kollision selbst erst NEU angelegt werden müsste)
//  preambleEmpty   - true, wenn die Kapitel-Präambel des Kollisions-
//                     Kapitels (bzw. das Kapitel fehlt komplett) noch
//                     KEINEN Freitext-Inhalt trägt
export function resolveSectionTarget(lines, { heading, chapter } = {}) {
  const disp = dispHead(heading);
  const chapterField = typeof chapter === "string" && chapter.trim() ? chapter : "";
  const chapterRange = chapterField ? findChapter(lines, chapterField) : null;
  const chapterMissing = !!chapterField && !chapterRange;
  const chapterIsTitle = !!chapterRange && chapterRange[0] === titleLineIdx(lines);
  // v7.52 Review-Nachbesserung (🟡, Runde 1): FEHLT das referenzierte Kapitel
  // (chapterMissing), darf hier NICHT global gesucht werden – ein frisch
  // angelegtes, garantiert leeres Kapitel kann per Definition noch KEINEN
  // eigenen ##-Abschnitt enthalten; ein globaler Treffer wäre zwangsläufig
  // ein FREMDER, gleichnamiger Abschnitt in einem ANDEREN Kapitel. Vorher
  // fand findSection() diesen fremden Abschnitt trotzdem (chapterRange war
  // null -> globale Suche), sectionRange wurde fälschlich NICHT-null, die
  // Kollisions-Prüfung unten (die nur bei sectionRange===null greift) wurde
  // dadurch komplett UMGANGEN und applyOne legte anschließend "# X" + "## X"
  // an (das exakte Live-Anti-Muster). isNewSectionCase() unten profitiert
  // vom selben Fix und vereinfacht sich entsprechend.
  const sectionRange = chapterMissing ? null : findSection(lines, disp, chapterRange);

  let collision = null;
  let collisionRange = null;
  if (sectionRange === null) {
    if (!chapterField) {
      // (i) Kein "chapter" angegeben: trifft "heading" trotzdem ein
      // ADRESSIERBARES (Titelzeile ausgeschlossen) #-Kapitel gleichen
      // Namens? Dann ist das gemeinte Ziel dieses Kapitel, nicht ein neuer,
      // globaler ##-Abschnitt an beliebiger Stelle im Dokument.
      const r = findAddressableChapter(lines, heading).range;
      if (r) { collision = "chapter"; collisionRange = r; }
    } else if (normHead(chapterField) === normHead(disp)) {
      // (ii) "chapter" wurde EXPLIZIT auf denselben Namen wie "heading"
      // gesetzt – der eigentliche Live-Vorfall (das Modell schreibt
      // {"heading":"## KPIs","chapter":"# KPIs"}). Eine gleichnamige
      // Notizbuch-TITELZEILE bleibt bewusst außen vor (chapterIsTitle –
      // kein Umleiten in den Dokument-Vorspann, Altverhalten unangetastet).
      if (chapterMissing) {
        collision = "chapter"; collisionRange = null;
      } else if (chapterRange && !chapterIsTitle) {
        collision = "chapter"; collisionRange = chapterRange;
      }
    }
    // (iii) "chapter" gesetzt und ≠ "heading": ein echter ##-Abschnitt
    // dieses Namens in einem ANDEREN Kapitel ist legitim – keine Kollision.
  }

  const preambleEmpty = isPreambleEmpty(lines, collisionRange);
  return { disp, chapterField, chapterRange, chapterMissing, chapterIsTitle, sectionRange, collision, collisionRange, preambleEmpty };
}

// Kapitel-PRÄAMBEL (siehe firstSectionInChapter oben) OHNE jeden Freitext-
// Inhalt? "range" null (Kapitel würde bei einer Kollision erst NEU angelegt)
// zählt als "leer" – dort kann per Definition noch nichts stehen.
function isPreambleEmpty(lines, range) {
  if (!range) return true;
  const end = firstSectionInChapter(lines, range);
  for (let i = range[0] + 1; i < end; i++) {
    if (lines[i].trim() !== "") return false;
  }
  return true;
}

// v7.33 Review-Nachbesserung (Finding 3, siehe DECISIONS #75/#78): Kollabiert
// Leerzeilen-Läufe (mehr als eine Leerzeile in Folge -> genau eine)
// AUSSERHALB von Fences; Zeilen INNERHALB eines geschlossenen ```-
// Codeblocks bleiben davon UNANGETASTET (z. B. zwei Leerzeilen zwischen
// zwei Python-Funktionen) – sonst würde ein Op an GANZ ANDERER Stelle im
// Dokument (tidy() läuft immer über den GESAMTEN Text) den Code-Inhalt
// still byte-verändern. Eigener, wiederverwendbarer Helfer (statt Kopie),
// weil tidy() ihn ZWEIMAL braucht: einmal auf den rohen Eingabe-Zeilen
// (Pass 1) und einmal als Sicherheitsnetz ganz am Ende (Pass 3, ersetzt die
// vorherige GLOBALE "\n{3,}"->"\n\n"-Regex – die hatte denselben Fence-
// Blind-Fehler wie ursprünglich Pass 1/2: sie hätte einen von Pass 1
// bewusst erhaltenen Mehrfach-Leerzeilen-Lauf INNERHALB eines Fences beim
// abschließenden String-Replace wieder zunichtegemacht). Verhalten
// AUSSERHALB von Fences bleibt zur alten Regex byte-identisch (siehe Tests):
// die Kombination aus Pass 1 + der BOUNDARY-Einfüge-Regel (die NIE zwei
// Leerzeilen in Folge erzeugt, siehe deren eigene Prüfung) lässt dort nie
// mehr als eine Leerzeile in Folge entstehen – Pass 3 bleibt für den
// Nicht-Fence-Fall ein reines (verifiziertes) Sicherheitsnetz.
function collapseBlankRuns(lines) {
  const mask = computeFenceLineMask(lines);
  const out = [];
  let blank = 0;
  lines.forEach((l, i) => {
    if (mask[i]) { blank = 0; out.push(l); return; }
    if (l.trim() === "") { blank++; if (blank <= 1) out.push(""); }
    else { blank = 0; out.push(l); }
  });
  return out;
}

// v7.33 (Finding A, DECISIONS #75): fence-aware bei der Leerzeilen-Regel VOR
// Struktur-Zeilen (zweite Schleife unten) – eine BOUNDARY_RE-artige Zeile
// INNERHALB eines geschlossenen ```-Codeblocks (z. B. ein Shell-Kommentar
// "# …") bekommt KEINE künstlich eingefügte Leerzeile mehr davor, das würde
// den Code-Inhalt sonst byte-verändern (DATENVERLUST-Risiko, siehe
// Kopfkommentar der Datei). Die Fence-Maske wird NACH der Leerzeilen-
// Kollaps-Schleife (Pass 1, "out") neu berechnet, weil sich Zeilenindizes
// durch das Kollabieren verschieben können – bewusst NICHT vorab auf
// "lines" berechnet und einfach weitergereicht.
function tidy(lines) {
  const out = collapseBlankRuns(lines);
  const mask = computeFenceLineMask(out);
  const res = [];
  for (let i = 0; i < out.length; i++) {
    // v7.14: Leerzeile jetzt auch vor "# "-Kapitelzeilen erzwungen (BOUNDARY_RE
    // statt bisher nur "^##\s+") – ohne diese Erweiterung könnte eine per Op
    // neu eingefügte Kapitelzeile direkt an vorherigem Inhalt kleben.
    if (!mask[i] && BOUNDARY_RE.test(out[i]) && res.length && res[res.length - 1].trim() !== "") res.push("");
    res.push(out[i]);
  }
  // Pass 3 (Sicherheitsnetz, siehe collapseBlankRuns-Kommentar oben) statt
  // der vorherigen globalen "\n{3,}"->"\n\n"-Regex.
  return collapseBlankRuns(res).join("\n").trim() + "\n";
}

function padEnd(lines) {
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  lines.push("");
}

// v7.50 (delete_entry/move_entry, DECISIONS #103): Whitespace-normalisierter
// Vergleichstext für das Eintrags-Matching – trimmt UND kollabiert innere
// Whitespace-Läufe (Mehrfach-Leerzeichen, Tabs, Zeilenumbrüche im entry-Feld)
// zu je einem Leerzeichen, damit z. B. ein vom Modell leicht anders
// eingerücktes/umgebrochenes "entry" trotzdem den exakten Zeileninhalt trifft.
const norm = (s) => String(s || "").trim().replace(/\s+/g, " ");

// Bestimmt den Such-BEREICH [s, e) für delete_entry/move_entry (Quelle bzw.
// alleiniger Scope) – DIESELBE Adressierungs-Logik wie bei den ##-Abschnitts-
// Ops, aber rein LESEND (legt NIE etwas an, anders als append_to_section/
// append_to_chapter mit fehlendem chapter): "heading" gesetzt -> exakt dieser
// Abschnitt (optional zusätzlich per "chapter" auf EIN Kapitel eingegrenzt,
// wie findSection(..., range) es auch bei den bestehenden Ops tut); NUR
// "chapter" gesetzt -> das GESAMTE Kapitel (Kopfzeile-Bereich inkl. Präambel
// und aller ##-Abschnitte, wie findChapter es liefert); beides leer -> das
// gesamte Dokument. "notFound" unterscheidet "chapter" (die Kapitel-
// Eingrenzung existiert nicht – Suche kann gar nicht erst laufen) von
// "heading" (der Abschnitt selbst wurde im an sich vorhandenen Scope nicht
// gefunden) – explainSkip() unten braucht das für zwei unterschiedliche
// Meldungen. Von applyOne UND explainSkip genutzt (kein zweiter
// Entscheidungspfad, Grundprinzip dieser Datei).
// v7.52 (Live-Vorfall "KPIs"-Duplikat, DECISIONS #106): findet "heading"
// KEINEN ##-Abschnitt, aber "heading" ist (chapter leer ODER === heading)
// ein GLEICHNAMIGES #-Kapitel OHNE eigenen ##-Abschnitt, wird DORT gesucht
// statt die Op überzuspringen – dieselbe Umleitungs-Entscheidung wie
// resolveSectionTarget() für die ##-Abschnitts-Ops (append_to_section/
// replace_section/delete_section), hier für delete_entry/move_entry/
// replace_entry. "redirected:true" macht diese Umleitung für explainNote()
// sichtbar (ℹ️-Note statt eines stillen Verhaltenswechsels).
function entryScope(lines, headingField, chapterField) {
  const headingDisp = dispHead(headingField);
  const chapterDisp = dispHead(chapterField);
  if (headingDisp) {
    let chRange = null;
    if (chapterDisp) {
      chRange = findChapter(lines, chapterField);
      if (!chRange) return { range: null, notFound: "chapter" };
    }
    const sec = findSection(lines, headingDisp, chRange);
    if (!sec) {
      if (!chapterDisp || normHead(chapterField) === normHead(headingField)) {
        const { range } = findAddressableChapter(lines, headingField);
        if (range) return { range, notFound: null, redirected: true };
      }
      return { range: null, notFound: "heading" };
    }
    return { range: sec, notFound: null };
  }
  if (chapterDisp) {
    const chRange = findChapter(lines, chapterField);
    if (!chRange) return { range: null, notFound: "chapter" };
    return { range: chRange, notFound: null };
  }
  return { range: [0, lines.length], notFound: null };
}

// Findet die Zeilen INNERHALB von range, die als "entry" gelten könnten
// (v7.50, delete_entry/move_entry) – Kandidaten sind alle NICHT fence-
// maskierten (computeFenceLineMask, wie überall in dieser Datei) UND KEINE
// Struktur-Zeilen (BOUNDARY_RE: "#"/"##" – NIE ein Kapitel/Abschnitt als
// "Eintrag" behandeln, die zentrale Sicherheitsgarantie dieser beiden
// Op-Typen). Zweistufiges Matching: Stufe 1 EXAKT (norm()-Vergleich,
// Groß-/Kleinschreibung UND Whitespace-Läufe sensitiv reduziert) – liefert
// Stufe 1 mindestens einen Treffer, gewinnt sie AUSSCHLIESSLICH (Stufe 2 läuft
// dann gar nicht). NUR wenn Stufe 1 leer bleibt, Stufe 2: case-insensitiver
// Substring-Match. Rückgabe: alle Treffer-Zeilenindizes (0, 1 oder mehr) –
// der Aufrufer entscheidet über Skip (0)/Ambiguität (>1)/Erfolg (genau 1).
function findEntryLines(lines, range, entryText) {
  const needle = norm(entryText);
  if (!needle) return [];
  const mask = computeFenceLineMask(lines);
  const candidates = [];
  for (let i = range[0]; i < range[1]; i++) {
    if (mask[i]) continue;
    if (BOUNDARY_RE.test(lines[i])) continue;
    candidates.push(i);
  }
  const exact = candidates.filter((i) => norm(lines[i]) === needle);
  if (exact.length) return exact;
  const needleLower = needle.toLowerCase();
  return candidates.filter((i) => norm(lines[i]).toLowerCase().includes(needleLower));
}

// Liefert den vollständigen EINTRAGSBLOCK [s, e) ab einer bereits gefundenen
// Trefferzeile (v7.50): die Trefferzeile selbst PLUS alle direkt folgenden
// Zeilen mit GRÖSSERER Einrückung (mehr führende Leerzeichen als die
// Trefferzeile – verschachtelte Kinder wandern mit). Eine Leerzeile ODER eine
// nicht stärker eingerückte Zeile beendet den Block sofort.
// v7.50.1 (Review-Fix, kritischer Fund, siehe DECISIONS #104): FENCE-AWARE
// gemacht – vorher wurde ein eingerücktes ```-Kind rein über Leerzeile/
// Einrückung abgetastet, GENAU wie normaler Text. Ein Codeblock DARF aber
// Leerzeilen und (bei Spalte-0-Code) schwächer eingerückte Zeilen ENTHALTEN,
// ohne dass der Eintrag dort "endet" – der alte Scan riss den Block an der
// erstbesten solchen Zeile MITTEN im Fence auseinander (Datenverlust bzw.
// halber Zaun bei move_entry, siehe Review-Befund). "end" trifft beim
// sequenziellen Vorrücken (Einzelschritt ODER Sprung direkt hinter einen
// bereits eingeschlossenen Block) IMMER zuerst die ÖFFNENDE Zaunzeile eines
// GESCHLOSSENEN Blocks (computeFenceLineMask markiert pro Block einen
// zusammenhängenden Bereich – der erste maskierte Index kann daher nie ein
// Zauninneres sein). Unterschreitet/erreicht die ÖFFNENDE Zaunzeile selbst
// die Einrückungsgrenze (wie jede andere zu schwach eingerückte Zeile), endet
// der Block VOR dem Fence ("break"); sonst gehört der GESAMTE Fence-Block
// (inkl. aller Leerzeilen/Spalte-0-Zeilen DARIN) atomar zum Eintrag –
// matchFenceBlock() liefert hier GARANTIERT ein Ergebnis (dieselbe Erkennung,
// die computeFenceLineMask bereits benutzt hat, um mask[end] auf true zu
// setzen).
function entryBlockRange(lines, hitIdx) {
  const indentOf = (l) => l.length - l.trimStart().length;
  const baseIndent = indentOf(lines[hitIdx]);
  const mask = computeFenceLineMask(lines);
  let end = hitIdx + 1;
  while (end < lines.length) {
    if (mask[end]) {
      if (indentOf(lines[end]) <= baseIndent) break;
      const block = matchFenceBlock(lines, end);
      end = block.endIdx + 1;
      continue;
    }
    const l = lines[end];
    if (l.trim() === "" || indentOf(l) <= baseIndent) break;
    end++;
  }
  return [hitIdx, end];
}

// Hebt die führende Einrückung eines per entryBlockRange() ermittelten Blocks
// auf 0 an (v7.50, NUR für move_entry-Zielinserts relevant – delete_entry
// löscht den Block unverändert, ohne ihn neu einzufügen): Kinderzeilen werden
// um DASSELBE Delta reduziert, die relative Struktur zueinander bleibt also
// erhalten. War die Trefferzeile bereits nicht eingerückt (delta 0), liefert
// die Funktion den Block unverändert zurück (kein unnötiger Array-Kopieren).
// v7.50.1 (Review-Fix, siehe DECISIONS #104): PRO ZEILE auf die tatsächliche
// EIGENE Einrückung geklammert (Math.min(delta, indentOf(l))) statt pauschal
// delta abzuschneiden – seit der Fence-Awareness oben können Fence-
// INNENZEILEN (echter Code-Inhalt) im Block stecken, deren Einrückung
// GERINGER als delta ist (z. B. Spalte-0-Code in einem eingerückten
// Codeblock-Kind, oder eine Leerzeile). Ein pauschales l.slice(delta) hätte
// dort führende CODE-ZEICHEN statt nur Whitespace abgeschnitten
// (Byte-Verstümmelung des Codeinhalts). Für alle "normalen" Kinderzeilen
// (deren Einrückung laut entryBlockRange-Kontrakt IMMER > baseIndent === delta
// ist) bleibt das Verhalten zur alten, gepinnten Logik identisch.
// v7.50.2 (Nachbesserungs-Finding, Struktur-Injektion, siehe DECISIONS #103/
// #104): eine Zeile, die WEGEN ihrer Einrückung bisher NICHT als "#"/"##"-
// Strukturzeile galt (BOUNDARY_RE griff nicht, weil sie nicht bei Spalte 0
// beginnt – z. B. ein als Kind eingerücktes "# Kommentar mit Raute" unter
// einem Listenpunkt), darf durchs volle Dedent NICHT ERST zu einer ECHTEN
// Kapitel-/Abschnittszeile werden: am Ziel würde tidy() davor sogar eine
// Leerzeile einfügen und der Zielabschnitt für jede spätere findSection/
// findChapter-Suche vorzeitig "enden" – aus Inhalt würde Struktur. Prüfung
// PRO ZEILE (nicht nur die erste), weil grundsätzlich jede Zeile des Blocks
// betroffen sein könnte: matcht die volle Dedentierung BOUNDARY_RE, obwohl
// die ORIGINALZEILE es nicht tat, bleibt EIN führendes Leerzeichen stehen
// (l.slice(cut - 1) statt l.slice(cut) – nimmt das ORIGINALE Whitespace-
// Zeichen an dieser Position, kein hartcodiertes " ", funktioniert daher
// auch bei Tabs). Fence-INNENZEILEN (mask[i], siehe computeFenceLineMask)
// sind davon ausdrücklich AUSGENOMMEN: sie bleiben unverändert Sache des
// bestehenden Math.min-Clamps oben – ein Fence-Zaun schützt seinen Inhalt
// bereits strukturell (wandert komplett mit, siehe entryBlockRange), eine
// zusätzliche Leerzeichen-Injektion dort wäre reine, unnötige Byte-
// Verfälschung von echtem Code-Inhalt (z. B. ein Shell-Kommentar "# …" bei
// Spalte 0 IM Codeblock ist gültiger, unveränderlicher Inhalt).
function dedentBlock(blockLines) {
  if (!blockLines.length) return blockLines;
  const indentOf = (l) => l.length - l.trimStart().length;
  const delta = indentOf(blockLines[0]);
  if (!delta) return blockLines;
  const mask = computeFenceLineMask(blockLines);
  return blockLines.map((l, i) => {
    const cut = Math.min(delta, indentOf(l));
    const out = l.slice(cut);
    if (!mask[i] && cut > 0 && !BOUNDARY_RE.test(l) && BOUNDARY_RE.test(out)) {
      return l.slice(cut - 1); // EIN Whitespace-Zeichen der Originalzeile bleibt stehen
    }
    return out;
  });
}

// Fügt contentLines DIREKT VOR dem ersten ##-Abschnitt eines Kapitel-
// Bereichs "range" ein (Kapitel-PRÄAMBEL, siehe firstSectionInChapter oben)
// – gemeinsamer Helfer (v7.52, DECISIONS #106) für den bestehenden
// append_to_chapter-Zweig UND die NEUE v7.52-Kollisions-Umleitung von
// append_to_section/replace_section (siehe applyOne unten): BEIDE Fälle
// zeigen dadurch GARANTIERT dasselbe Einfüge-Verhalten (Leerzeilen direkt
// vor der Einfügeposition werden übersprungen, damit neuer Inhalt direkt
// hinter dem letzten Präambel-Inhalt landet – tidy() normalisiert die
// Abstände zu den umgebenden Struktur-Zeilen danach). Mutiert "lines"
// direkt (splice), wie die übrigen Op-Helfer dieser Datei. Vormals INLINE
// im append_to_chapter-Zweig (bis v7.51) – reine Extraktion, kein
// Verhaltens-Unterschied für append_to_chapter selbst.
function insertIntoChapterPreamble(lines, range, contentLines) {
  let at = firstSectionInChapter(lines, range);
  while (at > range[0] + 1 && lines[at - 1].trim() === "") at--;
  lines.splice(at, 0, ...contentLines);
}

// Ziel-Einfügung für move_entry MIT gesetztem "to_heading" (v7.50) –
// append_to_section-Semantik (v7.23-konsistent): der Ziel-Abschnitt wird
// angelegt, falls er fehlt, ein zusätzlich gesetztes Ziel-Kapitel ebenso;
// Einfüge-Position ist wie bei append_to_section das Abschnittsende
// (Leerzeilen davor werden übersprungen). Eigenständige, kleine Funktion
// statt eines dritten Aufrufs des applyOne-internen op.chapter/op.heading-
// Blocks weiter unten, weil move_entry KEIN "op.content" hat, sondern einen
// bereits fertigen Zeilen-Block (den bewegten Eintrag) einfügt – nutzt aber
// dieselben Such-Helfer (findChapter/findSection/padEnd) wie jener Block, um
// NICHT vom geprüften Anlage-Verhalten abzuweichen. Mutiert "lines" direkt
// (push/splice), wie die übrigen Op-Zweige dieser Datei.
// v7.52 (Live-Vorfall "KPIs"-Duplikat, DECISIONS #106): der Aufrufer (siehe
// applyOne, move_entry-Zweig) entscheidet VORAB rein lesend per
// resolveSectionTarget(), ob "headingDisp" (ggf. mit "chapterField") ein
// GLEICHNAMIGES #-Kapitel OHNE eigenen ##-Abschnitt trifft, und reicht das
// Ergebnis als "collision" durch – dann wandert der Eintrag in dessen
// Kapitel-Freitext (insertEntryIntoChapterPreamble) statt einen redundanten
// "## X"-Abschnitt INNERHALB von "# X" anzulegen.
// v7.52.1 (Review-Finding 1, Spiegelprinzip-Drift, DECISIONS #109): "collision"
// wird bewusst NICHT mehr HIER per eigenem resolveSectionTarget-Aufruf
// ermittelt (wie bis v7.52) – "lines" ist an dieser Stelle bereits das um die
// Quellzeile BEREINIGTE Array (applyOne führt meLines.splice() VOR diesem
// Aufruf aus), während explainNote() dieselbe Kollisions-Frage auf dem
// UNMUTIERTEN "before"-Text beantwortet. Beide konnten dadurch bei einem
// Dokument OHNE Titelzeile, dessen verschobene Zeile die erste nicht-leere
// Zeile war, zu UNTERSCHIEDLICHEN Ergebnissen kommen: das Entfernen der
// Quellzeile ließ die folgende "# X"-Zeile per Konvention (siehe
// titleLineIdx) zur neuen Titelzeile werden, findAddressableChapter() hielt
// sie deshalb für unadressierbar und lieferte KEINE Kollision – "## X"
// landete klaglos UNTER "# X", während die note weiterhin "Kapitel-Freitext"
// behauptete. Der Aufrufer berechnet "collision" jetzt GARANTIERT auf
// demselben Zeilenstand wie explainNote (siehe dort).
// "collisionRange" (nur bei collision:true relevant, sonst ignoriert) ist AUS
// DEMSELBEN GRUND ebenfalls vom Aufrufer VORAB (auf dem unmutierten Stand)
// ermittelt und um die anschließende Quell-Entfernung index-verschoben
// durchgereicht – ein zweiter, HIER laufender findAddressableChapter()-Aufruf
// (wie ursprünglich in insertEntryIntoChapterPreamble) hätte auf dem bereits
// bereinigten "lines" DENSELBEN Titelzeilen-Fehlschluss gezogen (empirisch
// bei der Fix-Verifikation aufgefallen: eine testbare Datenlage erzeugte
// dadurch ein zweites "# X" STATT der erwarteten Präambel-Einfügung in das
// BESTEHENDE Kapitel – kein bloßes "per Name neu suchen" reicht hier, weil
// die Titelzeilen-Eigenschaft selbst vom (nicht mehr vorhandenen) Kontext
// abhängt). "collisionRange" ist null, wenn das Kollisions-Kapitel selbst
// erst neu angelegt werden muss (siehe resolveSectionTarget) – dann bleibt
// die Namens-basierte Neuanlage in insertEntryIntoChapterPreamble() unten
// unverändert richtig (ein NOCH NICHT existierendes Kapitel kann durch die
// Quell-Mutation nicht fälschlich zur Titelzeile werden).
function insertEntryIntoSection(lines, headingDisp, chapterField, blockLines, collision, collisionRange) {
  if (collision) {
    insertEntryIntoChapterPreamble(lines, chapterField || headingDisp, blockLines, collisionRange);
    return;
  }
  let range = null;
  if (chapterField) {
    range = findChapter(lines, chapterField);
    if (!range) {
      padEnd(lines);
      const chapterLineIdx = lines.length;
      lines.push("# " + dispHead(chapterField), "");
      range = [chapterLineIdx, lines.length];
    }
  }
  const b = findSection(lines, headingDisp, range);
  if (!b) {
    if (range) {
      lines.splice(range[1], 0, "## " + headingDisp, "", ...blockLines, "");
    } else {
      padEnd(lines);
      lines.push("## " + headingDisp, "", ...blockLines, "");
    }
    return;
  }
  let at = b[1];
  while (at > b[0] + 1 && lines[at - 1].trim() === "") at--;
  lines.splice(at, 0, ...blockLines);
}

// Ziel-Einfügung für move_entry mit NUR gesetztem "to_chapter" (v7.50) –
// append_to_chapter-Semantik: identisch zum bestehenden append_to_chapter-
// Zweig in applyOne (Präambel-Einfügung VOR dem ersten ##-Abschnitt, fehlendes
// Kapitel wird am Dokumentende angelegt) – nutzt denselben
// findAddressableChapter()/insertIntoChapterPreamble()-Unterbau, damit beide
// Op-Typen GARANTIERT dasselbe Anlage-/Einfüge-Verhalten zeigen.
// v7.52.1 (Review-Finding 1, Spiegelprinzip-Drift, DECISIONS #109): vierter
// Parameter "range" ist PFLICHT (kein optionaler Fallback mehr, Review-
// Nachbesserung 🔵 2) – Range kommt IMMER vom Aufrufer, VOR der Quell-Mutation
// ermittelt (siehe collision-Aufruf in insertEntryIntoSection oben sowie der
// reine to_chapter-Zweig in applyOne). Ein hier NEU laufender, positions-
// abhängiger findAddressableChapter()-Aufruf auf dem bereits um die Quellzeile
// bereinigten Array wäre GEFÄHRLICH (Titelzeilen-Ausschluss per titleLineIdx,
// siehe dort, könnte je nach entfernter Quellzeile zu einem ANDEREN Ergebnis
// kommen als der Aufrufer VOR der Quell-Entfernung ermittelt hat – dieselbe
// Fehlerfamilie wie beim collisionRange-Fix oben) – deshalb bewusst KEIN
// Fallback mehr, beide bestehenden Aufrufer übergeben "range" ausnahmslos.
function insertEntryIntoChapterPreamble(lines, chapterField, blockLines, range) {
  const chapterDisp = dispHead(chapterField);
  if (!range) {
    padEnd(lines);
    lines.push("# " + chapterDisp, "", ...blockLines);
    return;
  }
  insertIntoChapterPreamble(lines, range, blockLines);
}

function applyOne(text, op) {
  if (!op || typeof op !== "object") return text;

  if (op.type === "rewrite") {
    return typeof op.content === "string" && op.content.trim()
      ? op.content.trim() + "\n"
      : text;
  }

  // v7.32 (delete_chapter-Op, Live-Befund): eigener, VOR der Abschnitts-
  // Adressierung unten liegender Zweig – delete_chapter adressiert über
  // "chapter" (mit "heading"-Fallback, siehe chapterFieldFor), NICHT über
  // "heading" wie die drei ##-Abschnitts-Ops. Müsste dieser Zweig NACH der
  // "const disp = dispHead(op.heading)"-Zeile unten stehen, würde ein
  // delete_chapter OHNE heading-Feld (der Normalfall) dort bereits als
  // No-op abgefangen, bevor "chapter" überhaupt geprüft wird.
  if (op.type === "delete_chapter") {
    const chapterField = chapterFieldFor(op);
    const chapterDisp = dispHead(chapterField);
    if (!chapterDisp) return text; // weder chapter noch heading gesetzt
    const chLines = text.split("\n");
    // TITELZEILEN-SCHUTZ (Pflicht, siehe DECISIONS #74 und
    // markdown.jsx#parseTree): die Notizbuch-Titelzeile ("# " + Name, per
    // Konvention IMMER die erste Zeile) ist NIE ein Kapitel – ein
    // delete_chapter auf den Notizbuchnamen darf sie nicht treffen, sonst
    // reißt es Titel + kompletten Vorspann bis zum ersten ECHTEN Kapitel
    // mit. findAddressableChapter() setzt die Suche NACH einer zuerst
    // getroffenen Titelzeile fort (Review-Fix 🟡, v7.32.1) – ein REGULÄRES
    // Kapitel mit demselben Namen wie der Notizbuch-Titel (z. B. Titel
    // "# Projekte" UND ein echtes "# Projekte"-Kapitel weiter unten) bleibt
    // dadurch löschbar, statt wegen des ERSTEN Treffers (der Titelzeile)
    // dauerhaft blockiert zu sein. Erkennung über POSITION, NICHT über
    // Namensvergleich – ein Dokument OHNE führende "# "-Zeile hat keine
    // Titel-Ausnahme, dort ist auch die erste "# "-Zeile ein normales,
    // löschbares Kapitel.
    const { range } = findAddressableChapter(chLines, chapterField);
    if (!range) return text; // nicht gefunden ODER nur als Titelzeile getroffen
    chLines.splice(range[0], range[1] - range[0]);
    return tidy(chLines);
  }

  // v7.40 (append_to_chapter-Op, Live-Befund "Kapitel-Duplikat" – siehe
  // DECISIONS #80): eigener Zweig, ebenfalls VOR der "heading"-Adressierung
  // unten platziert (append_to_chapter adressiert wie delete_chapter über
  // "chapter"/chapterFieldFor, hat i. d. R. KEIN eigenes op.heading – ein
  // Zweig NACH der "const disp = dispHead(op.heading)"-Zeile würde das ohne
  // heading sofort als No-op abfangen, bevor "chapter" geprüft wird).
  // Hängt content als KAPITEL-FREITEXT direkt unter die #-Kapitelzeile an,
  // VOR dem ersten ##-Abschnitt – die einzige bisherige Möglichkeit war ein
  // ##-Abschnitt (append_to_section), was das Modell reflexartig zum
  // Kapitelnamen duplizieren ließ ("# KPIs" mit redundantem "## KPIs"
  // darin). Fehlt das Kapitel (auch: nur Titelzeile getroffen, siehe
  // findAddressableChapter), wird es analog zu append_to_section/
  // replace_section (v7.23) am Dokumentende neu angelegt – zwei
  // aufeinanderfolgende Ops auf dasselbe neue Kapitel landen dadurch im
  // SELBEN Kapitel (Ops laufen sequenziell auf dem Zwischenstand, siehe
  // applyOpsDetailed).
  if (op.type === "append_to_chapter") {
    const chapterField = chapterFieldFor(op);
    const chapterDisp = dispHead(chapterField);
    if (!chapterDisp) return text; // weder chapter noch heading gesetzt
    const content =
      typeof op.content === "string" ? op.content.replace(/^\n+|\n+$/g, "") : "";
    if (!content) return text;
    const chLines = text.split("\n");
    const { range } = findAddressableChapter(chLines, chapterField);
    if (!range) {
      // Kapitel nicht vorhanden (ODER nur als Titelzeile getroffen) -> neu
      // anlegen, konsistent zum v7.23-Verhalten von append_to_section/
      // replace_section mit fehlendem chapter.
      padEnd(chLines);
      chLines.push("# " + chapterDisp, "", ...content.split("\n"));
      return tidy(chLines);
    }
    // Einfüge-Position: direkt VOR dem ersten ##-Abschnitt des Kapitels
    // (bzw. am Kapitelende, falls keiner existiert) – NACH evtl.
    // vorhandenem Präambel-Freitext (v7.52: ausgelagert in
    // insertIntoChapterPreamble() – DIESELBE Funktion nutzt jetzt auch die
    // v7.52-Kollisions-Umleitung von append_to_section/replace_section
    // unten, siehe dortiger Kommentar).
    insertIntoChapterPreamble(chLines, range, content.split("\n"));
    return tidy(chLines);
  }

  // v7.50 (delete_entry-Op, Live-Vorfall bison.box – siehe DECISIONS #103):
  // eigener Zweig, VOR der "heading"-Adressierung unten platziert – "heading"
  // ist bei delete_entry OPTIONAL (nur eine von drei möglichen Scope-
  // Eingrenzungen, siehe entryScope), ein Zweig NACH der "const disp ="-Zeile
  // würde eine Op OHNE heading (z. B. nur mit "chapter" oder ganz ohne
  // Eingrenzung) sofort fälschlich als No-op abfangen. Löscht GENAU EINE
  // Zeile (plus deren stärker eingerückte Kinderzeilen) – NIEMALS einen
  // ganzen Abschnitt/Kapitel wie delete_section/delete_chapter.
  if (op.type === "delete_entry") {
    const entryText = typeof op.entry === "string" ? op.entry : "";
    if (!norm(entryText)) return text; // leerer/fehlender entry -> Skip
    const deLines = text.split("\n");
    const { range, notFound } = entryScope(deLines, op.heading, op.chapter);
    if (notFound) return text; // Abschnitt/Kapitel nicht gefunden -> Skip
    const hits = findEntryLines(deLines, range, entryText);
    // 0 ODER ≥2 Treffer -> Skip (Sicherheitsgarantie: NIE mehr als einen
    // Eintrag anfassen, siehe Kopfkommentar der Datei).
    if (hits.length !== 1) return text;
    const [s, e] = entryBlockRange(deLines, hits[0]);
    deLines.splice(s, e - s);
    return tidy(deLines);
  }

  // v7.50 (move_entry-Op, Live-Vorfall bison.box – siehe DECISIONS #103):
  // ATOMARER Umzug EINES Eintrags innerhalb EINES Notizbuchs. Alle Prüfungen
  // (Quelle gefunden, Eintrag eindeutig gefunden, mindestens ein Ziel-Feld
  // gesetzt) laufen auf der LOKALEN Kopie "meLines" VOR jeder Änderung daran
  // – jeder vorzeitige "return text" liefert dadurch GARANTIERT den
  // byte-identischen Ausgangstext zurück (Atomaritäts-Garantie: es entsteht
  // NIE ein Zwischenzustand "Eintrag ist aus der Quelle weg, aber im Ziel
  // nicht angekommen", der genau der Live-Vorfall war, siehe DECISIONS #103).
  if (op.type === "move_entry") {
    const entryText = typeof op.entry === "string" ? op.entry : "";
    if (!norm(entryText)) return text;
    const toHeadingDisp = dispHead(op.to_heading);
    const toChapterDisp = dispHead(op.to_chapter);
    if (!toHeadingDisp && !toChapterDisp) return text; // mind. EIN Ziel-Feld ist Pflicht
    const meLines = text.split("\n");
    const { range, notFound } = entryScope(meLines, op.from_heading, op.from_chapter);
    if (notFound) return text;
    const hits = findEntryLines(meLines, range, entryText);
    if (hits.length !== 1) return text;
    // v7.52.1 (Review-Finding 1, Spiegelprinzip-Drift, DECISIONS #109): die
    // Ziel-ADRESSIERUNG (Kollisions-Entscheidung für to_heading BZW. die
    // Kapitel-Range für ein reines to_chapter-Ziel) wird HIER, VOR dem
    // meLines.splice() der Quelle weiter unten, auf demselben Zeilenstand
    // ermittelt wie explainNote() (dort: "before", der komplett UNMUTIERTE
    // Ausgangstext) – sonst könnte das Entfernen der Quellzeile (z. B. wenn
    // sie die einzige nicht-leere Zeile VOR dem Ziel-Kapitel war) dessen
    // Titelzeilen-Position verschieben (siehe titleLineIdx) und ein ZWEITER,
    // ERST NACH der Mutation laufender Aufruf zu einem ANDEREN Ergebnis
    // kommen als beim explainNote-Aufruf auf "before" – Grundprinzip dieser
    // Datei (EIN Entscheidungspfad für Anwendung UND Erklärung) verletzt,
    // siehe insertEntryIntoSection-Kommentar oben für das konkrete Beispiel.
    const targetResolved = toHeadingDisp
      ? resolveSectionTarget(meLines, { heading: op.to_heading, chapter: toChapterDisp ? op.to_chapter : null })
      : null;
    const toChapterOnlyRange = (!toHeadingDisp && toChapterDisp)
      ? findAddressableChapter(meLines, op.to_chapter).range
      : null;
    // ALLE Prüfungen bestanden – ab hier wird "meLines" tatsächlich mutiert.
    const [s, e] = entryBlockRange(meLines, hits[0]);
    const block = dedentBlock(meLines.slice(s, e));
    meLines.splice(s, e - s);
    // Die oben (VOR der Mutation) ermittelten Ziel-Ranges verweisen noch auf
    // Indizes des UNMUTIERTEN Arrays – für die tatsächliche Einfügung unten
    // (die auf "meLines" NACH der Quell-Entfernung arbeitet) müssen sie um
    // die Länge des entfernten Quell-Blocks nachgeführt werden. Eine echte
    // Struktur-/Kapitelzeile kann NIE innerhalb von [s, e) liegen – eine
    // #/##-Zeile steht immer in Spalte 0 und beendet den Block über die
    // Einrückungsregel in entryBlockRange (indentOf ≤ baseIndent), siehe
    // dort (Review-Nachbesserung 🔵 3, DECISIONS #109: der Abbruch kommt NICHT
    // von BOUNDARY_RE, entryBlockRange nutzt es gar nicht) – die beiden
    // Bereiche überlappen also nie, ein Range liegt IMMER GANZ vor ODER GANZ
    // ab dem entfernten Block.
    const shiftIdx = (i) => (i >= e ? i - (e - s) : i);
    const shiftRange = (r) => (r ? [shiftIdx(r[0]), shiftIdx(r[1])] : r);
    // Ziel-Einfügung IMMER auf dem bereits um die Quelle bereinigten Array
    // (Quelle==Ziel verschiebt den Eintrag dadurch korrekt ans Zielende,
    // statt ihn zu duplizieren) – die Ziel-ADRESSIERUNG selbst kommt dabei
    // GARANTIERT aus den oben (VOR der Mutation) berechneten, jetzt nur noch
    // index-verschobenen Ranges, NIE aus einer zweiten Suche auf dem bereits
    // mutierten Array (siehe Kommentare oben).
    if (toHeadingDisp) {
      const collision = !!(targetResolved && targetResolved.collision);
      insertEntryIntoSection(
        meLines, toHeadingDisp, toChapterDisp ? op.to_chapter : null, block,
        collision, collision ? shiftRange(targetResolved.collisionRange) : undefined
      );
    } else {
      insertEntryIntoChapterPreamble(meLines, op.to_chapter, block, shiftRange(toChapterOnlyRange));
    }
    return tidy(meLines);
  }

  // v7.52 (replace_entry-Op, Live-Vorfall "KPIs"-Duplikat Turn 2 – siehe
  // DECISIONS #106): eigener Zweig, VOR der "heading"-Adressierung unten
  // platziert (dieselbe Begründung wie bei delete_entry/move_entry – "entry"
  // ist Pflicht, "heading" nur eine von mehreren optionalen Scope-
  // Eingrenzungen, siehe entryScope). Ersetzt den TEXT einer bereits
  // gefundenen Eintragszeile (samt ihrer Kinderzeilen, siehe
  // entryBlockRange) DURCH neuen content, OHNE die Zeile zu verschieben oder
  // umzustrukturieren. Live-Vorfall: das Modell wollte NUR eine bereits
  // bestehende Kapitel-Freitext-Zeile ändern ("Offener Punkt:
  // KPI-Definition klären" um einen Klammer-Zusatz ergänzen) – dafür gab es
  // bisher KEINE Op (replace_section hätte den GESAMTEN Kapitel-Freitext
  // ersetzt bzw. wäre in die v7.52-Kollisions-Umleitung gelaufen, siehe
  // resolveSectionTarget/explainSkip unten).
  if (op.type === "replace_entry") {
    const entryText = typeof op.entry === "string" ? op.entry : "";
    if (!norm(entryText)) return text; // leerer/fehlender entry -> Skip
    const content = typeof op.content === "string" ? op.content.replace(/^\n+|\n+$/g, "") : "";
    if (!content) return text; // leerer content -> Skip (zum Löschen delete_entry nutzen)
    const reLines = text.split("\n");
    const { range, notFound } = entryScope(reLines, op.heading, op.chapter);
    if (notFound) return text; // Abschnitt/Kapitel nicht gefunden -> Skip
    const hits = findEntryLines(reLines, range, entryText);
    if (hits.length !== 1) return text; // 0 ODER ≥2 Treffer -> Skip (wie delete_entry/move_entry)
    const [s, e] = entryBlockRange(reLines, hits[0]);
    // Einrückung der TREFFERZEILE bleibt erhalten (content ersetzt nur den
    // TEXT, nicht die Position im Baum) – Leerzeilen im content bleiben
    // Leerzeilen (kein angehängter Trailing-Whitespace).
    const indent = reLines[hits[0]].match(/^\s*/)[0];
    const newLines = content.split("\n").map((l) => (l.trim() === "" ? "" : indent + l));
    // Struktur-Schutz (wie überall in dieser Datei, siehe BOUNDARY_RE-Filter
    // in findEntryLines): der ERSETZTE Text darf selbst KEINE #/##-Zeile
    // enthalten – sonst könnte replace_entry eine echte Kapitel-/
    // Abschnittsgrenze einschmuggeln (dieselbe Gefahrenklasse wie die
    // Struktur-Injektion aus v7.50.2/DECISIONS #104 bei dedentBlock).
    const mask = computeFenceLineMask(newLines);
    for (let i = 0; i < newLines.length; i++) {
      if (!mask[i] && BOUNDARY_RE.test(newLines[i])) return text;
    }
    reLines.splice(s, e - s, ...newLines);
    return tidy(reLines);
  }

  const disp = dispHead(op.heading);
  if (!disp) return text;
  const lines = text.split("\n");
  const content =
    typeof op.content === "string" ? op.content.replace(/^\n+|\n+$/g, "") : "";

  // v7.52 (Live-Vorfall "KPIs"-Duplikat, DECISIONS #106): BEVOR die
  // bisherige Kapitel-/Abschnitts-Suche/-Anlage (unverändert weiter unten)
  // läuft, klärt resolveSectionTarget() rein lesend, ob "heading" (ggf.
  // zusammen mit "chapter") tatsächlich ein GLEICHNAMIGES #-Kapitel OHNE
  // eigenen ##-Abschnitt trifft – sonst würde "wird angelegt, falls er
  // fehlt" (v7.23, s. u.) stur ein redundantes "## X" INNERHALB von "# X"
  // erzeugen (genau der Live-Vorfall: {"heading":"## KPIs","chapter":"#
  // KPIs"} bei einem Kapitel, dessen Inhalt bereits als REINER
  // Kapitel-Freitext dastand). OHNE Kollision bleibt das gesamte Verhalten
  // ab hier BYTE-IDENTISCH zu vor v7.52 (siehe Tests) – der komplette
  // bestehende Anlage-/Such-Block unten ist UNVERÄNDERT.
  const resolved = resolveSectionTarget(lines, { heading: op.heading, chapter: op.chapter });

  if (resolved.collision) {
    if (op.type === "delete_section") return text; // s. explainSkip: Hinweis auf delete_chapter
    if (op.type === "append_to_section" || op.type === "replace_section") {
      if (!content) return text;
      // replace_section ersetzt NIEMALS bereits vorhandenen Kapitel-
      // Freitext (impliziter Datenverlust ohne jede Bestätigung wäre die
      // Folge) – nur eine LEERE Präambel (oder ein noch fehlendes Kapitel)
      // darf befüllt werden. append_to_section hängt dagegen wie gewohnt an.
      if (op.type === "replace_section" && !resolved.preambleEmpty) return text;
      if (resolved.collisionRange === null) {
        // Kapitel selbst fehlt komplett (chapter === heading, aber (noch)
        // kein "# X" im Dokument) -> exakt wie append_to_chapter bei
        // fehlendem Kapitel: neu am Dokumentende anlegen, content als
        // Freitext (KEIN "## X" darin).
        padEnd(lines);
        lines.push("# " + dispHead(resolved.chapterField), "", ...content.split("\n"));
      } else {
        insertIntoChapterPreamble(lines, resolved.collisionRange, content.split("\n"));
      }
      return tidy(lines);
    }
    return text;
  }

  // -- Ab hier: Verhalten VOR v7.52, UNVERÄNDERT (siehe Kommentare unten). --

  // Optionales "chapter"-Feld (v7.14): grenzt die Suche auf den Zeilenbereich
  // EINES Kapitels ein – für mehrdeutige Abschnittsnamen (derselbe ##-Titel
  // kommt in mehreren Kapiteln vor) oder eine gezielte Kapitel-Zuordnung.
  // Ohne "chapter"-Feld verhält sich applyOne exakt wie vor v7.14 (globale
  // Suche, erster Treffer gewinnt).
  //
  // v7.23 (Verschiebe-Auftrag, Live-Befund – siehe DECISIONS): Fehlt das
  // referenzierte Kapitel, wird es für append_to_section/replace_section
  // jetzt selbst NEU ANGELEGT (Konsistenz zur bestehenden Praxis, fehlende
  // ABSCHNITTE anzulegen – siehe die replace_section/append_to_section-
  // Zweige unten) statt die Op stillschweigend zu überspringen. Grund:
  // "Verschiebe Abschnitt X in Notizbuch Y als NEUES Kapitel Z" hatte bisher
  // KEINEN gezielten Op-Weg – ein rewrite des kompletten Ziel-Notizbuchs nur
  // für ein neues Kapitel ist unverhältnismäßig, und der v7.14-Skip führte
  // dazu, dass die Quelle bereits gelöscht war, während das Ziel (mangels
  // Kapitel) NICHTS bekam – der Inhalt hing zwischenzeitlich in keinem
  // Notizbuch. delete_section bleibt bewusst beim alten Skip (Ambiguitäts-/
  // Sicherheits-Schutz: nichts löschen, was man nicht sicher adressiert –
  // dafür gibt es keinen "lösch das doch einfach an beliebiger Stelle"-
  // Ersatz). Kapitel+Abschnitt landen an dieser Stelle IMMER am
  // Dokumentende (tidy-konform mit Leerzeilen) – zwei aufeinanderfolgende
  // Ops mit demselben NEUEN chapter landen dadurch im SELBEN Kapitel: die
  // erste Op legt es an, die zweite findet es über findChapter bereits vor
  // (Ops laufen sequenziell auf dem jeweiligen Zwischenstand, siehe
  // applyOpsDetailed).
  let range = null;
  if (typeof op.chapter === "string" && op.chapter.trim()) {
    range = findChapter(lines, op.chapter);
    if (!range) {
      if (op.type === "delete_section") return text; // v7.14-Skip bleibt NUR hier
      const chapterDisp = dispHead(op.chapter);
      if (!chapterDisp) return text; // Randfall: chapter nach Bereinigung leer (z. B. nur "#"/"##")
      padEnd(lines);
      const chapterLineIdx = lines.length;
      lines.push("# " + chapterDisp, "");
      range = [chapterLineIdx, lines.length]; // frisches Kapitel = letztes im Dokument, e === Dokumentende
    }
  }

  const b = findSection(lines, disp, range);

  if (op.type === "delete_section") {
    if (!b) return text;
    lines.splice(b[0], b[1] - b[0]);
    return tidy(lines);
  }

  if (op.type === "replace_section") {
    const block = ["## " + disp, "", ...(content ? content.split("\n") : []), ""];
    if (b) lines.splice(b[0], b[1] - b[0], ...block);
    else if (range) lines.splice(range[1], 0, ...block); // neu, aber INNERHALB des Kapitels
    else { padEnd(lines); lines.push(...block); }
    return tidy(lines);
  }

  if (op.type === "append_to_section") {
    if (!content) return text;
    if (!b) {
      if (range) {
        lines.splice(range[1], 0, "## " + disp, "", ...content.split("\n"), "");
      } else {
        padEnd(lines);
        lines.push("## " + disp, "", ...content.split("\n"), "");
      }
      return tidy(lines);
    }
    let at = b[1];
    while (at > b[0] + 1 && lines[at - 1].trim() === "") at--;
    lines.splice(at, 0, ...content.split("\n"));
    return tidy(lines);
  }

  return text;
}

// v7.21 (Ops-Zuverlässigkeit, Live-Befund): applyOps() selbst überspringt
// wirkungslose Ops bisher KOMMENTARLOS – weder der Nutzer noch das Modell
// erfahren, WARUM eine angekündigte Änderung ausblieb (siehe DECISIONS #63).
// Die Op-Typen, die applyOne() tatsächlich versteht – alles andere ist
// aus Sicht DIESES Moduls ein unbekannter Typ (memory_*-Ops werden vorher in
// App.jsx#splitOps herausgefiltert und laufen nie hier durch, siehe dort).
// v7.32: delete_chapter ergänzt (siehe applyOne/explainSkip, DECISIONS #74).
// v7.40: append_to_chapter ergänzt (siehe applyOne/explainSkip, DECISIONS #80).
// v7.50: delete_entry/move_entry ergänzt (siehe applyOne/explainSkip, DECISIONS #103).
// v7.52: replace_entry ergänzt (siehe applyOne/explainSkip, DECISIONS #106).
const OP_TYPES = [
  "append_to_section", "replace_section", "delete_section", "delete_chapter", "append_to_chapter",
  "delete_entry", "move_entry", "replace_entry", "rewrite",
];

// Rahmen-Integrität des SYSTEM-HINWEIS (Review-Fix 🟡, Defense-in-Depth
// Schicht 1/"Quelle"): heading/chapter/type in einer Op stammen vom MODELL
// selbst (Teil seiner eigenen JSON-Antwort) und landen über explainSkip()
// unten in einer reason-Zeichenkette, die App.jsx#buildOpsWarning zu
// m.warning zusammenbaut – das wiederum in lib/anthropic.js#callClaude in
// einen "[SYSTEM-HINWEIS: …]"-Rahmen für die nächste Modell-Runde gepackt
// wird. Ein Heading wie 'Foo]\n\n[SYSTEM-HINWEIS: …' könnte diesen Rahmen
// sonst sprengen/verdoppeln (Prompt-Injection über den eigenen Reason-Text).
// Säubert HIER an der Quelle: Nullbytes raus, Whitespace-Folgen (inkl.
// Zeilenumbrüche) zu einem Leerzeichen, eckige Klammern zu runden
// (entschärft "]"/"[SYSTEM-HINWEIS:" strukturell), auf ~100 Zeichen gekappt.
// Schicht 2 ("Senke") sitzt zusätzlich in lib/anthropic.js#callClaude, damit
// AUCH eine künftige, hier vergessene Warn-Quelle den Rahmen nie brechen
// kann – zwei unabhängige Schichten, siehe DECISIONS.
const WARN_TEXT_MAX = 100;
function sanitizeForWarning(s) {
  const noNulStr = String(s || "").split(String.fromCharCode(0)).join("");
  const collapsed = noNulStr.replace(/\s+/g, " ").trim();
  const bracketsSafe = collapsed.replace(/\[/g, "(").replace(/\]/g, ")");
  return bracketsSafe.length > WARN_TEXT_MAX ? bracketsSafe.slice(0, WARN_TEXT_MAX) + "…" : bracketsSafe;
}

// Erklärt NACHTRÄGLICH – nur wenn applyOpsDetailed() bereits per Vorher/
// Nachher-Textvergleich festgestellt hat, dass eine Op NICHTS verändert hat
// – WARUM. Dupliziert bewusst NUR die REIN LESENDEN Entscheidungen aus
// applyOne() (kein zweiter Schreibpfad, kein Risiko einer abweichenden
// Textausgabe zwischen Anwendung und Erklärung): welcher Op-Typ, ob Kapitel/
// Abschnitt gefunden wurden, ob content leer ist. Reihenfolge der Prüfungen
// spiegelt exakt applyOne() (Kapitel-Filter vor Abschnitts-Suche usw.).
function explainSkip(text, op) {
  if (!op || typeof op !== "object" || !OP_TYPES.includes(op.type)) {
    return "unbekannter Op-Typ" + (op && typeof op === "object" && op.type ? " „" + sanitizeForWarning(op.type) + "“" : "");
  }
  if (op.type === "rewrite") {
    // v7.21.1 (Review-Fix 🔵): NICHT pauschal "leerer content" – ein
    // rewrite mit NICHT-leerem, aber zufällig textidentischem Inhalt (siehe
    // applyOne: dann bleibt der Text unverändert) ist kein Leer-content-
    // Fall, sondern derselbe generische Fallback wie bei replace_section.
    const content = typeof op.content === "string" ? op.content.trim() : "";
    return content ? "keine inhaltliche Änderung" : "leerer content";
  }
  // v7.32 (delete_chapter-Op): eigener Zweig, spiegelt applyOne exakt (siehe
  // dort, inkl. findAddressableChapter/Review-Fix 🟡 v7.32.1) – Prüfreihenfolge:
  // chapterField leer -> Kapitel gar nicht gefunden -> nur als Titelzeile
  // getroffen (kein weiteres gleichnamiges Kapitel) -> (sonst: applied wäre
  // true, landet nie hier).
  if (op.type === "delete_chapter") {
    const chapterField = chapterFieldFor(op);
    const chapterDisp = dispHead(chapterField);
    if (!chapterDisp) return "fehlende Kapitel-Überschrift";
    const lines = text.split("\n");
    const { range, titleBlocked } = findAddressableChapter(lines, chapterField);
    if (!range) {
      if (titleBlocked) {
        return "„" + sanitizeForWarning(chapterDisp) + "“ ist die Notizbuch-Titelzeile, kein Kapitel";
      }
      return "Kapitel „" + sanitizeForWarning(chapterDisp) + "“ nicht gefunden – Op übersprungen";
    }
    // Gefunden (ggf. NACH der Titelzeile, siehe findAddressableChapter) ->
    // applyOne hätte gelöscht (applied wäre true) - dieser Zweig wird unter
    // normalen Umständen nie erreicht.
    return "keine inhaltliche Änderung";
  }
  // v7.40 (append_to_chapter-Op, DECISIONS #80): eigener Zweig, spiegelt
  // applyOne exakt (NUR lesende Prüfungen) – Prüfreihenfolge: chapterField
  // leer -> content leer -> (sonst: applied wäre true, landet praktisch nie
  // hier, da ein gefundenes ODER neu angelegtes Kapitel IMMER etwas
  // einfügt). Anders als delete_chapter braucht dieser Zweig KEINE
  // titleBlocked-Fallunterscheidung: findAddressableChapter() liefert bei
  // "nicht gefunden" UND "nur Titelzeile getroffen" gleichermaßen
  // range===null, applyOne behandelt BEIDE Fälle identisch (Kapitel neu
  // anlegen statt Skip).
  if (op.type === "append_to_chapter") {
    const chapterField = chapterFieldFor(op);
    const chapterDisp = dispHead(chapterField);
    if (!chapterDisp) return "fehlende Kapitel-Überschrift";
    const content = typeof op.content === "string" ? op.content.replace(/^\n+|\n+$/g, "") : "";
    if (!content) return "leerer content";
    return "keine inhaltliche Änderung";
  }
  // v7.50 (delete_entry-Op, DECISIONS #103): eigener Zweig, spiegelt applyOne
  // exakt (NUR lesende Prüfungen, dieselbe entryScope()/findEntryLines()-
  // Logik) – Prüfreihenfolge: leerer entry -> Scope (Abschnitt/Kapitel) nicht
  // gefunden -> Eintrag nicht gefunden/mehrdeutig -> (sonst: applied wäre
  // true, landet praktisch nie hier).
  if (op.type === "delete_entry") {
    const entryText = typeof op.entry === "string" ? op.entry : "";
    const entryDisp = norm(entryText);
    if (!entryDisp) return "leerer entry";
    const lines = text.split("\n");
    const { range, notFound } = entryScope(lines, op.heading, op.chapter);
    if (notFound === "chapter") {
      return "Kapitel „" + sanitizeForWarning(dispHead(op.chapter)) + "“ nicht gefunden – Op übersprungen";
    }
    if (notFound === "heading") {
      return "Abschnitt „" + sanitizeForWarning(dispHead(op.heading)) + "“ nicht gefunden";
    }
    const hits = findEntryLines(lines, range, entryText);
    if (hits.length === 0) return "Eintrag „" + sanitizeForWarning(entryDisp) + "“ nicht gefunden";
    if (hits.length > 1) {
      return "Eintrag „" + sanitizeForWarning(entryDisp) + "“ mehrdeutig (" + hits.length +
        " Treffer) – exakteren Wortlaut oder heading/chapter angeben";
    }
    return "keine inhaltliche Änderung";
  }
  // v7.50 (move_entry-Op, DECISIONS #103): eigener Zweig, spiegelt applyOne
  // exakt – Prüfreihenfolge: leerer entry -> fehlendes Ziel (weder to_heading
  // noch to_chapter) -> Quell-Scope nicht gefunden -> Eintrag nicht
  // gefunden/mehrdeutig -> (sonst: applied wäre true).
  if (op.type === "move_entry") {
    const entryText = typeof op.entry === "string" ? op.entry : "";
    const entryDisp = norm(entryText);
    if (!entryDisp) return "leerer entry";
    const toHeadingDisp = dispHead(op.to_heading);
    const toChapterDisp = dispHead(op.to_chapter);
    if (!toHeadingDisp && !toChapterDisp) return "fehlendes Ziel – to_heading oder to_chapter angeben";
    const lines = text.split("\n");
    const { range, notFound } = entryScope(lines, op.from_heading, op.from_chapter);
    if (notFound === "chapter") {
      return "Kapitel „" + sanitizeForWarning(dispHead(op.from_chapter)) + "“ nicht gefunden – Op übersprungen";
    }
    if (notFound === "heading") {
      return "Abschnitt „" + sanitizeForWarning(dispHead(op.from_heading)) + "“ nicht gefunden";
    }
    const hits = findEntryLines(lines, range, entryText);
    if (hits.length === 0) return "Eintrag „" + sanitizeForWarning(entryDisp) + "“ nicht gefunden";
    if (hits.length > 1) {
      return "Eintrag „" + sanitizeForWarning(entryDisp) + "“ mehrdeutig (" + hits.length +
        " Treffer) – exakteren Wortlaut oder heading/chapter angeben";
    }
    return "keine inhaltliche Änderung";
  }
  // v7.52 (replace_entry-Op, DECISIONS #106): eigener Zweig, spiegelt
  // applyOne exakt (dieselbe entryScope()/findEntryLines()-Logik wie
  // delete_entry/move_entry) – Prüfreihenfolge: leerer entry -> leerer
  // content -> Scope nicht gefunden -> Eintrag nicht gefunden/mehrdeutig ->
  // Struktur-Schutz (der ERSETZTE Text selbst enthält eine #/##-Zeile) ->
  // (sonst: applied wäre true).
  if (op.type === "replace_entry") {
    const entryText = typeof op.entry === "string" ? op.entry : "";
    const entryDisp = norm(entryText);
    if (!entryDisp) return "leerer entry";
    const content = typeof op.content === "string" ? op.content.replace(/^\n+|\n+$/g, "") : "";
    if (!content) return "leerer content – zum Löschen delete_entry nutzen";
    const lines = text.split("\n");
    const { range, notFound } = entryScope(lines, op.heading, op.chapter);
    if (notFound === "chapter") {
      return "Kapitel „" + sanitizeForWarning(dispHead(op.chapter)) + "“ nicht gefunden – Op übersprungen";
    }
    if (notFound === "heading") {
      return "Abschnitt „" + sanitizeForWarning(dispHead(op.heading)) + "“ nicht gefunden";
    }
    const hits = findEntryLines(lines, range, entryText);
    if (hits.length === 0) return "Eintrag „" + sanitizeForWarning(entryDisp) + "“ nicht gefunden";
    if (hits.length > 1) {
      return "Eintrag „" + sanitizeForWarning(entryDisp) + "“ mehrdeutig (" + hits.length +
        " Treffer) – exakteren Wortlaut oder heading/chapter angeben";
    }
    const hitLine = lines[hits[0]];
    const indent = hitLine.match(/^\s*/)[0];
    const newLines = content.split("\n").map((l) => (l.trim() === "" ? "" : indent + l));
    const mask = computeFenceLineMask(newLines);
    for (let i = 0; i < newLines.length; i++) {
      if (!mask[i] && BOUNDARY_RE.test(newLines[i])) {
        return "content enthält Kapitel-/Abschnittszeilen – nur Eintragstext erlaubt";
      }
    }
    return "keine inhaltliche Änderung";
  }
  // v7.43 (Live-Befund, siehe DECISIONS #87): Meldung um eine konkrete
  // Handlungsanweisung ergänzt (statt nur "fehlende Abschnitts-
  // Überschrift") – landet über buildOpsWarning (App.jsx) im nächsten Turn
  // als SYSTEM-HINWEIS in der Historie und soll dem Modell direkt sagen,
  // WAS zu tun ist (heading nachreichen), statt nur DASS etwas fehlte. Der
  // Live-Fall: das Modell schickte replace_section OHNE heading (wollte
  // einen Abschnitt per HTML-Reinkopie in eine Tabelle umwandeln), reply
  // kündigte die Änderung bereits an – die Op wurde trotzdem ERSATZLOS
  // verworfen, ohne dass die ursprüngliche Meldung einen Ausweg nannte.
  const disp = dispHead(op.heading);
  if (!disp) return "fehlende Abschnitts-Überschrift – heading mit der exakten ##-Zeile angeben";
  const lines = text.split("\n");

  // v7.52 (Live-Vorfall "KPIs"-Duplikat, DECISIONS #106): spiegelt applyOne
  // exakt (siehe dortiger Kommentar) – dieselbe Kollisions-Entscheidung via
  // resolveSectionTarget(), VOR der alten Kapitel-/Abschnitts-Suche unten.
  const resolved = resolveSectionTarget(lines, { heading: op.heading, chapter: op.chapter });
  if (resolved.collision) {
    if (op.type === "delete_section") {
      // Review-Fix 🟡 (Runde 2): der delete_chapter-Verweis ist nur zutreffend,
      // wenn das kollidierende #-Kapitel TATSÄCHLICH existiert (collisionRange
      // gesetzt). Bei chapterMissing (chapter==heading, aber BEIDE fehlen,
      // s. resolveSectionTarget Fall ii) gibt es kein Kapitel, auf das
      // delete_chapter zeigen könnte – dann fällt die Prüfung bewusst durch
      // in die alte Kapitel-Suche unten, die den korrekten "nicht gefunden"-
      // Text liefert (Live-Befund, Review-Runde 2).
      if (resolved.collisionRange) {
        return "„" + sanitizeForWarning(disp) + "“ ist ein #-Kapitel ohne gleichnamigen ##-Abschnitt – zum Löschen des Kapitels delete_chapter nutzen";
      }
    } else {
      const collisionContent = typeof op.content === "string" ? op.content.replace(/^\n+|\n+$/g, "") : "";
      if (!collisionContent) return "leerer content";
      if (op.type === "replace_section" && !resolved.preambleEmpty) {
        return "„" + sanitizeForWarning(disp) + "“ ist ein #-Kapitel ohne gleichnamigen ##-Abschnitt – Kapitel-Freitext nicht ersetzt (kein ##-Duplikat angelegt); Eintrag ändern: replace_entry, Eintrag löschen: delete_entry, anhängen: append_to_chapter";
      }
      return "keine inhaltliche Änderung";
    }
  }

  let range = null;
  if (typeof op.chapter === "string" && op.chapter.trim()) {
    range = findChapter(lines, op.chapter);
    if (!range) {
      // v7.23: "Kapitel nicht gefunden" ist als SKIP-Grund nur noch für
      // delete_section korrekt – append_to_section/replace_section legen
      // ein fehlendes Kapitel inzwischen selbst an (siehe applyOne) und
      // landen bei einem fehlenden Kapitel deshalb so gut wie NIE mehr hier
      // (applied wird dabei true). Die zwei verbleibenden, seltenen
      // Sonderfälle unten deckt applyOne ebenfalls als echten No-op ab.
      if (op.type === "delete_section") {
        return "Kapitel „" + sanitizeForWarning(dispHead(op.chapter)) + "“ nicht gefunden – Op übersprungen";
      }
      if (!dispHead(op.chapter)) return "fehlende Kapitel-Überschrift";
      // Sonst (append_to_section, ggf. mit leerem content – replace_section
      // erreicht diesen Zweig praktisch nie, weil es bei fehlendem Kapitel
      // IMMER etwas anlegt): range bleibt bewusst null, die folgende
      // Abschnitts-Suche läuft dadurch GLOBAL statt kapitel-eingegrenzt –
      // für die reine Erklärung hier unschädlich, weil append_to_section
      // den einzig verbleibenden Skip-Grund (leerer content) unten
      // UNABHÄNGIG von b/range prüft.
    }
  }
  const b = findSection(lines, disp, range);
  if (op.type === "delete_section" && !b) return "Abschnitt „" + sanitizeForWarning(disp) + "“ nicht gefunden";
  if (op.type === "append_to_section") {
    const content = typeof op.content === "string" ? op.content.replace(/^\n+|\n+$/g, "") : "";
    if (!content) return "leerer content";
  }
  // replace_section legt bei fehlendem Abschnitt IMMER neu an (siehe
  // applyOne) – landet hier also nur, wenn der neue Inhalt zufällig
  // textidentisch mit dem vorherigen Stand war (kein Fehlerfall).
  return "keine inhaltliche Änderung";
}

// v7.52 (ℹ️-Notes, DECISIONS #106): rein lesend wie explainSkip – anders als
// dort aber NUR relevant, wenn eine Op TATSÄCHLICH etwas verändert hat
// (applyOpsDetailed ruft sie nur bei applied:true auf, siehe dort). Meldet
// implizite Kapitel-/Abschnitts-Anlagen sowie die v7.52-Umleitung in einen
// Kapitel-Freitext (siehe resolveSectionTarget/entryScope) – ohne diese
// Sichtbarkeit war GENAU das der Live-Vorfall: eine Op lief "erfolgreich"
// (applied:true, KEINE ⚠️-Warn-Pille), erzeugte dabei aber ein stilles
// Kapitelnamen-Duplikat. Arbeitet auf "before" (dem Text VOR applyOne),
// NICHT auf dem bereits mutierten Ergebnis – dieselbe Read-Only-Garantie
// wie explainSkip; beeinflusst applyOne/den Ergebnistext NIE.
function explainNote(before, op) {
  if (!op || typeof op !== "object") return undefined;
  const lines = before.split("\n");

  if (op.type === "append_to_section" || op.type === "replace_section") {
    const resolved = resolveSectionTarget(lines, { heading: op.heading, chapter: op.chapter });
    if (resolved.collision) {
      if (resolved.collisionRange === null) {
        return 'Kapitel „' + sanitizeForWarning(resolved.disp) + '“ neu angelegt, content als Kapitel-Freitext (kein ##-Duplikat)';
      }
      return 'in Kapitel-Freitext „' + sanitizeForWarning(resolved.disp) +
        '“ eingefügt – kein ##-Abschnitt „' + sanitizeForWarning(resolved.disp) +
        '“ vorhanden, Kapitelnamen-Duplikat vermieden (für einen echten ##-Abschnitt dieses Namens in einem anderen Kapitel chapter:"# …" angeben)';
    }
    if (isNewSectionCase(resolved)) return newSectionNote(lines, resolved);
    return undefined;
  }

  if (op.type === "append_to_chapter") {
    const chapterField = chapterFieldFor(op);
    const { range } = findAddressableChapter(lines, chapterField);
    if (!range) return 'Kapitel „' + sanitizeForWarning(dispHead(chapterField)) + '“ neu angelegt';
    return undefined;
  }

  if (op.type === "move_entry") {
    const parts = [];
    const { redirected } = entryScope(lines, op.from_heading, op.from_chapter);
    if (redirected) {
      // Review-Fix 🔵 (Runde 2): entryScope liefert bei einer Umleitung das
      // GESAMTE Kapitel (inkl. aller ##-Unterabschnitte) als Suchbereich, nicht
      // nur die Präambel – der Text "im Kapitel-Freitext gesucht" war bei einem
      // Treffer in einem ##-Unterabschnitt irreführend. "im gesamten Kapitel"
      // beschreibt den TATSÄCHLICHEN Suchbereich korrekt.
      parts.push('Quelle „' + sanitizeForWarning(dispHead(op.from_heading)) +
        '“ ist ein #-Kapitel ohne ##-Abschnitt – Eintrag im gesamten Kapitel gesucht');
    }
    const toHeadingDisp = dispHead(op.to_heading);
    const toChapterDisp = dispHead(op.to_chapter);
    if (toHeadingDisp) {
      // v7.52.1 (Review-Nachbesserung 🔵 4, DECISIONS #109): "chapter" wie in
      // applyOne (dort ca. Z. 878) NUR durchreichen, wenn toChapterDisp
      // NICHT-LEER ist – ein op.to_chapter, das nach dispHead() leer wird
      // (z. B. nur "#" ohne Namen), darf resolveSectionTarget NICHT als
      // gesetztes chapterField erreichen (chapterField dort prüft nur
      // trim(), nicht dispHead() – "#" gilt dort fälschlich als "gesetzt",
      // aber ungefunden -> chapterMissing:true -> irreführende "Kapitel
      // neu angelegt"-Note). Vorher wich diese Zeile von applyOne ab (dort
      // bereits korrekt "toChapterDisp ? op.to_chapter : null") - beide
      // MÜSSEN denselben Resolver-Input sehen (Grundprinzip dieser Datei).
      const resolved = resolveSectionTarget(lines, { heading: op.to_heading, chapter: toChapterDisp ? op.to_chapter : null });
      if (resolved.collision) {
        // Review-Fix 🔵 (Runde 2): analog zu append_to_section/replace_section
        // (siehe oben) den Sonderfall "Kapitel existierte noch gar nicht"
        // (collisionRange===null) explizit als Neuanlage kennzeichnen, statt
        // ihn wie eine reine Umleitung in ein BESTEHENDES Kapitel klingen zu
        // lassen.
        parts.push(resolved.collisionRange === null
          ? 'Kapitel „' + sanitizeForWarning(resolved.disp) + '“ neu angelegt, Eintrag als Kapitel-Freitext (kein ##-Duplikat)'
          : 'Eintrag in Kapitel-Freitext „' + sanitizeForWarning(resolved.disp) +
            '“ eingefügt (kein ##-Abschnitt „' + sanitizeForWarning(resolved.disp) + '“)');
      } else if (isNewSectionCase(resolved)) {
        parts.push(newSectionNote(lines, resolved));
      }
    } else if (toChapterDisp) {
      const { range } = findAddressableChapter(lines, op.to_chapter);
      if (!range) parts.push('Kapitel „' + sanitizeForWarning(toChapterDisp) + '“ neu angelegt');
    }
    return parts.length ? parts.join("; ") : undefined;
  }

  if (op.type === "delete_entry" || op.type === "replace_entry") {
    const { redirected } = entryScope(lines, op.heading, op.chapter);
    if (redirected) {
      // Review-Fix 🔵 (Runde 2, siehe move_entry-Zweig oben): "im gesamten
      // Kapitel" statt "im Kapitel-Freitext" – entryScope durchsucht bei einer
      // Umleitung das komplette Kapitel inkl. aller ##-Unterabschnitte.
      return '„' + sanitizeForWarning(dispHead(op.heading)) + '“ ist ein #-Kapitel ohne ##-Abschnitt – Eintrag im gesamten Kapitel gefunden';
    }
    return undefined;
  }

  return undefined;
}

// Gate für explainNote() oben: wurde ein ##-Abschnitt neu angelegt (statt
// eines bereits vorhandenen ergänzt/ersetzt)? Seit dem Review-Fix in
// resolveSectionTarget (🟡, Runde 1) liefert dieses bei chapterMissing IMMER
// sectionRange===null (keine globale Suche mehr) – "resolved.sectionRange
// === null" allein deckt daher BEIDE Fälle ab (fehlendes Kapitel UND
// fehlender Abschnitt in einem vorhandenen Kapitel); der frühere
// chapterMissing-Sonderfall (globaler Treffer hätte sectionRange sonst
// irreführend NICHT-null gemacht) entfällt damit.
function isNewSectionCase(resolved) {
  return resolved.sectionRange === null;
}

// Gemeinsamer Baustein für explainNote() oben (append_to_section/
// replace_section OHNE Kollision, aber mit fehlendem Abschnitt; move_entry
// mit to_heading analog) – beschreibt, WO ein fehlender ##-Abschnitt neu
// entsteht (im gefundenen Kapitel, in einem neu angelegten Kapitel, oder
// global am Dokumentende – dort ggf. mit Warnung, wenn das faktisch
// INNERHALB des letzten bestehenden Kapitels landet, siehe applyOne).
function newSectionNote(lines, resolved) {
  if (resolved.chapterMissing) {
    return 'Kapitel „' + sanitizeForWarning(dispHead(resolved.chapterField)) + '“ und Abschnitt „' +
      sanitizeForWarning(resolved.disp) + '“ neu angelegt';
  }
  if (resolved.chapterRange) {
    return 'Abschnitt „' + sanitizeForWarning(resolved.disp) + '“ neu angelegt in Kapitel „' +
      sanitizeForWarning(dispHead(resolved.chapterField)) + '“';
  }
  let note = 'Abschnitt „' + sanitizeForWarning(resolved.disp) + '“ neu angelegt am Dokumentende';
  const tIdx = titleLineIdx(lines);
  const mask = computeFenceLineMask(lines);
  let lastChapterDisp = null;
  for (let i = tIdx + 1; i < lines.length; i++) {
    if (!mask[i] && CHAPTER_RE.test(lines[i])) lastChapterDisp = dispHead(lines[i]);
  }
  if (lastChapterDisp !== null) {
    note += ' (innerhalb von Kapitel „' + sanitizeForWarning(lastChapterDisp) + '“, dem letzten Kapitel – ggf. chapter angeben)';
  }
  return note;
}

// Wendet ops WIE applyOps an, liefert aber zusätzlich pro Op ein Ergebnis
// { index, type, heading?, applied, reason? } – reason ist nur bei
// applied:false gesetzt. Exportiert für App.jsx (Warn-Pille bei
// wirkungslosen Ops, siehe DECISIONS #63) und für die eigenen Tests.
export function applyOpsDetailed(docText, ops) {
  let text = docText;
  const results = [];
  const list = (ops || []).slice(0, 20);
  for (let index = 0; index < list.length; index++) {
    const op = list[index];
    const type = op && typeof op === "object" ? op.type : undefined;
    // v7.32 (delete_chapter-Op), v7.40 um append_to_chapter erweitert:
    // "heading" hier ist NUR ein Anzeige-Feld für App.jsx#buildOpsWarning
    // (⚠️-Warn-Pille) – delete_chapter UND append_to_chapter adressieren
    // aber über "chapter" (mit heading-Fallback, siehe chapterFieldFor),
    // haben also i. d. R. KEIN eigenes op.heading. Ohne diese
    // Sonderbehandlung bliebe die Warn-Pille ohne erkennbaren Kapitelnamen
    // ("delete_chapter in „X“ (…)" statt "delete_chapter „Kapitelname“ in
    // „X“ (…)"). Dieselbe Prioritäts-Logik wie applyOne/explainSkip (DRY,
    // kein Risiko einer abweichenden Anzeige). Review-Fix 🔵 (v7.32.1): für
    // ALLE ANDEREN Op-Typen bleibt der ursprüngliche Vertrag exakt erhalten –
    // NUR ein echter String in op.heading wird angezeigt (dispHead(42) läge
    // sonst z. B. bei "42" statt beim vorherigen/erwarteten undefined,
    // chapterFieldFor prüft diesen typeof zwar bereits FÜR delete_chapter/
    // append_to_chapter selbst, aber eben nicht für die drei ##-Abschnitts-
    // Ops). v7.50: delete_entry/move_entry adressieren WEDER über "heading"
    // NOCH über "chapter", sondern über "entry" (die zu löschende/zu
    // verschiebende Zeile selbst) – dieselbe Sonderbehandlung zeigt hier den
    // entry-Text an (getrimmt, KEIN dispHead()/chapterFieldFor(), da "entry"
    // kein Kapitel-/Abschnittstitel ist und ein führendes "#" in einem
    // Eintragstext – z. B. eine Markdown-Überschrift als Zitat – nicht als
    // Kapitel-Raute weginterpretiert werden soll). v7.52: replace_entry
    // adressiert ebenfalls über "entry" – derselben Sonderbehandlung
    // zugeschlagen.
    const heading = op && typeof op === "object"
      ? (op.type === "delete_entry" || op.type === "move_entry" || op.type === "replace_entry"
          ? (typeof op.entry === "string" && op.entry.trim() ? op.entry.trim() : undefined)
          : dispHead(
              op.type === "delete_chapter" || op.type === "append_to_chapter"
                ? chapterFieldFor(op)
                : (typeof op.heading === "string" ? op.heading : "")
            ) || undefined)
      : undefined;
    const before = text;
    let applied = false;
    let reason;
    try {
      text = applyOne(text, op);
      applied = text !== before;
    } catch (e) {
      reason = "Fehler beim Anwenden";
    }
    if (!applied && !reason) reason = explainSkip(before, op);
    // v7.52 (ℹ️-Notes, DECISIONS #106): NUR bei applied:true relevant –
    // rein lesend auf dem VORHER-Text (siehe explainNote-Kommentar dort),
    // beeinflusst applyOne/den Ergebnistext NIE.
    const note = applied ? explainNote(before, op) : undefined;
    results.push({ index, type, heading, applied, reason: applied ? undefined : reason, note });
  }
  return { text, results };
}

// Reiner Text-Wrapper um applyOpsDetailed() – bleibt aus Rückwärts-
// kompatibilität erhalten (gleiche Signatur/Semantik wie vor v7.21), liefert
// für identische Eingaben BYTE-IDENTISCHEN Text (Regressionstest pinnt das).
export function applyOps(docText, ops) {
  return applyOpsDetailed(docText, ops).text;
}

// Anlage-Platzhalter im Inbox-Abschnitt eines frisch angelegten Notizbuchs
// (v7.22, Review-Fund 🟡): guter Erststart-Eindruck, aber blieb bisher nach
// der ERSTEN echten Notiz weiter im Dokument stehen – roh im Markdown
// sichtbar und wurde vom Modell bei Zusammenfassungen sogar mitzitiert.
// EINE Quelle für BEIDES: App.jsx baut das Anlage-Template damit (statt
// eines eigenen Literal-Strings), stripInboxPlaceholder() unten sucht
// GENAU diesen Text – eine künftige Textänderung hält Template und
// Bereinigung automatisch synchron, statt an zwei Stellen zu divergieren.
//
// v7.22.1 (Re-Review 🟡, Nachbesserung): PLACEHOLDER_LINE allein reichte
// NICHT – der WYSIWYG-Editor (tiptap-markdown) serialisiert Kursiv-Marks
// beim Speichern als "*…*", NICHT als "_..._" (empirisch belegt: ein
// frisches Template einmal im Editor geöffnet+gespeichert trägt danach
// dauerhaft die Asterisk-Form). PLACEHOLDER_CORE hält den reinen Text OHNE
// Kursiv-Marker als eigentliche Quelle; PLACEHOLDER_LINE (Template-Form,
// UNVERÄNDERT nach außen) und die Asterisk-Form werden daraus abgeleitet.
const PLACEHOLDER_CORE = "Noch nichts erfasst. Die erste Notiz im Chat legt hier los.";
export const PLACEHOLDER_LINE = "_" + PLACEHOLDER_CORE + "_";
const PLACEHOLDER_LINE_STAR = "*" + PLACEHOLDER_CORE + "*";

// true, wenn die (bereits getrimmte) Zeile EXAKT einer der beiden vom Editor
// erzeugbaren Kursiv-Formen entspricht ("_…_" aus dem Anlage-Template ODER
// "*…*" aus einem tiptap-markdown-Speichervorgang) – kein Teilstring-/
// Fuzzy-Match, ein Nutzertext mit ähnlichem Wortlaut bleibt unangetastet.
function isPlaceholderLine(l) {
  const t = l.trim();
  return t === PLACEHOLDER_LINE || t === PLACEHOLDER_LINE_STAR;
}

// Entfernt den Platzhalter-ABSATZ (in JEDER der beiden Kursiv-Formen,
// umgebende Leerzeilen via tidy() normalisiert) aus docText, falls
// vorhanden. Ohne Treffer: früher Ausstieg, GARANTIERT byte-identische
// Rückgabe (Idempotenz – wichtig, weil die Aufrufer in App.jsx dies bei
// JEDEM Schreib-Vorgang aufrufen, nicht nur beim ersten). Der includes()-
// Kurzschluss prüft bewusst NUR auf PLACEHOLDER_CORE (ohne Marker) – so
// greift er unabhängig davon, ob die konkrete Zeile gerade in Unterstrich-
// oder Asterisk-Form vorliegt, ohne zwei separate includes()-Aufrufe.
// Bewusst NICHT Teil von applyOne()/applyOps() selbst (kein Aufruf hier
// drin) – die Wrapper-Äquivalenz-Pins aus v7.21
// (applyOps === applyOpsDetailed(...).text) bleiben dadurch unangetastet;
// die Bereinigung ist ausschließlich Sache der Schreib-Pfade in App.jsx
// (send() nach applyOps, saveEdit() im Editor), NIE ein impliziter
// Nebeneffekt der ops-Engine selbst.
export function stripInboxPlaceholder(docText) {
  const text = String(docText || "");
  if (!text.includes(PLACEHOLDER_CORE)) return text; // Kurzschluss: Idempotenz
  const lines = text.split("\n").filter((l) => !isPlaceholderLine(l));
  return tidy(lines);
}
