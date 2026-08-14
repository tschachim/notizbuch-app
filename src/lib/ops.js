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
    if (!sec) return { range: null, notFound: "heading" };
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
function insertEntryIntoSection(lines, headingDisp, chapterField, blockLines) {
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
// findAddressableChapter()/firstSectionInChapter()-Unterbau, damit beide
// Op-Typen GARANTIERT dasselbe Anlage-/Einfüge-Verhalten zeigen.
function insertEntryIntoChapterPreamble(lines, chapterField, blockLines) {
  const chapterDisp = dispHead(chapterField);
  const { range } = findAddressableChapter(lines, chapterField);
  if (!range) {
    padEnd(lines);
    lines.push("# " + chapterDisp, "", ...blockLines);
    return;
  }
  let at = firstSectionInChapter(lines, range);
  while (at > range[0] + 1 && lines[at - 1].trim() === "") at--;
  lines.splice(at, 0, ...blockLines);
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
    // vorhandenem Präambel-Freitext. Leerzeilen direkt davor überspringen
    // (analog zu append_to_section unten), damit der neue Inhalt direkt
    // hinter dem letzten Präambel-Inhalt landet; tidy() normalisiert
    // danach die Abstände zu den umgebenden Struktur-Zeilen.
    let at = firstSectionInChapter(chLines, range);
    while (at > range[0] + 1 && chLines[at - 1].trim() === "") at--;
    chLines.splice(at, 0, ...content.split("\n"));
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
    // ALLE Prüfungen bestanden – ab hier wird "meLines" tatsächlich mutiert.
    const [s, e] = entryBlockRange(meLines, hits[0]);
    const block = dedentBlock(meLines.slice(s, e));
    meLines.splice(s, e - s);
    // Ziel-Einfügung IMMER auf dem bereits um die Quelle bereinigten Array
    // (Quelle==Ziel verschiebt den Eintrag dadurch korrekt ans Zielende,
    // statt ihn zu duplizieren).
    if (toHeadingDisp) {
      insertEntryIntoSection(meLines, toHeadingDisp, toChapterDisp ? op.to_chapter : null, block);
    } else {
      insertEntryIntoChapterPreamble(meLines, op.to_chapter, block);
    }
    return tidy(meLines);
  }

  const disp = dispHead(op.heading);
  if (!disp) return text;
  const lines = text.split("\n");

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
  const content =
    typeof op.content === "string" ? op.content.replace(/^\n+|\n+$/g, "") : "";

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
const OP_TYPES = [
  "append_to_section", "replace_section", "delete_section", "delete_chapter", "append_to_chapter",
  "delete_entry", "move_entry", "rewrite",
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
    // Kapitel-Raute weginterpretiert werden soll).
    const heading = op && typeof op === "object"
      ? (op.type === "delete_entry" || op.type === "move_entry"
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
    results.push({ index, type, heading, applied, reason: applied ? undefined : reason });
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
