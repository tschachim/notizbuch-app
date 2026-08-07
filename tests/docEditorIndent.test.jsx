// @vitest-environment jsdom
//
// v7.41 (Auftrag "Einrückungen", Nutzerwunsch "Icons wie in Excel"): echter
// TipTap/markdown-it-Roundtrip nach demselben Muster wie
// tests/docEditorMath.test.jsx/docEditorCode.test.jsx/docEditorOutline.test.jsx
// statt String-Helfer nachzubauen. Deckt ab:
//  1. Editor-Ladepfad (IndentMarkdownIt): führende Leerzeichen eines
//     TOP-LEVEL-Absatzes/Bildes werden als "indent"-Attribut übernommen,
//     "code" (eingerückte Codeblöcke) ist deaktiviert, Inhalt INNERHALB
//     eines Listenpunkts bekommt KEIN eigenes indent-Attribut.
//  2. Editor-Roundtrip: Laden -> Speichern bleibt byte-identisch (Idempotenz),
//     inklusive des ORIGINAL-Ausschnitts aus dem Nutzer-Auftrag.
//  3. changeIndent/canChangeIndent: Einzelzeile, Mehrfachauswahl (EIN
//     Undo-Schritt), Überschrift (No-op), Grenzen 0/6, Listen-Sink/Lift.
//  4. Tab/Shift-Tab (IndentKeymap): bestehende Bindungen (Tabelle/Liste)
//     bleiben vorrangig, unser Kommando greift nur als Fallback.
//  5. TaskItem.configure({nested:true})-Probe (Auftrag A2): normale
//     Aufzählungs-/Nummerierungs-Verschachtelung bleibt roundtrip-stabil.
//  6. collapseChecklistGaps: der beim Testschreiben gefundene ECHTE Bug
//     (taskList bekommt bei tiptap-markdown NIE ein "tight"-Attribut, der
//     Serializer setzt deshalb IMMER eine Leerzeile vor einer verschachtelten
//     Nicht-Checklisten-Liste – siehe Kommentar in DocEditor.jsx).
//  7. Regressionstests aus dem Code-Review VOR dem v7.41-Commit: Blocker 1
//     (Item-Typ-Auflösung bei einer Bullet-Liste INNERHALB einer Checkliste),
//     "ganze Liste markiert" (D16-Grenze), MathBlock-Einzug (Finding 6).
//  8. v7.41.1 (E2E-Fund am Live-Lauf von v7.41): 🔴 Blocker 1 – eine ECHTE
//     Browser-Mausselektion, deren Anker/Ende exakt auf der Blockgrenze vor
//     einem Bild/einer Formel landet, überspringt den Blatt-Knoten beim
//     Übersetzen in ein ProseMirror-Selection-Objekt (TextSelection.between,
//     siehe DocEditor.jsx#extendPastSkippedLeaves) – das Bild fehlt dadurch
//     in der Auswahl, obwohl der Klick es erkennbar einschließen sollte.
//
// Nur DIESE Datei braucht jsdom (per-Datei-Override), der Rest der Suite
// bleibt bei environment:"node" (vitest.config.js).
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { Markdown } from "tiptap-markdown";
import { TextSelection } from "@tiptap/pm/state";
import {
  FencedCodeBlock, BlockImage, IndentParagraph, IndentMarkdownIt, IndentKeymap, MdTable,
  MathInline, MathBlock, SplitMixedTaskLists,
  unescapeMd, collapseChecklistGaps, dropEmptyCheckboxLines, changeIndent, canChangeIndent,
} from "../src/components/DocEditor.jsx";
import { mathToPlaceholders } from "../src/lib/math.jsx";

// Exakt die Verdrahtung aus DocEditor.jsx (useEditor()) – IndentKeymap ZUERST
// (niedrigste Tastatur-Priorität, siehe Kommentar dort), paragraph:false +
// IndentParagraph, TaskItem mit nested:true, SplitMixedTaskLists VOR
// TaskList/TaskItem (v7.41.2, siehe Kommentar an der Extension).
function buildEditor(md, extra = []) {
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
      MdTable.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      MathInline,
      MathBlock,
      IndentMarkdownIt,
      ...extra,
      Markdown.configure({ html: true, bulletListMarker: "-", tightLists: true }),
    ],
    content: mathToPlaceholders(md),
  });
}

// Simuliert exakt den save()-Pfad in DocEditor.jsx (ohne unresolveImgs/
// data:-Check, die hier nicht gebraucht werden): unescapeMd, dann
// collapseChecklistGaps, dann dropEmptyCheckboxLines (v7.41.2, Geister-
// Checkbox-Netz, siehe dort – läuft in save() NACH collapseChecklistGaps).
function saveLike(editor) {
  return dropEmptyCheckboxLines(collapseChecklistGaps(unescapeMd(editor.storage.markdown.getMarkdown())));
}

// ECHTER Tastendruck über die reale ProseMirror-Keymap-Kette (Re-Review vor
// v7.41-Commit): editor.commands.keyboardShortcut() (tiptap-eigener
// Test-Helfer) repliziert NACHWEISLICH nur dokument-ändernde Steps, KEINE
// reinen Selektionswechsel (siehe DECISIONS #81) – view.someProp(
// "handleKeyDown", …) läuft dagegen über GENAU denselben Mechanismus, den
// ProseMirror bei einem echten Tastendruck im Browser selbst verwendet
// (jede Keymap-Extension registriert ihre Bindungen als eigenes
// "handleKeyDown"-Plugin-Prop, someProp probiert sie in Plugin-Reihenfolge
// durch, bis eine "true" liefert) und macht dadurch AUCH reine
// Selektionswechsel (z. B. goToNextCell) beobachtbar.
//
// WICHTIG (beim Nachziehen dieses Fixes selbst gefunden): "key" ist der
// ECHTE KeyboardEvent.key-Wert ("Tab"), NICHT der tiptap-interne
// Bindungsname ("Shift-Tab")! prosemirror-keymap#keydownHandler ermittelt
// den Bindungsnamen selbst über modifiers(w3cKeyname.keyName(event), event)
// – die Umschalt-Taste kommt AUSSCHLIESSLICH über event.shiftKey (den
// dritten Parameter hier) rein und wird von prosemirror-keymap selbst als
// "Shift-"-Präfix vor den Namen gesetzt. Ein Aufruf mit key="Shift-Tab" UND
// shift=true würde intern "Shift-Shift-Tab" ergeben (keine Bindung matcht
// das) – für Shift-Tab also immer realKey(editor, "Tab", true) aufrufen.
function realKey(editor, key, shift) {
  const ev = new KeyboardEvent("keydown", { key, shiftKey: !!shift, bubbles: true, cancelable: true });
  return editor.view.someProp("handleKeyDown", (f) => f(editor.view, ev)) || false;
}

function roundtrip(md) {
  const editor = buildEditor(md);
  const out = saveLike(editor);
  editor.destroy();
  return out;
}

describe("Editor-Ladepfad: IndentMarkdownIt (v7.41)", () => {
  it("4 Leerzeichen erzeugen KEINEN Codeblock mehr (md.disable(\"code\"))", () => {
    const editor = buildEditor("# T\n\nAbsatz\n\n    Eingerueckter Absatz Ebene 2");
    let hasCodeBlock = false;
    let indentedParagraphText = null;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "codeBlock") hasCodeBlock = true;
      if (node.type.name === "paragraph" && node.attrs.indent === 2) indentedParagraphText = node.textContent;
    });
    editor.destroy();
    expect(hasCodeBlock).toBe(false);
    expect(indentedParagraphText).toBe("Eingerueckter Absatz Ebene 2");
  });

  it("ein Top-Level-Absatz mit 2 Leerzeichen bekommt indent:1 im ProseMirror-Dokument", () => {
    const editor = buildEditor("# T\n\n  Eingerueckt");
    let indent = null;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "paragraph" && node.textContent === "Eingerueckt") indent = node.attrs.indent;
    });
    editor.destroy();
    expect(indent).toBe(1);
  });

  it("ein Bild allein auf einer eingerückten Zeile bekommt indent auf dem Bild-Node, NICHT auf einem Phantom-Absatz", () => {
    const editor = buildEditor("# T\n\n  ![Titel](data:image/png;base64,AAA)");
    let imageIndent = null;
    let looseParagraphCount = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "image") imageIndent = node.attrs.indent;
      if (node.type.name === "paragraph" && node.textContent === "") looseParagraphCount++;
    });
    editor.destroy();
    expect(imageIndent).toBe(1);
    // BUGFIX (Code-Review vor v7.41-Commit, 🟡 Finding 5b): looseParagraphCount
    // wurde bisher hochgezählt, aber NIE geprüft – der Testname behauptet
    // "NICHT auf einem Phantom-Absatz", ohne das je zu belegen. ProseMirror
    // hebt den block-level Bild-Node aus seinem umschließenden <p> heraus
    // (siehe IndentMarkdownIt-Kommentar), ein übrig bleibender LEERER
    // Absatz wäre genau das befürchtete Phantom.
    expect(looseParagraphCount).toBe(0);
  });

  it("Inhalt INNERHALB eines Listenpunkts bekommt KEIN eigenes indent-Attribut (kein doppelter Einzug)", () => {
    // Lose Liste: "Parent" + eine per Leerzeile abgesetzte Fortsetzung,
    // beide je 0/2 Leerzeichen eingerückt wie es markdown-it für einen
    // Listenpunkt erwartet (Fortsetzung auf Höhe des Punkt-Inhalts).
    const md = "# T\n\n- Parent\n\n  Fortsetzung im selben Listenpunkt";
    const editor = buildEditor(md);
    let continuationIndent = "not-found";
    editor.state.doc.descendants((node) => {
      if (node.type.name === "paragraph" && node.textContent === "Fortsetzung im selben Listenpunkt") {
        continuationIndent = node.attrs.indent;
      }
    });
    editor.destroy();
    expect(continuationIndent).toBe(0);
  });

  it("eine eingerückte Zeile INNERHALB einer Tabellenzelle bekommt kein indent-Attribut (Tiefenprüfung erfasst auch Tabellen)", () => {
    // GFM-Tabellenzellen haben zwar keinen eigenen Absatz-Wrapper, der
    // Tiefenzähler in IndentMarkdownIt muss Tabellen trotzdem als "nicht
    // oberste Ebene" behandeln (Auftrag: "NICHT innerhalb von
    // list_item_open/blockquote_open/Tabellen") - dieser Test pinnt ab,
    // dass ein normaler Absatz NACH der Tabelle unbeeinflusst bleibt.
    const editor = buildEditor("# T\n\n| a |\n| --- |\n| 1 |\n\n  Nach der Tabelle eingerueckt");
    let afterIndent = null;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "paragraph" && node.textContent === "Nach der Tabelle eingerueckt") afterIndent = node.attrs.indent;
    });
    editor.destroy();
    expect(afterIndent).toBe(1);
  });
});

describe("Editor-Roundtrip: Idempotenz (v7.41)", () => {
  it("Original-Ausschnitt aus dem Nutzer-Auftrag bleibt byte-identisch (Checkliste mit eingerückten Unterpunkten, Bild, Bildunterschrift)", () => {
    const md = [
      "- [ ] Problem auf DEV mit MD Code, zum Beispiel PM lid 1901423",
      "  - Fehler: Error (#DL1): Execution Timeout Expired im MDCore-Teil …",
      "  - md-filter „not optimized (bgmdcore)“; `BgMdcore` mit PartID:67 …",
      "  - ~10-Minuten-Lücke im Log (04:33:12 → 04:43:12) vor dem Timeout …",
      "  - Betroffenes Statement: Temp-Table-Drops `#CMP_DFY` / `#TIIDS` …",
      "",
      "![MDCore Execution Timeout auf DEV](img:mshbjmyp7sfzu)",
      "",
      "*Log des MDCore-Laufs (file version 26.08.05.1843, ChangeSet:4517) …*",
    ].join("\n");
    const out = roundtrip(md);
    expect(out).toBe(md);
    // Idempotent: ein zweiter Lade-/Speicherzyklus bleibt stabil.
    expect(roundtrip(out)).toBe(out);
  });

  it("Absätze auf allen Ebenen (0-6) bleiben nach dem Laden+Speichern exakt gleich eingerückt", () => {
    for (let level = 0; level <= 6; level++) {
      const md = "# T\n\n" + " ".repeat(level * 2) + "Ebene " + level;
      expect(roundtrip(md)).toBe(md);
    }
  });

  it("ein Tab im Quelltext wird beim Laden wie 2 Leerzeichen behandelt, beim Speichern aber IMMER als Leerzeichen geschrieben (keine Tabs)", () => {
    const md = "# T\n\n\tMit Tab eingerueckt";
    const out = roundtrip(md);
    expect(out).toBe("# T\n\n  Mit Tab eingerueckt"); // Tab -> Ebene 1 -> 2 Leerzeichen
    expect(out).not.toContain("\t");
  });

  it("eine Bild+Bildunterschrift-Kombination bleibt nach dem Einrücken exakt EINE 2-Leerzeichen-Ebene (kein Verdoppeln)", () => {
    const md = "# T\n\n![Bild](img:xyz)\n\n*Unterschrift*";
    const editor = buildEditor(md);
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
    const applied = changeIndent(editor, 1);
    const out = saveLike(editor);
    editor.destroy();
    expect(applied).toBe(true);
    expect(out).toBe("# T\n\n  ![Bild](img:xyz)\n\n  *Unterschrift*");
  });
});

