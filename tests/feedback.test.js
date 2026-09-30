import { describe, it, expect } from "vitest";
import {
  buildFeedbackTrigger, isNoFeedback, dedupeFeedbackParagraphs,
  buildFeedbackFacts, formatFeedbackFacts, buildFeedbackRequest, collectFeedbackFacts,
} from "../src/lib/feedback.js";
import { diffLines } from "../src/lib/diff.js";

describe("buildFeedbackTrigger", () => {
  it("enthält den MANUELL-bearbeitet-Hinweis mit dem Notizbuchnamen", () => {
    const t = buildFeedbackTrigger("Kochrezepte", "");
    expect(t).toContain("Notizbuch „Kochrezepte“ soeben MANUELL bearbeitet");
    expect(t).toContain("nicht über den Chat");
  });

  it("bettet einen vorhandenen Diff ein", () => {
    const t = buildFeedbackTrigger("X", "+ neue Zeile\n− alte Zeile");
    expect(t).toContain("Diff der Änderung:");
    expect(t).toContain("+ neue Zeile");
    expect(t).toContain("− alte Zeile");
    expect(t).not.toContain("Die Änderung ist umfangreich");
  });

  it("fällt ohne Diff auf den 'Gesamtdokument prüfen'-Hinweis zurück", () => {
    const t = buildFeedbackTrigger("X", "");
    expect(t).toContain("Die Änderung ist umfangreich (kein kompakter Diff verfügbar) – prüfe das Gesamtdokument.");
    expect(t).not.toContain("Diff der Änderung:");
  });

  it("deckelt sehr große Diffs (>8000 Zeichen) auf den Gesamtdokument-Hinweis (Token-Deckel)", () => {
    const grosserDiff = "+ ".repeat(5000); // 10000 Zeichen, über dem Deckel
    const t = buildFeedbackTrigger("X", grosserDiff);
    expect(t).toContain("Die Änderung ist umfangreich (kein kompakter Diff verfügbar) – prüfe das Gesamtdokument.");
    expect(t).not.toContain("Diff der Änderung:");
    expect(t).not.toContain(grosserDiff);
  });

  it("behält einen Diff exakt am Deckel (8000 Zeichen) noch, verwirft erst darüber", () => {
    const genau = "a".repeat(8000);
    const drueber = "a".repeat(8001);
    expect(buildFeedbackTrigger("X", genau)).toContain("Diff der Änderung:");
    expect(buildFeedbackTrigger("X", drueber)).not.toContain("Diff der Änderung:");
  });

  it("verlangt ops leer und commit null", () => {
    const t = buildFeedbackTrigger("X", "");
    expect(t).toContain("Lass ops in jedem Fall leer und commit null");
  });

  it("definiert den ##OK##-Sentinel für 'nichts Nennenswertes'", () => {
    const t = buildFeedbackTrigger("X", "");
    expect(t).toContain('antworte in reply exakt mit "##OK##" und sonst nichts');
  });

  it("verbietet Text vor dem Tool-Aufruf (v7.10-Fix gegen Doppel-Kommentare)", () => {
    const t = buildFeedbackTrigger("X", "");
    expect(t).toContain("Schreibe KEINEN Text vor dem Tool-Aufruf");
    expect(t).toContain("die GESAMTE Rückmeldung gehört ausschließlich in das reply-Feld");
  });

  it("verlangt EINEN kompakten Absatz ohne Wiederholung derselben Aussage (v7.11-Fix gegen Doppel-Absätze im reply)", () => {
    const t = buildFeedbackTrigger("X", "");
    expect(t).toContain("Fasse deine Rückmeldung in EINEM kompakten Absatz zusammen");
    expect(t).toContain("wiederhole dieselbe Aussage nicht in anderen Worten");
  });

  // v7.57.1 (DECISIONS #118, E2E-Befund D1): "oben im Dokument" war
  // mehrdeutig – der Diff-Kontext UND die Notizbuch-Dokumente stehen beide
  // "im Prompt", das Modell verwechselte in einem Live-Fall den Diff-Stand
  // mit dem Vorher-Stand. Explizite Verortung behebt die Mehrdeutigkeit.
  // DECISIONS #130: diese Klarstellung ist die eigentliche ROOT-CAUSE-Abhilfe
  // für D1 und bleibt deshalb bestehen, auch nachdem das Kollisions-Netz
  // wieder zurückgebaut wurde.
  it("verortet den Nachher-Stand explizit unter 'ALLE NOTIZBÜCHER' statt vage 'oben im Dokument'", () => {
    const t = buildFeedbackTrigger("X", "");
    expect(t).toContain("bereits unter ALLE NOTIZBÜCHER (Stand NACH der Änderung) im Dokument");
    expect(t).not.toContain("oben im Dokument");
  });

  it("erklärt die Diff-Legende (+ = bereits enthalten, − = entfernt) direkt am Diff", () => {
    const t = buildFeedbackTrigger("X", "+ neu\n− alt");
    expect(t).toContain("Diff der Änderung:");
    expect(t).toContain("\"+ \" = hinzugefügt, im Dokumentstand BEREITS enthalten");
    expect(t).toContain("\"− \" = entfernt");
  });

  it("bettet einen übergebenen Fakten-Block VOR dem Diff ein", () => {
    const t = buildFeedbackTrigger("X", "+ neu", "„x“: 1×");
    expect(t).toContain("Vom Code ermittelte Fakten zur Änderung");
    expect(t).toContain("„x“: 1×");
    expect(t.indexOf("„x“: 1×")).toBeLessThan(t.indexOf("Diff der Änderung:"));
  });

  it("lässt den Fakten-Block bei leerem factsText komplett weg (Standardfall, Rückwärtskompatibilität)", () => {
    const ohneArg = buildFeedbackTrigger("X", "+ neu");
    const mitLeer = buildFeedbackTrigger("X", "+ neu", "");
    expect(ohneArg).toBe(mitLeer);
    expect(ohneArg).not.toContain("Vom Code ermittelte Fakten");
  });

  // DECISIONS #130 (Nutzerentscheidung, Rückbau des #118–#129-Netzes): der
  // Fakten-Block-Kopf behauptet KEINE Gewissheit mehr für einzelne Zählungen
  // ("nur „genau 1×“ ist verlässlich geprüft" ist ENTFERNT) – die Zählung
  // ist zwar immer exakt richtig (String-Gleichheit), deckt aber NUR
  // identischen Markdown-Wortlaut ab, keine anders formatierten Varianten.
  it("Fakten-Block-Kopf beschreibt die exakte Zählung und ihre Formatierungsgrenzen (DECISIONS #130)", () => {
    const t = buildFeedbackTrigger("X", "+ neu", "„x“: 1×");
    expect(t).toContain("Zählung nach identischem Markdown-Wortlaut");
    expect(t).toContain("anders formatierte Zeilen wie Fett, Farbe, Link, Formel oder Tabelle zählen NICHT mit");
    expect(t).toContain("bei Verdacht auf eine inhaltliche Dublette bitte selbst prüfen und den Unterschied benennen");
    expect(t).not.toContain("genau 1×");
    expect(t).not.toContain("zähle NICHT selbst nach");
  });

  // Review-Nachbesserung (🟡, DECISIONS #131): der Fakten-Block-Kopf nennt
  // jetzt zusätzlich die Zeitbasis (Stand NACH der Änderung, hinzugefügte
  // Zeile selbst mitgezählt) – das war die eigentliche D1-Root-Cause: "1×"
  // allein passt auch zur Fehllesung "existierte schon vorher + neue Zeile
  // dazu = 2, davon 1 gemeldet"; explizit "NACH der Änderung, mitgezählt"
  // schließt diese Lesart aus.
  it("Fakten-Block-Kopf nennt die Zeitbasis 'NACH der Änderung, hinzugefügte Zeile mitgezählt' (DECISIONS #131)", () => {
    const t = buildFeedbackTrigger("X", "+ neu", "„x“: 1×");
    expect(t).toContain("im Stand NACH der Änderung");
    expect(t).toContain("die hinzugefügte Zeile selbst mitgezählt");
  });
});

