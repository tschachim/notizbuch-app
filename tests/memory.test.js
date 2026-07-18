// Globales, notizbuchübergreifendes Gedächtnis (v7.16). applyMemoryOps ist
// die reine Kernfunktion (App.jsx#commitMemory übernimmt Netz/SHA-Konflikt,
// hier nur die Text-Transformation) – siehe src/lib/memory.js.
import { describe, it, expect } from "vitest";
import { applyMemoryOps, MEMORY_SOFT_LIMIT, memoryTooLarge } from "../src/lib/memory.js";

describe("applyMemoryOps: memory_append", () => {
  it("hängt an ein leeres Gedächtnis an (kein führendes Leerzeilen-Wirrwarr)", () => {
    expect(applyMemoryOps("", [{ type: "memory_append", content: "- Erster Punkt" }]))
      .toBe("- Erster Punkt\n");
  });

  it("hängt an bestehenden Text mit genau EINER Leerzeile Trennung an", () => {
    expect(applyMemoryOps("- Erster Punkt\n", [{ type: "memory_append", content: "- Zweiter Punkt" }]))
      .toBe("- Erster Punkt\n\n- Zweiter Punkt\n");
  });

  it("mehrere Appends in einem Aufruf werden der Reihe nach angehängt", () => {
    const out = applyMemoryOps("", [
      { type: "memory_append", content: "- A" },
      { type: "memory_append", content: "- B" },
      { type: "memory_append", content: "- C" },
    ]);
    expect(out).toBe("- A\n\n- B\n\n- C\n");
  });

  it("leerer/fehlender content ist ein No-op (Text bleibt exakt erhalten)", () => {
    expect(applyMemoryOps("- A\n", [{ type: "memory_append", content: "" }])).toBe("- A\n");
    expect(applyMemoryOps("- A\n", [{ type: "memory_append", content: "   " }])).toBe("- A\n");
    expect(applyMemoryOps("- A\n", [{ type: "memory_append" }])).toBe("- A\n");
  });

  it("kollabiert 3+ Leerzeilen im angehängten Inhalt auf maximal eine (Tidy analog ops.js)", () => {
    const out = applyMemoryOps("- A\n", [{ type: "memory_append", content: "- B\n\n\n\n- C" }]);
    expect(out).toBe("- A\n\n- B\n\n- C\n");
  });

  it("trimmt Rand-Whitespace im content vor dem Anhängen", () => {
    expect(applyMemoryOps("", [{ type: "memory_append", content: "  \n- A  \n" }])).toBe("- A\n");
  });
});

describe("applyMemoryOps: memory_replace", () => {
  it("ersetzt den GESAMTEN Text, unabhängig vom bisherigen Inhalt", () => {
    expect(applyMemoryOps("- Altes Zeug, wird komplett verworfen\n", [
      { type: "memory_replace", content: "- Konsolidierter Stand" },
    ])).toBe("- Konsolidierter Stand\n");
  });

  it("mit leerem content löscht memory_replace das Gedächtnis vollständig (kein 'nur \\n')", () => {
    expect(applyMemoryOps("- Vorher da\n", [{ type: "memory_replace", content: "" }])).toBe("");
    expect(applyMemoryOps("- Vorher da\n", [{ type: "memory_replace", content: "   " }])).toBe("");
  });

  it("kollabiert ebenfalls 3+ Leerzeilen im neuen Text", () => {
    expect(applyMemoryOps("egal", [{ type: "memory_replace", content: "- A\n\n\n\n\n- B" }]))
      .toBe("- A\n\n- B\n");
  });

  it("ist basis-unabhängig: dieselbe Op auf unterschiedliche Basistexte liefert dasselbe Ergebnis " +
     "(wichtig für den Konflikt-Retry in App.jsx#commitMemory)", () => {
    const op = [{ type: "memory_replace", content: "- Fixer Stand" }];
    expect(applyMemoryOps("alter Stand A", op)).toBe(applyMemoryOps("völlig anderer Stand B", op));
  });
});

