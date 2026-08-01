// @vitest-environment jsdom
//
// Echter TipTap-Roundtrip-/Verhaltens-Test für die AutoKorrektur (v7.25,
// wie tests/docEditorCode.test.jsx/docEditorLinks.test.jsx für andere
// Editor-Features). Die eigentliche Regel-KONSTRUKTION (welche Regex,
// welche Grenzfälle) ist bereits in tests/autocorrect.test.js gegen die
// reinen Funktionen aus lib/autocorrect.js gepinnt – hier geht es um das
// ECHTE TipTap-Verhalten beim TIPPEN (Zeichen für Zeichen, wie im echten
// Browser), weil genau DORT die Ketten-Konflikte ("-->" vs. "--" & Co.)
// zuschlagen würden, wenn das Design falsch wäre: ein simulierter
// "insertContent(ganzer String)" würde diese Regression NICHT aufdecken
// (siehe unten, typeChar/typeText).
//
// Nur DIESE Datei braucht jsdom (per-Datei-Override), der Rest der Suite
// bleibt bei environment:"node" (vitest.config.js).
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { AutoCorrect, FencedCodeBlock, unescapeMd } from "../src/components/DocEditor.jsx";
import { buildActiveRules } from "../src/lib/autocorrect.js";

// Simuliert ECHTES Zeichen-für-Zeichen-Tippen: ProseMirror ruft beim
// Tippen im Browser für JEDEN Tastendruck view.someProp("handleTextInput",
// …) auf, BEVOR der Browser den Buchstaben selbst einfügt – feuert eine
// InputRule (liefert true), übernimmt sie die Einfügung/Ersetzung
// vollständig selbst; sonst (false) fügt hier – wie sonst der Browser –
// eine ganz normale insertText-Transaktion ein (inkl. aktueller
// storedMarks/Marks am Cursor, exakt wie Transaction.insertText das auch
// bei echten Tastendrücken tut). editor.commands.insertContent() wäre
// NICHT gleichwertig: es prüft (mit applyInputRules:false per Default)
// den eingefügten Text NUR EINMAL als Ganzes am Ende, nicht Zeichen für
// Zeichen – genau die Ketten-Konflikte unten würden dabei unentdeckt
// bleiben.
function typeChar(editor, ch) {
  const { from, to } = editor.state.selection;
  const handled = editor.view.someProp("handleTextInput", (f) => f(editor.view, from, to, ch));
  if (!handled) editor.view.dispatch(editor.view.state.tr.insertText(ch, from, to));
}
function typeText(editor, text) {
  for (const ch of text) typeChar(editor, ch);
}

// Minimaler Editor mit GENAU den für AutoCorrect relevanten Extensions
// (FencedCodeBlock für den Codeblock-Guard-Test, Markdown für den
// Roundtrip-Test) – config geht direkt an buildActiveRules (lib/
// autocorrect.js), null/undefined liefert dort bereits die Defaults.
function buildEditor(config, content = "<p></p>") {
  return new Editor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, blockquote: false }),
      FencedCodeBlock,
      AutoCorrect.configure({ rules: buildActiveRules(config) }),
      Markdown.configure({ html: true, bulletListMarker: "-", tightLists: true }),
    ],
    content,
  });
}

// Baut einen frischen, leeren Editor, tippt "text" hinein und liefert den
// gesamten Text-Inhalt des Dokuments zurück (ein einzelner leerer
// Absatz als Startpunkt – kein zweiter Text-Knoten, der die Aggregation
// verfälschen könnte).
function typeIntoNewParagraph(config, text) {
  const editor = buildEditor(config);
  editor.commands.focus("end");
  typeText(editor, text);
  const result = editor.state.doc.textContent;
  editor.destroy();
  return result;
}