describe("isNoFeedback", () => {
  it("erkennt leere/whitespace-only Antworten als 'nichts zu melden'", () => {
    expect(isNoFeedback("")).toBe(true);
    expect(isNoFeedback("   \n  ")).toBe(true);
    expect(isNoFeedback(undefined)).toBe(true);
    expect(isNoFeedback(null)).toBe(true);
  });

  it("erkennt den exakten Sentinel und Variationen mit Satzzeichen/Groß-Klein", () => {
    expect(isNoFeedback("##OK##")).toBe(true);
    expect(isNoFeedback("ok")).toBe(true);
    expect(isNoFeedback("Ok.")).toBe(true);
    expect(isNoFeedback("OKAY")).toBe(true);
    expect(isNoFeedback("Notiert.")).toBe(true);
    expect(isNoFeedback("notiert")).toBe(true);
  });

  it("erkennt bekannte Floskeln", () => {
    expect(isNoFeedback("Alles konsistent, keine Auffälligkeiten.")).toBe(true);
    expect(isNoFeedback("Alles in Ordnung soweit.")).toBe(true);
    expect(isNoFeedback("Keine Auffälligkeiten in diesem Notizbuch.")).toBe(true);
    expect(isNoFeedback("Passt so.")).toBe(true);
  });

  it("v7.10: erkennt ##OK## IRGENDWO im Text, auch mit Vorab-Text kombiniert", () => {
    // Der zweite v7.7-Defekt: buildChatReply kombiniert Vorab-Text + reply zu
    // "<Vorab-Text>\n\n##OK##" – der Sentinel steht dann nicht mehr allein.
    expect(isNoFeedback("Kurzer Einschub vorweg.\n\n##OK##")).toBe(true);
    expect(isNoFeedback("Text davor ##OK## Text danach")).toBe(true);
  });

  it("meldet eine echte Beobachtung als NICHT 'nichts zu melden'", () => {
    expect(isNoFeedback("Der neue Eintrag widerspricht dem Termin vom 2026-01-10 im Abschnitt Termine."))
      .toBe(false);
  });

  it("lässt sich NICHT von 'ok' als Wortteil täuschen (kein Fuzzy-Match)", () => {
    expect(isNoFeedback("Risiko okkult – bitte prüfen.")).toBe(false);
    expect(isNoFeedback("Das wirkt provokant und unklar.")).toBe(false);
  });
});

