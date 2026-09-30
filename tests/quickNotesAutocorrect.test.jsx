// @vitest-environment jsdom
//
// v7.58, Nutzerbefund "in den Schnellnotizen wird beim Tippen nichts
// automatisch ersetzt": QuickNotes.jsx bindet dieselbe Regelbibliothek wie der
// Dokument-Editor (lib/autocorrect.js) an das controlled <textarea>. Die reine
// Logik ist in tests/autocorrectInput.test.js gepinnt; HIER geht es um das
// Zusammenspiel mit React und dem Browser-Verhalten:
//  - zustandsführender Harness, der updateQuickNote nachbildet (bei JEDEM
//    onChange ein NEUES Notiz-Objekt, auch bei gleichem Text),
//  - ein Tipp-Helfer, der den Browser emuliert (Auswahl ersetzen, Cursor
//    dahinter, dann ein echtes InputEvent mit inputType/data),
//  - Fallback-Pfad (jsdom hat KEIN document.execCommand) und nativer Pfad mit
//    gestubbtem execCommand. Ob ein echter Browser den Undo-Verlauf dabei
//    wirklich erhält, kann kein jsdom-Test zeigen – das prüft der E2E-Fall.
// Muster (createRoot + act, echte Events) wie tests/quickNotesTab.test.jsx.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import QuickNotes from "../src/components/QuickNotes.jsx";
import { AutoCorrect, FencedCodeBlock } from "../src/components/DocEditor.jsx";
import { buildActiveRules } from "../src/lib/autocorrect.js";
import { autocorrectTypedText } from "../src/lib/autocorrectInput.js";

// buildActiveRules zählt seine Aufrufe (Verhalten unverändert): der Test zur
// Hook-Reihenfolge unten misst darüber die Lebensdauer des useMemo.
vi.mock("../src/lib/autocorrect.js", async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, buildActiveRules: vi.fn(orig.buildActiveRules) };
});

const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
const QUOTE_CFG = { enabled: true, categories: { anfuehrung_de: true }, custom: [] };

let container = null;
let root = null;
let api = null; // { setNotes, setAc } des laufenden Harness
let calls = []; // jeder onChange-Aufruf des Harness: { id, text }
let frozen = false; // true: onChange wird protokolliert, aber NICHT in den State übernommen

const note = (id, text) => ({ id, x: 20, y: 20, w: 220, h: 160, text });

// Bildet App.jsx#updateQuickNote nach: jede Änderung erzeugt ein NEUES
// Notiz-Objekt (dadurch rendert QuickNotes auch dann neu, wenn der Text
// derselbe bleibt – genau die Lücke, die das entfernte deps-Array schließt).
function Harness({ initialNotes, initialAc }) {
  const [notes, setNotes] = useState(initialNotes);
  const [ac, setAc] = useState(initialAc);
  api = { setNotes, setAc };
  const onChange = (id, patch) => {
    calls.push({ id, ...patch });
    if (frozen) return;
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  };
  return <QuickNotes notes={notes} autocorrect={ac} onChange={onChange} onRemove={() => {}} onSubmit={() => {}} />;
}

function mount(notes, ac) {
  calls = [];
  frozen = false;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(<Harness initialNotes={notes} initialAc={ac} />); });
  const areas = [...container.querySelectorAll("textarea")];
  // Wie beim Klick hinter den Text: jsdom startet mit Cursor 0, ein Nutzer tippt
  // normalerweise ans Ende. Tests, die mitten im Text tippen, setzen ihn selbst.
  for (const t of areas) t.setSelectionRange(t.value.length, t.value.length);
  return areas;
}

afterEach(() => {
  if (root) { act(() => root.unmount()); root = null; }
  if (container) { container.remove(); container = null; }
  delete document.execCommand;
  vi.restoreAllMocks();
});

// Emuliert den Browser beim Tippen: die Auswahl wird durch `str` ersetzt, der
// Cursor steht dahinter, DANN feuert ein input-Event mit inputType/data.
// setRangeText umgeht Reacts Value-Tracker, deshalb feuert onChange.
function insert(el, str, ev = {}) {
  const inputType = "inputType" in ev ? ev.inputType : "insertText";
  const data = "data" in ev ? ev.data : str;
  act(() => {
    el.setRangeText(str, el.selectionStart, el.selectionEnd, "end");
    el.dispatchEvent(
      ev.plain
        ? new Event("input", { bubbles: true })
        : new InputEvent("input", { bubbles: true, inputType, data, isComposing: !!ev.isComposing })
    );
  });
}
function typeText(el, str) {
  for (const ch of str) insert(el, ch, ch === "\n" ? { inputType: "insertLineBreak", data: null } : {});
}
function keydown(el, key, opts = {}) {
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
  act(() => { el.dispatchEvent(ev); });
  return ev;
}
function beforeInput(el, inputType, opts = {}) {
  const ev = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType, ...opts });
  act(() => { el.dispatchEvent(ev); });
  return ev;
}
const sel = (el) => [el.selectionStart, el.selectionEnd];
const lastText = () => calls[calls.length - 1].text;
const reported = () => calls.map((c) => c.text);

