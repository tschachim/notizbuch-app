/* ------------------------------------------------------------------ */
/* Verify-then-Commit-Gate (v7.54, Vorschlag B Stufe 1, DECISIONS #112) */
/* ------------------------------------------------------------------ */
/* Anlass: Vorschlag A (#106-#111) hat die IMPLIZITEN Raten-Entscheidungen  */
/* der Ops-Engine (ops.js) beseitigt - Restrisiken blieben laut #111       */
/* rewrite-Verlust (rewrite ersetzt das GESAMTE Dokument, ein "guter"     */
/* Rewrite kann trotzdem Kapitel/Bilder verlieren, ohne dass applyOne()   */
/* das je erkennen könnte - Vorher/Nachher-Vergleich ist dafür            */
/* strukturell nötig) und das Verschieben INNERHALB eines Notizbuchs      */
/* (der Cross-Notizbuch-Turn-Guard, turnGuard.js, erkennt NUR Guard-Fälle */
/* über mehrere Notizbücher hinweg - eine gescheiterte Ziel-Op UND eine   */
/* gewirkte Quell-Löschung IM SELBEN Notizbuch bleiben ungeprüft).        */
/*                                                                        */
/* Dieses Modul liegt EINE Ebene ÜBER der Engine (Leitplanke 0.1): es     */
/* mutiert NIE ein Dokument, ruft NUR applyOps()/resolveTarget()/          */
/* resolveChapterTarget()/normHead()/dispHead() (bereits exportiert, KEIN */
/* neuer ops.js-Export - Spiegelprinzip aus ops.js fortgeführt: EINE      */
/* Entscheidungsquelle für "was hat sich geändert", nicht zwei            */
/* divergierende Implementierungen der Op-Anwendung) und bewertet         */
/* AUSSCHLIESSLICH das Ergebnis (before/after-Text, angewendete Ops) -    */
/* NIE den Skip-Grund selbst (der bleibt exklusiv im bestehenden          */
/* buildOpsWarning-Kanal, kein Doppel-Feedback, Leitplanke 0.2).          */
/*                                                                        */
/* False-Positive-Disziplin (Leitplanke 0.3): "hard" (blockiert den       */
/* gesamten Turn, siehe turn.js) NUR bei einem strukturell unmöglichen    */
/* Zustand oder einem realen Duplikat-/Verlust-Vorfall; alles Heuristische*/
/* ist "soft" (ℹ️, committet trotzdem) - siehe INVARIANTEN-MATRIX in der  */
/* Spezifikation für die Kalibrierung jeder einzelnen Schwelle.           */
/* ------------------------------------------------------------------ */

import { computeFenceLineMask, matchFenceBlock, FENCE_OPEN_RE, FENCE_CLOSE_RE } from "./code.jsx";
import { parseTree } from "./markdown.jsx";
import { resolveTarget, resolveChapterTarget, normHead, dispHead, applyOps } from "./ops.js";

/* ---------------------- Konstanten (benannt, Spec 2) ------------------- */
export const V2_HARD_MIN_CHARS = 20; // Textzeilen kürzer sind nie hard
export const V2_RUN_MIN = 2; // H2/H3: Mindestlänge eines Laufs
export const V3_REWRITE_HARD_RATIO = 0.25;
export const V3_REWRITE_SOFT_RATIO = 0.10;
export const V3_REWRITE_HARD_MIN_LOST = 3; // absolutes Minimum (K-🟡5, Kleinst-Dokumente)
export const V3_CHAPTER_LOSS_RATIO = 0.5; // verlorene "#"-Zeile hard nur bei >= 50 % Kapitelinhalt-Verlust
export const CHANGED_PREFIX_LEN = 20; // rewrite: umformulierte Zeile = "geändert", nicht "verloren"
// Nacharbeit Runde 3 (🔴, K-🟡5-Nachschärfung): CHANGED_PREFIX_LEN allein
// vergleicht bisher den GLEICH LANGEN Präfix beider Seiten - bei einer VOR
// der Änderung KURZEN Zeile (< CHANGED_PREFIX_LEN) verlangte das faktisch
// GLEICHE LÄNGE auf beiden Seiten, was schon der vorausgehende Exaktvergleich
// abgedeckt hätte; jede Ergänzung an eine kurze Zeile ("- Alice" -> "- Alice
// (Lead)") zählte dadurch fälschlich als "verloren" statt "geändert" (siehe
// isChanged() unten). CHANGED_MIN_LEN schützt vor Zufallstreffern bei
// MINIMAL kurzen Zeilen (< 4 Zeichen); CHANGED_CONTAIN_MIN erlaubt
// zusätzlich Reflow (die alte Zeile steckt VOLLSTÄNDIG, aber nicht am Anfang,
// in einer neuen Zeile - z. B. zwei kurze Punkte werden zu einem Satz
// zusammengeführt).
export const CHANGED_MIN_LEN = 4;
export const CHANGED_CONTAIN_MIN = 12;
export const DIAG_MAX = 800;
export const DIAG_FRAGMENT_MAX = 160;

// Op-Typen, die den Bestand verändern/entfernen können (rewrite eingeschlossen
// - ein rewrite ERSETZT das gesamte Dokument, ist also per Definition
// destruktiv). turn.js re-exportiert diese Konstante (siehe dort) statt einer
// zweiten, potenziell abweichenden Kopie - EINE Quelle der Wahrheit für
// "destruktiv", von V2/V3 HIER und der Turn-Atomaritätsregel (turn.js) genutzt.
export const DESTRUCTIVE_OP_TYPES = new Set([
  "delete_section", "delete_entry", "delete_chapter",
  "replace_section", "replace_entry", "move_entry", "rewrite",
]);

/* ------------------------- Sanitisierung (2.4) -------------------------- */
// Zweite, unabhängige Sanitisierungs-Schicht (wie ops.js#sanitizeForWarning/
// turnGuard.js#sanitizeGuardText) - Diagnose-Fragmente betten NUTZER-/
// MODELLTEXT (Dokumentzeilen/Überschriften) in einen Satz ein, der später via
// anthropic.js in einen "[SYSTEM-HINWEIS: …]"-Rahmen wandert (B2). NUL raus,
// Whitespace-Läufe (inkl. Zeilenumbrüche) zu einem Leerzeichen, eckige
// Klammern zu runden (entschärft "]"/"[SYSTEM-HINWEIS:" strukturell), auf
// DIAG_FRAGMENT_MAX gekappt.
export function sanitizeDiagFragment(s) {
  const noNul = String(s ?? "").split("\u0000").join("");
  const collapsed = noNul.replace(/\s+/g, " ").trim();
  const bracketsSafe = collapsed.replace(/\[/g, "(").replace(/\]/g, ")");
  return bracketsSafe.length > DIAG_FRAGMENT_MAX ? bracketsSafe.slice(0, DIAG_FRAGMENT_MAX - 1) + "…" : bracketsSafe;
}

/* --------------------------- Zeilenmodell (2.1) -------------------------- */
export const normLine = (l) => String(l ?? "").replace(/\s+/g, " ").trim();
// Gemeinsame Überschriften-Normalisierung (Leitplanke 0.7): normHead() aus
// ops.js kollabiert Whitespace-LÄUFE nicht ("## A  B" bliebe zwei Leerzeichen)
// - normHeadV() tut das zusätzlich, auf BEIDEN Vergleichsseiten (Whitelist
// UND Dokumentzeilen), damit ein doppeltes Leerzeichen im Modelltext nie ein
// Fehlalarm auslöst.
export const normHeadV = (s) => normHead(s).replace(/\s+/g, " ");

// Listenmarker/Checkbox-Präfix abstreifen (Nacharbeit Runde 2, 🔵 K-🟡5-
// Zusatz): der V3-R-"geändert"-Vergleich (CHANGED_PREFIX_LEN) verglich bisher
// den ROHEN normLine-Präfix inkl. Marker - ein rewrite, das nur "- " in
// "1. " umformatiert oder "- [ ]" in "- [x]" abhakt, verschob dadurch jeden
// Zeilenanfang und zählte reine Markerwechsel fälschlich als "verloren"
// statt "geändert". Nur für den PRÄFIX-Vergleich genutzt, NICHT für den
// vorausgehenden Exaktvergleich (Multiset-/Duplikat-Logik bleibt stabil).
const LIST_MARKER_RE = /^([-*+]|\d+[.)])\s+(\[[ xX]\]\s*)?/;
const stripMarker = (l) => l.replace(LIST_MARKER_RE, "");

const IMAGE_RE = /!\[[^\]]*\]\([^)]+\)/;
const TABLE_SEP_RE = /^\|?\s*:?-{3,}/;
const HR_RE = /^(-{3,}|\*{3,}|_{3,})$/;
const BARE_BULLET_RE = /^[-*+]\s*(\[[ xX]\])?\s*$/;
const BOUNDARY_RE = /^#{1,2}\s/;