describe("AutoKorrektur: repräsentative Ersetzungen je Kategorie (echtes Zeichen-für-Zeichen-Tippen)", () => {
  it("Pfeile: '->' wird sofort zu '→'", () => {
    expect(typeIntoNewParagraph(null, "Pfeil: -> Ziel")).toBe("Pfeil: → Ziel");
  });

  it("Typografie: '--' (mit Leerzeichen danach) wird zu '–'", () => {
    expect(typeIntoNewParagraph(null, "Gedanke -- weiter")).toBe("Gedanke – weiter");
  });

  it("Typografie: '---' wird sofort zu '—'", () => {
    expect(typeIntoNewParagraph(null, "---")).toBe("—");
  });

  it("Typografie: '...' wird zu '…'", () => {
    expect(typeIntoNewParagraph(null, "Bald...")).toBe("Bald…");
  });

  it("Marken: '(c)' wird zu '©'", () => {
    expect(typeIntoNewParagraph(null, "Copyright (c) 2026")).toBe("Copyright © 2026");
  });

  it("Marken: '(a)' wird zu '@' (ausdrücklicher Nutzerwunsch trotz Aufzählungs-Risiko, siehe DECISIONS)", () => {
    expect(typeIntoNewParagraph(null, "(a) erstens")).toBe("@ erstens");
  });

  it("Vergleiche: '!=' wird zu '≠'", () => {
    expect(typeIntoNewParagraph(null, "a != b")).toBe("a ≠ b");
  });

  it("Vergleiche: '<=' (mit Leerzeichen danach) wird zu '≤'", () => {
    expect(typeIntoNewParagraph(null, "a <= b")).toBe("a ≤ b");
  });

  it("Vergleiche: '2x3' (Ziffer x Ziffer) wird zu '2×3', '12x3' bleibt unangetastet", () => {
    expect(typeIntoNewParagraph(null, "Feld 2x3 cm")).toBe("Feld 2×3 cm");
    expect(typeIntoNewParagraph(null, "Nummer 12x3")).toBe("Nummer 12x3");
  });

  it("Brüche: '1/2' als eigenständiges Wort wird zu '½', '13/24' NICHT (Auftrags-Testfall)", () => {
    expect(typeIntoNewParagraph(null, "nimm 1/2 Becher")).toBe("nimm ½ Becher");
    expect(typeIntoNewParagraph(null, "Ordner 13/24 bleibt")).toBe("Ordner 13/24 bleibt");
  });

  it("Smileys: ':)' wird zu einem Smiley-Emoji", () => {
    expect(typeIntoNewParagraph(null, "Hi :)")).toBe("Hi 😊");
  });

  it("Symbole: '\\alpha' feuert erst NACH einem Abschlusszeichen (Terminator bleibt erhalten)", () => {
    expect(typeIntoNewParagraph(null, "Winkel \\alpha.")).toBe("Winkel α.");
  });

  it("Symbole: '\\sum' feuert nach einem Leerzeichen", () => {
    expect(typeIntoNewParagraph(null, "Summe \\sum wert")).toBe("Summe ∑ wert");
  });
});

describe("AutoKorrektur: Ketten-Konflikte (Kernstück des Auftrags – KEIN Trigger darf einen längeren blockieren)", () => {
  it("'-->' ergibt '⟶' – '--' feuert NICHT vorzeitig beim zweiten Bindestrich", () => {
    expect(typeIntoNewParagraph(null, "Pfeil --> Ziel")).toBe("Pfeil ⟶ Ziel");
  });

  it("'a -- b' (Gedankenstrich VOR einem anderen Zeichen als '-'/'>') ergibt 'a – b'", () => {
    expect(typeIntoNewParagraph(null, "a -- b")).toBe("a – b");
  });

  it("'---' (drei Bindestriche) ergibt weiterhin '—', nicht '– -' oder Ähnliches", () => {
    expect(typeIntoNewParagraph(null, "Trennlinie --- Ende")).toBe("Trennlinie — Ende");
  });

  it("'<--' ergibt '⟵' – '<-' feuert NICHT vorzeitig beim Bindestrich (analoger Fall zu '--'/'-->')", () => {
    expect(typeIntoNewParagraph(null, "Rueckpfeil <-- Start")).toBe("Rueckpfeil ⟵ Start");
  });

  it("'<->' ergibt '↔' – '<-' feuert NICHT vorzeitig ('<-' ist auch Präfix von '<->')", () => {
    expect(typeIntoNewParagraph(null, "a <-> b")).toBe("a ↔ b");
  });

  it("'<==' ergibt '⇐' – '<=' feuert NICHT vorzeitig beim zweiten Gleichheitszeichen", () => {
    expect(typeIntoNewParagraph(null, "a <== b")).toBe("a ⇐ b");
  });

  it("'<=>' ergibt '⇔' – '<=' feuert NICHT vorzeitig vor dem '>'", () => {
    expect(typeIntoNewParagraph(null, "a <=> b")).toBe("a ⇔ b");
  });

  it("'==>' ergibt '⇒' (Suffix-Kollision mit '=>' wird durch Längen-Sortierung aufgelöst)", () => {
    expect(typeIntoNewParagraph(null, "a ==> b")).toBe("a ⇒ b");
  });
});

