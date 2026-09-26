/* ------------------------------------------------------------------ */
/* Feedback nach manueller Editor-Bearbeitung                          */
/* Extrahiert aus App.jsx (requestFeedback) für Unit-Tests, v7.10.     */
/* v7.57.1 (DECISIONS #118/#130/#131): Diff-Legende + eine vom CODE       */
/* EXAKT gezählte Vorkommen-Angabe (String-Gleichheit nach trim(), OHNE   */
/* jede Bewertung wie "Dublette"/"genau einmal") als Prompt-Fakten für    */
/* den E2E-Befund D1 (Modell verwechselte den Diff-Stand mit dem Vorher-  */
/* Stand). Das zwischen #118 und #129 gewachsene Kollisions-"Netz"        */
/* (Formatierungs-Toleranz, Chat-Anhang, uncertain-Logik) ist per         */
/* NUTZERENTSCHEIDUNG wieder zurückgebaut ("Einzel-Guard-Muster", siehe   */
/* DECISIONS #130) – bewusst KEINE Formatierungs-Toleranz und KEINE       */
/* Sonderregeln mehr. Restrisiko siehe DECISIONS #130/#131.               */
/* ------------------------------------------------------------------ */

import { computeFenceLineMask } from "./code.jsx";

// Token-Deckel für den mitgeschickten Diff: Bei sehr großen Umbauten wird
// KEIN Diff mitgeschickt, sondern das Modell gebeten, das Gesamtdokument zu
// prüfen (Kompromiss zwischen Kontext-Tiefe und Kosten/Latenz). Lag früher
// direkt in App.jsx – jetzt hier, damit ein Kandidat nicht "vergessen"
// werden kann und der Deckel per Test pinnbar ist. Gilt WEITERHIN nur für
// den Diff selbst (bewusst NICHT um den Fakten-Block erweitert, siehe
// DECISIONS #118) – der Fakten-Block ist durch die feste 20-Fakten-Grenze
// in buildFeedbackFacts() bereits eigenständig gedeckelt.
const DIFF_CAP = 8000;

