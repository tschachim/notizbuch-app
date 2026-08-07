// @vitest-environment jsdom
//
// v7.45, Auftrag "Datenkorruption – leere Checkbox" (E2E-Finding 🔴 des
// Testers gegen die Live-App). Vollständige Ursachenanalyse: siehe
// DECISIONS #91. Kurzfassung, damit diese Datei für sich lesbar bleibt:
//
// 1) Speicherpfad: prosemirror-markdown schreibt für eine INHALTSLEERE
//    Checkbox ("- [ ]" ganz ohne Text) zuverlässig "[ ] " MIT einem
//    abschließenden Leerzeichen (state.write("[ ] ") + renderContent()
//    eines leeren Absatzes). App.jsx#saveEdit trimmt aber das GESAMTE
//    Dokument am Ende ("… .trim() + '\n'") – trifft die leere Checkbox
//    zufällig das Dokumentende, frisst dieses trim() ihr einziges
//    Leerzeichen. Eine leere Checkbox MITTEN im Dokument behält ihr
//    Leerzeichen dagegen (trim() wirkt nur an den beiden Enden des
//    GESAMTEN Strings) – reine Zufalls-Asymmetrie.
// 2) Ladepfad (der eigentliche Kern des Bugs, unabhängig von 1): markdown-it
//    (rules_block/paragraph.mjs, asciiTrim()) trimmt den Text EINES
//    Absatzes IMMER an beiden Enden, BEVOR markdown-it-task-lists
//    (node_modules/markdown-it-task-lists/index.js#startsWithTodoMarkdown)
//    ihn überhaupt zu sehen bekommt. Eine leere Checkbox liefert dadurch
//    IMMER "[ ]" (3 Zeichen) statt der von markdown-it-task-lists zwingend
//    verlangten 4 Zeichen "[ ] " (MIT Leerzeichen) – VÖLLIG UNABHÄNGIG
//    davon, ob die Quellzeile ein Leerzeichen trägt oder nicht (empirisch
//    geprüft, siehe DECISIONS). Jedes im Editor bereits einmal korrekt
//    angezeigte "- [ ] " degradiert deshalb beim NÄCHSTEN Laden zu einer
//    normalen Aufzählung mit Literaltext "[ ]" – und genau DAS wird beim
//    nächsten Speichern dauerhaft festgeschrieben (Korruption breitet sich
//    mit jedem Zyklus aus, exakt wie vom Tester beobachtet).
//
// Fix (siehe DocEditor.jsx#EmptyTaskMarkdownIt/#stripEmptyCheckboxTrailingSpace
// und lib/markdown.jsx#TASK_RE): Editor-Ladepfad, Viewer UND Speicherpfad
// verlassen sich ab sofort NICHT MEHR auf ein abschließendes Leerzeichen –
// "- [ ]" ist an jeder Position ein vollwertiger, stabiler Checkbox-Punkt.
//
// Verifiziert OHNE Fix rot (siehe Abschlussbericht): EmptyTaskMarkdownIt
// testweise aus buildEditor() entfernt – jeder Test in der Gruppe
// "EmptyTaskMarkdownIt erkennt eine leere Checkbox beim Laden" schlägt fehl
// (die leere Checkbox wird zu literalem "[ ]"-Text). stripEmptyCheckbox-
// TrailingSpace testweise zu einer Identitätsfunktion gemacht – die
// "mehrzyklisch"-Tests unten liefern nach mehreren Zyklen KEINE stabile
// Checkbox mehr (siehe Kommentar dort).
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { Markdown } from "tiptap-markdown";
import {
  FencedCodeBlock, BlockImage, IndentParagraph, IndentMarkdownIt, IndentKeymap, MdTable,
  MathInline, MathBlock, NestedListToggle, SplitMixedTaskLists, EmptyTaskMarkdownIt,
  unescapeMd, collapseChecklistGaps, dropEmptyCheckboxLines, stripEmptyCheckboxTrailingSpace,
} from "../src/components/DocEditor.jsx";
import { mathToPlaceholders } from "../src/lib/math.jsx";
import { TASK_RE } from "../src/lib/markdown.jsx";

// Exakt die Verdrahtung aus DocEditor.jsx (useEditor()).
function buildEditor(md) {
  return new Editor({
    extensions: [
      EmptyTaskMarkdownIt,
      IndentKeymap,
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, blockquote: false, paragraph: false }),
      IndentParagraph,
      FencedCodeBlock,
      BlockImage,
      SplitMixedTaskLists,
      TaskList,
      TaskItem.configure({ nested: true }),
      NestedListToggle,
      MdTable.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      MathInline,
      MathBlock,
      IndentMarkdownIt,
      Markdown.configure({ html: true, bulletListMarker: "-", tightLists: true }),
    ],
    content: mathToPlaceholders(md),
  });
}