describe("changeIndent/canChangeIndent (v7.41, Auftrag \"Einrückungen\")", () => {
  it("rückt einen einzelnen Absatz an der Cursorposition ein", () => {
    const editor = buildEditor("# T\n\nAbsatz");
    editor.commands.setTextSelection(4); // Cursor irgendwo im Absatz
    expect(canChangeIndent(editor, 1)).toBe(true);
    const applied = changeIndent(editor, 1);
    editor.destroy();
    expect(applied).toBe(true);
  });

  // BUGFIX (Re-Review vor v7.41-Commit, 🔵 Finding H): Ein LEERER Absatz
  // (z. B. ein frisches Dokument) ließ sich vorher trotzdem einrücken –
  // IndentParagraph schreibt den Einzug beim Speichern IMMER vor den
  // (hier leeren) Inhalt, das Ergebnis war eine Zeile aus REINEN
  // Leerzeichen im committeten Markdown (in der Ansicht unsichtbar, aber
  // eine Whitespace-only-Zeile im gespeicherten Dokument).
  it("ein LEERER Absatz (z. B. frisches Dokument) lässt sich nicht einrücken (kein Whitespace-only-Commit)", () => {
    const editor = buildEditor("");
    const can = canChangeIndent(editor, 1);
    const applied = changeIndent(editor, 1);
    const out = saveLike(editor);
    editor.destroy();
    expect(can).toBe(false);
    expect(applied).toBe(false);
    expect(out).toBe("");
  });

  it("Grenze 0: ein nicht eingerückter Absatz kann nicht weiter verkleinert werden", () => {
    const editor = buildEditor("# T\n\nAbsatz");
    editor.commands.setTextSelection(4);
    expect(canChangeIndent(editor, -1)).toBe(false);
    const applied = changeIndent(editor, -1);
    editor.destroy();
    expect(applied).toBe(false);
  });

  it("Grenze 6: ein maximal eingerückter Absatz kann nicht weiter vergrößert werden", () => {
    const md = "# T\n\n" + "  ".repeat(6) + "ganz unten";
    const editor = buildEditor(md);
    editor.commands.setTextSelection(4);
    expect(canChangeIndent(editor, 1)).toBe(false);
    const applied = changeIndent(editor, 1);
    const out = saveLike(editor);
    editor.destroy();
    expect(applied).toBe(false);
    expect(out).toBe(md); // unverändert
  });

  it("eine Überschrift ist ein No-op (wird nie eingerückt)", () => {
    const editor = buildEditor("# T\n\n## Abschnitt\n\nAbsatz");
    let headingPos = null;
    editor.state.doc.descendants((node, pos) => {
      if (headingPos === null && node.type.name === "heading" && node.attrs.level === 2) headingPos = pos;
    });
    editor.commands.setTextSelection(headingPos + 2);
    expect(canChangeIndent(editor, 1)).toBe(false);
    const applied = changeIndent(editor, 1);
    editor.destroy();
    expect(applied).toBe(false);
  });

  it("Mehrfachauswahl über Absatz UND Bild: BEIDE Blöcke werden in EINER Transaktion (ein Undo-Schritt) eingerückt", () => {
    const md = "# T\n\nAbsatz eins\n\n![Bild](data:image/png;base64,AAA)";
    const editor = buildEditor(md);
    // selectAll() statt einer manuell berechneten Endposition: das Bild ist
    // ein atomarer Node OHNE Inline-Inhalt – eine TextSelection darf dort
    // nicht enden, AllSelection deckt trotzdem beide Blöcke ab.
    editor.commands.selectAll();
    const applied = changeIndent(editor, 1);
    const out = saveLike(editor);
    editor.destroy();
    expect(applied).toBe(true);
    expect(out).toContain("  Absatz eins");
    expect(out).toContain("  ![Bild]");
  });

  it("EIN Undo-Schritt hebt eine Mehrfachauswahl-Einrückung vollständig auf", () => {
    const md = "# T\n\nAbsatz eins\n\nAbsatz zwei";
    const editor = buildEditor(md);
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
    changeIndent(editor, 1);
    const indented = saveLike(editor);
    expect(indented).toBe("# T\n\n  Absatz eins\n\n  Absatz zwei");
    editor.commands.undo();
    const undone = saveLike(editor);
    editor.destroy();
    expect(undone).toBe(md); // EIN undo() macht BEIDE Absätze rückgängig
  });

  it("sinkListItem für einen Listenpunkt: der zweite Punkt kann unter den ersten sinken", () => {
    const editor = buildEditor("# T\n\n- Eins\n- Zwei");
    let pos = null;
    editor.state.doc.descendants((node, p) => {
      if (node.isText && node.text === "Zwei") pos = p;
    });
    editor.commands.setTextSelection(pos);
    expect(canChangeIndent(editor, 1)).toBe(true);
    const applied = changeIndent(editor, 1);
    const out = saveLike(editor);
    editor.destroy();
    expect(applied).toBe(true);
    expect(out).toBe("# T\n\n- Eins\n  - Zwei");
  });

  it("liftListItem: ein bereits gesunkener Punkt kann wieder hochgehoben werden (Shift-Tab-Äquivalent)", () => {
    const editor = buildEditor("# T\n\n- Eins\n  - Zwei");
    let pos = null;
    editor.state.doc.descendants((node, p) => {
      if (node.isText && node.text === "Zwei") pos = p;
    });
    editor.commands.setTextSelection(pos);
    expect(canChangeIndent(editor, -1)).toBe(true);
    changeIndent(editor, -1);
    const out = saveLike(editor);
    editor.destroy();
    expect(out).toBe("# T\n\n- Eins\n- Zwei");
  });

  it("der ERSTE Listenpunkt einer Liste kann nicht weiter einrücken (sinkListItem liefert false)", () => {
    const editor = buildEditor("# T\n\n- Eins\n- Zwei");
    let pos = null;
    editor.state.doc.descendants((node, p) => {
      if (node.isText && node.text === "Eins") pos = p;
    });
    editor.commands.setTextSelection(pos);
    expect(canChangeIndent(editor, 1)).toBe(false);
    const applied = changeIndent(editor, 1);
    editor.destroy();
    expect(applied).toBe(false);
  });

  it("eine Checkliste kann verschachtelt werden (nested:true, sinkListItem('taskItem'))", () => {
    const editor = buildEditor("# T\n\n- [ ] Eins\n- [ ] Zwei");
    let pos = null;
    editor.state.doc.descendants((node, p) => {
      if (node.isText && node.text === "Zwei") pos = p;
    });
    editor.commands.setTextSelection(pos);
    changeIndent(editor, 1);
    const out = saveLike(editor);
    editor.destroy();
    expect(out).toBe("# T\n\n- [ ] Eins\n  - [ ] Zwei");
  });

  it("eine Auswahl innerhalb einer Tabellenzelle bleibt ein No-op (Tabellen sind kein Einzugsziel)", () => {
    const editor = buildEditor("# T\n\n| a |\n| --- |\n| 1 |");
    let cellTextPos = null;
    editor.state.doc.descendants((node, p) => {
      if (node.isText && node.text === "a") cellTextPos = p;
    });
    editor.commands.setTextSelection(cellTextPos);
    expect(canChangeIndent(editor, 1)).toBe(false);
    expect(canChangeIndent(editor, -1)).toBe(false);
    const applied = changeIndent(editor, 1);
    editor.destroy();
    expect(applied).toBe(false);
  });

  it("ohne Editor-Instanz (editor=null) liefern beide Funktionen sicher false", () => {
    expect(changeIndent(null, 1)).toBe(false);
    expect(canChangeIndent(null, 1)).toBe(false);
  });
});