describe("AutoKorrektur: feuert NICHT in Codeblock/Codespan", () => {
  it("in einem Codeblock bleibt getippter Text unverändert", () => {
    const editor = buildEditor(null);
    editor.commands.focus("end");
    editor.chain().focus().toggleCodeBlock().run();
    typeText(editor, "Pfeil --> Ziel (c) 1/2");
    const text = editor.state.doc.textContent;
    editor.destroy();
    expect(text).toBe("Pfeil --> Ziel (c) 1/2");
  });

  it("in einem Codespan (Inline-Code) bleibt getippter Text unverändert", () => {
    const editor = buildEditor(null);
    editor.commands.focus("end");
    editor.chain().focus().toggleCode().run();
    typeText(editor, "-> --");
    const text = editor.state.doc.textContent;
    const html = editor.getHTML();
    editor.destroy();
    expect(text).toBe("-> --");
    expect(html).toContain("<code>"); // wirklich als Code markiert, nicht zufällig nur ignoriert
  });

  it("'<<' wird in normaler Prosa zu '«', bleibt aber in einem Codespan buchstäblich '<<' (v7.24-Entity-Pfad-Kollisionscheck)", () => {
    expect(typeIntoNewParagraph(null, "Zitat: << Text")).toBe("Zitat: « Text");

    const editor = buildEditor(null);
    editor.commands.focus("end");
    editor.chain().focus().toggleCode().run();
    typeText(editor, "<<");
    const text = editor.state.doc.textContent;
    editor.destroy();
    expect(text).toBe("<<");
  });
});

// v7.33 (E2E-Finding 🟡 F/G, Root-Cause-Fix, siehe DECISIONS #78): "instant"-
// Regeln (kind:"text" ohne Capture-Gruppe VOR diesem Fix) ließen
// @tiptap/core#textInputRule bei einer MEHRZEICHEN-Einfügung in EINEM
// handleTextInput-Aufruf (z. B. Diktier-Software, manche prädiktive
// Tastaturen, Automatisierungs-Werkzeuge) mit einer RangeError abstürzen,
// sobald der Trigger KÜRZER war als der gesamte eingefügte Text. Diese
// Tests simulieren eine solche Mehrzeichen-Einfügung DIREKT über EINEN
// handleTextInput-Aufruf (bewusst NICHT über typeText/typeChar, die immer
// EIN Zeichen pro Aufruf senden – siehe Kopfkommentar der Datei).
function typeBulk(editor, text) {
  const { from, to } = editor.state.selection;
  const handled = editor.view.someProp("handleTextInput", (f) => f(editor.view, from, to, text));
  if (!handled) editor.view.dispatch(editor.view.state.tr.insertText(text, from, to));
  return handled;
}