describe("dedupeFeedbackParagraphs", () => {
  // Echter (leicht gekürzter) Beleg-Fall aus dem v7.11-E2E-Retest: dieselbe
  // Beobachtung (Widerspruch zur vorherigen Deadline-Aussage) taucht ZWEIMAL
  // im selben reply auf, komplett anders formuliert.
  const ABSATZ_1 =
    "Achtung: Meine vorherige Bestätigung „QA-Deadline am 30.07.2026“ steht im Widerspruch zum " +
    "Dokument – dort ist der 30.07 explizit als nicht mehr gültig vermerkt, verbindlich ist der " +
    "2026-08-15. Der Nutzer hat das offenbar korrigiert/bestätigt, aber die Fett-Änderung selbst " +
    "ist inhaltlich neutral.";
  const ABSATZ_2 =
    "Achtung: Meine vorherige Notiz „QA-Deadline am 30.07.2026“ widerspricht dem aktuellen " +
    "Dokumentstand – dort steht ausdrücklich, dass der 30.07 NICHT mehr gültig ist und stattdessen " +
    "der 2026-08-15 verbindlich gilt. Die eigentliche Änderung (Fettschrift) ist inhaltlich " +
    "neutral, aber der Widerspruch zur vorherigen Chat-Aussage sollte geklärt werden.";

  it("Beleg-Paraphrase-Fall (v7.11-Live-Finding): bleibt bewusst ZWEIABSÄTZIG", () => {
    // v7.11-Nachbesserung (Review-Fund, mit Messungen widerlegt): Ein
    // Jaccard-Zweig hätte diesen Fall erkannt (~0,4237 Wort-Overlap), aber
    // fünf realistische Paare aus je ZWEI EIGENSTÄNDIGEN Beobachtungen zum
    // selben Abschnitt (paralleler Mehr-Befund-Stil, gleiches Satzgerüst)
    // maßen 0,55–0,87 Jaccard – HÖHER als dieser echte Paraphrase-Fall. Die
    // Metrik ist für dieses Problem invertiert; es gibt keinen
    // funktionierenden Schwellwert (siehe DECISIONS.md #57 und den
    // Funktionskommentar in feedback.js). Deshalb bleibt dieser Fall nach
    // dem Code UNGEMERGED – der Schutz davor ist jetzt ALLEIN die
    // Prompt-Klausel 4 in buildFeedbackTrigger ("EIN kompakter Absatz").
    // Akzeptiertes Restrisiko: Hält sich das Modell nicht an die Klausel,
    // bleibt die Doppelung sichtbar – das ist besser als das Alternativ-
    // Risiko, eine echte zweite Beobachtung stillschweigend zu verlieren.
    const reply = ABSATZ_1 + "\n\n" + ABSATZ_2;
    expect(dedupeFeedbackParagraphs(reply)).toBe(reply);
  });

  it("Review-Template-Fall: zwei EIGENSTÄNDIGE Befunde im selben Satzgerüst bleiben beide (kein False Positive)", () => {
    // Exakt das vom Review benannte Muster: paralleler Mehr-Befund-Stil,
    // fast identisches Satzgerüst, aber inhaltlich verschiedene Aussage
    // ("Beleg" vs. "Datum") – hoher Wort-Overlap, trotzdem KEINE Dublette.
    const a = "Im Abschnitt Termine fehlt zur QA-Deadline 2026-08-15 ein Beleg – bitte Quelle ergänzen.";
    const b = "Im Abschnitt Termine fehlt zur QA-Deadline 2026-08-15 das Datum der Bestätigung – bitte ergänzen.";
    const reply = a + "\n\n" + b;
    expect(dedupeFeedbackParagraphs(reply)).toBe(reply);
  });

  it("zwei inhaltlich verschiedene Beobachtungen (verschiedene Themen, ähnliche Länge) bleiben beide", () => {
    const a = "Der Abschnitt Einkaufsliste enthält inzwischen drei Einträge zu Milchprodukten, die " +
      "sich mit dem bestehenden Eintrag unter Vorräte überschneiden könnten – prüfe bei Gelegenheit, " +
      "ob eine Zusammenführung sinnvoll ist.";
    const b = "Im Notizbuch Reisen fehlt weiterhin ein konkretes Rückreisedatum für die Konferenz im " +
      "Mai, obwohl der Flug bereits gebucht wurde – das könnte bei der Hotelbuchung zu Problemen führen.";
    const reply = a + "\n\n" + b;
    expect(dedupeFeedbackParagraphs(reply)).toBe(reply);
  });

  it("exakte Wiederholung (nur Whitespace/Groß-Klein/Interpunktion anders) wird gemergt", () => {
    const a = "Der Abschnitt Termine enthält jetzt zwei sich widersprechende Einträge zum " +
      "Projektabschluss – bitte klären, welcher Termin gilt.";
    // Inhaltlich exakt dasselbe – nur Kleinschreibung, doppeltes Leerzeichen
    // und fehlender Schlusspunkt unterscheiden (reine Formatierung).
    const aVariante = "der abschnitt termine  enthält jetzt zwei sich widersprechende Einträge zum " +
      "Projektabschluss – bitte klären, welcher Termin gilt";
    const reply = a + "\n\n" + aVariante;
    expect(dedupeFeedbackParagraphs(reply)).toBe(a);
  });

  it("Einzelabsatz bleibt unverändert (kein Split, kein Vergleich möglich)", () => {
    expect(dedupeFeedbackParagraphs(ABSATZ_1)).toBe(ABSATZ_1);
    expect(dedupeFeedbackParagraphs("")).toBe("");
  });

  it("Fence-Guard: enthält reply einen ```-Codeblock, bleibt der Text komplett unangetastet (auch bei exakter Wiederholung)", () => {
    const a = "Der Abschnitt Termine enthält jetzt zwei sich widersprechende Einträge zum " +
      "Projektabschluss – bitte klären, welcher Termin gilt.";
    const aVariante = "der abschnitt termine enthält jetzt zwei sich widersprechende Einträge zum " +
      "Projektabschluss – bitte klären, welcher Termin gilt";
    const reply = a + "\n\n```js\nconst x = 1;\n```\n\n" + aVariante;
    expect(dedupeFeedbackParagraphs(reply)).toBe(reply);
  });

  it("Kurz-Absatz-Schutz: Absätze unter 5 Tokens werden NIE als Dublette gewertet (auch bei exakter Gleichheit)", () => {
    const reply = "Danke.\n\nDanke.\n\n" + ABSATZ_1;
    expect(dedupeFeedbackParagraphs(reply)).toBe(reply);
  });

  it("behält den ERSTEN Absatz bei mehreren exakten Dubletten und erhält die Reihenfolge der übrigen", () => {
    const a = "Der Abschnitt Termine enthält jetzt zwei sich widersprechende Einträge zum " +
      "Projektabschluss – bitte klären, welcher Termin gilt.";
    const aVariante = "der abschnitt termine enthält jetzt zwei sich widersprechende Einträge zum " +
      "Projektabschluss – bitte klären, welcher Termin gilt";
    const eigenstaendig = "Der Abschnitt Reisen erwähnt weiterhin kein Rückreisedatum für die " +
      "Konferenz im Mai, obwohl der Flug längst gebucht wurde.";
    const reply = a + "\n\n" + eigenstaendig + "\n\n" + aVariante;
    expect(dedupeFeedbackParagraphs(reply)).toBe(a + "\n\n" + eigenstaendig);
  });
});

/* -------------------------------------------------------------------- */
/* v7.57.1 (DECISIONS #118, E2E-Befund D1): Fakten-Ermittlung.           */
/* v7.57.1 (DECISIONS #130, Nutzerentscheidung): das zwischenzeitlich      */
/* gewachsene Kollisions-"Netz" (looseKey()/buildDuplicateFactNote() samt   */
/* Chat-Anhang, siehe Git-Historie #118/#120–#129) ist ENTFERNT – die       */
/* Zählung unten prüft AUSSCHLIESSLICH auf exakte String-Gleichheit nach    */
/* trim(), ohne jede Bewertung.                                            */
/* -------------------------------------------------------------------- */

// Nachbau des Live-Falls (QA-Repo tschachim/notizbuch-data-qa, Commit
// 02f1d026): "QA-Edit Beta" wird in QA-Test → Allgemein → Inbox NEU
// ergänzt; derselbe MARKDOWN-WORTLAUT steht bereits in Wissensbasis → QA →
// QA-Ergebnisse. (Die echten Live-Dokumente unterschieden sich minimal in
// der Checkbox-Syntax – seit #130 zählt NUR noch exakter Wortlaut, die
// Wissensbasis-Zeile ist hier deshalb bewusst WORTGLEICH nachgebaut, um den
// "identischer Wortlaut auch anderswo"-Fakt zu demonstrieren.)
const QA_TEST_BEFORE = [
  "# QA-Test", "", "# Allgemein", "", "## Inbox", "",
  "- [ ] Kaffee mit Sarah (Dienstag, 2026-09-29)", "",
].join("\n");
const QA_TEST_AFTER = [
  "# QA-Test", "", "# Allgemein", "", "## Inbox", "",
  "- [ ] Kaffee mit Sarah (Dienstag, 2026-09-29)",
  "- [ ] **QA-Edit Beta**", "",
].join("\n");
const WISSENSBASIS_DOC = [
  "# Wissensbasis", "", "# QA", "", "## QA-Ergebnisse", "",
  "- [ ] **QA-Edit Beta**", "",
].join("\n");

