import { describe, it, expect } from "vitest";
import { buildFeedbackTrigger, isNoFeedback } from "../src/lib/feedback.js";

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