describe("AutoKorrektur: Mehrzeichen-Einfügung in EINEM handleTextInput-Aufruf (v7.33, F/G-Root-Cause-Fix)", () => {
  it("REGRESSION (vorher: RangeError 'Position … out of range'): 'Pfeil ->' als EIN Bulk-Aufruf wirft NICHT mehr", () => {
    const editor = buildEditor(null);
    editor.commands.focus("end");
    expect(() => typeBulk(editor, "Pfeil ->")).not.toThrow();
    editor.destroy();
  });

  it("der Trigger ALLEIN als Bulk-Aufruf (kein Text davor) wird weiterhin korrekt ersetzt", () => {
    const editor = buildEditor(null);
    editor.commands.focus("end");
    typeBulk(editor, "->");
    expect(editor.state.doc.textContent).toBe("→");
    editor.destroy();
  });

  it("mehrere weitere instant-Trigger als eigenständiger Bulk-Aufruf werfen ebenfalls nicht (Smiley, Marken-Kürzel)", () => {
    for (const trigger of [":)", "(c)", "<3", "..."]) {
      const editor = buildEditor(null);
      editor.commands.focus("end");
      expect(() => typeBulk(editor, trigger)).not.toThrow();
      editor.destroy();
    }
  });

  it("terminator-/word-kind (z. B. '<=', '1/2') werfen bei einer Mehrzeichen-Einfügung ebenfalls nicht, auch wenn der Terminator nicht das letzte Zeichen des gesamten Einfüge-Vorgangs ist (dokumentiertes Restrisiko: keine Ersetzung in diesem Fall, aber kein Crash und kein Datenverlust)", () => {
    const editor = buildEditor(null);
    editor.commands.focus("end");
    expect(() => typeBulk(editor, "a <= b")).not.toThrow();
    editor.destroy();

    const editor2 = buildEditor(null);
    editor2.commands.focus("end");
    expect(() => typeBulk(editor2, "nimm 1/2 Becher")).not.toThrow();
    editor2.destroy();
  });

  // v7.33 Review-Nachbesserung (Finding 1, siehe DECISIONS #78): Der
  // multiply-Handler (eigene Custom-InputRule in DocEditor.jsx, KEIN
  // textInputRule()) benutzte "range.from"/"range.to" bisher DIREKT ohne
  // Gegenprüfung – bei derselben Mehrzeichen-Einfügung wie oben crashte er
  // WEITERHIN (Review-Probe: "Rechne 2x3" als Bulk-Aufruf -> RangeError
  // "Position 8 out of range"), obwohl die Kategorie "vergleiche" (enthält
  // die multiply-Regel) DEFAULT-AKTIV ist – exakt die vom Fix-Auftrag
  // adressierte Nutzer-Situation (Diktat/prädiktive Tastatur) blieb also
  // in der Standard-Konfiguration reproduzierbar crash-anfällig.
  it("REGRESSION (Review-Finding 1, vorher weiterhin: RangeError 'Position … out of range'): multiply-kind ('2x3') wirft bei Mehrzeichen-Einfügung NICHT mehr, Kategorie 'vergleiche' ist default-aktiv", () => {
    const editor = buildEditor(null);
    editor.commands.focus("end");
    expect(() => typeBulk(editor, "Rechne 2x3")).not.toThrow();
    editor.destroy();
  });

  it("multiply-kind: der Trigger ALLEIN als Bulk-Aufruf (kein Text davor) wird weiterhin korrekt ersetzt", () => {
    const editor = buildEditor(null);
    editor.commands.focus("end");
    typeBulk(editor, "2x3");
    expect(editor.state.doc.textContent).toBe("2×3");
    editor.destroy();
  });

  // v7.33 Review-Nachbesserung (Finding 2, siehe DECISIONS #78): Die
  // quote-Regeln (compileQuoteEntry, autocorrect.js) liefen wie "instant"
  // VOR dem Fix ohne Capture-Gruppe durch dieselbe textInputRule() – bei
  // Mehrzeichen-Einfügung entsprechend derselbe Absturz (Review-Proben:
  // 'sagte "' -> "Position 7 out of range", 'er"' -> "Position 3 out of
  // range"). Kategorie ist default AUS, aber per Einstellungen aktivierbar.
  describe("Anführungszeichen (kind:'quote', opt-in) – Mehrzeichen-Einfügung", () => {
    const quoteCfg = { enabled: true, categories: { anfuehrung_de: true }, custom: [] };

    it("REGRESSION öffnend (Review-Finding 2): 'sagte \"' als Bulk-Aufruf wirft NICHT mehr", () => {
      const editor = buildEditor(quoteCfg);
      editor.commands.focus("end");
      expect(() => typeBulk(editor, 'sagte "')).not.toThrow();
      editor.destroy();
    });

    it("REGRESSION schließend (Review-Finding 2): '...er\"' als Bulk-Aufruf NACH einem Wort wirft NICHT mehr", () => {
      const editor = buildEditor(quoteCfg);
      editor.commands.focus("end");
      typeText(editor, "Wort davor ");
      expect(() => typeBulk(editor, 'er"')).not.toThrow();
      editor.destroy();
    });

    it("der Trigger ALLEIN als Bulk-Aufruf wird weiterhin korrekt kontextabhängig ersetzt (öffnend am Zeilenanfang, schließend nach einem Wort)", () => {
      const editorOpen = buildEditor(quoteCfg);
      editorOpen.commands.focus("end");
      typeBulk(editorOpen, '"');
      expect(editorOpen.state.doc.textContent).toBe("„");
      editorOpen.destroy();

      const editorClose = buildEditor(quoteCfg);
      editorClose.commands.focus("end");
      typeText(editorClose, "Wort");
      typeBulk(editorClose, '"');
      expect(editorClose.state.doc.textContent).toBe("Wort“");
      editorClose.destroy();
    });
  });
});

