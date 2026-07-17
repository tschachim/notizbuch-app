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
// 3. NEU (v7.10, Fix zu einem 2× beobachteten Doppel-Kommentar): Das Modell
//    darf KEINEN Text vor dem abschließenden Tool-Aufruf schreiben. Grund:
//    buildChatReply() in anthropic.js kombiniert Vorab-Textblöcke seit v7.6
//    IMMER mit dem reply-Feld (Sicherheitsnetz gegen Inhaltsverlust bei
//    Websuche, siehe DECISIONS.md #53 – bleibt unverändert bestehen).
//    Schrieb das Modell die Einschätzung sowohl als Vorab-Text als auch
//    (leicht anders formuliert) ins reply-Feld, landete sie doppelt im
//    Chat. Diese Klausel verhindert das Problem an der Quelle, statt sich
//    allein auf den (riskanteren) Fuzzy-Vergleich in buildChatReply zu
//    verlassen.
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