describe("Tab/Shift-Tab (IndentKeymap, priority:1001, v7.41) – echte Tastendrücke über view.someProp(\"handleKeyDown\")", () => {
  it("Tab auf einem normalen Absatz rückt ein (weder Tabelle noch Liste zuständig)", () => {
    const editor = buildEditor("# T\n\nAbsatz");
    editor.commands.setTextSelection(4);
    const handled = realKey(editor, "Tab");
    const out = saveLike(editor);
    editor.destroy();
    expect(handled).toBe(true);
    expect(out).toBe("# T\n\n  Absatz");
  });

  it("Shift-Tab verkleinert einen bereits eingerückten Absatz wieder", () => {
    const editor = buildEditor("# T\n\n  Absatz");
    editor.commands.setTextSelection(4);
    // WICHTIG: realKey()s zweiter Parameter ist der ECHTE
    // KeyboardEvent.key-Wert ("Tab"), NICHT der tiptap-interne
    // Bindungsname ("Shift-Tab") – die Umschalt-Taste kommt ausschließlich
    // über den dritten Parameter (shiftKey) rein, siehe Kopfkommentar bei
    // realKey/prosemirror-keymap#modifiers.
    const handled = realKey(editor, "Tab", true);
    const out = saveLike(editor);
    editor.destroy();
    expect(handled).toBe(true);
    expect(out).toBe("# T\n\nAbsatz");
  });

  it("Tab in einer einfachen Liste sinkt genau EINE Ebene (IndentKeymap, priority:1001, ist primärer Handler)", () => {
    const editor = buildEditor("# T\n\n- Eins\n- Zwei");
    let pos = null;
    editor.state.doc.descendants((node, p) => {
      if (node.isText && node.text === "Zwei") pos = p;
    });
    editor.commands.setTextSelection(pos);
    const handled = realKey(editor, "Tab");
    const out = saveLike(editor);
    editor.destroy();
    expect(handled).toBe(true);
    // GENAU eine Ebene tiefer, kein doppeltes Sinken (Beleg dafür, dass NUR
    // EIN Handler pro Tastendruck greift).
    expect(out).toBe("# T\n\n- Eins\n  - Zwei");
  });

  // Re-Review vor v7.41-Commit (🟡 Finding B): der bisherige Tabellen-Test
  // prüfte nur "Dokument bleibt unverändert" – das wäre AUCH grün geblieben,
  // wenn goToNextCell gar nicht mehr feuern würde. view.someProp(
  // "handleKeyDown", …) macht den reinen Selektionswechsel jetzt wirklich
  // beobachtbar: vorwärts, rückwärts, und die letzte Zelle legt eine neue an
  // (Tables eigene Tab-Bindung, siehe @tiptap/extension-table).
  describe("Tab/Shift-Tab in einer Tabelle bleibt Sache der Table-Extension (goToNextCell/addRowAfter)", () => {
    const TABLE_MD = "# T\n\n| a | b |\n| --- | --- |\n| 1 | 2 |";
    // Vergleich gegen einen FRISCHEN Roundtrip ohne Tab (statt gegen den
    // rohen TABLE_MD-String): eine Tabelle am Dokumentende bekommt beim
    // Speichern unabhängig von diesem Feature eine abschließende Zeile
    // (bestehende Eigenheit von MdTable/prosemirror-markdown, siehe
    // DECISIONS) – das hier zu prüfen wäre ein Test des
    // Bestandsverhaltens, nicht unseres.
    const TABLE_BASELINE = roundtrip(TABLE_MD);

    it("Tab in der ersten Zelle springt zur nächsten Zelle (Selektionswechsel, kein indent-Attribut)", () => {
      const editor = buildEditor(TABLE_MD);
      let posA = null, posB = null;
      editor.state.doc.descendants((n, p) => {
        if (n.isText && n.text === "a") posA = p;
        if (n.isText && n.text === "b") posB = p;
      });
      editor.commands.setTextSelection(posA);
      const handled = realKey(editor, "Tab");
      const sel = editor.state.selection;
      const out = saveLike(editor);
      editor.destroy();
      expect(handled).toBe(true);
      // Die Selektion springt in die Zelle "b" (deren Inhalt wird markiert,
      // Standardverhalten von goToNextCell) statt an derselben Stelle
      // stehen zu bleiben.
      expect(sel.from).toBe(posB);
      expect(sel.to).toBe(posB + 1);
      expect(out).toBe(TABLE_BASELINE); // Dokumentinhalt unverändert – reiner Selektionswechsel
    });

    it("Shift-Tab in der zweiten Zelle springt zur vorherigen Zelle zurück", () => {
      const editor = buildEditor(TABLE_MD);
      let posB = null;
      editor.state.doc.descendants((n, p) => { if (n.isText && n.text === "b") posB = p; });
      editor.commands.setTextSelection(posB);
      const handled = realKey(editor, "Tab", true);
      const afterFrom = editor.state.selection.from;
      editor.destroy();
      expect(handled).toBe(true);
      expect(afterFrom).toBeLessThan(posB); // zurück in Richtung der ersten Zelle gesprungen
    });

    it("Tab in der LETZTEN Zelle der Tabelle legt eine neue Zeile an (bestehendes Table-Verhalten, unverändert)", () => {
      const editor = buildEditor(TABLE_MD);
      let posLast = null;
      editor.state.doc.descendants((n, p) => { if (n.isText && n.text === "2") posLast = p; });
      editor.commands.setTextSelection(posLast);
      const handled = realKey(editor, "Tab");
      const out = saveLike(editor);
      editor.destroy();
      expect(handled).toBe(true);
      // Eine neue (leere) Zeile ist dazugekommen – mehr "|"-Datenzeilen als vorher.
      const dataRows = out.split("\n").filter((l) => /^\|.*\|$/.test(l) && !/^\|\s*-+/.test(l));
      expect(dataRows.length).toBe(3); // Kopfzeile + "1 | 2" + neue leere Zeile
    });
  });

  // Re-Review vor v7.41-Commit (🟡 Finding A): priority:1001 macht
  // IndentKeymap zwar zum PRIMÄREN Handler, aber wenn changeIndent() an der
  // Selektion nichts ändern kann (false), reichte die Kette den Tastendruck
  // bisher an TaskItem/ListItems EIGENE Tab/Shift-Tab-Bindungen weiter – die
  // arbeiten auf dem Listenpunkt, den IHR EIGENER Item-Typ zuerst im
  // Selektionsbereich findet, nicht zwingend auf dem, auf dem der Cursor
  // tatsächlich steht. Bei gemischter Verschachtelung (Checkliste mit
  // eingerückter Aufzählung als Kind oder umgekehrt) rückte Tab dadurch
  // einen ANDEREN (meist äußeren) Block ein als den Knopf-Zustand
  // (canChangeIndent) vermuten ließ. Fix: inTopLevelList() schluckt den
  // Tastendruck innerhalb einer Top-Level-Liste, sobald changeIndent()
  // nichts geändert hat – Knopf-Zustand und Tastatur stimmen jetzt überein.
  describe("gemischte Verschachtelung: Tab/Shift-Tab widersprechen dem Knopf-Zustand NICHT mehr (Finding A)", () => {
    function posOfText(editor, text) {
      let pos = null;
      editor.state.doc.descendants((node, p) => { if (node.isText && node.text === text) pos = p; });
      return pos;
    }

    it("Checkliste mit eingerückter Aufzählung als Kind: Tab auf dem innersten Punkt bleibt wirkungslos, wie der ausgegraute Knopf verspricht", () => {
      const md = "# T\n\n- [ ] A\n- [ ] B\n  - C";
      const editor = buildEditor(md);
      editor.commands.setTextSelection(posOfText(editor, "C"));
      const can = canChangeIndent(editor, 1);
      const handled = realKey(editor, "Tab");
      const out = saveLike(editor);
      editor.destroy();
      expect(can).toBe(false);
      expect(handled).toBe(true); // geschluckt, nicht an TaskItem durchgereicht
      expect(out).toBe(md); // Dokument unverändert – "B" wandert NICHT mehr
    });

    it("Aufzählung mit eingerückter Checkliste als Kind: derselbe Fall umgekehrt", () => {
      const md = "# T\n\n- A\n- B\n  - [ ] C";
      const editor = buildEditor(md);
      editor.commands.setTextSelection(posOfText(editor, "C"));
      const can = canChangeIndent(editor, 1);
      const handled = realKey(editor, "Tab");
      const out = saveLike(editor);
      editor.destroy();
      expect(can).toBe(false);
      expect(handled).toBe(true);
      expect(out).toBe(md);
    });

    it("mehrstufig gemischt: Tab auf dem tiefsten Punkt reißt nicht mehr einen Geschwister-Ast samt Kindern mit", () => {
      const md = "# T\n\n- [ ] A\n  - B eins\n  - B zwei\n    - [ ] C";
      const editor = buildEditor(md);
      editor.commands.setTextSelection(posOfText(editor, "C"));
      const can = canChangeIndent(editor, 1);
      const handled = realKey(editor, "Tab");
      const out = saveLike(editor);
      editor.destroy();
      expect(can).toBe(false);
      expect(handled).toBe(true);
      expect(out).toBe(md); // "B zwei" bleibt unverändert stehen (nicht gesunken)
    });

    it("Shift-Tab verhält sich in derselben Struktur symmetrisch (auch hier geschluckt statt falsch angewendet)", () => {
      const md = "# T\n\n- [ ] A\n- [ ] B\n  - C";
      const editor = buildEditor(md);
      editor.commands.setTextSelection(posOfText(editor, "C"));
      const can = canChangeIndent(editor, -1);
      const handled = realKey(editor, "Tab", true);
      const out = saveLike(editor);
      editor.destroy();
      // "C" selbst KANN hier heraufgehoben werden (liftListItem auf dem
      // innersten Punkt greift) – Knopf und Taste müssen deshalb auch hier
      // übereinstimmen, nicht zwingend beide "false" liefern.
      // Konkret gepinnt statt "irgendwas hat sich geändert" (🔵 Finding 1 des
      // Delta-Reviews): eine in beide Richtungen grüne Verzweigung würde ein
      // Kippen von "can" nicht bemerken.
      expect(can).toBe(true);
      expect(handled).toBe(true);
      expect(out).toBe("# T\n\n- [ ] A\n- [ ] B\n\n  C");
    });
  });
});

// Auftrag A2: "Prüfe per Probe, ob Aufzählungs-/Nummerierungs-Verschachtelung
// über sinkListItem/liftListItem bereits sauber durch den Markdown-Roundtrip
// kommt (Laden mit markdown-it, Serialisieren mit tiptap-markdown)."
// ERGEBNIS (siehe Bericht): JA, sauber – tiptap-markdown/prosemirror-schema-list
// erzeugen für bulletList/orderedList korrekt eingerückte "- "/"N."-Zeilen,
// beide Richtungen (sink UND lift) sind idempotent und roundtrip-stabil.
describe("Probe A2: Aufzählungs-/Nummerierungs-Verschachtelung roundtrip-stabil", () => {
  it("eine per sinkListItem verschachtelte Aufzählung lädt anschließend wieder als verschachteltes Dokument", () => {
    const editor = buildEditor("# T\n\n- Eins\n- Zwei");
    let pos = null;
    editor.state.doc.descendants((node, p) => {
      if (node.isText && node.text === "Zwei") pos = p;
    });
    editor.commands.setTextSelection(pos);
    changeIndent(editor, 1);
    const out = saveLike(editor);
    editor.destroy();
    expect(out).toBe("# T\n\n- Eins\n  - Zwei");
    // Erneut laden: bleibt stabil (kein Zerfall/keine Verschiebung).
    expect(roundtrip(out)).toBe(out);
  });

  it("eine verschachtelte Nummerierung bleibt roundtrip-stabil", () => {
    const md = "# T\n\n1. Eins\n   1. Unterpunkt\n2. Zwei";
    expect(roundtrip(md)).toBe(md);
  });

  it("gemischt: Aufzählung mit verschachtelter Nummerierung bleibt roundtrip-stabil", () => {
    const md = "# T\n\n- Eins\n  1. Erstens\n  2. Zweitens\n- Zwei";
    expect(roundtrip(md)).toBe(md);
  });
});

describe('collapseChecklistGaps (v7.41, beim Testschreiben gefundener ECHTER Bug)', () => {
  it("kollabiert eine Leerzeile zwischen zwei Checklisten-Zeilen (Bestandsverhalten, unverändert)", () => {
    const md = "- [ ] Eins\n\n- [ ] Zwei";
    expect(collapseChecklistGaps(md)).toBe("- [ ] Eins\n- [ ] Zwei");
  });

  it("NEU: kollabiert eine Leerzeile zwischen einer Checkliste und einer eingerückten PLAIN-Aufzählung darunter", () => {
    const md = "- [ ] Eltern\n\n  - Kind";
    expect(collapseChecklistGaps(md)).toBe("- [ ] Eltern\n  - Kind");
  });

  it("NEU: kollabiert eine Leerzeile zwischen einer Checkliste und einer eingerückten Nummerierung darunter", () => {
    const md = "- [ ] Eltern\n\n  1. Kind";
    expect(collapseChecklistGaps(md)).toBe("- [ ] Eltern\n  1. Kind");
  });

  it("lässt eine Leerzeile zwischen einer Checkliste und einem NORMALEN Absatz (kein Listenpunkt) unangetastet", () => {
    const md = "- [ ] Eltern\n\nGanz normaler Absatz, keine Liste.";
    expect(collapseChecklistGaps(md)).toBe(md);
  });

  it("ist idempotent (zweiter Durchlauf ändert nichts mehr)", () => {
    const md = "- [ ] Eins\n\n  - Kind\n\n- [ ] Zwei";
    const once = collapseChecklistGaps(md);
    expect(collapseChecklistGaps(once)).toBe(once);
  });

  it("funktioniert unabhängig von der Einrückungstiefe (mehrere Ebenen, [ \\t]* deckt Tabs UND Leerzeichen ab)", () => {
    const md = "  - [ ] Eltern (bereits eingerückt)\n\n    - Kind";
    expect(collapseChecklistGaps(md)).toBe("  - [ ] Eltern (bereits eingerückt)\n    - Kind");
  });

  // Code-Review vor v7.41-Commit, Finding 5c: bewusst dokumentiertes
  // Restrisiko (siehe DECISIONS #81) – die Lookahead-Bedingung prüft NICHT,
  // ob die folgende Liste tatsächlich EINGERÜCKT (also ein Kind) ist, oder
  // ob sie eine komplett EIGENSTÄNDIGE, gleich tief stehende Liste ist. Eine
  // Checkliste, gefolgt von einer Leerzeile und einer NICHT eingerückten,
  // fremden Aufzählung, wird deshalb GENAUSO kollabiert wie ein echtes
  // Eltern-Kind-Paar. Dieser Test PINNT das aktuelle (bewusst akzeptierte)
  // Verhalten, statt es zu verschleiern – exakt dieselbe Grammatik-Grenze
  // hatte die Regel schon VOR diesem Fix für zwei aufeinanderfolgende,
  // eigentlich unabhängige Checklisten.
  it("kollabiert eine Leerzeile auch vor einer NICHT eingerückten, eigenständigen Fremdliste (bekanntes, akzeptiertes Restrisiko)", () => {
    const md = "- [ ] Checkliste\n\n- Eigenständige Liste, kein Kind";
    expect(collapseChecklistGaps(md)).toBe("- [ ] Checkliste\n- Eigenständige Liste, kein Kind");
  });
});

