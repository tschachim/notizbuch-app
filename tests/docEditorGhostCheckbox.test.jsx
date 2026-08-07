// @vitest-environment jsdom
//
// v7.41.2, Auftrag "Geister-Checkbox": ECHTER Bug, ÄLTER als v7.41 – trifft
// ganz gewöhnliche Notizbuch-Inhalte ("ein paar Stichpunkte, darunter eine
// Aufgabenliste"). Ursache (siehe DECISIONS für die vollständige
// Ursachenanalyse, vom Reviewer verifiziert und hier bestätigt): eine
// gewöhnliche Stichpunktliste, gefolgt (MIT ODER OHNE Leerzeile) von einer
// Checkliste MIT DEMSELBEN Marker ("-"), ist in CommonMark KEINE zwei
// getrennten Listen, sondern EINE einzige. markdown-it-task-lists setzt die
// Klasse "contains-task-list" auf das <ul>, sobald IRGENDEIN Kind-<li> eine
// Checkbox hat; ist das ERSTE <li> KEINE Checkbox, verlangt TaskLists
// starres Content-Schema ("taskItem+") trotzdem ab dem ERSTEN Kind einen
// taskItem – ProseMirrors HTML-Parser füllt die Schema-Lücke mit einem
// GESPENSTISCHEN LEEREN taskItem auf. Der Phantom-Punkt ist sichtbar,
// wird committet und vermehrt sich mit jedem weiteren Bearbeitungszyklus um
// ein weiteres.
//
// Verifiziert OHNE Fix rot (siehe Abschlussbericht): SplitMixedTaskLists
// testweise aus buildEditor() entfernt – jeder Test in der Gruppe
// "SplitMixedTaskLists behebt die Geister-Checkbox beim Laden" schlägt dann
// fehl (Phantom-Zähler > 0 bzw. Markdown enthält eine leere "- [ ]"-Zeile).
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
  unescapeMd, collapseChecklistGaps, dropEmptyCheckboxLines,
} from "../src/components/DocEditor.jsx";
import { mathToPlaceholders } from "../src/lib/math.jsx";

// Exakt die Verdrahtung aus DocEditor.jsx (useEditor()) – SplitMixedTaskLists
// VOR TaskList/TaskItem (siehe Kommentar an der Extension selbst).
// EmptyTaskMarkdownIt (v7.45) mit aufgenommen, damit diese Datei die REALE
// Verdrahtung nicht durch Drift stillschweigend verlässt (siehe Kommentar
// oben) – die eigentlichen Regressionstests für den v7.45-Fix leben separat
// in tests/docEditorEmptyCheckbox.test.jsx.
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

// Simuliert exakt den save()-Pfad in DocEditor.jsx.
function saveLike(editor) {
  return dropEmptyCheckboxLines(collapseChecklistGaps(unescapeMd(editor.storage.markdown.getMarkdown())));
}
function roundtrip(md) {
  const editor = buildEditor(md);
  const out = saveLike(editor);
  editor.destroy();
  return out;
}
// GENAU dieselbe Erkennung wie in tests/docEditorListToggle.test.jsx (dort
// beim Testschreiben für Blocker 2 etabliert): ein taskItem ohne jeden
// Inhalt ist der Phantom-Knoten, den die Parser-Lücke erzeugt.
function countPhantoms(editor) {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "taskItem" && node.textContent === "" && node.childCount <= 1) n++;
  });
  return n;
}

