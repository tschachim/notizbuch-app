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
/* ------------------------------------------------------------------ */

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
// vor der Kapitelzeile statt danach). Wie schon HEAD_RE ist auch diese
// Grenze bewusst FENCE-BLIND (siehe markdown.jsx#parseTree und DECISIONS
// #54) – eine "#"/"##"-Zeile innerhalb eines ```-Codeblocks im
// Abschnittsinhalt würde ebenfalls (fälschlich) als Grenze zählen; dieselbe
// dokumentierte, hier bewusst nicht behobene Grenze wie beim Renderer.
const BOUNDARY_RE = /^#{1,2}\s/;

export const normHead = (h) => String(h || "").replace(/^#+\s*/, "").trim().toLowerCase();
export const dispHead = (h) => String(h || "").replace(/^#+\s*/, "").trim();

// Sucht den Zeilenbereich [s, e) einer "# "-Kapitelzeile (normHead-tolerant,
// wie bei Abschnitten – "# Projekte" und "Projekte" treffen dieselbe
// Kapitelzeile). e ist die nächste "# "-Zeile oder das Dokumentende. null,
// wenn kein Kapitel mit diesem Titel existiert. "fromIdx" (optional, v7.32.1
// Review-Fix 🟡): Startindex der Suche nach der ERSTEN passenden Zeile –
// Default 0 (bisheriges Verhalten, unverändert für alle Aufrufer ohne
// dritten Parameter). Wird von findDeletableChapter() unten genutzt, um NACH
// einer bereits gefundenen Notizbuch-Titelzeile weiterzusuchen.
function findChapter(lines, chapterHeading, fromIdx) {
  const t = normHead(chapterHeading);
  if (!t) return null;
  const from = typeof fromIdx === "number" ? fromIdx : 0;
  let s = -1;
  for (let i = from; i < lines.length; i++) {
    if (CHAPTER_RE.test(lines[i]) && normHead(lines[i]) === t) { s = i; break; }
  }
  if (s === -1) return null;
  let e = lines.length;
  for (let j = s + 1; j < lines.length; j++) {
    if (CHAPTER_RE.test(lines[j])) { e = j; break; }
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
function titleLineIdx(lines) {
  const firstContentIdx = lines.findIndex((l) => l.trim() !== "");
  return firstContentIdx !== -1 && CHAPTER_RE.test(lines[firstContentIdx]) ? firstContentIdx : -1;
}

// Liefert das für delete_chapter adressierte Kapitel-Feld (v7.32): bevorzugt
// "chapter" (konsistent zum bestehenden chapter-Feld bei den anderen Ops),
// fällt bei fehlendem/leerem "chapter" auf "heading" zurück – Robustheits-
// Fallback gegen Modell-Varianz (manche Antworten könnten das allgemeinere
// heading-Feld statt des korrekten chapter-Felds benutzen). Von applyOne UND
// explainSkip genutzt (nicht dupliziert), damit beide GARANTIERT denselben
// Kapitel-String sehen – Grundprinzip dieser Datei, siehe explainSkip-
// Kopfkommentar weiter unten.
function chapterFieldFor(op) {
  if (typeof op.chapter === "string" && op.chapter.trim()) return op.chapter;
  if (typeof op.heading === "string" && op.heading.trim()) return op.heading;
  return "";
}

// Sucht das für delete_chapter zu löschende Kapitel UNTER Berücksichtigung
// der Titelzeilen-Ausnahme (v7.32.1, Review-Fix 🟡, Live-Befund-Nachbesserung):
// Ein Kapitel mit dem GLEICHEN Namen wie die Notizbuch-Titelzeile (z. B.
// Titel "# Projekte" UND weiter unten ein reguläres "# Projekte"-Kapitel –
// laut parseTree/titleLineIdx ist JEDE "# "-Zeile außer der einen Titelzeile
// ein normales Kapitel) wäre sonst per delete_chapter DAUERHAFT unlöschbar:
// findChapter() liefert bei der globalen Suche IMMER zuerst die Titelzeile
// (erster Treffer im Dokument), der reine Positionsvergleich in applyOne
// hätte das als Titelzeilen-Skip gemeldet, obwohl weiter unten ein echtes,
// löschbares Kapitel mit demselben Namen existiert. Trifft der erste Treffer
// die Titelzeile, wird die Suche deshalb AB der Zeile DANACH fortgesetzt
// (findChapter-"fromIdx"); nur wenn dort ebenfalls nichts gefunden wird,
// bleibt es beim Titelzeilen-Skip. Ein bereits GEFUNDENES echtes Kapitel
// unterhalb der Titelzeile ist niemals selbst wieder die Titelzeile (die
// Suche startet ja erst NACH deren Index) – ein erneuter Titel-Vergleich
// danach ist daher nicht nötig. Von applyOne UND explainSkip genutzt (kein
// zweiter Schreibpfad), damit beide GARANTIERT dieselbe Entscheidung
// treffen. Rückgabe: { range: [s,e]|null, titleBlocked: bool } –
// titleBlocked ist nur bei range===null gesetzt und unterscheidet "gar kein
// Kapitel dieses Namens" (false) von "nur als Titelzeile getroffen, sonst
// nirgends" (true) – die beiden Fälle brauchen unterschiedliche
// explainSkip-Meldungen.
function findDeletableChapter(lines, chapterField) {
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
// Ops ohne "chapter"-Feld).
function findSection(lines, heading, range) {
  const t = normHead(heading);
  if (!t) return null;
  const from = range ? range[0] : 0;
  const to = range ? range[1] : lines.length;
  let s = -1;
  for (let i = from; i < to; i++) {
    if (HEAD_RE.test(lines[i]) && normHead(lines[i]) === t) { s = i; break; }
  }
  if (s === -1) return null;
  let e = to;
  for (let j = s + 1; j < to; j++) {
    if (BOUNDARY_RE.test(lines[j])) { e = j; break; }
  }
  return [s, e];
}

function tidy(lines) {
  const out = [];
  let blank = 0;
  for (const l of lines) {
    if (l.trim() === "") { blank++; if (blank <= 1) out.push(""); }
    else { blank = 0; out.push(l); }
  }
  const res = [];
  for (let i = 0; i < out.length; i++) {
    // v7.14: Leerzeile jetzt auch vor "# "-Kapitelzeilen erzwungen (BOUNDARY_RE
    // statt bisher nur "^##\s+") – ohne diese Erweiterung könnte eine per Op
    // neu eingefügte Kapitelzeile direkt an vorherigem Inhalt kleben.
    if (BOUNDARY_RE.test(out[i]) && res.length && res[res.length - 1].trim() !== "") res.push("");
    res.push(out[i]);
  }
  return res.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function padEnd(lines) {
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  lines.push("");
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
    // mit. findDeletableChapter() setzt die Suche NACH einer zuerst
    // getroffenen Titelzeile fort (Review-Fix 🟡, v7.32.1) – ein REGULÄRES
    // Kapitel mit demselben Namen wie der Notizbuch-Titel (z. B. Titel
    // "# Projekte" UND ein echtes "# Projekte"-Kapitel weiter unten) bleibt
    // dadurch löschbar, statt wegen des ERSTEN Treffers (der Titelzeile)
    // dauerhaft blockiert zu sein. Erkennung über POSITION, NICHT über
    // Namensvergleich – ein Dokument OHNE führende "# "-Zeile hat keine
    // Titel-Ausnahme, dort ist auch die erste "# "-Zeile ein normales,
    // löschbares Kapitel.
    const { range } = findDeletableChapter(chLines, chapterField);
    if (!range) return text; // nicht gefunden ODER nur als Titelzeile getroffen
    chLines.splice(range[0], range[1] - range[0]);
    return tidy(chLines);
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
const OP_TYPES = ["append_to_section", "replace_section", "delete_section", "delete_chapter", "rewrite"];

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
  // dort, inkl. findDeletableChapter/Review-Fix 🟡 v7.32.1) – Prüfreihenfolge:
  // chapterField leer -> Kapitel gar nicht gefunden -> nur als Titelzeile
  // getroffen (kein weiteres gleichnamiges Kapitel) -> (sonst: applied wäre
  // true, landet nie hier).
  if (op.type === "delete_chapter") {
    const chapterField = chapterFieldFor(op);
    const chapterDisp = dispHead(chapterField);
    if (!chapterDisp) return "fehlende Kapitel-Überschrift";
    const lines = text.split("\n");
    const { range, titleBlocked } = findDeletableChapter(lines, chapterField);
    if (!range) {
      if (titleBlocked) {
        return "„" + sanitizeForWarning(chapterDisp) + "“ ist die Notizbuch-Titelzeile, kein Kapitel";
      }
      return "Kapitel „" + sanitizeForWarning(chapterDisp) + "“ nicht gefunden – Op übersprungen";
    }
    // Gefunden (ggf. NACH der Titelzeile, siehe findDeletableChapter) ->
    // applyOne hätte gelöscht (applied wäre true) - dieser Zweig wird unter
    // normalen Umständen nie erreicht.
    return "keine inhaltliche Änderung";
  }
  const disp = dispHead(op.heading);
  if (!disp) return "fehlende Abschnitts-Überschrift";
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
    // v7.32 (delete_chapter-Op): "heading" hier ist NUR ein Anzeige-Feld für
    // App.jsx#buildOpsWarning (⚠️-Warn-Pille) – delete_chapter adressiert
    // aber über "chapter" (mit heading-Fallback, siehe chapterFieldFor), hat
    // also i. d. R. KEIN eigenes op.heading. Ohne diese Sonderbehandlung
    // bliebe die Warn-Pille ohne erkennbaren Kapitelnamen ("delete_chapter
    // in „X“ (…)" statt "delete_chapter „Kapitelname“ in „X“ (…)").
    // Dieselbe Prioritäts-Logik wie applyOne/explainSkip (DRY, kein
    // Risiko einer abweichenden Anzeige). Review-Fix 🔵 (v7.32.1): für ALLE
    // ANDEREN Op-Typen bleibt der ursprüngliche Vertrag exakt erhalten – NUR
    // ein echter String in op.heading wird angezeigt (dispHead(42) läge
    // sonst z. B. bei "42" statt beim vorherigen/erwarteten undefined,
    // chapterFieldFor prüft diesen typeof zwar bereits FÜR delete_chapter
    // selbst, aber eben nicht für die drei ##-Abschnitts-Ops).
    const heading = op && typeof op === "object"
      ? dispHead(
          op.type === "delete_chapter"
            ? chapterFieldFor(op)
            : (typeof op.heading === "string" ? op.heading : "")
        ) || undefined
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
