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

export function applyOps(docText, ops) {
  let text = docText;
  for (const op of (ops || []).slice(0, 20)) {
    try { text = applyOne(text, op); } catch (e) { /* Op überspringen */ }
  }
  return text;
}