describe("SplitMixedTaskLists behebt die Geister-Checkbox beim Laden (v7.41.2)", () => {
  it("Stichpunktliste + Checkliste MIT Leerzeile dazwischen: kein Phantom, Struktur bleibt bulletList+taskList", () => {
    const editor = buildEditor("# T\n\n- Notiz\n\n- [ ] Aufgabe");
    const out = saveLike(editor);
    const phantoms = countPhantoms(editor);
    editor.destroy();
    expect(phantoms).toBe(0);
    expect(out).toBe("# T\n\n- Notiz\n- [ ] Aufgabe");
    expect(roundtrip(out)).toBe(out);
  });

  it("Stichpunktliste + Checkliste OHNE Leerzeile dazwischen: identisches Ergebnis (die Lücke betraf beide Fälle gleichermaßen)", () => {
    const editor = buildEditor("# T\n\n- Notiz\n- [ ] Aufgabe");
    const out = saveLike(editor);
    const phantoms = countPhantoms(editor);
    editor.destroy();
    expect(phantoms).toBe(0);
    expect(out).toBe("# T\n\n- Notiz\n- [ ] Aufgabe");
  });

  it("'*'-Marker statt '-' bleibt schon beim ERSTEN Laden sicher (unterschiedliche Marker bilden in CommonMark ohnehin zwei getrennte Listen)", () => {
    const editor = buildEditor("# T\n\n* Notiz\n\n- [ ] Aufgabe");
    const out = saveLike(editor);
    const phantoms = countPhantoms(editor);
    editor.destroy();
    expect(phantoms).toBe(0);
    // bulletListMarker ist global auf "-" konfiguriert -> der Marker wird
    // beim Speichern normalisiert.
    expect(out).toBe("# T\n\n- Notiz\n- [ ] Aufgabe");
  });

  it("'*'-Marker: der ZWEITE Zyklus (nach der Marker-Normalisierung auf '-') bleibt jetzt ebenfalls sicher (vorher der kritische Fall)", () => {
    const editor1 = buildEditor("# T\n\n* Notiz\n\n- [ ] Aufgabe");
    const afterFirstSave = saveLike(editor1);
    editor1.destroy();
    const editor2 = buildEditor(afterFirstSave);
    const out2 = saveLike(editor2);
    const phantoms = countPhantoms(editor2);
    editor2.destroy();
    expect(phantoms).toBe(0);
    expect(out2).toBe(afterFirstSave); // idempotent
  });

  it("mehrere Wechsel INNERHALB einer Liste (Punkt/Box/Punkt/Box) zerfallen korrekt in vier Geschwister-Listen", () => {
    const editor = buildEditor("# T\n\n- A\n- [ ] B\n- C\n- [ ] D");
    const out = saveLike(editor);
    const phantoms = countPhantoms(editor);
    editor.destroy();
    expect(phantoms).toBe(0);
    expect(out).toBe("# T\n\n- A\n- [ ] B\n- C\n- [ ] D");
    expect(roundtrip(out)).toBe(out);
  });

  it("verschachtelte gemischte Liste (Elternpunkt mit einer gemischten Unterliste als Kind)", () => {
    const editor = buildEditor("# T\n\n- Eltern\n  - Kind eins\n  - [ ] Kind zwei");
    const out = saveLike(editor);
    const phantoms = countPhantoms(editor);
    editor.destroy();
    expect(phantoms).toBe(0);
    expect(out).toBe("# T\n\n- Eltern\n  - Kind eins\n  - [ ] Kind zwei");
    expect(roundtrip(out)).toBe(out);
  });

  it("<ul> ohne Kinder (Randfall, kommt in der Praxis über markdown-it nie vor): kein Absturz für ein ansonsten leeres Dokument", () => {
    const editor = buildEditor("# T\n\nEinfacher Text, keine Liste");
    expect(() => saveLike(editor)).not.toThrow();
    editor.destroy();
  });

  it("'Checkliste zuerst' bleibt UNVERÄNDERT sicher (war laut Ursachenanalyse nie betroffen)", () => {
    const editor = buildEditor("# T\n\n- [ ] Aufgabe\n\n- Notiz");
    const out = saveLike(editor);
    const phantoms = countPhantoms(editor);
    editor.destroy();
    expect(phantoms).toBe(0);
    expect(out).toBe("# T\n\n- [ ] Aufgabe\n- Notiz");
    expect(roundtrip(out)).toBe(out);
  });

  it("mehrzyklischer Verlauf: vier Bearbeitungszyklen mit je einer Änderung an ANDERER Stelle erzeugen KEIN einziges leeres Kästchen", () => {
    // Exakt das im Auftrag beschriebene Repro-Muster.
    let cur = "## Abschnitt\n\nBemerkung: v0\n\n- Notiz eins\n- Notiz zwei\n\n- [ ] Aufgabe A\n- [ ] Aufgabe B";
    for (let cycle = 1; cycle <= 4; cycle++) {
      const editor = buildEditor(cur);
      // "Eine beliebige Änderung an ganz anderer Stelle": die Bemerkungs-
      // zeile wird angepasst, die Listen selbst bleiben unangetastet.
      let bemerkungPos = null;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text.startsWith("Bemerkung: v")) bemerkungPos = pos;
      });
      editor.commands.insertContentAt(
        { from: bemerkungPos, to: bemerkungPos + ("Bemerkung: v" + (cycle - 1)).length },
        "Bemerkung: v" + cycle
      );
      const out = saveLike(editor);
      const phantoms = countPhantoms(editor);
      editor.destroy();
      expect(phantoms).toBe(0); // JEDER Zyklus: keine Phantome
      expect(out).not.toMatch(/^\s*-\s*\[[ xX]?\]\s*$/m); // keine leere Checkbox-Zeile
      cur = out;
    }
    // Nach vier Zyklen: Notiz-/Aufgabenlisten unverändert, nur die
    // Bemerkung wurde hochgezählt.
    expect(cur).toContain("Bemerkung: v4");
    expect(cur).toContain("- Notiz eins");
    expect(cur).toContain("- Notiz zwei");
    expect(cur).toContain("- [ ] Aufgabe A");
    expect(cur).toContain("- [ ] Aufgabe B");
  });

  it("Escaping/Sonderzeichen im Notiz-/Aufgabentext überstehen die Aufteilung unverändert (reine Struktur-Operation, kein Text-Zugriff)", () => {
    const md = "# T\n\n- Notiz mit *kursiv* und `code`\n- [ ] Aufgabe mit <b>keinem</b> HTML-Tag";
    const editor = buildEditor(md);
    const out = saveLike(editor);
    const phantoms = countPhantoms(editor);
    editor.destroy();
    expect(phantoms).toBe(0);
    expect(out).toContain("*kursiv*");
    expect(out).toContain("`code`");
  });

  // Review-Bestätigung (v7.41.2): "geerbte Lockerheit"-Kompromiss (siehe
  // Kopfkommentar an SplitMixedTaskLists) explizit gepinnt, statt nur in der
  // Doku zu stehen.
  it("bewusster Kompromiss 'geerbte Lockerheit': eine Leerzeile INNERHALB der abgespaltenen Nicht-Task-Gruppe geht verloren", () => {
    const editor = buildEditor("# T\n\n- Eins\n\n- Zwei\n\n- [ ] Drei");
    const out = saveLike(editor);
    const phantoms = countPhantoms(editor);
    editor.destroy();
    expect(phantoms).toBe(0);
    // "Eins"/"Zwei" waren im Original durch eine Leerzeile getrennt – nach
    // der Aufteilung (siehe "geerbte Lockerheit" oben) rücken sie zusammen.
    expect(out).toBe("# T\n\n- Eins\n- Zwei\n- [ ] Drei");
    expect(roundtrip(out)).toBe(out); // stabil, kein weiterer Effekt in Folgezyklen
  });

  it("Gegenprobe: eine reine Stichpunktliste OHNE jede Checkliste bleibt von SplitMixedTaskLists gänzlich unberührt (keine 'contains-task-list'-Klasse, kein Eingriff)", () => {
    const editor = buildEditor("# T\n\n- Eins\n\n- Zwei");
    const out = saveLike(editor);
    editor.destroy();
    // Die absichtliche Leerzeile zwischen zwei reinen Stichpunkten bleibt
    // erhalten - SplitMixedTaskLists greift nur bei einem <ul>, das
    // tatsächlich mindestens einen Checklisten-Punkt enthält.
    expect(out).toBe("# T\n\n- Eins\n\n- Zwei");
  });
});