// Code-Review vor v7.41-Commit, 🔴 Blocker 1: "Einzug verkleinern"/Shift-Tab
// leitete den sinkListItem/liftListItem-Item-Typ bisher aus dem TOP-LEVEL-
// Node ab (siehe runIndentChange, DocEditor.jsx) – bei einer Bullet-Liste
// INNERHALB eines taskItem ("- [ ] Eltern" mit eingerückten PLAIN-
// Unterpunkten) ist der Top-Level-Node "taskList", die Selektion steckt
// aber im "listItem" der inneren Bullet-Liste. liftListItem(taskItem) hob
// dadurch den GESAMTEN Checkbox-Elternpunkt aus der Liste (Text statt
// Checkbox, stiller Inhaltsverlust beim Speichern) statt nur den inneren
// Kindpunkt zu heben; canChangeIndent(+1) widersprach zugleich dem
// tatsächlichen Tab-Verhalten. Diese Tests reproduzieren GENAU das im
// Auftrag vorgegebene Szenario und pinnen den Fix.
describe("Regressionstest Blocker 1: Bullet-Liste INNERHALB einer Checkliste", () => {
  const MIXED_MD = "# T\n\n- [ ] Eltern\n  - Kind eins\n  - Kind zwei";

  function posOfText(editor, text) {
    let pos = null;
    editor.state.doc.descendants((node, p) => { if (node.isText && node.text === text) pos = p; });
    return pos;
  }

  it("changeIndent(-1) an 'Kind zwei' zerstört NICHT die Checkbox von 'Eltern'", () => {
    const editor = buildEditor(MIXED_MD);
    editor.commands.setTextSelection(posOfText(editor, "Kind zwei"));
    const applied = changeIndent(editor, -1);
    const out = saveLike(editor);
    editor.destroy();
    expect(applied).toBe(true);
    // "Eltern" bleibt eine ECHTE Checkliste ("- [ ]"), NICHT bloßer Fließtext.
    expect(out).toMatch(/^- \[ \] Eltern$/m);
    expect(out).toContain("Kind eins");
    expect(out).toContain("Kind zwei");
    // "Kind eins" bleibt weiterhin ein eingerückter Listenpunkt (nur "Kind
    // zwei" wurde aus der Bullet-Liste gehoben, nicht die ganze Liste).
    expect(out).toMatch(/^ {2}- Kind eins$/m);
  });

  it("canChangeIndent(+1) an 'Kind zwei' stimmt mit dem tatsächlichen Tab-Verhalten überein", () => {
    const editor = buildEditor(MIXED_MD);
    editor.commands.setTextSelection(posOfText(editor, "Kind zwei"));
    const can = canChangeIndent(editor, 1);
    const handled = editor.commands.keyboardShortcut("Tab");
    const out = saveLike(editor);
    editor.destroy();
    expect(can).toBe(true); // vor dem Fix: false, obwohl Tab tatsächlich sinkt
    expect(handled).toBe(true);
    // Tab sinkt "Kind zwei" unter "Kind eins" (eine Ebene tiefer als vorher).
    expect(out).toContain("- [ ] Eltern");
    expect(out).toMatch(/^ {2}- Kind eins$/m);
    expect(out).toMatch(/^ {4}- Kind zwei$/m);
  });

  it("keyboardShortcut('Shift-Tab') an 'Kind zwei' verhält sich identisch zu changeIndent(-1)", () => {
    const editor = buildEditor(MIXED_MD);
    editor.commands.setTextSelection(posOfText(editor, "Kind zwei"));
    editor.commands.keyboardShortcut("Shift-Tab");
    const out = saveLike(editor);
    editor.destroy();
    expect(out).toMatch(/^- \[ \] Eltern$/m); // Checkbox bleibt erhalten
  });

  // BUGFIX (Re-Review vor v7.41-Commit, 🔵 Finding G): Testname behauptete
  // bisher "canChangeIndent(-1) … ist false", der Rumpf rief canChangeIndent
  // nie auf und assertete "applied === true" – exakt das GEGENTEIL. Name
  // jetzt an den tatsächlich geprüften (korrekten) Sachverhalt angepasst.
  it("changeIndent(-1) an 'Kind eins' (erster Punkt der inneren Liste) hebt den Punkt trotzdem heraus, ohne die Checkbox von 'Eltern' anzutasten", () => {
    // "Kind eins" ist der ERSTE Punkt der inneren Bullet-Liste; ein Lift
    // von dort ist weiterhin möglich (liftOutOfList braucht keinen
    // Vorgänger) – dieser Test dokumentiert das GEGENTEIL von Blocker 1:
    // die Checkbox von "Eltern" bleibt auch hier unangetastet.
    const editor = buildEditor(MIXED_MD);
    editor.commands.setTextSelection(posOfText(editor, "Kind eins"));
    const applied = changeIndent(editor, -1);
    const out = saveLike(editor);
    editor.destroy();
    expect(applied).toBe(true);
    expect(out).toMatch(/^- \[ \] Eltern$/m);
  });

  // UPDATE (v7.41.1): Re-Review vor v7.41-Commit hatte dies als 🟡 Finding C
  // bewusst NICHT gefixt (siehe DECISIONS #81/docs/TESTFAELLE.md D15b/D17) –
  // ein Shift-Tab, das einen Unterpunkt aus einer Checkliste heraushebt,
  // erzeugte Markdown, dessen NÄCHSTER Lade-/Speicherzyklus (OHNE jede
  // weitere Änderung) EINMALIG eine zusätzliche Leerzeile vor der
  // Checkliste einfügte. Die für Blocker 2 nötige Erweiterung von
  // collapseChecklistGaps (siehe DocEditor.jsx: jetzt auch "normale Liste
  // GEFOLGT VON Checkliste", nicht mehr nur umgekehrt) behebt GENAU dieses
  // Muster ("- Eltern" gefolgt von der jetzt eingerückten Checkliste) als
  // Nebeneffekt vollständig – der Roundtrip ist jetzt AB DEM ERSTEN Zyklus
  // stabil, das ehemals akzeptierte Restrisiko entfällt.
  it("Shift-Tab aus einer Checkliste heraus bleibt jetzt AB DEM ERSTEN Zyklus roundtrip-stabil (Finding C behoben)", () => {
    const md = "- Eltern\n  - [ ] Kind eins\n  - [ ] Kind zwei";
    const editor = buildEditor(md);
    editor.commands.setTextSelection(posOfText(editor, "Kind zwei"));
    changeIndent(editor, -1);
    const afterShiftTab = saveLike(editor);
    editor.destroy();
    expect(afterShiftTab).toBe("- Eltern\n  - [ ] Kind eins\n\n  Kind zwei");

    // Zweiter (und jeder weitere) Zyklus ändert jetzt NICHTS mehr.
    const secondCycle = roundtrip(afterShiftTab);
    expect(secondCycle).toBe(afterShiftTab);
    expect(roundtrip(secondCycle)).toBe(secondCycle);
  });
});

// D16-Grenze (Code-Review vor v7.41-Commit, Finding 3): "canChangeIndent"
// verifiziert die im Auftrag beschriebenen, bewusst akzeptierten Grenzen der
// Mehrfachauswahl (siehe DECISIONS #81 und docs/TESTFAELLE.md D16) – fehlte
// bisher komplett als Unit-Test.
describe("Mehrfachauswahl-Grenzen (D16, bewusst akzeptiert)", () => {
  it("die GESAMTE Liste markiert (Auswahl beginnt im ERSTEN Punkt): Einzug vergrößern bleibt ein No-op", () => {
    const editor = buildEditor("# T\n\n- Eins\n- Zwei\n- Drei");
    editor.commands.selectAll();
    const can = canChangeIndent(editor, 1);
    const applied = changeIndent(editor, 1);
    const out = saveLike(editor);
    editor.destroy();
    expect(can).toBe(false);
    expect(applied).toBe(false);
    expect(out).toBe("# T\n\n- Eins\n- Zwei\n- Drei");
  });

  it("Auswahl von einem Absatz BIS IN den ersten Listenpunkt: NUR der Absatz rückt ein, die Liste bleibt unverändert", () => {
    const editor = buildEditor("# T\n\nAbsatz\n\n- Eins\n- Zwei");
    editor.commands.selectAll();
    const applied = changeIndent(editor, 1);
    const out = saveLike(editor);
    editor.destroy();
    expect(applied).toBe(true);
    expect(out).toBe("# T\n\n  Absatz\n\n- Eins\n- Zwei");
  });

  it("Auswahl ab dem ZWEITEN Listenpunkt bis zum Ende: beide markierten Punkte rücken ein, der erste bleibt unangetastet", () => {
    const editor = buildEditor("# T\n\n- Eins\n- Zwei\n- Drei");
    let fromPos = null;
    editor.state.doc.descendants((node, p) => { if (node.isText && node.text === "Zwei") fromPos = p; });
    editor.commands.setTextSelection({ from: fromPos, to: editor.state.doc.content.size - 1 });
    const applied = changeIndent(editor, 1);
    const out = saveLike(editor);
    editor.destroy();
    expect(applied).toBe(true);
    expect(out).toBe("# T\n\n- Eins\n  - Zwei\n  - Drei");
  });
});

// Finding 6 (Code-Review vor v7.41-Commit): ein eingerückter Display-Formel-
// Block ("  $$…$$") verlor seinen Einzug beim Editor-Roundtrip, weil
// matchDisplayBlock (math.jsx) die Zeile auf ihren TeX-Inhalt strippt, BEVOR
// der <math-block>-Tag gebaut wird. mathToPlaceholders schreibt "data-indent"
// jetzt direkt in den generierten Tag, MathBlock trägt ein "indent"-Attribut
// (analog BlockImage).
describe("MathBlock-Einzug (Finding 6)", () => {
  it("eine eingerückte Display-Formel bleibt beim Laden+Speichern eingerückt", () => {
    const md = "# T\n\n  $$a^2+b^2=c^2$$";
    expect(roundtrip(md)).toBe(md);
  });

  it("eine NICHT eingerückte Display-Formel bleibt weiterhin byte-identisch (keine Regression)", () => {
    const md = "# T\n\n$$a^2+b^2=c^2$$";
    expect(roundtrip(md)).toBe(md);
  });

  it("das ProseMirror-Dokument trägt das korrekte indent-Attribut auf dem mathBlock-Node", () => {
    const editor = buildEditor("# T\n\n    $$x^2$$"); // 4 Leerzeichen -> Ebene 2
    let indent = null;
    editor.state.doc.descendants((node) => { if (node.type.name === "mathBlock") indent = node.attrs.indent; });
    editor.destroy();
    expect(indent).toBe(2);
  });

  it("eine eingerückte Formel neben normalem Text bleibt beides korrekt (Formel UND Text roundtrip-stabil)", () => {
    const md = "# T\n\nVorher\n\n  $$E=mc^2$$\n\nNachher";
    expect(roundtrip(md)).toBe(md);
  });

  // Re-Review vor v7.41-Commit (🔵 Finding F): MathBlock trägt seit Finding 6
  // ein "indent"-Attribut – runIndentChange kannte "mathBlock" bisher nicht
  // als Ziel-Typ, canChangeIndent auf einer Formel war deshalb immer false
  // (eine z. B. per Chat/API bereits eingerückt angelegte Formel ließ sich
  // im Editor weder weiter einrücken noch zurücknehmen).
  it("changeIndent erhöht den Einzug einer Formel (Knopf/Tab funktionieren jetzt auch auf mathBlock)", () => {
    const editor = buildEditor("# T\n\n$$x^2$$");
    let pos = null;
    editor.state.doc.descendants((n, p) => { if (n.type.name === "mathBlock") pos = p; });
    editor.commands.setTextSelection(pos);
    const can = canChangeIndent(editor, 1);
    const applied = changeIndent(editor, 1);
    const out = saveLike(editor);
    editor.destroy();
    expect(can).toBe(true);
    expect(applied).toBe(true);
    expect(out).toBe("# T\n\n  $$x^2$$");
  });

  it("changeIndent(-1) nimmt den Einzug einer bereits eingerückten Formel (z. B. aus dem Chat) zurück", () => {
    const editor = buildEditor("# T\n\n  $$x^2$$");
    let pos = null;
    editor.state.doc.descendants((n, p) => { if (n.type.name === "mathBlock") pos = p; });
    editor.commands.setTextSelection(pos);
    const can = canChangeIndent(editor, -1);
    const applied = changeIndent(editor, -1);
    const out = saveLike(editor);
    editor.destroy();
    expect(can).toBe(true);
    expect(applied).toBe(true);
    expect(out).toBe("# T\n\n$$x^2$$");
  });

  it("eine Formel auf Ebene 6 lässt sich nicht weiter einrücken (dieselbe 0..6-Klemmung wie Absatz/Bild)", () => {
    const editor = buildEditor("# T\n\n" + "  ".repeat(6) + "$$x^2$$");
    let pos = null;
    editor.state.doc.descendants((n, p) => { if (n.type.name === "mathBlock") pos = p; });
    editor.commands.setTextSelection(pos);
    const can = canChangeIndent(editor, 1);
    const applied = changeIndent(editor, 1);
    editor.destroy();
    expect(can).toBe(false);
    expect(applied).toBe(false);
  });

  // Re-Review vor v7.41-Commit (🔵 Finding I): deckt die Tab-Regel auf
  // BEIDEN Seiten des bewussten indentLevel/indentLevelForMath-Duplikats ab
  // (lib/math.jsx – Zirkelbezug-Grund siehe Kopfkommentar dort) – ein Tab
  // im Quelltext vor einer Formel muss beim Laden wie 2 Leerzeichen wirken
  // UND beim Speichern wieder als echte 2 Leerzeichen herauskommen (die
  // App schreibt selbst nie Tabs).
  it("ein Tab im Quelltext vor einer Formel wird wie 2 Leerzeichen behandelt und beim Speichern als Leerzeichen geschrieben", () => {
    const out = roundtrip("# T\n\n\t$$x$$");
    expect(out).toBe("# T\n\n  $$x$$");
    expect(out).not.toContain("\t");
  });
});

