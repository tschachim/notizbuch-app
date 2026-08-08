// @vitest-environment jsdom
//
// v7.41.3, E2E-Finding: Toolbar-Knopf klicken (z. B. "Checkliste"), OHNE
// vorher zurück in den Text zu klicken, dann SOFORT weitertippen – die
// Eingabe landet an der ALTEN Cursor-Position statt im neu erzeugten
// Element. Ursache (siehe ausführlicher Kopfkommentar direkt über der
// Toolbar in DocEditor.jsx und DECISIONS): ein <button> bekommt per
// Browser-Default den DOM-Fokus schon beim mousedown, NOCH VOR dem
// click-Handler; @tiptap/core#focus holt sich den DOM-Fokus danach nur
// ASYNCHRON (per requestAnimationFrame) zurück. Dispatcht der Editier-
// Befehl seine Transaktion vorher (Normalfall), bekommt prosemirror-view
// die ECHTE Browser-Selection nicht mitgezogen (editorOwnsSelection/
// selectionToDOM verlangen view.hasFocus()) – ersetzt der Befehl dabei
// DOM-Knoten AN der alten Cursor-Position, verwaist die Browser-Selection
// und der Browser kollabiert sie von sich aus auf die nächstgelegene
// Position.
//
// GRENZE DIESER TESTS (ehrlich, wie im Auftrag verlangt): jsdom
// implementiert den oben beschriebenen Browser-Default "mousedown
// verschiebt den DOM-Fokus auf ein fokussierbares Ziel" NICHT (empirisch
// geprüft: ein dispatchEvent("mousedown") auf einen <button> ändert
// document.activeElement in jsdom nie, weder mit noch ohne
// preventDefault). Ein Test, der NACH einem simulierten Klick prüft, WO
// document.activeElement liegt oder wohin anschließend getippter Text
// landet, wäre deshalb IMMER grün – auch ganz ohne den Fix – und würde nur
// vortäuschen, das eigentliche Browser-Verhalten zu belegen. Stattdessen
// wird hier geprüft, was in jsdom TATSÄCHLICH aussagekräftig ist:
//
// 1. Der Mechanismus selbst, an einem ECHT gerenderten Editor: löst der
//    onMouseDown-Handler tatsächlich preventDefault() auf dem Event aus
//    (per event.defaultPrevented, das jsdom korrekt nachführt) – und zwar
//    GENAU auf den Knöpfen, die laut Analyse betroffen sind, NICHT auf den
//    bewusst ausgenommenen (Popover-Öffner/-Inhalte, Bild-Trigger,
//    Speichern/Abbrechen). Beschränkt auf Knöpfe, die in einem einfachen
//    Dokument beim Mounten NICHT disabled sind (React dispatcht
//    Maus-Events an disabled-Elemente grundsätzlich nicht – ein
//    disabled-Knopf lässt sich ohnehin nicht anklicken, das ist unabhängig
//    vom hier zu prüfenden Fix). Ohne den Fix ist dieser Block GARANTIERT
//    rot (kein Knopf hatte vorher überhaupt einen onMouseDown-Handler).
// 2. Eine VOLLSTÄNDIGE, quelltextbasierte Prüfung ALLER betroffenen Knöpfe
//    (auch der standardmäßig deaktivierten wie "Einzug verkleinern" oder
//    "Rückgängig", die sich ohne direkten Editor-Zugriff nicht zuverlässig
//    in einen aktivierten Zustand versetzen lassen) – deterministisch,
//    unabhängig von jsdom-Eigenheiten, und ebenfalls ohne den Fix
//    garantiert rot.
// 3. Die reine Editor-Ebene (ohne DOM/Fokus): dass die von "Checkliste"
//    ausgelöste Dokument-Umstrukturierung (convertListItemTypeCommand/
//    NestedListToggle) die ProseMirror-Selektion korrekt in den neuen,
//    leeren Checklisten-Punkt legt (UND identisch mit TipTaps eingebautem
//    toggleTaskList, ohne NestedListToggle) – das belegt die Analyse aus
//    dem Auftrag ("ist convertListItemTypeCommand die Ursache?" -> nein,
//    siehe DECISIONS).
//    PRÄZISIERUNG v7.49 (DECISIONS #101): Diese Aussage gilt NUR, weil das
//    Dokument hier mit der Liste ENDET – dann rettet die Rückwärtssuche von
//    Selection.near die Position zufällig. Steht dahinter noch ein Block,
//    landete die Selektion sehr wohl im Folgeblock; das ist eine ZWEITE,
//    eigenständige Ursache, die v7.49 separat behebt (siehe
//    tests/docEditorListToggleSelection.test.jsx). Der DOM-Fokus-Diebstahl,
//    um den es in DIESER Datei geht, bleibt davon unberührt.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { Markdown } from "tiptap-markdown";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import DocEditor, {
  FencedCodeBlock, BlockImage, IndentParagraph, IndentMarkdownIt, IndentKeymap, MdTable,
  MathInline, MathBlock, NestedListToggle, SplitMixedTaskLists,
} from "../src/components/DocEditor.jsx";
import { mathToPlaceholders } from "../src/lib/math.jsx";