describe("dropEmptyCheckboxLines (v7.41.2, zusätzliches Sicherheitsnetz in save())", () => {
  it("entfernt eine völlig inhaltsleere Checkbox-Zeile ohne Folgeinhalt", () => {
    expect(dropEmptyCheckboxLines("- [ ]\n- Notiz")).toBe("- Notiz");
    expect(dropEmptyCheckboxLines("- [ ] \n- Notiz")).toBe("- Notiz");
  });

  it("entfernt eine leere Checkbox samt EINER direkt folgenden Leerzeile (keine doppelte Leerzeile als Relikt)", () => {
    expect(dropEmptyCheckboxLines("# T\n\n- [ ] \n\n- Notiz")).toBe("# T\n\n- Notiz");
  });

  it("entfernt MEHRERE aufeinanderfolgende Phantome (mehrzyklisch bereits akkumulierter Bestandsfall)", () => {
    const corrupted = "## Abschnitt\n\n- [ ]\n- [ ]\n- [ ]\n- [ ]\n- Notiz eins\n- Notiz zwei\n- [ ] Aufgabe A\n- [ ] Aufgabe B";
    expect(dropEmptyCheckboxLines(corrupted)).toBe(
      "## Abschnitt\n\n- Notiz eins\n- Notiz zwei\n- [ ] Aufgabe A\n- [ ] Aufgabe B"
    );
  });

  it("erkennt sowohl unmarkierte '- [ ]' als auch markierte '- [x]'/'- [X]' leere Zeilen", () => {
    expect(dropEmptyCheckboxLines("- [x]\n- Notiz")).toBe("- Notiz");
    expect(dropEmptyCheckboxLines("- [X]\n- Notiz")).toBe("- Notiz");
  });

  it("lässt eine leere Checkbox MIT eingerücktem Folgeinhalt unangetastet (absichtlicher, nur unbeschrifteter Elternpunkt)", () => {
    const md = "- [ ]\n  - Kind eins\n  - Kind zwei";
    expect(dropEmptyCheckboxLines(md)).toBe(md);
  });

  it("entfernt trotzdem eine leere Checkbox, deren NÄCHSTE Zeile eine GLEICH tiefe Geschwisterzeile ist (kein Kind)", () => {
    expect(dropEmptyCheckboxLines("- [ ]\n- Geschwister")).toBe("- Geschwister");
  });

  // v7.45.1 KORRIGIERT (Review-Finding 🟡, siehe DECISIONS #92): Diese
  // Erwartung stammte aus der Zeit VOR v7.45, in der eine leer angelegte
  // Checkbox ohnehin nie als solche überlebte – "Phantom" und "absichtlich
  // leerer, einziger Checklistenpunkt eines Abschnitts" waren textuell
  // identisch UND beide unerwünscht. Seit v7.45 ist Letzteres ausdrücklich
  // legitimer Nutzerinhalt (siehe EmptyTaskMarkdownIt) – ein KOMPLETT
  // ALLEINSTEHENDES "- [ ]" (kein Vorgänger, KEINE Folgezeile) ist deshalb
  // NICHT mehr automatisch ein Phantom (echte Bestands-Phantome haben immer
  // eine ECHTE Nicht-Checkbox-Listenzeile als Nachfolger, siehe "Ausnahme
  // 3" oben) und bleibt jetzt stehen. Exakt das vom Reviewer gemessene
  // Nebenbefund-Muster ("# T\n\n## A\n\n- [ ]" → "# T\n\n## A\n", nicht
  // idempotent) verschwindet dadurch ebenfalls ersatzlos.
  it("ein KOMPLETT ALLEINSTEHENDES '- [ ]' (kein Vorgänger, keine Folgezeile) ist KEIN Phantom mehr und bleibt stehen (v7.45.1)", () => {
    expect(dropEmptyCheckboxLines("- [ ]")).toBe("- [ ]");
    expect(dropEmptyCheckboxLines("# T\n\n## A\n\n- [ ]")).toBe("# T\n\n## A\n\n- [ ]");
    // Nebenbefund des Reviewers (nicht-idempotenter Fall) ist damit behoben.
    const once = dropEmptyCheckboxLines("# T\n\n## A\n\n- [ ]");
    expect(dropEmptyCheckboxLines(once)).toBe(once);
  });

  // Review-Finding v7.41.2 (🟡 1): Die Regel darf NUR den ersten Punkt eines
  // Listenblocks treffen – "Zeile anlegen und später ausfüllen" (z. B. Enter
  // am Ende eines Checklistenpunkts) ist ein Alltagsfall und darf NICHT
  // lautlos verschwinden. Beide Richtungen gepinnt: Phantom am Anfang wird
  // weiterhin entfernt, ein Nutzer-Platzhalter NACH echtem Inhalt (Mitte
  // UND Ende der Liste, auch ganz ohne abschließenden Zeilenumbruch) bleibt
  // erhalten.
  describe("Positionsbedingung: nur der ERSTE Punkt eines Listenblocks gilt als Phantom-Kandidat", () => {
    it("Nutzer-Platzhalter direkt NACH einem echten Punkt bleibt erhalten (exakt das gemessene Szenario: Enter nach 'Erste Aufgabe')", () => {
      const md = "# T\n\n- [ ] Erste Aufgabe\n- [ ] ";
      expect(dropEmptyCheckboxLines(md)).toBe(md);
    });

    it("Nutzer-Platzhalter am Dokumentende OHNE abschließenden Zeilenumbruch bleibt ebenfalls erhalten", () => {
      const md = "- Notiz\n- [ ]";
      expect(dropEmptyCheckboxLines(md)).toBe(md);
    });

    it("Nutzer-Platzhalter MITTEN in einer Liste (zwischen zwei echten Punkten) bleibt erhalten", () => {
      const md = "- [ ] A\n- [ ]\n- [ ] B";
      expect(dropEmptyCheckboxLines(md)).toBe(md);
    });

    it("ein Phantom AM ANFANG eines Listenblocks wird weiterhin entfernt, auch direkt nach einer Überschrift", () => {
      expect(dropEmptyCheckboxLines("## Abschnitt\n\n- [ ]\n- Notiz")).toBe("## Abschnitt\n\n- Notiz");
    });

    it("mehrere KASKADIERENDE Phantome am Anfang werden alle entfernt (der Vorgänger-Bezug läuft über die bereits bereinigte Ausgabe, nicht die rohen Zeilen)", () => {
      expect(dropEmptyCheckboxLines("- [ ]\n- [ ]\n- [ ]\n- Notiz")).toBe("- Notiz");
    });

    it("bewusst akzeptierte Grenze: ein verschachtelter ERSTER Kindpunkt (Phantom ODER absichtlich leerer Nutzer-Platzhalter – aus reinem Text nicht unterscheidbar) bleibt IMMER erhalten, um Inhaltsverlust zu vermeiden", () => {
      // Waere dies GENAU aus der beschriebenen Parser-Luecke entstanden,
      // bliebe das Phantom hier stehen (siehe Kopfkommentar) - SplitMixedTaskLists
      // verhindert NEUE Faelle dieser Art beim Laden bereits vollstaendig,
      // dieses Sicherheitsnetz ist nur fuer BESTANDSdokumente gedacht und
      // nimmt diese schmale Luecke bewusst in Kauf.
      const md = "- Eltern\n  - [ ] ";
      expect(dropEmptyCheckboxLines(md)).toBe(md);
    });
  });

  // v7.45.1 (Review-Finding 🟡, siehe DECISIONS #92): "Blockanfang" allein
  // reichte bisher als Phantom-Signal – seit v7.45 ist eine bewusst leer
  // gelassene Checkbox aber ausdrücklich legitimer Nutzerinhalt, AUCH als
  // erster Punkt ("Checklisten-Knopf drücken, ersten Punkt noch leer
  // lassen, speichern" – genau der vom Nutzer gemeldete Fall). Die Regel
  // verlangt jetzt zusätzlich die ECHTE Phantom-Signatur: eine folgende
  // NICHT-Checkbox-Listenzeile (siehe "Ausnahme 3" in DocEditor.jsx).
  describe("v7.45.1: ein leerer ERSTER Punkt einer ECHTEN, absichtlich leeren Checkliste bleibt erhalten", () => {
    it("ohne jeden Folgepunkt, ALS EINZIGER Punkt eines Abschnitts (Reviewer-Beispiel 2)", () => {
      const md = "# T\n\n## A\n\n- [ ]";
      expect(dropEmptyCheckboxLines(md)).toBe(md);
    });

    it("ohne jeden Folgepunkt, mitten im Dokument (danach folgt ein NEUER Abschnitt, keine Listenzeile)", () => {
      const md = "# T\n\n## A\n\n- [ ]\n\n## B\n\nText";
      expect(dropEmptyCheckboxLines(md)).toBe(md);
    });

    it("MIT Folgepunkten – gefolgt von einer WEITEREN echten Checkbox MIT Text (Reviewer-Beispiel 1)", () => {
      const md = "# T\n\n- [ ]\n- [ ] Zwei";
      expect(dropEmptyCheckboxLines(md)).toBe(md);
    });

    it("MIT mehreren echten Folge-Checkboxen", () => {
      const md = "- [ ]\n- [ ] A\n- [ ] B";
      expect(dropEmptyCheckboxLines(md)).toBe(md);
    });

    it("mehrere leere Punkte am Anfang, gefolgt von WEITEREN echten Checkboxen (KEIN Nicht-Checkbox-Folger) – bleiben alle erhalten", () => {
      const md = "- [ ]\n- [ ]\n- [ ] A";
      expect(dropEmptyCheckboxLines(md)).toBe(md);
    });

    it("verschachtelt: leerer erster Punkt einer eingerückten Unterliste MIT Folgepunkt bleibt erhalten", () => {
      const md = "# T\n\n## A\n\n  - [ ]\n  - [ ] Zwei";
      expect(dropEmptyCheckboxLines(md)).toBe(md);
    });

    it("verschachtelt: leerer erster Punkt einer eingerückten Unterliste als EINZIGER Punkt bleibt erhalten", () => {
      const md = "# T\n\n## A\n\n  - [ ]";
      expect(dropEmptyCheckboxLines(md)).toBe(md);
    });

    it("'- [x]'/'- [X]' (erledigt, leer) als erster Punkt bleiben ebenfalls erhalten, wenn kein Nicht-Checkbox-Folger kommt", () => {
      expect(dropEmptyCheckboxLines("- [x]\n- [ ] Zwei")).toBe("- [x]\n- [ ] Zwei");
      expect(dropEmptyCheckboxLines("- [X]")).toBe("- [X]");
    });

    it("Gegenprobe: ECHTE Bestands-Phantome (gefolgt von einer Nicht-Checkbox-Listenzeile) werden weiterhin entfernt – die Verengung heilt Altbestände unverändert", () => {
      expect(dropEmptyCheckboxLines("- [ ]\n- Notiz")).toBe("- Notiz");
      expect(dropEmptyCheckboxLines("- [ ]\n- [ ]\n- [ ]\n- Notiz")).toBe("- Notiz");
      expect(dropEmptyCheckboxLines("## Abschnitt\n\n- [ ]\n- Notiz")).toBe("## Abschnitt\n\n- Notiz");
    });

    it("ist idempotent für alle neu erhaltenen Fälle", () => {
      const cases = [
        "# T\n\n## A\n\n- [ ]",
        "# T\n\n- [ ]\n- [ ] Zwei",
        "- [ ]\n- [ ] A\n- [ ] B",
        "# T\n\n## A\n\n  - [ ]\n  - [ ] Zwei",
      ];
      for (const md of cases) {
        expect(dropEmptyCheckboxLines(md)).toBe(md);
        expect(dropEmptyCheckboxLines(dropEmptyCheckboxLines(md))).toBe(md);
      }
    });
  });

  // Review-Finding v7.41.2 (Begleitfund 1 zu 🟡 1): dropEmptyCheckboxLines
  // soll auch STANDALONE (ohne vorher gelaufenes collapseChecklistGaps)
  // korrekt sein, statt sich stillschweigend auf die Aufrufreihenfolge in
  // save() zu verlassen.
  it("orphant KEIN eingerücktes Kind mehr, wenn das Phantom per Leerzeile abgesetzt war (STANDALONE, ohne vorheriges collapseChecklistGaps)", () => {
    const md = "- [ ] \n\n  - Kind";
    expect(dropEmptyCheckboxLines(md)).toBe(md);
  });

  // Review-Finding v7.41.2 (Begleitfund 2 zu 🟡 1): eine per Leerzeile
  // abgesetzte ABSATZ-Fortsetzung (kein Listenpunkt) zählt genauso als
  // Folgeinhalt wie ein Kind-Listenpunkt.
  it("lässt eine per Leerzeile abgesetzte ABSATZ-Fortsetzung unangetastet (kein Listen-Kind, trotzdem kein Phantom)", () => {
    const md = "# T\n\n- [ ] \n\n  Fortsetzung als Absatz";
    expect(dropEmptyCheckboxLines(md)).toBe(md);
  });

  it("lässt eine Checkbox MIT echtem Label unangetastet", () => {
    const md = "- [ ] Echte Aufgabe\n- Notiz";
    expect(dropEmptyCheckboxLines(md)).toBe(md);
  });

  it("ist idempotent (zweiter Durchlauf ändert nichts mehr)", () => {
    const once = dropEmptyCheckboxLines("- [ ]\n- [ ]\n- Notiz");
    expect(dropEmptyCheckboxLines(once)).toBe(once);
  });

  it("funktioniert unabhängig von der Einrückungstiefe", () => {
    expect(dropEmptyCheckboxLines("  - [ ]\n  - Notiz")).toBe("  - Notiz");
  });

  it("Bestandsdokument mit bereits akkumuliertem Phantom heilt sich beim nächsten Editor-Speichern von selbst (Ende-zu-Ende über den echten save()-Pfad)", () => {
    // SplitMixedTaskLists verhindert nur NEUE Phantome – ein bereits
    // gespeichertes Phantom ist selbst ein taskItem (steht als ERSTES
    // Element seiner Liste, siehe Kopfkommentar an dropEmptyCheckboxLines
    // in DocEditor.jsx) und bleibt von SplitMixedTaskLists unangetastet.
    // dropEmptyCheckboxLines räumt es beim NÄCHSTEN Speichern auf.
    const already = "## Abschnitt\n\n- [ ] \n- Notiz eins\n- Notiz zwei\n- [ ] Aufgabe A\n- [ ] Aufgabe B";
    const editor = buildEditor(already);
    const out = saveLike(editor);
    editor.destroy();
    expect(out).toBe("## Abschnitt\n\n- Notiz eins\n- Notiz zwei\n- [ ] Aufgabe A\n- [ ] Aufgabe B");
    // Und bleibt ab jetzt für immer stabil.
    expect(roundtrip(out)).toBe(out);
  });
});