// Exakt der save()-Pfad aus DocEditor.jsx (inkl. der neuen v7.45-Stufe).
function saveLike(editor) {
  return dropEmptyCheckboxLines(
    stripEmptyCheckboxTrailingSpace(collapseChecklistGaps(unescapeMd(editor.storage.markdown.getMarkdown())))
  );
}
function roundtrip(md) {
  const editor = buildEditor(md);
  const out = saveLike(editor);
  editor.destroy();
  return out;
}

// Ein leerer taskItem ist STRUKTURELL identisch, ob er ein absichtlich
// leerer Nutzer-Punkt (dieser Auftrag) oder ein Geister-Phantom (v7.41.2)
// ist – dieselbe Erkennung wie in tests/docEditorGhostCheckbox.test.jsx.
function countEmptyTaskItems(editor) {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "taskItem" && node.textContent === "" && node.childCount <= 1) n++;
  });
  return n;
}
// Ein taskItem/eine Checkbox, die stattdessen als literaler "[ ]"-Text in
// einem NORMALEN Listenpunkt (bulletList > listItem) gerendert wurde – das
// ist GENAU das gemeldete Symptom.
function countLiteralBracketBullets(editor) {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "listItem" && /^\[( |x|X)\]$/.test(node.textContent.trim())) n++;
  });
  return n;
}

describe("EmptyTaskMarkdownIt erkennt eine leere Checkbox beim Laden (v7.45)", () => {
  it("mittig, OHNE Leerzeichen ('- [ ]'): echter leerer taskItem, kein Literaltext", () => {
    const editor = buildEditor("# T\n\n- [ ] A\n- [ ]\n- [ ] B");
    expect(countEmptyTaskItems(editor)).toBe(1);
    expect(countLiteralBracketBullets(editor)).toBe(0);
    editor.destroy();
  });

  it("mittig, MIT Leerzeichen ('- [ ] '): ebenfalls ein echter leerer taskItem (Kompatibilität)", () => {
    const editor = buildEditor("# T\n\n- [ ] A\n- [ ] \n- [ ] B");
    expect(countEmptyTaskItems(editor)).toBe(1);
    expect(countLiteralBracketBullets(editor)).toBe(0);
    editor.destroy();
  });

  it("als letzter Punkt des Dokuments (kein abschließender Zeilenumbruch im geladenen Text)", () => {
    const editor = buildEditor("# T\n\n- [ ] A\n- [ ]");
    expect(countEmptyTaskItems(editor)).toBe(1);
    expect(countLiteralBracketBullets(editor)).toBe(0);
    editor.destroy();
  });

  it("verschachtelt (leerer Kindpunkt unter einem Checkbox-Elternpunkt)", () => {
    const editor = buildEditor("# T\n\n- [ ] Eltern\n  - [ ]");
    let found = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "taskItem" && node.textContent === "") found++;
    });
    expect(found).toBe(1);
    expect(countLiteralBracketBullets(editor)).toBe(0);
    editor.destroy();
  });

  it("mehrfach verschachtelt (zwei Ebenen tief) bleibt ebenfalls erkannt", () => {
    const editor = buildEditor("# T\n\n- [ ] Eltern\n  - [ ] Kind\n    - [ ]");
    expect(countEmptyTaskItems(editor)).toBe(1);
    editor.destroy();
  });

  it("als EINZIGER Punkt des gesamten Dokuments", () => {
    const editor = buildEditor("# T\n\n- [ ]");
    expect(countEmptyTaskItems(editor)).toBe(1);
    expect(countLiteralBracketBullets(editor)).toBe(0);
    editor.destroy();
  });

  it("'- [x]'/'- [X]' leer (erledigt, aber ohne Text) werden ebenfalls als taskItem erkannt (checked bleibt korrekt)", () => {
    const editor = buildEditor("# T\n\n- [x] A\n- [x]\n- [X]");
    let checkedEmptyCount = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "taskItem" && node.textContent === "" && node.attrs.checked) checkedEmptyCount++;
    });
    expect(checkedEmptyCount).toBe(2);
    expect(countLiteralBracketBullets(editor)).toBe(0);
    editor.destroy();
  });

  it("'*' als Marker (VOR jeder Speicherung, roher/handgetippter Bestand) wird beim ERSTEN Laden ebenfalls erkannt", () => {
    const editor = buildEditor("# T\n\n* [ ] A\n* [ ]\n* [ ] B");
    expect(countEmptyTaskItems(editor)).toBe(1);
    expect(countLiteralBracketBullets(editor)).toBe(0);
    editor.destroy();
  });

  it("mehrere aufeinanderfolgende leere Checkboxen (keine dazwischenliegenden Text-Punkte) werden alle erkannt", () => {
    const editor = buildEditor("# T\n\n- [ ] A\n- [ ]\n- [ ]\n- [ ] B");
    expect(countEmptyTaskItems(editor)).toBe(2);
    expect(countLiteralBracketBullets(editor)).toBe(0);
    editor.destroy();
  });

  it("Gegenprobe: ein normaler Absatz mit dem reinen Text '[ ]' (KEIN Listenpunkt) bleibt unangetastet, wird NICHT zur Checkbox", () => {
    const editor = buildEditor("# T\n\n[ ]");
    expect(countEmptyTaskItems(editor)).toBe(0);
    let paragraphText = null;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "paragraph" && node.textContent) paragraphText = node.textContent;
    });
    expect(paragraphText).toBe("[ ]");
    editor.destroy();
  });
});