// Baut den Systemhinweis-Trigger für die automatische Rückmeldung, die nach
// einer manuellen (nicht per Chat ausgelösten) Editor-Bearbeitung an das
// Modell geschickt wird (siehe App.jsx requestFeedback). Drei Verträge sind
// hier scharf und werden von tests/feedback.test.js gepinnt:
// 1. ops bleiben immer leer, commit ist immer null – die Prüfung selbst
//    darf niemals ein Notizbuch verändern.
// 2. Fällt nichts auf, antwortet das Modell in reply EXAKT mit "##OK##" –
//    das ist der Sentinel, den isNoFeedback() unten auswertet.
// 3. (v7.10, Fix zu einem 2× beobachteten Doppel-Kommentar): Das Modell
//    darf KEINEN Text vor dem abschließenden Tool-Aufruf schreiben. Grund:
//    buildChatReply() in anthropic.js kombiniert Vorab-Textblöcke seit v7.6
//    IMMER mit dem reply-Feld (Sicherheitsnetz gegen Inhaltsverlust bei
//    Websuche, siehe DECISIONS.md #53 – bleibt unverändert bestehen).
//    Schrieb das Modell die Einschätzung sowohl als Vorab-Text als auch
//    (leicht anders formuliert) ins reply-Feld, landete sie doppelt im
//    Chat. Diese Klausel verhindert das Problem an der Quelle, statt sich
//    allein auf den (riskanteren) Fuzzy-Vergleich in buildChatReply zu
//    verlassen.
// 4. NEU (v7.11, dritter beobachteter Fall derselben Fehlerfamilie): Das
//    Modell kann dieselbe Beobachtung auch INNERHALB des reply-Felds selbst
//    zweimal (anders formuliert) unterbringen – zwei aufeinanderfolgende
//    Absätze, gleiche Aussage. Klausel 4 bekämpft das an der Quelle;
//    dedupeFeedbackParagraphs() unten ist das zugehörige Sicherheitsnetz im
//    Code (analog zum Verhältnis von Klausel 3 zu buildChatReply).
// "factsText" (optional, v7.57.1, DECISIONS #118/#130): vorformatierter Text
// aus formatFeedbackFacts() – vom CODE EXAKT gezählte Vorkommen je Notizbuch
// (String-Gleichheit nach trim(), keine Bewertung). Ohne Fakten (leerer
// String, z. B. weil diffLines() null lieferte) bleibt der Trigger-Text
// unverändert wie vor v7.57.1.
export function buildFeedbackTrigger(nbName, diffText, factsText = "") {
  const capped = diffText && diffText.length > DIFF_CAP ? "" : diffText;
  // Review-Nachbesserung (🟡, DECISIONS #131): der Fakten-Block-Kopf nannte
  // bisher NUR "Zählung nach identischem Markdown-Wortlaut", ohne Zeitbasis.
  // GENAU diese fehlende Zeitbasis war die D1-Root-Cause: das Modell las den
  // bereits committeten Diff-Stand als "existierte schon vorher" UND zählte
  // die "+"-Zeile zusätzlich – "1×" allein passt zu dieser Fehllesung ebenso
  // wie zur korrekten ("1 alt + 1 neu" vs. "1 einzige Zeile, jetzt gezählt").
  // "im Stand NACH der Änderung, die hinzugefügte Zeile selbst mitgezählt"
  // ist IMMER wahr (keine Bewertung, kein Einzel-Guard) und nimmt dem Modell
  // genau diese Verwechslung ab.
  const factsBlock = factsText
    ? "Vom Code ermittelte Fakten zur Änderung (Zählung nach identischem Markdown-Wortlaut im Stand NACH " +
      "der Änderung, die hinzugefügte Zeile selbst mitgezählt; anders formatierte Zeilen wie Fett, Farbe, " +
      "Link, Formel oder Tabelle zählen NICHT mit – bei Verdacht auf eine inhaltliche Dublette bitte selbst " +
      "prüfen und den Unterschied benennen):\n" + factsText + "\n\n"
    : "";
  return (
    "[Systemhinweis: Der Nutzer hat das Notizbuch „" + nbName + "“ soeben MANUELL bearbeitet, " +
    "nicht über den Chat. Der neue Stand steht bereits unter ALLE NOTIZBÜCHER (Stand NACH der " +
    "Änderung) im Dokument und ist so gewollt.\n" +
    factsBlock +
    (capped
      ? "Diff der Änderung:\n(Legende: \"+ \" = hinzugefügt, im Dokumentstand BEREITS enthalten; " +
        "\"− \" = entfernt; \"  \" = unveränderter Kontext.)\n" + capped + "\n\n"
      : "Die Änderung ist umfangreich (kein kompakter Diff verfügbar) – prüfe das Gesamtdokument.\n\n") +
    "Prüfe die Änderung im Kontext ALLER Notizbücher gemäß deiner Aufgabe 3 " +
    "(Verbindungen, Widersprüche, Dubletten, Lücken, nächste Schritte, verletzte Konventionen). " +
    "Fällt dir etwas Nennenswertes auf, melde es kurz in reply. " +
    "Fällt dir NICHTS Nennenswertes auf, antworte in reply exakt mit \"##OK##\" und sonst nichts. " +
    "Schreibe KEINEN Text vor dem Tool-Aufruf – die GESAMTE Rückmeldung gehört ausschließlich in das reply-Feld. " +
    "Fasse deine Rückmeldung in EINEM kompakten Absatz zusammen; wiederhole dieselbe Aussage nicht in anderen Worten. " +
    "Lass ops in jedem Fall leer und commit null – kein Notizbuch darf durch diese Prüfung verändert werden.]"
  );
}

