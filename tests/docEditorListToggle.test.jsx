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
// v7.41.2 UPDATE (siehe DECISIONS und tests/docEditorGhostCheckbox.test.jsx):
// Der ehemals hier dokumentierte "ECHTE Bug in der markdown-it/tiptap-
// markdown-Pipeline" (eine bestimmte Konvertierungsrichtung fügte beim
// NÄCHSTEN Laden lautlos eine Geister-Checkliste ein) ist DIESELBE
// Parser-Lücke wie beim ganz gewöhnlichen "Stichpunktliste gefolgt von
// Checkliste"-Fall (Auftrag "Geister-Checkbox") – SplitMixedTaskLists
// (DocEditor.jsx) löst sie jetzt beim Laden GENERELL auf, unabhängig davon,
// wodurch die zusammengefasste Liste entstanden ist. Der vormals hier
// nötige, kontrollierte No-op in convertListItemTypeCommand ist damit
// ERSATZLOS ENTFALLEN (verifiziert: siehe describe-Block weiter unten,
// "vormals abgesicherter Grenzfall, jetzt behoben") – alle Konvertierungs-
// richtungen funktionieren jetzt normal und bleiben roundtrip-stabil.
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
  MathInline, MathBlock, NestedListToggle, SplitMixedTaskLists, convertListItemType,
  unescapeMd, collapseChecklistGaps, dropEmptyCheckboxLines,
} from "../src/components/DocEditor.jsx";
import { mathToPlaceholders } from "../src/lib/math.jsx";

