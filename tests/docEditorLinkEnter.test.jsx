// @vitest-environment jsdom
//
// Regressionstest zu DECISIONS.md #116. Anlass: Der Tester meldete nach
// v7.56 (E2E, 2026-09-24) zweimal, dass Enter am Ende eines Links, der den
// GESAMTEN letzten Absatz des Dokuments bildet, den Link-Absatz LEERT statt
// nur einen neuen leeren Absatz anzuhängen (Linktext ginge dabei verloren).
// Die Untersuchung (siehe DECISIONS #116) konnte das über drei unabhängige
// Enter-Auslöser (WAYS unten – Modell-Kommandos UND ein echtes
// KeyboardEvent("keydown") am contenteditable, derselbe interne Pfad wie
// ein realer Tastendruck) und neun Datenlagen (SCENARIOS unten: Provider-
// Match vs. keiner, letzter Block vs. gefolgt von einem weiteren Absatz,
// Cursor am Ende vs. mitten im Linktext, verschiedene Link-Konstruktionen)
// in jsdom NICHT reproduzieren – der Linktext bleibt in JEDER Kombination
// vollständig erhalten, genau ein neuer leerer Absatz entsteht. Diese Datei
// hält dieses erwartete Verhalten als Regressionsschutz fest.
//
// GRENZE VON JSDOM (ehrlich benannt, nicht auflösbar ohne echten Browser):
// jsdom hat keine funktionierende native Selection/Range-Implementierung
// für contenteditable (kein Layout, keine „caret affinity“ an einer Mark-
// Grenze) und keine native contenteditable-Bearbeitung (kein beforeinput-/
// input-Default-Verhalten, keine native Selection) – ein synthetisches
// KeyboardEvent durchläuft in jsdom denselben internen ProseMirror-Pfad
// wie ein echter Tastendruck (siehe WAYS unten), aber eben OHNE die
// native DOM-Mutation, die ein echter Browser parallel dazu vornehmen
// würde. Pfade, in denen ProseMirror eine bereits erfolgte native
// DOM-Mutation erst NACHTRÄGLICH deutet (Android Chrome, iOS), sind
// dadurch strukturell nicht abgedeckt. Dieser Test belegt deshalb NUR,
// dass die ProseMirror-/Tiptap-Modell-Ebene (Enter-Handling, autolink-
// appendTransaction-Plugin) den Linktext in keiner geprüften Lage entfernt
// – ein rein browser-natives Fehlverhalten am Dokumentende kann er
// strukturell nicht ausschließen.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state"; // wie in DocEditor.jsx
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Markdown } from "tiptap-markdown";
import { FencedCodeBlock, LinkDecorations, FileLinkMarkdownIt } from "../src/components/DocEditor.jsx";
import { mathToPlaceholders } from "../src/lib/math.jsx";
import { FILE_URL_RE } from "../src/lib/filelinks.js";

// Wie FILE_URL_FULL_RE in DocEditor.jsx (dort lokal gebaut, nicht
// exportiert) – siehe tests/docEditorLinks.test.jsx, identischer Kommentar.
const FILE_URL_FULL_RE_TEST = new RegExp("^" + FILE_URL_RE.source + "$");

// EXAKT dieselbe Link-Konfiguration wie an der Link.configure(...)-Stelle
// in DocEditor.jsx' extensions-Liste UND tests/docEditorLinks.test.jsx:
// autolink:true macht die Link-Mark "inclusive" und aktiviert die
// "autolink"-appendTransaction von @tiptap/extension-link. Das
// autolink-Plugin ist die einzige appendTransaction-Instanz DER
// LINK-EXTENSION. Weitere appendTransaction-Plugins (tiptap-core
// "clearDocument": greift nur, wenn vorher das GANZE Dokument selektiert
// war und es danach leer ist; tiptap-core PasteRules: nur bei uiEvent
// paste/drop bzw. applyPasteRules; im echten Editor zusätzlich
// prosemirror-tables tableEditing: nur fixTables/normalizeSelection bei
// Tabellen) greifen in KEINEM Szenario unten – die jeweilige Bedingung
// ist nie erfüllt. Der Test nutzt die echte Link-Konfiguration, aber eine
// reduzierte Extension-Liste (StarterKit, FencedCodeBlock, Link,
// FileLinkMarkdownIt, LinkDecorations, Markdown) – eine abweichende
// autolink-Konfiguration (z. B. autolink:false) würde den autolink-Pfad
// selbst nicht abdecken.
const LinkExt = Link.configure({
  openOnClick: false,
  autolink: true,
  linkOnPaste: true,
  isAllowedUri: (url, ctx) =>
    (ctx.defaultValidate(url) && /^https?:/i.test(url)) || FILE_URL_FULL_RE_TEST.test(String(url || "")),
});