// Erkennt "nichts zu melden" robust. Sentinel bevorzugt; zusätzlich häufige
// Floskeln abfangen, falls das Modell den Sentinel ignoriert. v7.10: NEU ist
// die reine Enthalten-Prüfung auf "##OK##" (statt nur exakter Gesamttext-
// Vergleich) – deckt den zweiten v7.7-Defekt ab, bei dem das Modell
// zusätzlichen Vorab-Text schreibt und buildChatReply() daraus
// "<Vorab-Text>\n\n##OK##" kombiniert: der reine Gleichheits-Vergleich griff
// dann nicht mehr, der Nutzer sah eine Nachricht mit sichtbarem "##OK##".
// Bewusst NUR eine literale Enthalten-Prüfung des Sentinels (kein Fuzzy-
// Abgleich auf Wortteile) – "ok" als Teilstring von "okkult" o. ä. darf
// NICHT als "nichts zu melden" durchgehen.
export function isNoFeedback(reply) {
  const text = typeof reply === "string" ? reply.trim() : "";
  if (!text) return true;
  if (text.includes("##OK##")) return true;
  const norm = text.toLowerCase().replace(/[#.!,\s]/g, "");
  if (norm === "ok" || norm === "okay" || norm === "notiert") return true;
  return /^(alles (konsistent|in ordnung|klar|gut)|keine auffälligkeiten|nichts auffälliges|passt so)/i.test(text);
}

// Absätze unter dieser Tokenzahl werden NIE als Dublette gewertet
// (Grußformeln/Überschriften-Risiko: kurze Textbausteine wiederholen sich
// legitim, ohne inhaltlich dieselbe Beobachtung zu sein).
const MIN_DEDUP_TOKENS = 5;

// lowercase, Interpunktion raus, Whitespace-Kollaps – Normalform für den
// Gleichheitsvergleich unten.
function normalizeParagraph(p) {
  return String(p || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Entfernt EXAKT wiederholte Absätze (bis auf Formatierung) INNERHALB eines
// einzelnen reply-Texts (v7.11, dritte beobachtete Ausprägung derselben
// Fehlerfamilie wie v7.10 – siehe DECISIONS.md #57). Anders als der
// v7.10-Fix in buildChatReply() (Vorab-Textblock vs. toolReply – zwei
// verschiedene FELDER) dupliziert das Modell hier die Einschätzung
// INNERHALB des reply-Felds selbst: zwei aufeinanderfolgende Absätze.
// buildChatReply() kann das konstruktionsbedingt nicht erkennen (es sieht
// nur EIN reply-Feld).
//
// Erkannt wird AUSSCHLIESSLICH normalisierte GLEICHHEIT (lowercase,
// Interpunktion raus, Whitespace-Kollaps) – KEIN Jaccard-/Wort-Overlap mehr.
// Grund (Review-Fund, v7.11-Nachbesserung, mit echten Messungen widerlegt):
// Ein ursprünglich implementierter Jaccard-Zweig (Token-Mengen-Ähnlichkeit
// ≥ Schwelle) wurde WIEDER ENTFERNT, weil die Metrik für dieses Problem
// invertiert ist. Fünf realistische Paare aus je ZWEI EIGENSTÄNDIGEN
// Beobachtungen zum selben Abschnitt (paralleler Mehr-Befund-Stil, gleiches
// Satzgerüst, z. B. "fehlt der Beleg" vs. "fehlt das Datum") maßen
// Jaccard 0,55–0,87 – HÖHER als der echte Paraphrase-Beleg-Fall aus dem
// v7.11-Live-Finding (0,4237, siehe Test "Beleg-Paraphrase-Fall"). Es gibt
// also keinen Schwellwert, der "gleiche Aussage, andere Worte" (niedriger
// Overlap) von "andere Aussage, gleiches Satzgerüst" (hoher Overlap)
// trennt – jeder Versuch hätte entweder den Paraphrase-Fall verpasst oder
// echte, eigenständige Mehrfach-Befunde stillschweigend verschluckt.
// Stilles Löschen einer echten Beobachtung ist der schwerwiegendere Fehler
// als eine gelegentliche, weiterhin sichtbare Doppelung – deshalb bleibt
// der Paraphrase-Schutz ALLEIN der Trigger-Klausel 4 in
// buildFeedbackTrigger() überlassen ("EIN kompakter Absatz; keine
// Wiederholung in anderen Worten"), diese Funktion fängt nur noch exakte
// (bis auf Formatierung identische) Wiederholungen ab.
//
// BEWUSST NUR im Feedback-Pfad angewendet (App.jsx requestFeedback), NICHT
// in buildChatReply – der dortige Pfad trägt echte, vom Nutzer angestoßene
// Chat-Antworten.
export function dedupeFeedbackParagraphs(reply) {
  const text = typeof reply === "string" ? reply : "";
  // Codeblöcke: Ein Absatz-Split mitten durch einen ```-Fence würde den
  // Code kaputt zerschneiden – lieber unangetastet lassen als riskieren.
  if (!text || text.includes("```")) return text;

  const paras = text.split(/\n{2,}/);
  if (paras.length < 2) return text;

  const norms = paras.map(normalizeParagraph);
  const tokenCounts = norms.map((n) => (n ? n.split(" ").length : 0));

  const drop = new Array(paras.length).fill(false);
  for (let i = 0; i < paras.length; i++) {
    if (drop[i] || tokenCounts[i] < MIN_DEDUP_TOKENS) continue;
    for (let j = i + 1; j < paras.length; j++) {
      if (drop[j] || tokenCounts[j] < MIN_DEDUP_TOKENS) continue;
      if (norms[i] === norms[j]) drop[j] = true; // ERSTEN behalten, Reihenfolge der übrigen erhalten
    }
  }
  return paras.filter((_, idx) => !drop[idx]).join("\n\n");
}

/* ------------------------------------------------------------------ */
/* Fakten-Ermittlung: EXAKTE Zählung (v7.57.1, DECISIONS #118/#130)     */
/* ------------------------------------------------------------------ */

// Zeilenindex der Notizbuch-TITELZEILE – dieselbe Konvention wie
// markdown.jsx#parseTree/ops.js#titleLineIdx: die erste NICHT-LEERE Zeile
// des Dokuments ist der Titel, WENN sie mit "# " beginnt. Zählt hier bewusst
// NICHT als "Kapitel" (sonst stünde bei einem flachen Dokument ohne echte
// Kapitel in JEDEM Fakt der Notizbuchname selbst als "Kapitel" – redundant
// zum bereits genannten "im Notizbuch „X“").
function titleLineIdx(lines) {
  const i = lines.findIndex((l) => l.trim() !== "");
  return i !== -1 && /^#\s+/.test(lines[i]) ? i : -1;
}

// Kapitel/Abschnitt + 1-basierte Zeilennummer für einen Zeilenindex – bewusst
// EINFACHER als ops.js#buildHeadingIndex (dort geht es um Op-Anwendung mit
// vielen Randfall-Invarianten, hier nur um eine lesbare Pfadangabe für die
// Fakten-Anzeige). "mask" (computeFenceLineMask) verhindert, dass eine
// "#"/"##"-Zeile INNERHALB eines ```-Codeblocks fälschlich als echte
// Überschrift gilt.
function locateLine(lines, at, mask) {
  const tIdx = titleLineIdx(lines);
  let chapter = null;
  let section = null;
  for (let i = 0; i <= at && i < lines.length; i++) {
    if (mask[i] || i === tIdx) continue;
    if (/^#\s+/.test(lines[i])) { chapter = lines[i].replace(/^#\s+/, "").trim(); section = null; }
    else if (/^##\s+/.test(lines[i])) { section = lines[i].replace(/^##\s+/, "").trim(); }
  }
  return { chapter, section, lineNo: at + 1 };
}

// Höchstens so viele EIGENSTÄNDIGE Fakten werden ermittelt/formatiert –
// analog zum DIFF_CAP-Gedanken oben (Kosten/Latenz). Ein Edit mit mehr als
// 20 unterschiedlichen neuen Zeilen ist ohnehin kein "kleiner manueller
// Zusatz" mehr, für den dieser Pfad gedacht ist.
const MAX_FACTS = 20;

// Ermittelt pro EINDEUTIGER hinzugefügter, NICHT-LEERER Zeile (diff =
// diffLines()-Rohwert, UNGEFILTERT – contextize() darf hier NICHT verwendet
// werden, weil die Positions-Rekonstruktion unten jede "s"/"a"-Zeile zum
// Vorrücken im Nachher-Dokument braucht) im NACHHER-Stand des aktiven
// Notizbuchs:
// - wie oft ihr Markdown-Wortlaut dort vorkommt (activeCount – EXAKTE
//   String-Gleichheit nach trim(), die Zeile selbst mitgezählt),
// - Kapitel/Abschnitt/Zeile des Fundorts,
// - in welchen ANDEREN Notizbüchern derselbe Wortlaut ebenfalls (exakt)
//   vorkommt (elsewhere).
// DECISIONS #130 (Nutzerentscheidung, Rückbau des #118–#129-Netzes): BEWUSST
// keine Formatierungs-/Escape-/Encoding-Toleranz mehr (kein looseKey(),
// keine Tag-/Entity-Behandlung, keine TeX-/Tabellenzellen-Lesart) und KEINE
// Sonderbehandlung mehr für Überschriften/Codeblöcke/Trennzeilen – jede
// dieser Zusatzregeln hatte in einer früheren Runde entweder eine weitere
// Darstellungsvariante übersehen oder eine neue Fehlklasse eingeführt
// ("Einzel-Guard-Muster", siehe Kopfkommentar). Eine reine exakte Zählung
// kann NIE falsch liegen (String-Gleichheit ist eindeutig) – der Preis ist,
// dass zwei ANDERS formatierte, aber optisch identische Zeilen (Fett,
// Farbe, Link, Formel, Tabellenzelle) als "verschieden" gezählt werden;
// formatFeedbackFacts() macht dem Modell diese Einschränkung deshalb
// explizit, statt sie zu verschweigen.
export function buildFeedbackFacts(diff, notebooks, activeName) {
  if (!Array.isArray(diff) || !Array.isArray(notebooks)) return [];
  const active = notebooks.find((nb) => nb && nb.name === activeName);
  if (!active) return [];
  const newLines = String(active.doc || "").split("\n");
  const fenceMask = computeFenceLineMask(newLines);
  const activeTrimmed = newLines.map((l) => l.trim());
  const otherNotebooks = notebooks
    .filter((nb) => nb && nb.name !== activeName)
    .map((nb) => {
      const lines = String(nb.doc || "").split("\n");
      return { name: nb.name, lines, mask: computeFenceLineMask(lines), trimmed: lines.map((l) => l.trim()) };
    });

  const facts = [];
  const seen = new Set();
  let pos = 0;
  for (let i = 0; i < diff.length; i++) {
    const d = diff[i];
    if (!d || d.t === "d") continue; // entfernte Zeile rückt im Nachher-Dokument nicht vor
    const idx = pos++;
    if (d.t !== "a") continue; // nur hinzugefügte Zeilen sind ein Fakt
    const raw = idx < newLines.length ? newLines[idx] : d.l;
    const trimmed = String(raw).trim();
    // Leere Zeile ist NIE ein Fakt; eine im Diff MEHRFACH hinzugefügte
    // identische Zeile bekommt (wie schon vor #130) nur EINEN Fakten-Eintrag
    // – activeCount zählt ihre tatsächlichen Vorkommen im Nachher-Dokument
    // ohnehin bereits vollständig.
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);

    const activeCount = activeTrimmed.filter((t) => t === trimmed).length;
    const loc = locateLine(newLines, idx, fenceMask);
    const elsewhere = [];
    for (const onb of otherNotebooks) {
      const firstIdx = onb.trimmed.indexOf(trimmed);
      if (firstIdx !== -1) {
        const eloc = locateLine(onb.lines, firstIdx, onb.mask);
        elsewhere.push({ notebook: onb.name, chapter: eloc.chapter, section: eloc.section });
      }
    }

    facts.push({ text: trimmed, chapter: loc.chapter, section: loc.section, lineNo: loc.lineNo, activeCount, elsewhere });
    if (facts.length >= MAX_FACTS) break;
  }
  return facts;
}

// Formatiert das Ergebnis von buildFeedbackFacts() als Prompt-Text (leerer
// String ohne Fakten – buildFeedbackTrigger lässt den Fakten-Block dann
// ganz weg). DECISIONS #130: bewusst KEINE Bewertung ("Dublette"/"genau
// einmal") mehr – nur die nackte Zählung plus Fundort, die inhaltliche
// Einordnung (auch eine semantische, anders formulierte Dublette) bleibt
// vollständig dem Modell überlassen (siehe Kommentar bei
// buildFeedbackFacts() und den Fakten-Block-Kopf in buildFeedbackTrigger()).
export function formatFeedbackFacts(facts, activeName) {
  if (!Array.isArray(facts) || !facts.length) return "";
  const lines = facts.map((f) => {
    const path = [f.chapter, f.section].filter(Boolean).join(" → ") || "Vorspann";
    const shown = f.text.length > 160 ? f.text.slice(0, 157) + "…" : f.text;
    // Review-Nachbesserung (🟡, DECISIONS #131): "nach der Änderung" +
    // "diese hinzugefügte Zeile mitgezählt" statt der bloßen Zahl – siehe
    // Begründung im Kopf des Fakten-Blocks in buildFeedbackTrigger() oben.
    let s = "„" + shown + "“: im Notizbuch „" + activeName + "“ nach der Änderung " + f.activeCount + "× " +
      "(diese hinzugefügte Zeile mitgezählt; " + path + ", Zeile " + f.lineNo + ")";
    if (f.elsewhere && f.elsewhere.length) {
      const els = f.elsewhere.map((e) => {
        const p = [e.chapter, e.section].filter(Boolean).join(" → ") || "Vorspann";
        return "„" + e.notebook + "“ (" + p + ")";
      }).join(", ");
      s += "; identischer Wortlaut auch in " + els;
    }
    return s;
  });
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* D1-Verdrahtung als reine Funktion (v7.57.1-Nachbesserung,            */
/* Review-Fund 🟡, DECISIONS #121)                                      */
/* ------------------------------------------------------------------ */
// Bisher lag die komplette Verdrahtung (Fakten bauen -> Trigger bauen)
// INLINE in App.jsx#requestFeedback – ohne TipTap-Harness nicht unit-
// testbar, ein vertauschtes Argument wäre grün geblieben (Review-Fund,
// offener Punkt seit #120). buildFeedbackRequest() fasst das zusammen;
// App.jsx ruft nur noch diese Funktion auf, die Live-Fixture aus
// tests/feedback.test.js deckt die VERDRAHTUNG mit ab.

// Baut Fakten + Trigger für den Feedback-Request. "diff" ist der ROHE
// diffLines()-Rückgabewert (oder null), "notebooks" der NACH-dem-Commit-
// Stand aller Notizbücher (buildNbCtx()-Ergebnis), "nbName" das aktive
// Notizbuch.
export function buildFeedbackRequest(diff, diffText, notebooks, nbName) {
  const facts = Array.isArray(diff) ? buildFeedbackFacts(diff, notebooks, nbName) : [];
  const trigger = buildFeedbackTrigger(nbName, diffText, formatFeedbackFacts(facts, nbName));
  return { trigger, facts };
}