// Exakt dieselbe Verdrahtung wie tests/docEditorIndent.test.jsx, ergänzt um
// NestedListToggle (muss NACH TaskList/TaskItem stehen, siehe Kommentar an
// der Extension selbst) und SplitMixedTaskLists (v7.41.2, MUSS VOR TaskList/
// TaskItem stehen, siehe Kommentar an DIESER Extension).
function buildEditor(md) {
  return new Editor({
    extensions: [
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
  return dropEmptyCheckboxLines(collapseChecklistGaps(unescapeMd(editor.storage.markdown.getMarkdown())));
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

  // v7.41.2 UPDATE (Folgearbeit-Tabelle im Auftrag "Geister-Checkbox", Zeile
  // "- [ ] A / - [ ] B, Cursor A, Aufzählung -> heute nichts"): war bis
  // v7.41.1 ein sicherer No-op (siehe Git-Historie) – seit SplitMixedTaskLists
  // (DocEditor.jsx) die zugrunde liegende Parser-Lücke beim Laden generell
  // auflöst, konvertiert dieselbe Aktion jetzt tatsächlich UND bleibt
  // roundtrip-stabil.
  it("TOP-LEVEL-Liste (nicht verschachtelt), ERSTE Position -> Aufzählung, ZWEITE bleibt Checkliste: konvertiert jetzt (Parser-Lücke behoben)", () => {
    const md = "# T\n\n- [ ] Eins\n- [ ] Zwei";
    const editor = buildEditor(md);
    editor.commands.setTextSelection(posOfText(editor, "Eins"));
    const result = editor.chain().focus().toggleBulletList().run();
    const out = saveLike(editor);
    editor.destroy();
    expect(result).toBe(true);
    expect(out).toBe("# T\n\n- Eins\n- [ ] Zwei");
    expect(roundtrip(out)).toBe(out);
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

// v7.41.2 UPDATE: Bis v7.41.1 hier per kontrolliertem No-op abgesichert
// (siehe Git-Historie) – die zugrunde liegende Parser-Lücke (markdown-it-
// task-lists + TaskLists starrem "taskItem+"-Content-Schema: ist das ERSTE
// <li> einer zusammengefassten Liste keine Checkbox, während ein SPÄTERES
// eine ist, füllte ProseMirrors HTML-Parser die Schema-Lücke mit einem
// gespenstischen LEEREN taskItem auf) ist DIESELBE wie beim ganz
// gewöhnlichen "Stichpunktliste gefolgt von Checkliste"-Fall (Auftrag
// "Geister-Checkbox", siehe tests/docEditorGhostCheckbox.test.jsx und
// DECISIONS). SplitMixedTaskLists (DocEditor.jsx) löst sie jetzt beim Laden
// GENERELL auf – der No-op in convertListItemTypeCommand ist ersatzlos
// entfallen, beide vormals abgesicherten Richtungen konvertieren jetzt
// korrekt UND bleiben roundtrip-stabil (unten aktiv verifiziert).
describe("vormals abgesicherter Grenzfall (bis v7.41.1), seit SplitMixedTaskLists behoben", () => {
  it("ERSTES von zwei Checklisten-Kindern -> Aufzählung, ZWEITES bleibt Checkliste: konvertiert jetzt korrekt", () => {
    const md = "# T\n\n- [ ] Eltern\n  - [ ] Kind eins\n  - [ ] Kind zwei";
    const editor = buildEditor(md);
    editor.commands.setTextSelection(posOfText(editor, "Kind eins"));
    const result = editor.chain().focus().toggleBulletList().run();
    const out = saveLike(editor);
    editor.destroy();
    expect(result).toBe(true);
    expect(out).toBe("# T\n\n- [ ] Eltern\n  - Kind eins\n  - [ ] Kind zwei");
    expect(roundtrip(out)).toBe(out);
  });

  it("umgekehrt: LETZTES von zwei Aufzählungs-Kindern -> Checkliste, ERSTES bleibt Aufzählung: konvertiert jetzt korrekt", () => {
    const md = "# T\n\n- Eltern\n  - Kind eins\n  - Kind zwei";
    const editor = buildEditor(md);
    editor.commands.setTextSelection(posOfText(editor, "Kind zwei"));
    const result = editor.chain().focus().toggleTaskList().run();
    const out = saveLike(editor);
    editor.destroy();
    expect(result).toBe(true);
    expect(out).toBe("# T\n\n- Eltern\n  - Kind eins\n  - [ ] Kind zwei");
    expect(roundtrip(out)).toBe(out);
  });
});

// Folgearbeit-Tabelle aus dem Auftrag "Geister-Checkbox" (die restlichen,
// noch nicht oben abgedeckten Zeilen – TOP-LEVEL, ERSTE Position ->
// Aufzählung/Checkliste, ein SPÄTERES Geschwister bleibt beim jeweils
// ANDEREN Typ).
describe("Folgearbeit-Tabelle (Auftrag \"Geister-Checkbox\"): alle fünf Fälle funktionieren jetzt", () => {
  it("'- Eins' / '- Zwei' / '- Drei', Cursor 'Zwei', Checkliste: konvertiert nur 'Zwei'", () => {
    const editor = buildEditor("# T\n\n- Eins\n- Zwei\n- Drei");
    editor.commands.setTextSelection(posOfText(editor, "Zwei"));
    const result = editor.chain().focus().toggleTaskList().run();
    const out = saveLike(editor);
    editor.destroy();
    expect(result).toBe(true);
    expect(out).toBe("# T\n\n- Eins\n- [ ] Zwei\n- Drei");
    expect(roundtrip(out)).toBe(out);
  });

  it("'1. Eins' / '2. Zwei', Cursor 'Zwei', Checkliste: unterschiedliche Marker waren nie betroffen, funktioniert unverändert", () => {
    const editor = buildEditor("# T\n\n1. Eins\n2. Zwei");
    editor.commands.setTextSelection(posOfText(editor, "Zwei"));
    const result = editor.chain().focus().toggleTaskList().run();
    const out = saveLike(editor);
    editor.destroy();
    expect(result).toBe(true);
    expect(out).toBe("# T\n\n1. Eins\n- [ ] Zwei");
    expect(roundtrip(out)).toBe(out);
  });
});
