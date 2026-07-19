/* ------------------------------------------------------------------ */
/* Dokument-Operationen (Abschnitte auf ##-Ebene)                      */
/* 1:1 aus der Referenz-App (Artifact v3.1) übernommen.                */
/* v7.14: Kapitel-Grenzen ("# ") berücksichtigt (Verschluck-Fix) +      */
/* optionales "chapter"-Feld zur Kapitel-Eingrenzung.                  */
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
// wenn kein Kapitel mit diesem Titel existiert.
function findChapter(lines, chapterHeading) {
  const t = normHead(chapterHeading);
  if (!t) return null;
  let s = -1;
  for (let i = 0; i < lines.length; i++) {
    if (CHAPTER_RE.test(lines[i]) && normHead(lines[i]) === t) { s = i; break; }
  }
  if (s === -1) return null;
  let e = lines.length;
  for (let j = s + 1; j < lines.length; j++) {
    if (CHAPTER_RE.test(lines[j])) { e = j; break; }
  }
  return [s, e];
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

  const disp = dispHead(op.heading);
  if (!disp) return text;
  const lines = text.split("\n");

  // Optionales "chapter"-Feld (v7.14): grenzt die Suche auf den Zeilenbereich
  // EINES Kapitels ein – für mehrdeutige Abschnittsnamen (derselbe ##-Titel
  // kommt in mehreren Kapiteln vor) oder eine gezielte Kapitel-Zuordnung.
  // Fehlt das Kapitel, wird die GESAMTE Op sicher übersprungen – KEIN
  // Fallback auf die globale Suche (Ambiguitäts-Schutz, siehe DECISIONS):
  // ein append_to_section mit unbekanntem "chapter" legt in diesem Fall
  // auch NICHTS an, statt (mangels Kapitel) versehentlich global zu
  // landen. Ohne "chapter"-Feld verhält sich applyOne exakt wie vor v7.14
  // (globale Suche, erster Treffer gewinnt).
  let range = null;
  if (typeof op.chapter === "string" && op.chapter.trim()) {
    range = findChapter(lines, op.chapter);
    if (!range) return text;
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
// Die vier Op-Typen, die applyOne() tatsächlich versteht – alles andere ist
// aus Sicht DIESES Moduls ein unbekannter Typ (memory_*-Ops werden vorher in
// App.jsx#splitOps herausgefiltert und laufen nie hier durch, siehe dort).
const OP_TYPES = ["append_to_section", "replace_section", "delete_section", "rewrite"];

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
  const disp = dispHead(op.heading);
  if (!disp) return "fehlende Abschnitts-Überschrift";
  const lines = text.split("\n");
  let range = null;
  if (typeof op.chapter === "string" && op.chapter.trim()) {
    range = findChapter(lines, op.chapter);
    if (!range) return "Kapitel „" + sanitizeForWarning(dispHead(op.chapter)) + "“ nicht gefunden – Op übersprungen";
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
    const heading = op && typeof op === "object" && typeof op.heading === "string"
      ? dispHead(op.heading) || undefined
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
