// @vitest-environment jsdom
//
// v7.49, 🟡 E2E-Finding (Tester, zweimal reproduziert, davon einmal mit
// bewusster Wartezeit zwischen den Schritten – also KEIN Werkzeug-Timing-
// Artefakt): Toolbar-Knopf "Checkliste" auf einem LEEREN Listenpunkt
// anklicken und SOFORT weitertippen landete – sobald im Dokument direkt
// danach ein weiterer Block (hier: eine Tabelle) folgte – NICHT im neu
// entstandenen, weiterhin leeren Checklisten-Eintrag, sondern in dessen
// KOPFZELLE. `getSelection().anchorNode` zeigte unmittelbar nach dem
// Knopfdruck bereits auf den Folgeblock. Vollständige Ursachenanalyse:
// siehe DECISIONS #101.
//
// Kurzfassung: convertListItemTypeCommand (DocEditor.jsx) teilt die
// umschließende Liste in bis zu drei Geschwister-Listen auf und ersetzt sie
// per EINEM `tr.replaceWith` über die GESAMTE ursprüngliche Liste hinweg.
// ProseMirrors STANDARD-Selektionsmapping (Transaction.selection-Getter,
// assoc=1) schiebt dabei JEDE Position, die vor der Umwandlung STRIKT
// INNERHALB der Liste lag (das ist die Selektion hier IMMER, siehe
// nearestListItemAncestor/blockRange in DocEditor.jsx), an das ENDE DES
// GESAMTEN ersetzten Bereichs – gibt es dahinter einen Folgeblock, sucht
// `Selection.near` von dort zuerst VORWÄRTS und landet darin, statt (wie
// bei fehlendem Folgeblock, siehe Gruppe "ohne Folgeblock" unten) zufällig
// per Rückwärtssuche im richtigen, neuen Punkt zu landen.
//
// WICHTIG (beim Testschreiben selbst gefunden, siehe Abschlussbericht):
// Dieselbe Fehlklasse trifft NICHT nur einen LEEREN Zielpunkt, sondern
// GENAUSO einen TEXTHALTIGEN, sobald ein Folgeblock ODER ein spätes
// Geschwister ("danach" in convertListItemTypeCommand) existiert – nur fiel
// das nie auf, weil kein bisheriger Test "Knopf klicken, sofort
// weitertippen" mit einem NICHT-leeren Zielpunkt UND einem Folgeblock
// kombinierte (siehe "textelhaltiger Zielpunkt" weiter unten).
//
// Aktiv ALS ROT VERIFIZIERT (siehe Abschlussbericht): Mit dem vorherigen
// Stand von convertListItemTypeCommand (ohne die explizite
// tr.setSelection(...)-Berechnung, dispatch(state.tr.replaceWith(...))
// direkt) schlagen ALLE "mit Folgeblock"/"Geschwister danach"-Tests dieser
// Datei fehl (falscher itemType bzw. falscher itemText an der Selektion) –
// nur die Tests der Gruppe "ohne Folgeblock" blieben zufällig grün.
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

// Exakt dieselbe Verdrahtung wie tests/docEditorEmptyCheckbox.test.jsx
// (inkl. EmptyTaskMarkdownIt – ohne sie würde eine INHALTSLEERE Checkbox
// beim Laden zu literalem "[ ]"-Text degradieren, siehe DECISIONS #91;
// relevant für die Fälle unten, die mit einer leeren Checkbox STARTEN).
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
function saveLike(editor) {
  return dropEmptyCheckboxLines(
    stripEmptyCheckboxTrailingSpace(collapseChecklistGaps(unescapeMd(editor.storage.markdown.getMarkdown())))
  );
}
function posOfText(editor, text) {
  let pos = null;
  editor.state.doc.descendants((node, p) => { if (node.isText && node.text === text) pos = p; });
  return pos;
}
// Position IM Absatz des GENAU EINEN leeren Listenpunkts (listItem ODER
// taskItem) im Dokument – wirft, wenn keiner oder mehr als einer
// existiert, damit ein Testfall nie versehentlich den falschen Punkt trifft.
function posInSoleEmptyItem(editor) {
  const hits = [];
  editor.state.doc.descendants((node, pos) => {
    if ((node.type.name === "listItem" || node.type.name === "taskItem") && node.textContent === "") hits.push(pos);
  });
  if (hits.length !== 1) throw new Error(`erwartet GENAU einen leeren Punkt, gefunden: ${hits.length}`);
  return hits[0] + 2; // +1 Punkt-Öffnung, +1 Absatz-Öffnung -> Cursor im leeren Absatz.
}
// Zentrale Prüfung dieser Datei: NICHT nur "ist die Struktur korrekt?",
// sondern "wo steht editor.state.selection TATSÄCHLICH?" (Auftrag: "Prüfe
// die Selektion nach dem Befehl, nicht nur die Struktur – genau daran ist
// es vorbeigerutscht").
function selectionItem(editor) {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === "listItem" || n.type.name === "taskItem") return { itemType: n.type.name, itemText: n.textContent };
  }
  return { itemType: null, itemText: null };
}