// v7.41.1, 🔴 Blocker 1 aus dem E2E-Lauf von v7.41: "Bild wird bei
// Mehrfachauswahl NICHT mit eingerückt, nur die Bildunterschrift". Ursache
// (siehe Abschlussbericht/DECISIONS): NICHT runIndentChange selbst, sondern
// EINE EBENE VORHER – ProseMirror übersetzt eine ECHTE Browser-Mausselektion
// über TextSelection.between() (prosemirror-view#selectionBetween, GENAU der
// Weg, den JEDE Mausselektion im Editor nimmt). Landet ein Selektionsende
// exakt auf der Blockgrenze vor einem BLATT-Knoten ohne Inline-Inhalt (Bild/
// Formel), sucht ProseMirror automatisch die nächste gültige TEXT-Position
// und überspringt den Blatt-Knoten dabei STILLSCHWEIGEND (Selection.findFrom
// mit textOnly=true) – der Kernfall des Nutzers (Zeilenende VOR einem Bild
// anklicken, bis ans Ende der Bildunterschrift aufziehen) landet dadurch mit
// "from" bereits INNERHALB der Bildunterschrift.
//
// WICHTIG (Auftrag): Diese Tests bauen die reale Selektionsgeometrie über
// TextSelection.between() nach – NICHT über editor.commands.setTextSelection()
// (das intern TextSelection.create() nutzt und diesen Übersprung-Effekt gar
// nicht auslöst, siehe Recherche im Abschlussbericht). Genau diese Lücke
// ("bequeme", aber unrealistische Selektion) hatte die v7.41-Testabdeckung
// durchrutschen lassen.
describe("Regressionstest v7.41.1, Blocker 1: reale Maus-Selektionsgeometrie um ein Bild herum", () => {
  function posOfParagraph(editor, text) {
    let pos = null, size = null;
    editor.state.doc.descendants((node, p) => {
      if (node.type.name === "paragraph" && node.textContent === text) { pos = p; size = node.nodeSize; }
    });
    return { pos, size };
  }
  // Simuliert EXAKT das, was prosemirror-view beim Lesen einer echten
  // Mausselektion tut (selectionBetween -> TextSelection.between), inkl.
  // Dispatch auf den Editor – "editor.state.selection" spiegelt danach
  // GENAU das wider, was runIndentChange in echt zu sehen bekommt.
  function setRealSelection(editor, anchorPos, headPos) {
    const sel = TextSelection.between(editor.state.doc.resolve(anchorPos), editor.state.doc.resolve(headPos));
    editor.view.dispatch(editor.state.tr.setSelection(sel));
  }

  it("Klick am Zeilenende VOR dem Bild, Aufziehen bis ans Ende der Bildunterschrift: Bild UND Bildunterschrift werden eingerückt", () => {
    const md = "# T\n\nVorherige Zeile\n\n![Bild](img:xyz)\n\n*Unterschrift*";
    const editor = buildEditor(md);
    const { pos: paraPos, size: paraSize } = posOfParagraph(editor, "Vorherige Zeile");
    const clickPos = paraPos + paraSize; // exakte Blockgrenze, Bild-Startposition
    const endOfCaption = editor.state.doc.content.size - 1;
    setRealSelection(editor, clickPos, endOfCaption);
    const applied = changeIndent(editor, 1);
    const out = saveLike(editor);
    editor.destroy();
    expect(applied).toBe(true);
    // Bild UND Bildunterschrift eingerückt, "Vorherige Zeile" NICHT (das
    // bewusste D16-Verhalten: reines Aneinandergrenzen zählt nicht als
    // "berührt" – der Klick lag am ENDE dieser Zeile, nicht IN ihr).
    expect(out).toBe("# T\n\nVorherige Zeile\n\n  ![Bild](img:xyz)\n\n  *Unterschrift*");
  });

  it("derselbe Fall unter einer Checkliste mit mehreren verschachtelten Unterpunkten (der konkrete Nutzer-Fall)", () => {
    const md = [
      "- [ ] Problem auf DEV mit MD Code, zum Beispiel PM lid 1901423",
      "  - Fehler: Error (#DL1): Execution Timeout Expired im MDCore-Teil …",
      "  - md-filter „not optimized (bgmdcore)“; `BgMdcore` mit PartID:67 …",
      "  - ~10-Minuten-Lücke im Log (04:33:12 → 04:43:12) vor dem Timeout …",
      "  - Betroffenes Statement: Temp-Table-Drops `#CMP_DFY` / `#TIIDS` …",
      "",
      "![MDCore Execution Timeout auf DEV](img:mshbjmyp7sfzu)",
      "",
      "*Log des MDCore-Laufs (file version 26.08.05.1843, ChangeSet:4517) …*",
    ].join("\n");
    const editor = buildEditor(md);
    let lastLinePos = null, lastLineSize = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && /^Betroffenes/.test(node.textContent)) { lastLinePos = pos; lastLineSize = node.nodeSize; }
    });
    const clickPos = lastLinePos + lastLineSize; // Blockgrenze direkt vor dem Bild
    const endOfCaption = editor.state.doc.content.size - 1;
    setRealSelection(editor, clickPos, endOfCaption);
    const applied = changeIndent(editor, 1);
    const out = saveLike(editor);
    editor.destroy();
    expect(applied).toBe(true);
    expect(out).toBe(md.replace(
      "![MDCore Execution Timeout auf DEV](img:mshbjmyp7sfzu)\n\n*Log des MDCore-Laufs (file version 26.08.05.1843, ChangeSet:4517) …*",
      "  ![MDCore Execution Timeout auf DEV](img:mshbjmyp7sfzu)\n\n  *Log des MDCore-Laufs (file version 26.08.05.1843, ChangeSet:4517) …*"
    ));
    // Nebenbefund beim Testschreiben: VOR dem Fix wanderte "Betroffenes …"
    // zusätzlich eine Ebene tiefer in eine neue, verschachtelte Aufzählung
    // (derselbe fehlgeleitete "from" landete auch im Listen-Zweig von
    // runIndentChange) – bleibt jetzt unangetastet.
    expect(out).toMatch(/^ {2}- Betroffenes Statement/m);
  });

  it("Formel statt Bild: derselbe Übersprung-Effekt ist NICHT auf Bilder beschränkt", () => {
    const md = "# T\n\nVorherige Zeile\n\n$$x^2$$\n\n*Unterschrift*";
    const editor = buildEditor(md);
    const { pos: paraPos, size: paraSize } = posOfParagraph(editor, "Vorherige Zeile");
    const clickPos = paraPos + paraSize;
    const endOfCaption = editor.state.doc.content.size - 1;
    setRealSelection(editor, clickPos, endOfCaption);
    const applied = changeIndent(editor, 1);
    let mathIndent = null;
    editor.state.doc.descendants((n) => { if (n.type.name === "mathBlock") mathIndent = n.attrs.indent; });
    editor.destroy();
    expect(applied).toBe(true);
    expect(mathIndent).toBe(1);
  });

  it("symmetrischer Rückwärts-Fall: eine Selektion, die GENAU vor dem Bild endet (statt beginnt), schließt das Bild trotzdem ein", () => {
    // Bewusst umgekehrte Blockreihenfolge (Bildunterschrift ZUERST, Bild
    // DANACH) – deckt die "to"-Seite von extendPastSkippedLeaves ab
    // (Selection.findFrom sucht hier rückwärts zuerst, siehe Kommentar dort),
    // nicht nur die "from"-Seite des Kernfalls oben.
    const md = "# T\n\n*Caption*\n\n![Bild](img:xyz)\n\nNachfolgender Text";
    const editor = buildEditor(md);
    const { pos: capPos, size: capSize } = posOfParagraph(editor, "Caption");
    const anchorPos = capPos + 2; // irgendwo im Bildunterschrift-Text
    const headPos = capPos + capSize; // Blockgrenze direkt vor dem Bild
    setRealSelection(editor, anchorPos, headPos);
    const applied = changeIndent(editor, 1);
    const out = saveLike(editor);
    editor.destroy();
    expect(applied).toBe(true);
    expect(out).toBe("# T\n\n  *Caption*\n\n  ![Bild](img:xyz)\n\nNachfolgender Text");
  });
});

// v7.41.1, 🟡 Finding 3 aus dem E2E-Lauf von v7.41: "Einzug verkleinern" bei
// Ebene 0 ist für Absatz/Bild/Formel ausgegraut (siehe D15), für einen
// TOP-LEVEL-Listenpunkt aber bewusst NICHT – Klick/Umschalt+Tab heben ihn
// aus der Liste (liftListItem), exakt das Word-Verhalten, das der Nutzer
// erwartet. Siehe DECISIONS für die Begründung, warum das KEIN Bug ist.
describe("Finding 3 (v7.41.1): 'Einzug verkleinern' bei Ebene 0 – Absatz/Bild/Formel ausgegraut, Listenpunkt AKTIV", () => {
  it("ein TOP-LEVEL-Listenpunkt (Ebene 0) hat 'Einzug verkleinern' AKTIV und wird zu einem normalen Absatz", () => {
    const editor = buildEditor("# T\n\n- Eins\n- Zwei");
    editor.commands.setTextSelection(posOfHeadingOrText(editor, "Eins"));
    expect(canChangeIndent(editor, -1)).toBe(true);
    const applied = changeIndent(editor, -1);
    const out = saveLike(editor);
    editor.destroy();
    expect(applied).toBe(true);
    // Die Aufzählung ist weg, "Eins" ist jetzt ein normaler Absatz.
    expect(out).toBe("# T\n\nEins\n\n- Zwei");
  });

  it("ein Bild auf Ebene 0 hat 'Einzug verkleinern' ausgegraut (wie ein Absatz)", () => {
    const editor = buildEditor("# T\n\n![Bild](data:image/png;base64,AAA)");
    let pos = null;
    editor.state.doc.descendants((n, p) => { if (n.type.name === "image") pos = p; });
    editor.commands.setTextSelection(pos);
    expect(canChangeIndent(editor, -1)).toBe(false);
    const applied = changeIndent(editor, -1);
    editor.destroy();
    expect(applied).toBe(false);
  });

  it("eine Formel auf Ebene 0 hat 'Einzug verkleinern' ausgegraut (wie ein Absatz)", () => {
    const editor = buildEditor("# T\n\n$$x^2$$");
    let pos = null;
    editor.state.doc.descendants((n, p) => { if (n.type.name === "mathBlock") pos = p; });
    editor.commands.setTextSelection(pos);
    expect(canChangeIndent(editor, -1)).toBe(false);
    const applied = changeIndent(editor, -1);
    editor.destroy();
    expect(applied).toBe(false);
  });
});
function posOfHeadingOrText(editor, text) {
  let pos = null;
  editor.state.doc.descendants((node, p) => { if (node.isText && node.text === text) pos = p; });
  return pos;
}

