// @vitest-environment jsdom
//
// v7.46, Fehler 2 ("Codeblock in einem Listenpunkt wächst bei jedem
// Speichern"). Ursache GENAU eingegrenzt (Auftrag: "Zusammenspiel
// Listen-Serializer + FencedCodeBlock-Serializer und/oder Fence-Erkennung
// beim Wiedereinlesen") – siehe ausführlicher Kopfkommentar bei
// FencedCodeBlock (DocEditor.jsx) und DECISIONS für die vollständige
// Herleitung. Kurzfassung: markdown-it rendert einen Zaun laut CommonMark
// IMMER als "<pre><code>Inhalt\n</code></pre>" – das eine "\n" direkt vor
// "</code>" ist ein STRUKTURELLES Artefakt (state.getLines mit
// keepLastLF:true, siehe markdown-it/lib/rules_block/fence.mjs) und steht
// dort IMMER, unabhängig von der Quelle. tiptap-markdowns EIGENE codeBlock-
// Node entfernt dieses eine "\n" über einen "updateDOM"-Hook – FencedCodeBlock
// (DocEditor.jsx) ERSETZT diese Node komplett, hatte aber "parse: {}" (kein
// Hook), der Extra-Zeilenumbruch landete dadurch IMMER in node.textContent.
// Am DOKUMENTANFANG (state.delim === "") verschluckt der Serializer das
// folgenlos – GENAU DESHALB war/ist tests/docEditorCode.test.jsx (keine
// Codeblöcke in Listen) immer schon grün. INNERHALB eines Listenpunkts
// (state.delim ist der Einzug-Präfix, z. B. "  ") schreibt der Serializer
// diesen Präfix jedoch vor JEDE Zeile inkl. der überzähligen leeren – aus
// EINER überzähligen Leerzeile wird dadurch eine SICHTBARE Leerzeile
// zwischen Code und Schluss-Zaun, die beim nächsten Laden selbst wieder als
// Code-Inhalt gilt und bei jedem weiteren Zyklus um eine weitere wächst.
//
// Verifiziert (Auftrag: "aktiv verifizieren, indem du den Fix kurz
// zurücknimmst"): Ohne den "parse.updateDOM"-Hook in FencedCodeBlock
// (DocEditor.jsx) ist der erste Test unten ("wächst NICHT...") rot (bereits
// nach dem ERSTEN Speichern eine zusätzliche Leerzeile, nach dem ZWEITEN
// zwei usw.) – mit NUR dem Lade-Fix, aber OHNE die begleitende Anpassung
// des Serializers (der bisherige "state.text(...)+state.ensureNewLine()"
// verschluckt eine ECHTE letzte Leerzeile im Code, weil state.text() nach
// der letzten – und sei sie leer – Zeile nie selbst einen Zeilenumbruch
// anhängt) wäre der Test "eine ECHTE Leerzeile vor dem Schluss-Zaun bleibt
// erhalten" unten rot; beide Test-Hälften zusammen decken deshalb beide
// Fix-Bestandteile ab.
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";
import {
  FencedCodeBlock, BlockImage, IndentParagraph, IndentMarkdownIt, IndentKeymap,
  SplitMixedTaskLists, EmptyTaskMarkdownIt,
  unescapeMd, collapseChecklistGaps, dropEmptyCheckboxLines, stripEmptyCheckboxTrailingSpace,
} from "../src/components/DocEditor.jsx";
import { mathToPlaceholders } from "../src/lib/math.jsx";

// Exakt dieselbe Verdrahtung wie tests/docEditorIndent.test.jsx#buildEditor
// (ohne die dort zusätzlichen Tabellen-/Formel-Extensions, für diese Datei
// nicht gebraucht).
function buildEditor(md) {
  return new Editor({
    extensions: [
      IndentKeymap,
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, blockquote: false, paragraph: false }),
      IndentParagraph,
      FencedCodeBlock,
      BlockImage,
      SplitMixedTaskLists,
      EmptyTaskMarkdownIt,
      TaskList,
      TaskItem.configure({ nested: true }),
      IndentMarkdownIt,
      Markdown.configure({ html: true, bulletListMarker: "-", tightLists: true }),
    ],
    content: mathToPlaceholders(md),
  });
}