describe("buildFeedbackFacts", () => {
  // Umbenannt (Review-Nachbesserung, DECISIONS #131): "Wissensbasis" ist hier
  // bewusst WORTGLEICH nachgebaut (siehe Kommentar bei WISSENSBASIS_DOC oben)
  // – das demonstriert die Cross-Notizbuch-Meldung bei echter Übereinstimmung,
  // ist aber NICHT der reale Live-Fall (dort weicht die Checkbox-Syntax ab,
  // siehe Test "anderes Notizbuch OHNE identischen Wortlaut" unten).
  it("identischer Wortlaut in anderem Notizbuch: activeCount 1, Fundort exakt gepinnt (Kapitel/Abschnitt/Zeile)", () => {
    const diff = diffLines(QA_TEST_BEFORE, QA_TEST_AFTER);
    const notebooks = [{ name: "QA-Test", doc: QA_TEST_AFTER }, { name: "Wissensbasis", doc: WISSENSBASIS_DOC }];
    const facts = buildFeedbackFacts(diff, notebooks, "QA-Test");
    expect(facts).toHaveLength(1);
    const f = facts[0];
    expect(f.text).toBe("- [ ] **QA-Edit Beta**");
    expect(f.activeCount).toBe(1);
    expect(f.chapter).toBe("Allgemein");
    expect(f.section).toBe("Inbox");
    expect(f.lineNo).toBe(8); // Mutationsprobe: "lineNo: at" statt "at + 1" (off-by-one) macht dies rot
    expect(f.elsewhere).toEqual([{ notebook: "Wissensbasis", chapter: "QA", section: "QA-Ergebnisse" }]);
    expect(formatFeedbackFacts(facts, "QA-Test")).toContain("Allgemein → Inbox, Zeile 8");
  });

  // Review-Nachbesserung (🟡, DECISIONS #131): der REALE Live-Fall (QA-Repo
  // tschachim/notizbuch-data-qa) hatte in "Wissensbasis" eine ANDERE
  // Checkbox-Syntax ("- [x] QA-Edit Beta" statt "- [ ] **QA-Edit Beta**") –
  // unter der seit #130 geltenden exakten Zählung ist das bewusst KEIN
  // Treffer. Dieser Grenzfall war ungetestet (Review-Fund); Mutationsprobe:
  // ein `if (true)`-Mutant an der `firstIdx !== -1`-Stelle in
  // buildFeedbackFacts() (meldet JEDES andere Notizbuch als Treffer) macht
  // genau diesen Test rot, alle anderen bleiben grün.
  it("anderes Notizbuch OHNE identischen Wortlaut (echte Live-Syntax) -> kein elsewhere", () => {
    const wb = WISSENSBASIS_DOC.replace("- [ ] **QA-Edit Beta**", "- [x] QA-Edit Beta");
    const nbs = [
      { name: "QA-Test", doc: QA_TEST_AFTER },
      { name: "Wissensbasis", doc: wb },
      { name: "Leer", doc: "# Leer\n" },
    ];
    const { facts, trigger } = buildFeedbackRequest(
      diffLines(QA_TEST_BEFORE, QA_TEST_AFTER), "+ - [ ] **QA-Edit Beta**", nbs, "QA-Test"
    );
    expect(facts[0].elsewhere).toEqual([]);
    expect(trigger).not.toContain("identischer Wortlaut auch in");
  });

  // Review-Nachbesserung (🟡, DECISIONS #131): exakte Suche statt Teilstring
  // – eine Zeile, die den Fakt-Wortlaut nur als TEIL eines längeren Satzes
  // enthält, ist NICHT derselbe Wortlaut. Mutationsprobe: ersetzt man
  // `onb.trimmed.indexOf(trimmed)` durch eine Teilstring-Suche
  // (`onb.trimmed.some(l => l.includes(trimmed))`), wird dieser Test rot.
  it("Teilstring-Treffer in einem anderen Notizbuch zählt NICHT als identischer Wortlaut", () => {
    const before = "# N\n\n## Inbox\n\nAlt\n";
    const after = before + "- QA-Edit Beta\n";
    const diff = diffLines(before, after);
    const notebooks = [
      { name: "N", doc: after },
      { name: "Anderes", doc: "# Anderes\n\n## Kap\n\n- QA-Edit Beta (Termin folgt)\n" },
    ];
    const facts = buildFeedbackFacts(diff, notebooks, "N");
    expect(facts[0].elsewhere).toEqual([]);
  });

  // Review-Nachbesserung (🟡, DECISIONS #131): Fundort muss die TATSÄCHLICH
  // HINZUGEFÜGTE Zeile sein, nicht die erste (bereits vorher bestehende)
  // gleichlautende Zeile im Dokument. Mutationsprobe: ersetzt man den
  // Positions-Zähler `idx` durch `newLines.indexOf(trimmed)` (erste
  // Fundstelle statt tatsächlicher Diff-Position), meldet dieser Test
  // fälschlich Kapitel "Eins" statt "Zwei".
  it("Fundort ist die HINZUGEFÜGTE Zeile, nicht die erste bereits bestehende gleichlautende Zeile", () => {
    const before = "# N\n\n# Eins\n\n- Dup\n\n# Zwei\n\n- Alt\n";
    const after = before.replace("- Alt\n", "- Alt\n- Dup\n");
    const diff = diffLines(before, after);
    const facts = buildFeedbackFacts(diff, [{ name: "N", doc: after }], "N");
    expect(facts).toHaveLength(1);
    expect(facts[0].chapter).toBe("Zwei");
    expect(facts[0].activeCount).toBe(2);
  });

  // Review-Nachbesserung (🟡, DECISIONS #131): Abschnitt (##) muss beim
  // nächsten Kapitel (#) zurückgesetzt werden, sonst "erbt" eine Zeile ohne
  // eigenen Abschnitt fälschlich den Abschnitt des VORHERIGEN Kapitels.
  // Mutationsprobe: entfernt man `section = null` beim Kapitelwechsel in
  // locateLine(), bleibt "Inbox" fälschlich als Abschnitt stehen.
  it("Abschnitt wird beim Kapitelwechsel zurückgesetzt (kein Vererben aus dem vorigen Kapitel)", () => {
    const before = "# N\n\n# Eins\n\n## Inbox\n\n- Alt\n\n# Zwei\n\nNoch kein Abschnitt hier\n";
    const after = before + "- Neu\n";
    const diff = diffLines(before, after);
    const facts = buildFeedbackFacts(diff, [{ name: "N", doc: after }], "N");
    expect(facts).toHaveLength(1);
    expect(facts[0].chapter).toBe("Zwei");
    expect(facts[0].section).toBe(null);
  });

  // Review-Nachbesserung (🟡, DECISIONS #131): Fence-Maskierung darf nicht
  // ignoriert werden – eine "# "-Zeile INNERHALB eines ```-Codeblocks ist
  // KEIN echtes Kapitel. Mutationsprobe: entfernt man den `mask[i]`-Guard in
  // locateLine(), würde "Kap" fälschlich durch "kommentar" ersetzt.
  it("eine '# kommentar'-Zeile INNERHALB eines ```-Blocks ist KEIN Kapitel", () => {
    const before = "# N\n\n# Kap\n\n```bash\n# kommentar\n```\n\nalt\n";
    const after = before.replace("alt\n", "alt\nneu\n");
    const diff = diffLines(before, after);
    const facts = buildFeedbackFacts(diff, [{ name: "N", doc: after }], "N");
    expect(facts).toHaveLength(1);
    expect(facts[0].chapter).toBe("Kap");
  });

  // Review-Nachbesserung (🟡, DECISIONS #131): die TITELZEILE selbst ist kein
  // Kapitel (titleLineIdx-Ausschluss), und die Zeilennummer ist 1-basiert.
  // Mutationsprobe: entfernt man den `i === tIdx`-Ausschluss in locateLine(),
  // würde "N" (der Notizbuchname) fälschlich als Kapitel gemeldet.
  it("Fundort: Titel ist kein Kapitel, Zeile ist 1-basiert", () => {
    const before = "# N\n\n## Inbox\n\n- a\n";
    const after = before.replace("- a\n", "- a\n- b\n");
    const diff = diffLines(before, after);
    const facts = buildFeedbackFacts(diff, [{ name: "N", doc: after }], "N");
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ chapter: null, section: "Inbox", lineNo: 6 });
    expect(formatFeedbackFacts(facts, "N")).toContain("Inbox, Zeile 6)");
  });

  it("identische Zeile 2x im aktiven Notizbuch: activeCount 2, trotzdem nur EIN Fakt (dedupliziert)", () => {
    const after = QA_TEST_AFTER.replace(
      "- [ ] **QA-Edit Beta**\n",
      "- [ ] **QA-Edit Beta**\n- [ ] **QA-Edit Beta**\n"
    );
    const diff = diffLines(QA_TEST_BEFORE, after);
    const facts = buildFeedbackFacts(diff, [{ name: "QA-Test", doc: after }], "QA-Test");
    expect(facts).toHaveLength(1);
    expect(facts[0].activeCount).toBe(2);
  });

  // DECISIONS #130: der Kern der Nutzerentscheidung – anders formatierte,
  // aber optisch ähnliche Zeilen (hier: Klartext vs. Fett) zählen NICHT mehr
  // als Kollision. Vor #130 hätte looseKey() beide Zeilen auf denselben
  // groben Schlüssel reduziert (activeCount 2); seit #130 ist der exakte
  // Markdown-Wortlaut maßgeblich, activeCount bleibt bei 1.
  it("nur ANDERS formatiert (Fett statt Klartext) zählt NICHT als Kollision – EXAKTE Zählung bleibt bei 1×", () => {
    const before = "# N\n\n## Inbox\n\n- QA-Edit Beta\n";
    const after = before + "- **QA-Edit Beta**\n"; // gleicher sichtbarer Text, ANDERE Markdown-Syntax
    const diff = diffLines(before, after);
    const facts = buildFeedbackFacts(diff, [{ name: "N", doc: after }], "N");
    expect(facts).toHaveLength(1);
    expect(facts[0].text).toBe("- **QA-Edit Beta**");
    expect(facts[0].activeCount).toBe(1);
  });

  // Review-Abschluss (🟡): pinnt die EXAKTHEIT der activeCount-Zählung im
  // aktiven Notizbuch. Mutationsprobe: `t === trimmed` -> `t.includes(trimmed)`
  // (oder ein Vergleich ohne Groß-/Kleinschreibung) würde hier 2× melden
  // (beide Mutationen zusammen 3×) und das Modell damit genau in die
  // D1-Fehllesung schicken.
  it("aktives Notizbuch: Teilstring oder andere Groß-/Kleinschreibung zählt NICHT mit (exakt 1×)", () => {
    const before = "# N\n\n## Inbox\n\n- Milch kaufen (Aldi)\n- milch\n";
    const after = before + "- Milch\n";
    const [f] = buildFeedbackFacts(diffLines(before, after), [{ name: "N", doc: after }], "N");
    expect(f.text).toBe("- Milch");
    expect(f.activeCount).toBe(1);
  });

  it("Whitespace am Zeilenrand wird beim Vergleich ignoriert (String-Gleichheit NACH trim())", () => {
    const before = "# N\n\n## Inbox\n\n- Bestand\n";
    const after = before + "  - Bestand  \n"; // gleicher Wortlaut, nur mit Einzug/Trailing-Space
    const diff = diffLines(before, after);
    const facts = buildFeedbackFacts(diff, [{ name: "N", doc: after }], "N");
    expect(facts).toHaveLength(1);
    expect(facts[0].activeCount).toBe(2); // "- Bestand" und "  - Bestand  " sind nach trim() identisch
  });

  it("leere hinzugefügte Zeilen liefern KEINEN Fakt, entfernte Zeilen ebenfalls nicht", () => {
    const before = "# N\n\n## Inbox\n\nZeile weg\n";
    const after = "# N\n\n## Inbox\n\n\nZeile neu\n";
    const diff = diffLines(before, after);
    const facts = buildFeedbackFacts(diff, [{ name: "N", doc: after }], "N");
    expect(facts.map((f) => f.text)).toEqual(["Zeile neu"]);
  });

  // DECISIONS #130 (bewusster Verzicht auf Sonderregeln, Nutzerentscheidung
  // "kein Einzel-Guard-Muster"): vor #130 wurde eine hinzugefügte
  // Überschrift NIE selbst zu einem Fakt (BLANK_OR_HEADING_RE) – seit #130
  // gibt es diese Ausnahme nicht mehr, eine Überschrift zählt wie jede
  // andere Zeile.
  it("eine hinzugefügte ÜBERSCHRIFT zählt jetzt normal als Fakt (anders als vor #130)", () => {
    const before = "# N\n\n## Inbox\n\nAlt\n";
    const after = before + "## Neuer Abschnitt\n\nNeuer Text\n";
    const diff = diffLines(before, after);
    const facts = buildFeedbackFacts(diff, [{ name: "N", doc: after }], "N");
    expect(facts.map((f) => f.text)).toEqual(["## Neuer Abschnitt", "Neuer Text"]);
    expect(facts.every((f) => f.activeCount === 1)).toBe(true);
  });

  // DECISIONS #130: vor #130 wurde eine Zeile INNERHALB eines ```-Codeblocks
  // NIE selbst zu einem Fakt (machte das Ergebnis höchstens "uncertain") –
  // seit #130 gibt es kein `uncertain`-Konzept mehr, die Zeile zählt normal.
  it("eine hinzugefügte Zeile INNERHALB eines ```-Codeblocks zählt jetzt normal als Fakt", () => {
    const before = "# N\n\n## Bash\n\n```\nold\n```\n";
    const after = "# N\n\n## Bash\n\n```\nold\nnew-code-line\n```\n";
    const diff = diffLines(before, after);
    const facts = buildFeedbackFacts(diff, [{ name: "N", doc: after }], "N");
    expect(facts).toHaveLength(1);
    expect(facts[0].text).toBe("new-code-line");
    expect(facts[0].activeCount).toBe(1);
  });

  it("diff === null (z. B. diffLines() bei >400k Zellen): liefert leere Fakten statt zu werfen", () => {
    expect(buildFeedbackFacts(null, [{ name: "N", doc: "x" }], "N")).toEqual([]);
  });

  it("unbekannter activeName (Notizbuch nicht in der Liste): liefert leere Fakten", () => {
    const diff = diffLines("a\n", "a\nb\n");
    expect(buildFeedbackFacts(diff, [{ name: "Anderes", doc: "a\nb\n" }], "N")).toEqual([]);
  });

  it("deckelt auf höchstens 20 eigenständige Fakten (Kosten/Latenz-Deckel wie DIFF_CAP)", () => {
    const beforeLines = ["# N", "", "## Inbox", ""];
    const afterLines = [...beforeLines];
    for (let i = 0; i < 25; i++) afterLines.push("- Punkt " + i);
    const diff = diffLines(beforeLines.join("\n"), afterLines.join("\n"));
    const facts = buildFeedbackFacts(diff, [{ name: "N", doc: afterLines.join("\n") }], "N");
    expect(facts).toHaveLength(20);
    expect(facts[0].text).toBe("- Punkt 0");
    expect(facts[19].text).toBe("- Punkt 19");
  });

  it("Escaping/Sonderzeichen: eine Zeile mit eingebetteten Anführungszeichen bleibt UNVERÄNDERT als Fakt-Text erhalten", () => {
    const before = "# N\n\n## Inbox\n\nAlt\n";
    const after = before + '- Sage "Hallo" zu Bob\n';
    const diff = diffLines(before, after);
    const facts = buildFeedbackFacts(diff, [{ name: "N", doc: after }], "N");
    expect(facts).toHaveLength(1);
    expect(facts[0].text).toBe('- Sage "Hallo" zu Bob');
  });

  // Review-Nachbesserung (🟡, DECISIONS #131): der bisherige Escaping-Test
  // nutzte ASCII-Anführungszeichen (") – die kollidieren NIE mit den
  // typografischen Begrenzern „ “, die formatFeedbackFacts() um das Zitat
  // legt, und können deshalb keinen Escaping-Fehler aufdecken. Diese Variante
  // nutzt dieselben typografischen Zeichen wie die Begrenzer selbst.
  it("Escaping/Sonderzeichen: eine Zeile mit typografischen „…“-Anführungszeichen bleibt unverändert erhalten", () => {
    const before = "# N\n\n## Inbox\n\nAlt\n";
    const after = before + "- Termin „Kaffee“ verschieben\n";
    const diff = diffLines(before, after);
    const facts = buildFeedbackFacts(diff, [{ name: "N", doc: after }], "N");
    expect(facts).toHaveLength(1);
    expect(facts[0].text).toBe("- Termin „Kaffee“ verschieben");
  });
});