// v7.41.1, 🔵 Finding 4 aus dem E2E-Lauf von v7.41: Die 0..6-Klemmung gilt
// NUR für das "indent"-Attribut (Absatz/Bild/Formel) – die STRUKTURELLE
// Listen-Verschachtelung (sinkListItem/liftListItem) hat bewusst KEINE
// Obergrenze. Siehe DECISIONS für die Begründung, D15 wurde entsprechend
// korrigiert ("6-Klicks-Grenze" bezog sich fälschlich auf Listen).
describe("Finding 4 (v7.41.1): keine Tiefenbegrenzung für strukturelle Listen-Verschachtelung", () => {
  it("ein Listenpunkt lässt sich weit über 6 Ebenen tief verschachteln, ohne dass der Knopf ausgraut", () => {
    // 10 Punkte nacheinander: jeder (außer dem ersten) sinkt unter seinen
    // Vorgänger – klassische "Treppen"-Verschachtelung, 9 Ebenen tief.
    const lines = Array.from({ length: 10 }, (_, i) => "- Punkt " + i);
    const editor = buildEditor("# T\n\n" + lines.join("\n"));
    for (let i = 1; i < 10; i++) {
      const pos = posOfHeadingOrText(editor, "Punkt " + i);
      editor.commands.setTextSelection(pos);
      for (let sinkTimes = 0; sinkTimes < i; sinkTimes++) {
        expect(canChangeIndent(editor, 1)).toBe(true); // NIE ausgegraut, auch tief verschachtelt
        expect(changeIndent(editor, 1)).toBe(true);
      }
    }
    const out = saveLike(editor);
    editor.destroy();
    // "Punkt 9" liegt jetzt 9 Ebenen tief (18 Leerzeichen).
    expect(out).toContain("                  - Punkt 9");
    // Roundtrip-stabil (die Tiefe an sich bricht nichts).
    expect(roundtrip(out)).toBe(out);
  });
});

// v7.41.1, 🔵 Finding 5 aus dem E2E-Lauf von v7.41: Tab in einer Überschrift
// war bisher ein "leises" No-op (runIndentChange liefert false, inTopLevelList
// greift nicht, der Browser-Standard übernimmt und der Tastaturfokus
// verlässt den Editor). Entscheidung (siehe DECISIONS): SCHLUCKEN, konsistent
// zum bereits etablierten Verhalten in Top-Level-Listen.
describe("Finding 5 (v7.41.1): Tab in einer Überschrift wird geschluckt (verlässt den Editor-Fokus nicht mehr)", () => {
  it("Tab in einer Überschrift bleibt inhaltlich ein No-op, wird aber von der Editor-Tastaturkette geschluckt", () => {
    const editor = buildEditor("# T\n\n## Abschnitt\n\nAbsatz");
    const pos = posOfHeadingOrText(editor, "Abschnitt");
    editor.commands.setTextSelection(pos);
    const handled = realKey(editor, "Tab");
    const out = saveLike(editor);
    editor.destroy();
    expect(handled).toBe(true); // geschluckt, NICHT an den Browser-Standard durchgereicht
    expect(out).toBe("# T\n\n## Abschnitt\n\nAbsatz"); // inhaltlich unverändert
  });

  it("Shift-Tab in einer Überschrift verhält sich symmetrisch", () => {
    const editor = buildEditor("# T\n\n## Abschnitt\n\nAbsatz");
    const pos = posOfHeadingOrText(editor, "Abschnitt");
    editor.commands.setTextSelection(pos);
    const handled = realKey(editor, "Tab", true);
    const out = saveLike(editor);
    editor.destroy();
    expect(handled).toBe(true);
    expect(out).toBe("# T\n\n## Abschnitt\n\nAbsatz");
  });
});

/* ======================================================================= */
/* v7.42 – Auftrag "Einzug im Editor sichtbar machen", Teil B: systematische */
/* Vermessung von Listen-Kontexten (Nutzer-Befund "es verhält sich komisch, */
/* wenn ich das in einem Block mache, der eine Checkbox oder Aufzählung     */
/* hat"). Die VOLLSTÄNDIGE Matrix (auch die unauffälligen Zeilen) steht im  */
/* Abschlussbericht/DECISIONS #86 – hier nur die Tests, die daraus folgen.  */
/* ======================================================================= */

// Finding B4 (ECHTER Bug, beim Vermessen für Teil B gefunden): Eine Formel
// bekommt ihr "indent"-Attribut NICHT über die core-Regel in IndentMarkdownIt
// (wie Absatz/Bild), sondern VORAB über mathToPlaceholders (lib/math.jsx) –
// eine reine Text-Vorverarbeitung, die lange vor jeder Block-Struktur-
// Erkennung läuft. Die "kein doppelter Einzug"-Tiefenprüfung (siehe
// IndentMarkdownIt oben) kannte diesen Sonderfall bisher nicht: Eine Formel
// als Fortsetzung UNTER einem Listenpunkt behielt ihr rohes indent-Attribut
// UNGEPRÜFT – nach dem v7.42-Sichtbarkeits-Fix (Teil A) hätte das einen
// SICHTBAREN, unerwünschten doppelten Einzug erzeugt (einmal durch die
// Listen-Verschachtelung selbst, einmal durch das jetzt gestylte
// "data-indent"). ROOT CAUSE (siehe DECISIONS #86 für Details): die
// Platzhalter-Zeile begann bisher IMMER bei Spalte 0 – die führende
// Einrückung der Quellzeile ging dadurch für markdown-its EIGENE
// Listen-Fortsetzungs-Erkennung komplett verloren, der Formel-Block fiel
// dadurch strukturell schon VOR jeder Tiefenprüfung aus der Liste heraus.
// Fix: mathToPlaceholders erhält die führende Einrückung der Quellzeile
// jetzt (wie Absatz/Bild), IndentMarkdownIt entfernt ein bereits gesetztes
// "data-indent" bei einer NUN korrekt erkannten Verschachtelung zusätzlich
// explizit aus dem rohen HTML-Tag-Text (siehe "Formel-Sonderfall" dort).
describe("v7.42 Finding B4 (ECHTER Bug): Formel als Fortsetzung unter einem Listenpunkt bekam einen DOPPELTEN Einzug", () => {
  it("eine Formel als zweiter Block IM SELBEN Listenpunkt bekommt jetzt indent:0 wie ein Absatz/Bild (kein doppelter Einzug)", () => {
    const md = "# T\n\n- Parent\n\n  $$x^2$$";
    const editor = buildEditor(md);
    let indent = "not-found";
    editor.state.doc.descendants((n) => { if (n.type.name === "mathBlock") indent = n.attrs.indent; });
    editor.destroy();
    expect(indent).toBe(0);
  });

  it("canChangeIndent auf der Formel verhält sich jetzt konsistent zu einem Absatz/Bild an derselben Stelle (sink scheitert, lift hebt den ganzen Listenpunkt)", () => {
    const md = "# T\n\n- Parent\n\n  $$x^2$$";
    const editor = buildEditor(md);
    let mathPos = null;
    editor.state.doc.descendants((n, p) => { if (n.type.name === "mathBlock") mathPos = p; });
    editor.commands.setTextSelection(mathPos);
    const canInc = canChangeIndent(editor, 1);
    const canDec = canChangeIndent(editor, -1);
    editor.destroy();
    expect(canInc).toBe(false);
    expect(canDec).toBe(true);
  });

  it("bleibt roundtrip-stabil (kein Sprung/keine zusätzliche Leerzeile durch den Fix)", () => {
    const md = "# T\n\n- Parent\n\n  $$x^2$$";
    expect(roundtrip(md)).toBe(md);
  });

  // WICHTIG (beim Testschreiben gefunden, PRE-EXISTING, NICHT Teil von
  // Finding B4): Anders als der Absatz-Fall (der TIGHT, also ohne Leerzeile,
  // per "lazy continuation" in DIESELBE Paragraph-Zeile wie "Parent"
  // verschmilzt – reines CommonMark-Verhalten) kann eine Formel (wie ein
  // Bild) NICHT in eine Fließtext-Zeile verschmelzen (beides sind eigene
  // BLOCK-Gruppen-Nodes). Ein Listenpunkt mit ZWEI separaten Block-Kindern
  // gilt für tiptap-markdown/prosemirror-markdown als "loose" – das fügt
  // beim ERSTEN Speichern NACH dem Laden einmalig eine Leerzeile ein
  // (GENAU dasselbe, bereits VOR diesem Auftrag bestehende Verhalten wie bei
  // einem TIGHT eingefügten Bild als zweitem Block, siehe Kommentar bei
  // "kein Datenverlust" unten – NICHT durch den B4-Fix verursacht, sondern
  // eine Eigenschaft des Serializers). Ab dem Ergebnis dieser einmaligen
  // Normalisierung ist der Roundtrip stabil.
  it("Regression: eine TIGHT (ohne Leerzeile) unter einem Listenpunkt stehende Formel bekommt ebenfalls indent:0 (Leerzeilen-Normalisierung ist ein VORBESTEHENDES, formel-unabhängiges Serializer-Verhalten, kein B4-Nebeneffekt)", () => {
    const md = "# T\n\n- Parent\n  $$x^2$$";
    const editor = buildEditor(md);
    let indent = "not-found";
    editor.state.doc.descendants((n) => { if (n.type.name === "mathBlock") indent = n.attrs.indent; });
    editor.destroy();
    expect(indent).toBe(0);
    const cycle0 = roundtrip(md);
    expect(cycle0).toBe("# T\n\n- Parent\n\n  $$x^2$$"); // einmalige Normalisierung
    expect(roundtrip(cycle0)).toBe(cycle0); // ab hier stabil, kein Weiterdriften
  });

  it("Regression: eine FREISTEHENDE (nicht in einer Liste steckende) Formel behält ihren eigenen Einzug unverändert (Finding 6, v7.41 – keine Nebenwirkung des B4-Fixes)", () => {
    const md = "# T\n\n  $$x^2$$";
    const editor = buildEditor(md);
    let indent = "not-found";
    editor.state.doc.descendants((n) => { if (n.type.name === "mathBlock") indent = n.attrs.indent; });
    editor.destroy();
    expect(indent).toBe(1);
    expect(roundtrip(md)).toBe(md);
  });

  // HINWEIS (beim Testschreiben geprüft, dann verworfen): Ein "$$…$$" MITTEN
  // in einer Tabellenzeile ("| $$x^2$$ |") startet NICHT am Zeilenanfang –
  // DISPLAY_MATH_START_RE (math.jsx) verlangt genau das für einen
  // Formel-BLOCK, eine Tabellenzelle kann also über diesen Weg gar keinen
  // mathBlock-Node erzeugen (bestätigt per Token-Dump: mathToPlaceholders
  // lässt die Zeile unangetastet). Der "table_open/table_close"-Zweig der
  // Tiefenprüfung ist damit für Formeln nicht erreichbar – ein eigener Test
  // dafür wäre ein Test eines nicht existierenden Falls und entfällt bewusst
  // (die bereits bestehende Tabellen-Absatz-Tiefenprüfung ist unverändert
  // durch "eine eingerückte Zeile INNERHALB einer Tabellenzelle bekommt kein
  // indent-Attribut" oben abgedeckt).
});

// Matrix-Teil "Cursor in einem Listenpunkt" (Auftrag Teil B, Punkt 1):
// Aufzählung/Checkliste/Nummerierung verhalten sich UNTEREINANDER identisch
// (unauffällige Zeilen, siehe Bericht) – erster Punkt einer Ebene kann nicht
// weiter sinken (canChangeIndent(+1)=false), aber IMMER heraushebbar
// (canChangeIndent(-1)=true, Finding 3 aus v7.41.1 gilt für ALLE drei
// Listentypen gleichermaßen); ein NICHT-erster Punkt kann beides.
describe("v7.42 Auftrag Teil B, Matrix 1: Knopf-Zustand für Aufzählung/Nummerierung/Checkliste, erster/nicht-erster Punkt, Ebene 0/tiefer", () => {
  it.each([
    { label: "Aufzählung, Ebene 0, erster Punkt", md: "# T\n\n- Eins\n- Zwei", text: "Eins", can1: false, can2: true },
    { label: "Aufzählung, Ebene 0, zweiter Punkt", md: "# T\n\n- Eins\n- Zwei", text: "Zwei", can1: true, can2: true },
    { label: "Aufzählung, Ebene 1 (verschachtelt, einziges Kind)", md: "# T\n\n- Eins\n  - Zwei", text: "Zwei", can1: false, can2: true },
    { label: "Nummerierung, Ebene 0, erster Punkt", md: "# T\n\n1. Eins\n2. Zwei", text: "Eins", can1: false, can2: true },
    { label: "Nummerierung, Ebene 0, zweiter Punkt", md: "# T\n\n1. Eins\n2. Zwei", text: "Zwei", can1: true, can2: true },
    { label: "Nummerierung, Ebene 1 (verschachtelt, einziges Kind)", md: "# T\n\n1. Eins\n   1. Zwei", text: "Zwei", can1: false, can2: true },
    { label: "Checkliste, Ebene 0, erster Punkt", md: "# T\n\n- [ ] Eins\n- [ ] Zwei", text: "Eins", can1: false, can2: true },
    { label: "Checkliste, Ebene 0, zweiter Punkt", md: "# T\n\n- [ ] Eins\n- [ ] Zwei", text: "Zwei", can1: true, can2: true },
    { label: "Checkliste, Ebene 1 (verschachtelt, einziges Kind)", md: "# T\n\n- [ ] Eins\n  - [ ] Zwei", text: "Zwei", can1: false, can2: true },
  ])("$label", ({ md, text, can1, can2 }) => {
    const editor = buildEditor(md);
    const pos = posOfHeadingOrText(editor, text);
    editor.commands.setTextSelection(pos);
    const r1 = canChangeIndent(editor, 1);
    const r2 = canChangeIndent(editor, -1);
    editor.destroy();
    expect(r1).toBe(can1);
    expect(r2).toBe(can2);
  });
});

