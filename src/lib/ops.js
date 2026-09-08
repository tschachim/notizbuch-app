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
/* v7.52.2 (Review-Finding 2, E2E-Lauf v7.52, siehe DECISIONS #110): trifft  */
/* delete_entry/replace_entry/move_entry KEINE Zeile (0 Treffer), weil der   */
/* gesuchte Text NUR innerhalb eines ```-Codeblocks steht (Codezeilen sind   */
/* laut Kopfkommentar oben bewusst KEINE Einträge), nennt explainSkip() das   */
/* jetzt explizit statt des generischen "nicht gefunden" - inkl. Verweis auf */
/* replace_section als Ausweg für Codeblock-Änderungen. Rein lesender        */
/* Zusatz-Check (findFenceMaskedEntryMatch, siehe dort) - applyOne() und     */
/* damit das tatsächliche Anwendungsverhalten bleiben unverändert.           */
/* v7.53 (Stufe 2 von Vorschlag A "Anlegen und Raten ist nie implizit",      */
/* Live-Serie: DRITTER Kapitelnamen-Duplikat-Vorfall trotz #106/#109/#110,   */
/* siehe DECISIONS #111): #106-#110 hatten die Kollisions-Umleitung EINER    */
/* Datenlage (Kapitel-Freitext ohne eigenen ##-Abschnitt) behoben - alle     */
/* ÜBRIGEN Anlage-/Rate-Entscheidungen dieser Datei (fehlender Abschnitt     */
/* OHNE chapter -> stille Anlage im letzten Kapitel/global erster Treffer;   */
/* ###-Unterthema als heading-Ziel; Titelzeile als Kapitel-Ziel; content mit */
/* eigener #/##-Zeile) blieben implizites Raten. resolveSectionTarget()      */
/* wird zu resolveTarget()/resolveChapterTarget() erweitert - EINZIGE        */
/* Entscheidungsquelle für ALLE zehn Erzeugungs-/Adressierungsstellen        */
/* dieser Datei (Spiegelprinzip fortgeführt: kein find*()-Aufruf mehr        */
/* AUSSERHALB des Resolvers in applyOne/explainSkip/explainNote/entryScope/  */
/* insertEntryIntoSection). NEUE harte Invarianten (Status-Matrix statt      */
/* "erster Treffer gewinnt"): ambiguous (≥2 gleichnamige ##-Abschnitte OHNE  */
/* chapter -> Skip mit Kandidaten statt globaler Erst-Treffer-Wahl),         */
/* wrong_level (heading trifft nur ein ###-Unterthema bzw. chapter trifft    */
/* nur einen ##-Abschnitt -> Skip mit Korrektur-Hinweis), title (die         */
/* Notizbuch-Titelzeile ist NIE ein Anlageort - als EINGRENZUNG auf einen    */
/* bestehenden Vorspann-Abschnitt bleibt sie zulässig, ℹ️ statt Stillschw-   */
/* eigen), chaptered_doc (ein neuer ##-Abschnitt OHNE chapter in einem       */
/* Dokument MIT #-Kapiteln -> Skip statt stiller Anlage im letzten Kapitel;  */
/* flache Dokumente bleiben unverändert), content-Struktur (eine #/##-Zeile  */
/* im content -> Skip; die EIGENE Überschriftszeile am content-Anfang wird   */
/* dagegen nicht-destruktiv entfernt und als ℹ️ gemeldet), Did-you-mean OHNE */
/* Fuzzy-Suche (nur eindeutige Teilstring-Kandidaten, NIE automatisches      */
/* Löschen/Umbenennen - eine ℹ️-Nachfrage-Aufforderung). WARN_TEXT_MAX von   */
/* 100 auf 160 angehoben (Kandidatenlisten brauchen mehr Platz). Explizites  */
/* create:true (Stufe 3 von Vorschlag A) und das Verify-then-Commit-Gate     */
/* (Vorschlag B) sind BEWUSST NICHT Teil dieses Pakets - siehe DECISIONS.    */
/* v7.53 Nacharbeit Runde 2 (reviewA.json, fünf 🔵-Reste + Teil 3): kein      */
/* Verhaltens-Bruch der Status-Matrix, nur Wortlaut-/Kandidaten-Feinschliff  */
/* - entryScope() normalisiert ein nicht-string chapter-Feld jetzt EINMAL    */
/* VOR der Verzweigung (beide Pfade skippen identisch statt nur einer),      */
/* noteForSectionTarget() bekommt eine ℹ️-Note für "heading mit ### trifft   */
/* einen existierenden ##-Abschnitt" sowie einen fieldName-Parameter         */
/* (move_entry-Ziel nennt jetzt "to_chapter" statt "chapter"), ein neuer     */
/* delete_section-Zweig in explainNote() deckt den Titel-Scope ab, ein       */
/* toter Kandidaten-Fallback in resolveTarget() wurde entfernt. Der          */
/* Cross-Notizbuch-Turn-Guard (Teil 3 der Spezifikation, DECISIONS #111      */
/* Entscheidung 5) lebt bewusst in einem EIGENEN, additiven Modul            */
/* src/lib/turnGuard.js (nicht hier) - er trifft keine Resolver-             */
/* Entscheidung, sondern plant nur, welche bereits von applyOpsDetailed()    */
/* gelieferten Ergebnisse App.jsx#send committen darf.                      */
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

// v7.53: Anzahl führender "#" VOR dem ersten Whitespace – anders als
// dispHead()/normHead() (die die Rauten verschlucken) bleibt hier die
// ROHE Ebene erhalten, die die neuen Resolver-Invarianten (wrong_level)
// brauchen: ein chapter-Feld, das explizit "## X" statt "# X" schreibt,
// meint nachweislich einen Abschnitt, kein Kapitel.
function rawLevel(field) {
  const m = /^(#{1,6})\s/.exec(String(field || ""));
  return m ? m[1].length : 0;
}

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

// v7.53 (Stufe 2 von Vorschlag A, DECISIONS #111): EINMAL pro Resolver-
// Aufruf berechneter, rein lesender Index ALLER Kapitel-/Abschnitts-/
// Unterthemen-Zeilen (fence-maskiert wie überall in dieser Datei) – die
// gemeinsame Datengrundlage für resolveChapterTarget()/resolveTarget()
// unten (Grundprinzip #106/#109 fortgeführt: EIN Bauplan für ALLE
// Adressierungs-Entscheidungen). "chapters" enthält NIE die Titelzeile
// (titleIdx wird beim Sammeln übersprungen) – "chaptered" unterscheidet ein
// Dokument MIT echten #-Kapiteln von einem flachen Dokument (nur Titel +
// ##-Abschnitte). "preambleRange" ist EXAKT der Bereich, den
// findChapter(lines, <Titelname>) liefern würde (Titelzeile bis zum ersten
// echten Kapitel bzw. Dokumentende) – Grundlage der Titel-Scope-Regel
// (siehe resolveTarget).
function buildHeadingIndex(lines) {
  const mask = computeFenceLineMask(lines);
  const titleIdx = titleLineIdx(lines);
  const chapters = [];
  for (let i = 0; i < lines.length; i++) {
    if (i === titleIdx) continue;
    if (!mask[i] && CHAPTER_RE.test(lines[i])) {
      chapters.push({ idx: i, disp: dispHead(lines[i]), norm: normHead(lines[i]) });
    }
  }
  for (let c = 0; c < chapters.length; c++) {
    let end = lines.length;
    for (let j = chapters[c].idx + 1; j < lines.length; j++) {
      if (!mask[j] && CHAPTER_RE.test(lines[j])) { end = j; break; }
    }
    chapters[c].endIdx = end;
  }
  const chaptered = chapters.length >= 1;
  const preambleRange = titleIdx === -1
    ? null
    : [titleIdx, chapters.length ? chapters[0].idx : lines.length];

  const ownerOf = (i) => {
    for (let c = 0; c < chapters.length; c++) {
      if (i >= chapters[c].idx && i < chapters[c].endIdx) return c;
    }
    return -1;
  };

  const sections = [];
  for (let i = 0; i < lines.length; i++) {
    if (!mask[i] && HEAD_RE.test(lines[i])) {
      let end = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        if (!mask[j] && BOUNDARY_RE.test(lines[j])) { end = j; break; }
      }
      sections.push({ idx: i, endIdx: end, disp: dispHead(lines[i]), norm: normHead(lines[i]), owner: ownerOf(i) });
    }
  }
  const sectionOf = (i) => {
    for (let s = 0; s < sections.length; s++) {
      if (i >= sections[s].idx && i < sections[s].endIdx) return s;
    }
    return -1;
  };
  const subs = [];
  for (let i = 0; i < lines.length; i++) {
    if (!mask[i] && /^###\s+/.test(lines[i])) {
      const sectionIdx = sectionOf(i);
      subs.push({
        idx: i, disp: dispHead(lines[i]), norm: normHead(lines[i]), sectionIdx,
        owner: sectionIdx >= 0 ? sections[sectionIdx].owner : -1,
      });
    }
  }
  return { titleIdx, chaptered, preambleRange, chapters, sections, subs };
}

// v7.53: "Did-you-mean"-Kandidaten OHNE Fuzzy-Suche (bewusst, siehe
// DECISIONS #111) – nur ein normalisierter Teilstring-Vergleich (Emoji/
// Satzzeichen entfernt), NIE ein editierdistanz-basierter Vorschlag: die
// Kandidaten dürfen nie etwas "erraten", das nicht klar erkennbar dieselbe
// Absicht meint. Mindestlänge 3 Zeichen (nach dem Falten) auf BEIDEN Seiten
// – verhindert Kurzwort-Fehltreffer wie "QA" <-> "QA-Test".
function foldName(s) {
  return normHead(s).replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
}
function similarNames(needle, entries) {
  const nd = dispHead(needle);
  if (!nd) return [];
  const nNorm = normHead(nd);
  const nFold = foldName(nd);
  const out = [];
  const seen = new Set();
  for (const entry of entries) {
    const cd = typeof entry === "string" ? entry : entry.disp;
    if (!cd) continue;
    if (normHead(cd) === nNorm) continue; // exakter Treffer ist DER Treffer, kein "ähnlich"
    const cFold = foldName(cd);
    if (nFold.length < 3 || cFold.length < 3) continue;
    if (cFold === nFold || cFold.includes(nFold) || nFold.includes(cFold)) {
      if (!seen.has(cd)) { seen.add(cd); out.push(cd); }
    }
    if (out.length >= 3) break;
  }
  return out;
}