function buildEditor(md) {
  return new Editor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, blockquote: false }),
      FencedCodeBlock,
      LinkExt,
      FileLinkMarkdownIt,
      LinkDecorations,
      Markdown.configure({ html: true, bulletListMarker: "-", tightLists: true }),
    ],
    content: mathToPlaceholders(md),
  });
}

// Position DIREKT NACH dem letzten Zeichen des (einzigen) Link-Textknotens –
// die letzte Zeichenposition, noch innerhalb der Link-Mark: Link.inclusive()
// liefert bei autolink:true "true", die Mark reicht damit GENAU bis zu
// dieser Grenzposition (nicht nur bis zum letzten Zeichen).
function endOfLinkPos(editor) {
  let pos = null;
  editor.state.doc.descendants((node, nodePos) => {
    if (node.isText && node.marks.some((m) => m.type.name === "link")) pos = nodePos + node.nodeSize;
  });
  if (pos === null) throw new Error("Testfehler: kein Link-Textknoten im Dokument gefunden");
  return pos;
}

// Position MITTEN im (ersten gefundenen) Link-Textknoten (Szenario
// "Cursor mitten im Linktext").
function midOfLinkPos(editor) {
  let from = null;
  let size = null;
  editor.state.doc.descendants((node, nodePos) => {
    if (from === null && node.isText && node.marks.some((m) => m.type.name === "link")) {
      from = nodePos;
      size = node.nodeSize;
    }
  });
  if (from === null) throw new Error("Testfehler: kein Link-Textknoten im Dokument gefunden");
  return from + Math.floor(size / 2);
}

// Findet die Position EINES Textknotens mit genau diesem Inhalt (Szenario
// "viaInsertContent" unten: dort steht vor dem Einfügen noch reiner Text,
// kein Link-Mark, also kann endOfLinkPos/midOfLinkPos nicht verwendet
// werden).
function findTextRange(editor, text) {
  let range = null;
  editor.state.doc.descendants((node, nodePos) => {
    if (range === null && node.isText && node.text === text) range = { from: nodePos, to: nodePos + node.nodeSize };
  });
  if (!range) throw new Error("Testfehler: Textknoten '" + text + "' nicht gefunden");
  return range;
}

// Sieht JEDE Transaktion, die EditorState.apply() durchläuft – INKLUSIVE
// per appendTransaction ANGEHÄNGTER Transaktionen. Bewusst NICHT über das
// "transaction"-Event (editor.on, @tiptap/core EventEmitter): dessen
// dispatchTransaction() (node_modules/@tiptap/core/dist/index.js, Editor-Klasse)
// emittiert NUR die Wurzel-Transaktion – angehängte Transaktionen (genau
// der Mechanismus, den Kopfkommentar und DECISIONS #116 als Verdächtigen
// benennen) tauchen dort NIE auf. Stattdessen ein eigenes Plugin mit
// filterTransaction: prosemirror-state ruft das für JEDE Transaktion auf,
// die EditorState.apply() verarbeitet, auch für die im appendTransaction-
// Loop selbst erzeugten (node_modules/prosemirror-state/dist/index.js:
// "if (tr && newState.filterTransaction(tr, i))"). registerPlugin() hängt
// das Watch-Plugin nachträglich an, ohne buildEditor()s Extension-Liste zu
// verändern. Diagnose "welche Transaktion entfernt den Text" bleibt
// erhalten – dump() wird von runScenario() NUR bei einem fehlschlagenden
// Fall aufgerufen (sonst würde jeder der 27 aktiven Läufe die
// Testausgabe fluten), zeigt dann aber sofort, welche Transaktion für
// eine künftige Regression verantwortlich wäre.
function watchTransactions(editor) {
  const entries = [];
  const key = new PluginKey("linkEnterWatch");
  editor.registerPlugin(
    new Plugin({
      key,
      // filterTransaction läuft für Wurzel- UND appendTransaction-
      // Transaktionen (s. o.) – return true: nie blockieren, nur
      // beobachten.
      filterTransaction: (tr) => {
        entries.push({
          docChanged: tr.docChanged,
          steps: tr.steps.map((s) => s.toJSON()),
          metaKeys: Object.keys(tr.meta || {}),
        });
        return true;
      },
    })
  );
  return {
    entries,
    stop: () => editor.unregisterPlugin(key),
    dump: (label) => console.log("[docEditorLinkEnter] " + label + ":\n" + JSON.stringify(entries, null, 2)),
  };
}