// Matrix-Teil "Absatz/Bild/Formel als STRUKTURELLE Fortsetzung direkt
// UNTER einem Listenpunkt" (Auftrag Teil B, Punkt 2/3: "typischer
// Fortsetzungstext", "Bild und Bildunterschrift"). Alle drei Knotentypen
// verhalten sich HIER (Inhalt bleibt strukturell im selben Listenpunkt,
// 2-Leerzeichen-Einrückung entspricht GENAU der Content-Spalte von "- ")
// identisch und unauffällig: indent:0 (kein doppelter Einzug, siehe
// IndentMarkdownIt), canChangeIndent(+1)=false/( -1)=true (die "sink"-Regel
// betrifft den GESAMTEN Listenpunkt, nicht das einzelne Fortsetzungs-Element,
// siehe Kopfkommentar bei runIndentChange), und Laden+Speichern ist
// idempotent (keine Formatierungsänderung durch einen zweiten Zyklus).
describe("v7.42 Auftrag Teil B, Matrix 2: strukturelle Fortsetzung (Absatz/Bild/Formel) direkt unter einem Listenpunkt – unauffällig", () => {
  it.each([
    { label: "Absatz", md: "# T\n\n- Parent\n\n  Fortsetzung", nodeType: "paragraph", text: "Fortsetzung" },
    { label: "Formel", md: "# T\n\n- Parent\n\n  $$x^2$$", nodeType: "mathBlock", text: null },
  ])("$label: indent:0, canChangeIndent [false,true], idempotenter Roundtrip", ({ md, nodeType, text }) => {
    const editor = buildEditor(md);
    let indent = "not-found", pos = null;
    editor.state.doc.descendants((n, p) => {
      if (n.type.name === nodeType && (text === null || n.textContent === text)) { indent = n.attrs.indent; pos = p; }
    });
    editor.commands.setTextSelection(pos);
    const can1 = canChangeIndent(editor, 1);
    const can2 = canChangeIndent(editor, -1);
    const out = saveLike(editor);
    editor.destroy();
    expect(indent).toBe(0);
    expect(can1).toBe(false);
    expect(can2).toBe(true);
    expect(out).toBe(md);
    expect(roundtrip(out)).toBe(out); // idempotent
  });

  it("Bild + Bildunterschrift direkt unter einem Listenpunkt (der ursprüngliche Nutzerfall): beide bleiben strukturell im selben Listenpunkt, idempotent", () => {
    const md = "# T\n\n- Parent\n\n  ![Bild](img:xyz)\n\n  *Unterschrift*";
    const editor = buildEditor(md);
    let imageIndent = "not-found";
    editor.state.doc.descendants((n) => { if (n.type.name === "image") imageIndent = n.attrs.indent; });
    const out = saveLike(editor);
    editor.destroy();
    expect(imageIndent).toBe(0);
    expect(out).toBe(md);
    expect(roundtrip(out)).toBe(out);
  });

  it("dasselbe unter einem CHECKBOX-Elternpunkt (nicht nur Aufzählung) verhält sich identisch", () => {
    const md = "# T\n\n- [ ] Parent\n\n  Fortsetzung";
    const editor = buildEditor(md);
    let indent = "not-found";
    editor.state.doc.descendants((n) => { if (n.type.name === "paragraph" && n.textContent === "Fortsetzung") indent = n.attrs.indent; });
    const out = saveLike(editor);
    editor.destroy();
    expect(indent).toBe(0);
    expect(out).toBe(md);
  });
});

