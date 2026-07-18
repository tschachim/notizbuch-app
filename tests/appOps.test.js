// Reine, aus App.jsx exportierte Helfer rund um die Ops-Verarbeitung der
// Modellantwort (v7.16, globales Gedächtnis) – Node-Umgebung reicht, da
// splitOps keinerlei DOM/React-Rendering braucht (reine Array-Verarbeitung),
// analog zum bestehenden serializeState-Exportmuster (siehe
// tests/linkProviders.test.jsx).
import { describe, it, expect } from "vitest";
import { splitOps, serializeState } from "../src/App.jsx";

describe("splitOps: memory_*-Ops vs. Notizbuch-Ops trennen", () => {
  it("trennt memory_append/memory_replace von allen anderen op-Typen", () => {
    const ops = [
      { type: "append_to_section", heading: "## A", content: "- x" },
      { type: "memory_append", content: "- merk dir das" },
      { type: "replace_section", heading: "## B", content: "neu" },
      { type: "memory_replace", content: "- konsolidiert" },
      { type: "delete_section", heading: "## C" },
      { type: "rewrite", content: "# ganz neu" },
    ];
    const { memoryOps, notebookOps } = splitOps(ops);
    expect(memoryOps).toEqual([
      { type: "memory_append", content: "- merk dir das" },
      { type: "memory_replace", content: "- konsolidiert" },
    ]);
    expect(notebookOps).toEqual([
      { type: "append_to_section", heading: "## A", content: "- x" },
      { type: "replace_section", heading: "## B", content: "neu" },
      { type: "delete_section", heading: "## C" },
      { type: "rewrite", content: "# ganz neu" },
    ]);
  });

  it("erhält die Reihenfolge INNERHALB jeder Gruppe, auch bei verschachtelter Abfolge", () => {
    const ops = [
      { type: "memory_append", content: "- 1" },
      { type: "append_to_section", heading: "## A", content: "- a" },
      { type: "memory_append", content: "- 2" },
      { type: "append_to_section", heading: "## B", content: "- b" },
      { type: "memory_replace", content: "- 3" },
    ];
    const { memoryOps, notebookOps } = splitOps(ops);
    expect(memoryOps.map((o) => o.content)).toEqual(["- 1", "- 2", "- 3"]);
    expect(notebookOps.map((o) => o.heading)).toEqual(["## A", "## B"]);
  });

  it("reines Notizbuch-Ops-Array liefert leere memoryOps, unverändert durchgereichte notebookOps", () => {
    const ops = [{ type: "append_to_section", heading: "## A", content: "- x" }];
    const { memoryOps, notebookOps } = splitOps(ops);
    expect(memoryOps).toEqual([]);
    expect(notebookOps).toEqual(ops);
  });

  it("reines Gedächtnis-Ops-Array liefert leere notebookOps", () => {
    const ops = [{ type: "memory_replace", content: "- alles neu" }];
    const { memoryOps, notebookOps } = splitOps(ops);
    expect(memoryOps).toEqual(ops);
    expect(notebookOps).toEqual([]);
  });

  it("leeres/undefined/null ops-Array ergibt zwei leere Arrays, kein Crash", () => {
    expect(splitOps([])).toEqual({ memoryOps: [], notebookOps: [] });
    expect(splitOps(undefined)).toEqual({ memoryOps: [], notebookOps: [] });
    expect(splitOps(null)).toEqual({ memoryOps: [], notebookOps: [] });
  });

  it("kaputte Einträge (kein Objekt, fehlendes/kein-String type) landen defensiv bei notebookOps " +
     "(applyOps überspringt sie ohnehin bei der Anwendung, applyMemoryOps bekommt sie so nie zu sehen)", () => {
    const ops = [null, "kaputt", 42, { heading: "## ohne type" }, { type: 123 }];
    const { memoryOps, notebookOps } = splitOps(ops);
    expect(memoryOps).toEqual([]);
    expect(notebookOps).toEqual(ops);
  });

  it("ein op.type, der nur zufällig 'memory' im Namen enthält, aber nicht mit 'memory_' beginnt, " +
     "zählt NICHT als Gedächtnis-Op", () => {
    const ops = [{ type: "memory", content: "x" }, { type: "my_memory_note", content: "y" }];
    const { memoryOps, notebookOps } = splitOps(ops);
    expect(memoryOps).toEqual([]);
    expect(notebookOps).toEqual(ops);
  });
});

// v7.16: Das globale Gedächtnis lebt bewusst in einer EIGENEN Datei
// (data/memory.md, siehe MEMORY_PATH in App.jsx), NICHT in state.json –
// Gegenprobe analog zum bestehenden Sicherheitstest für Link-Provider-PATs
// (tests/linkProviders.test.jsx): serializeState() nimmt gar keinen
// memory-Parameter entgegen, ein versehentlich mitgeführter "memory"-Schlüssel
// im chat/quicknotes/collapsed-Baum darf trotzdem nicht in einen TOP-LEVEL
// "memory"-Schlüssel des State-Payloads durchsickern.
describe("Sicherheit: Gedächtnis-Text ist NICHT Teil von serializeState()/state.json", () => {
  it("der Payload hat GENAU die bekannten Top-Level-Schlüssel – insbesondere KEIN 'memory'", () => {
    const chat = [
      { role: "user", ts: 1, text: "Notiere: Zahnarzt Freitag" },
      { role: "assistant", ts: 2, text: "Notiert.", commit: "Termin ergänzt", memory: true },
    ];
    const payload = serializeState(chat, "claude-sonnet-5", { wissensbasis: { "s:Inbox": true } },
      "wissensbasis", ["wissensbasis"], { wissensbasis: [] });
    const parsed = JSON.parse(payload);
    // Auch eine Chat-Nachricht MIT memory:true (siehe Badge, v7.16) landet
    // nur als Feld INNERHALB von chat[] (dort unschädlich, nur Anzeige-Flag)
    // – niemals als eigener Top-Level-Schlüssel des State-Objekts.
    expect(Object.keys(parsed).sort()).toEqual(["active", "chat", "collapsed", "model", "order", "quicknotes", "v"]);
    expect(parsed).not.toHaveProperty("memory");
  });

  it("serializeState nimmt strukturell gar keinen memory-Parameter entgegen (6 feste Parameter)", () => {
    // Analog zum bestehenden Kommentar/Test zu Link-Provider-PATs in
    // tests/linkProviders.test.jsx: die Funktion hat schlicht keinen Pfad,
    // über den ein Gedächtnis-Text hineingelangen könnte.
    expect(serializeState.length).toBe(6);
  });
});