describe("formatFeedbackFacts", () => {
  it("formatiert genau EINE Zeile pro Fakt mit Notizbuch/Pfad/Zeile + Cross-Notizbuch-Hinweis, OHNE Bewertung (DECISIONS #130)", () => {
    const diff = diffLines(QA_TEST_BEFORE, QA_TEST_AFTER);
    const notebooks = [{ name: "QA-Test", doc: QA_TEST_AFTER }, { name: "Wissensbasis", doc: WISSENSBASIS_DOC }];
    const facts = buildFeedbackFacts(diff, notebooks, "QA-Test");
    const text = formatFeedbackFacts(facts, "QA-Test");
    expect(text).toContain("„- [ ] **QA-Edit Beta**“");
    // Review-Nachbesserung (🟡, DECISIONS #131): "nach der Änderung X×" statt
    // der bloßen Zahl – nennt explizit die Zeitbasis (siehe D1-Root-Cause).
    expect(text).toContain("im Notizbuch „QA-Test“ nach der Änderung 1×");
    expect(text).toContain("mitgezählt");
    expect(text).toContain("Allgemein → Inbox");
    expect(text).toContain("identischer Wortlaut auch in „Wissensbasis“ (QA → QA-Ergebnisse)");
    // DECISIONS #130: KEINE Bewertung mehr – weder "genau einmal"/"kein
    // zweiter Eintrag" noch "Dublette"/"unsicher".
    expect(text).not.toContain("genau einmal");
    expect(text).not.toContain("Dublette");
    expect(text).not.toContain("unsicher");
  });

  it("meldet mehrfache Vorkommen ebenfalls nur als nackte Zahl, ohne Bewertung", () => {
    const text = formatFeedbackFacts(
      [{ text: "x", chapter: null, section: null, lineNo: 3, activeCount: 2, elsewhere: [] }], "N"
    );
    expect(text).toContain("im Notizbuch „N“ nach der Änderung 2×");
    expect(text).not.toContain("Dublette");
    expect(text).not.toContain("unsicher");
  });

  it("kürzt sehr lange Fakten-Zeilen im ANGEZEIGTEN Zitat auf 160 Zeichen (Kosten-Deckel)", () => {
    const langerText = "x".repeat(200);
    const text = formatFeedbackFacts(
      [{ text: langerText, chapter: null, section: null, lineNo: 1, activeCount: 1, elsewhere: [] }], "N"
    );
    expect(text).toContain("x".repeat(157) + "…");
    expect(text).not.toContain(langerText);
  });

  it("ohne Cross-Notizbuch-Treffer bleibt der Zusatzsatz weg", () => {
    const text = formatFeedbackFacts(
      [{ text: "x", chapter: null, section: null, lineNo: 1, activeCount: 1, elsewhere: [] }], "N"
    );
    expect(text).not.toContain("identischer Wortlaut auch in");
  });

  it("leere/keine Fakten liefern einen leeren String", () => {
    expect(formatFeedbackFacts([], "N")).toBe("");
    expect(formatFeedbackFacts(null, "N")).toBe("");
  });

  it("Escaping von Anführungszeichen: ein Fakt-Text mit eingebetteten \"-Zeichen bleibt unverändert innerhalb der „ “-Klammer stehen", () => {
    const text = formatFeedbackFacts(
      [{ text: '- Sage "Hallo" zu Bob', chapter: null, section: null, lineNo: 1, activeCount: 1, elsewhere: [] }], "N"
    );
    expect(text).toContain('„- Sage "Hallo" zu Bob“');
  });

  // Review-Nachbesserung (🟡, DECISIONS #131): ASCII-Anführungszeichen (")
  // kollidieren nie mit den typografischen Begrenzern „ “ – dieser Test
  // nutzt dieselben Zeichen wie die Begrenzer selbst (Zitat-in-Zitat) und
  // pinnt das gewählte Verhalten: der Fakt-Text bleibt unverändert stehen,
  // die äußeren Begrenzer bleiben eindeutig am Anfang/Ende des Zitats.
  it("Escaping: ein Fakt-Text mit eingebetteten typografischen „…“-Zeichen bleibt unverändert erhalten", () => {
    const text = formatFeedbackFacts(
      [{ text: "- Termin „Kaffee“ verschieben", chapter: null, section: null, lineNo: 1, activeCount: 1, elsewhere: [] }], "N"
    );
    expect(text).toContain("„- Termin „Kaffee“ verschieben“");
  });
});