describe("Zusammenspiel mit der Geister-Checkbox-Heilung (v7.41.2) bleibt sicher (v7.45)", () => {
  it("leere Checkbox ZUERST, danach ein NICHT-Checkbox-Stichpunkt, danach eine echte Checkbox: kein Datenverlust, korrekte Aufteilung", () => {
    const editor = buildEditor("# T\n\n- [ ] \n- Notiz\n- [ ] B");
    const out = saveLike(editor);
    editor.destroy();
    expect(out).toContain("Notiz");
    expect(out).toContain("- [ ] B");
    expect(countLiteralBracketBullets(buildEditor(out))).toBe(0);
  });

  it("leere Checkbox MITTIG zwischen zwei Nicht-Checkbox-Stichpunkten: kein Datenverlust", () => {
    const editor = buildEditor("# T\n\n- Notiz A\n- [ ]\n- Notiz B\n- [ ] C");
    const out = saveLike(editor);
    editor.destroy();
    expect(out).toContain("Notiz A");
    expect(out).toContain("Notiz B");
    expect(out).toContain("- [ ] C");
  });
});

describe("stripEmptyCheckboxTrailingSpace (v7.45, Speicherpfad-Normalisierung)", () => {
  it("entfernt ein einzelnes abschließendes Leerzeichen nach einer leeren Checkbox", () => {
    expect(stripEmptyCheckboxTrailingSpace("- [ ] \n- Notiz")).toBe("- [ ]\n- Notiz");
  });

  it("entfernt MEHRERE abschließende Leerzeichen/Tabs gleichermaßen", () => {
    expect(stripEmptyCheckboxTrailingSpace("- [ ]   \n- Notiz")).toBe("- [ ]\n- Notiz");
    expect(stripEmptyCheckboxTrailingSpace("- [ ]\t\n- Notiz")).toBe("- [ ]\n- Notiz");
  });

  it("wirkt UNABHÄNGIG von der Position: mittig, verschachtelt/eingerückt UND am Dokumentende", () => {
    expect(stripEmptyCheckboxTrailingSpace("- [ ] A\n- [ ] \n- [ ] B")).toBe("- [ ] A\n- [ ]\n- [ ] B");
    expect(stripEmptyCheckboxTrailingSpace("- [ ] A\n  - [ ] \n- [ ] B")).toBe("- [ ] A\n  - [ ]\n- [ ] B");
    expect(stripEmptyCheckboxTrailingSpace("- [ ] A\n- [ ] ")).toBe("- [ ] A\n- [ ]");
  });

  it("erkennt '[x]'/'[X]' genauso wie '[ ]'", () => {
    expect(stripEmptyCheckboxTrailingSpace("- [x] \n- Notiz")).toBe("- [x]\n- Notiz");
    expect(stripEmptyCheckboxTrailingSpace("- [X]  ")).toBe("- [X]");
  });

  it("lässt eine Checkbox MIT echtem Text unangetastet, auch wenn der Text selbst mit einem Leerzeichen endet", () => {
    const md = "- [ ] Text mit Leerzeichen am Ende \n- Notiz";
    expect(stripEmptyCheckboxTrailingSpace(md)).toBe(md);
  });

  it("bewusste Grenze: '*' als Marker wird NICHT angefasst (der Serializer schreibt laut Konfiguration ausschließlich '-', siehe Kommentar)", () => {
    const md = "* [ ] \n- Notiz";
    expect(stripEmptyCheckboxTrailingSpace(md)).toBe(md);
  });

  it("ist idempotent", () => {
    const once = stripEmptyCheckboxTrailingSpace("- [ ] \n  - [ ]  \n- [ ]");
    expect(stripEmptyCheckboxTrailingSpace(once)).toBe(once);
  });

  it("ändert ein Dokument ganz ohne Checkbox nicht", () => {
    const md = "# T\n\n- Notiz eins\n- Notiz zwei ";
    expect(stripEmptyCheckboxTrailingSpace(md)).toBe(md);
  });
});

