// @vitest-environment jsdom
//
// v7.48-Auftrag, Fehler 3 ("Tabellen-Raster erlaubt keine einspaltige
// Tabelle"): Verdacht war ein Off-by-one bei den SPALTEN im
// Größen-Raster-Knopf (DocEditor.jsx, "insertTable({ rows: r + 1, cols: c,
// withHeaderRow: true })") - Zeile (1,1) im Raster sollte angeblich eine
// 2×2- statt einer 2×1-Tabelle erzeugen.
//
// Befund nach Prüfung (Quellcode UND empirisch, siehe unten): KEIN Bug.
// "cols: c" übernimmt die Spaltenzahl 1:1 aus der Rasterauswahl, NUR die
// Zeilenzahl bekommt bewusst "+1" (für die verpflichtende Kopfzeile,
// "withHeaderRow: true"). Die kleinstmögliche Rasterauswahl (Zelle oben
// links, r=1/c=1) erzeugt dadurch bereits eine 1-spaltige, 2-zeilige
// Tabelle (Kopfzeile + 1 Datenzeile) - GENAU die "2×1-Tabelle", die laut
// Auftrag angeblich nur über "−Spalte" nachträglich erreichbar sein sollte.
// docs/TESTFAELLE.md (D2b/D2c, seit v7.44/v7.46) verlangt bereits "Im Editor
// eine 2×1-Tabelle anlegen" OHNE einen anderen Weg als das Raster zu
// erwähnen - ein weiteres, unabhängiges Indiz, dass das schon immer
// funktioniert hat. Dieser Test pinnt das Verhalten, damit ein künftiges
// Off-by-one (in "insertTable" ODER in der Rasterindex-Berechnung
// "r = Math.floor(i / 6) + 1; c = (i % 6) + 1") sofort auffällt.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { MdTable } from "../src/components/DocEditor.jsx";

const DOC_EDITOR_SRC = readFileSync(resolve(process.cwd(), "src/components/DocEditor.jsx"), "utf8");

function buildEditor() {
  return new Editor({
    extensions: [StarterKit, MdTable, TableRow, TableHeader, TableCell],
    content: "<p></p>",
  });
}

// Baut über insertTable GENAU den Aufruf nach, den das Größen-Raster im
// Editor auslöst ("rows: r + 1, cols: c, withHeaderRow: true"), und liest
// die tatsächliche Zeilen-/Spaltenzahl aus dem entstandenen Dokument.
function insertViaGrid(r, c) {
  const editor = buildEditor();
  editor.chain().focus().insertTable({ rows: r + 1, cols: c, withHeaderRow: true }).run();
  let rows = 0;
  let cols = 0;
  editor.state.doc.descendants((n) => {
    if (n.type.name === "table") {
      rows = n.childCount;
      cols = n.firstChild.childCount;
    }
  });
  editor.destroy();
  return { rows, cols };
}

describe("Tabellen-Größen-Raster: Zeilen-/Spaltenzahl (v7.48, Fehler 3 - kein Bug gefunden)", () => {
  it("die kleinste Rasterauswahl (oben links, r=1/c=1) erzeugt eine 2×1-Tabelle (1 Spalte, Kopf- + 1 Datenzeile)", () => {
    expect(insertViaGrid(1, 1)).toEqual({ rows: 2, cols: 1 });
  });

  it("eine Spalte, mehrere Zeilen ausgewählt (r=3/c=1) bleibt bei genau 1 Spalte", () => {
    expect(insertViaGrid(3, 1)).toEqual({ rows: 4, cols: 1 });
  });

  it("mehrere Spalten, eine Zeile ausgewählt (r=1/c=4) übernimmt die Spaltenzahl 1:1 (kein Off-by-one)", () => {
    expect(insertViaGrid(1, 4)).toEqual({ rows: 2, cols: 4 });
  });

  it("eine quadratische Auswahl (r=3/c=3) ergibt 4 Zeilen (3 Datenzeilen + Kopf) bei weiterhin 3 Spalten", () => {
    expect(insertViaGrid(3, 3)).toEqual({ rows: 4, cols: 3 });
  });

  it("die maximale Rasterauswahl (r=6/c=6, 6×6-Raster) erzeugt 7 Zeilen bei 6 Spalten", () => {
    expect(insertViaGrid(6, 6)).toEqual({ rows: 7, cols: 6 });
  });

  it("Quelltext-Beleg: nur die Zeilenzahl bekommt '+1', die Spaltenzahl wird unverändert übernommen", () => {
    expect(DOC_EDITOR_SRC).toContain("insertTable({ rows: r + 1, cols: c, withHeaderRow: true })");
    // Die Rasterindizes selbst (1-basiert, ein 6x6-Raster) sind ebenfalls
    // unverändert - ändert sich diese Arithmetik künftig, muss sie bewusst
    // gegen die Testfälle oben abgeglichen werden.
    expect(DOC_EDITOR_SRC).toContain("const r = Math.floor(i / 6) + 1;");
    expect(DOC_EDITOR_SRC).toContain("const c = (i % 6) + 1;");
  });
});
