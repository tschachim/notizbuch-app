// @vitest-environment jsdom
//
// v7.41.1, 🔴 Blocker 2 aus dem E2E-Lauf von v7.41: "Listentyp eines
// verschachtelten Kindpunkts umwandeln zerstört die gesamte Verschachtelung".
// TipTaps eingebaute toggleBulletList/toggleOrderedList/toggleTaskList-
// Kommandos (intern @tiptap/core#toggleList) heben bei einem VERSCHACHTELTEN
// Listenpunkt (durch TaskItem.configure({nested:true}) seit v7.41 überhaupt
// erst erreichbar) die GESAMTE umschließende Struktur heraus (clearNodes()+
// wrapInList() statt einer gezielten Typ-Änderung) – siehe DECISIONS für die
// vollständige Ursachenanalyse. convertListItemType/NestedListToggle (siehe
// DocEditor.jsx) ersetzen diese drei Kommandos durch eine eigene, Ort-und-
// Stelle-erhaltende "Liste in bis zu drei Geschwister-Listen aufteilen"-
// Umsetzung.
//
// Deckt zusätzlich einen beim Testschreiben gefundenen ECHTEN Bug in der
// markdown-it/tiptap-markdown-Pipeline ab (markdown-it-task-lists + taskLists
// starrem "taskItem+"-Content-Schema, siehe Kommentar bei
// convertListItemTypeCommand in DocEditor.jsx): eine bestimmte
// Konvertierungsrichtung würde beim NÄCHSTEN Laden lautlos eine Geister-
// Checkliste einfügen – convertListItemType erkennt diesen Fall und bricht
// KONTROLLIERT ab (sicherer No-op), statt die Korruption zu speichern.
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
  MathInline, MathBlock, NestedListToggle, convertListItemType,
  unescapeMd, collapseChecklistGaps,
} from "../src/components/DocEditor.jsx";
import { mathToPlaceholders } from "../src/lib/math.jsx";