// Finding B1 – v7.42 hatte dies nur DOKUMENTIERT (siehe DECISIONS #86):
// Ein Absatz/Bild/eine Formel, der/die per Attribut auf Ebene 1 eingerückt
// wird (2 Leerzeichen) UND UNMITTELBAR (nur Leerzeile dazwischen) einer
// Liste mit 2-Zeichen-Marker folgt, erzeugte exakt denselben Rohtext wie
// eine STRUKTURELLE Fortsetzung desselben Listenpunkts (CommonMark "lazy
// continuation") – der Block wurde beim NÄCHSTEN Laden strukturell
// aufgenommen, wodurch Knopf-/Tab-Verhalten zwischen zwei Sitzungen
// unbemerkt wechselte ("komisch", Nutzer-Befund).
//
// v7.44 LÖST DAS AUF (DECISIONS #86 damit ÜBERHOLT, siehe neuer Eintrag):
// runIndentChange wählt in GENAU dieser Position SOFORT die strukturelle
// Variante (siehe chainList/trailingContinuationRun, DocEditor.jsx) –
// Knopf-Zustand und Tab-Wirkung sind dadurch bereits VOR dem ersten
// Speichern identisch zu dem, was nach einem Reload gilt. Die Tests unten
// ersetzen die alten "dokumentiert, aber unverändert lassen"-Belege durch
// den Nachweis, dass ein Reload jetzt NICHTS mehr ändert.
describe("v7.44 Finding B1 nachgebessert: Absatz/Bild/Formel DIREKT nach einer 2-Zeichen-Marker-Liste wird SOFORT strukturell aufgenommen", () => {
  it("changeIndent(+1) fügt den Absatz OHNE Reload strukturell in den Listenpunkt ein – kein Attribut, Knopf-Zustand sofort konsistent", () => {
    const md = "# T\n\n- Parent\n\nFortsetzung ohne Einrueckung";
    const editor = buildEditor(md);
    editor.commands.setTextSelection(posOfHeadingOrText(editor, "Fortsetzung ohne Einrueckung"));
    const applied = changeIndent(editor, 1);
    // SOFORT (ohne jeden Reload) prüfen – das war GENAU die Lücke aus
    // Finding B1: vorher stimmte dieser Zustand erst nach dem Speichern+
    // Neuladen.
    let indent = "not-found", parentType = null;
    editor.state.doc.descendants((n, p) => {
      if (n.type.name === "paragraph" && n.textContent === "Fortsetzung ohne Einrueckung") {
        indent = n.attrs.indent;
        parentType = editor.state.doc.resolve(p).node(editor.state.doc.resolve(p).depth).type.name;
      }
    });
    const canInc = canChangeIndent(editor, 1);
    const canDec = canChangeIndent(editor, -1);
    const out = saveLike(editor);
    editor.destroy();
    expect(applied).toBe(true);
    expect(indent).toBe(0); // KEIN Attribut mehr, sofort
    expect(parentType).toBe("listItem"); // sofort strukturell Teil von "Parent"
    expect(canInc).toBe(false); // konsistent mit Matrix 2 (strukturelle Fortsetzung)
    expect(canDec).toBe(true);
    // Rohtext ist (wie schon vor v7.44) textuell identisch zu einer ECHTEN
    // Listenpunkt-Fortsetzung – nur der WEG dorthin ist jetzt direkt.
    expect(out).toBe("# T\n\n- Parent\n\n  Fortsetzung ohne Einrueckung");

    // Reload ändert jetzt NICHTS mehr (das war der eigentliche Fix-Zweck):
    const editor2 = buildEditor(out);
    let indent2 = "not-found", parentType2 = null;
    editor2.state.doc.descendants((n, p) => {
      if (n.type.name === "paragraph" && n.textContent === "Fortsetzung ohne Einrueckung") {
        indent2 = n.attrs.indent;
        parentType2 = editor2.state.doc.resolve(p).node(editor2.state.doc.resolve(p).depth).type.name;
      }
    });
    const stableOut = saveLike(editor2);
    editor2.destroy();
    expect(indent2).toBe(indent);
    expect(parentType2).toBe(parentType);
    expect(stableOut).toBe(out);
  });

  it("Rückweg: Einzug verkleinern auf dem strukturell aufgenommenen Absatz löst NUR ihn heraus – 'Parent' bleibt ein Listenpunkt (nicht das ganze Item wird gehoben)", () => {
    // Startpunkt: bereits strukturell (wie nach obigem Test ODER wie ein von
    // Anfang an so verfasstes Dokument, siehe Matrix 2) – die Reparatur muss
    // für BEIDE Entstehungswege identisch funktionieren.
    const md = "# T\n\n- Parent\n\n  Fortsetzung";
    const editor = buildEditor(md);
    editor.commands.setTextSelection(posOfHeadingOrText(editor, "Fortsetzung"));
    expect(canChangeIndent(editor, -1)).toBe(true);
    const applied = changeIndent(editor, -1);
    const out = saveLike(editor);
    editor.destroy();
    expect(applied).toBe(true);
    // "Parent" bleibt Listenpunkt, "Fortsetzung" wird wieder ein GENUINER
    // Top-Level-Absatz direkt danach – NICHT (der alte Bug) "- Parent" samt
    // Fortsetzung komplett aus der Liste gehoben (was "Parent" zu einem
    // normalen Absatz OHNE Bullet gemacht hätte).
    expect(out).toBe("# T\n\n- Parent\n\nFortsetzung");

    const editor2 = buildEditor(out);
    let parentIsListItem = false, fortsetzungIsListItem = false;
    editor2.state.doc.descendants((n, p) => {
      const $p = editor2.state.doc.resolve(p);
      const parentType = $p.depth ? $p.node($p.depth).type.name : "doc";
      if (n.type.name === "paragraph" && n.textContent === "Parent") parentIsListItem = parentType === "listItem";
      if (n.type.name === "paragraph" && n.textContent === "Fortsetzung") fortsetzungIsListItem = parentType === "listItem";
    });
    editor2.destroy();
    expect(parentIsListItem).toBe(true); // "Parent" IST noch der Listenpunkt
    expect(fortsetzungIsListItem).toBe(false); // "Fortsetzung" ist TOP-LEVEL
  });

  it("derselbe Rückweg funktioniert unter einem CHECKBOX-Elternpunkt (der ursprüngliche Nutzerfall betraf u. a. Checklisten)", () => {
    const md = "# T\n\n- [ ] Parent\n\n  Fortsetzung";
    const editor = buildEditor(md);
    editor.commands.setTextSelection(posOfHeadingOrText(editor, "Fortsetzung"));
    const applied = changeIndent(editor, -1);
    const out = saveLike(editor);
    editor.destroy();
    expect(applied).toBe(true);
    expect(out).toBe("# T\n\n- [ ] Parent\n\nFortsetzung");
  });

  it("Bild + Bildunterschrift werden in EINEM Tab-Druck GEMEINSAM strukturell aufgenommen (Mehrfachauswahl, ein Undo-Schritt) – der ursprüngliche Nutzerfall", () => {
    const md = "# T\n\n- [ ] Parent\n\n![Bild](img:xyz)\n\n*Unterschrift*";
    const editor = buildEditor(md);
    let imgPos = null, capPos = null;
    editor.state.doc.descendants((n, p) => {
      if (n.type.name === "image") imgPos = p;
      if (n.type.name === "paragraph" && n.textContent === "Unterschrift") capPos = p + n.nodeSize - 1;
    });
    editor.commands.setTextSelection({ from: imgPos, to: capPos });
    const applied = changeIndent(editor, 1);
    let imageIndent = "not-found", imageParent = null, capParent = null;
    editor.state.doc.descendants((n, p) => {
      const $p = editor.state.doc.resolve(p);
      const parentType = $p.depth ? $p.node($p.depth).type.name : "doc";
      if (n.type.name === "image") { imageIndent = n.attrs.indent; imageParent = parentType; }
      if (n.type.name === "paragraph" && n.textContent === "Unterschrift") capParent = parentType;
    });
    const out = saveLike(editor);
    editor.destroy();
    expect(applied).toBe(true);
    expect(imageIndent).toBe(0);
    expect(imageParent).toBe("taskItem"); // BEIDE strukturell im selben Checklistenpunkt
    expect(capParent).toBe("taskItem");
    expect(out).toBe("# T\n\n- [ ] Parent\n\n  ![Bild](img:xyz)\n\n  *Unterschrift*");

    // Idempotent: erneutes Laden ändert nichts mehr.
    expect(roundtrip(out)).toBe(out);
  });

  it('"Einzug verkleinern" auf der Bildunterschrift löst NUR SIE heraus, das Bild bleibt strukturell im Checklistenpunkt', () => {
    // Regressions-Grenze (bewusst NICHT Teil der "gemeinsam"-Garantie oben):
    // trailingContinuationRun greift auf den SUFFIX der Selektion – steht
    // der Cursor NUR in der Unterschrift (kein Mehrfachauswahl übers Bild),
    // wird nur sie herausgelöst. Das Bild bliebe dann als LETZTES Kind
    // zurück und ist damit selbst wieder ein gültiges Ziel für einen
    // weiteren Shift-Tab-Druck (siehe nächster Test).
    const md = "# T\n\n- [ ] Parent\n\n  ![Bild](img:xyz)\n\n  *Unterschrift*";
    const editor = buildEditor(md);
    editor.commands.setTextSelection(posOfHeadingOrText(editor, "Unterschrift"));
    const applied = changeIndent(editor, -1);
    const out = saveLike(editor);
    editor.destroy();
    expect(applied).toBe(true);
    expect(out).toBe("# T\n\n- [ ] Parent\n\n  ![Bild](img:xyz)\n\n*Unterschrift*");
  });

  it("derselbe Effekt gilt NICHT für eine NUMMERIERTE Liste mit einstelligem Marker (Content-Spalte 3, 2 Leerzeichen reichen nicht zum Verschlucken) – changeIndent bleibt beim Attribut-Weg", () => {
    // Bewusst als Gegenbeispiel gepinnt: die Ambiguität aus Finding B1 ist
    // KEIN allgemeines Attribut-Einzug-Problem, sondern hängt exakt von der
    // Marker-Breite ab ("- "/"- [ ] " brauchen nur 2 Leerzeichen, "1. "
    // braucht mindestens 3) – siehe DECISIONS für die vollständige Matrix.
    // Die neue Sonderbehandlung darf HIER NICHT greifen (Auftrag).
    const md = "# T\n\n1. Eins\n\nFortsetzung ohne Einrueckung";
    const editor = buildEditor(md);
    editor.commands.setTextSelection(posOfHeadingOrText(editor, "Fortsetzung ohne Einrueckung"));
    const applied = changeIndent(editor, 1);
    let indent = "not-found", parentType = null;
    editor.state.doc.descendants((n, p) => {
      if (n.type.name === "paragraph" && n.textContent === "Fortsetzung ohne Einrueckung") {
        indent = n.attrs.indent;
        parentType = editor.state.doc.resolve(p).node(editor.state.doc.resolve(p).depth).type.name;
      }
    });
    const out = saveLike(editor);
    editor.destroy();
    expect(applied).toBe(true);
    expect(indent).toBe(1); // bleibt die eigene Attribut-Einrückung
    expect(parentType).toBe("doc"); // bleibt TOP-LEVEL, nicht Teil der Liste
    expect(out).toBe("# T\n\n1. Eins\n\n  Fortsetzung ohne Einrueckung");
  });

  it("die Rückwärts-Sonderbehandlung greift ebenfalls NICHT bei einer nummerierten Liste – eine dort STRUKTURELL geladene Fortsetzung wird weiterhin (wie vor v7.44) mit dem GANZEN Punkt gehoben", () => {
    // Auch das ist eine bewusste Grenze (Auftrag: "Prüfe die Marker-Breite
    // tatsächlich, statt sie zu raten" + "keine Inkonsistenz, die es vorher
    // nicht gab") – eine echte 3-Leerzeichen-Fortsetzung unter "1. " ist
    // KEIN Bestandteil dieses Bugs (siehe DECISIONS #86, Gegenbeispiel), die
    // Rückwärts-Sonderbehandlung bleibt deshalb konsequent auf bulletList/
    // taskList beschränkt.
    const md = "# T\n\n1. Eins\n\n   Fortsetzung3sp";
    const editor = buildEditor(md);
    editor.commands.setTextSelection(posOfHeadingOrText(editor, "Fortsetzung3sp"));
    const applied = changeIndent(editor, -1);
    const out = saveLike(editor);
    editor.destroy();
    expect(applied).toBe(true);
    // "Eins" verliert dabei (wie schon vor v7.44) seine Nummerierung -
    // GANZER Punkt gehoben, unverändertes Alt-Verhalten für Nummerierungen.
    expect(out).toBe("# T\n\nEins\n\nFortsetzung3sp");
  });

  // v7.47, docs/TESTFAELLE.md D23-Korrektur (E2E-Befund gegen v7.45.1): der
  // Tester konnte "Einzug vergrößern" ein ZWEITES Mal klicken, bevor der
  // Knopf ausgraut - D23 verlangte bis dahin "graut SOFORT nach dem ersten
  // Klick aus". Ursache GENAU eingegrenzt (Auftrag: "Prüfe am Code, ab
  // welcher Ebene der Knopf ausgraut" statt zu schätzen): Der ERSTE Klick
  // nimmt die Fortsetzung IMMER strukturell in den Listenpunkt auf (Finding
  // B1, oben). Ob danach schon ausgegraut ist, hängt an der generischen
  // sinkListItem-Prüfung für den ZWEITEN Klick: die braucht einen
  // VORANGEHENDEN Geschwister-Listenpunkt, unter den der GESAMTE Punkt
  // (samt frisch aufgenommener Fortsetzung) eine Ebene tiefer sinken kann -
  // keine feste Tiefenbegrenzung für strukturelle Listen-Verschachtelung
  // (siehe "Finding 4" oben). Ohne einen solchen vorangehenden Punkt (wie im
  // Test oben, "- Parent" ist der einzige Punkt seiner Liste) graut der
  // Knopf schon nach dem ersten Klick aus - MIT einem vorangehenden Punkt
  // (wie im gemeinsam genutzten QA-Test-Notizbuch nach vielen Testfällen der
  // Normalfall) bleibt er nach dem ersten Klick noch aktiv.
  it("mit einem VORANGEHENDEN Stichpunkt in derselben Liste bleibt der Knopf nach dem ersten Klick aktiv – erst der zweite Klick graut ihn aus", () => {
    const md = "# T\n\n- Vorheriger Punkt\n- QA-Einzug-Punkt\n\nQA-Einzug-Fortsetzung";
    const editor = buildEditor(md);
    editor.commands.setTextSelection(posOfHeadingOrText(editor, "QA-Einzug-Fortsetzung"));

    const applied1 = changeIndent(editor, 1); // 1. Klick: strukturelle Aufnahme, wie immer
    const afterClick1 = saveLike(editor);
    const canIncAfter1 = canChangeIndent(editor, 1); // NICHT ausgegraut (der eigentliche Fix-Nachweis)

    const applied2 = changeIndent(editor, 1); // 2. Klick: sinkt eine Ebene tiefer unter "Vorheriger Punkt"
    const afterClick2 = saveLike(editor);
    const canIncAfter2 = canChangeIndent(editor, 1); // JETZT ausgegraut

    editor.destroy();

    expect(applied1).toBe(true);
    expect(afterClick1).toBe("# T\n\n- Vorheriger Punkt\n- QA-Einzug-Punkt\n\n  QA-Einzug-Fortsetzung");
    expect(canIncAfter1).toBe(true);

    expect(applied2).toBe(true);
    expect(afterClick2).toBe("# T\n\n- Vorheriger Punkt\n  - QA-Einzug-Punkt\n\n    QA-Einzug-Fortsetzung");
    expect(canIncAfter2).toBe(false);

    // Reload: der KNOPF-ZUSTAND bleibt stabil (die eigentliche D23-Garantie)
    // – der Rohtext selbst normalisiert sich dabei EINMAL (eine zusätzliche
    // Leerzeile vor der jetzt verschachtelten Unterliste, weil "Vorheriger
    // Punkt" durch die aufgenommene Fortsetzung von "eng" auf "locker"
    // wechselt – dieselbe, bereits als unkritisch dokumentierte Eigenheit
    // wie bei Finding B2 oben) und ist AB DANN byte-identisch stabil.
    const editor2 = buildEditor(afterClick2);
    editor2.commands.setTextSelection(posOfHeadingOrText(editor2, "QA-Einzug-Fortsetzung"));
    const canIncReload = canChangeIndent(editor2, 1);
    const afterReload1 = saveLike(editor2);
    editor2.destroy();
    expect(canIncReload).toBe(false); // Knopf-Zustand UNVERÄNDERT über den Reload hinweg

    const editor3 = buildEditor(afterReload1);
    const afterReload2 = saveLike(editor3);
    editor3.destroy();
    expect(afterReload2).toBe(afterReload1); // ab dem zweiten Zyklus stabil
  });
});

// Finding B2 (einmalige, NICHT-destruktive Markdown-Reformatierung –
// dokumentiert statt behoben, siehe DECISIONS #86): Eine "Excel-Style"-
// Mehrfachauswahl über EINEN Listenpunkt (der dadurch sinkt) UND einen
// direkt folgenden Top-Level-Absatz (der dadurch seine eigene Attribut-
// Einrückung bekommt) erzeugt in EINEM Rutsch beides gleichzeitig. Der so
// entstandene Rohtext normalisiert sich beim NÄCHSTEN Laden+Speichern EINMAL
// (eine zusätzliche Leerzeile vor der neu verschachtelten Unterliste, weil
// der äußere Listenpunkt durch den jetzt angehängten Absatz "locker" statt
// "eng" wird) und ist AB DANN stabil – kein Inhaltsverlust, keine
// fortlaufende Verschlechterung.
//
// v7.44 UNVERÄNDERT (bewusst, siehe chainList/"touched" in runIndentChange):
// Die Liste ("Eins"/"Zwei") ist hier SELBST Teil derselben Selektion, die
// auch den Absatz berührt – die neue Struktur-Sofort-Übernahme aus Finding
// B1 greift deshalb ABSICHTLICH NICHT (chainList.touched === true bricht
// die Kette), der Absatz bekommt wie bisher das Attribut. Empirisch
// geprüft (siehe Kommentar bei "touched" in DocEditor.jsx): Für GENAU
// dieses Beispiel wäre das Endergebnis textuell sogar identisch, wenn die
// Kette hier NICHT bräche – die Grenze ist trotzdem bewusst gezogen, damit
// dieser bereits vermessene Mehrfachauswahl-Fall unverändert bleibt, statt
// stillschweigend einen zusätzlichen, hier nicht beauftragten Verhaltens-
// wechsel mitzunehmen. Dieser Test bleibt dadurch identisch zu v7.42.
describe("v7.42 Finding B2 (einmalige, nicht-destruktive Reformatierung): gemischte Mehrfachauswahl aus Listenpunkt-Sink + Absatz-Einzug", () => {
  it("stabilisiert sich nach GENAU einem zusätzlichen Zyklus (kein endloses Weiterdriften, kein Datenverlust)", () => {
    const md = "# T\n\n- Eins\n- Zwei\n\nAbsatz danach";
    const editor = buildEditor(md);
    editor.commands.setTextSelection({ from: posOfHeadingOrText(editor, "Zwei"), to: editor.state.doc.content.size - 1 });
    const applied = changeIndent(editor, 1);
    const cycle0 = saveLike(editor);
    editor.destroy();
    expect(applied).toBe(true);
    expect(cycle0).toBe("# T\n\n- Eins\n  - Zwei\n\n  Absatz danach");

    const cycle1 = roundtrip(cycle0);
    expect(cycle1).toBe("# T\n\n- Eins\n\n  - Zwei\n\n  Absatz danach"); // EINMALIGE Normalisierung
    expect(roundtrip(cycle1)).toBe(cycle1); // ab hier stabil
    expect(roundtrip(roundtrip(cycle1))).toBe(cycle1); // bleibt stabil (kein Weiterdriften)

    // Kein Inhalt verloren: alle drei Textfragmente stecken in JEDEM Zyklus.
    for (const text of [cycle0, cycle1]) {
      expect(text).toContain("Eins");
      expect(text).toContain("Zwei");
      expect(text).toContain("Absatz danach");
    }
  });
});