describe("buildFeedbackRequest", () => {
  // Live-Fall D1 als End-to-End-Test: die echte Ergänzung "- [ ] **QA-Edit
  // Beta**" ist im aktiven Notizbuch neu und kommt dort genau 1× vor; der
  // identische Markdown-Wortlaut steht bereits in "Wissensbasis" – GENAU
  // diese beiden Fakten (kein Datenverlust, keine echte Dublette IM aktiven
  // Notizbuch, aber ein Hinweis auf denselben Wortlaut anderswo) sind das,
  // was dem Modell laut DECISIONS #130 verlässlich mitgeteilt werden soll.
  it("Live-Fall D1 End-to-End: Fakt meldet 1× im aktiven Notizbuch, identischer Wortlaut auch in Wissensbasis", () => {
    const diff = diffLines(QA_TEST_BEFORE, QA_TEST_AFTER);
    const notebooks = [{ name: "QA-Test", doc: QA_TEST_AFTER }, { name: "Wissensbasis", doc: WISSENSBASIS_DOC }];
    const { trigger, facts } = buildFeedbackRequest(diff, "+ - [ ] **QA-Edit Beta**", notebooks, "QA-Test");
    expect(facts).toHaveLength(1);
    expect(facts[0].text).toBe("- [ ] **QA-Edit Beta**");
    expect(facts[0].activeCount).toBe(1);
    expect(facts[0].elsewhere).toEqual([{ notebook: "Wissensbasis", chapter: "QA", section: "QA-Ergebnisse" }]);
    expect(trigger).toContain("Vom Code ermittelte Fakten zur Änderung");
    // Review-Nachbesserung (🟡, DECISIONS #131): Zeitbasis explizit im Fakt
    // UND im Block-Kopf – nimmt dem Modell genau die D1-Fehllesung ab
    // ("existierte schon vorher" + "+"-Zeile zusätzlich gezählt).
    // Notizbuchname MIT im Fakt: pinnt die Verdrahtung nbName -> formatFeedbackFacts
    // in buildFeedbackRequest (Mutationsprobe: formatFeedbackFacts(facts, "") bliebe
    // sonst unbemerkt).
    expect(trigger).toContain("im Notizbuch „QA-Test“ nach der Änderung 1×");
    expect(trigger).toContain("mitgezählt");
    expect(trigger).toContain("identischer Wortlaut auch in „Wissensbasis“");
  });

  it("diff===null liefert leere Fakten, Trigger fällt auf den Gesamtdokument-Hinweis zurück", () => {
    const { trigger, facts } = buildFeedbackRequest(null, "", [{ name: "N", doc: "x" }], "N");
    expect(facts).toEqual([]);
    expect(trigger).toContain("Die Änderung ist umfangreich (kein kompakter Diff verfügbar) – prüfe das Gesamtdokument.");
    expect(trigger).not.toContain("Vom Code ermittelte Fakten");
  });
});