// Exakt der reale save()-Pfad aus DocEditor.jsx (ohne unresolveImgs, hier
// nicht gebraucht): unescapeMd -> collapseChecklistGaps ->
// stripEmptyCheckboxTrailingSpace -> dropEmptyCheckboxLines.
function saveLike(editor) {
  return dropEmptyCheckboxLines(
    stripEmptyCheckboxTrailingSpace(collapseChecklistGaps(unescapeMd(editor.storage.markdown.getMarkdown())))
  );
}

function cycle(md) {
  const editor = buildEditor(md);
  const out = saveLike(editor);
  editor.destroy();
  return out;
}

describe("Editor-Roundtrip: Codeblock in einem Listenpunkt (v7.46)", () => {
  it("wächst NICHT bei mehrfachem Laden+Speichern (Kernbefund des Auftrags)", () => {
    const md = "- Eins\n\n  ```\n  code\n  ```";
    const out1 = cycle(md);
    const out2 = cycle(out1);
    const out3 = cycle(out2);
    expect(out1).toBe(md);
    expect(out2).toBe(md);
    expect(out3).toBe(md);
  });

  it("mehrzyklischer Nachweis: drei Zyklen mit je einer ECHTEN Änderung an anderer Stelle lassen den Codeblock-Inhalt unverändert", () => {
    let current = "- Eins\n\n  ```\n  code\n  ```";
    for (let i = 1; i <= 3; i++) {
      const editor = buildEditor(current);
      // Änderung "an anderer Stelle": ein neuer Absatz ans Dokumentende,
      // weit weg vom Codeblock im Listenpunkt.
      editor.commands.insertContentAt(editor.state.doc.content.size, {
        type: "paragraph",
        attrs: { indent: 0 },
        content: [{ type: "text", text: "Notiz " + i }],
      });
      current = saveLike(editor);
      editor.destroy();
      // Der Codeblock-Teil bleibt trotz der Fremd-Änderung exakt gleich.
      expect(current).toContain("- Eins\n\n  ```\n  code\n  ```");
    }
    expect(current).toBe("- Eins\n\n  ```\n  code\n  ```\n\nNotiz 1\n\nNotiz 2\n\nNotiz 3");
  });

  it("mit Sprach-Angabe bleibt stabil (kein Verlust/Wachstum durch das Sprach-Label)", () => {
    const md = "- Eins\n\n  ```js\n  const x = 1;\n  ```";
    expect(cycle(md)).toBe(md);
    expect(cycle(cycle(md))).toBe(md);
  });

  it("mit Backtick-Serien im Inhalt (K1-Zaun-Verlängerung) bleibt über mehrere Zyklen stabil", () => {
    // Der Inhalt selbst enthält eine ```-Zeile - der äußere Zaun muss auf 4
    // Backticks verlängert werden (siehe FencedCodeBlock-Serializer, K1-Fix).
    const md = "- Eins\n\n  ````\n  Beispiel:\n  ```\n  inner\n  ```\n  ````";
    const out1 = cycle(md);
    expect(out1).toBe(md);
    const out2 = cycle(out1);
    const out3 = cycle(out2);
    expect(out2).toBe(md);
    expect(out3).toBe(md);
  });

  it("unter einem Checklisten-Punkt (TaskItem) bleibt stabil", () => {
    const md = "- [ ] Eins\n\n  ```\n  code\n  ```";
    const out1 = cycle(md);
    const out2 = cycle(out1);
    const out3 = cycle(out2);
    expect(out1).toBe(md);
    expect(out2).toBe(md);
    expect(out3).toBe(md);
  });

  it("unter einem gewöhnlichen Aufzählungspunkt (explizit ohne Checkliste) bleibt stabil", () => {
    const md = "- Nur eine Aufzählung, keine Checkliste\n\n  ```text\n  plain\n  ```";
    const out1 = cycle(md);
    const out2 = cycle(out1);
    expect(out1).toBe(md);
    expect(out2).toBe(md);
  });

  it("auf einer VERSCHACHTELTEN Listenebene (Codeblock im Unterpunkt) bleibt stabil", () => {
    // Direkt über die ProseMirror-Doc-Struktur aufgebaut (JSON), statt die
    // exakte CommonMark-Einrückung für verschachtelte Listen von Hand zu
    // erraten - der erste save()-Aufruf liefert die vom EIGENEN Serializer
    // erzeugte, kanonische Roh-Markdown-Form; ab dann muss sie über weitere
    // Zyklen stabil bleiben (das ist der eigentliche Test).
    const editor = buildEditor("- Platzhalter");
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "bulletList",
          attrs: { tight: false },
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", attrs: { indent: 0 }, content: [{ type: "text", text: "Aussen" }] },
                {
                  type: "bulletList",
                  attrs: { tight: false },
                  content: [
                    {
                      type: "listItem",
                      content: [
                        { type: "paragraph", attrs: { indent: 0 }, content: [{ type: "text", text: "Innen" }] },
                        { type: "codeBlock", attrs: { language: null }, content: [{ type: "text", text: "code" }] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const out1 = saveLike(editor);
    editor.destroy();

    const out2 = cycle(out1);
    const out3 = cycle(out2);
    expect(out2).toBe(out1);
    expect(out3).toBe(out1);

    // Der Codeblock-Inhalt selbst bleibt über alle Zyklen exakt "code" -
    // keine angehängten Leerzeilen.
    const editor2 = buildEditor(out3);
    let text = null;
    editor2.state.doc.descendants((n) => { if (n.type.name === "codeBlock") text = n.textContent; });
    editor2.destroy();
    expect(text).toBe("code");
  });

  it("eine ECHTE Leerzeile vor dem Schluss-Zaun bleibt erhalten (kein Datenverlust durch den Fix)", () => {
    // Der Lade-Fix (updateDOM) allein würde diese Zeile korrekt als "code\n"
    // in node.textContent liefern - der SERIALIZER muss sie beim Speichern
    // aber auch wirklich wieder ausgeben (siehe Kopfkommentar, zweite
    // Fix-Hälfte). Idempotent ab dem ersten Zyklus (kein Wachstum mehr).
    const md = "- Eins\n\n  ```\n  code\n\n  ```";
    const out1 = cycle(md);
    const out2 = cycle(out1);
    const out3 = cycle(out2);
    expect(out1).toBe(out2);
    expect(out2).toBe(out3);
    // Der Codeblock enthält weiterhin "code" gefolgt von genau einer
    // Leerzeile, bevor der Zaun schließt - nicht mehr, nicht weniger.
    const editor = buildEditor(out3);
    let text = null;
    editor.state.doc.descendants((n) => { if (n.type.name === "codeBlock") text = n.textContent; });
    editor.destroy();
    expect(text).toBe("code\n");
  });

  it("eine Leerzeile IM Codeblock ist wirklich leer, nicht eine Zeile aus Listen-Einzug (Review-Nachbesserung zu v7.46)", () => {
    // Der erste Entwurf des Serializers schrieb state.write() vor JEDER
    // Zeile - damit landete der Listen-Einzug ("  ") auch vor leeren
    // Zeilen, also eine Zeile aus reinem Whitespace im committeten
    // Markdown. prosemirror-markdown selbst trimmt das Delimiter fuer
    // Leerzeilen (flushClose/delimMin), gewoehnliche
    // Fortsetzungs-Leerzeilen in einer Liste sind deshalb WIRKLICH leer -
    // hier muss dasselbe gelten, sonst gibt es Diff-Rauschen und beim
    // naechsten Speichern erneut eine Aenderung, sobald ein Editor
    // trailing whitespace strippt.
    const md = "- Eins\n\n  ```\n  a\n\n  b\n  ```";
    const out = cycle(md);
    const zeilen = out.split("\n");
    const leere = zeilen.filter((l) => l.trim() === "");
    expect(leere.length).toBeGreaterThan(0);
    for (const l of leere) expect(l).toBe(""); // kein "  " o. ae.
    // Inhalt trotzdem vollstaendig und stabil
    expect(cycle(out)).toBe(out);
    const editor = buildEditor(out);
    let text = null;
    editor.state.doc.descendants((n) => { if (n.type.name === "codeBlock") text = n.textContent; });
    editor.destroy();
    expect(text).toBe("a\n\nb");
  });

  it("top-level (nicht in einer Liste) mit echter Leerzeile bleibt weiterhin byte-identisch (Nicht-Regression)", () => {
    const md = "# T\n\n```js\ncode\n\n```";
    const out1 = cycle(md);
    const out2 = cycle(out1);
    expect(out1).toBe(md);
    expect(out2).toBe(md);
  });
});

// v7.48-Auftrag, Fehler 2 ("Codeblock lässt sich nicht in einem
// Listenpunkt anlegen"): GENAU eingegrenzt, WARUM der Toolbar-Knopf
// „Codeblock“ (toggleCodeBlock) den Codeblock aus der Liste heraushebt,
// statt ihn verschachtelt einzufügen. @tiptap/extension-list-item nutzt
// standardmäßig "content: 'paragraph block*'" – der ERSTE Kindknoten eines
// Listenpunkts MUSS exakt vom Typ "paragraph" sein (nicht nur irgendein
// "block"). toggleCodeBlock (genauer: @tiptap/core#setNode) versucht
// zuerst "setBlockType" (ersetzt GENAU den textblock mit dem Cursor durch
// einen Codeblock, IN PLACE, an derselben Position) – das verletzt bei
// einem Listenpunkt mit NUR einem Absatz das Content-Modell (Position 0
// verlangt "paragraph", niemals "codeBlock"), "setBlockType" schlägt fehl.
// setNode() fällt dann auf "commands.clearNodes()" zurück – das entfernt
// ALLE umschließenden Listen-/Absatz-Wrapper (glättet die komplette
// Struktur zu einer flachen Absatzfolge), BEVOR "setBlockType" erneut
// versucht wird (diesmal erfolgreich, weil kein ListItem mehr im Weg
// steht). Ergebnis: der Codeblock landet als Geschwister NEBEN der Liste,
// nicht mehr darin.
//
// Bewusste Entscheidung (siehe DECISIONS): NICHT die Editor-Schema-Grenze
// aufweichen (z. B. eine eigene ListItem-Erweiterung mit
// "content: 'block+'") – das ist ein tief in ProseMirrors Listen-Kernel
// verankertes Verhalten mit hohem Blast-Radius (sinkListItem/liftListItem,
// Tab/Shift-Tab-Einrückung, "kein doppelter Einzug"-Logik,
// convertListItemTypeCommand – siehe die zahlreichen bestehenden
// List-Spezialfälle in DocEditor.jsx – bauen alle stillschweigend auf
// "erstes Kind ist ein Absatz"). Stattdessen: die reale, funktionierende
// Erzeugung eines Codeblocks INNERHALB eines Listenpunkts bleibt der
// Lade-Pfad (Chat/KI-Ops oder von Hand vorbereitetes Markdown, siehe
// D6b in TESTFAELLE.md und die restlichen Tests dieser Datei) – GENAU
// DAFÜR ist der v7.46-Fix oben gedacht und bleibt unverändert gültig.
//
// Dieser Test PINNT die aktuell bekannte Editor-Grenze bewusst (kein
// Pro-forma-Test: schlägt fehl, sobald sich das zugrunde liegende
// TipTap/ProseMirror-Verhalten oder das Content-Modell ändert – dann muss
// diese Analyse UND die D6b-Beschreibung in TESTFAELLE.md neu geprüft
// werden), damit die Doku nicht unbemerkt von der Realität abweicht.
describe("Editor-Grenze (v7.48, Fehler 2): Toolbar-Knopf 'Codeblock' auf dem ERSTEN Absatz eines Listenpunkts hebt ihn aus der Liste heraus", () => {
  function buildListEditor(md) {
    return new Editor({
      extensions: [
        IndentKeymap,
        StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, blockquote: false, paragraph: false }),
        IndentParagraph,
        FencedCodeBlock,
        IndentMarkdownIt,
        Markdown.configure({ html: true, bulletListMarker: "-", tightLists: true }),
      ],
      content: md,
    });
  }

  it("toggleCodeBlock auf dem einzigen Absatz eines Listenpunkts entfernt die Listen-Verschachtelung (dokumentierte Grenze, kein neuer Bug)", () => {
    const editor = buildListEditor("- QA-Punkt");
    // Cursor ans Dokumentende (= Ende von "QA-Punkt", der einzige Inhalt).
    editor.commands.focus("end");
    editor.chain().focus().toggleCodeBlock().run();

    let hasBulletList = false;
    let codeBlockIsTopLevel = false;
    editor.state.doc.forEach((node) => {
      if (node.type.name === "bulletList") hasBulletList = true;
      if (node.type.name === "codeBlock") codeBlockIsTopLevel = true;
    });
    editor.destroy();

    // Die Liste ist komplett verschwunden (clearNodes glättet die Struktur),
    // der Codeblock steht jetzt auf oberster Ebene, NICHT mehr verschachtelt.
    expect(hasBulletList).toBe(false);
    expect(codeBlockIsTopLevel).toBe(true);
  });

  it("zur Kontrolle: ein zweiter Absatz IM SELBEN Listenpunkt (nicht die erste Position) lässt sich sehr wohl in einen Codeblock verwandeln, OHNE die Liste zu verlassen", () => {
    // Bestätigt die Diagnose oben: "paragraph block*" verlangt NUR beim
    // ERSTEN Kind exakt "paragraph" - ein bereits vorhandener ZWEITER
    // Absatz desselben Listenpunkts darf sehr wohl zu "block" (u. a.
    // codeBlock) werden. Kein über die Toolbar normal erreichbarer Weg (siehe
    // Auftrag), aber wichtig für die Diagnose: das Problem ist WIRKLICH nur
    // die erste Position, nicht "Codeblock in Liste" generell.
    // Über ProseMirror-JSON aufgebaut (statt insertContentAt am
    // Dokumentende - das würde NICHT in den Listenpunkt einfügen, sondern
    // eine neue TOP-LEVEL-Zeile NACH der ganzen Liste erzeugen, siehe
    // "auf einer VERSCHACHTELTEN Listenebene"-Test oben für dasselbe Muster):
    // ZWEI Absätze als Kinder DESSELBEN Listenpunkts von Anfang an.
    const editor = buildListEditor("- Platzhalter");
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "bulletList",
          attrs: { tight: false },
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", attrs: { indent: 0 }, content: [{ type: "text", text: "QA-Punkt" }] },
                { type: "paragraph", attrs: { indent: 0 }, content: [{ type: "text", text: "Zweite Zeile" }] },
              ],
            },
          ],
        },
      ],
    });
    editor.commands.focus("end");
    editor.chain().focus().toggleCodeBlock().run();

    let hasBulletList = false;
    let codeBlockIsTopLevel = false;
    editor.state.doc.forEach((node) => {
      if (node.type.name === "bulletList") hasBulletList = true;
      if (node.type.name === "codeBlock") codeBlockIsTopLevel = true;
    });
    editor.destroy();
    expect(hasBulletList).toBe(true);
    expect(codeBlockIsTopLevel).toBe(false);
  });
});