describe("AutoKorrektur: Undo (ProseMirror-Standard undoInputRule)", () => {
  it("direkt nach der Ersetzung stellt undoInputRule den getippten Originaltext wieder her", () => {
    const editor = buildEditor(null);
    editor.commands.focus("end");
    typeText(editor, "->");
    expect(editor.state.doc.textContent).toBe("→");
    const undone = editor.commands.undoInputRule();
    expect(undone).toBe(true);
    expect(editor.state.doc.textContent).toBe("->");
    editor.destroy();
  });

  it("ohne vorherige Ersetzung liefert undoInputRule false (nichts rückgängig zu machen)", () => {
    const editor = buildEditor(null);
    editor.commands.focus("end");
    typeText(editor, "normaler Text");
    const undone = editor.commands.undoInputRule();
    editor.destroy();
    expect(undone).toBe(false);
  });
});

describe("AutoKorrektur: Roundtrip-Stabilität (ersetzte Unicode-Zeichen sind normaler Text)", () => {
  it("→, –, …, ©, ±, ≤ überstehen Speichern + erneutes Laden byte-identisch (No-op-Vergleich wie in DocEditor.jsx save())", () => {
    const editor = buildEditor(null);
    editor.commands.focus("end");
    typeText(editor, "Pfeil -> Ende, Gedanke -- weiter, Serie..., (c) 2026, +- Toleranz, a <= b.");
    const saved = unescapeMd(editor.storage.markdown.getMarkdown());
    editor.destroy();
    expect(saved).toContain("→");
    expect(saved).toContain("–");
    expect(saved).toContain("…");
    expect(saved).toContain("©");
    expect(saved).toContain("±");
    expect(saved).toContain("≤");

    const reloaded = buildEditor(null, saved);
    const roundtripped = unescapeMd(reloaded.storage.markdown.getMarkdown());
    reloaded.destroy();
    expect(roundtripped).toBe(saved); // kein Trigger feuert nachträglich auf bereits ersetzten Zeichen
  });
});

describe("AutoKorrektur: Anführungszeichen (anfuehrung_de, default AUS)", () => {
  it("default AUS: gerade Anführungszeichen bleiben unverändert", () => {
    expect(typeIntoNewParagraph(null, 'Er sagte "Hallo".')).toBe('Er sagte "Hallo".');
  });

  it("eingeschaltet: kontextabhängig öffnend/schließend (deutsche Konvention „…“)", () => {
    const cfg = { enabled: true, categories: { anfuehrung_de: true }, custom: [] };
    expect(typeIntoNewParagraph(cfg, 'Er sagte "Hallo".')).toBe("Er sagte „Hallo“.");
  });
});

describe("AutoKorrektur: Konfiguration wirkt im echten Editor (Master-Toggle, Kategorien, custom)", () => {
  it("Master-Toggle aus: gar keine Ersetzung mehr", () => {
    const cfg = { enabled: false, categories: {}, custom: [] };
    expect(typeIntoNewParagraph(cfg, "Pfeil -> Ende (c)")).toBe("Pfeil -> Ende (c)");
  });

  it("eine ausgeschaltete Kategorie feuert nicht mehr, andere bleiben unberührt", () => {
    const cfg = { enabled: true, categories: { pfeile: false }, custom: [] };
    expect(typeIntoNewParagraph(cfg, "Pfeil -> Ende (c)")).toBe("Pfeil -> Ende ©");
  });

  it("eine eigene Ersetzung (custom) wirkt genauso wie ein eingebauter Trigger", () => {
    const cfg = { enabled: true, categories: {}, custom: [{ trigger: "btw", replacement: "übrigens" }] };
    expect(typeIntoNewParagraph(cfg, "Das ist btw wichtig.")).toBe("Das ist übrigens wichtig.");
  });
});