describe("AutoKorrektur im Post-it: Zustandsweg (jsdom hat kein document.execCommand)", () => {
  it("Grundfall: 'ab->' wird zu 'ab→', Cursor dahinter – der Rohtext 'ab->' erreicht den State NIE", () => {
    const [el] = mount([note("n1", "")]); // ohne autocorrect-Prop: Defaults
    typeText(el, "ab->");
    expect(el.value).toBe("ab→");
    expect(sel(el)).toEqual([3, 3]);
    expect(reported()).toEqual(["a", "ab", "ab-", "ab→"]); // genau ein onChange je Taste, nie "ab->"
    expect(typeof document.execCommand).not.toBe("function"); // wirklich der Fallback-Pfad
  });

  it("Cursor mitten im Text steht hinter dem Ersatz, NICHT am Textende (diskriminierend gegen den jsdom-Default)", () => {
    const [el] = mount([note("n1", "XYZ")]);
    el.setSelectionRange(0, 0);
    typeText(el, "ab->");
    expect(el.value).toBe("ab→XYZ");
    // jsdom setzt den Cursor nach einem value-Wechsel von sich aus ans Ende (6)
    expect(sel(el)).toEqual([3, 3]);
    expect(reported()).not.toContain("ab->XYZ");
    expect(lastText()).toBe("ab→XYZ");
  });

  it("Ersatz mit zwei UTF-16-Einheiten ('<3' -> '❤️') mitten im Text: Cursor hinter beiden Einheiten", () => {
    const [el] = mount([note("n1", "XYZ")]);
    el.setSelectionRange(0, 0);
    typeText(el, "<3");
    expect(el.value).toBe("❤️XYZ");
    expect(sel(el)).toEqual([2, 2]);
  });

  it("Enter zählt als Abschlusszeichen: 'a --' + Enter -> 'a –⏎', Cursor in der neuen Zeile; '\\alpha' + Enter -> 'α⏎'", () => {
    const [el] = mount([note("n1", "")]);
    typeText(el, "a --\n");
    expect(el.value).toBe("a –\n");
    expect(sel(el)).toEqual([4, 4]);
    typeText(el, "\\alpha\n");
    expect(el.value).toBe("a –\nα\n");
    expect(sel(el)).toEqual([6, 6]);
    expect(reported()).not.toContain("a --\n");
  });

  it("Enter nach einem instant-Trigger ersetzt nichts ('->' + Enter bleibt roh)", () => {
    const [el] = mount([note("n1", "a-")]);
    el.setSelectionRange(2, 2);
    // '>' wird per Paste (also NICHT als Tippen) eingefügt, damit "->" roh im Feld steht
    insert(el, ">", { inputType: "insertFromPaste", data: null });
    typeText(el, "\n");
    expect(el.value).toBe("a->\n");
  });

  describe("Nicht-Tippen bleibt roh (Positivliste, fail closed)", () => {
    it.each([
      ["Einfügen (insertFromPaste)", ">", { inputType: "insertFromPaste", data: null }],
      ["Drop (insertFromDrop)", ">", { inputType: "insertFromDrop", data: null }],
      ["Rechtschreib-/Bildschirmtastatur-Ersetzung (insertReplacementText)", ">", { inputType: "insertReplacementText", data: ">" }],
      ["Safari nach Komposition (insertFromComposition)", ">", { inputType: "insertFromComposition", data: ">" }],
      ["Komposition (insertCompositionText + isComposing)", ">", { inputType: "insertCompositionText", data: ">", isComposing: true }],
      ["insertText WÄHREND einer Komposition", ">", { isComposing: true }],
      ["Undo-Ergebnis (historyUndo)", ">", { inputType: "historyUndo", data: null }],
      ["event ohne inputType (new Event('input'))", ">", { plain: true }],
    ])("%s", (_name, str, ev) => {
      const [el] = mount([note("n1", "a-")]);
      el.setSelectionRange(2, 2);
      insert(el, str, ev);
      expect(el.value).toBe("a->");
      expect(lastText()).toBe("a->");
      // und es entsteht kein Merker: Backspace löscht normal (kein preventDefault)
      expect(keydown(el, "Backspace").defaultPrevented).toBe(false);
    });

    it("Mehrzeichen-insertText ('->' als EIN Ereignis, z. B. Diktat oder Automations-'type') bleibt roh", () => {
      const [el] = mount([note("n1", "a")]);
      insert(el, "->", { data: "->" });
      expect(el.value).toBe("a->");
      expect(lastText()).toBe("a->");
    });

    it("Tippen bei aufgezogener Auswahl (selectionStart !== selectionEnd) wird nicht ersetzt, auch wenn der Text vor dem Cursor passt", () => {
      // Der Browser meldet ein Zeichen als Tippen, die Auswahl ist danach aber
      // nicht kollabiert (Sonderfall/Erweiterung): die Guard in handleChange
      // (caret === selectionEnd) verhindert die Ersetzung. Ohne sie wäre
      // "a->" (Cursor 3, Text davor endet auf "->") zu "a→XY" geworden.
      const [el] = mount([note("n1", "a-XY")]);
      act(() => {
        el.setRangeText(">", 2, 2, "end");
        el.setSelectionRange(3, 5);
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ">" }));
      });
      expect(el.value).toBe("a->XY");
      expect(lastText()).toBe("a->XY");
    });

    it("von außen gesetzter Text (Remote-Merge) wird nie ersetzt und löst kein onChange aus", () => {
      const [el] = mount([note("n1", "a")]);
      act(() => api.setNotes([note("n1", "x->")]));
      expect(el.value).toBe("x->");
      expect(calls).toHaveLength(0);
    });
  });

  describe("Rücknahme: Backspace direkt nach der Ersetzung stellt den Rohtext wieder her", () => {
    const typedNote = (text = "XYZ") => {
      const [el] = mount([note("n1", text)]);
      el.setSelectionRange(0, 0);
      typeText(el, "ab->");
      expect(el.value).toBe("ab→" + text);
      return el;
    };

    it("per keydown: 'ab→|XYZ' -> 'ab->|XYZ', Cursor dahinter, preventDefault; das zweite Backspace löscht normal", () => {
      const el = typedNote();
      const ev = keydown(el, "Backspace");
      expect(ev.defaultPrevented).toBe(true);
      expect(el.value).toBe("ab->XYZ");
      expect(sel(el)).toEqual([4, 4]); // nicht das Textende (7)
      expect(lastText()).toBe("ab->XYZ");
      const before = calls.length;
      const ev2 = keydown(el, "Backspace");
      expect(ev2.defaultPrevented).toBe(false);
      expect(calls).toHaveLength(before);
    });

    it("per nativem beforeinput (Netz für Android-Bildschirmtastaturen): deleteContentBackward wird verhindert und nimmt zurück", () => {
      const el = typedNote();
      const ev = beforeInput(el, "deleteContentBackward");
      expect(ev.defaultPrevented).toBe(true);
      expect(el.value).toBe("ab->XYZ");
      expect(sel(el)).toEqual([4, 4]);
      expect(beforeInput(el, "deleteContentBackward").defaultPrevented).toBe(false); // zweites Mal: normal
    });

    it("beforeinput mit anderem inputType oder während einer Komposition nimmt NICHT zurück", () => {
      const el = typedNote();
      expect(beforeInput(el, "deleteWordBackward").defaultPrevented).toBe(false);
      expect(beforeInput(el, "deleteContentForward").defaultPrevented).toBe(false);
      expect(beforeInput(el, "insertText", { data: "x" }).defaultPrevented).toBe(false);
      expect(beforeInput(el, "deleteContentBackward", { isComposing: true }).defaultPrevented).toBe(false);
      expect(el.value).toBe("ab→XYZ");
      // der Merker lebt weiter: ein echtes Backspace danach nimmt noch zurück
      expect(keydown(el, "Backspace").defaultPrevented).toBe(true);
    });

    // Ein nicht abbrechbares deleteContentBackward ließe sich per
    // preventDefault nicht stoppen: der Browser löschte trotzdem, mit der
    // Rücknahme liefe Rücknahme UND Löschung. Deshalb darf es NICHT zurücknehmen
    // – und den Merker auch nicht verbrauchen.
    it("beforeinput mit cancelable:false nimmt NICHT zurück; der Merker bleibt für ein späteres abbrechbares Ereignis bestehen", () => {
      const el = typedNote();
      const reportsBefore = calls.length;

      const nonCancelable = beforeInput(el, "deleteContentBackward", { cancelable: false });

      expect(nonCancelable.cancelable).toBe(false);
      expect(nonCancelable.defaultPrevented).toBe(false);
      expect(el.value).toBe("ab→XYZ"); // nichts zurückgenommen
      expect(sel(el)).toEqual([3, 3]);
      expect(calls).toHaveLength(reportsBefore); // und nichts gemeldet

      // Merker unverbraucht: das spätere abbrechbare Ereignis nimmt zurück
      const cancelable = beforeInput(el, "deleteContentBackward");
      expect(cancelable.defaultPrevented).toBe(true);
      expect(el.value).toBe("ab->XYZ");
      expect(sel(el)).toEqual([4, 4]);
      expect(lastText()).toBe("ab->XYZ");
    });

    it("Terminator: 'a – |' -> 'a -- |' (das Leerzeichen bleibt, der Rohtext kommt zurück)", () => {
      const [el] = mount([note("n1", "")]);
      typeText(el, "a -- ");
      expect(el.value).toBe("a – ");
      expect(keydown(el, "Backspace").defaultPrevented).toBe(true);
      expect(el.value).toBe("a -- ");
      expect(sel(el)).toEqual([5, 5]);
    });

    it("Enter als Abschlusszeichen: 'a –⏎' -> 'a --⏎'", () => {
      const [el] = mount([note("n1", "")]);
      typeText(el, "a --\n");
      expect(keydown(el, "Backspace").defaultPrevented).toBe(true);
      expect(el.value).toBe("a --\n");
      expect(sel(el)).toEqual([5, 5]);
    });

    it("Umschalt/Strg/Meta+Backspace nehmen wie im Editor zurück, Alt+Backspace und Backspace während einer Komposition nicht", () => {
      let el = typedNote();
      expect(keydown(el, "Backspace", { altKey: true }).defaultPrevented).toBe(false);
      expect(keydown(el, "Backspace", { isComposing: true }).defaultPrevented).toBe(false);
      expect(el.value).toBe("ab→XYZ");
      expect(keydown(el, "Backspace", { shiftKey: true }).defaultPrevented).toBe(true);
      act(() => root.unmount()); container.remove();
      el = typedNote();
      expect(keydown(el, "Backspace", { ctrlKey: true }).defaultPrevented).toBe(true);
    });

    it("nach der Rücknahme löst das nächste Zeichen nichts erneut aus: 'ab->' + Leerzeichen bleibt roh", () => {
      const el = typedNote();
      keydown(el, "Backspace");
      typeText(el, " ");
      expect(el.value).toBe("ab-> XYZ");
    });

    it("Merker verfällt bei einem weiteren Zeichen", () => {
      const el = typedNote("");
      typeText(el, "z");
      expect(keydown(el, "Backspace").defaultPrevented).toBe(false);
      expect(el.value).toBe("ab→z");
    });

    it("Merker verfällt, wenn der Cursor bewegt wurde (Text unverändert) oder eine Auswahl aufgezogen ist", () => {
      let el = typedNote();
      el.setSelectionRange(1, 1);
      expect(keydown(el, "Backspace").defaultPrevented).toBe(false);
      act(() => root.unmount()); container.remove();
      el = typedNote();
      el.setSelectionRange(2, 3); // "→" markiert
      expect(keydown(el, "Backspace").defaultPrevented).toBe(false);
      expect(el.value).toBe("ab→XYZ"); // keine Rücknahme, das Löschen der Auswahl bleibt dem Browser
    });

    it("jeder keydown prüft den Merker gegen den echten Zustand: stand der Cursor dabei woanders, verfällt er endgültig (auch wenn er später wieder exakt passt)", () => {
      const el = typedNote();
      el.setSelectionRange(1, 1); // z. B. Strg+A / Auswahl ohne pointerdown/Navigationstaste
      keydown(el, "a");
      el.setSelectionRange(3, 3); // Text und Cursor passen wieder zum Merker
      expect(el.value).toBe("ab→XYZ");
      expect(keydown(el, "Backspace").defaultPrevented).toBe(false);
    });

    it.each(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"])(
      "Navigationstaste %s lässt den Merker verfallen (auch wenn der Cursor danach wieder exakt dort steht)",
      (key) => {
        const el = typedNote();
        // jsdom bewegt den Cursor bei einem synthetischen keydown NICHT: Text und
        // Cursor passen danach weiterhin zum Merker – nur der Verfall durch die
        // Taste selbst verhindert die Rücknahme.
        keydown(el, key);
        expect(keydown(el, "Backspace").defaultPrevented).toBe(false);
      }
    );

    it("Merker verfällt bei blur (Escape, Klick in ein anderes Post-it …)", () => {
      const el = typedNote();
      el.focus();
      act(() => el.blur());
      expect(keydown(el, "Backspace").defaultPrevented).toBe(false);
    });

    it("Merker verfällt bei pointerdown im Feld (Klick/Touch bewegt den Cursor)", () => {
      const el = typedNote();
      act(() => { el.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
      expect(keydown(el, "Backspace").defaultPrevented).toBe(false);
    });

    it("Merker verfällt bei Tab (Tab im Tab-Zweig, VOR dessen onChange): auch wenn der Text danach unverändert zum Merker passt", () => {
      const el = typedNote("");
      frozen = true; // Tab meldet den Einzug, der State übernimmt ihn NICHT -> Text/Cursor passen weiter zum Merker
      const tab = keydown(el, "Tab");
      expect(tab.defaultPrevented).toBe(true);
      expect(lastText()).toBe("ab→\t");
      expect(el.value).toBe("ab→");
      expect(keydown(el, "Backspace").defaultPrevented).toBe(false);
    });

    it("Merker verfällt, wenn note.text von außen geändert wurde – auch wenn der Text später wieder zum Merker passt", () => {
      const el = typedNote("");
      act(() => api.setNotes([note("n1", "REMOTE")]));
      act(() => api.setNotes([note("n1", "ab→")])); // identischer Text, Cursor wieder am Ende (3)
      expect(el.value).toBe("ab→");
      expect(sel(el)).toEqual([3, 3]);
      expect(keydown(el, "Backspace").defaultPrevented).toBe(false);
    });

    it("keydown mit key 'Unidentified' (Android-Bildschirmtastatur) lässt den Merker bestehen – die Rücknahme kommt dann über beforeinput", () => {
      const el = typedNote();
      const k = keydown(el, "Unidentified", { keyCode: 229 });
      expect(k.defaultPrevented).toBe(false);
      const ev = beforeInput(el, "deleteContentBackward");
      expect(ev.defaultPrevented).toBe(true);
      expect(el.value).toBe("ab->XYZ");
    });
  });

  describe("Strg/Cmd+Z im Fallback (der native Undo-Stack ist dort leer)", () => {
    const typedNote = () => {
      const [el] = mount([note("n1", "XYZ")]);
      el.setSelectionRange(0, 0);
      typeText(el, "ab->");
      return el;
    };

    it("Strg+Z direkt nach der Ersetzung nimmt sie zurück (preventDefault)", () => {
      const el = typedNote();
      const ev = keydown(el, "z", { ctrlKey: true });
      expect(ev.defaultPrevented).toBe(true);
      expect(el.value).toBe("ab->XYZ");
      expect(sel(el)).toEqual([4, 4]);
    });

    it("Cmd+Z (metaKey) genauso; großes 'Z' bei Feststelltaste ebenfalls", () => {
      let el = typedNote();
      expect(keydown(el, "z", { metaKey: true }).defaultPrevented).toBe(true);
      expect(el.value).toBe("ab->XYZ");
      act(() => root.unmount()); container.remove();
      el = typedNote();
      expect(keydown(el, "Z", { ctrlKey: true }).defaultPrevented).toBe(true);
    });

    it("Strg+Umschalt+Z (Redo), Strg+Alt+Z und Strg+Z während einer Komposition bleiben unangetastet", () => {
      const el = typedNote();
      expect(keydown(el, "z", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
      expect(keydown(el, "z", { ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
      expect(keydown(el, "z", { ctrlKey: true, isComposing: true }).defaultPrevented).toBe(false);
      expect(el.value).toBe("ab→XYZ");
      // der Merker ist dadurch nicht verbraucht
      expect(keydown(el, "z", { ctrlKey: true }).defaultPrevented).toBe(true);
    });

    it("ohne gültigen Merker bleibt Strg+Z unangetastet (kein preventDefault, kein onChange)", () => {
      const [el] = mount([note("n1", "abc")]);
      const ev = keydown(el, "z", { ctrlKey: true });
      expect(ev.defaultPrevented).toBe(false);
      expect(calls).toHaveLength(0);
    });

    it("ein zweites Strg+Z nach der Rücknahme bleibt unangetastet", () => {
      const el = typedNote();
      keydown(el, "z", { ctrlKey: true });
      expect(keydown(el, "z", { ctrlKey: true }).defaultPrevented).toBe(false);
    });
  });

  describe("Live-Konfiguration (useMemo über die Prop autocorrect)", () => {
    it("Master-Schalter aus -> '->' bleibt; wieder an -> '→'", () => {
      const [el] = mount([note("n1", "")], { enabled: true, categories: {}, custom: [] });
      typeText(el, "->");
      expect(el.value).toBe("→");
      act(() => api.setAc({ enabled: false, categories: {}, custom: [] }));
      typeText(el, "->");
      expect(el.value).toBe("→->");
      act(() => api.setAc({ enabled: true, categories: {}, custom: [] }));
      typeText(el, " ->");
      expect(el.value).toBe("→-> →");
    });

    it("Kategorie 'pfeile' aus -> '->' bleibt, '(c)' wird weiter zu '©'", () => {
      const [el] = mount([note("n1", "")], { enabled: true, categories: { pfeile: false }, custom: [] });
      typeText(el, "->(c)");
      expect(el.value).toBe("->©");
    });

    it("eigene Ersetzung wirkt sofort, ohne Neu-Mounten (btw -> übrigens)", () => {
      const [el] = mount([note("n1", "")], undefined);
      typeText(el, "btw ");
      expect(el.value).toBe("btw ");
      act(() => api.setAc({ enabled: true, categories: {}, custom: [{ trigger: "btw", replacement: "übrigens" }] }));
      typeText(el, "btw");
      expect(el.value).toBe("btw übrigens");
    });

    it("Anführungszeichen-Kategorie (default AUS) wirkt erst nach dem Einschalten: öffnend am Anfang, schließend nach dem Wort", () => {
      const [el] = mount([note("n1", "")]);
      typeText(el, '"a"');
      expect(el.value).toBe('"a"');
      act(() => api.setAc(QUOTE_CFG));
      el.setSelectionRange(el.value.length, el.value.length);
      typeText(el, ' "b"');
      expect(el.value).toBe('"a" „b“');
    });
  });

  it("Hook-Reihenfolge: erst KEIN Post-it, dann eins, dann wieder keins – kein React-Fehler", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mount([]);
    expect(container.querySelectorAll("textarea")).toHaveLength(0);
    act(() => api.setNotes([note("n1", "")]));
    const [el] = container.querySelectorAll("textarea");
    typeText(el, "->");
    expect(el.value).toBe("→");
    act(() => api.setNotes([]));
    expect(container.querySelectorAll("textarea")).toHaveLength(0);
    act(() => api.setNotes([note("n2", "")]));
    const [el2] = container.querySelectorAll("textarea");
    typeText(el2, "(c)");
    expect(el2.value).toBe("©");
    expect(err).not.toHaveBeenCalled();
  });

  it("die Regeln werden EINMAL gebaut und überleben den Wechsel 0 -> 1 -> 0 -> 1 Post-its: der useMemo-Hook steht VOR dem frühen return", () => {
    // React 19 wirft bei diesem Muster (QuickNotes hat keinen anderen Hook)
    // NICHT "Rendered more/fewer hooks" – ein Hook hinter dem return würde
    // stillschweigend bei jedem Wechsel 0 -> 1 neu angelegt. Beobachtbar ist das
    // nur an der Lebensdauer des Memos: die Regeln würden neu kompiliert.
    const before = buildActiveRules.mock.calls.length;
    mount([]);
    act(() => api.setNotes([note("n1", "")]));
    act(() => api.setNotes([]));
    act(() => api.setNotes([note("n2", "")]));
    expect(buildActiveRules.mock.calls.length - before).toBe(1);
  });

  it("zwei Post-its sind unabhängig: Ersetzung/Rücknahme in A berührt B nicht und umgekehrt", () => {
    const [a, b] = mount([note("a", ""), note("b", "xyz")]);
    typeText(a, "ab->");
    typeText(b, "!");
    expect(a.value).toBe("ab→");
    expect(b.value).toBe("xyz!");
    // Backspace in B: kein Merker dort -> normal, und A's Merker bleibt unberührt
    expect(keydown(b, "Backspace").defaultPrevented).toBe(false);
    expect(keydown(a, "Backspace").defaultPrevented).toBe(true);
    expect(a.value).toBe("ab->");
    expect(b.value).toBe("xyz!");
    // Ersetzung in B, Rücknahme in A schlägt fehl (Merker war verbraucht)
    typeText(b, "->");
    expect(b.value).toBe("xyz!→");
    expect(keydown(a, "Backspace").defaultPrevented).toBe(false);
    expect(keydown(b, "Backspace").defaultPrevented).toBe(true);
    expect(b.value).toBe("xyz!->");
  });

  it("Regression zur entfernten deps-Liste des Layout-Effects: ergibt die Ersetzung den VORHERIGEN Prop-Text, steht der Cursor trotzdem richtig (statt am Textende)", () => {
    // Text „x und noch mehr, erstes Zeichen markiert, " getippt: das Feld hat
    // kurz '"x …', die Regel macht wieder „ – Ergebnis == alter Prop-Wert.
    const text = "„x und noch mehr";
    const [el] = mount([note("n1", text)], QUOTE_CFG);
    el.setSelectionRange(0, 1);
    insert(el, '"');
    expect(el.value).toBe(text);
    // mit dem alten [note.text]-deps-Array bliebe der Cursor am Textende (16)
    expect(sel(el)).toEqual([1, 1]);
    expect(lastText()).toBe(text);
  });

  it("der Zustandsweg schreibt den Wert über React (Gegenprobe zum nativen Pfad unten)", () => {
    const setter = vi.spyOn(HTMLTextAreaElement.prototype, "value", "set");
    const [el] = mount([note("n1", "")]);
    typeText(el, "ab-");
    const before = setter.mock.calls.length;
    typeText(el, ">");
    expect(el.value).toBe("ab→");
    expect(setter.mock.calls.length).toBeGreaterThan(before);
  });
});

// Chromium-Verhalten für ein <textarea>: insertText ersetzt die Auswahl (Cursor
// dahinter) und feuert ein verschachteltes input-Event; undo holt den Vorwert
// zurück, markiert die zurückgeholte Spanne und feuert historyUndo. Wert
// wird über den PROTOTYP-Setter gesetzt (wie der Browser selbst) – Reacts
// Value-Tracker sieht die Änderung und feuert onChange.
function installExec({ insertText, undo } = {}) {
  const stack = [];
  document.execCommand = vi.fn((cmd, _ui, arg) => {
    const el = document.activeElement;
    if (cmd === "insertText") {
      if (insertText) return insertText(el, arg, stack);
      stack.push({ value: el.value, start: el.selectionStart, end: el.selectionEnd });
      el.setRangeText(arg, el.selectionStart, el.selectionEnd, "end");
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: arg }));
      return true;
    }
    if (cmd === "undo") {
      if (undo) return undo(el, stack);
      const prev = stack.pop();
      if (!prev) return false;
      nativeSetter.call(el, prev.value);
      el.setSelectionRange(prev.start, prev.end);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "historyUndo" }));
      return true;
    }
    return false;
  });
  return document.execCommand;
}