// v7.53: gemeinsamer Formatierer für Kandidaten-/Kapitel-Listen – die
// GESAMTE Liste läuft als EIN Fragment durch sanitizeForWarning() (siehe
// Aufrufer unten), nicht jeder Name einzeln.
function listNames(names, max = 3) {
  if (!names || !names.length) return "";
  const shown = names.slice(0, max).map((n) => "„" + n + "“");
  return shown.join(", ") + (names.length > max ? " …" : "");
}
// Nacharbeit v7.53 (Review-Finding 🟡 1): die GESAMTE Kapitelliste läuft
// wie jedes andere Kandidaten-Fragment EINMAL durch sw() – vorher hing
// chapterListSuffix() listNames() roh an und umging damit Schicht 1 der
// Prompt-Injection-Abwehr (Klammern/Kappung) für Kapitelnamen.
function chapterListSuffix(docChapters) {
  if (!docChapters || !docChapters.length) return "";
  return " (Kapitel: " + sw(listNames(docChapters, 5)) + ")";
}

function findSectionOwner(index, disp) {
  const n = normHead(disp);
  const sec = index.sections.find((s) => s.norm === n);
  if (!sec) return null;
  return { sectionDisp: sec.disp, chapterDisp: sec.owner >= 0 ? index.chapters[sec.owner].disp : null, ownerIdx: sec.owner };
}
function findSectionNamesake(index, disp) {
  const owner = findSectionOwner(index, disp);
  return owner ? { sectionDisp: owner.sectionDisp, chapterDisp: owner.chapterDisp } : null;
}

// v7.53 (Stufe 2 von Vorschlag A, DECISIONS #111): einziger Resolver für EIN
// Kapitel-Adressfeld ("chapter"/"from_chapter"/"to_chapter" bei den
// ##-Abschnitts-/entry-Ops, "chapter" mit heading-Fallback bei
// delete_chapter/append_to_chapter). Rein lesend, mutiert "lines" NIE.
// "opts.heading"/"opts.usedHeadingFallback" decken die beiden Adress-
// Konflikt-Prüfungen von append_to_chapter/delete_chapter ab (DECISIONS
// #111, Entscheidung 2): (a) chapter UND heading beide gesetzt, aber
// NAMENSVERSCHIEDEN -> conflicting_address (nur append_to_chapter, i5); (b)
// chapter LEER, heading dient als Fallback-Adresse UND trägt selbst eine
// "##"/"###"-Raute -> conflicting_address (append_to_chapter UND
// delete_chapter, i4/i5c). Status-Matrix: empty | conflicting_address |
// found | title | wrong_level | missing.
export function resolveChapterTarget(lines, field, opts = {}) {
  const disp = dispHead(field);
  const level = rawLevel(field);
  const index = buildHeadingIndex(lines);
  const docChapters = index.chapters.map((c) => c.disp);
  const mk = (extra) => ({
    disp, level, chaptered: index.chaptered, preambleRange: index.preambleRange, docChapters,
    range: null, titleScope: null, sectionOwner: null, conflictHeading: null, candidates: [], sectionNamesake: null,
    ...extra,
  });

  // "usedHeadingFallback" bei LEEREM field kommt in dieser Datei NIE vor:
  // die Aufrufer (applyOne/explainSkip, delete_chapter/append_to_chapter)
  // übergeben in diesem Fall bereits "heading" SELBST als "field" (siehe
  // chapterFieldFor-Nachfolgelogik dort) – die Fallback-Prüfung unten
  // (Schritt 3, "level >= 2") greift dadurch auf dem regulären disp/level.
  if (!disp) return mk({ status: "empty" });

  if (opts.opType === "append_to_chapter" && !opts.usedHeadingFallback && opts.heading !== undefined) {
    const headingDisp = dispHead(opts.heading);
    if (headingDisp && normHead(headingDisp) !== normHead(disp)) {
      return mk({ status: "conflicting_address", conflictHeading: headingDisp });
    }
  }
  if (opts.usedHeadingFallback && level >= 2) {
    return mk({ status: "conflicting_address", sectionOwner: findSectionOwner(index, disp) });
  }

  const found = findAddressableChapter(lines, field);
  if (found.range) return mk({ status: "found", range: found.range });
  if (found.titleBlocked) return mk({ status: "title", titleScope: index.chaptered ? "preamble" : "flat" });
  if (level >= 2) {
    const sectionOwner = findSectionOwner(index, disp);
    if (sectionOwner) return mk({ status: "wrong_level", sectionOwner });
  }
  return mk({ status: "missing", candidates: similarNames(disp, index.chapters), sectionNamesake: findSectionNamesake(index, disp) });
}

// v7.53 (Stufe 2 von Vorschlag A, DECISIONS #111, Erweiterung von
// resolveSectionTarget aus v7.52/#106): einziger Resolver für EIN
// "##"-Zieladressfeld zusammen mit seinem Kapitel-Feld ("heading"+"chapter"
// bei den Abschnitts-/entry-Ops, "to_heading"+"to_chapter" beim
// move_entry-Ziel). Rein lesend, mutiert "lines" NIE. "chapterFieldName"
// wirkt NUR auf spätere Wortlaute, NICHT auf die Auflösung selbst.
// Status-Matrix: found | missing | collision | ambiguous | title |
// wrong_level. Siehe DECISIONS #111 für die Begründung jeder Invariante.
export function resolveTarget(lines, { heading, chapter, chapterFieldName, opType } = {}) {
  const disp = dispHead(heading);
  const level = rawLevel(heading);
  const index = buildHeadingIndex(lines);
  const docChapters = index.chapters.map((c) => c.disp);
  const chapterField = typeof chapter === "string" && chapter.trim() ? chapter : "";
  // Nacharbeit v7.53 (Review-Finding 🟡 3): resolveChapterTarget() bekommt
  // das BEREINIGTE chapterField, nicht das rohe "chapter" – ein Nicht-String
  // (Schema-Verletzung, z. B. chapter:42) wäre sonst über dispHead(String(42))
  // als "missing" durchgerutscht und hätte eine LEERE "# "-Kapitelzeile
  // angelegt (Struktur-Korruption). HEAD behandelte nicht-string chapter wie
  // "kein chapter" – das stellen wir hier wieder her.
  const chapterResult = resolveChapterTarget(lines, chapterField, { fieldName: chapterFieldName || "chapter" });

  const result = {
    disp, chapterField, level, chapter: chapterResult, docChapters, opType,
    status: null, scope: null, scopeKind: "none",
    chapterRange: null, chapterMissing: chapterResult.status === "missing", chapterIsTitle: false,
    sectionRange: null, sectionMatches: [], distinctOwners: [],
    collision: null, collisionRange: null, preambleEmpty: true,
    levelField: null, subOwner: null, needsChapter: false,
    candidates: [], titleNote: null,
    titleDisp: index.titleIdx !== -1 ? dispHead(lines[index.titleIdx]) : "",
  };

  // Schritt 0: Titel-Scope (DECISIONS #111 – Kompromiss aus der Kritik):
  // die Titelzeile ist NIE ein Anlageort, aber in einem Kapitel-Dokument als
  // EINGRENZUNG auf den Vorspann für einen EXISTIERENDEN ##-Abschnitt
  // adressierbar (Template-Inbox); in einem flachen Dokument gilt chapter
  // als NICHT GESETZT (Byte-Identität zu "ohne chapter", Altverhalten).
  if (chapterResult.status === "title") {
    if (!index.chaptered) {
      result.scope = [0, lines.length];
      result.scopeKind = "flat_title";
      result.titleNote = "flat";
    } else {
      result.scope = index.preambleRange;
      result.scopeKind = "preamble";
      result.titleNote = "preamble";
      result.chapterIsTitle = true;
      result.chapterRange = index.preambleRange;
    }
  } else if (chapterResult.status === "wrong_level") {
    result.status = "wrong_level";
    result.levelField = "chapter";
    return result;
  } else if (chapterResult.status === "missing") {
    result.scope = null;
    result.scopeKind = "none";
  } else if (chapterResult.status === "found") {
    result.scope = chapterResult.range;
    result.scopeKind = "chapter";
    result.chapterRange = chapterResult.range;
  } else {
    result.scope = [0, lines.length];
    result.scopeKind = "global";
  }

  // Schritt 4: Abschnittssuche im Scope – Owner-basierte Mehrdeutigkeit.
  if (result.scope && chapterResult.status !== "missing") {
    const n = normHead(disp);
    const matches = index.sections.filter((s) => s.norm === n && s.idx >= result.scope[0] && s.idx < result.scope[1]);
    result.sectionMatches = matches.map((m) => ({ range: [m.idx, m.endIdx], owner: m.owner, ownerDisp: m.owner >= 0 ? index.chapters[m.owner].disp : null }));
    const ownerMap = new Map();
    for (const m of result.sectionMatches) {
      if (!ownerMap.has(m.owner)) ownerMap.set(m.owner, { owner: m.owner, label: m.owner === -1 ? "Vorspann" : m.ownerDisp });
    }
    result.distinctOwners = Array.from(ownerMap.values());
    if (matches.length >= 2 && result.distinctOwners.length >= 2 && (chapterResult.status === "empty" || result.scopeKind === "flat_title")) {
      result.status = "ambiguous";
      return result;
    }
    if (matches.length >= 1) {
      result.status = "found";
      result.sectionRange = result.sectionMatches[0].range;
    }
  }

  // Schritt 5: Kollision (unverändert zu v7.52/DECISIONS #106, Guard i/ii) –
  // NICHT während eines Titel-Scopes (Anlage im Vorspann ist NIE erlaubt).
  if (result.status !== "found" && chapterResult.status !== "title") {
    let collision = null, collisionRange = null;
    if (chapterResult.status === "empty") {
      const r = findAddressableChapter(lines, heading).range;
      if (r) { collision = "chapter"; collisionRange = r; }
    } else if (chapterField && normHead(chapterField) === normHead(disp)) {
      if (chapterResult.status === "missing") { collision = "chapter"; collisionRange = null; }
      else if (chapterResult.status === "found") { collision = "chapter"; collisionRange = chapterResult.range; }
    }
    if (collision) {
      result.status = "collision";
      result.collision = collision;
      result.collisionRange = collisionRange;
      result.preambleEmpty = isPreambleEmpty(lines, collisionRange);
      return result;
    }
  }

  if (result.status === "found") return result;

  // Schritt 6: wrong_level(heading) – ein ###-Unterthema im Scope trägt
  // GENAU diesen Namen, ODER heading selbst ist explizit als "###" markiert.
  const subInScope = result.scope
    ? index.subs.find((s) => s.norm === normHead(disp) && s.idx >= result.scope[0] && s.idx < result.scope[1])
    : undefined;
  if (level >= 3 || subInScope) {
    result.status = "wrong_level";
    result.levelField = "heading";
    if (subInScope) {
      const sec = index.sections[subInScope.sectionIdx];
      result.subOwner = sec ? { sectionDisp: sec.disp, chapterDisp: sec.owner >= 0 ? index.chapters[sec.owner].disp : null } : null;
    }
    return result;
  }

  // Schritt 7: Titel-Scope OHNE Treffer -> nie Anlageort.
  if (result.scopeKind === "preamble") {
    result.status = "title";
    return result;
  }

  // Schritt 8: missing (+ Kandidaten).
  result.status = "missing";
  result.needsChapter = chapterResult.status === "empty" && index.chaptered;
  const scopedSectionNames = (result.scope
    ? index.sections.filter((s) => s.idx >= result.scope[0] && s.idx < result.scope[1])
    : index.sections
  ).map((s) => s.disp);
  // Nacharbeit v7.53 Runde 2 (Review-Finding 🔵 4): KEIN Fallback mehr auf
  // Kapitel-Kandidaten hier – der frühere Fallback (bei leeren Abschnitts-
  // Kandidaten UND chapter.status==='missing' die Kapitel-Kandidaten ins
  // top-level "candidates"-Feld kopieren) war toter Code: bei chapter.status
  // ==='missing' ist scope bereits null (Schritt 2 oben), also gibt es per
  // Definition auch keine sinnvollen Abschnitts-Kandidaten – ALLE Aufrufer
  // (entryScope, explainSkip, explainNote, noteForSectionTarget) lesen in
  // genau diesem Fall bereits result.chapter.candidates, nie das top-level
  // Feld. Der tote Fallback war eine Falle für künftige Aufrufer (genau der
  // Fehler aus Finding 4/reviewA.json): Kapitel-Kandidaten liegen
  // AUSSCHLIESSLICH in result.chapter.candidates.
  result.candidates = similarNames(disp, scopedSectionNames);
  return result;
}