// DREI unabhängige Enter-Auslöser. Weg 1/2 wirken direkt auf der
// ProseMirror-Modell-Ebene; Weg 3 (echtes KeyboardEvent) läuft über
// GENAU denselben internen Pfad wie ein echter Tastendruck im Browser
// (node_modules/prosemirror-view/dist/index.js: initInput() hängt
// "keydown" DIREKT an view.dom, editHandlers.keydown ruft
// view.someProp("handleKeyDown", …) auf – dieselbe Funktion, die auch
// keyboardShortcut() intern aufruft).
const WAYS = [
  {
    label: "Weg 1: editor.commands.keyboardShortcut(\"Enter\")",
    trigger: (editor) => editor.commands.keyboardShortcut("Enter"),
  },
  {
    label: "Weg 2: editor.commands.splitBlock()",
    trigger: (editor) => editor.commands.splitBlock(),
  },
  {
    label: "Weg 3: echtes keydown-Event am contenteditable (editor.view.dom)",
    trigger: (editor) => {
      const ev = new KeyboardEvent("keydown", {
        key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true,
      });
      editor.view.dom.dispatchEvent(ev);
      return ev.defaultPrevented;
    },
  },
];

// Datenlagen: Provider-Match vs. keiner, letzter Block vs. gefolgt von
// einem weiteren Absatz, Cursor am Ende vs. mitten im Linktext – plus zwei
// Zusatzfälle (numerischer/Fußnoten-Titel, Autolink-Form <url>) und die
// Konstruktion über insertContent (wie applyLink() im echten
// Link-Popover), weil unklar war, ob der Linktitel eine Rolle spielt.
const SCENARIOS = [
  {
    label: "Provider-Match (dev.azure.com), letzter Block, Cursor am Ende — PRIMÄRER E2E-Fall",
    build: () => buildEditor("# T\n\n## A\n\n[Azure-Ticket](https://dev.azure.com/org/proj)"),
    selectPos: endOfLinkPos,
    expected: ["T", "A", "Azure-Ticket", ""],
  },
  {
    label: "OHNE Provider-Match (example.com), letzter Block, Cursor am Ende",
    build: () => buildEditor("# T\n\n## A\n\n[Azure-Ticket](https://example.com/seite)"),
    selectPos: endOfLinkPos,
    expected: ["T", "A", "Azure-Ticket", ""],
  },
  {
    label: "Provider-Match, GEFOLGT von einem weiteren Absatz (NICHT der letzte Block), Cursor am Ende",
    build: () => buildEditor("# T\n\n## A\n\n[Azure-Ticket](https://dev.azure.com/org/proj)\n\nWeiterer Absatz."),
    selectPos: endOfLinkPos,
    expected: ["T", "A", "Azure-Ticket", "", "Weiterer Absatz."],
  },
  {
    label: "OHNE Provider-Match, GEFOLGT von einem weiteren Absatz, Cursor am Ende",
    build: () => buildEditor("# T\n\n## A\n\n[Azure-Ticket](https://example.com/seite)\n\nWeiterer Absatz."),
    selectPos: endOfLinkPos,
    expected: ["T", "A", "Azure-Ticket", "", "Weiterer Absatz."],
  },
  {
    label: "Provider-Match, letzter Block, Cursor MITTEN im Linktext ('Azure-'|'Ticket')",
    build: () => buildEditor("# T\n\n## A\n\n[Azure-Ticket](https://dev.azure.com/org/proj)"),
    selectPos: midOfLinkPos,
    expected: ["T", "A", "Azure-", "Ticket"],
  },
  {
    label: "OHNE Provider-Match, letzter Block, Cursor MITTEN im Linktext",
    build: () => buildEditor("# T\n\n## A\n\n[Azure-Ticket](https://example.com/seite)"),
    selectPos: midOfLinkPos,
    expected: ["T", "A", "Azure-", "Ticket"],
  },
  {
    label: "Numerischer Titel (Fußnoten-/cite-link-Stil statt doc-link), Link allein als letzter Block, Cursor am Ende",
    build: () => buildEditor("# T\n\n## A\n\n[3](https://dev.azure.com/org/proj)"),
    selectPos: endOfLinkPos,
    expected: ["T", "A", "3", ""],
  },
  {
    label: "Autolink-Form <url> (Titel==URL), letzter Block, Cursor am Ende",
    build: () => buildEditor("# T\n\n## A\n\n<https://dev.azure.com/org/proj>"),
    selectPos: endOfLinkPos,
    expected: ["T", "A", "https://dev.azure.com/org/proj", ""],
  },
  {
    label: "Link über insertContent eingefügt (wie applyLink() im echten Link-Popover), OHNE separaten setTextSelection()-Aufruf danach",
    build: () => {
      const editor = buildEditor("# T\n\n## A\n\nAlt");
      const { from, to } = findTextRange(editor, "Alt");
      editor.commands.setTextSelection({ from, to });
      // Entspricht applyLink() in DocEditor.jsx: Cursor landet
      // NATÜRLICH am Ende des neuen Link-Texts, kein weiterer
      // setTextSelection()-Aufruf nötig/gewünscht (siehe skipReposition
      // unten) - näher am echten Popover-Ablauf als die anderen Szenarien.
      editor.chain().focus().insertContent({
        type: "text", text: "Azure-Ticket",
        marks: [{ type: "link", attrs: { href: "https://dev.azure.com/org/proj" } }],
      }).run();
      return editor;
    },
    skipReposition: true,
    expected: ["T", "A", "Azure-Ticket", ""],
  },
];