// "await" + ein requestAnimationFrame-Tick INNERHALB von act(): useEditor()
// setzt "autofocus: 'start'" (siehe DocEditor.jsx), was denselben
// RAF-verzögerten @tiptap/core#focus-Mechanismus anstößt, der Gegenstand
// dieses gesamten Tests ist (siehe Kopfkommentar) – ohne diesen Flush
// feuert die RAF-Callback irgendwann WÄHREND eines SPÄTEREN, nicht
// zugehörigen Tests und React meldet dort einen irreführenden
// "not wrapped in act"-Hinweis. Rein kosmetisch (ändert am Testergebnis
// nichts), aber sauberer.
async function mountDocEditor(initialDoc, extraProps = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const props = {
    initialDoc,
    imgMap: {},
    onSave: () => {},
    onCancel: () => {},
    saving: false,
    navWidth: 148,
    autocorrect: undefined,
    ...extraProps,
  };
  await act(async () => {
    root.render(<DocEditor {...props} />);
    await new Promise((r) => requestAnimationFrame(r));
  });
  return { container, root };
}

// Feuert ein ECHTES, "cancelable" mousedown-Event auf ein Element und
// meldet zurück, ob IRGENDEIN Handler preventDefault() aufgerufen hat.
function mousedownPrevented(el) {
  const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev.defaultPrevented;
}

function byTitle(container, title) {
  const el = container.querySelector('button[title="' + title + '"]');
  if (!el) throw new Error('Button mit title="' + title + '" nicht gefunden');
  return el;
}

function byText(container, text) {
  const el = Array.from(container.querySelectorAll("button")).find((b) => b.textContent.trim() === text);
  if (!el) throw new Error('Button mit Text "' + text + '" nicht gefunden');
  return el;
}

describe("Toolbar-Knöpfe (echt gerendert): onMouseDown+preventDefault greift auf den betroffenen, NICHT deaktivierten Knöpfen (v7.41.3-Fix)", () => {
  it("Formatierung/Überschriften/Listen/Trennlinie/Formel rufen preventDefault auf mousedown auf (ohne Fix garantiert rot)", async () => {
    const { container, root } = await mountDocEditor("# T\n\n- eins\n- zwei\n- ");
    const shouldPrevent = [
      "Kapitel (#)", "Abschnitt (##)", "Unterthema (###)",
      "Fett", "Kursiv", "Durchgestrichen", "Code", "Codeblock",
      "Stichpunktliste", "Nummerierte Liste", "Checkliste",
      "Trennlinie",
      "Formel einfügen (inline, $…$)", "Formel einfügen (abgesetzt, $$…$$)",
      // "Tabelle einfügen" war zunächst als Popover-Öffner ausgenommen; der
      // Review hat am Quellcode belegt, dass insertTable ueber
      // tr.replaceSelectionWith genau die Knotenersetzung an der
      // Cursor-Position macht, die das Orphaning ausloest – und dass der
      // Fokus beim Klick auf eine Rasterzelle laengst beim Oeffner liegt.
      // Deshalb GESCHUETZT (Oeffner + Raster-Container), siehe DECISIONS #85.
      "Tabelle einfügen",
    ];
    for (const title of shouldPrevent) {
      expect(mousedownPrevented(byTitle(container, title)), title).toBe(true);
    }
    await act(async () => root.unmount());
  });

  it("Popover-Öffner, Bild-Trigger und Speichern/Abbrechen bleiben BEWUSST ohne preventDefault", async () => {
    const { container, root } = await mountDocEditor("# T\n\n- eins\n- zwei\n- ", { onAddImage: vi.fn() });
    // "Tabelle einfügen" steht bewusst NICHT mehr hier – siehe den
    // shouldPrevent-Test oben und DECISIONS #85.
    const shouldNotPrevent = ["Schriftfarbe", "Textmarker", "Link einfügen/bearbeiten", "Bild einfügen"];
    for (const title of shouldNotPrevent) {
      expect(mousedownPrevented(byTitle(container, title)), title).toBe(false);
    }
    expect(mousedownPrevented(byText(container, "Speichern"))).toBe(false);
    expect(mousedownPrevented(byText(container, "Abbrechen"))).toBe(false);
    await act(async () => root.unmount());
  });

  it("Tabellen-Werkzeuge (addRowAfter/addColumnAfter/deleteColumn/deleteTable) rufen preventDefault auf – 'Aktuelle Zeile löschen' ist beim Mounten in der Kopfzeile deaktiviert und wird deshalb NUR im Quelltext-Test unten geprüft", async () => {
    // Dokument beginnt DIREKT mit einer Tabelle + autofocus:"start" (siehe
    // useEditor() in DocEditor.jsx) -> die Selektion steht beim Mounten
    // bereits in der ersten (Kopf-)Zelle, ohne dass der Test selbst
    // irgendeine Klick-Koordinate simulieren müsste (in jsdom ohnehin
    // nicht möglich, da kein echtes Layout existiert).
    const md = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    const { container, root } = await mountDocEditor(md);
    expect(container.querySelector('button[title="Zeile unterhalb einfügen"]')).toBeTruthy();

    expect(mousedownPrevented(byTitle(container, "Zeile unterhalb einfügen"))).toBe(true);
    expect(mousedownPrevented(byTitle(container, "Spalte rechts einfügen"))).toBe(true);
    expect(mousedownPrevented(byTitle(container, "Aktuelle Spalte löschen"))).toBe(true);
    expect(mousedownPrevented(byText(container, "✕Tabelle"))).toBe(true);
    await act(async () => root.unmount());
  });
});