describe("AutoKorrektur im Post-it: NATIVER Pfad (execCommand gestubbt, Feld fokussiert)", () => {
  // Post-it mit Text 'XYZ', Cursor davor: die Ersetzung steht mitten im Text
  const focused = (ac) => {
    const [el] = mount([note("n1", "XYZ")], ac);
    el.focus();
    el.setSelectionRange(0, 0);
    return el;
  };
  const execCalls = (name) => document.execCommand.mock.calls.filter((c) => c[0] === name);

  it("Ersetzung: execCommand('insertText', false, '→') genau EINMAL, Endwert 'ab→XYZ', Cursor 3, der Rohtext wird nie gemeldet", () => {
    installExec();
    const setter = vi.spyOn(HTMLTextAreaElement.prototype, "value", "set");
    const el = focused();
    typeText(el, "ab-");
    const writesBefore = setter.mock.calls.length;

    typeText(el, ">");

    expect(execCalls("insertText")).toEqual([["insertText", false, "→"]]);
    expect(el.value).toBe("ab→XYZ");
    expect(sel(el)).toEqual([3, 3]); // nicht das Textende (6)
    expect(reported()).not.toContain("ab->XYZ");
    expect(lastText()).toBe("ab→XYZ");
    // React hat den Wert NICHT selbst geschrieben – die Änderung kam vom Browser
    expect(setter.mock.calls.length).toBe(writesBefore);
  });

  it("das verschachtelte input-Event aus execCommand wird nur weitergereicht: kein zweites Matching (Regel 'b→' -> 'X' darf nicht feuern)", () => {
    installExec();
    const cfg = { enabled: true, categories: {}, custom: [{ trigger: "b→", replacement: "X" }] };
    const el = focused(cfg);
    typeText(el, "ab->");
    // Ein zweites Matching auf dem verschachtelten Event ('b→') würde 'aXXYZ' liefern
    expect(el.value).toBe("ab→XYZ");
    expect(execCalls("insertText")).toHaveLength(1);
    // verschachteltes und äußeres Event melden denselben Text; nie der Rohtext
    expect(reported().filter((t) => t === "ab→XYZ").length).toBeGreaterThanOrEqual(1);
    expect(reported()).not.toContain("ab->XYZ");
  });

  it("Backspace direkt danach: execCommand('undo'), Wert 'ab->XYZ', Cursor auf 4 KOLLABIERT (Chromium markiert den Rohtext), State synchron", () => {
    installExec();
    const el = focused();
    typeText(el, "ab->");
    expect(document.execCommand.mock.calls.map((c) => c[0])).toEqual(["insertText"]);

    const ev = keydown(el, "Backspace");

    expect(ev.defaultPrevented).toBe(true);
    expect(execCalls("undo")).toHaveLength(1);
    expect(el.value).toBe("ab->XYZ");
    expect(sel(el)).toEqual([4, 4]); // der Stub markiert 2..4 wie Chromium
    expect(lastText()).toBe("ab->XYZ");
    // zweites Backspace: kein Merker mehr, kein weiterer undo
    expect(keydown(el, "Backspace").defaultPrevented).toBe(false);
    expect(execCalls("undo")).toHaveLength(1);
  });

  it("Rücknahme per beforeinput (Android) nutzt ebenfalls den nativen Undo", () => {
    installExec();
    const el = focused();
    typeText(el, "ab->");
    const ev = beforeInput(el, "deleteContentBackward");
    expect(ev.defaultPrevented).toBe(true);
    expect(execCalls("undo")).toHaveLength(1);
    expect(el.value).toBe("ab->XYZ");
    expect(sel(el)).toEqual([4, 4]);
  });

  it("nicht abbrechbares beforeinput (cancelable:false) ruft KEINEN nativen Undo auf – sonst liefe Undo UND Browser-Löschung", () => {
    installExec();
    const el = focused();
    typeText(el, "ab->");
    const ev = beforeInput(el, "deleteContentBackward", { cancelable: false });
    expect(ev.defaultPrevented).toBe(false);
    expect(execCalls("undo")).toHaveLength(0);
    expect(el.value).toBe("ab→XYZ");
    // der Merker ist unverbraucht: das abbrechbare Ereignis nimmt nativ zurück
    expect(beforeInput(el, "deleteContentBackward").defaultPrevented).toBe(true);
    expect(execCalls("undo")).toHaveLength(1);
    expect(el.value).toBe("ab->XYZ");
  });

  it("Rücknahme per beforeinput läuft wirklich nativ: React schreibt den Wert nicht selbst (jedes verschachtelte input-Event wird weitergereicht)", () => {
    installExec();
    // VOR dem Mount, sonst sieht der Spy Reacts Schreibzugriffe nicht
    const setter = vi.spyOn(HTMLTextAreaElement.prototype, "value", "set");
    const el = focused();
    typeText(el, "ab->");
    const writes = setter.mock.calls.length;

    expect(beforeInput(el, "deleteContentBackward").defaultPrevented).toBe(true);

    expect(el.value).toBe("ab->XYZ");
    // Wird das verschachtelte historyUndo-Event NICHT an onChange weitergereicht,
    // setzt React den Wert auf den alten Prop-Wert zurück (ein Schreibzugriff),
    // der native Undo gilt als gescheitert und der Zustandsweg übernimmt.
    // Endwert und Cursor wären in beiden Fällen gleich – der Setter-Zähler nicht.
    expect(setter.mock.calls.length).toBe(writes);
    expect(execCalls("undo")).toHaveLength(1);
  });

  it("Strg+Z / Cmd+Z werden auf dem nativen Pfad NICHT abgefangen (der Browser nimmt genau die Ersetzung zurück)", () => {
    installExec();
    const el = focused();
    typeText(el, "ab->");
    expect(keydown(el, "z", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(keydown(el, "z", { metaKey: true }).defaultPrevented).toBe(false);
    expect(execCalls("undo")).toHaveLength(0);
    expect(el.value).toBe("ab→XYZ");
  });

  it("Feld nicht fokussiert -> Zustandsweg: execCommand nie aufgerufen, Ergebnis trotzdem 'ab→XYZ' mit Cursor 3", () => {
    installExec();
    const [el] = mount([note("n1", "XYZ")]);
    el.setSelectionRange(0, 0); // bewusst OHNE focus()
    typeText(el, "ab->");
    expect(document.execCommand).not.toHaveBeenCalled();
    expect(el.value).toBe("ab→XYZ");
    expect(sel(el)).toEqual([3, 3]);
    expect(reported()).not.toContain("ab->XYZ");
  });

  it("execCommand liefert false -> Zustandsweg liefert trotzdem 'ab→XYZ' (Cursor 3); Strg+Z wird dann abgefangen", () => {
    installExec({ insertText: () => false });
    const el = focused();
    typeText(el, "ab->");
    expect(execCalls("insertText")).toHaveLength(1);
    expect(el.value).toBe("ab→XYZ");
    expect(sel(el)).toEqual([3, 3]);
    expect(reported()).not.toContain("ab->XYZ");
    // Merker steht auf native:false -> Strg+Z wird über den Zustand zurückgenommen
    expect(keydown(el, "z", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(el.value).toBe("ab->XYZ");
    expect(sel(el)).toEqual([4, 4]);
    expect(execCalls("undo")).toHaveLength(0);
  });

  it("execCommand wirft -> Zustandsweg, kein Fehler, Endtext richtig", () => {
    installExec({ insertText: () => { throw new Error("nicht erlaubt"); } });
    const el = focused();
    expect(() => typeText(el, "ab->")).not.toThrow();
    expect(el.value).toBe("ab→XYZ");
    expect(sel(el)).toEqual([3, 3]);
  });

  it("execCommand verändert den Wert UNERWARTET -> Zustandsweg repariert auf den berechneten Zieltext (nicht auf den fremden Wert)", () => {
    installExec({
      insertText: (el, arg) => {
        el.setRangeText(arg + "??", el.selectionStart, el.selectionEnd, "end");
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: arg }));
        return true;
      },
    });
    const el = focused();
    typeText(el, "ab->");
    expect(el.value).toBe("ab→XYZ");
    expect(sel(el)).toEqual([3, 3]);
    expect(lastText()).toBe("ab→XYZ"); // der letzte gemeldete Stand ist der richtige
  });

  it("nativer Undo scheitert (liefert false) -> Zustandsweg nimmt trotzdem zurück", () => {
    installExec({ undo: () => false });
    const el = focused();
    typeText(el, "ab->");
    expect(el.value).toBe("ab→XYZ");
    const ev = keydown(el, "Backspace");
    expect(ev.defaultPrevented).toBe(true);
    expect(execCalls("undo")).toHaveLength(1);
    expect(el.value).toBe("ab->XYZ");
    expect(sel(el)).toEqual([4, 4]);
    expect(lastText()).toBe("ab->XYZ");
  });

  it("nativer Undo verändert den Wert unerwartet -> Zustandsweg stellt den berechneten Vorzustand her", () => {
    installExec({
      undo: (el) => {
        nativeSetter.call(el, "völlig was anderes");
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "historyUndo" }));
        return true;
      },
    });
    const el = focused();
    typeText(el, "ab->");
    keydown(el, "Backspace");
    expect(el.value).toBe("ab->XYZ");
    expect(lastText()).toBe("ab->XYZ");
    expect(sel(el)).toEqual([4, 4]);
  });

  // insertText-Stub mit Protokoll: welche Auswahl stand beim Aufruf? (Sonst
  // sähe der Test nur den Endwert, nicht was der Browser-Befehl umfasste.)
  const recordingInsert = (seen) => (el, arg, stack) => {
    seen.push({ arg, sel: [el.selectionStart, el.selectionEnd] });
    stack.push({ value: el.value, start: el.selectionStart, end: el.selectionEnd });
    el.setRangeText(arg, el.selectionStart, el.selectionEnd, "end");
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: arg }));
    return true;
  };

  describe("Enter als Abschlusszeichen: der Umbruch gehört NICHT in den nativen Befehl", () => {
    // Chromium 154 (echte Komponente, echte Tasten): steckt der getippte
    // Umbruch im insertText-Befehl, wiederholt Strg+Y ihn falsch – "a --"+Enter
    // -> Strg+Z -> Strg+Y lieferte "a –" (Umbruch weg), bei "\alpha"+Enter ging
    // das Symbol verloren. Ein jsdom-Stub kann den Redo-Fehler nicht zeigen;
    // gepinnt wird deshalb die Ursache: was der Befehl umfasst.
    it("'\\alpha' + Enter mitten im Text: der Befehl ersetzt NUR '\\alpha' (0..6) durch 'α', Umbruch bleibt unberührt, Cursor dahinter", () => {
      const seen = [];
      installExec({ insertText: recordingInsert(seen) });
      const el = focused();
      typeText(el, "\\alpha\n");
      expect(seen).toEqual([{ arg: "α", sel: [0, 6] }]);
      expect(el.value).toBe("α\nXYZ");
      expect(sel(el)).toEqual([2, 2]); // hinter dem Umbruch, nicht davor (1)
      expect(lastText()).toBe("α\nXYZ");
      expect(reported()).not.toContain("\\alpha\nXYZ"); // der Rohtext erreicht den State nie
    });

    it("Normalfall am Textende: 'a --' + Enter -> Befehl auf 2..4 mit '–', Wert 'a –⏎', Cursor 4", () => {
      const seen = [];
      installExec({ insertText: recordingInsert(seen) });
      const [el] = mount([note("n1", "")]);
      el.focus();
      typeText(el, "a --\n");
      expect(seen).toEqual([{ arg: "–", sel: [2, 4] }]);
      expect(el.value).toBe("a –\n");
      expect(sel(el)).toEqual([4, 4]);
      expect(lastText()).toBe("a –\n");
      expect(reported()).not.toContain("a --\n");
    });

    it("mit Text davor in der Zeile und einer Zeile darüber: 'foo⏎' dann '\\alpha' + Enter -> Befehl nur auf die Symbolspanne", () => {
      const seen = [];
      installExec({ insertText: recordingInsert(seen) });
      const [el] = mount([note("n1", "")]);
      el.focus();
      typeText(el, "foo\n\\alpha\n");
      expect(seen).toEqual([{ arg: "α", sel: [4, 10] }]);
      expect(el.value).toBe("foo\nα\n");
      expect(sel(el)).toEqual([6, 6]);
    });

    it("Leerzeichen als Abschlusszeichen bleibt unverändert im Befehl-Umfang: '\\alpha' + Leerzeichen -> Befehl auf 0..6 mit 'α ' (kein Umbruch im Spiel)", () => {
      const seen = [];
      installExec({ insertText: recordingInsert(seen) });
      const el = focused();
      typeText(el, "\\alpha ");
      // Abschlusszeichen Leerzeichen: das Zeichen steckt weiter im Befehl (nur ein
      // getippter UMBRUCH wird ausgeklammert) – Verhalten wie vor der Änderung
      expect(seen).toEqual([{ arg: "α ", sel: [0, 7] }]);
      expect(el.value).toBe("α XYZ");
      expect(sel(el)).toEqual([2, 2]);
    });

    it("Strg+Z (Browser-Undo im Stub) nach 'a --' + Enter: '--' markiert, Umbruch dahinter -> Cursor HINTER den Umbruch (5), nicht mitten in die Zeile", () => {
      installExec();
      const [el] = mount([note("n1", "")]);
      el.focus();
      typeText(el, "a --\n");
      expect(el.value).toBe("a –\n");
      act(() => { document.execCommand("undo"); }); // wie ein natives Strg+Z des Browsers
      expect(el.value).toBe("a --\n");
      // ohne den Umbruch-Kollaps bliebe '--' (2..4) markiert und das nächste Zeichen überschriebe es
      expect(sel(el)).toEqual([5, 5]);
      expect(lastText()).toBe("a --\n");
      // ein neu getipptes Zeichen hängt hinter dem Umbruch an
      typeText(el, "x");
      expect(el.value).toBe("a --\nx");
    });

    it("Backspace-Rücknahme nach 'a --' + Enter: nativer Undo, Wert 'a --⏎', Cursor 5, State synchron; zweites Backspace normal", () => {
      installExec();
      const [el] = mount([note("n1", "")]);
      el.focus();
      typeText(el, "a --\n");
      const ev = keydown(el, "Backspace");
      expect(ev.defaultPrevented).toBe(true);
      expect(execCalls("undo")).toHaveLength(1);
      expect(el.value).toBe("a --\n");
      expect(sel(el)).toEqual([5, 5]);
      expect(lastText()).toBe("a --\n");
      expect(keydown(el, "Backspace").defaultPrevented).toBe(false);
      expect(execCalls("undo")).toHaveLength(1);
    });

    it("Backspace-Rücknahme nach '\\alpha' + Enter mitten im Text: Rohtext samt Umbruch, Cursor dahinter (7)", () => {
      installExec();
      const el = focused();
      typeText(el, "\\alpha\n");
      expect(el.value).toBe("α\nXYZ");
      expect(keydown(el, "Backspace").defaultPrevented).toBe(true);
      expect(el.value).toBe("\\alpha\nXYZ");
      expect(sel(el)).toEqual([7, 7]);
      expect(lastText()).toBe("\\alpha\nXYZ");
    });

    it("Fallback (execCommand liefert false) mit Enter: Zustandsweg setzt den kompletten Text inkl. Umbruch, Cursor dahinter; Strg+Z nimmt über den Zustand zurück", () => {
      installExec({ insertText: () => false });
      const [el] = mount([note("n1", "")]);
      el.focus();
      typeText(el, "a --\n");
      expect(el.value).toBe("a –\n");
      expect(sel(el)).toEqual([4, 4]);
      expect(reported()).not.toContain("a --\n");
      expect(keydown(el, "z", { ctrlKey: true }).defaultPrevented).toBe(true);
      expect(el.value).toBe("a --\n");
      expect(sel(el)).toEqual([5, 5]);
    });

    it("Gegenprobe: ein Ersatz mit INNEREM Umbruch (Custom-Regel aus state.json) läuft nie nativ, der Zustandsweg liefert den richtigen Text", () => {
      installExec();
      const cfg = { enabled: true, categories: {}, custom: [{ trigger: "zz", replacement: "x\ny" }] };
      const [el] = mount([note("n1", "")], cfg);
      el.focus();
      typeText(el, "zz");
      expect(document.execCommand).not.toHaveBeenCalled(); // mehrzeiliger insertText = dasselbe Redo-Risiko
      expect(el.value).toBe("x\ny");
      expect(sel(el)).toEqual([3, 3]);
      expect(reported()).not.toContain("zz");
      // Gegenprobe zur Gegenprobe: derselbe Trigger MIT einzeiligem Ersatz läuft nativ
      act(() => root.unmount());
      container.remove();
      const cfg1 = { enabled: true, categories: {}, custom: [{ trigger: "zz", replacement: "xy" }] };
      const [el1] = mount([note("n1", "")], cfg1);
      el1.focus();
      typeText(el1, "zz");
      expect(execCalls("insertText")).toEqual([["insertText", false, "xy"]]);
      expect(el1.value).toBe("xy");
    });

    // Testlücke aus dem Review: ein Ersatz, der auf einen Umbruch ENDET, ohne
    // dass ein Enter getippt wurde (raw "zz" endet nicht auf "\n"). Der
    // Umbruch-Ausschluss (nl) gilt nur für ein GETIPPTES Enter; hier gehört der
    // Umbruch zum Ersatz selbst und damit zum mehrzeiligen Fall: nie nativ.
    // Der Mutant `nl = edit.insert.endsWith("\n") ? 1 : 0` (ohne raw-Bedingung)
    // würde "x" nativ über die Spanne 0..1 schreiben (execCommand aufgerufen,
    // Umbruch nicht mitersetzt) – dieser Test wird dann rot.
    // Die Regel kommt NICHT über die Konfiguration: sanitizeAutocorrectConfig
    // trimmt custom-Ersetzungen ("x\n" -> "x"), ein Ersatz mit Umbruch am Ende
    // ist über state.json also nicht erreichbar. handleChange soll trotzdem
    // nicht davon abhängen (Netz gegen eine spätere Regel-Quelle) – deshalb wird
    // die Regelliste über den buildActiveRules-Spy (Kopf der Datei) eingeschleust.
    it("Ersatz endet auf Umbruch OHNE getipptes Enter (Regel 'zz' -> 'x⏎'): execCommand nie aufgerufen, Zustandsweg, Cursor hinter dem Umbruch", () => {
      installExec();
      buildActiveRules.mockImplementationOnce(() => [
        { trigger: "zz", replacement: "x\n", kind: "text", find: /(zz)$/ },
      ]);
      const [el] = mount([note("n1", "")]);
      el.focus();
      typeText(el, "zz");
      expect(document.execCommand).not.toHaveBeenCalled();
      expect(el.value).toBe("x\n");
      expect(sel(el)).toEqual([2, 2]);
      expect(reported()).not.toContain("zz"); // der Rohtext wird nie gemeldet
      expect(reported()).toEqual(["z", "x\n"]); // nur der Zwischenstand 'z' und das Ergebnis
    });
  });

  it("Nicht-Tippen ruft execCommand nie auf (Paste, Komposition, Mehrzeichen-Text)", () => {
    installExec();
    const el = focused();
    el.setSelectionRange(0, 0);
    insert(el, "->", { inputType: "insertFromPaste", data: null });
    insert(el, "->", { data: "->" });
    insert(el, ">", { inputType: "insertCompositionText", isComposing: true });
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  describe("historyUndo: Chromium markiert den zurückgeholten Rohtext -> auf einen Cursor kollabieren", () => {
    // Emuliert das input-Event nach einem nativen Strg+Z: Wert wechselt, die
    // Spanne [s, e) ist markiert, inputType historyUndo.
    const undoEvent = (el, value, s, e) => {
      act(() => {
        nativeSetter.call(el, value);
        el.setSelectionRange(s, e);
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "historyUndo" }));
      });
    };

    it("Markierung 2..4 über '->' in 'ab->' -> Cursor bei 4", () => {
      const [el] = mount([note("n1", "ab")]);
      undoEvent(el, "ab->", 2, 4);
      expect(el.value).toBe("ab->");
      expect(sel(el)).toEqual([4, 4]);
    });

    it("Terminator-Spanne 'a -- ' (2..5) kollabiert ebenfalls; Text hinter der Spanne bleibt", () => {
      const [el] = mount([note("n1", "a")]);
      undoEvent(el, "a -- Rest", 2, 5);
      expect(sel(el)).toEqual([5, 5]);
    });

    it("Enter als Abschlusszeichen: Markierung 2..4 über '--' in 'a --⏎Rest' -> Cursor HINTER dem Umbruch (5)", () => {
      // Der native Befehl umfasste den Umbruch nicht – Chromium markiert nach dem
      // Undo nur '--', der Umbruch steht dahinter.
      const [el] = mount([note("n1", "a")]);
      undoEvent(el, "a --\nRest", 2, 4);
      expect(el.value).toBe("a --\nRest");
      expect(sel(el)).toEqual([5, 5]);
    });

    it("Enter-Fall mit Symbol: Markierung 4..10 über '\\alpha' in 'foo⏎\\alpha⏎Rest' -> Cursor 11", () => {
      const [el] = mount([note("n1", "foo")]);
      undoEvent(el, "foo\n\\alpha\nRest", 4, 10);
      expect(sel(el)).toEqual([11, 11]);
    });

    it("umfasst die Markierung den Umbruch bereits ('--⏎', 2..5), kollabiert sie wie bisher hinter ihn", () => {
      const [el] = mount([note("n1", "a")]);
      undoEvent(el, "a --\nRest", 2, 5);
      expect(sel(el)).toEqual([5, 5]);
    });

    it("KEIN Umbruch-Kollaps, wenn hinter '--' kein Umbruch folgt ('a --Rest') oder es kein Trigger ist", () => {
      const [el] = mount([note("n1", "a")]);
      undoEvent(el, "a --Rest", 2, 4);
      expect(sel(el)).toEqual([2, 4]); // '--' ohne Abschlusszeichen ist kein Trigger
      undoEvent(el, "ab\nRest", 0, 2);
      expect(sel(el)).toEqual([0, 2]); // Umbruch dahinter, aber 'ab' + Enter ist kein Trigger
    });

    it("mit ausgeschalteten Regeln bleibt auch die Markierung vor einem Umbruch bestehen", () => {
      const [el] = mount([note("n1", "a")], { enabled: false, categories: {}, custom: [] });
      undoEvent(el, "a --\nRest", 2, 4);
      expect(sel(el)).toEqual([2, 4]);
    });

    it("eine Markierung über NICHT-Trigger-Text bleibt bestehen (fremde Undo-Schritte werden nicht angefasst)", () => {
      const [el] = mount([note("n1", "ab")]);
      undoEvent(el, "ab->", 1, 4);
      expect(sel(el)).toEqual([1, 4]);
      undoEvent(el, "abc def", 0, 3);
      expect(sel(el)).toEqual([0, 3]);
    });

    it("mit ausgeschalteten Regeln ist nichts ein Trigger: die Markierung bleibt", () => {
      const [el] = mount([note("n1", "ab")], { enabled: false, categories: {}, custom: [] });
      undoEvent(el, "ab->", 2, 4);
      expect(sel(el)).toEqual([2, 4]);
    });

    it("das historyUndo-Ergebnis selbst wird nie ersetzt, auch wenn es auf einen Trigger endet", () => {
      const [el] = mount([note("n1", "ab")]);
      undoEvent(el, "ab->", 2, 4);
      expect(el.value).toBe("ab->");
      expect(lastText()).toBe("ab->");
    });
  });
});

