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
