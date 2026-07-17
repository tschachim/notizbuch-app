import { describe, it, expect } from "vitest";
import { applyOps, normHead, dispHead } from "../src/lib/ops.js";

const DOC = `# Wissensbasis

## Inbox

- alter Eintrag

## Aufgaben

- [ ] offen
- [x] erledigt
`;

describe("normHead / dispHead", () => {
  it("normalisiert Überschriften unabhängig von #-Ebene und Groß/Klein", () => {
    expect(normHead("## Aufgaben")).toBe("aufgaben");
    expect(normHead("### AUFGABEN ")).toBe("aufgaben");
    expect(normHead("Aufgaben")).toBe("aufgaben");
    expect(normHead("")).toBe("");
    expect(normHead(null)).toBe("");
  });
  it("dispHead behält die Schreibweise, entfernt nur Rauten", () => {
    expect(dispHead("## Koch-Rezepte ")).toBe("Koch-Rezepte");
    expect(dispHead(undefined)).toBe("");
  });
});

describe("applyOps: append_to_section", () => {
  it("hängt an bestehenden Abschnitt VOR dem nächsten ##-Abschnitt an", () => {
    const out = applyOps(DOC, [
      { type: "append_to_section", heading: "## Inbox", content: "- neuer Eintrag" },
    ]);
    const inbox = out.split("## Aufgaben")[0];
    expect(inbox).toContain("- alter Eintrag");
    expect(inbox).toContain("- neuer Eintrag");
    expect(inbox.indexOf("- alter Eintrag")).toBeLessThan(inbox.indexOf("- neuer Eintrag"));
    // Aufgaben-Abschnitt unangetastet
    expect(out).toContain("- [ ] offen");
  });

  it("legt fehlende Abschnitte am Ende an", () => {
    const out = applyOps(DOC, [
      { type: "append_to_section", heading: "## Termine", content: "- 2026-07-15 Zahnarzt" },
    ]);
    expect(out).toMatch(/## Termine\n\n- 2026-07-15 Zahnarzt/);
    expect(out.indexOf("## Termine")).toBeGreaterThan(out.indexOf("## Aufgaben"));
  });

  it("findet Abschnitte case-insensitiv und mit ###-Angabe im heading", () => {
    const out = applyOps(DOC, [
      { type: "append_to_section", heading: "### INBOX", content: "- x" },
    ]);
    // kein zweiter Inbox-Abschnitt entstanden
    expect(out.match(/## Inbox/gi)).toHaveLength(1);
    expect(out).toContain("- x");
  });

  it("ignoriert leeren content", () => {
    expect(applyOps(DOC, [{ type: "append_to_section", heading: "## Inbox", content: "" }])).toBe(DOC);
  });
});

describe("applyOps: replace_section", () => {
  it("ersetzt Inhalt samt ###-Unterthemen, Überschrift bleibt", () => {
    const out = applyOps(DOC, [
      { type: "replace_section", heading: "## Aufgaben", content: "### Haushalt\n\n- [ ] Müll" },
    ]);
    expect(out).toContain("## Aufgaben");
    expect(out).toContain("### Haushalt");
    expect(out).not.toContain("erledigt");
    expect(out).toContain("- alter Eintrag"); // Inbox unberührt
  });

  it("legt fehlenden Abschnitt an", () => {
    const out = applyOps(DOC, [
      { type: "replace_section", heading: "## Neu", content: "- Inhalt" },
    ]);
    expect(out).toMatch(/## Neu\n\n- Inhalt/);
  });
});

describe("applyOps: delete_section und rewrite", () => {
  it("löscht genau den Abschnitt und lässt keine Doppel-Leerzeilen", () => {
    const out = applyOps(DOC, [{ type: "delete_section", heading: "## Inbox" }]);
    expect(out).not.toContain("Inbox");
    expect(out).not.toContain("alter Eintrag");
    expect(out).toContain("## Aufgaben");
    expect(out).not.toMatch(/\n{3,}/);
  });

  it("delete auf fehlenden Abschnitt ist ein No-op", () => {
    expect(applyOps(DOC, [{ type: "delete_section", heading: "## Gibtsnicht" }])).toBe(DOC);
  });

  it("rewrite ersetzt das ganze Dokument, aber nie durch Leere", () => {
    expect(applyOps(DOC, [{ type: "rewrite", content: "# Neu\n\n## A\n\n- x" }])).toBe("# Neu\n\n## A\n\n- x\n");
    expect(applyOps(DOC, [{ type: "rewrite", content: "   " }])).toBe(DOC);
    expect(applyOps(DOC, [{ type: "rewrite" }])).toBe(DOC);
  });
});

describe("applyOps: Robustheit", () => {
  it("überspringt kaputte Ops und wendet den Rest an", () => {
    const out = applyOps(DOC, [
      null,
      { type: "unbekannt" },
      { type: "append_to_section" }, // ohne heading
      { type: "append_to_section", heading: "## Inbox", content: "- trotzdem da" },
    ]);
    expect(out).toContain("- trotzdem da");
  });

  it("wendet Ops in Reihenfolge an (append nach replace)", () => {
    const out = applyOps(DOC, [
      { type: "replace_section", heading: "## Inbox", content: "- ersetzt" },
      { type: "append_to_section", heading: "## Inbox", content: "- danach" },
    ]);
    const inbox = out.split("## Aufgaben")[0];
    expect(inbox.indexOf("- ersetzt")).toBeLessThan(inbox.indexOf("- danach"));
    expect(inbox).not.toContain("alter Eintrag");
  });

  it("deckelt bei 20 Ops (Schutz vor Amok-Antworten)", () => {
    const ops = Array.from({ length: 25 }, (_, i) => ({
      type: "append_to_section", heading: "## Inbox", content: "- Nr" + i,
    }));
    const out = applyOps(DOC, ops);
    expect(out).toContain("- Nr19");
    expect(out).not.toContain("- Nr20");
  });
});

// v7.14 (Nutzerwunsch "zweistufige Gliederung"): Ein Dokument mit
// #-Kapiteln über den ##-Abschnitten – deckt den Verschluck-Fix (E1) und
// das optionale "chapter"-Feld ab.
const DOC_CH = `# Wissensbasis

# Kapitel A

## Eins

- alt

# Kapitel B

## Zwei

- b
`;

describe("applyOps: Kapitel-Grenzen (v7.14, Verschluck-Fix E1)", () => {
  it("replace_section auf den letzten ##-Abschnitt eines Kapitels lässt die folgende #-Kapitelzeile unangetastet", () => {
    const out = applyOps(DOC_CH, [
      { type: "replace_section", heading: "## Eins", content: "- neu" },
    ]);
    expect(out).toContain("# Kapitel B");
    expect(out).toContain("## Zwei");
    expect(out).toContain("- b");
    expect(out).toContain("- neu");
    expect(out).not.toContain("- alt");
    // Genau EINE "# Kapitel B"-Zeile – vorher wäre sie beim Ersetzen
    // gelöscht und (falsch) NICHT neu erzeugt worden.
    expect(out.match(/^# Kapitel B$/gm)).toHaveLength(1);
  });

  it("delete_section auf den letzten ##-Abschnitt eines Kapitels löscht NICHT die folgende #-Kapitelzeile mit", () => {
    const out = applyOps(DOC_CH, [{ type: "delete_section", heading: "## Eins" }]);
    expect(out).not.toContain("## Eins");
    expect(out).not.toContain("- alt");
    expect(out).toContain("# Kapitel B");
    expect(out).toContain("## Zwei");
    expect(out).toContain("- b");
  });

  it("append_to_section an den letzten Abschnitt eines Kapitels fügt VOR der nächsten #-Kapitelzeile ein, nicht danach", () => {
    const out = applyOps(DOC_CH, [
      { type: "append_to_section", heading: "## Eins", content: "- ergänzt" },
    ]);
    expect(out.indexOf("- ergänzt")).toBeLessThan(out.indexOf("# Kapitel B"));
    expect(out).toContain("- alt");
  });

  it("### bleibt Bestandteil des Abschnittsinhalts (Boundary matcht # und ##, NICHT ###)", () => {
    const doc = "# T\n\n## Eins\n\n### Unter\n\n- a\n\n## Zwei\n\n- b";
    const out = applyOps(doc, [{ type: "delete_section", heading: "## Eins" }]);
    // "## Eins" MITSAMT seinem "### Unter"-Unterthema verschwindet komplett;
    // "## Zwei" bleibt unangetastet.
    expect(out).not.toContain("Unter");
    expect(out).not.toContain("- a");
    expect(out).toContain("## Zwei");
    expect(out).toContain("- b");
  });

  it("tidy erzwingt eine Leerzeile auch vor #-Kapitelzeilen (nicht nur vor ##)", () => {
    const tight = "# T\n\n# Kapitel A\n## Eins\n- x\n# Kapitel B\n## Zwei\n- y";
    const out = applyOps(tight, [{ type: "append_to_section", heading: "## Eins", content: "- z" }]);
    expect(out).toMatch(/- z\n\n# Kapitel B\n\n## Zwei/);
  });

  it("rewrite bleibt unverändert (ersetzt weiterhin das ganze Dokument, ignoriert ein mitgegebenes chapter-Feld)", () => {
    const out = applyOps(DOC_CH, [
      { type: "rewrite", content: "# Neu\n\n## X\n\n- y", chapter: "Kapitel A" },
    ]);
    expect(out).toBe("# Neu\n\n## X\n\n- y\n");
  });
});

// Ein Dokument mit demselben ##-Titel in ZWEI verschiedenen Kapiteln –
// genau der Ambiguitäts-Fall, für den das "chapter"-Feld gedacht ist.
const DOC_DUP = `# Wissensbasis

# Kapitel A

## Notizen

- A-Notiz

# Kapitel B

## Notizen

- B-Notiz
`;

describe('applyOps: optionales "chapter"-Feld (v7.14)', () => {
  it("grenzt append_to_section auf das richtige Kapitel ein (doppelter ##-Titel in zwei Kapiteln)", () => {
    const out = applyOps(DOC_DUP, [
      { type: "append_to_section", heading: "## Notizen", content: "- neu", chapter: "Kapitel B" },
    ]);
    const kapA = out.split("# Kapitel B")[0];
    const kapB = out.split("# Kapitel B")[1];
    expect(kapA).not.toContain("- neu");
    expect(kapB).toContain("- neu");
    expect(kapA).toContain("- A-Notiz");
    expect(kapB).toContain("- B-Notiz");
  });

  it("ist normHead-tolerant: mit/ohne '#'-Präfix und Groß-/Kleinschreibung treffen dasselbe Kapitel", () => {
    const out1 = applyOps(DOC_DUP, [
      { type: "append_to_section", heading: "## Notizen", content: "- x", chapter: "# Kapitel B" },
    ]);
    const out2 = applyOps(DOC_DUP, [
      { type: "append_to_section", heading: "## Notizen", content: "- x", chapter: "kapitel b" },
    ]);
    expect(out1.split("# Kapitel B")[1]).toContain("- x");
    expect(out2.split("# Kapitel B")[1]).toContain("- x");
  });

  it("Kapitel nicht gefunden -> die GESAMTE Op wird sicher übersprungen (KEIN Fallback auf die globale Suche)", () => {
    const out = applyOps(DOC_DUP, [
      { type: "append_to_section", heading: "## Notizen", content: "- verloren", chapter: "Kapitel X" },
    ]);
    expect(out).toBe(DOC_DUP);
    expect(out).not.toContain("- verloren");
  });

  it("chapter beschränkt auch replace_section/delete_section auf das richtige Kapitel", () => {
    const outReplace = applyOps(DOC_DUP, [
      { type: "replace_section", heading: "## Notizen", content: "- ersetzt", chapter: "Kapitel A" },
    ]);
    expect(outReplace.split("# Kapitel B")[0]).toContain("- ersetzt");
    expect(outReplace.split("# Kapitel B")[0]).not.toContain("- A-Notiz");
    expect(outReplace.split("# Kapitel B")[1]).toContain("- B-Notiz");

    const outDelete = applyOps(DOC_DUP, [
      { type: "delete_section", heading: "## Notizen", chapter: "Kapitel A" },
    ]);
    expect(outDelete.split("# Kapitel B")[0]).not.toContain("Notizen");
    expect(outDelete).toContain("# Kapitel B");
    expect(outDelete).toContain("- B-Notiz");
  });

  it("append_to_section mit chapter legt einen fehlenden Abschnitt INNERHALB des Kapitels an, nicht global am Dokumentende", () => {
    const out = applyOps(DOC_DUP, [
      { type: "append_to_section", heading: "## Neu", content: "- x", chapter: "Kapitel A" },
    ]);
    const kapA = out.split("# Kapitel B")[0];
    expect(kapA).toContain("## Neu");
    expect(kapA).toContain("- x");
    expect(out.split("# Kapitel B")[1]).not.toContain("## Neu");
  });

  it("ohne chapter-Feld bleibt die globale Suche unverändert (erster Treffer gewinnt, wie vor v7.14)", () => {
    const out = applyOps(DOC_DUP, [
      { type: "append_to_section", heading: "## Notizen", content: "- global" },
    ]);
    // Erster Treffer ist "## Notizen" in Kapitel A.
    expect(out.split("# Kapitel B")[0]).toContain("- global");
    expect(out.split("# Kapitel B")[1]).not.toContain("- global");
  });

  it("ein leeres/nur-Whitespace chapter-Feld wird wie 'kein chapter-Feld' behandelt (globale Suche)", () => {
    const out = applyOps(DOC_DUP, [
      { type: "append_to_section", heading: "## Notizen", content: "- x", chapter: "   " },
    ]);
    expect(out.split("# Kapitel B")[0]).toContain("- x");
  });
});