describe("Selektion nach Toolbar-Listentyp-Umwandlung (v7.49, DECISIONS #101)", () => {
  describe.each([
    ["Tabelle", "\n\n| QA-Kopfzeile |\n| --- |\n| x |"],
    ["Absatz", "\n\nQA-Folgeabsatz"],
    ["Überschrift", "\n\n## QA-Folgeüberschrift"],
  ])("leerer Listenpunkt am Listenende, Folgeblock danach: %s", (_label, followMd) => {
    it("Checkliste-Knopf: Selektion landet im NEUEN leeren taskItem, nicht im Folgeblock (exaktes Tester-Repro)", () => {
      const editor = buildEditor(`# T\n\n- QA-Geister eins\n- QA-Geister zwei\n- ${followMd}`);
      editor.commands.setTextSelection(posInSoleEmptyItem(editor));
      const result = editor.chain().focus().toggleTaskList().run();
      expect(result).toBe(true);
      expect(selectionItem(editor)).toEqual({ itemType: "taskItem", itemText: "" });

      // Verhaltens-Probe wie im Auftrag beschrieben ("sofort weitertippen"):
      // der als Nächstes eingefügte Text muss im NEUEN Checklisten-Eintrag
      // landen, NICHT im Folgeblock.
      editor.commands.insertContent("QA-Fokus Aufgabe A");
      const out = saveLike(editor);
      expect(out).toMatch(/^- \[ \] QA-Fokus Aufgabe A$/m);
      // Review-Nachbesserung zu v7.49: Die früheren Negativ-Assertions
      // konnten im echten Fehlerfall nie feuern – ohne Fix landet der Text
      // am ANFANG des Folgeblocks ("| QA-Fokus AQA-Kopfzeile |"), nicht
      // dahinter. Stattdessen die Unversehrtheit des Folgeblocks prüfen:
      // seine Zeile muss exakt so dastehen wie vorher.
      expect(out).toMatch(/^(\| QA-Kopfzeile \||QA-Folgeabsatz|## QA-Folgeüberschrift)$/m);
      editor.destroy();
    });
  });

  it("leerer Listenpunkt am Listenende OHNE Folgeblock (Dokumentende) bleibt weiterhin korrekt (Regressionsschutz)", () => {
    const editor = buildEditor("# T\n\n- QA-Geister eins\n- QA-Geister zwei\n- ");
    editor.commands.setTextSelection(posInSoleEmptyItem(editor));
    const result = editor.chain().focus().toggleTaskList().run();
    expect(result).toBe(true);
    expect(selectionItem(editor)).toEqual({ itemType: "taskItem", itemText: "" });
    editor.destroy();
  });

  it("leerer Listenpunkt in der MITTE einer Liste (Geschwister davor UND danach in derselben Liste)", () => {
    const editor = buildEditor("# T\n\n- QA-eins\n- \n- QA-drei");
    editor.commands.setTextSelection(posInSoleEmptyItem(editor));
    const result = editor.chain().focus().toggleTaskList().run();
    expect(result).toBe(true);
    // Vor dem Fix landete die Selektion in "QA-drei" (dem NACH dem Zielteil
    // neu entstandenen Geschwister-bulletList), nicht im neuen leeren Punkt.
    expect(selectionItem(editor)).toEqual({ itemType: "taskItem", itemText: "" });
    editor.destroy();
  });

  it("leerer VERSCHACHTELTER Listenpunkt (mit Vorgänger-Kind UND einem Folgeblock nach der GESAMTEN äußeren Liste)", () => {
    const editor = buildEditor(
      "# T\n\n- [ ] QA-Eltern\n  - [ ] QA-Kind eins\n  - [ ]\n\n| QA-Kopfzeile |\n| --- |\n| x |"
    );
    editor.commands.setTextSelection(posInSoleEmptyItem(editor));
    const result = editor.chain().focus().toggleBulletList().run();
    expect(result).toBe(true);
    expect(selectionItem(editor)).toEqual({ itemType: "listItem", itemText: "" });
    editor.destroy();
  });

  // Beim Testschreiben selbst gefunden (siehe Kopfkommentar): derselbe
  // Fehler trifft GENAUSO einen TEXTHALTIGEN Zielpunkt, sobald ein
  // Folgeblock existiert – kein bisheriger Test kombinierte das.
  it("TEXTHALTIGER Zielpunkt (kein leerer!) mit einem Folgeblock danach: Selektion bleibt im umgewandelten Punkt, nicht im Folgeblock", () => {
    const editor = buildEditor("# T\n\n- QA-eins\n- QA-zwei\n\n| QA-Kopfzeile |\n| --- |\n| x |");
    editor.commands.setTextSelection(posOfText(editor, "QA-zwei") + "QA-zwei".length);
    const result = editor.chain().focus().toggleTaskList().run();
    expect(result).toBe(true);
    expect(selectionItem(editor)).toEqual({ itemType: "taskItem", itemText: "QA-zwei" });
    // Review-Nachbesserung zu v7.49: OHNE diese Assertion bliebe ein
    // Off-by-one nach UNTEN unentdeckt (mit shift=1 statt 2 laufen alle
    // Tests dieser Datei grün, der Cursor steht aber ein Zeichen zu weit
    // links – genau die Fehlerklasse, gegen die die Datei geschrieben ist).
    expect(editor.state.selection.$from.parentOffset).toBe("QA-zwei".length);
    editor.destroy();
  });

  // Matrix: alle drei Zieltypen, in BEIDEN Richtungen (Ausgangstyp ->
  // Zieltyp), jeweils mit einem Folgeblock, der den Fehler ohne den Fix
  // sicher auslöst.
  describe.each([
    ["Aufzählung", "- QA-eins\n- QA-zwei\n- ", "toggleOrderedList", "listItem"],
    ["Aufzählung", "- QA-eins\n- QA-zwei\n- ", "toggleTaskList", "taskItem"],
    ["Nummerierung", "1. QA-eins\n2. QA-zwei\n3. ", "toggleBulletList", "listItem"],
    ["Nummerierung", "1. QA-eins\n2. QA-zwei\n3. ", "toggleTaskList", "taskItem"],
    ["Checkliste", "- [ ] QA-eins\n- [ ] QA-zwei\n- [ ]", "toggleBulletList", "listItem"],
    ["Checkliste", "- [ ] QA-eins\n- [ ] QA-zwei\n- [ ]", "toggleOrderedList", "listItem"],
  ])("Ausgangstyp %s, Ziel via %s", (_from, sourceMd, toggleCmd, expectedItemType) => {
    it(`${toggleCmd} setzt die Selektion in den neuen leeren Punkt, nicht in den Folgeblock`, () => {
      const editor = buildEditor(`# T\n\n${sourceMd}\n\n| QA-Kopfzeile |\n| --- |\n| x |`);
      editor.commands.setTextSelection(posInSoleEmptyItem(editor));
      const result = editor.chain()[toggleCmd]().run();
      expect(result).toBe(true);
      expect(selectionItem(editor)).toEqual({ itemType: expectedItemType, itemText: "" });
      editor.destroy();
    });
  });

  it("Mehrfachauswahl über zwei Geschwisterpunkte hinweg: Selektion bleibt innerhalb der umgewandelten Punkte (kein Sprung in den Folgeblock)", () => {
    const editor = buildEditor("# T\n\n- QA-eins\n- QA-zwei\n- QA-drei\n\n| QA-Kopfzeile |\n| --- |\n| x |");
    const from = posOfText(editor, "QA-zwei");
    const to = posOfText(editor, "QA-drei") + "QA-drei".length;
    editor.commands.setTextSelection({ from, to });
    const result = editor.chain().focus().toggleTaskList().run();
    expect(result).toBe(true);
    const { itemType, itemText } = selectionItem(editor);
    expect(itemType).toBe("taskItem");
    // $from einer Mehrfachauswahl ist die KLEINERE der beiden Positionen
    // (Anfang der Auswahl, "QA-zwei") – vor dem Fix landete auch DAS bereits
    // im Folgeblock ("QA-Kopfzeile"), nicht mehr innerhalb der Liste.
    expect(itemText).toBe("QA-zwei");
    // Review-Nachbesserung zu v7.49: Die Auswahl muss ihre LÄNGE behalten –
    // ein Off-by-one am from- oder to-Ende bliebe sonst unentdeckt.
    expect(editor.state.selection.to - editor.state.selection.from).toBe(to - from);
    editor.destroy();
  });
});