const isImageLine = (l) => IMAGE_RE.test(l);
const isTableSep = (l) => TABLE_SEP_RE.test(l);
const isHr = (l) => HR_RE.test(l);
const isBareBullet = (l) => BARE_BULLET_RE.test(l);
const isFenceLineRaw = (l) => FENCE_OPEN_RE.test(l) || FENCE_CLOSE_RE.test(l);

function titleOf(text) {
  const lines = String(text ?? "").split("\n");
  const idx = lines.findIndex((l) => l.trim() !== "");
  return idx !== -1 && /^#\s+/.test(lines[idx]) ? dispHead(lines[idx]) : null;
}
// Rohe Titelzeile (MIT führendem "#") - für den exakten V3-R-Zeilenvergleich
// gegen die normalisierten "after"-Volltextzeilen (normLine() behält das "#"
// bei, anders als dispHead()/titleOf() oben, die es für Namensvergleiche
// abstreifen). Getrennter Helfer statt Wiederverwendung von titleOf(), weil
// beide Vergleichsarten (Name vs. Volltextzeile) unterschiedliche Werte
// brauchen.
function titleLineRaw(text) {
  const lines = String(text ?? "").split("\n");
  const idx = lines.findIndex((l) => l.trim() !== "");
  return idx !== -1 && /^#\s+/.test(lines[idx]) ? lines[idx] : null;
}

// Container-Zuordnung (2.1) über parseTree(): "pre" für Vorspann, "ch:<name>"
// für Kapitel-FREITEXT (Zeilen direkt unter einer "#"-Kapitelzeile, vor dem
// ersten "##"), "sec:<kapitel>/<abschnitt>" für Abschnittszeilen inkl.
// subs[].lines. Namensbasiert (normHeadV), NICHT positionsbasiert - before/
// after haben unterschiedliche Zeilenindizes, aber derselbe Kapitel-/
// Abschnittsname muss auf denselben Container-Schlüssel abbilden, damit ein
// "im selben Container bereits vorhanden"-Vergleich über beide Textstände
// hinweg funktioniert. "label" hält zusätzlich einen ANZEIGE-String (Original-
// Groß-/Kleinschreibung) je Zeilenindex für die Diagnose-Texte.
function buildContainers(text) {
  const lines = String(text ?? "").split("\n");
  const tree = parseTree(text ?? "");
  const map = new Map(); // idx -> key
  const label = new Map(); // idx -> Anzeige-String
  (tree.pre || []).forEach(({ idx }) => { map.set(idx, "pre"); label.set(idx, "Vorspann"); });
  (tree.chapters || []).forEach((ch) => {
    const key = "ch:" + normHeadV(ch.title || "");
    const disp = "Kapitel-Freitext „" + (ch.title || "") + "“";
    (ch.lines || []).forEach(({ idx }) => { map.set(idx, key); label.set(idx, disp); });
  });
  (tree.sections || []).forEach((sec) => {
    const chTitle = sec.chapter >= 0 && tree.chapters[sec.chapter] ? tree.chapters[sec.chapter].title : null;
    const key = "sec:" + normHeadV(chTitle || "") + "/" + normHeadV(sec.title || "");
    const disp = "„" + (sec.title || "") + "“";
    (sec.lines || []).forEach(({ idx }) => { map.set(idx, key); label.set(idx, disp); });
    (sec.subs || []).forEach((sub) => (sub.lines || []).forEach(({ idx }) => { map.set(idx, key); label.set(idx, disp); }));
  });
  return { map, label, lines, tree };
}

// Je Container die geordnete Liste normalisierter Zeilen (Leerzeilen/
// Struktur-Zeilen übersprungen - Struktur-Zeilen sind per buildContainers()
// bereits ausgeschlossen, weil parseTree sie nicht in "lines" führt). Dient
// H2/H3 als Grundlage für den "kommt dieselbe Folge bereits konsekutiv im
// selben/einem anderen Container vor"-Vergleich.
function containerSequences({ map, lines }) {
  const seq = new Map();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    const key = map.get(i);
    if (key === undefined) continue;
    if (!seq.has(key)) seq.set(key, []);
    seq.get(key).push(normLine(lines[i]));
  }
  return seq;
}