function runScenario(way, scenario) {
  const editor = scenario.build();
  if (!scenario.skipReposition) editor.commands.setTextSelection(scenario.selectPos(editor));
  const watch = watchTransactions(editor);
  try {
    way.trigger(editor);
    const paragraphs = [];
    editor.state.doc.forEach((n) => paragraphs.push(n.textContent));
    // Kernaussage: Linktext bleibt vollständig erhalten UND es entsteht
    // genau die erwartete Absatzstruktur (Anzahl UND Inhalt je Absatz) –
    // nicht nur "kein Fehler geworfen".
    expect(paragraphs).toEqual(scenario.expected);
    // Verankert die DECISIONS-#116-Aussage direkt im Test (statt sie nur
    // zu behaupten): GENAU eine dokumentverändernde Transaktion, ein
    // einzelner "replace"-Step (structure:true bei splitBlock/Enter) –
    // kein appendTransaction-Plugin (autolink o. Ä.) mischt sich mit
    // einer ZWEITEN docChanged-Transaktion ein. watch.entries sieht dank
    // filterTransaction auch angehängte Transaktionen (s. o.).
    const changed = watch.entries.filter((e) => e.docChanged);
    expect(changed).toHaveLength(1);
    expect(changed[0].steps.map((s) => s.stepType)).toEqual(["replace"]);
  } catch (err) {
    watch.dump(way.label + " / " + scenario.label);
    throw err;
  } finally {
    watch.stop();
    editor.destroy();
  }
}

// Regressionsschutz: Enter am Link-Ende (bzw. mitten im Link) darf in
// KEINER der neun Datenlagen × drei Auslöser Text löschen. Alle 27 Fälle
// sind aktiv (kein describe.skip) und müssen grün bleiben.
for (const way of WAYS) {
  describe(way.label, () => {
    for (const scenario of SCENARIOS) {
      it(scenario.label, () => runScenario(way, scenario));
    }
  });
}

