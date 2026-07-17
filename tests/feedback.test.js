import { describe, it, expect } from "vitest";
import { buildFeedbackTrigger, isNoFeedback, dedupeFeedbackParagraphs } from "../src/lib/feedback.js";

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