function containsConsecutive(haystack, needle) {
  if (!needle.length || !haystack || haystack.length < needle.length) return false;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

// Sucht das LÄNGSTE zusammenhängende Teilfenster von "run" (Startindex +
// Länge), das als Ganzes konsekutiv in "haystack" vorkommt - siehe H2/H3-
// Kommentar oben (ein maximaler Duplikat-Lauf kann zwei aneinandergrenzende
// Kopien desselben kürzeren Originalblocks sein; nur DIESER Block muss in
// "before" konsekutiv nachweisbar sein, nicht der gesamte, verdoppelte Lauf).
function longestMatchingWindow(run, haystack) {
  if (!haystack || !haystack.length) return null;
  let best = null;
  for (let start = 0; start < run.length; start++) {
    for (let len = run.length - start; len >= 1; len--) {
      if (best && len <= best.len) break; // kürzer als das bisherige Optimum lohnt nicht mehr
      const window = run.slice(start, start + len);
      if (containsConsecutive(haystack, window)) {
        best = { start, len };
        break;
      }
    }
  }
  return best;
}

function countNonEmpty(lines) {
  const map = new Map();
  for (const l of lines) {
    if (l.trim() === "") continue;
    const key = normLine(l);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}
function countRanges(lines, ranges) {
  const map = new Map();
  for (const r of ranges || []) {
    if (!r) continue;
    const [s, e] = r;
    for (let i = s; i < e && i < lines.length; i++) {
      if (lines[i].trim() === "") continue;
      const key = normLine(lines[i]);
      map.set(key, (map.get(key) || 0) + 1);
    }
  }
  return map;
}

/* -------------------- Erlaubter Verlust, inkrementell (2.2) ------------- */
const ENTRY_BOUNDARY_RE = /^#{1,2}\s/;

// Lokale Entsprechung von ops.js#entryBlockRange (nicht exportiert) - EIGENE,
// rein lesende Kopie statt eines neuen ops.js-Exports (Leitplanke 0.1): der
// Trefferblock (Trefferzeile + stärker eingerückte Kinder, geschlossene
// Fences atomar) grenzt den ERLAUBTEN Verlustbereich für delete_entry/
// replace_entry/move_entry ein.
function localEntryBlockRange(lines, hitIdx, mask) {
  const indentOf = (l) => l.length - l.trimStart().length;
  const baseIndent = indentOf(lines[hitIdx]);
  let end = hitIdx + 1;
  while (end < lines.length) {
    if (mask[end]) {
      if (indentOf(lines[end]) <= baseIndent) break;
      const block = matchFenceBlock(lines, end);
      if (!block) break;
      end = block.endIdx + 1;
      continue;
    }
    const l = lines[end];
    if (l.trim() === "" || indentOf(l) <= baseIndent) break;
    end++;
  }
  return [hitIdx, end];
}

// Zweistufiges Matching WIE ops.js#findEntryLines, aber als VEREINIGUNG
// beider Stufen (Spec 2.2: "echte Obermenge der Engine-Wahl") statt "Stufe 2
// nur wenn Stufe 1 leer" - der erlaubte Verlustbereich darf ruhig GRÖSSER
// sein als das, was die Engine tatsächlich getroffen hat (harmlos, vermeidet
// einen Fehlalarm, falls ein künftiger Engine-Umbau die Stufen-Priorität
// ändert), NIE kleiner.
function collectEntryMatches(lines, range, entryText, mask) {
  const needleExact = normLine(entryText);
  if (!needleExact || !range) return [];
  const needleLower = needleExact.toLowerCase();
  const hits = [];
  for (let i = range[0]; i < range[1] && i < lines.length; i++) {
    if (mask[i]) continue;
    if (ENTRY_BOUNDARY_RE.test(lines[i])) continue;
    const nl = normLine(lines[i]);
    if (!nl) continue;
    if (nl === needleExact || nl.toLowerCase().includes(needleLower)) hits.push(i);
  }
  return hits;
}

// Scope-Ermittlung WIE DIE ENGINE (K-🔴2, entryScope() in ops.js): heading
// (bzw. from_heading) gesetzt -> resolveTarget(); nur chapter ->
// resolveChapterTarget(); beides leer -> ganzes Dokument.
function computeEntryScope(prevLines, heading, chapter) {
  const headingDisp = dispHead(heading);
  if (headingDisp) {
    const target = resolveTarget(prevLines, { heading, chapter, chapterFieldName: "chapter", opType: "entry" });
    if (target.status === "found" && target.sectionRange) return target.sectionRange;
    if (target.status === "collision" && target.collisionRange) return target.collisionRange;
    return null;
  }
  const chapterDisp = dispHead(chapter);
  if (chapterDisp) {
    const cr = resolveChapterTarget(prevLines, chapter, {});
    if (cr.status === "found" && cr.range) return cr.range;
    if (cr.status === "title") return cr.titleScope === "preamble" ? cr.preambleRange : [0, prevLines.length];
    return null;
  }
  return [0, prevLines.length];
}

// Erlaubter Verlustbereich EINER Op auf ihrem Zwischenstand "prevLines" (2.2).
function allowedRangesFor(op, prevLines) {
  if (!op || typeof op !== "object") return [];
  const type = op.type;
  if (type === "replace_section" || type === "delete_section") {
    const target = resolveTarget(prevLines, {
      heading: op.heading, chapter: op.chapter, chapterFieldName: "chapter",
      opType: type === "delete_section" ? "delete" : "write",
    });
    if (target.status === "found" && target.sectionRange) return [target.sectionRange];
    if (target.status === "collision" && target.collisionRange) return [target.collisionRange];
    return [];
  }
  if (type === "delete_chapter") {
    const hasChapter = typeof op.chapter === "string" && op.chapter.trim();
    const fieldValue = hasChapter ? op.chapter : (typeof op.heading === "string" ? op.heading : "");
    const cr = resolveChapterTarget(prevLines, fieldValue, { opType: "delete_chapter", usedHeadingFallback: !hasChapter });
    if (cr.status === "found" && cr.range) return [cr.range];
    return [];
  }
  if (type === "delete_entry" || type === "replace_entry") {
    const scope = computeEntryScope(prevLines, op.heading, op.chapter);
    if (!scope) return [];
    const mask = computeFenceLineMask(prevLines);
    return collectEntryMatches(prevLines, scope, op.entry, mask).map((h) => localEntryBlockRange(prevLines, h, mask));
  }
  if (type === "move_entry") {
    const scope = computeEntryScope(prevLines, op.from_heading, op.from_chapter);
    if (!scope) return [];
    const mask = computeFenceLineMask(prevLines);
    return collectEntryMatches(prevLines, scope, op.entry, mask).map((h) => localEntryBlockRange(prevLines, h, mask));
  }
  return []; // append_*/rewrite: nichts erlaubt (rewrite läuft über V3-R)
}

// Inkrementeller Verlust-Rechner (K-🔴1/K-🔴2): für jede Op i wird der
// Zwischenstand VOR (prev) und NACH (cur) GENAU dieser Op über den
// byte-identischen applyOps()-Wrapper neu berechnet - keine Neuimplementierung
// der Engine, keine Kettung über einen selbst mitgeführten Zwischenstand
// (n <= MAX_OPS, Kosten vernachlässigbar). "unexplained" listet jede
// Zeilen-Textvariante, deren Verlust NICHT durch den erlaubten Bereich der
// jeweiligen Op gedeckt ist.
export function computeLoss(before, ops) {
  const list = Array.isArray(ops) ? ops : [];
  const beforeText = typeof before === "string" ? before : "";
  const unexplained = [];
  for (let i = 0; i < list.length; i++) {
    const op = list[i];
    if (!op || typeof op !== "object" || op.type === "rewrite") continue; // V3-R übernimmt rewrite separat
    let prevText, curText;
    try {
      prevText = applyOps(beforeText, list.slice(0, i));
      curText = applyOps(beforeText, list.slice(0, i + 1));
    } catch {
      continue;
    }
    if (prevText === curText) continue;
    const prevLines = prevText.split("\n");
    const curLines = curText.split("\n");
    const prevCounts = countNonEmpty(prevLines);
    const curCounts = countNonEmpty(curLines);
    let allowedRanges = [];
    try { allowedRanges = allowedRangesFor(op, prevLines); } catch { allowedRanges = []; }
    const allowedCounts = countRanges(prevLines, allowedRanges);
    for (const [key, pc] of prevCounts) {
      const cc = curCounts.get(key) || 0;
      const lost = pc - cc;
      if (lost <= 0) continue;
      const allowed = allowedCounts.get(key) || 0;
      const rest = lost - allowed;
      if (rest > 0) {
        unexplained.push({
          text: key, count: rest, opIndex: i, type: op.type,
          heading: dispHead(op.heading || op.chapter || op.entry || ""),
        });
      }
    }
  }
  return unexplained;
}

/* ------------------------------- V1 ------------------------------------- */
function buildV1(before, after) {
  const beforeTree = parseTree(before);
  const afterTree = parseTree(after);
  const out = [];
  (afterTree.sections || []).forEach((sec) => {
    if (sec.chapter < 0 || !sec.title) return;
    const chapter = afterTree.chapters[sec.chapter];
    if (!chapter || !chapter.title) return;
    if (normHeadV(sec.title) !== normHeadV(chapter.title)) return;
    const existedBefore = (beforeTree.chapters || []).some((c, ci) =>
      normHeadV(c.title || "") === normHeadV(chapter.title) &&
      (beforeTree.sections || []).some((s) => s.chapter === ci && normHeadV(s.title || "") === normHeadV(sec.title))
    );
    if (existedBefore) return;
    out.push({
      code: "V1", severity: "hard",
      text: sanitizeDiagFragment('„## ' + sec.title + '“ würde direkt unter „# ' + chapter.title + '“ entstehen (Kapitelnamen-Duplikat)'),
    });
  });
  return out;
}

// Zeilen-Zählung PRO CONTAINER ZUSAETZLICH zur globalen Zählung (Spec 2.3
// verlangt count_after(L) > count_before(L) >= 1 GLOBAL; die Pro-Container-
// Zählung ist eine zusaetzliche, eigene Verschärfung, die daraus die
// richtige Vorkommensstelle auswaehlt): eine unverändert im selben
// Container stehen gebliebene Zeile darf NIE als "Duplikat" gelten, nur
// weil ihr Text an ANDERER Stelle im Dokument NEU hinzukam
// (False-Positive-Disziplin, Leitplanke 0.3 - siehe die explizite
// Checklisten-Vorlage-Testvorgabe in Spec 8.1: derselbe 3-zeilige Block in
// einem NEUEN Abschnitt darf NICHT hart werden, obwohl die REIN GLOBALE
// Zählung ihn faelschlich auch am unveraenderten Ursprungsort als
// "gestiegen" auswiese). Umgekehrt darf ein reines VERSCHIEBEN (Quelle weg,
// Ziel neu, z. B. move_entry oder append_to_section+delete_entry) NIE als
// Duplikat gelten, weil die GLOBALE Zählung dabei nicht steigt (die Zeile
// existiert nach der Op weiterhin genau einmal im Dokument) - deshalb ist
// "acGlobal > bc" (nicht nur "bc >= 1") verbindlicher Teil der Kandidatur.
function containerCounts({ map, lines }) {
  const counts = new Map();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    const c = map.get(i);
    if (c === undefined) continue;
    if (!counts.has(c)) counts.set(c, new Map());
    const m = counts.get(c);
    const key = normLine(lines[i]);
    m.set(key, (m.get(key) || 0) + 1);
  }
  return counts;
}

/* --------------------------------- V2 ------------------------------------ */
// H3 (Nacharbeit Runde 2, 🟡): "Vollkopie in einem ANDEREN Container" darf
// nur hart werden, wenn die Gruppe eine destruktive SCHREIB-Op enthält, die
// den kopierten Lauf selbst hätte ERSETZEN/VERÄNDERN können (replace_section/
// replace_entry/rewrite) - Spec-Invariantenmatrix H3 nennt ausdrücklich die
// bewusste Vorlagen-Kopie per append als soft. Eine reine Lösch-/Verschiebe-
// Op (delete_*/move_entry) IRGENDWO ANDERS in derselben Gruppe (z. B.
// "Checkliste für KW 38 anlegen UND den erledigten Punkt aus der Inbox
// streichen") macht aus einem append_to_section-Kopiervorgang KEINE
// "Vollkopie statt Änderung" - beide Vorgänge sind fachlich unabhängig.
// H1 (Bild) bleibt bewusst bei "hasDestructive" (kein bekannter legitimer
// Fall, siehe Spec "Offen").
const V2H3_WRITE_DESTRUCTIVE = new Set(["replace_section", "replace_entry", "rewrite"]);

function buildV2(before, after, ops) {
  const hasDestructive = ops.some((o) => o && DESTRUCTIVE_OP_TYPES.has(o.type));
  const hasDestructiveWrite = ops.some((o) => o && V2H3_WRITE_DESTRUCTIVE.has(o.type));
  const afterC = buildContainers(after);
  const beforeC = buildContainers(before);
  const beforeSeq = containerSequences(beforeC);
  const beforeCounts = countNonEmpty(before.split("\n"));
  const afterCounts = countNonEmpty(afterC.lines);
  const afterMask = computeFenceLineMask(afterC.lines);
  const beforeContainerCounts = containerCounts(beforeC);
  const afterContainerCounts = containerCounts(afterC);

  const isCandidate = (i) => {
    if (afterMask[i]) return false;
    const raw = afterC.lines[i];
    if (raw.trim() === "") return false;
    if (isTableSep(raw) || isHr(raw) || isBareBullet(raw) || isFenceLineRaw(raw)) return false;
    if (raw.trim().startsWith("|")) return false;
    if (afterC.map.get(i) === undefined) return false; // Struktur-/Titelzeile
    return true;
  };
  const isDup = (i) => {
    if (!isCandidate(i)) return false;
    const key = normLine(afterC.lines[i]);
    const bc = beforeCounts.get(key) || 0; // global: die Zeile muss vor der Op(s)-Anwendung IRGENDWO existiert haben
    const ac = afterCounts.get(key) || 0;
    // Spec 2.3: count_after(L) > count_before(L) >= 1 GLOBAL - ein reines
    // Verschieben (Quelle weg, Ziel neu) erhöht die globale Zählung NICHT
    // und ist damit NIE ein Duplikat, egal wie die Pro-Container-Zählung
    // aussieht (sonst False-Positive HARD bei move_entry/Verschiebe-Mustern).
    if (bc < 1 || ac <= bc) return false;
    const container = afterC.map.get(i);
    const bcContainer = (beforeContainerCounts.get(container) || new Map()).get(key) || 0;
    const acContainer = (afterContainerCounts.get(container) || new Map()).get(key) || 0;
    return acContainer > bcContainer; // wählt unter den global gestiegenen Vorkommen den richtigen Container aus
  };
  const labelFor = (i) => afterC.label.get(i) || "Dokument";

  // Nacharbeit Runde 3 (🔵, Trainingslog/Standup-Muster): ein Resend, der
  // NUR aus bereits (global) vorhandenen Zeilen besteht, bleibt ein
  // H2-Hard-Duplikat. Enthält der betroffene Container in "after" aber
  // MINDESTENS eine GENUIN NEUE Zeile (vorher nirgends im Dokument
  // vorhanden, keine Struktur-/Tabellen-/Trenn-/Leer-Bullet-Zeile), ist das
  // typischerweise eine neue Datumszeile über einer wiederkehrenden
  // Übungs-/Punkte-Vorlage - kein reines Resend, sondern ein echter neuer
  // Eintrag mit wiederkehrendem Inhalt (siehe H2-Definition unten).
  const containerHasGenuineNewLine = (container) => {
    for (let i = 0; i < afterC.lines.length; i++) {
      if (afterMask[i] || afterC.map.get(i) !== container) continue;
      const raw = afterC.lines[i];
      if (raw.trim() === "" || isTableSep(raw) || isHr(raw) || isBareBullet(raw)) continue;
      if ((beforeCounts.get(normLine(raw)) || 0) === 0) return true;
    }
    return false;
  };

  const hard = [];
  const soft = [];
  const handledIdx = new Set();
  const reportedHardKeys = new Set();
  const reportedSoftKeys = new Set();

  // H1: Bildzeilen
  for (let i = 0; i < afterC.lines.length; i++) {
    if (!isDup(i) || !isImageLine(afterC.lines[i])) continue;
    const key = normLine(afterC.lines[i]);
    const container = afterC.map.get(i);
    let sameContainerCount = 0;
    for (let j = 0; j < afterC.lines.length; j++) {
      if (afterC.map.get(j) === container && normLine(afterC.lines[j]) === key) sameContainerCount++;
    }
    const isHard = hasDestructive || sameContainerCount >= 2;
    handledIdx.add(i);
    if (isHard) {
      const rk = "V2H1:" + key;
      if (!reportedHardKeys.has(rk)) {
        reportedHardKeys.add(rk);
        hard.push({ code: "V2", severity: "hard", text: sanitizeDiagFragment('Bild „' + key + '“ stünde danach doppelt in ' + labelFor(i)) });
      }
    } else {
      const rk = "img:" + key + ":" + container;
      if (!reportedSoftKeys.has(rk)) {
        reportedSoftKeys.add(rk);
        soft.push({ code: "V2", severity: "soft", text: sanitizeDiagFragment('Prüfhinweis: Zeile „' + key + '“ ist bereits in ' + labelFor(i) + ' vorhanden') });
      }
    }
  }

  // H2/H3: Läufe >= V2_RUN_MIN
  const runs = [];
  let run = [];
  const flush = () => { if (run.length >= V2_RUN_MIN) runs.push(run.slice()); run = []; };
  for (let i = 0; i < afterC.lines.length; i++) {
    const raw = afterC.lines[i];
    if (raw.trim() === "") continue; // Leerzeilen überspringen, brechen einen Lauf nicht
    const qualifies = isDup(i) && !handledIdx.has(i) && normLine(raw).length >= V2_HARD_MIN_CHARS;
    if (qualifies) {
      if (run.length && afterC.map.get(run[run.length - 1]) !== afterC.map.get(i)) flush();
      run.push(i);
    } else {
      flush();
    }
  }
  flush();

  for (const r of runs) {
    const container = afterC.map.get(r[0]);
    const seq = r.map((i) => normLine(afterC.lines[i]));
    // Ein maximaler Lauf kann ZWEI unmittelbar aneinandergrenzende Kopien
    // desselben (kürzeren) Blocks umfassen (Resend direkt hinter dem
    // Original, ohne Leerzeile dazwischen - der häufigste Live-Fall,
    // DECISIONS #106 T2/#103-2) - der Vergleich sucht deshalb das LÄNGSTE
    // zusammenhängende TEILFENSTER des Laufs, das in before konsekutiv
    // vorkommt, statt zwingend den GESAMTEN (verdoppelten) Lauf zu verlangen.
    const sameWindow = longestMatchingWindow(seq, beforeSeq.get(container) || []);
    let otherWindow = null;
    if (!sameWindow || sameWindow.len < V2_RUN_MIN) {
      for (const [k, arr] of beforeSeq) {
        if (k === container) continue;
        const w = longestMatchingWindow(seq, arr);
        if (w && w.len >= V2_RUN_MIN && (!otherWindow || w.len > otherWindow.len)) otherWindow = w;
      }
    }
    r.forEach((i) => handledIdx.add(i));
    if (sameWindow && sameWindow.len >= V2_RUN_MIN) {
      // Dedup wie H1 (reportedHardKeys, K-🔵4): zwei Kopien DESSELBEN Laufs im
      // selben Container (Original + Resend) dürfen NICHT zweimal denselben
      // Satz in die Pille schreiben.
      const w = sameWindow;
      const rk = "V2RUN:" + seq.slice(w.start, w.start + w.len).join("|") + ":" + container;
      const first = seq[w.start];
      // Nacharbeit Runde 3 (🔵): Resend MIT mindestens einer genuin neuen
      // Zeile im selben Container (Trainingslog mit neuer Datumszeile) bleibt
      // soft, nicht hard - siehe containerHasGenuineNewLine() oben.
      if (containerHasGenuineNewLine(container)) {
        if (!reportedSoftKeys.has(rk)) {
          reportedSoftKeys.add(rk);
          soft.push({
            code: "V2", severity: "soft",
            text: sanitizeDiagFragment('Prüfhinweis: Block aus ' + w.len + ' Zeilen steht bereits in ' + labelFor(r[0]) + ' („' + first + '“ …) – erneut gesendet'),
          });
        }
      } else if (!reportedHardKeys.has(rk)) {
        reportedHardKeys.add(rk);
        hard.push({
          code: "V2", severity: "hard",
          text: sanitizeDiagFragment('Block aus ' + w.len + ' Zeilen steht bereits in ' + labelFor(r[0]) + ' („' + first + '“ …) – erneut gesendet'),
        });
      }
    } else if (otherWindow && hasDestructiveWrite) {
      const w = otherWindow;
      const rk = "V2RUN:" + seq.slice(w.start, w.start + w.len).join("|") + ":" + container;
      if (!reportedHardKeys.has(rk)) {
        reportedHardKeys.add(rk);
        const first = seq[w.start];
        hard.push({
          code: "V2", severity: "hard",
          text: sanitizeDiagFragment('Block aus ' + w.len + ' Zeilen bereits vorhanden in ' + labelFor(r[0]) + ' („' + first + '“ …) – Vollkopie statt Änderung'),
        });
      }
    } else {
      const rk = "run:" + seq.join("|") + ":" + container;
      if (!reportedSoftKeys.has(rk)) {
        reportedSoftKeys.add(rk);
        soft.push({ code: "V2", severity: "soft", text: sanitizeDiagFragment('Prüfhinweis: Zeile „' + seq[0] + '“ ist bereits in ' + labelFor(r[0]) + ' vorhanden') });
      }
    }
  }

  // Restliche Einzelzeilen-Duplikate -> soft
  for (let i = 0; i < afterC.lines.length; i++) {
    if (!isDup(i) || handledIdx.has(i)) continue;
    const key = normLine(afterC.lines[i]);
    const container = afterC.map.get(i);
    const rk = "single:" + key + ":" + container;
    if (reportedSoftKeys.has(rk)) continue;
    reportedSoftKeys.add(rk);
    soft.push({ code: "V2", severity: "soft", text: sanitizeDiagFragment('Prüfhinweis: Zeile „' + key + '“ ist bereits in ' + labelFor(i) + ' vorhanden') });
  }

  return { hard, soft };
}

/* -------------------------------- V3 ------------------------------------- */
function buildV3NonRewrite(before, ops) {
  const unexplained = computeLoss(before, ops);
  if (!unexplained.length) return [];
  const hasDestructive = ops.some((o) => o && DESTRUCTIVE_OP_TYPES.has(o.type));
  const total = unexplained.reduce((s, u) => s + u.count, 0);
  const first = unexplained[0];
  const headingPart = first.heading ? ' „' + sanitizeDiagFragment(first.heading) + '“' : "";
  const sample = sanitizeDiagFragment(first.text);
  const text = hasDestructive
    ? total + ' Zeile(n) außerhalb des adressierten Bereichs von Op #' + first.opIndex + ' ' + first.type + headingPart + ' würden verschwinden, z. B. „' + sample + '“'
    : total + ' bestehende Zeile(n) würden ohne Lösch-Op verschwinden (Op #' + first.opIndex + ' ' + first.type + headingPart + '), z. B. „' + sample + '“';
  return [{ code: "V3", severity: "hard", text: sanitizeDiagFragment(text), sample, count: total, opIndex: first.opIndex }];
}

// V3-R (rewrite-Ratio, K-🟡5): "lost" = before-Zeilen, die in after weder
// exakt (Multiset) noch als "geändert" (gleiches normLine-Präfix, greedy,
// noch nicht zugeordnet) vorkommen.
//
// Nacharbeit Runde 2 (🔴): Überschriftszeilen (#/##/###) fließen NICHT in
// die Ratio ein - Spec 2.3 sagt wörtlich "Umgliederung ohne Verlust →
// ratio 0" und behandelt eine verschwundene "#"/"##"-Zeile über eigene,
// separate Regeln (titleLost/chapterHardHit/chapterSoftHit/sectionSoftHit
// weiter unten, jeweils SOFT außer bei echtem Titel-/≥50%-Kapitelverlust).
// Zählten Überschriften mit, erreichte schon ein Zusammenlegen/Umbenennen
// von drei Abschnitten in einem kleinen Dokument die HARD-Schwelle, obwohl
// jede Inhaltszeile erhalten blieb (False Positive) - die "geändert"-
// Präfix-Heuristik (Z. 599-603 alt) griff bei kurzen Überschriften ohnehin
// nicht zuverlässig. Fenced-Codeblöcke bleiben ausgenommen (computeFenceLineMask):
// eine "#"-Zeile INNERHALB eines Codezauns ist Nutzinhalt, keine Struktur.
function buildV3R(before, after) {
  const HEADING_RE = /^#{1,3}\s/;
  const beforeAll = before.split("\n");
  const beforeMaskAll = computeFenceLineMask(beforeAll);
  const afterAll = after.split("\n");
  const afterMaskAll = computeFenceLineMask(afterAll);
  const isContentLine = (l, i, mask) => l.trim() !== "" && !(!mask[i] && HEADING_RE.test(l));
  const beforeLines = beforeAll.filter((l, i) => isContentLine(l, i, beforeMaskAll));
  const afterLines = afterAll.filter((l, i) => isContentLine(l, i, afterMaskAll));
  const beforeNorm = beforeLines.map(normLine);
  const afterNorm = afterLines.map(normLine);
  // Titelvergleich braucht ALLE after-Zeilen (auch Überschriften) - die
  // Titelzeile selbst ist eine Überschrift und würde sonst nie gefunden.
  const afterNormAll = afterAll.map(normLine);
  const afterUsed = new Array(afterNorm.length).fill(false);
  const beforeMatched = new Array(beforeNorm.length).fill(false);
  // Nacharbeit Runde 5 (🟡 N3, Review-Fund): "afterExact" merkt sich
  // zusätzlich zu "afterUsed", WELCHE after-Zeilen bereits EXAKT (Multiset)
  // einer before-Zeile zugeordnet wurden - siehe der Enthaltensein-Fallback
  // weiter unten (Z. ~725), der genau diese Markierung braucht.
  const afterExact = new Array(afterNorm.length).fill(false);

  for (let i = 0; i < beforeNorm.length; i++) {
    const idx = afterNorm.findIndex((l, j) => !afterUsed[j] && l === beforeNorm[i]);
    if (idx !== -1) { afterUsed[idx] = true; afterExact[idx] = true; beforeMatched[i] = true; }
  }
  // Nacharbeit Runde 3 (🔴): "geändert" = die after-Zeile beginnt mit den
  // ERSTEN n Zeichen der before-Zeile, wobei n = min(CHANGED_PREFIX_LEN,
  // Länge der before-Zeile) - NICHT mehr ein FEST 20 Zeichen langer
  // Vergleich beider Seiten (der bei einer kürzeren before-Zeile faktisch
  // Gleichlänge verlangte und damit nur Fälle traf, die der vorausgehende
  // Exaktvergleich ohnehin schon gefangen hätte). Reflow-Fall (die alte
  // Zeile steckt VOLLSTÄNDIG, aber nicht am Anfang, in der neuen Zeile):
  // zusätzlich per Enthaltensein, nur ab CHANGED_CONTAIN_MIN Zeichen (gegen
  // Zufallstreffer bei sehr kurzen Zeilen).
  const isChanged = (b, a) => {
    const n = Math.min(CHANGED_PREFIX_LEN, b.length);
    if (n < CHANGED_MIN_LEN) return false;
    if (a.slice(0, n) === b.slice(0, n)) return true;
    return b.length >= CHANGED_CONTAIN_MIN && a.includes(b);
  };
  // Nacharbeit Runde 4 (🟡 Finding A): ein ECHTER Reflow (ZWEI before-Zeilen
  // werden zu EINER after-Zeile zusammengeführt) blieb bisher hart, obwohl
  // beide Hälften textlich vollständig erhalten sind. Grund: die ERSTE
  // Hälfte matcht die zusammengeführte after-Zeile typischerweise per
  // PRÄFIX (sie steht am Anfang der neuen Zeile) und belegt deren Index in
  // "afterUsed" - die ZWEITE Hälfte (steckt weiter hinten in derselben
  // after-Zeile) findet danach unter den noch UNBENUTZTEN after-Zeilen
  // keinen Treffer mehr, der Enthaltensein-Fallback griff nie, weil er nur
  // innerhalb desselben findIndex()-Laufs (also ebenfalls nur gegen
  // unbenutzte Zeilen) geprüft wurde. Fix: bleibt der reguläre Lauf ohne
  // Treffer, prüft ein ZWEITER, von "afterUsed" UNABHÄNGIGER Enthaltensein-
  // Check (bewusst OHNE afterUsed[idx]=true - mehrere before-Hälften dürfen
  // dieselbe zusammengeführte after-Zeile als "geändert" beanspruchen, das
  // ist bei einem Merge sogar der Regelfall). Restrisiko: eine Hälfte KÜRZER
  // als CHANGED_CONTAIN_MIN (12 Zeichen) zählt weiterhin als "verloren" -
  // bewusst (Zufallstreffer-Schutz, siehe CHANGED_CONTAIN_MIN-Kommentar
  // oben), DECISIONS #112.
  //
  // Nacharbeit Runde 5 (🟡 N3, Review-Fund): der "afterUsed"-UNABHÄNGIGE
  // Enthaltensein-Fallback (Runde 4) prüfte bisher gegen ALLE after-Zeilen,
  // auch solche, die BEREITS per EXAKTEM Multiset-Treffer einer ANDEREN
  // before-Zeile zugeordnet waren - eine echt VERLORENE before-Zeile, deren
  // Text zufällig als SUFFIX in einer exakt erhaltenen ANDEREN Zeile steckt
  // (z. B. "- Beta Gamma Delta Epsilon Zeta" verschwindet, "- Alpha Beta
  // Gamma Delta Epsilon Zeta" bleibt unverändert stehen), wurde dadurch
  // fälschlich als "geändert/gematcht" statt als verloren gezählt - bei 3
  // von 10 Zeilen blieb der rewrite dadurch KOMPLETT still (hard [], soft
  // []), obwohl vor Runde 4 derselbe Verlust hart durchgeschlagen wäre. Der
  // Reflow-Fix aus Runde 4 selbst bleibt davon unberührt: eine ZUSAMMENGEFÜHRTE
  // after-Zeile (Merge-Ziel) ist per Definition eine NEUE Zeile, die NIE per
  // EXAKTEM Vergleich zu einer before-Zeile passt, landet also nie in
  // "afterExact" - der Fallback bleibt für sie weiterhin offen. Fix: der
  // Fallback prüft nur noch after-Zeilen, die NICHT bereits im Exakt-Lauf
  // (Z. ~683) verbraucht wurden ("afterExact"), NICHT "afterUsed" (das würde
  // wieder die Runde-4-Regression reproduzieren, da der Reflow-Fallback
  // selbst KEIN afterUsed setzt). Restrisiko: eine before-Zeile, die
  // zufällig Suffix einer NICHT exakt erhaltenen, aber per "geändert"
  // umformulierten after-Zeile ist, kann weiterhin fälschlich matchen - das
  // ist der bereits dokumentierte, bewusste CHANGED_CONTAIN_MIN-Kompromiss
  // (Zufallstreffer-Schutz erst ab 12 Zeichen, keine perfekte Eindeutigkeit).
  for (let i = 0; i < beforeNorm.length; i++) {
    if (beforeMatched[i]) continue;
    // Nacharbeit Runde 2 (🔵): Listenmarker/Checkbox NICHT Teil des
    // "geändert"-Vergleichs (reiner Markerwechsel ist keine Zeile, die
    // "verloren" geht) - siehe stripMarker()-Kommentar oben.
    const b = stripMarker(beforeNorm[i]);
    if (!b) continue;
    const idx = afterNorm.findIndex((l, j) => !afterUsed[j] && isChanged(b, stripMarker(l)));
    if (idx !== -1) { afterUsed[idx] = true; beforeMatched[i] = true; continue; }
    if (b.length >= CHANGED_CONTAIN_MIN && afterNorm.some((l, j) => !afterExact[j] && stripMarker(l).includes(b))) beforeMatched[i] = true;
  }

  const lostIdx = [];
  for (let i = 0; i < beforeNorm.length; i++) if (!beforeMatched[i]) lostIdx.push(i);
  const lost = lostIdx.length;
  const total = beforeNorm.length || 1;
  const ratio = lost / total;

  const titleBeforeRaw = titleLineRaw(before);
  const titleBefore = titleOf(before);
  const titleLost = titleBeforeRaw !== null && !afterNormAll.includes(normLine(titleBeforeRaw));
  const beforeImages = beforeLines.filter((l) => isImageLine(l));
  const afterImageSet = new Set(afterLines.filter((l) => isImageLine(l)).map(normLine));
  const lostImages = beforeImages.filter((l) => !afterImageSet.has(normLine(l)));

  const beforeTree = parseTree(before);
  const afterChapterNames = new Set(parseTree(after).chapters.map((c) => normHeadV(c.title || "")));
  const afterSectionNames = new Set(parseTree(after).sections.map((s) => normHeadV(s.title || "")));

  let chapterHardHit = null;
  let chapterSoftHit = null;
  (beforeTree.chapters || []).forEach((c, ci) => {
    const name = normHeadV(c.title || "");
    if (afterChapterNames.has(name)) return; // Kapitelname (noch) vorhanden
    const secIdxs = [];
    (beforeTree.sections || []).forEach((s, si) => { if (s.chapter === ci) secIdxs.push(si); });
    // Nacharbeit Runde 1 (🔵 3, toter Code): "contentLineIdxs" wurde befüllt,
    // aber nie gelesen, und die erste "totalContent"-Zuweisung wurde direkt
    // danach überschrieben - beides ersatzlos entfernt (reines Aufräumen,
    // KEINE Verhaltensänderung). Die verbleibende indexOf()-basierte
    // Kapitel-Verlustzuordnung (siehe unten) bleibt bewusst unverändert: bei
    // textgleichen Zeilen in zwei Kapiteln könnte sie den Verlust dem
    // falschen Kapitel zuordnen (reine Heuristik für die SOFT/HARD-
    // Kapitelregel, kein Datenverlustpfad) - der Umbau auf eine
    // indexbasierte Zuordnung wäre eine größere, risikoreichere Änderung
    // ohne bekannten Live-Vorfall, deshalb zurückgestellt (Restrisiko,
    // siehe DECISIONS #112).
    let lostContent = 0;
    const beforeLineTexts = (c.lines || []).filter((l) => l.text.trim() !== "").map((l) => l.text);
    secIdxs.forEach((si) => {
      const sec = beforeTree.sections[si];
      (sec.lines || []).forEach((l) => { if (l.text.trim() !== "") beforeLineTexts.push(l.text); });
      (sec.subs || []).forEach((sub) => (sub.lines || []).forEach((l) => { if (l.text.trim() !== "") beforeLineTexts.push(l.text); }));
    });
    const totalContent = beforeLineTexts.length;
    if (!totalContent) return;
    beforeLineTexts.forEach((t) => {
      const bi = beforeLines.indexOf(t);
      if (bi !== -1 && !beforeMatched[bi]) lostContent++;
    });
    const chapterRatio = lostContent / totalContent;
    // Nacharbeit Runde 3 (🔴): absolutes Minimum wie bei der globalen Ratio
    // (V3_REWRITE_HARD_MIN_LOST) - ein Kapitel mit NUR 2 Inhaltszeilen, von
    // denen genau EINE nicht als "geändert" erkannt wurde, erreicht bereits
    // chapterRatio 0.5 (>= V3_CHAPTER_LOSS_RATIO) und wäre ohne dieses
    // Minimum ein False-Positive HARD bei jedem Kleinst-Kapitel.
    if (chapterRatio >= V3_CHAPTER_LOSS_RATIO && lostContent >= V3_REWRITE_HARD_MIN_LOST) {
      if (!chapterHardHit) chapterHardHit = c.title || "";
    } else if (!chapterSoftHit) {
      // Nacharbeit Runde 4 (🔵 Finding D): "lostContent"/"totalContent"
      // mitführen statt nur des Titels - bei einem KOMPLETT verlorenen
      // Kleinst-Kapitel (lostContent === totalContent, siehe Textbau unten)
      // ist "umbenannt/zusammengelegt?" irreführend, das Kapitel ist nicht
      // umbenannt, sondern schlicht weg (nur unterhalb V3_REWRITE_HARD_MIN_LOST
      // deshalb nur SOFT, siehe Kommentar oben).
      chapterSoftHit = { title: c.title || "", lostContent, totalContent };
    }
  });

  let sectionSoftHit = null;
  (beforeTree.sections || []).forEach((s) => {
    if (!s.title) return;
    if (afterSectionNames.has(normHeadV(s.title))) return;
    if (!sectionSoftHit) sectionSoftHit = s.title;
  });

  const hard = [];
  const soft = [];
  const ratioHard = lost >= V3_REWRITE_HARD_MIN_LOST && ratio > V3_REWRITE_HARD_RATIO;
  if (ratioHard) {
    const pct = Math.round(ratio * 100);
    hard.push({ code: "V3-R", severity: "hard", text: sanitizeDiagFragment('KEIN rewrite – rewrite verliert ' + pct + ' % der Zeilen (' + lost + ' von ' + total + '), u. a. „' + sanitizeDiagFragment(beforeLines[lostIdx[0]]) + '“'), sample: beforeLines[lostIdx[0]], count: lost });
  }
  if (titleLost) {
    hard.push({ code: "V3-R", severity: "hard", text: sanitizeDiagFragment('KEIN rewrite – verliert Titelzeile „' + titleBefore + '“') });
  }
  if (lostImages.length) {
    hard.push({ code: "V3-R", severity: "hard", text: sanitizeDiagFragment('KEIN rewrite – verliert Bild „' + normLine(lostImages[0]) + '“') });
  }
  if (chapterHardHit) {
    hard.push({ code: "V3-R", severity: "hard", text: sanitizeDiagFragment('KEIN rewrite – verliert Kapitel „# ' + chapterHardHit + '“ samt Inhalt') });
  }

  if (!hard.length) {
    if (ratio > V3_REWRITE_SOFT_RATIO && ratio <= V3_REWRITE_HARD_RATIO) {
      soft.push({ code: "V3-R", severity: "soft", text: sanitizeDiagFragment('Prüfhinweis: rewrite verliert ' + Math.round(ratio * 100) + ' %') });
    } else if (ratio > V3_REWRITE_HARD_RATIO && lost < V3_REWRITE_HARD_MIN_LOST) {
      soft.push({ code: "V3-R", severity: "soft", text: sanitizeDiagFragment('Prüfhinweis: rewrite verliert ' + Math.round(ratio * 100) + ' %') });
    }
    if (chapterSoftHit) {
      // Nacharbeit Runde 4 (🔵 Finding D): ein KOMPLETT verlorenes
      // Kleinst-Kapitel (lostContent === totalContent, unterhalb
      // V3_REWRITE_HARD_MIN_LOST deshalb nur soft) bekommt einen ehrlichen
      // "fehlt samt N Zeile(n)"-Wortlaut statt der irreführenden
      // "umbenannt/zusammengelegt?"-Frage (dort steht ja gar nichts mehr,
      // das umbenannt/zusammengelegt worden sein könnte). Ein TEILVERLUST
      // (lostContent < totalContent) bleibt bei der Frageform - dort ist
      // "umbenannt/zusammengelegt" tatsächlich ein plausibler Grund.
      const chapText = chapterSoftHit.lostContent === chapterSoftHit.totalContent
        ? 'Prüfhinweis: Kapitel „# ' + chapterSoftHit.title + '“ fehlt samt ' + chapterSoftHit.totalContent + ' Zeile(n) – umbenannt/zusammengelegt?'
        : 'Prüfhinweis: Kapitel „# ' + chapterSoftHit.title + '“ umbenannt/zusammengelegt?';
      soft.push({ code: "V3-R", severity: "soft", text: sanitizeDiagFragment(chapText) });
    }
  }
  if (sectionSoftHit && !hard.length) {
    soft.push({ code: "V3-R", severity: "soft", text: sanitizeDiagFragment('Prüfhinweis: Abschnitt „## ' + sectionSoftHit + '“ fehlt') });
  }

  return { hard, soft, lost };
}

/* -------------------------------- V4/V5 ----------------------------------- */
// WICHTIG: parseTree() erzeugt für Inhalt VOR dem ersten echten "#"-Kapitel
// bzw. für ein "###" ohne vorausgehendes "##" ein IMPLIZITES Kapitel/eine
// implizite Sektion mit title:null - das ist ein reines Bauplan-Artefakt
// OHNE zugehörige Textzeile im Dokument (siehe markdown.jsx-Kopfkommentar).
// Ob ein solches Artefakt entsteht, hängt vom REST des Dokuments ab (z. B.
// entsteht es erst, sobald irgendwo ein ZWEITES echtes "#"-Kapitel auftaucht)
// - zwei sonst identische Texte können sich daher rein durch das
// Vorhandensein eines SPÄTEREN echten Kapitels in der Artefakt-Anzahl
// unterscheiden, OHNE dass irgendeine neue Überschriftszeile im content
// stand. title:null-Einträge fließen deshalb NIE in die Multiset-Zählung
// ein (sonst Fehlalarm V4/falsche created[]-Einträge mit leerem Namen).
function headingMultiset(text) {
  const tree = parseTree(text);
  const map = new Map();
  (tree.chapters || []).forEach((c) => { if (!c.title) return; const k = "1|" + normHeadV(c.title); map.set(k, (map.get(k) || 0) + 1); });
  (tree.sections || []).forEach((s) => { if (!s.title) return; const k = "2|" + normHeadV(s.title); map.set(k, (map.get(k) || 0) + 1); });
  return map;
}

function buildWhitelist(ops) {
  const set = new Set();
  const fields = ["heading", "chapter", "to_heading", "to_chapter", "from_heading", "from_chapter"];
  for (const op of ops) {
    if (!op || typeof op !== "object") continue;
    for (const f of fields) {
      if (typeof op[f] === "string" && op[f].trim()) set.add(normHeadV(op[f]));
    }
  }
  return set;
}

function buildV4(before, after, whitelist) {
  const beforeCounts = headingMultiset(before);
  const afterCounts = headingMultiset(after);
  const beforeTitle = normHeadV(titleOf(before) || "");
  const afterTree = parseTree(after);
  const out = [];
  const seen = new Set();
  const checkNew = (level, name, disp) => {
    const key = level + "|" + name;
    if ((afterCounts.get(key) || 0) <= (beforeCounts.get(key) || 0)) return;
    if (seen.has(key)) return;
    seen.add(key);
    if (level === 1 && name === beforeTitle && beforeTitle) {
      out.push({ code: "V4", severity: "hard", text: sanitizeDiagFragment('neue Kapitelzeile „# ' + disp + '“ wiederholt die Titelzeile') });
      return;
    }
    if (whitelist.has(name)) return;
    const prefix = level === 1 ? "# " : "## ";
    out.push({ code: "V4", severity: "hard", text: sanitizeDiagFragment('neue Strukturzeile „' + prefix + disp + '“ stammt aus content (in keinem Adressfeld)') });
  };
  (afterTree.chapters || []).forEach((c) => { if (c.title) checkNew(1, normHeadV(c.title), c.title); });
  (afterTree.sections || []).forEach((s) => { if (s.title) checkNew(2, normHeadV(s.title), s.title); });
  return out;
}

function buildV5(before, after) {
  const beforeTree = parseTree(before);
  const beforeChapterNames = new Set((beforeTree.chapters || []).map((c) => normHeadV(c.title || "")));
  const beforeSectionNames = new Set((beforeTree.sections || []).map((s) => normHeadV(s.title || "")));
  const beforeSubNames = new Set();
  (beforeTree.sections || []).forEach((s) => (s.subs || []).forEach((sub) => beforeSubNames.add(normHeadV(sub.title || ""))));
  const beforeTitle = normHeadV(titleOf(before) || "");
  const beforeCounts = headingMultiset(before);
  const afterCounts = headingMultiset(after);
  const afterTree = parseTree(after);
  const out = [];
  const seen = new Set();

  (afterTree.sections || []).forEach((s) => {
    if (!s.title) return;
    const name = normHeadV(s.title);
    const key = "2|" + name;
    if ((afterCounts.get(key) || 0) <= (beforeCounts.get(key) || 0)) return;
    if (seen.has(key)) return;
    if (beforeChapterNames.has(name) || beforeSubNames.has(name) || (beforeTitle && name === beforeTitle)) {
      seen.add(key);
      // Nacharbeit Runde 3 (🔵, tautologischer Wortlaut): "heißt wie „X“"
      // (ohne Ebenenangabe) sagt nichts, was der Name nicht schon selbst
      // zeigt - die tatsächlich GETROFFENE Quelle (Kapitel/Unterthema/Titel)
      // benennen, dieselbe Priorität wie die obige Bedingung.
      const kind = beforeChapterNames.has(name) ? 'Kapitel „# ' : beforeSubNames.has(name) ? 'Unterthema „### ' : 'Titel „# ';
      out.push({ code: "V5", severity: "soft", text: sanitizeDiagFragment('Prüfhinweis: Abschnitt „## ' + s.title + '“ heißt wie ' + kind + s.title + '“ – Ebene prüfen') });
    }
  });
  (afterTree.chapters || []).forEach((c) => {
    if (!c.title) return;
    const name = normHeadV(c.title);
    const key = "1|" + name;
    if ((afterCounts.get(key) || 0) <= (beforeCounts.get(key) || 0)) return;
    if (seen.has(key)) return;
    if (beforeSectionNames.has(name)) {
      seen.add(key);
      out.push({ code: "V5", severity: "soft", text: sanitizeDiagFragment('Prüfhinweis: Kapitel „# ' + c.title + '“ heißt wie Abschnitt „## ' + c.title + '“ – Ebene prüfen') });
    }
  });
  return out;
}

/* --------------------------------- V7 ------------------------------------- */
function orphanCount(text) {
  const lines = String(text ?? "").split("\n");
  const mask = computeFenceLineMask(lines);
  let n = 0;
  for (let i = 0; i < lines.length; i++) if (!mask[i] && FENCE_OPEN_RE.test(lines[i])) n++;
  return n;
}
function buildV7(before, after) {
  const b = orphanCount(before);
  const a = orphanCount(after);
  if (b === 0 && a > 0) {
    return { hard: [{ code: "V7", severity: "hard", text: sanitizeDiagFragment('Codeblock zerrissen – ' + a + ' unterminierte(r) ```-Zaun/Zäune (vorher keine)') }], soft: [] };
  }
  if (b > 0 && a === 0) {
    return { hard: [], soft: [{ code: "V7", severity: "soft", text: sanitizeDiagFragment('Prüfhinweis: unterminierter Codezaun repariert?') }] };
  }
  return { hard: [], soft: [] };
}

/* --------------------------------- V8 ------------------------------------- */
function buildV8(ops) {
  const hasRewrite = ops.some((o) => o && o.type === "rewrite");
  if (hasRewrite && ops.length > 1) {
    const n = ops.length - 1;
    return [{ code: "V8", severity: "hard", text: sanitizeDiagFragment('KEIN rewrite neben weiteren Ops auf dasselbe Notizbuch (' + n + ' weitere) – rewrite allein oder gezielte Ops') }];
  }
  return [];
}

/* --------------------------------- created[] ------------------------------ */
// created[] (Spec 2.3): neue #/##-Zeilen mit Kapitel aus parseTree(after) -
// FÜR BEIDE Gruppenarten berechnet (source unterscheidet rewrite/op); die App
// rendert nur source:"rewrite" als eigene ℹ️-Zeile (Op-Anlagen meldet die
// Engine bereits per note, kein Doppel-Feedback) - source:"op" bleibt hier
// trotzdem berechnet, weil tests/replay.test.js die Anlage-PARITÄT zwischen
// created[] und den Engine-Notes prüft (K-🔵13).
function computeCreated(before, after, isRewrite) {
  const beforeCounts = headingMultiset(before);
  const afterCounts = headingMultiset(after);
  const afterTree = parseTree(after);
  const created = [];
  const seen = new Set();
  const source = isRewrite ? "rewrite" : "op";
  (afterTree.chapters || []).forEach((c) => {
    if (!c.title) return; // implizites Bauplan-Kapitel, keine echte Textzeile
    const key = "1|" + normHeadV(c.title);
    if ((afterCounts.get(key) || 0) > (beforeCounts.get(key) || 0) && !seen.has(key)) {
      seen.add(key);
      created.push({ level: 1, title: c.title, chapter: c.title, source });
    }
  });
  (afterTree.sections || []).forEach((s) => {
    if (!s.title) return;
    const key = "2|" + normHeadV(s.title);
    if ((afterCounts.get(key) || 0) > (beforeCounts.get(key) || 0) && !seen.has(key)) {
      seen.add(key);
      const chapTitle = s.chapter >= 0 && afterTree.chapters[s.chapter] ? afterTree.chapters[s.chapter].title : null;
      created.push({ level: 2, title: s.title, chapter: chapTitle || "", source });
    }
  });
  return created;
}

// Brutto-Zeilenverlust über das Zeilen-Multiset (Spec 4.1: "Σ unexplained +
// erlaubter Verlust") - NICHT die Netto-Differenz der Zeilenanzahl: ein
// rewrite, das 4 Zeilen ersetzt und 5 neue anhängt, hat lostLines===0 in der
// Netto-Rechnung, verliert aber unwiderruflich 4 Zeilen (Override-Label
// "löscht N Zeilen" muss diese Zahl zeigen, nicht die zufällig ausgeglichene
// Differenz).
function grossLostLines(before, after) {
  const b = countNonEmpty(String(before ?? "").split("\n"));
  const a = countNonEmpty(String(after ?? "").split("\n"));
  let n = 0;
  for (const [key, count] of b) n += Math.max(0, count - (a.get(key) || 0));
  return n;
}

/* ------------------------------- verifyTurn -------------------------------- */
// Rein lesend, wirft nie: nicht-string before/after werden zu "" normalisiert,
// kaputte/nicht-Objekt-Ops werden übersprungen (siehe die einzelnen build*-
// Helfer oben). Reihenfolge V8, V3, V1, V2, V4, V5, V7 - ALLE gesammelt, kein
// Kurzschluss (Spec 2.3).
export function verifyTurn(before, after, ops, ctx = {}) {
  const beforeText = typeof before === "string" ? before : "";
  const afterText = typeof after === "string" ? after : "";
  const opsList = (Array.isArray(ops) ? ops : []).filter((o) => o && typeof o === "object");
  const hard = [];
  const soft = [];
  const hasRewrite = opsList.some((o) => o.type === "rewrite");

  try { hard.push(...buildV8(opsList)); } catch { /* rein lesend, defensiv */ }

  try {
    if (!hasRewrite) hard.push(...buildV3NonRewrite(beforeText, opsList));
    else {
      const v3r = buildV3R(beforeText, afterText);
      hard.push(...v3r.hard);
      soft.push(...v3r.soft);
    }
  } catch { /* defensiv */ }

  try { hard.push(...buildV1(beforeText, afterText)); } catch { /* defensiv */ }

  try {
    const v2 = buildV2(beforeText, afterText, opsList);
    hard.push(...v2.hard);
    soft.push(...v2.soft);
  } catch { /* defensiv */ }

  if (!hasRewrite) {
    try {
      const whitelist = buildWhitelist(opsList);
      hard.push(...buildV4(beforeText, afterText, whitelist));
    } catch { /* defensiv */ }
  }

  try { soft.push(...buildV5(beforeText, afterText)); } catch { /* defensiv */ }

  try {
    const v7 = buildV7(beforeText, afterText);
    hard.push(...v7.hard);
    soft.push(...v7.soft);
  } catch { /* defensiv */ }

  const created = computeCreated(beforeText, afterText, hasRewrite);
  const lostLines = grossLostLines(beforeText, afterText);

  return { hard, soft, created, stats: { lostLines, opsCount: opsList.length, results: Array.isArray(ctx.results) ? ctx.results : [] } };
}

/* --------------------------- summarizeCodes/Diagnose ------------------------ */
const CODE_ORDER = ["V1", "V2", "V3", "V3-R", "V4", "V5", "V7", "V8"];
export function summarizeCodes(result) {
  const codes = [...new Set([...(result?.hard || []), ...(result?.soft || [])].map((v) => v.code))];
  codes.sort((a, b) => CODE_ORDER.indexOf(a) - CODE_ORDER.indexOf(b));
  return codes.join(", ");
}

function buildOutlineSection(before) {
  const tree = parseTree(before);
  const parts = [];
  const preSecs = (tree.sections || []).filter((s) => s.chapter < 0);
  if (preSecs.length) {
    parts.push("Vorspann: " + preSecs.slice(0, 6).map((s) => '„' + sanitizeDiagFragment(s.title || "") + '“').join(", "));
  }
  (tree.chapters || []).forEach((c, ci) => {
    const secs = (tree.sections || []).filter((s) => s.chapter === ci);
    let seg = '„# ' + sanitizeDiagFragment(c.title || "") + '“';
    if (secs.length) {
      seg += ": " + secs.slice(0, 6).map((s) => '„## ' + sanitizeDiagFragment(s.title || "") + '“').join(", ");
    } else if (c.lines && c.lines.length) {
      const n = c.lines.filter((l) => l.text.trim() !== "").length;
      if (n) seg += " (Freitext " + n + " Z.)";
    }
    parts.push(seg);
  });
  let out = parts.join(" · ");
  if (out.length > 300) out = out.slice(0, 299) + "…";
  return out;
}

const RECIPES = {
  V1: 'Freitext im Kapitel per append_to_chapter, bestehende Zeile per replace_entry – kein ##-Abschnitt mit dem Kapitelnamen',
  V5: 'Freitext im Kapitel per append_to_chapter, bestehende Zeile per replace_entry – kein ##-Abschnitt mit dem Kapitelnamen',
  V2: 'bereits vorhandene Zeilen nicht erneut senden; innerhalb eines Notizbuchs move_entry, zwischen Notizbüchern Ziel-Op + delete_entry im selben ops-Array',
  V3: 'Löschungen nur per delete_entry/delete_section/delete_chapter',
  V4: 'keine #/##-Zeilen im content',
  V7: 'Codeblock vollständig senden',
};
const REWRITE_RECIPE = 'gezielte Ops (append_to_section/replace_section/replace_entry/move_entry)';

function buildRecipesSection(result) {
  const codes = [...new Set([...(result?.hard || []), ...(result?.soft || [])].map((v) => v.code))];
  const lines = [];
  const seen = new Set();
  for (const code of codes) {
    let text = RECIPES[code];
    if (!text && (code === "V3-R" || code === "V8")) text = "KEIN rewrite – " + REWRITE_RECIPE;
    if (!text) continue;
    if (!seen.has(text)) { seen.add(text); lines.push(text); }
  }
  return lines.join("; ");
}

function describeSkip(s) {
  const type = s && s.type ? s.type : "Op";
  const heading = s && s.heading ? ' „' + sanitizeDiagFragment(s.heading) + '“' : "";
  const reason = sanitizeDiagFragment(s && s.reason ? s.reason : "");
  return type + heading + " (" + reason + ")";
}

// buildVerifyDiagnosis (Spec 3): "opts.skips" = Skips DERSELBEN Gruppe (max 3
// gezeigt, "(+n)" danach), "opts.holds" bleibt für App.jsx reserviert (Guard-
// Einträge, hier nicht genutzt - verifyTurn kennt den Guard-Plan nicht).
// Kürzungsreihenfolge bei Überlänge: Outline -> Skips -> Hard-Kappung; "Nächster
// Schritt" bleibt IMMER erhalten.
export function buildVerifyDiagnosis(result, before, notebookName, opts = {}) {
  const nb = notebookName ? sanitizeDiagFragment(notebookName) : "";
  const hardTexts = (result?.hard || []).map((v, i) => "(" + (i + 1) + ") " + v.text);
  const head = ("Notizbuch „" + nb + "“: " + hardTexts.join(" ")).trim();

  const skipsAll = Array.isArray(opts.skips) ? opts.skips : [];
  const skipsShown = skipsAll.slice(0, 3);
  const skipsExtra = Math.max(0, skipsAll.length - 3);
  const skipsSection = skipsShown.length
    ? "Übersprungen: " + skipsShown.map(describeSkip).join("; ") + (skipsExtra ? " (+" + skipsExtra + ")" : "")
    : "";

  let outlineSection = "";
  try { outlineSection = buildOutlineSection(before); } catch { outlineSection = ""; }
  const recipesSection = buildRecipesSection(result);
  const recipesPart = recipesSection ? "Nächster Schritt: " + recipesSection : "";

  const assemble = (includeOutline, includeSkips) => {
    const parts = [head];
    if (includeSkips && skipsSection) parts.push(skipsSection);
    if (includeOutline && outlineSection) parts.push("Struktur: " + outlineSection);
    if (recipesPart) parts.push(recipesPart);
    return parts.join(" | ");
  };

  let text = assemble(true, true);
  if (text.length > DIAG_MAX) text = assemble(false, true);
  if (text.length > DIAG_MAX) text = assemble(false, false);
  if (text.length > DIAG_MAX) {
    // "Nächster Schritt" bleibt IMMER erhalten (Spec 3) - selbst sehr lange
    // Hard-Texte (Kopfzeile) werden dafür zur Not gekürzt, statt den
    // Rezepte-Teil zu verlieren.
    const suffix = recipesPart ? " | " + recipesPart : "";
    const headBudget = Math.max(0, DIAG_MAX - suffix.length - 1);
    text = (head.length > headBudget ? head.slice(0, headBudget) + "…" : head) + suffix;
  }
  if (text.length > DIAG_MAX) text = text.slice(0, DIAG_MAX - 1) + "…";
  return text;
}