// Quelltextbasierte Vollständigkeitsprüfung (siehe Kopfkommentar, Punkt 2):
// deckt zusätzlich die standardmäßig deaktivierten Knöpfe ab (Einzug,
// Rückgängig/Wiederholen, Zeile löschen in der Kopfzeile), für die sich in
// einem gerenderten Test ohne direkten Editor-Zugriff kein aktivierter
// Ausgangszustand herstellen lässt.
// process.cwd() statt import.meta.url: npm-Skripte (siehe CLAUDE.md) laufen
// stets aus notizbuch-app/ heraus, dieselbe Annahme wie vitest.config.js
// selbst ("tests/**/*") trifft.
const DOC_EDITOR_SRC = readFileSync(resolve(process.cwd(), "src/components/DocEditor.jsx"), "utf8");

// Sucht das <button ...>, dessen Attribute den (eindeutigen) Marker
// enthalten, und prüft, ob "onMouseDown={preventFocusSteal}" darin steht.
// lastIndexOf("<button", …) statt eines vollen JSX-Parsers reicht: jeder
// Marker steht innerhalb DERSELBEN öffnenden <button>-Tag wie ein
// eventuelles onMouseDown (siehe Toolbar-JSX), ein voranstehendes </button>
// eines ANDEREN Knopfes läge dazwischen und würde den Test sofort mit
// einer falschen Fundstelle auffliegen lassen (Marker sind unique genug).
function hasPreventFocusSteal(marker) {
  const idx = DOC_EDITOR_SRC.indexOf(marker);
  if (idx === -1) throw new Error("Marker nicht im Quelltext gefunden: " + marker);
  const tagStart = DOC_EDITOR_SRC.lastIndexOf("<button", idx);
  if (tagStart === -1) throw new Error("Kein <button vor Marker gefunden: " + marker);
  return DOC_EDITOR_SRC.slice(tagStart, idx).includes("onMouseDown={preventFocusSteal}");
}