// ---------------------------------------------------------------------------
// Drift-Schutz gegen den ECHTEN Dokument-Editor: dieselben Eingaben Zeichen für
// Zeichen durch TipTap (mit denselben buildActiveRules) und durch die
// textarea-Bibliothek müssen denselben Text ergeben. Der Editor-Test
// (docEditorAutocorrect.test.jsx) pinnt Erwartungswerte; diese Gegenprobe
// stellt sicher, dass beide Implementierungen nicht auseinanderlaufen.
// ---------------------------------------------------------------------------
describe("Parität zum echten TipTap-Editor (selbe Regeln, selbe Eingaben, Zeichen für Zeichen)", () => {
  function buildEditor(config) {
    return new Editor({
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, blockquote: false }),
        FencedCodeBlock,
        AutoCorrect.configure({ rules: buildActiveRules(config) }),
        Markdown.configure({ html: true, bulletListMarker: "-", tightLists: true }),
      ],
      content: "<p></p>",
    });
  }
  function editorTyped(editor, text) {
    editor.commands.setContent("<p></p>");
    editor.commands.focus("end");
    for (const ch of text) {
      const { from, to } = editor.state.selection;
      const handled = editor.view.someProp("handleTextInput", (f) => f(editor.view, from, to, ch));
      if (!handled) editor.view.dispatch(editor.view.state.tr.insertText(ch, from, to));
    }
    // Nur reine Absätze vergleichen: der Editor macht aus "- ", "+ ", "1. " am
    // Zeilenanfang eine Liste (StarterKit-Markdown-Kurzbefehle) – das ist kein
    // AutoKorrektur-Verhalten und im textarea ohne Gegenstück.
    const { doc } = editor.state;
    if (doc.childCount !== 1 || doc.firstChild.type.name !== "paragraph") return null;
    return doc.textContent;
  }
  function textareaTyped(rules, text) {
    let t = "";
    for (const ch of text) {
      const raw = t + ch;
      const r = autocorrectTypedText(raw, raw.length, ch, rules);
      t = r ? r.text : raw;
    }
    return t;
  }

  it("Korpus inkl. Ketten, Brüchen, multiply, Symbolen, Smileys (Standard-Konfiguration)", () => {
    const corpus = [
      "Pfeil: -> Ziel", "Gedanke -- weiter", "---", "Bald...", "Copyright (c) 2026", "(a) erstens", "a != b", "a <= b",
      "Feld 2x3 cm", "Nummer 12x3", "2 x 3", "2x34", "nimm 1/2 Becher", "Ordner 13/24 bleibt", "11/2 ", "Hi :)",
      "Winkel \\alpha.", "Summe \\sum wert", "\\in \\int \\infty ", "Pfeil --> Ziel", "a -- b", "Trennlinie --- Ende",
      "Rueckpfeil <-- Start", "a <-> b", "a <== b", "a <=> b", "a ==> b", "Zitat: << Text", "x <3 y", "a ~= b +- c",
      "(tm) (r) (e) (deg)", "--x", "-->", "--->", "<-->", "<=>=",
    ];
    const editor = buildEditor(null);
    const rules = buildActiveRules(null);
    for (const input of corpus) {
      expect(textareaTyped(rules, input), input).toBe(editorTyped(editor, input));
    }
    editor.destroy();
  });

  it("Anführungszeichen (opt-in) und Konfigurationen (Kategorie aus, custom, custom überschreibt eingebaut)", () => {
    const configs = [
      [QUOTE_CFG, ['Er sagte "Hallo".', "'a' (\"b\") x\"c\"", '"', 'a "b" c']],
      [{ enabled: true, categories: { pfeile: false }, custom: [] }, ["Pfeil -> Ende (c) --> x"]],
      [{ enabled: true, categories: {}, custom: [{ trigger: "btw", replacement: "übrigens" }] }, ["Das ist btw wichtig."]],
      [{ enabled: true, categories: {}, custom: [{ trigger: "->", replacement: "⇢" }] }, ["a -> b --> c"]],
      [{ enabled: false, categories: {}, custom: [] }, ["Pfeil -> Ende (c)"]],
      // Abschalt-Trick (Ersatz == Trigger) bei Triggern MIT kürzerem Suffix-Trigger:
      // im Editor beendet der passende No-op-Treffer die Kette, das kürzere "->"/"=>"
      // darf nicht mehr greifen (sonst "a -→ b" statt "a --> b").
      [{ enabled: true, categories: {}, custom: [{ trigger: "-->", replacement: "-->" }] }, ["a --> b"]],
      [{ enabled: true, categories: {}, custom: [{ trigger: "<=>", replacement: "<=>" }] }, ["a <=> b"]],
      [{ enabled: true, categories: {}, custom: [{ trigger: "==>", replacement: "==>" }] }, ["a ==> b"]],
      [{ enabled: true, categories: {}, custom: [{ trigger: "<->", replacement: "<->" }] }, ["a <-> b"]],
    ];
    for (const [cfg, inputs] of configs) {
      const editor = buildEditor(cfg);
      const rules = buildActiveRules(cfg);
      for (const input of inputs) {
        expect(textareaTyped(rules, input), input).toBe(editorTyped(editor, input));
      }
      editor.destroy();
    }
  });

  it("Zufallsfolgen (fester Seed) über ein Trigger-Alphabet stimmen Zeichen für Zeichen mit dem Editor überein", () => {
    // deterministischer Zufall (LCG), damit ein Fehlschlag reproduzierbar ist
    let seed = 20260930;
    const rnd = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed % n; };
    const alphabet = ["-", "-", "<", ">", "=", "!", ".", ":", ")", "(", "c", "a", "3", "3", "1", "2", "/", "x", " ", " ", "\\", "+", "~", "e", "\"", "'"];
    const editorDefault = buildEditor(null);
    const editorQuote = buildEditor(QUOTE_CFG);
    const rulesDefault = buildActiveRules(null);
    const rulesQuote = buildActiveRules(QUOTE_CFG);
    let compared = 0;
    for (let i = 0; i < 90; i++) {
      let s = "";
      const len = 2 + rnd(13);
      for (let k = 0; k < len; k++) s += alphabet[rnd(alphabet.length)];
      const ed = editorTyped(editorDefault, s);
      const edQuote = editorTyped(editorQuote, s);
      if (ed !== null) { expect(textareaTyped(rulesDefault, s), JSON.stringify(s)).toBe(ed); compared++; }
      if (edQuote !== null) { expect(textareaTyped(rulesQuote, s), JSON.stringify(s)).toBe(edQuote); compared++; }
    }
    // die Gegenprobe darf nicht durch übersprungene Listen-Fälle ausgehöhlt sein
    expect(compared).toBeGreaterThan(100);
    editorDefault.destroy();
    editorQuote.destroy();
  }, 60000);
});