// v7.58 (DECISIONS #138): der MAX_FACTS-Deckel (20) wird dem Modell jetzt
// gesagt. Vertrag: ohne Kappung bleibt die Ausgabe BYTE-IDENTISCH zu vor
// v7.58; mit Kappung endet der Fakten-Block mit EINER Hinweiszeile, die die
// EXAKTE Zahl der nicht aufgeführten eigenständigen hinzugefügten Zeilen
// nennt (Zählregel wie bei Fakten: nicht-leer, nach trim() dedupliziert).
describe("MAX_FACTS-Deckel: Hinweis im Fakten-Block (v7.58, DECISIONS #138)", () => {
  const HEAD = ["# N", "", "## Inbox", ""];
  const punkte = (from, to) => Array.from({ length: to - from }, (_, i) => "- Punkt " + (from + i));
  // Diff/Notizbücher für "HEAD + hinzugefügte Zeilen" gegen den reinen HEAD-Stand.
  const setup = (added, beforeExtra = []) => {
    const before = [...HEAD, ...beforeExtra].join("\n");
    const after = [...HEAD, ...added].join("\n");
    return { diff: diffLines(before, after), notebooks: [{ name: "N", doc: after }] };
  };
  // Erste Zeile "- Punkt 0" steht in Dokumentzeile 5 (HEAD hat 4 Zeilen).
  const factLine = (i) =>
    "„- Punkt " + i + "“: im Notizbuch „N“ nach der Änderung 1× (diese hinzugefügte Zeile mitgezählt; Inbox, Zeile " + (5 + i) + ")";
  const factLines = (n) => Array.from({ length: n }, (_, i) => factLine(i));
  const HINT_1 = "Hinweis: Aufgeführt sind nur die ersten 20 eigenständigen hinzugefügten Zeilen; " +
    "für 1 weitere eigenständige hinzugefügte Zeile wurden keine Vorkommen ermittelt, sie ist hier nicht aufgeführt.";
  const hintN = (n) => "Hinweis: Aufgeführt sind nur die ersten 20 eigenständigen hinzugefügten Zeilen; " +
    "für " + n + " weitere eigenständige hinzugefügte Zeilen wurden keine Vorkommen ermittelt, sie sind hier nicht aufgeführt.";

  describe("ohne Kappung (<= 20): kein Hinweis, Ausgabe BYTE-IDENTISCH zu vor v7.58", () => {
    it("genau 20 eigenständige Zeilen: omitted 0, Text exakt die 20 Fakten-Zeilen", () => {
      const { diff, notebooks } = setup(punkte(0, 20));
      const { facts, omitted } = collectFeedbackFacts(diff, notebooks, "N");
      expect(facts).toHaveLength(20);
      expect(omitted).toBe(0);
      const expected = factLines(20).join("\n");
      expect(formatFeedbackFacts(facts, "N")).toBe(expected); // alter 2-Argument-Aufruf
      expect(formatFeedbackFacts(facts, "N", omitted)).toBe(expected);
      expect(expected).not.toContain("Hinweis");
    });

    it("Trigger bei 20 Fakten: exakt buildFeedbackTrigger mit den unveränderten Fakten-Zeilen, kein Hinweis", () => {
      const { diff, notebooks } = setup(punkte(0, 20));
      const { trigger, omitted } = buildFeedbackRequest(diff, "+ x", notebooks, "N");
      expect(omitted).toBe(0);
      expect(trigger).toBe(buildFeedbackTrigger("N", "+ x", factLines(20).join("\n")));
      expect(trigger).not.toContain("Hinweis: Aufgeführt");
    });

    it("wenige Fakten (3): ebenfalls ohne Hinweis", () => {
      const { diff, notebooks } = setup(punkte(0, 3));
      const { facts, omitted } = collectFeedbackFacts(diff, notebooks, "N");
      expect(omitted).toBe(0);
      expect(formatFeedbackFacts(facts, "N", omitted)).toBe(factLines(3).join("\n"));
    });
  });

  describe("mit Kappung: EXAKTE Zahl der nicht aufgeführten Zeilen", () => {
    it("21 eigenständige Zeilen: Hinweis mit '1' (Singular), die 20 Fakten-Zeilen davor unverändert", () => {
      const { diff, notebooks } = setup(punkte(0, 21));
      const { facts, omitted } = collectFeedbackFacts(diff, notebooks, "N");
      expect(facts).toHaveLength(20);
      expect(facts[19].text).toBe("- Punkt 19");
      expect(omitted).toBe(1);
      const lines = formatFeedbackFacts(facts, "N", omitted).split("\n");
      expect(lines).toHaveLength(21); // 20 Fakten + genau EINE Hinweiszeile
      expect(lines.slice(0, 20)).toEqual(factLines(20));
      expect(lines[20]).toBe(HINT_1);
    });

    it("20 Fakten + 10 überzählige Zeilen, darunter Duplikate und Leerzeilen: nur die 3 eigenständigen zählen (exakt 3)", () => {
      const overflow = [
        "- Punkt 20",
        "",                // Leerzeile: nie eine eigenständige Zeile
        "- Punkt 20",      // exaktes Duplikat einer überzähligen Zeile
        "   - Punkt 20  ", // nach trim() dasselbe
        "- Punkt 3",       // gleicher Wortlaut wie ein AUFGEFÜHRTER Fakt
        "  ",              // nur Leerraum
        "- Punkt 21",
        "- Punkt 22",
        "",
        "- Punkt 21",
      ];
      const { diff, notebooks } = setup([...punkte(0, 20), ...overflow]);
      const { facts, omitted } = collectFeedbackFacts(diff, notebooks, "N");
      expect(facts).toHaveLength(20);
      expect(omitted).toBe(3);
      const lines = formatFeedbackFacts(facts, "N", omitted).split("\n");
      expect(lines).toHaveLength(21);
      expect(lines[20]).toBe(hintN(3));
    });

    it("Duplikate INNERHALB der ersten 20 verbrauchen keinen Platz: 22 Zeilen mit 2 Duplikaten = 20 Fakten, omitted 0", () => {
      const { diff, notebooks } = setup([...punkte(0, 10), "- Punkt 3", ...punkte(10, 20), "- Punkt 0"]);
      const { facts, omitted } = collectFeedbackFacts(diff, notebooks, "N");
      expect(facts).toHaveLength(20);
      expect(omitted).toBe(0);
    });

    it("unveränderte und entfernte Zeilen zählen nicht mit", () => {
      const { diff, notebooks } = setup(["- Bestand", ...punkte(0, 21)], ["- Bestand", "- Alt"]);
      expect(diff.some((d) => d.t === "d" && d.l === "- Alt")).toBe(true);
      expect(diff.some((d) => d.t === "s" && d.l === "- Bestand")).toBe(true);
      const { facts, omitted } = collectFeedbackFacts(diff, notebooks, "N");
      expect(facts).toHaveLength(20);
      expect(omitted).toBe(1);
    });

    it("große Überzahl (120 eigenständige Zeilen): exakt 100 nicht aufgeführt, Text bleibt bei 21 Zeilen", () => {
      const { diff, notebooks } = setup(punkte(0, 120));
      const { facts, omitted } = collectFeedbackFacts(diff, notebooks, "N");
      expect(omitted).toBe(100);
      const lines = formatFeedbackFacts(facts, "N", omitted).split("\n");
      expect(lines).toHaveLength(21);
      expect(lines[20]).toBe(hintN(100));
    });

    it("buildFeedbackFacts behält Signatur und Ergebnis (nur das Array, KEIN Zusatz-Property)", () => {
      const { diff, notebooks } = setup(punkte(0, 25));
      const facts = buildFeedbackFacts(diff, notebooks, "N");
      expect(Array.isArray(facts)).toBe(true);
      expect(facts).toHaveLength(20);
      expect(Object.keys(facts)).toHaveLength(20); // nur die Indizes 0..19
    });
  });

  describe("Verdrahtung: Hinweis steht im fertigen Trigger-Text an der richtigen Stelle", () => {
    it("Fakten-Block endet mit der Hinweiszeile, direkt davor die 20. Fakten-Zeile, danach der Diff", () => {
      const { diff, notebooks } = setup(punkte(0, 25));
      const { trigger, facts, omitted } = buildFeedbackRequest(diff, "+ x", notebooks, "N");
      expect(facts).toHaveLength(20);
      expect(omitted).toBe(5);
      expect(trigger).toContain(factLine(19) + "\n" + hintN(5) + "\n\nDiff der Änderung:");
      // Reihenfolge: Fakten-Kopf < Hinweis < Diff < Prüfauftrag
      const at = (s) => trigger.indexOf(s);
      expect(at("Vom Code ermittelte Fakten")).toBeGreaterThan(-1);
      expect(at("Vom Code ermittelte Fakten")).toBeLessThan(at("Hinweis: Aufgeführt"));
      expect(at("Hinweis: Aufgeführt")).toBeLessThan(at("Diff der Änderung:"));
      expect(at("Diff der Änderung:")).toBeLessThan(at("Prüfe die Änderung im Kontext ALLER Notizbücher"));
      // genau EINE Hinweiszeile, und die überzähligen Zeilen tauchen nicht als Fakt auf
      expect(trigger.split("Hinweis: Aufgeführt").length - 1).toBe(1);
      expect(trigger).not.toContain("„- Punkt 20“");
      expect(trigger).not.toContain("„- Punkt 24“");
    });

    it("auch ohne kompakten Diff (Gesamtdokument-Hinweis) steht die Hinweiszeile im Fakten-Block", () => {
      const { diff, notebooks } = setup(punkte(0, 21));
      const { trigger } = buildFeedbackRequest(diff, "", notebooks, "N");
      expect(trigger).toContain(factLine(19) + "\n" + HINT_1 + "\n\nDie Änderung ist umfangreich");
    });

    it("diff === null: weder Fakten noch Hinweis, omitted 0", () => {
      const { trigger, facts, omitted } = buildFeedbackRequest(null, "", [{ name: "N", doc: "x" }], "N");
      expect(facts).toEqual([]);
      expect(omitted).toBe(0);
      expect(trigger).not.toContain("Hinweis: Aufgeführt");
    });
  });

  describe("collectFeedbackFacts / formatFeedbackFacts: Randfälle", () => {
    it("Fehlerpfade liefern leere Fakten UND omitted 0 (diff null, unbekanntes Notizbuch, keine Liste)", () => {
      const none = { facts: [], omitted: 0 };
      expect(collectFeedbackFacts(null, [{ name: "N", doc: "x" }], "N")).toEqual(none);
      expect(collectFeedbackFacts(diffLines("a\n", "a\nb\n"), [{ name: "Anderes", doc: "a\nb\n" }], "N")).toEqual(none);
      expect(collectFeedbackFacts(diffLines("a\n", "a\nb\n"), null, "N")).toEqual(none);
    });

    it("ungültiges omitted (0, NaN, negativ, Bruch, String, null, undefined, Infinity) erzeugt KEINEN Hinweis", () => {
      const facts = [{ text: "x", chapter: null, section: null, lineNo: 1, activeCount: 1, elsewhere: [] }];
      const plain = formatFeedbackFacts(facts, "N");
      for (const bad of [0, NaN, -3, 1.5, "3", null, undefined, Infinity]) {
        expect(formatFeedbackFacts(facts, "N", bad)).toBe(plain);
      }
    });

    it("ohne Fakten bleibt der Text leer, auch bei omitted > 0 (kein Hinweis ohne Fakten-Block)", () => {
      expect(formatFeedbackFacts([], "N", 5)).toBe("");
      expect(formatFeedbackFacts(null, "N", 5)).toBe("");
    });

    it("die genannte Aufführungs-Zahl kommt aus den TATSÄCHLICH übergebenen Fakten, nicht aus einer festen 20", () => {
      const f = (t) => ({ text: t, chapter: null, section: null, lineNo: 1, activeCount: 1, elsewhere: [] });
      const lines = formatFeedbackFacts([f("a"), f("b")], "N", 2).split("\n");
      expect(lines).toHaveLength(3);
      expect(lines[2]).toBe(
        "Hinweis: Aufgeführt sind nur die ersten 2 eigenständigen hinzugefügten Zeilen; " +
        "für 2 weitere eigenständige hinzugefügte Zeilen wurden keine Vorkommen ermittelt, sie sind hier nicht aufgeführt."
      );
    });
  });
});