// Ergänzender Ausschluss-Beweis (nicht Teil der Enter-Regression oben,
// sondern eine eigenständige Prüfung): schließt aus, dass ein Auto-Titel-/
// Provider-Mechanismus asynchron in den Editor schreibt und so den
// gemeldeten Datenverlust erklären könnte (gleiches Muster wie die
// quelltextbasierte Prüfung in tests/docEditorToolbarFocus.test.jsx, Punkt
// 2 dort): scheduleAutoFetch/runAutoFetch (DocEditor.jsx) sind reine
// Closures der React-Komponente (NICHT exportiert) und schreiben laut
// Quelltext AUSSCHLIESSLICH über setLinkForm()/setTitleFetching() in
// React-State – kein einziger Aufruf von editor.commands/editor.chain()
// darin. Der einzige Ort, an dem ein Fetch-Ergebnis den EDITOR selbst
// verändert, ist applyLink() (Klick auf "Einfügen"/"Übernehmen") – und der
// läuft synchron auf explizite Nutzeraktion, NIEMALS aus dem Debounce-
// Timer heraus. Ein bereits eingefügter, im Popover geschlossener Link
// (wie im E2E-Fall: der Nutzer hat den Link fertig eingefügt UND das
// Popover verlassen, bevor er Enter drückt) kann demnach strukturell NICHT
// nachträglich durch einen noch laufenden Auto-Fetch verändert werden –
// ein asynchron schreibender Provider-Mechanismus scheidet damit als
// Erklärung für den gemeldeten Bug aus.
const DOC_EDITOR_SRC = readFileSync(resolve(process.cwd(), "src/components/DocEditor.jsx"), "utf8");

describe("Ausschluss Variante (c): Auto-Titel-Fetch (v7.12) kann NICHT asynchron in den Editor schreiben", () => {
  it("scheduleAutoFetch/runAutoFetch rufen NIRGENDS editor.commands/editor.chain auf (nur setLinkForm/setTitleFetching)", () => {
    const start = DOC_EDITOR_SRC.indexOf("const scheduleAutoFetch = ");
    const end = DOC_EDITOR_SRC.indexOf("const applyLink = ", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = DOC_EDITOR_SRC.slice(start, end);
    expect(block).not.toMatch(/editor\.(commands|chain)/);
    // Gegenprobe (belegt, dass der obige Bereich NICHT einfach leer/falsch
    // abgeschnitten ist): der Block muss die beiden Timer-Funktionen UND
    // ausschließlich State-Setter enthalten.
    expect(block).toContain("runAutoFetch");
    expect(block).toMatch(/setLinkForm/);
  });

  it("applyLink() – der EINZIGE Ort, an dem ein Fetch-Ergebnis den Editor erreicht – läuft NUR auf expliziten Klick, nicht im Timer-Callback", () => {
    const start = DOC_EDITOR_SRC.indexOf("const applyLink = ");
    const end = DOC_EDITOR_SRC.indexOf("const removeLink = ", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = DOC_EDITOR_SRC.slice(start, end);
    expect(block).toMatch(/editor\.chain\(\)\.focus\(\)\.extendMarkRange\("link"\)\.insertContent/);
    // applyLink() selbst wird laut JSX NUR über onClick={applyLink} am
    // "Einfügen/Übernehmen"-Knopf aufgerufen (siehe Toolbar unten), nicht
    // aus runAutoFetch/scheduleAutoFetch heraus (bereits oben belegt).
    expect(DOC_EDITOR_SRC).toContain("onClick={applyLink}");
    // toContain oben belegt nur EXISTENZ, nicht EXKLUSIVITÄT – ein
    // zweiter Aufrufort (z. B. ein zusätzlicher Knopf oder ein verzögerter
    // Timer-Aufruf) wäre damit unentdeckt geblieben. Ergänzend (Review-
    // Runde 2): ein Regex auf "setTimeout(...applyLink" erkennt die übliche
    // Pfeilfunktions-Form setTimeout(() => applyLink(), …) NICHT – deshalb
    // stattdessen Referenzen ZÄHLEN: nach Entfernen aller Kommentare darf
    // "applyLink" GENAU ZWEIMAL vorkommen (Definition + onClick); jeder
    // weitere Aufrufort (Timer, zweiter Knopf, Effekt) wäre eine dritte.
    const code = DOC_EDITOR_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code.match(/\bapplyLink\b/g)).toHaveLength(2);
    expect(code).toMatch(/onClick=\{applyLink\}/);
  });
});