describe("Toolbar-Knöpfe (Quelltext): onMouseDown={preventFocusSteal} exakt auf den betroffenen Knöpfen", () => {
  it("Formatierung/Überschriften/Listen/Einzug/Trennlinie/Formel/Tabellen-Zeilen-Spalten/Rückgängig-Wiederholen sind erfasst", () => {
    const markers = [
      ".toggleHeading({ level: 1 }).run()",
      ".toggleHeading({ level: 2 }).run()",
      ".toggleHeading({ level: 3 }).run()",
      ".toggleBold().run()",
      ".toggleItalic().run()",
      ".toggleStrike().run()",
      ".toggleCode().run()",
      ".toggleCodeBlock().run()",
      ".toggleBulletList().run()",
      ".toggleOrderedList().run()",
      ".toggleTaskList().run()",
      "onClick={() => changeIndent(editor, -1)}",
      "onClick={() => changeIndent(editor, 1)}",
      ".setHorizontalRule().run()",
      "onClick={() => insertMath(false)}",
      "onClick={() => insertMath(true)}",
      ".addRowAfter().run()",
      ".addColumnAfter().run()",
      ".deleteRow().run()",
      ".deleteColumn().run()",
      ".deleteTable().run()",
      ".undo().run()",
      ".redo().run()",
    ];
    for (const marker of markers) {
      expect(hasPreventFocusSteal(marker), marker).toBe(true);
    }
  });

  it("Das Tabellen-Größen-Raster ist ebenfalls geschützt (Container statt 36 Zellen – mousedown blubbert hoch)", () => {
    // Kein <button>, deshalb nicht über hasPreventFocusSteal prüfbar: das
    // Raster ist ein <div>. Es MUSS geschützt sein, weil insertTable per
    // tr.replaceSelectionWith einen Knoten an der Cursor-Position ersetzt
    // und der Fokus zu diesem Zeitpunkt schon beim Öffner liegt
    // (Review-Befund zu v7.41.3, siehe DECISIONS #85).
    expect(DOC_EDITOR_SRC).toContain(
      '<div className="grid grid-cols-6 gap-0.5" onMouseDown={preventFocusSteal}>'
    );
  });

  it("Popover-Öffner/-Inhalte, Bild-Trigger-Knopf und Speichern/Abbrechen bleiben ausgenommen", () => {
    const markers = [
      'onClick={() => setPicker(picker === "color" ? null : "color")}',
      'onClick={() => setPicker(picker === "highlight" ? null : "highlight")}',
      'onClick={() => (picker === "link" ? closeLinkPicker() : openLinkPicker())}',
      "imageFileInputRef.current && imageFileInputRef.current.click()",
      "onClick={save}",
      "onClick={onCancel}",
    ];
    for (const marker of markers) {
      expect(hasPreventFocusSteal(marker), marker).toBe(false);
    }
  });
});

// Belegt Punkt 1 der Auftrags-Analyse ("ist convertListItemTypeCommand die
// Ursache?"): die interne ProseMirror-Selektion landet nach dem Toggle in
// BEIDEN Fällen (mit UND ohne NestedListToggle, siehe Extensions-Liste)
// korrekt im neuen, leeren Checklisten-Punkt – identisch zum Verhalten VOR
// v7.41.1. Der HIER behandelte Defekt liegt in der Browser/DOM-Fokus-Ebene,
// nicht in dieser Dokument-Umstrukturierung.
//
// PRÄZISIERUNG v7.49 (DECISIONS #101): "korrekt im neuen Punkt" gilt nur,
// weil das Testdokument unten mit der Liste ENDET. Mit einem Folgeblock
// dahinter schob das Standard-Selektionsmapping die Position ans Ende des
// ersetzten Bereichs, und Selection.near sprang vorwärts IN den Folgeblock –
// eine zweite, eigenständige Ursache, die v7.49 in
// convertListItemTypeCommand behebt (Regressionstests in
// tests/docEditorListToggleSelection.test.jsx). Beide Fixes sind nötig.
function buildHeadlessEditor(md, { withNestedListToggle }) {
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
      ...(withNestedListToggle ? [NestedListToggle] : []),
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

describe("Analyse-Beleg: der DOM-Fokus-Diebstahl ist eine EIGENE Ursache (der Selektions-Teil steckt in docEditorListToggleSelection.test.jsx, v7.49)", () => {
  it.each([
    ["MIT NestedListToggle (aktueller Code)", true],
    ["OHNE NestedListToggle (TipTaps eingebautes toggleTaskList)", false],
  ])("%s: Selektion landet nach 'Checkliste'-Toggle im neuen leeren Punkt, Text landet dort", (_label, withNestedListToggle) => {
    // Exakter Tester-Repro: "eins", Enter, "zwei", Enter -> leerer 3. Punkt.
    const editor = buildHeadlessEditor("- eins\n- zwei\n- ", { withNestedListToggle });
    // Cursor in den leeren 3. Punkt (Dokumentende).
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);

    const result = editor.chain().focus().toggleTaskList().run();
    expect(result).toBe(true);

    // Die Selektion muss jetzt INNERHALB des neuen taskItem-Absatzes
    // stehen, NICHT mehr am Ende von "zwei".
    const $sel = editor.state.doc.resolve(editor.state.selection.from);
    let inTaskItem = false;
    for (let d = $sel.depth; d > 0; d--) {
      if ($sel.node(d).type.name === "taskItem") inTaskItem = true;
    }
    expect(inTaskItem).toBe(true);

    editor.commands.insertContent("Aufgabe A");
    const md = editor.storage.markdown.getMarkdown();
    editor.destroy();

    expect(md).toContain("- [ ] Aufgabe A");
    // "zwei" darf NICHT den neuen Text abbekommen haben (das war exakt der
    // gemeldete Fehler: "QA-Geister zweiQA-Geister Aufgabe A").
    expect(md).not.toContain("zweiAufgabe A");
  });
});
