/* ------------------------------------------------------------------ */
/* Feedback nach manueller Editor-Bearbeitung                          */
/* Extrahiert aus App.jsx (requestFeedback) für Unit-Tests, v7.10.     */
/* ------------------------------------------------------------------ */

// Token-Deckel für den mitgeschickten Diff: Bei sehr großen Umbauten wird
// KEIN Diff mitgeschickt, sondern das Modell gebeten, das Gesamtdokument zu
// prüfen (Kompromiss zwischen Kontext-Tiefe und Kosten/Latenz). Lag früher
// direkt in App.jsx – jetzt hier, damit ein Kandidat nicht "vergessen"
// werden kann und der Deckel per Test pinnbar ist.
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
export function buildFeedbackTrigger(nbName, diffText) {
  const capped = diffText && diffText.length > DIFF_CAP ? "" : diffText;
  return (
    "[Systemhinweis: Der Nutzer hat das Notizbuch „" + nbName + "“ soeben MANUELL bearbeitet, " +
    "nicht über den Chat. Der neue Stand steht bereits oben im Dokument und ist so gewollt.\n" +
    (capped
      ? "Diff der Änderung:\n" + capped + "\n\n"
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