// Exakt dieselbe Verdrahtung wie tests/docEditorIndent.test.jsx, ergänzt um
// NestedListToggle (muss NACH TaskList/TaskItem stehen, siehe Kommentar an
// der Extension selbst).
function buildEditor(md) {
  return new Editor({
    extensions: [
      IndentKeymap,
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, blockquote: false, paragraph: false }),
      IndentParagraph,
      FencedCodeBlock,
      BlockImage,
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
  return collapseChecklistGaps(unescapeMd(editor.storage.markdown.getMarkdown()));
}
function posOfText(editor, text) {
  let pos = null;
  editor.state.doc.descendants((node, p) => { if (node.isText && node.text === text) pos = p; });
  return pos;
}
function roundtrip(md) {
  const editor = buildEditor(md);
  const out = saveLike(editor);
  editor.destroy();
  return out;
}

describe("convertListItemType / NestedListToggle (v7.41.1, Blocker 2)", () => {
  // Genau das im Auftrag vorgegebene Repro: Checkbox-Elternpunkt, zwei
  // verschachtelte Checklisten-Kinder, EINES wird per "Stichpunktliste"-
  // Knopf zur Aufzählung. Erwartet: Eltern bleibt Checkbox, das umgewandelte
  // Kind wird verschachtelte Aufzählung, das ANDERE Kind bleibt verschachtelte
  // Checkbox – NICHT drei getrennte Top-Level-Listen (der gemeldete Fehler).
  it("Repro aus dem Auftrag: mittleres/letztes Checklisten-Kind -> Aufzählung, Eltern und Geschwister bleiben unangetastet", () => {
    const md = "# T\n\n- [ ] Eltern\n  - [ ] Kind eins\n  - [ ] Kind zwei";
    const editor = buildEditor(md);
    editor.commands.setTextSelection(posOfText(editor, "Kind zwei"));
    const result = editor.chain().focus().toggleBulletList().run();
    const out = saveLike(editor);
    editor.destroy();
    expect(result).toBe(true);
    expect(out).toBe("# T\n\n- [ ] Eltern\n  - [ ] Kind eins\n  - Kind zwei");
    // Roundtrip-stabil (keine Geister-Checkliste beim nächsten Laden, siehe
    // Kopfkommentar).
    expect(roundtrip(out)).toBe(out);
  });

  it("dieselbe Struktur, aber Nummerierung statt Aufzählung als Zieltyp", () => {
    const md = "# T\n\n- [ ] Eltern\n  - [ ] Kind eins\n  - [ ] Kind zwei";
    const editor = buildEditor(md);
    editor.commands.setTextSelection(posOfText(editor, "Kind zwei"));
    const result = editor.chain().focus().toggleOrderedList().run();
    const out = saveLike(editor);
    editor.destroy();
    expect(result).toBe(true);
    expect(out).toBe("# T\n\n- [ ] Eltern\n  - [ ] Kind eins\n  1. Kind zwei");
    expect(roundtrip(out)).toBe(out);
  });

  it("umgekehrte Richtung: verschachtelte Aufzählung -> Checkliste", () => {
    const md = "# T\n\n- Eltern\n  - Kind eins\n  - Kind zwei";
    const editor = buildEditor(md);
    editor.commands.setTextSelection(posOfText(editor, "Kind eins"));
    const result = editor.chain().focus().toggleTaskList().run();
    const out = saveLike(editor);
    editor.destroy();
    expect(result).toBe(true);
    expect(out).toBe("# T\n\n- Eltern\n  - [ ] Kind eins\n  - Kind zwei");
    expect(roundtrip(out)).toBe(out);
  });

  it("das UNBERÜHRTE Geschwister behält seinen eigenen, TIEFER verschachtelten Inhalt (kein Datenverlust bei Kindern von Kindern)", () => {
    const md = "# T\n\n- [ ] Eltern\n  - [ ] Kind eins\n    - Enkel unter Kind eins\n  - [ ] Kind zwei";
    const editor = buildEditor(md);
    editor.commands.setTextSelection(posOfText(editor, "Kind zwei"));
    const result = editor.chain().focus().toggleBulletList().run();
    const out = saveLike(editor);
    editor.destroy();
    expect(result).toBe(true);
    expect(out).toContain("Enkel unter Kind eins");
    // "Kind zwei" bleibt auf DERSELBEN Verschachtelungsebene wie "Kind eins"
    // (2 Leerzeichen, EIN Indent-Level unter "Eltern") – NICHT tiefer, auch
    // wenn "Kind eins" selbst einen weiter verschachtelten Enkel hat.
    expect(out).toMatch(/^ {2}- Kind zwei$/m);
    expect(roundtrip(out)).toBe(out);
  });

  it("einziges Kind (kein Geschwister): Konvertierung funktioniert trotzdem", () => {
    const md = "# T\n\n- [ ] Eltern\n  - [ ] Einziges Kind";
    const editor = buildEditor(md);
    editor.commands.setTextSelection(posOfText(editor, "Einziges Kind"));
    const result = editor.chain().focus().toggleBulletList().run();
    const out = saveLike(editor);
    editor.destroy();
    expect(result).toBe(true);
    expect(out).toBe("# T\n\n- [ ] Eltern\n  - Einziges Kind");
    expect(roundtrip(out)).toBe(out);
  });

  it("mehrstufige Verschachtelung: ein Enkel-Kind einer Checkliste innerhalb einer Checkliste wird korrekt umgewandelt", () => {
    const md = "# T\n\n- [ ] Opa\n  - [ ] Eltern\n    - [ ] Kind eins\n    - [ ] Kind zwei\n    - [ ] Kind drei";
    const editor = buildEditor(md);
    editor.commands.setTextSelection(posOfText(editor, "Kind zwei"));
    const result = editor.chain().focus().toggleBulletList().run();
    const out = saveLike(editor);
    editor.destroy();
    expect(result).toBe(true);
    expect(out).toBe("# T\n\n- [ ] Opa\n  - [ ] Eltern\n    - [ ] Kind eins\n    - Kind zwei\n    - [ ] Kind drei");
    expect(roundtrip(out)).toBe(out);
  });

  it("Mehrfachauswahl über zwei verschachtelte Kind-Punkte hinweg konvertiert BEIDE", () => {
    const md = "# T\n\n- [ ] Eltern\n  - [ ] Kind eins\n  - [ ] Kind zwei\n  - [ ] Kind drei";
    const editor = buildEditor(md);
    const from = posOfText(editor, "Kind zwei");
    const to = posOfText(editor, "Kind drei") + "Kind drei".length;
    editor.commands.setTextSelection({ from, to });
    const result = editor.chain().focus().toggleBulletList().run();
    const out = saveLike(editor);
    editor.destroy();
    expect(result).toBe(true);
    expect(out).toBe("# T\n\n- [ ] Eltern\n  - [ ] Kind eins\n  - Kind zwei\n  - Kind drei");
    expect(roundtrip(out)).toBe(out);
  });

  it("Ziel-Typ bereits aktiv: hebt die betroffenen Punkte aus der Liste (unverändertes Bestandsverhalten)", () => {
    const md = "# T\n\n- [ ] Eltern\n  - [ ] Kind eins\n  - [ ] Kind zwei";
    const editor = buildEditor(md);
    editor.commands.setTextSelection(posOfText(editor, "Kind eins"));
    const result = editor.chain().focus().toggleTaskList().run();
    const out = saveLike(editor);
    editor.destroy();
    expect(result).toBe(true);
    // "Kind eins" wandert aus der verschachtelten Liste heraus (liftListItem-
    // Bestandsverhalten) – "Eltern" bleibt trotzdem Checkbox.
    expect(out).toMatch(/^- \[ \] Eltern$/m);
    expect(out).toContain("Kind eins");
    expect(out).toContain("Kind zwei");
  });

  it("kein Listenpunkt an der Selektion: fällt auf das native Verhalten zurück (neue Liste aus einem Absatz anlegen)", () => {
    const md = "# T\n\nEinfacher Absatz";
    const editor = buildEditor(md);
    editor.commands.setTextSelection(posOfText(editor, "Einfacher Absatz"));
    const result = editor.chain().focus().toggleBulletList().run();
    const out = saveLike(editor);
    editor.destroy();
    expect(result).toBe(true);
    expect(out).toBe("# T\n\n- Einfacher Absatz");
  });

  it("TOP-LEVEL-Liste (nicht verschachtelt): dieselbe Logik greift identisch, INKLUSIVE derselben Parser-Bug-Absicherung", () => {
    // KEIN Sonderfall "nur verschachtelt" – convertListItemType behandelt
    // Top-Level-Listen genau gleich (findet seinen Listenpunkt-Vorfahren
    // unabhängig von der Tiefe). Die erste Position einer Liste in eine
    // Aufzählung umzuwandeln, während das zweite Element eine Checkliste
    // bleibt, träfe HIER GENAUSO die in DECISIONS dokumentierte
    // markdown-it-Parser-Lücke (verifiziert: identischer Effekt auch ohne
    // Elternpunkt) – bleibt deshalb ebenfalls ein sicherer No-op.
    const md = "# T\n\n- [ ] Eins\n- [ ] Zwei";
    const editor = buildEditor(md);
    editor.commands.setTextSelection(posOfText(editor, "Eins"));
    const result = editor.chain().focus().toggleBulletList().run();
    const out = saveLike(editor);
    editor.destroy();
    expect(result).toBe(true);
    expect(out).toBe(md); // No-op, siehe Kommentar oben
  });

  it("TOP-LEVEL-Liste, SICHERE Richtung (Checkliste zuerst): Konvertierung greift normal", () => {
    const md = "# T\n\n- [ ] Eins\n- [ ] Zwei";
    const editor = buildEditor(md);
    editor.commands.setTextSelection(posOfText(editor, "Zwei"));
    const result = editor.chain().focus().toggleBulletList().run();
    const out = saveLike(editor);
    editor.destroy();
    expect(result).toBe(true);
    expect(out).toBe("# T\n\n- [ ] Eins\n- Zwei");
    expect(roundtrip(out)).toBe(out);
  });

  it("ohne Editor-Instanz (editor=null) liefert convertListItemType sicher false", () => {
    expect(convertListItemType(null, "bulletList", "listItem")).toBe(false);
  });
});

// Beim Testschreiben gefundener ECHTER Bug in markdown-it-task-lists/
// tiptap-markdown (siehe Kopfkommentar convertListItemTypeCommand,
// DocEditor.jsx): Wandelt man den ERSTEN Punkt einer verschachtelten Liste
// so um, dass ein SPÄTERES, unangetastetes Geschwister weiterhin eine
// Checkliste ist, das umgewandelte Element selbst aber NICHT mehr, ergeben
// die serialisierten "-"-Zeilen beim ERNEUTEN Laden EINE zusammengefasste
// Markdown-Liste (Markdown kennt kein "drei benachbarte, aber strukturell
// getrennte Listen" – reine ProseMirror-Modellinformation). Ist das ERSTE
// <li> dieser zusammengefassten Liste keine Checkbox, während ein SPÄTERES
// eine ist, füllt ProseMirrors HTML-Parser die Content-Schema-Lücke
// ("taskItem+") mit einem gespenstischen LEEREN taskItem auf – verifiziert
// mit purem markdown-it-task-lists, UNABHÄNGIG von tiptap/dieser App.
// convertListItemType erkennt GENAU dieses Muster (siehe
// convertListItemTypeCommand) und bricht kontrolliert ab (sicherer No-op)
// statt die Korruption beim nächsten Laden zu riskieren.
describe("Bewusst abgesicherter Grenzfall: würde die Konvertierung eine bekannte markdown-it-Parser-Lücke auslösen, bleibt sie ein sicherer No-op", () => {
  it("ERSTES von zwei Checklisten-Kindern -> Aufzählung, ZWEITES bleibt Checkliste: No-op statt Korruption", () => {
    const md = "# T\n\n- [ ] Eltern\n  - [ ] Kind eins\n  - [ ] Kind zwei";
    const editor = buildEditor(md);
    editor.commands.setTextSelection(posOfText(editor, "Kind eins"));
    const result = editor.chain().focus().toggleBulletList().run();
    const out = saveLike(editor);
    editor.destroy();
    // "true" (die Chain "greift"), aber OHNE jede Dokumentänderung – siehe
    // Kommentar an convertListItemTypeCommand für die Begründung, warum
    // "true ohne dispatch" hier bewusst gewählt ist (sonst würde die Chain
    // auf den GENAUSO kaputten nativen Fallback zurückfallen).
    expect(result).toBe(true);
    expect(out).toBe(md);
  });

  it("umgekehrt: LETZTES von zwei Aufzählungs-Kindern -> Checkliste, ERSTES bleibt Aufzählung: No-op statt Korruption", () => {
    const md = "# T\n\n- Eltern\n  - Kind eins\n  - Kind zwei";
    const editor = buildEditor(md);
    editor.commands.setTextSelection(posOfText(editor, "Kind zwei"));
    const result = editor.chain().focus().toggleTaskList().run();
    const out = saveLike(editor);
    editor.destroy();
    expect(result).toBe(true);
    expect(out).toBe(md);
  });

  it("beweist, dass die Absicherung wirklich noetig ist: ohne sie würde exakt dieses Muster beim erneuten Laden eine Geister-Checkliste erzeugen", () => {
    // Direkter Beleg der zugrunde liegenden markdown-it/tiptap-markdown-
    // Lücke, UNABHÄNGIG von convertListItemType: Diese Markdown-Zeichenkette
    // (wie sie OHNE die obige Absicherung entstanden wäre) zerfällt beim
    // Laden nachweislich in eine zusätzliche leere Checkliste.
    const wouldHaveBeenSaved = "- [ ] Eltern\n  - Kind eins\n  - [ ] Kind zwei";
    const editor = buildEditor(wouldHaveBeenSaved);
    let emptyTaskItemFound = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "taskItem" && node.textContent === "" && node.childCount <= 1) emptyTaskItemFound = true;
    });
    editor.destroy();
    expect(emptyTaskItemFound).toBe(true);
  });
});