describe("End-zu-Ende: leere Checkbox bleibt über einen kompletten Speicherzyklus hinweg an JEDER Position stabil (v7.45)", () => {
  it("mittig, verschachtelt und als letzter Punkt: EIN Speicherzyklus reicht bereits", () => {
    const md = "# T\n\n- [ ] Eins\n- [ ]\n- [ ] Zwei\n  - [ ]\n- [ ]";
    const out = roundtrip(md);
    // Vier leere Checkbox-Zeilen (mittig, verschachtelt, letzte + die
    // eingerückte) müssen als "- [ ]"/"  - [ ]" überleben, KEINE als
    // literaler Aufzählungstext.
    expect(out).not.toMatch(/^\s*-\s+\[( |x|X)\]\S/m); // keine "[ ]Text ohne Trenner"-Fehlinterpretation
    expect((out.match(/- \[ \]$/gm) || []).length).toBeGreaterThanOrEqual(2); // mittig + letzte Zeile
    expect(out).toContain("  - [ ]");
    expect(out).toContain("- [ ] Eins");
    expect(out).toContain("- [ ] Zwei");
    // Erneutes Laden bestätigt: alle vier sind ECHTE Checkboxen.
    const reloaded = buildEditor(out);
    expect(countEmptyTaskItems(reloaded)).toBe(3); // mittig + verschachtelt + letzte
    expect(countLiteralBracketBullets(reloaded)).toBe(0);
    reloaded.destroy();
  });

  it("mehrzyklisch (4 Zyklen, je eine Änderung an ANDERER Stelle): alle drei leeren Checkboxen (mittig/verschachtelt/letzte) bleiben über JEDEN Zyklus hinweg Checkboxen", () => {
    let cur = "## Abschnitt\n\nBemerkung: v0\n\n- [ ] Eins\n- [ ]\n- [ ] Zwei\n  - [ ]\n- [ ]";
    for (let cycle = 1; cycle <= 4; cycle++) {
      const editor = buildEditor(cur);
      // Vor JEDEM Speichern prüfen: aktuell noch alle drei intakt (sonst
      // würde ein bereits beschädigter Zwischenstand den Rest des Tests
      // fälschlich "reparieren").
      expect(countEmptyTaskItems(editor)).toBe(3);
      expect(countLiteralBracketBullets(editor)).toBe(0);
      // Änderung an GANZ ANDERER Stelle (Bemerkungszeile), Listen bleiben
      // unangetastet – exakt das im Auftrag beschriebene Repro-Muster.
      let bemerkungPos = null;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text.startsWith("Bemerkung: v")) bemerkungPos = pos;
      });
      editor.commands.insertContentAt(
        { from: bemerkungPos, to: bemerkungPos + ("Bemerkung: v" + (cycle - 1)).length },
        "Bemerkung: v" + cycle
      );
      const out = saveLike(editor);
      editor.destroy();
      cur = out;
    }
    // Nach dem letzten Zyklus: erneut laden und ENDGÜLTIG bestätigen.
    const final = buildEditor(cur);
    expect(countEmptyTaskItems(final)).toBe(3);
    expect(countLiteralBracketBullets(final)).toBe(0);
    final.destroy();
    expect(cur).toContain("Bemerkung: v4");
    expect(cur).toContain("- [ ] Eins");
    expect(cur).toContain("- [ ] Zwei");
  });

  it("mehrzyklisch mit '- [x]' (erledigt, leer) bleibt ebenfalls stabil", () => {
    let cur = "## Abschnitt\n\n- [x] Eins\n- [x]\n- [x] Zwei";
    for (let cycle = 0; cycle < 3; cycle++) {
      cur = roundtrip(cur);
    }
    const final = buildEditor(cur);
    let checkedEmpty = 0;
    final.state.doc.descendants((node) => {
      if (node.type.name === "taskItem" && node.textContent === "" && node.attrs.checked) checkedEmpty++;
    });
    expect(checkedEmpty).toBe(1);
    expect(countLiteralBracketBullets(final)).toBe(0);
    final.destroy();
  });

  it("roundtrip ist idempotent: ein zweiter Speicherzyklus OHNE jede Änderung liefert byte-identischen Text", () => {
    const md = "# T\n\n- [ ] Eins\n- [ ]\n- [ ] Zwei\n  - [ ]\n- [ ]";
    const out1 = roundtrip(md);
    const out2 = roundtrip(out1);
    expect(out2).toBe(out1);
  });
});

// Regressionsschutz (Auftrag): die Geister-Checkbox-Fälle bleiben von diesem
// Fix vollständig unberührt – siehe tests/docEditorGhostCheckbox.test.jsx
// (dort mit EmptyTaskMarkdownIt in der Verdrahtung ergänzt, alle 31 Tests
// weiterhin grün).