describe("applyMemoryOps: gemischte Reihenfolge", () => {
  it("append, dann replace, dann append – wirkt exakt in der angegebenen Reihenfolge", () => {
    const out = applyMemoryOps("", [
      { type: "memory_append", content: "- wird gleich verworfen" },
      { type: "memory_replace", content: "- konsolidierter Basisstand" },
      { type: "memory_append", content: "- neuer Punkt danach" },
    ]);
    expect(out).toBe("- konsolidierter Basisstand\n\n- neuer Punkt danach\n");
  });
});

describe("applyMemoryOps: Fehlerpfade / kaputte Ops", () => {
  it("unbekannter op.type wird übersprungen, Text bleibt unverändert", () => {
    expect(applyMemoryOps("- A\n", [{ type: "append_to_section", heading: "## X", content: "- B" }]))
      .toBe("- A\n");
    expect(applyMemoryOps("- A\n", [{ type: "memory_delete", content: "- B" }])).toBe("- A\n");
  });

  it("null/undefined/nicht-Objekt-Ops in der Liste werden übersprungen, kein Crash", () => {
    expect(() => applyMemoryOps("- A\n", [null, undefined, 42, "kaputt"])).not.toThrow();
    expect(applyMemoryOps("- A\n", [null, undefined, 42, "kaputt"])).toBe("- A\n");
  });

  it("ops ist kein Array (z. B. undefined) → Text bleibt unverändert, kein Crash", () => {
    expect(applyMemoryOps("- A\n", undefined)).toBe("- A\n");
    expect(applyMemoryOps("- A\n", null)).toBe("- A\n");
  });

  it("content als Nicht-String (z. B. Zahl) wird wie fehlender Inhalt behandelt", () => {
    expect(applyMemoryOps("- A\n", [{ type: "memory_append", content: 123 }])).toBe("- A\n");
    // memory_replace mit Nicht-String-content: wie leerer content -> löscht
    expect(applyMemoryOps("- A\n", [{ type: "memory_replace", content: 123 }])).toBe("");
  });

  it("eine kaputte Op mitten in der Liste bricht die Anwendung der übrigen Ops nicht ab", () => {
    const out = applyMemoryOps("", [
      { type: "memory_append", content: "- vor der kaputten Op" },
      "kaputt-kein-objekt",
      { type: "memory_append", content: "- nach der kaputten Op" },
    ]);
    expect(out).toBe("- vor der kaputten Op\n\n- nach der kaputten Op\n");
  });
});

describe("applyMemoryOps: Nullbyte-Hygiene", () => {
  const NUL = String.fromCharCode(0);

  it("entfernt Nullbytes aus dem Op-Inhalt (memory_append)", () => {
    const out = applyMemoryOps("", [{ type: "memory_append", content: "- Wert" + NUL + "geheim" }]);
    expect(out).not.toContain(NUL);
    expect(out).toBe("- Wertgeheim\n");
  });

  it("entfernt Nullbytes aus dem Op-Inhalt (memory_replace)", () => {
    const out = applyMemoryOps("egal", [{ type: "memory_replace", content: "- A" + NUL + NUL + "B" }]);
    expect(out).not.toContain(NUL);
    expect(out).toBe("- AB\n");
  });

  it("entfernt Nullbytes auch aus dem Basistext, selbst wenn keine Ops etwas ändern", () => {
    const out = applyMemoryOps("- A" + NUL + "B\n", []);
    expect(out).not.toContain(NUL);
    expect(out).toBe("- AB\n");
  });
});

describe("MEMORY_SOFT_LIMIT / memoryTooLarge", () => {
  it("liegt bei 32000 Zeichen (v7.20, angehoben von 8000 – siehe DECISIONS)", () => {
    expect(MEMORY_SOFT_LIMIT).toBe(32000);
  });

  it("Grenzfall: exakt am Limit ist NICHT 'zu groß', ein Zeichen mehr schon", () => {
    expect(memoryTooLarge("a".repeat(MEMORY_SOFT_LIMIT))).toBe(false);
    expect(memoryTooLarge("a".repeat(MEMORY_SOFT_LIMIT + 1))).toBe(true);
  });

  it("leer/undefined/null gelten nie als zu groß", () => {
    expect(memoryTooLarge("")).toBe(false);
    expect(memoryTooLarge(undefined)).toBe(false);
    expect(memoryTooLarge(null)).toBe(false);
  });
});