// Rückwärtskompatibler Alias (der Resolver hieß bis v7.52 resolveSectionTarget)
// – identische Rückgabe für Aufrufer, die nur {heading, chapter} übergeben.
export const resolveSectionTarget = resolveTarget;

// v7.53 (Content-Helfer, DECISIONS #111): entfernt eine FÜHRENDE, mit der
// eigenen Op-Überschrift normHead-gleiche Überschriftszeile (samt führenden
// Leerzeilen davor und GENAU einer direkt folgenden Leerzeile danach) aus
// content – nicht-destruktive Normalisierung, WEIL Modelle die eigene
// Zielüberschrift reflexartig im content wiederholen (siehe c2/N-C2). Bleibt
// nach dem Strip nur Whitespace übrig, entscheidet der Aufrufer über einen
// Skip (R-C2EMPTY) statt eines stillen Leerens (Kritik 🟡, Nutzerfehler
// vermuten statt bewusstes Leeren).
function normalizeOwnHeading(contentLines, ownDisp, ownLevel) {
  let start = 0;
  while (start < contentLines.length && contentLines[start].trim() === "") start++;
  if (start >= contentLines.length) return { lines: contentLines, stripped: null };
  const m = /^(#{1,6})\s+(.*)$/.exec(contentLines[start]);
  if (!m || m[1].length !== ownLevel || normHead(m[2]) !== normHead(ownDisp)) {
    return { lines: contentLines, stripped: null };
  }
  let end = start + 1;
  if (end < contentLines.length && contentLines[end].trim() === "") end++;
  return { lines: contentLines.slice(end), stripped: contentLines[start] };
}

// v7.53: erste #/##-Zeile AUSSERHALB eines geschlossenen Fence-Blocks
// innerhalb von content (###-Unterthemen sind ausdrücklich ERLAUBT – die
// Prüfung nutzt BOUNDARY_RE, das NUR "#" und "##" matcht).
function findStructureLine(contentLines) {
  const mask = computeFenceLineMask(contentLines);
  for (let i = 0; i < contentLines.length; i++) {
    if (!mask[i] && BOUNDARY_RE.test(contentLines[i])) return i;
  }
  return -1;
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

// v7.53 (Stufe 2 von Vorschlag A, DECISIONS #111): entryScope() trifft KEINE
// eigene find*()-Entscheidung mehr (Spiegelprinzip, Leitplanke 1) – "heading"
// gesetzt läuft über resolveTarget(), NUR "chapter" gesetzt über
// resolveChapterTarget(). "fieldNames" (optional, Default heading/chapter)
// wirkt nur auf spätere Wortlaute (from_heading/from_chapter bei
// move_entry-Quelle). "notFound" unterscheidet jetzt SECHS Fälle (vorher
// zwei): 'chapter' (Kapitel-Eingrenzung existiert nicht), 'chapter_level'
// (chapter trifft nur einen ##-Abschnitt), 'heading' (Abschnitt fehlt
// komplett), 'heading_ambiguous' (≥2 Owner ohne chapter), 'heading_level'
// (heading trifft nur ein ###-Unterthema bzw. ist selbst "###"),
// 'heading_title' (Vorspann-Eingrenzung ohne Treffer).
function entryScope(lines, headingField, chapterField, fieldNames = {}) {
  const headingDisp = dispHead(headingField);
  const chapterDisp = dispHead(chapterField);
  const chapterFieldName = fieldNames.chapter || "chapter";
  // Nacharbeit v7.53 Runde 2 (Review-Finding 🔵 1, reviewA.json): ein
  // NICHT-string chapter-Feld (Schema-Verletzung, z. B. chapter:42) verhielt
  // sich bisher je nach heading-Pfad UNTERSCHIEDLICH – MIT heading sah
  // resolveTarget() das rohe Feld gar nicht (dessen eigener typeof-Guard
  // reicht "" statt des Rohwerts an resolveChapterTarget() weiter), die Op
  // lief also so, als wäre GAR KEIN chapter gesetzt (bei delete_entry ein
  // stiller, ungewollter Löschtreffer); OHNE heading landete das Feld roh in
  // resolveChapterTarget(), dispHead(42) ergab "42" -> "Kapitel „42“ nicht
  // gefunden". HEAD (v7.52.2) skippte in BEIDEN Fällen identisch. Eine
  // EINMALIGE, strikte Normalisierung VOR jeder Verzweigung stellt das
  // wieder her: "nie raten" gilt auch für Schema-Verletzungen, beide Pfade
  // sehen jetzt denselben Skip mit demselben Wortlaut.
  if (chapterField != null && typeof chapterField !== "string") {
    return {
      range: null, notFound: "chapter",
      resolved: resolveChapterTarget(lines, String(chapterField), { fieldName: chapterFieldName }),
    };
  }
  if (headingDisp) {
    const target = resolveTarget(lines, { heading: headingField, chapter: chapterField, chapterFieldName, opType: "entry" });
    if (target.status === "found") {
      return { range: target.sectionRange, notFound: null, redirected: false, resolved: target, titleNote: target.titleNote };
    }
    if (target.status === "collision") {
      // Nacharbeit v7.53 (Review-Finding 🔵 9): collisionRange===null bedeutet
      // Guard (ii) – "chapter" fehlt UND heading==chapter-Name; das GESUCHTE
      // Kapitel ist es, das nicht existiert (nicht der Abschnitt) – Wortlaut-
      // Regression gegenüber v7.52.2 (dort meldete Kapitel-Nicht-Fund über
      // den chapterMissing-Zweig, nicht "Abschnitt nicht gefunden").
      if (target.collisionRange === null) return { range: null, notFound: target.chapter.status === "missing" ? "chapter" : "heading", resolved: target };
      return { range: target.collisionRange, notFound: null, redirected: true, resolved: target };
    }
    if (target.status === "ambiguous") return { range: null, notFound: "heading_ambiguous", resolved: target };
    if (target.status === "wrong_level") {
      return { range: null, notFound: target.levelField === "chapter" ? "chapter_level" : "heading_level", resolved: target };
    }
    if (target.status === "title") return { range: null, notFound: "heading_title", resolved: target };
    if (target.chapter.status === "missing") return { range: null, notFound: "chapter", resolved: target };
    return { range: null, notFound: "heading", resolved: target };
  }
  if (chapterDisp) {
    const chapterResult = resolveChapterTarget(lines, chapterField, { fieldName: chapterFieldName });
    if (chapterResult.status === "found") {
      return { range: chapterResult.range, notFound: null, redirected: false, resolved: chapterResult };
    }
    if (chapterResult.status === "title") {
      const range = chapterResult.titleScope === "preamble" ? chapterResult.preambleRange : [0, lines.length];
      return { range, notFound: null, redirected: false, resolved: chapterResult, titleNote: chapterResult.titleScope };
    }
    if (chapterResult.status === "wrong_level") return { range: null, notFound: "chapter_level", resolved: chapterResult };
    return { range: null, notFound: "chapter", resolved: chapterResult };
  }
  return { range: [0, lines.length], notFound: null, redirected: false };
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

// v7.52.2 (Review-Finding 2, E2E-Lauf v7.52 – siehe DECISIONS #110): liefert
// true, wenn ein NICHT gefundener "entry"-Text (findEntryLines() oben
// lieferte 0 Treffer) auf eine Zeile INNERHALB eines geschlossenen
// ```-Codeblocks zeigen würde – Codezeilen sind laut Kopfkommentar dieser
// Datei bewusst KEINE Einträge (findEntryLines schließt fence-maskierte
// Zeilen aus). Live-Befund: das Modell schickte replace_entry mit dem
// exakten Wortlaut einer Bash-Kommandozeile in einem Codeblock, die Engine
// meldete nur den generischen "nicht gefunden"-Text – ohne zu verraten,
// WARUM (der Text steht sichtbar im Dokument) und WAS stattdessen zu tun
// ist. Rein lesend, DIESELBE zweistufige Match-Logik wie findEntryLines
// (erst exakt, dann Substring), aber auf die fence-MASKIERTEN Zeilen des
// Bereichs angewendet statt sie auszuschließen – ändert applyOne() NICHT,
// nur explainSkip() nutzt das Ergebnis für einen präziseren Skip-Grund
// (Skip bleibt Skip).
function findFenceMaskedEntryMatch(lines, range, entryText) {
  const needle = norm(entryText);
  if (!needle) return false;
  const mask = computeFenceLineMask(lines);
  const candidates = [];
  for (let i = range[0]; i < range[1]; i++) {
    if (mask[i]) candidates.push(i);
  }
  if (candidates.some((i) => norm(lines[i]) === needle)) return true;
  const needleLower = needle.toLowerCase();
  return candidates.some((i) => norm(lines[i]).toLowerCase().includes(needleLower));
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

// v7.53 (Stufe 2 von Vorschlag A, DECISIONS #111): KEINE eigene Suche mehr
// (Spiegelprinzip, Leitplanke 1) – "target" ist das VOR jeder Mutation vom
// Aufrufer (move_entry-Zweig in applyOne) berechnete resolveTarget()-
// Ergebnis, "shiftRange" verschiebt dessen Range-Felder auf den bereits um
// die Quelle bereinigten Zeilenstand (Fortführung von DECISIONS #109 –
// vorher lief hier bei einer Kollision eine ZWEITE, positionsabhängige
// findAddressableChapter()-Suche auf dem bereits mutierten Array, die bei
// einer verschobenen Titelzeile zu einem ANDEREN Ergebnis kommen konnte als
// der VOR der Mutation ermittelte Zustand).
function insertEntryIntoSection(lines, target, blockLines, shiftRange) {
  if (target.status === "collision") {
    insertEntryIntoChapterPreamble(lines, target.chapterField || target.disp, blockLines, shiftRange(target.collisionRange));
    return;
  }
  if (target.status === "found") {
    const r = shiftRange(target.sectionRange);
    let at = r[1];
    while (at > r[0] + 1 && lines[at - 1].trim() === "") at--;
    lines.splice(at, 0, ...blockLines);
    return;
  }
  // status === "missing" (needsChapter/ambiguous/title/wrong_level hat der
  // Aufrufer bereits VOR der Quell-Mutation per return abgefangen).
  if (target.chapter.status === "missing") {
    padEnd(lines);
    lines.push("# " + dispHead(target.chapterField), "");
    lines.push("## " + target.disp, "", ...blockLines, "");
    return;
  }
  if (target.chapterRange) {
    const r = shiftRange(target.chapterRange);
    lines.splice(r[1], 0, "## " + target.disp, "", ...blockLines, "");
    return;
  }
  padEnd(lines);
  lines.push("## " + target.disp, "", ...blockLines, "");
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
// reine to_chapter-Zweig in applyOne).
function insertEntryIntoChapterPreamble(lines, chapterField, blockLines, range) {
  const chapterDisp = dispHead(chapterField);
  if (!range) {
    padEnd(lines);
    lines.push("# " + chapterDisp, "", ...blockLines);
    return;
  }
  insertIntoChapterPreamble(lines, range, blockLines);
}

// v7.53 (Stufe 2 von Vorschlag A, DECISIONS #111): applyOne() entscheidet
// AUSSCHLIESSLICH über resolveTarget()/resolveChapterTarget()/entryScope()
// (Spiegelprinzip, Leitplanke 1) – kein direkter findSection/findChapter/
// findAddressableChapter-Aufruf mehr in dieser Funktion.
function applyOne(text, op) {
  if (!op || typeof op !== "object") return text;

  if (op.type === "rewrite") {
    return typeof op.content === "string" && op.content.trim()
      ? op.content.trim() + "\n"
      : text;
  }

  if (op.type === "delete_chapter") {
    const hasChapter = typeof op.chapter === "string" && op.chapter.trim();
    const fieldValue = hasChapter ? op.chapter : (typeof op.heading === "string" ? op.heading : "");
    const chLines = text.split("\n");
    const chapterResult = resolveChapterTarget(chLines, fieldValue, { opType: "delete_chapter", usedHeadingFallback: !hasChapter });
    if (chapterResult.status !== "found") return text;
    chLines.splice(chapterResult.range[0], chapterResult.range[1] - chapterResult.range[0]);
    return tidy(chLines);
  }

  if (op.type === "append_to_chapter") {
    const hasChapter = typeof op.chapter === "string" && op.chapter.trim();
    const fieldValue = hasChapter ? op.chapter : op.heading;
    const chLines0 = text.split("\n");
    const chapterResult = resolveChapterTarget(chLines0, fieldValue, {
      opType: "append_to_chapter", usedHeadingFallback: !hasChapter, heading: hasChapter ? op.heading : undefined,
    });
    if (chapterResult.status === "empty" || chapterResult.status === "conflicting_address") return text;
    let content = typeof op.content === "string" ? op.content.replace(/^\n+|\n+$/g, "") : "";
    if (!content) return text;
    const norm1 = normalizeOwnHeading(content.split("\n"), chapterResult.disp, 1);
    if (norm1.stripped !== null) {
      if (!norm1.lines.join("\n").trim()) return text; // R-C2EMPTY-CH
      content = norm1.lines.join("\n");
    }
    if (findStructureLine(content.split("\n")) !== -1) return text; // R-CONTENT
    if (chapterResult.status === "title" || chapterResult.status === "wrong_level") return text;
    const chLines = text.split("\n");
    if (chapterResult.status === "found") {
      insertIntoChapterPreamble(chLines, chapterResult.range, content.split("\n"));
      return tidy(chLines);
    }
    padEnd(chLines);
    chLines.push("# " + dispHead(chapterResult.disp), "", ...content.split("\n"));
    return tidy(chLines);
  }

  if (op.type === "delete_entry") {
    const entryText = typeof op.entry === "string" ? op.entry : "";
    if (!norm(entryText)) return text;
    const deLines = text.split("\n");
    const { range, notFound } = entryScope(deLines, op.heading, op.chapter, { heading: "heading", chapter: "chapter" });
    if (notFound) return text;
    const hits = findEntryLines(deLines, range, entryText);
    if (hits.length !== 1) return text;
    const [s, e] = entryBlockRange(deLines, hits[0]);
    deLines.splice(s, e - s);
    return tidy(deLines);
  }

  if (op.type === "move_entry") {
    const entryText = typeof op.entry === "string" ? op.entry : "";
    if (!norm(entryText)) return text;
    const toHeadingDisp = dispHead(op.to_heading);
    const toChapterDisp = dispHead(op.to_chapter);
    if (!toHeadingDisp && !toChapterDisp) return text;
    const meLines = text.split("\n");
    const { range, notFound } = entryScope(meLines, op.from_heading, op.from_chapter, { heading: "from_heading", chapter: "from_chapter" });
    if (notFound) return text;
    const hits = findEntryLines(meLines, range, entryText);
    if (hits.length !== 1) return text;

    // v7.53: Ziel-Auflösung VOR jeder Mutation (Fortführung DECISIONS #109) –
    // ALLE Prüfungen UND ALLE Ziel-Ranges stehen fest, bevor meLines.splice
    // läuft (Atomaritäts-Garantie DECISIONS #103 bleibt gewahrt).
    let target = null, chapterTarget = null;
    if (toHeadingDisp) {
      target = resolveTarget(meLines, { heading: op.to_heading, chapter: toChapterDisp ? op.to_chapter : null, chapterFieldName: "to_chapter", opType: "write" });
      if (target.status === "title" || target.status === "wrong_level" || target.status === "ambiguous") return text;
      if (target.status === "missing" && target.needsChapter) return text;
    } else {
      chapterTarget = resolveChapterTarget(meLines, op.to_chapter, { fieldName: "to_chapter" });
      if (chapterTarget.status === "title" || chapterTarget.status === "wrong_level") return text;
    }

    const [s, e] = entryBlockRange(meLines, hits[0]);
    const block = dedentBlock(meLines.slice(s, e));
    meLines.splice(s, e - s);
    const shiftIdx = (i) => (i >= e ? i - (e - s) : i);
    const shiftRange = (r) => (r ? [shiftIdx(r[0]), shiftIdx(r[1])] : r);

    if (toHeadingDisp) {
      insertEntryIntoSection(meLines, target, block, shiftRange);
    } else {
      const chRange = chapterTarget.status === "found" ? shiftRange(chapterTarget.range) : null;
      insertEntryIntoChapterPreamble(meLines, op.to_chapter, block, chRange);
    }
    return tidy(meLines);
  }

  if (op.type === "replace_entry") {
    const entryText = typeof op.entry === "string" ? op.entry : "";
    if (!norm(entryText)) return text;
    const content = typeof op.content === "string" ? op.content.replace(/^\n+|\n+$/g, "") : "";
    if (!content) return text;
    const reLines = text.split("\n");
    const { range, notFound } = entryScope(reLines, op.heading, op.chapter, { heading: "heading", chapter: "chapter" });
    if (notFound) return text;
    const hits = findEntryLines(reLines, range, entryText);
    if (hits.length !== 1) return text;
    const [s, e] = entryBlockRange(reLines, hits[0]);
    const indent = reLines[hits[0]].match(/^\s*/)[0];
    const newLines = content.split("\n").map((l) => (l.trim() === "" ? "" : indent + l));
    const mask = computeFenceLineMask(newLines);
    for (let i = 0; i < newLines.length; i++) {
      if (!mask[i] && BOUNDARY_RE.test(newLines[i])) return text;
    }
    reLines.splice(s, e - s, ...newLines);
    return tidy(reLines);
  }

  if (op.type === "append_to_section" || op.type === "replace_section" || op.type === "delete_section") {
    const disp = dispHead(op.heading);
    if (!disp) return text;
    const lines = text.split("\n");
    const isWrite = op.type !== "delete_section";
    let content = typeof op.content === "string" ? op.content.replace(/^\n+|\n+$/g, "") : "";
    if (op.type === "append_to_section" && !content) return text;
    if (isWrite && content) {
      const norm1 = normalizeOwnHeading(content.split("\n"), disp, 2);
      if (norm1.stripped !== null) {
        if (!norm1.lines.join("\n").trim()) return text; // R-C2EMPTY
        content = norm1.lines.join("\n");
      }
      if (findStructureLine(content.split("\n")) !== -1) return text; // R-CONTENT
    }

    const target = resolveTarget(lines, { heading: op.heading, chapter: op.chapter, chapterFieldName: "chapter", opType: isWrite ? "write" : "delete" });

    if (target.status === "collision") {
      if (!isWrite) return text;
      if (!content) return text;
      if (op.type === "replace_section" && !target.preambleEmpty) return text;
      if (target.collisionRange === null) {
        padEnd(lines);
        lines.push("# " + dispHead(target.chapterField), "", ...content.split("\n"));
      } else {
        insertIntoChapterPreamble(lines, target.collisionRange, content.split("\n"));
      }
      return tidy(lines);
    }
    if (target.status === "ambiguous" || target.status === "wrong_level" || target.status === "title") return text;

    if (!isWrite) {
      if (target.status !== "found") return text;
      lines.splice(target.sectionRange[0], target.sectionRange[1] - target.sectionRange[0]);
      return tidy(lines);
    }

    if (target.status === "missing" && target.needsChapter) return text;

    const buildBlock = () => ["## " + disp, "", ...(content ? content.split("\n") : []), ""];
    if (target.status === "found") {
      if (op.type === "replace_section") {
        lines.splice(target.sectionRange[0], target.sectionRange[1] - target.sectionRange[0], ...buildBlock());
      } else {
        let at = target.sectionRange[1];
        while (at > target.sectionRange[0] + 1 && lines[at - 1].trim() === "") at--;
        lines.splice(at, 0, ...content.split("\n"));
      }
      return tidy(lines);
    }
    // status === "missing" -> Anlage (v7.23-Muster, byte-identisch)
    if (target.chapter.status === "missing") {
      padEnd(lines);
      lines.push("# " + dispHead(target.chapterField), "");
      lines.push(...buildBlock());
    } else if (target.chapterRange) {
      lines.splice(target.chapterRange[1], 0, ...buildBlock());
    } else {
      padEnd(lines);
      lines.push(...buildBlock());
    }
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
// v7.53 (DECISIONS #111, Entscheidung 3): auf 160 Zeichen angehoben (NUR in
// dieser Datei) – Kandidatenlisten ("meintest du „A“, „B“, „C“?") brauchen
// mehr Platz als ein einzelner Name; memory.js/App.jsx kappen weiterhin bei
// 100 (unabhängige, unveränderte Konstanten). Schicht 2 ("Senke") sitzt
// zusätzlich in lib/anthropic.js#callClaude, damit AUCH eine künftige, hier
// vergessene Warn-Quelle den Rahmen nie brechen kann – zwei unabhängige
// Schichten, siehe DECISIONS.
const WARN_TEXT_MAX = 160;
function sanitizeForWarning(s) {
  const noNulStr = String(s || "").split(String.fromCharCode(0)).join("");
  const collapsed = noNulStr.replace(/\s+/g, " ").trim();
  const bracketsSafe = collapsed.replace(/\[/g, "(").replace(/\]/g, ")");
  return bracketsSafe.length > WARN_TEXT_MAX ? bracketsSafe.slice(0, WARN_TEXT_MAX) + "…" : bracketsSafe;
}

const sw = sanitizeForWarning;

// v7.53: Wortlaut-Bausteine für explainSkip()/explainNote() – NUR Text-
// Formatierung, KEINE Entscheidungslogik (die steckt ausschließlich im
// Resolver, siehe Leitplanke 1 oben). Owner-Liste für R-AMB: Vorspann-
// Treffer als eigenständiges "Vorspann (F:"# Titel")"-Fragment (das ist der
// konkrete Ausweg, mit dem der Vorspann-Abschnitt im Folge-Turn per
// Titel-Scope adressierbar ist – keine Skip-Schleife), Kapitel-Treffer
// gebündelt als "Kapitel „A“, „B“".
function ownersLabel(distinctOwners, fieldName, titleDisp) {
  const parts = [];
  const chapterNames = [];
  for (const o of distinctOwners) {
    // Nacharbeit v7.53 (Review-Finding 🔵 8): ein Dokument OHNE Titelzeile
    // (beginnt direkt mit "##"/"#") hat keinen adressierbaren Vorspann-Namen
    // – "chapter:\"# \"" wäre ein leeres, nicht auflösbares Ziel und würde
    // in eine Skip-Schleife führen. Ohne Titelzeile bleibt der Vorspann nur
    // per Editor erreichbar, das sagt der Hinweis explizit.
    if (o.owner === -1) parts.push(titleDisp ? 'Vorspann (' + fieldName + ':"# ' + titleDisp + '")' : 'Vorspann (ohne Titelzeile – nur per Editor adressierbar)');
    else chapterNames.push(o.label);
  }
  if (chapterNames.length) parts.push('Kapitel ' + chapterNames.map((n) => '„' + n + '“').join(", "));
  return parts.join(", ");
}
function reasonAmbiguous(target, fieldName, entryFieldName) {
  const ownersStr = sw(ownersLabel(target.distinctOwners, fieldName, target.titleDisp));
  let reason = 'Abschnitt „' + sw(target.disp) + '“ mehrdeutig (' + target.sectionMatches.length + ' Treffer: ' + ownersStr + ') – ' + fieldName + ' angeben';
  if (entryFieldName) reason += ' oder ' + entryFieldName + ' weglassen (entry muss dann im ganzen Notizbuch eindeutig sein)';
  return reason;
}
function reasonNeedsChapter(target, fieldName) {
  const suffix = chapterListSuffix(target.docChapters);
  if (target.candidates.length) {
    return 'Abschnitt „' + sw(target.disp) + '“ nicht gefunden – meintest du ' + sw(listNames(target.candidates)) +
      '? Sonst für einen neuen Abschnitt ' + fieldName + ' angeben' + suffix;
  }
  return 'Abschnitt „' + sw(target.disp) + '“ nicht gefunden – Notizbuch hat Kapitel: für einen neuen Abschnitt ' + fieldName + ' angeben' + suffix;
}
function reasonSectionNotFoundDelete(target) {
  let reason = 'Abschnitt „' + sw(target.disp) + '“ nicht gefunden';
  if (target.candidates.length) reason += ' – meintest du ' + sw(listNames(target.candidates)) + '?';
  return reason;
}
function reasonChapterNotFoundDelete(chapterDisp, candidates) {
  let reason = 'Kapitel „' + sw(chapterDisp) + '“ nicht gefunden – Op übersprungen';
  if (candidates && candidates.length) reason += ' (meintest du ' + sw(listNames(candidates)) + '?)';
  return reason;
}
function reasonWrongLevelHeadingSub(target) {
  const s = sw(target.subOwner.sectionDisp);
  const chapterPart = target.subOwner.chapterDisp ? ', chapter:"# ' + sw(target.subOwner.chapterDisp) + '"' : '';
  return '„' + sw(target.disp) + '“ ist ein ###-Unterthema in Abschnitt „' + s +
    '“ – zum Anhängen append_to_section mit heading:"## ' + s + '"' + chapterPart +
    ' (landet am Abschnittsende), zum Ändern replace_section mit dem kompletten Inhalt inkl. ###-Unterthemen';
}
function reasonWrongLevel3(disp) {
  return 'heading „' + sw(disp) + '“ ist als ###-Unterthema adressiert – Unterthemen gehören in den content eines ##-Abschnitts (append_to_section/replace_section mit heading:"## …")';
}
// Nacharbeit v7.53 (Review-Finding 🔵 10): dritter Fall neben "subOwner
// bekannt" (### liegt in einem ##-Abschnitt) und "level>=3" (die Op hat
// selbst ### geschrieben) – ein ###-Treffer DIREKT unter einem #-Kapitel
// OHNE umschließenden ##-Abschnitt (subOwner bleibt null, weil sectionIdx
// -1 ist) darf nicht fälschlich den level>=3-Wortlaut bekommen, wenn die Op
// selbst "##" (level 2) adressiert hat.
function wrongLevelHeadingReason(target) {
  if (target.subOwner) return reasonWrongLevelHeadingSub(target);
  if (target.level >= 3) return reasonWrongLevel3(target.disp);
  return '„' + sw(target.disp) + '“ existiert nur als ###-Unterthema direkt im Kapitel-Freitext – per append_to_chapter/replace_entry ändern';
}
function reasonTitleCreate(target, fieldName) {
  const suffix = chapterListSuffix(target.docChapters);
  return fieldName + ' „' + sw(target.titleDisp) + '“ ist die Notizbuch-Titelzeile – im Vorspann vor dem ersten Kapitel wird kein Abschnitt angelegt; ein echtes Kapitel angeben' + suffix;
}
function reasonTitleNotFoundDelete(target, fieldName) {
  const suffix = chapterListSuffix(target.docChapters);
  return 'Abschnitt „' + sw(target.disp) + '“ im Vorspann (' + fieldName + ' „' + sw(target.titleDisp) + '“ = Titelzeile) nicht gefunden – Kapitel angeben' + suffix;
}
function reasonTitleChapter(chapterResult, isFlat, moveVariant) {
  if (!isFlat) {
    const suffix = chapterListSuffix(chapterResult.docChapters);
    return '„' + sw(chapterResult.disp) + '“ ist die Notizbuch-Titelzeile, kein Kapitel – ein echtes Kapitel angeben' + suffix;
  }
  const alt = moveVariant ? 'to_heading:"## …"' : 'append_to_section mit heading:"## …" nutzen';
  return '„' + sw(chapterResult.disp) + '“ ist die Notizbuch-Titelzeile, kein Kapitel – das Notizbuch hat keine Kapitel: ' + alt + ' oder ein neues Kapitel mit anderem Namen angeben';
}
function reasonChapterWrongLevel(sectionOwner, opSuffix, fieldName) {
  const chapterPart = sectionOwner.chapterDisp ? ' in Kapitel „' + sw(sectionOwner.chapterDisp) + '“' : '';
  return (fieldName || "chapter") + ' „' + sw(sectionOwner.sectionDisp) + '“ ist ein ##-Abschnitt' + chapterPart + ', kein Kapitel – ' + opSuffix;
}
function reasonContent(lineText) {
  return 'content enthält Kapitel-/Abschnittszeilen („' + sw(lineText) + '“) – nur Inhalt ohne #/##-Zeilen senden; neue Abschnitte per eigener Op (###-Unterthemen sind erlaubt)';
}
function reasonC2Empty(kind, disp) {
  if (kind === "replace") {
    return 'content besteht nur aus der eigenen Überschriftszeile „## ' + sw(disp) + '“ – Abschnittsinhalt fehlt; Inhalt ohne Überschriftszeile senden (zum Leeren content:"")';
  }
  if (kind === "chapter") {
    return 'content besteht nur aus der Überschriftszeile „# ' + sw(disp) + '“ – Inhalt ohne Überschriftszeile senden';
  }
  return 'content besteht nur aus der Überschriftszeile „## ' + sw(disp) + '“ – Inhalt ohne Überschriftszeile senden';
}
function reasonDelCh(disp) {
  return 'heading „' + sw(disp) + '“ adressiert einen ##-Abschnitt – delete_section mit heading:"## ' + sw(disp) + '" oder delete_chapter mit chapter:"# …"';
}
function reasonConfl(chapterDisp, headingDisp) {
  return 'widersprüchliche Adressierung (chapter „' + sw(chapterDisp) + '“ UND heading „' + sw(headingDisp) +
    '“) – für einen ##-Abschnitt append_to_section mit heading:"## ' + sw(headingDisp) + '", chapter:"# ' + sw(chapterDisp) +
    '"; für Kapitel-Freitext heading weglassen';
}
function reasonConflH(disp) {
  return 'heading „' + sw(disp) + '“ adressiert einen ##-Abschnitt – append_to_section mit heading:"## ' + sw(disp) + '" nutzen; append_to_chapter braucht chapter:"# …"';
}
// Nacharbeit v7.53 (Review-Finding 🟡 6): "fieldName" (Default "chapter")
// steuert BEIDE Stellen, an denen das Adressfeld im Wortlaut auftaucht –
// den Präfix ("chapter „…“ ist ein ##-Abschnitt" vs. "from_chapter „…“ …")
// UND das Korrektur-Rezept (", chapter:\"# K\"" vs. ", from_chapter:\"# K\""
// bzw. ", to_chapter:\"# K\""). move_entry kennt kein Feld "chapter" – ohne
// den Parameter schlug der Skip-Grund dem Modell ein Feld vor, das die Op
// gar nicht besitzt, und die Ambiguität wiederholte sich im Folge-Turn.
function wrongLevelReasonFor(chapterResult, opSuffixBuilder, fieldName) {
  const s = chapterResult.sectionOwner;
  const fn = fieldName || "chapter";
  const chapterPart = s.chapterDisp ? ', ' + fn + ':"# ' + sw(s.chapterDisp) + '"' : '';
  return reasonChapterWrongLevel(s, opSuffixBuilder(sw(s.sectionDisp), chapterPart), fn);
}

// v7.53 Nacharbeit Runde 3 (Review-Fund 🔵 6): benannte Konstante für den
// EINEN Wortlaut, der einen bewussten No-op meldet (Op wäre inhaltlich
// identisch mit dem Bestand, applyOne() hat also nichts geändert) – NICHT
// mit einem echten Skip wegen einer verletzten Invariante zu verwechseln.
// turnGuard.js#planCrossNotebookHold muss genau diesen Fall bei
// TARGET_WRITE-Ops (append_to_section/replace_section/append_to_chapter)
// von den echten Auslösern ausnehmen (sonst: Modell sendet nach einem
// SHA-Konflikt dieselbe – jetzt bereits vorhandene – Ziel-Op erneut, der
// dadurch entstehende No-op-Skip würde die Quell-Löschung in JEDER anderen
// Notizbuch-Gruppe unnötig zurückhalten, eine Wiederholungsschleife). Nur an
// den DREI Stellen verwendet, die diesen Text für eine TARGET_WRITE-Op
// erzeugen (append_to_chapter unten, sowie die zwei Stellen im
// gemeinsamen append_to_section/replace_section/delete_section-Block weiter
// unten) – die übrigen Vorkommen (delete_chapter/delete_entry/replace_entry/
// move_entry/delete_section) bleiben bewusst UNVERÄNDERT als eigener
// String: sie betreffen keine TARGET_WRITE-Op und sind für den Guard
// irrelevant, eine gemeinsame Konstante böte dort keinen echten Vorteil.
export const DELIBERATE_NOOP_REASON = "keine inhaltliche Änderung";

// Erklärt NACHTRÄGLICH – nur wenn applyOpsDetailed() bereits per Vorher/
// Nachher-Textvergleich festgestellt hat, dass eine Op NICHTS verändert hat
// – WARUM. Dupliziert bewusst NUR die REIN LESENDEN Entscheidungen aus
// applyOne() (kein zweiter Schreibpfad, kein Risiko einer abweichenden
// Textausgabe zwischen Anwendung und Erklärung) – v7.53: AUSSCHLIESSLICH
// über resolveTarget()/resolveChapterTarget()/entryScope() (Spiegelprinzip).
function explainSkip(text, op) {
  if (!op || typeof op !== "object" || !OP_TYPES.includes(op.type)) {
    return "unbekannter Op-Typ" + (op && typeof op === "object" && op.type ? " „" + sanitizeForWarning(op.type) + "“" : "");
  }
  if (op.type === "rewrite") {
    const content = typeof op.content === "string" ? op.content.trim() : "";
    return content ? "keine inhaltliche Änderung" : "leerer content";
  }

  if (op.type === "delete_chapter") {
    const hasChapter = typeof op.chapter === "string" && op.chapter.trim();
    const fieldValue = hasChapter ? op.chapter : (typeof op.heading === "string" ? op.heading : "");
    const chapterDisp = dispHead(fieldValue);
    if (!chapterDisp) return "fehlende Kapitel-Überschrift";
    const lines = text.split("\n");
    const chapterResult = resolveChapterTarget(lines, fieldValue, { opType: "delete_chapter", usedHeadingFallback: !hasChapter });
    if (chapterResult.status === "conflicting_address") return reasonDelCh(chapterResult.disp);
    if (chapterResult.status === "title") {
      return "„" + sanitizeForWarning(chapterResult.disp) + "“ ist die Notizbuch-Titelzeile, kein Kapitel";
    }
    if (chapterResult.status === "wrong_level") {
      return wrongLevelReasonFor(chapterResult, (s, cp) => 'delete_section mit heading:"## ' + s + '"' + cp + ' oder chapter angeben');
    }
    if (chapterResult.status === "missing") {
      return reasonChapterNotFoundDelete(chapterDisp, chapterResult.candidates);
    }
    return "keine inhaltliche Änderung";
  }

  if (op.type === "append_to_chapter") {
    const hasChapter = typeof op.chapter === "string" && op.chapter.trim();
    const fieldValue = hasChapter ? op.chapter : op.heading;
    const lines = text.split("\n");
    const chapterResult = resolveChapterTarget(lines, fieldValue, {
      opType: "append_to_chapter", usedHeadingFallback: !hasChapter, heading: hasChapter ? op.heading : undefined,
    });
    if (chapterResult.status === "empty") return "fehlende Kapitel-Überschrift";
    if (chapterResult.status === "conflicting_address") {
      return chapterResult.conflictHeading ? reasonConfl(chapterResult.disp, chapterResult.conflictHeading) : reasonConflH(chapterResult.disp);
    }
    let content = typeof op.content === "string" ? op.content.replace(/^\n+|\n+$/g, "") : "";
    if (!content) return "leerer content";
    const norm1 = normalizeOwnHeading(content.split("\n"), chapterResult.disp, 1);
    if (norm1.stripped !== null) {
      if (!norm1.lines.join("\n").trim()) return reasonC2Empty("chapter", chapterResult.disp);
      content = norm1.lines.join("\n");
    }
    const structIdx = findStructureLine(content.split("\n"));
    if (structIdx !== -1) return reasonContent(content.split("\n")[structIdx]);
    if (chapterResult.status === "title") return reasonTitleChapter(chapterResult, !chapterResult.chaptered, false);
    if (chapterResult.status === "wrong_level") {
      return wrongLevelReasonFor(chapterResult, (s, cp) => 'append_to_section mit heading:"## ' + s + '"' + cp);
    }
    return DELIBERATE_NOOP_REASON;
  }

  if (op.type === "delete_entry" || op.type === "replace_entry") {
    const isReplace = op.type === "replace_entry";
    const entryText = typeof op.entry === "string" ? op.entry : "";
    const entryDisp = norm(entryText);
    if (!entryDisp) return "leerer entry";
    if (isReplace) {
      const content = typeof op.content === "string" ? op.content.replace(/^\n+|\n+$/g, "") : "";
      if (!content) return "leerer content – zum Löschen delete_entry nutzen";
    }
    const lines = text.split("\n");
    const { range, notFound, resolved } = entryScope(lines, op.heading, op.chapter, { heading: "heading", chapter: "chapter" });
    // Nacharbeit v7.53 (Review-Finding 🟡 4): bei notFound==="chapter" ist
    // "resolved" (falls heading gesetzt war) ein resolveTarget()-Ergebnis –
    // dessen TOP-LEVEL "candidates" sind ##-ABSCHNITTS-Kandidaten (Schritt 8,
    // Suchbereich = alle Abschnitte, weil scope null ist), nicht die
    // Kapitel-Kandidaten aus resolved.chapter.candidates. War nur "chapter"
    // gesetzt, IST "resolved" bereits das resolveChapterTarget()-Ergebnis
    // selbst (kein .chapter-Unterobjekt) – dort sind "candidates" korrekt.
    const chCand = resolved ? (resolved.chapter ? resolved.chapter.candidates : resolved.candidates) : [];
    if (notFound === "chapter") return reasonChapterNotFoundDelete(dispHead(op.chapter), chCand || []);
    if (notFound === "chapter_level") return wrongLevelReasonFor(resolved.chapter || resolved, (s, cp) => 'heading:"## ' + s + '"' + cp + ' nutzen');
    if (notFound === "heading_ambiguous") return reasonAmbiguous(resolved, "chapter", "heading");
    if (notFound === "heading_level") {
      if (resolved.levelField === "chapter") return wrongLevelReasonFor(resolved.chapter, (s, cp) => 'heading:"## ' + s + '"' + cp + ' nutzen');
      return wrongLevelHeadingReason(resolved);
    }
    if (notFound === "heading_title") return reasonTitleNotFoundDelete(resolved, "chapter");
    if (notFound === "heading") {
      let reason = "Abschnitt „" + sanitizeForWarning(dispHead(op.heading)) + "“ nicht gefunden";
      if (resolved && resolved.candidates && resolved.candidates.length) reason += " – meintest du " + sanitizeForWarning(listNames(resolved.candidates)) + "?";
      return reason;
    }
    const hits = findEntryLines(lines, range, entryText);
    if (hits.length === 0) {
      if (findFenceMaskedEntryMatch(lines, range, entryText)) {
        return "Eintrag „" + sanitizeForWarning(entryDisp) +
          "“ steht in einem Codeblock – Codezeilen sind keine Einträge; den Abschnitt samt Codeblock per replace_section ändern";
      }
      return "Eintrag „" + sanitizeForWarning(entryDisp) + "“ nicht gefunden";
    }
    if (hits.length > 1) {
      return "Eintrag „" + sanitizeForWarning(entryDisp) + "“ mehrdeutig (" + hits.length +
        " Treffer) – exakteren Wortlaut oder heading/chapter angeben";
    }
    if (isReplace) {
      const indent = lines[hits[0]].match(/^\s*/)[0];
      const content = typeof op.content === "string" ? op.content.replace(/^\n+|\n+$/g, "") : "";
      const newLines = content.split("\n").map((l) => (l.trim() === "" ? "" : indent + l));
      const mask = computeFenceLineMask(newLines);
      for (let i = 0; i < newLines.length; i++) {
        if (!mask[i] && BOUNDARY_RE.test(newLines[i])) return "content enthält Kapitel-/Abschnittszeilen – nur Eintragstext erlaubt";
      }
    }
    return "keine inhaltliche Änderung";
  }

  if (op.type === "move_entry") {
    const entryText = typeof op.entry === "string" ? op.entry : "";
    const entryDisp = norm(entryText);
    if (!entryDisp) return "leerer entry";
    const toHeadingDisp = dispHead(op.to_heading);
    const toChapterDisp = dispHead(op.to_chapter);
    if (!toHeadingDisp && !toChapterDisp) return "fehlendes Ziel – to_heading oder to_chapter angeben";
    const lines = text.split("\n");
    const { range, notFound, resolved } = entryScope(lines, op.from_heading, op.from_chapter, { heading: "from_heading", chapter: "from_chapter" });
    // Nacharbeit v7.53 (Review-Finding 🟡 4, s. delete_entry/replace_entry oben).
    const fromChCand = resolved ? (resolved.chapter ? resolved.chapter.candidates : resolved.candidates) : [];
    if (notFound === "chapter") return reasonChapterNotFoundDelete(dispHead(op.from_chapter), fromChCand || []);
    if (notFound === "chapter_level") return wrongLevelReasonFor(resolved.chapter || resolved, (s, cp) => 'from_heading:"## ' + s + '"' + cp + ' nutzen', "from_chapter");
    if (notFound === "heading_ambiguous") return reasonAmbiguous(resolved, "from_chapter", "from_heading");
    if (notFound === "heading_level") {
      if (resolved.levelField === "chapter") return wrongLevelReasonFor(resolved.chapter, (s, cp) => 'from_heading:"## ' + s + '"' + cp + ' nutzen', "from_chapter");
      return wrongLevelHeadingReason(resolved);
    }
    if (notFound === "heading_title") return reasonTitleNotFoundDelete(resolved, "from_chapter");
    if (notFound === "heading") {
      let reason = "Abschnitt „" + sanitizeForWarning(dispHead(op.from_heading)) + "“ nicht gefunden";
      if (resolved && resolved.candidates && resolved.candidates.length) reason += " – meintest du " + sanitizeForWarning(listNames(resolved.candidates)) + "?";
      return reason;
    }
    const hits = findEntryLines(lines, range, entryText);
    if (hits.length === 0) {
      if (findFenceMaskedEntryMatch(lines, range, entryText)) {
        return "Eintrag „" + sanitizeForWarning(entryDisp) +
          "“ steht in einem Codeblock – Codezeilen sind keine Einträge; den Abschnitt samt Codeblock per replace_section ändern";
      }
      return "Eintrag „" + sanitizeForWarning(entryDisp) + "“ nicht gefunden";
    }
    if (hits.length > 1) {
      return "Eintrag „" + sanitizeForWarning(entryDisp) + "“ mehrdeutig (" + hits.length +
        " Treffer) – exakteren Wortlaut oder heading/chapter angeben";
    }
    if (toHeadingDisp) {
      const target = resolveTarget(lines, { heading: op.to_heading, chapter: toChapterDisp ? op.to_chapter : null, chapterFieldName: "to_chapter", opType: "write" });
      if (target.status === "title") return reasonTitleCreate(target, "to_chapter");
      if (target.status === "wrong_level") {
        if (target.levelField === "chapter") return wrongLevelReasonFor(target.chapter, (s, cp) => 'to_heading:"## ' + s + '"' + cp + ' nutzen', "to_chapter");
        return wrongLevelHeadingReason(target);
      }
      if (target.status === "ambiguous") return reasonAmbiguous(target, "to_chapter", null);
      if (target.status === "missing" && target.needsChapter) return reasonNeedsChapter(target, "to_chapter");
    } else {
      const chapterTarget = resolveChapterTarget(lines, op.to_chapter, { fieldName: "to_chapter" });
      if (chapterTarget.status === "title") return reasonTitleChapter(chapterTarget, !chapterTarget.chaptered, true);
      if (chapterTarget.status === "wrong_level") return wrongLevelReasonFor(chapterTarget, (s, cp) => 'to_heading:"## ' + s + '"' + cp + ' nutzen', "to_chapter");
    }
    return "keine inhaltliche Änderung";
  }

  // v7.43 (Live-Befund, siehe DECISIONS #87): Meldung um eine konkrete
  // Handlungsanweisung ergänzt (statt nur "fehlende Abschnitts-
  // Überschrift") – landet über buildOpsWarning (App.jsx) im nächsten Turn
  // als SYSTEM-HINWEIS in der Historie und soll dem Modell direkt sagen,
  // WAS zu tun ist (heading nachreichen), statt nur DASS etwas fehlte.
  const isWrite = op.type === "append_to_section" || op.type === "replace_section";
  const disp = dispHead(op.heading);
  if (!disp) return "fehlende Abschnitts-Überschrift – heading mit der exakten ##-Zeile angeben";
  const lines = text.split("\n");
  let content = typeof op.content === "string" ? op.content.replace(/^\n+|\n+$/g, "") : "";
  if (op.type === "append_to_section" && !content) return "leerer content";
  if (isWrite && content) {
    const norm1 = normalizeOwnHeading(content.split("\n"), disp, 2);
    if (norm1.stripped !== null) {
      if (!norm1.lines.join("\n").trim()) return reasonC2Empty(op.type === "replace_section" ? "replace" : "append", disp);
      content = norm1.lines.join("\n");
    }
    const structIdx = findStructureLine(content.split("\n"));
    if (structIdx !== -1) return reasonContent(content.split("\n")[structIdx]);
  }
  const target = resolveTarget(lines, { heading: op.heading, chapter: op.chapter, chapterFieldName: "chapter", opType: isWrite ? "write" : "delete" });

  if (target.status === "collision") {
    if (!isWrite) {
      if (target.collisionRange) {
        return "„" + sanitizeForWarning(disp) + "“ ist ein #-Kapitel ohne gleichnamigen ##-Abschnitt – zum Löschen des Kapitels delete_chapter nutzen";
      }
      return reasonChapterNotFoundDelete(disp, []);
    }
    if (!content) return "leerer content";
    if (op.type === "replace_section" && !target.preambleEmpty) {
      return "„" + sanitizeForWarning(disp) + "“ ist ein #-Kapitel ohne gleichnamigen ##-Abschnitt – Kapitel-Freitext nicht ersetzt (kein ##-Duplikat angelegt); Eintrag ändern: replace_entry, Eintrag löschen: delete_entry, anhängen: append_to_chapter";
    }
    return DELIBERATE_NOOP_REASON;
  }
  // Nacharbeit v7.53 (Review-Finding 🟡 5): dieser Zweig deckt AUSSCHLIESSLICH
  // append_to_section/replace_section/delete_section ab (delete_entry/
  // replace_entry/move_entry werden weiter oben in eigenen Blöcken
  // behandelt) – keine dieser drei Ops hat ein "entry"-Feld, der
  // "oder heading weglassen"-Zusatz war für delete_section deshalb falsch.
  if (target.status === "ambiguous") return reasonAmbiguous(target, "chapter", null);
  if (target.status === "title") return isWrite ? reasonTitleCreate(target, "chapter") : reasonTitleNotFoundDelete(target, "chapter");
  if (target.status === "wrong_level") {
    if (target.levelField === "chapter") {
      const opName = isWrite ? "append_to_section" : "delete_section";
      return wrongLevelReasonFor(target.chapter, (s, cp) => opName + ' mit heading:"## ' + s + '"' + cp + ' nutzen');
    }
    return wrongLevelHeadingReason(target);
  }
  if (!isWrite) {
    if (target.status === "found") return "keine inhaltliche Änderung";
    if (target.chapter.status === "missing") return reasonChapterNotFoundDelete(dispHead(op.chapter), target.chapter.candidates);
    return reasonSectionNotFoundDelete(target);
  }
  if (target.status === "missing" && target.needsChapter) return reasonNeedsChapter(target, "chapter");
  return DELIBERATE_NOOP_REASON;
}

// v7.53: gemeinsamer Note-Baustein für append_to_section/replace_section,
// delete_section UND move_entry-Ziel (to_heading) – beschreibt Kollisions-
// Umleitung (v7.52-Wortlaute, unverändert), Neuanlage (inkl. Did-you-mean/
// i10-Namensvetter), den Titel-Scope-Treffer (N-TITLE-SCOPE/N-TITLE-FLAT)
// und den ###-auf-##-Treffer (siehe unten). Nacharbeit v7.53 Runde 2
// (Review-Finding 🔵 3a): "fieldName" (Default "chapter") macht die beiden
// Titel-Sätze feldkorrekt – move_entry-Ziel ruft mit "to_chapter" auf, sonst
// hätte die Note ein Feld genannt, das die Op gar nicht besitzt (move_entry
// kennt kein "chapter").
function noteForSectionTarget(target, entryMode, fieldName = "chapter") {
  if (target.status === "collision") {
    if (target.collisionRange === null) {
      return entryMode
        ? 'Kapitel „' + sw(target.disp) + '“ neu angelegt, Eintrag als Kapitel-Freitext (kein ##-Duplikat)'
        : 'Kapitel „' + sw(target.disp) + '“ neu angelegt, content als Kapitel-Freitext (kein ##-Duplikat)';
    }
    if (entryMode) {
      return 'Eintrag in Kapitel-Freitext „' + sw(target.disp) + '“ eingefügt (kein ##-Abschnitt „' + sw(target.disp) + '“)';
    }
    return 'in Kapitel-Freitext „' + sw(target.disp) +
      '“ eingefügt – kein ##-Abschnitt „' + sw(target.disp) +
      '“ vorhanden, Kapitelnamen-Duplikat vermieden (für einen echten ##-Abschnitt dieses Namens in einem anderen Kapitel chapter:"# …" angeben)';
  }
  const parts = [];
  if (target.titleNote === "preamble" && target.status === "found") {
    parts.push(fieldName + ' „' + sw(target.titleDisp) + '“ ist die Titelzeile – als Eingrenzung auf den Vorspann (vor dem ersten Kapitel) gewertet');
  }
  if (target.titleNote === "flat") {
    parts.push(fieldName + ' „' + sw(target.titleDisp) + '“ ist die Titelzeile – ignoriert (Notizbuch ohne Kapitel)');
  }
  // Nacharbeit v7.53 Runde 2 (Review-Finding 🔵 2): ein heading mit "###"
  // (rawLevel>=3), das einen GLEICHNAMIGEN ##-Abschnitt trifft, läuft laut
  // Resolver-Reihenfolge (1.5 Schritt 4 VOR Schritt 6) als normaler "found"-
  // Treffer durch applyOne – der Prompt verspricht aber "ein heading mit ###
  // wird abgelehnt". Bewusst die Note-Variante statt einer Prompt-Änderung
  // (Orchestrator-Entscheidung): die Op wirkt korrekt (landet im richtigen
  // ##-Abschnitt), das Modell soll nur künftig "## …" statt "### …" senden.
  if (target.status === "found" && target.level >= 3) {
    parts.push('heading „### ' + sw(target.disp) + '“ als ##-Abschnitt „' + sw(target.disp) + '“ gewertet – heading mit "## …" senden');
  }
  if (target.status === "missing") {
    let note;
    if (target.chapter.status === "missing") {
      note = 'Kapitel „' + sw(dispHead(target.chapterField)) + '“ und Abschnitt „' + sw(target.disp) + '“ neu angelegt';
      if (target.chapter.candidates.length) {
        note += ' – ähnlich vorhanden: ' + sw(listNames(target.chapter.candidates)) + '; falls das gemeint war, im reply nachfragen (Korrektur: delete_chapter „' +
          sw(target.chapter.disp) + '“ + erneut mit heading:"## ' + sw(target.disp) + '", chapter:"# ' + sw(target.chapter.candidates[0]) + '")';
      } else if (target.chapter.sectionNamesake) {
        const sn = target.chapter.sectionNamesake;
        note += ' – ähnlich vorhanden: ##-Abschnitt „' + sw(sn.sectionDisp) + '“' +
          (sn.chapterDisp ? ' in Kapitel „' + sw(sn.chapterDisp) + '“' : '') +
          '; falls das gemeint war, im reply nachfragen (Korrektur: delete_chapter „' + sw(target.chapter.disp) +
          '“ + erneut mit heading:"## ' + sw(sn.sectionDisp) + '"' + (sn.chapterDisp ? ', chapter:"# ' + sw(sn.chapterDisp) + '"' : '') + ')';
      }
    } else if (target.chapterRange && target.scopeKind === "chapter") {
      note = 'Abschnitt „' + sw(target.disp) + '“ neu angelegt in Kapitel „' + sw(dispHead(target.chapterField)) + '“';
    } else {
      note = 'Abschnitt „' + sw(target.disp) + '“ neu angelegt am Dokumentende';
    }
    if (target.candidates.length && target.chapter.status !== "missing") {
      note += ' – ähnlich vorhanden: ' + sw(listNames(target.candidates)) +
        '; falls das gemeint war, im reply nachfragen (Korrektur: delete_section „' + sw(target.candidates[0]) +
        '“' + (target.chapterField ? ' chapter:"# ' + sw(dispHead(target.chapterField)) + '"' : '') +
        ' + erneut mit heading:"## ' + sw(target.candidates[0]) + '")';
    }
    parts.push(note);
  }
  return parts.length ? parts.join("; ") : undefined;
}

// v7.52 (ℹ️-Notes, DECISIONS #106), v7.53 auf den Resolver umgestellt
// (DECISIONS #111): rein lesend wie explainSkip – anders als dort aber NUR
// relevant, wenn eine Op TATSÄCHLICH etwas verändert hat (applyOpsDetailed
// ruft sie nur bei applied:true auf, siehe dort). Arbeitet auf "before" (dem
// Text VOR applyOne), NICHT auf dem bereits mutierten Ergebnis – dieselbe
// Read-Only-Garantie wie explainSkip; beeinflusst applyOne/den Ergebnistext
// NIE.
function explainNote(before, op) {
  if (!op || typeof op !== "object") return undefined;
  const lines = before.split("\n");

  if (op.type === "append_to_section" || op.type === "replace_section") {
    const parts = [];
    const disp = dispHead(op.heading);
    const content = typeof op.content === "string" ? op.content.replace(/^\n+|\n+$/g, "") : "";
    const norm1 = normalizeOwnHeading(content.split("\n"), disp, 2);
    if (norm1.stripped !== null) {
      parts.push('erste content-Zeile „' + sw(norm1.stripped.trim()) + '“ (eigene Überschrift) entfernt – content ohne Überschriftszeile senden');
    }
    const target = resolveTarget(lines, { heading: op.heading, chapter: op.chapter, chapterFieldName: "chapter", opType: "write" });
    const n = noteForSectionTarget(target);
    if (n) parts.push(n);
    return parts.length ? parts.join("; ") : undefined;
  }

  if (op.type === "append_to_chapter") {
    const hasChapter = typeof op.chapter === "string" && op.chapter.trim();
    const fieldValue = hasChapter ? op.chapter : op.heading;
    const chapterResult = resolveChapterTarget(lines, fieldValue, { opType: "append_to_chapter", usedHeadingFallback: !hasChapter, heading: hasChapter ? op.heading : undefined });
    const parts = [];
    const content = typeof op.content === "string" ? op.content.replace(/^\n+|\n+$/g, "") : "";
    const norm1 = normalizeOwnHeading(content.split("\n"), chapterResult.disp, 1);
    if (norm1.stripped !== null) {
      parts.push('erste content-Zeile „' + sw(norm1.stripped.trim()) + '“ (eigene Überschrift) entfernt – content ohne Überschriftszeile senden');
    }
    if (chapterResult.status === "missing") {
      let note = 'Kapitel „' + sw(chapterResult.disp) + '“ neu angelegt';
      if (chapterResult.candidates.length) {
        note += ' – ähnlich vorhanden: ' + sw(listNames(chapterResult.candidates)) +
          '; falls das gemeint war, im reply nachfragen (Korrektur: delete_chapter „' + sw(chapterResult.disp) +
          '“ + erneut mit chapter:"# ' + sw(chapterResult.candidates[0]) + '")';
      }
      parts.push(note);
    }
    return parts.length ? parts.join("; ") : undefined;
  }

  if (op.type === "move_entry") {
    const parts = [];
    const src = entryScope(lines, op.from_heading, op.from_chapter, { heading: "from_heading", chapter: "from_chapter" });
    if (src.redirected) {
      parts.push('Quelle „' + sw(dispHead(op.from_heading)) + '“ ist ein #-Kapitel ohne ##-Abschnitt – Eintrag im gesamten Kapitel gesucht');
    }
    if (src.titleNote === "preamble") {
      const tIdx = titleLineIdx(lines);
      parts.push('from_chapter „' + sw(tIdx !== -1 ? dispHead(lines[tIdx]) : "") + '“ ist die Titelzeile – als Eingrenzung auf den Vorspann (vor dem ersten Kapitel) gewertet');
    }
    // Nacharbeit v7.53 Runde 2 (Review-Finding 🔵 3b): dieselbe ℹ️-Note wie
    // bei "preamble" oben, aber für ein FLACHES Dokument (chapter==Titel gilt
    // dort als NICHT gesetzt, ignoriert statt eingegrenzt) – fehlte bisher,
    // die Op wirkte korrekt, aber unerklärt.
    if (src.titleNote === "flat") {
      const tIdx = titleLineIdx(lines);
      parts.push('from_chapter „' + sw(tIdx !== -1 ? dispHead(lines[tIdx]) : "") + '“ ist die Titelzeile – ignoriert (Notizbuch ohne Kapitel)');
    }
    const toHeadingDisp = dispHead(op.to_heading);
    const toChapterDisp = dispHead(op.to_chapter);
    if (toHeadingDisp) {
      // Nacharbeit v7.53 Runde 2 (Review-Finding 🔵 3a): "to_chapter" statt
      // des Default-Feldnamens "chapter" – move_entry kennt kein Feld
      // "chapter".
      const target = resolveTarget(lines, { heading: op.to_heading, chapter: toChapterDisp ? op.to_chapter : null, chapterFieldName: "to_chapter", opType: "write" });
      const n = noteForSectionTarget(target, true, "to_chapter");
      if (n) parts.push(n);
    } else if (toChapterDisp) {
      const chapterTarget = resolveChapterTarget(lines, op.to_chapter, { fieldName: "to_chapter" });
      if (chapterTarget.status === "missing") {
        let note = 'Kapitel „' + sw(chapterTarget.disp) + '“ neu angelegt';
        // Nacharbeit v7.53 Runde 2 (Review-Finding 🔵 3d): N-DYM bekommt auch
        // hier das Korrektur-Rezept (vorher nur die reine Nachfrage-
        // Aufforderung ohne konkreten Folge-Turn-Vorschlag, siehe Spec 4/
        // N-DYM). "to_chapter" statt "chapter" im Rezept, move_entry kennt
        // das Feld "chapter" nicht.
        if (chapterTarget.candidates.length) {
          note += ' – ähnlich vorhanden: ' + sw(listNames(chapterTarget.candidates)) +
            '; falls das gemeint war, im reply nachfragen (Korrektur: delete_chapter „' + sw(chapterTarget.disp) +
            '“ + erneut mit to_chapter:"# ' + sw(chapterTarget.candidates[0]) + '")';
        }
        parts.push(note);
      }
    }
    return parts.length ? parts.join("; ") : undefined;
  }

  if (op.type === "delete_entry" || op.type === "replace_entry") {
    const scope = entryScope(lines, op.heading, op.chapter, { heading: "heading", chapter: "chapter" });
    const parts = [];
    if (scope.redirected) {
      parts.push('„' + sw(dispHead(op.heading)) + '“ ist ein #-Kapitel ohne ##-Abschnitt – Eintrag im gesamten Kapitel gefunden');
    }
    if (scope.titleNote === "preamble") {
      parts.push('chapter „' + sw(dispHead(op.chapter)) + '“ ist die Titelzeile – als Eingrenzung auf den Vorspann (vor dem ersten Kapitel) gewertet');
    }
    // Nacharbeit v7.53 Runde 2 (Review-Finding 🔵 3b): FLACHES Dokument,
    // chapter==Titel gilt dort als NICHT gesetzt (ignoriert) – fehlte
    // bisher als eigener Zweig, siehe move_entry-Quelle oben.
    if (scope.titleNote === "flat") {
      parts.push('chapter „' + sw(dispHead(op.chapter)) + '“ ist die Titelzeile – ignoriert (Notizbuch ohne Kapitel)');
    }
    return parts.length ? parts.join("; ") : undefined;
  }

  // Nacharbeit v7.53 Runde 2 (Review-Finding 🔵 3c): delete_section bekam
  // bisher GAR KEINE Note – weder für einen Vorspann-Treffer (Titel-Scope)
  // noch für einen ###-auf-##-Treffer (siehe noteForSectionTarget oben).
  // delete_section legt nie etwas an (target.status ist bei applied:true
  // IMMER "found", siehe applyOne), noteForSectionTarget() liefert hier also
  // automatisch NUR die Titel-/###-Teile, nie einen Anlage-Text.
  if (op.type === "delete_section") {
    const target = resolveTarget(lines, { heading: op.heading, chapter: op.chapter, chapterFieldName: "chapter", opType: "delete" });
    return noteForSectionTarget(target);
  }

  return undefined;
}

// v7.53 Nacharbeit Runde 3 (Review-Fund 🟡 2): Obergrenze der pro Turn
// angewendeten Ops als benannte Konstante statt einer eingestreuten "20" –
// turnGuard.js#planTurn muss dieselbe Kappung auf die UNGEKAPPTE g.ops-Liste
// anwenden, BEVOR er zurückgehaltene Indizes herausfiltert (sonst rutschen
// nie bewertete Ops jenseits dieser Grenze unbewertet durch den Guard nach,
// siehe dortiger Kommentar).
export const MAX_OPS = 20;

// Wendet ops WIE applyOps an, liefert aber zusätzlich pro Op ein Ergebnis
// { index, type, heading?, applied, reason? } – reason ist nur bei
// applied:false gesetzt. Exportiert für App.jsx (Warn-Pille bei
// wirkungslosen Ops, siehe DECISIONS #63) und für die eigenen Tests.
export function applyOpsDetailed(docText, ops) {
  let text = docText;
  const results = [];
  const list = (ops || []).slice(0, MAX_OPS);
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
