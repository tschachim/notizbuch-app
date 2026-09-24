// @vitest-environment jsdom
//
// v7.56, Nutzerwunsch "in der Schnellnotiz mit Tab einrücken": Tab/
// Umschalt+Tab im Post-it-<textarea> rufen indentSelection() (siehe
// src/lib/textIndent.js, dort die reine Text-Logik) auf und setzen die
// Selektion nach dem Re-Render mit dem neuen (kontrollierten) Wert korrekt
// zurück (useLayoutEffect + Ref, siehe Kopfkommentar in QuickNotes.jsx).
// Muster (mount/unmount via react-dom/client + act, echte KeyboardEvents)
// wie tests/docEditorToolbarFocus.test.jsx / tests/settingsDialogForms.test.jsx.
import { describe, it, expect, vi, afterEach } from "vitest";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import QuickNotes from "../src/components/QuickNotes.jsx";

let container = null;
let root = null;

function baseNote(overrides = {}) {
  return { id: "n1", x: 20, y: 20, w: 220, h: 160, text: "abcdef", ...overrides };
}

function mount(notes, handlers = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const props = {
    notes,
    onChange: vi.fn(),
    onRemove: vi.fn(),
    onSubmit: vi.fn(),
    ...handlers,
  };
  act(() => { root.render(<QuickNotes {...props} />); });
  return { container, props };
}

function rerender(notes, props) {
  act(() => { root.render(<QuickNotes notes={notes} onChange={props.onChange} onRemove={props.onRemove} onSubmit={props.onSubmit} />); });
}

afterEach(() => {
  if (root) { act(() => root.unmount()); root = null; }
  if (container) { container.remove(); container = null; }
});

function keydown(el, key, opts = {}) {
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
  act(() => { el.dispatchEvent(ev); });
  return ev;
}

describe("QuickNotes: Tab rückt ein", () => {
  it("Tab an einer Cursorposition fügt '\\t' ein, onChange wird mit dem neuen Text aufgerufen, Event ist defaultPrevented", () => {
    const { container: c, props } = mount([baseNote({ text: "abcdef" })]);
    const el = c.querySelector("textarea");
    el.setSelectionRange(3, 3);

    const ev = keydown(el, "Tab");

    expect(ev.defaultPrevented).toBe(true);
    expect(props.onChange).toHaveBeenCalledTimes(1);
    expect(props.onChange).toHaveBeenCalledWith("n1", { text: "abc\tdef" });
  });

  it("nach dem Re-Render mit dem neuen (kontrollierten) Text steht die Selektion exakt hinter dem eingefügten Tab", () => {
    const { container: c, props } = mount([baseNote({ text: "abcdef" })]);
    const el = c.querySelector("textarea");
    el.setSelectionRange(3, 3);
    keydown(el, "Tab");

    // Der Aufrufer (App.jsx) übernimmt den von onChange gemeldeten Text in
    // den State – hier simuliert durch ein erneutes Rendern mit dem neuen
    // Text, exakt wie es die echte updateQuickNote()-Kette tut.
    rerender([baseNote({ text: "abc\tdef" })], props);

    expect(el.selectionStart).toBe(4);
    expect(el.selectionEnd).toBe(4);
  });

  it("Tab über eine Mehrzeilen-Auswahl rückt alle berührten Zeilen ein und die Selektion deckt sie danach weiter ab", () => {
    const text = "eins\nzwei";
    const { container: c, props } = mount([baseNote({ text })]);
    const el = c.querySelector("textarea");
    el.setSelectionRange(0, text.length);

    keydown(el, "Tab");

    expect(props.onChange).toHaveBeenCalledWith("n1", { text: "\teins\n\tzwei" });
    rerender([baseNote({ text: "\teins\n\tzwei" })], props);
    expect(el.selectionStart).toBe(0);
    expect(el.selectionEnd).toBe("\teins\n\tzwei".length);
  });

  it("rückwärts aufgezogene Auswahl (Anker unten, Fokus oben) behält ihre Richtung nach dem Tab (Regression: setSelectionRange ohne 3. Parameter setzt die Richtung auf 'none')", () => {
    // Nutzer markiert per Umschalt+Pfeil-hoch von unten nach oben: Anker
    // bleibt unten, Fokus wandert nach oben -> selectionDirection "backward".
    // Ohne den dritten Parameter beim Wiederherstellen würde die Richtung
    // nach dem Tab verlorengehen (jsdom liefert dann "none"), ein
    // anschließendes weiteres Umschalt+Pfeil-hoch würde die Auswahl am
    // falschen Ende verkleinern statt am oberen Ende erweitern.
    const text = "eins\nzwei";
    const { container: c, props } = mount([baseNote({ text })]);
    const el = c.querySelector("textarea");
    el.setSelectionRange(0, text.length, "backward");
    expect(el.selectionDirection).toBe("backward");

    keydown(el, "Tab");
    rerender([baseNote({ text: "\teins\n\tzwei" })], props);

    expect(el.selectionDirection).toBe("backward");
  });
});

describe("QuickNotes: Umschalt+Tab rückt aus", () => {
  it("entfernt den führenden Tab, onChange wird aufgerufen, Event ist defaultPrevented", () => {
    const { container: c, props } = mount([baseNote({ text: "\tabc" })]);
    const el = c.querySelector("textarea");
    el.setSelectionRange(4, 4);

    const ev = keydown(el, "Tab", { shiftKey: true });

    expect(ev.defaultPrevented).toBe(true);
    expect(props.onChange).toHaveBeenCalledWith("n1", { text: "abc" });
  });

  it("nach dem Re-Render steht der Cursor korrekt an der erwarteten Position (NICHT am Textende)", () => {
    // Regression: Cursor bewusst NICHT ans Textende legen ("abc".length === 3)
    // – jsdom setzt bei einem programmatischen value-Wechsel die Selektion
    // von sich aus ans Textende, ein Test mit Zielposition 3 wäre also auch
    // OHNE den useLayoutEffect grün und könnte einen Ausfall der
    // Selektions-Wiederherstellung nicht erkennen.
    const { container: c, props } = mount([baseNote({ text: "\tabc" })]);
    const el = c.querySelector("textarea");
    el.setSelectionRange(2, 2); // zwischen "a" (Index 1) und "b" (Index 2)
    keydown(el, "Tab", { shiftKey: true });

    rerender([baseNote({ text: "abc" })], props);
    expect(el.selectionStart).toBe(1);
    expect(el.selectionEnd).toBe(1);
  });

  it("Mehrzeilen-Outdent: Cursor-Wiederherstellung auch hier diskriminierend gegen den jsdom-Default (Textende)", () => {
    const text = "\teins\n\tzwei";
    const { container: c, props } = mount([baseNote({ text })]);
    const el = c.querySelector("textarea");
    el.setSelectionRange(0, text.length);
    keydown(el, "Tab", { shiftKey: true });

    const newText = "eins\nzwei";
    rerender([baseNote({ text: newText })], props);
    // jsdom-Default bei ausbleibendem setSelectionRange wäre newText.length
    // (9) für BEIDE Positionen – selStart 0 ist damit diskriminierend.
    expect(el.selectionStart).toBe(0);
    expect(el.selectionEnd).toBe(newText.length);
  });

  it("ohne vorhandenen Einzug: defaultPrevented bleibt true, aber onChange wird NICHT aufgerufen (nichts zu tun)", () => {
    const { container: c, props } = mount([baseNote({ text: "abc" })]);
    const el = c.querySelector("textarea");
    el.setSelectionRange(1, 1);

    const ev = keydown(el, "Tab", { shiftKey: true });

    expect(ev.defaultPrevented).toBe(true);
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("gemerkte Selektion wird verworfen, wenn der neue Text NICHT dem von onChange gemeldeten Text entspricht (z. B. ein zwischenzeitlicher Remote-Merge überschreibt note.text)", () => {
    const { container: c, props } = mount([baseNote({ text: "\tabc" })]);
    const el = c.querySelector("textarea");
    el.setSelectionRange(4, 4);
    keydown(el, "Tab", { shiftKey: true }); // meldet onChange("n1", { text: "abc" }), merkt Ziel-Selektion 3/3 FÜR "abc"

    // Der Aufrufer übernimmt NICHT den gemeldeten Text, sondern einen ganz
    // anderen (simuliert einen Remote-Merge, der note.text zwischenzeitlich
    // überschrieben hat, bevor der useLayoutEffect lief).
    rerender([baseNote({ text: "REMOTE-MERGE" })], props);

    // Ohne die Zieltext-Prüfung würde hier blind selectionRange(3, 3) auf
    // dem FALSCHEN Text gesetzt; mit ihr bleibt es beim jsdom-Standard nach
    // einem programmatischen value-Wechsel (Cursor am Textende).
    expect(el.selectionStart).toBe("REMOTE-MERGE".length);
    expect(el.selectionEnd).toBe("REMOTE-MERGE".length);
  });
});

describe("QuickNotes: Tab-Handler greift NUR bei reinem Tab/Umschalt+Tab", () => {
  it("Tab mit gedrückter Strg-Taste: weder preventDefault noch onChange (Fokuswechsel bleibt möglich)", () => {
    const { container: c, props } = mount([baseNote({ text: "abcdef" })]);
    const el = c.querySelector("textarea");
    el.setSelectionRange(3, 3);

    const ev = keydown(el, "Tab", { ctrlKey: true });

    expect(ev.defaultPrevented).toBe(false);
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("Tab mit gedrückter Alt-Taste: weder preventDefault noch onChange", () => {
    const { container: c, props } = mount([baseNote({ text: "abcdef" })]);
    const el = c.querySelector("textarea");
    const ev = keydown(el, "Tab", { altKey: true });
    expect(ev.defaultPrevented).toBe(false);
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("Tab mit gedrückter Meta/Cmd-Taste: weder preventDefault noch onChange", () => {
    const { container: c, props } = mount([baseNote({ text: "abcdef" })]);
    const el = c.querySelector("textarea");
    const ev = keydown(el, "Tab", { metaKey: true });
    expect(ev.defaultPrevented).toBe(false);
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("Tab während laufender IME-Komposition (isComposing): weder preventDefault noch onChange (e.isComposing existiert auf SyntheticEvent nicht, Prüfung läuft über nativeEvent)", () => {
    const { container: c, props } = mount([baseNote({ text: "abcdef" })]);
    const el = c.querySelector("textarea");
    el.setSelectionRange(3, 3);

    const ev = keydown(el, "Tab", { isComposing: true });

    expect(ev.defaultPrevented).toBe(false);
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("ein anderer Taste ('a') löst kein preventDefault aus", () => {
    const { container: c, props } = mount([baseNote({ text: "abcdef" })]);
    const el = c.querySelector("textarea");
    const ev = keydown(el, "a");
    expect(ev.defaultPrevented).toBe(false);
    expect(props.onChange).not.toHaveBeenCalled();
  });
});

// v7.56 Nachbesserung: Escape als Ausweg aus der Tab-Fokusfalle (WCAG
// 2.1.2 "No Keyboard Trap") – siehe DECISIONS #114.
describe("QuickNotes: Escape verlässt das Post-it (Ausweg aus der Tab-Fokusfalle)", () => {
  it("Escape ruft blur() auf das Feld auf (document.activeElement zeigt danach NICHT mehr auf das <textarea>), Text/Selektion unverändert, kein onChange", () => {
    const { container: c, props } = mount([baseNote({ text: "abcdef" })]);
    const el = c.querySelector("textarea");
    el.focus();
    expect(document.activeElement).toBe(el);
    el.setSelectionRange(2, 4);

    const ev = keydown(el, "Escape");

    expect(document.activeElement).not.toBe(el);
    expect(el.value).toBe("abcdef");
    expect(props.onChange).not.toHaveBeenCalled();
    // Escape ist bewusst kein "preventDefault"-Fall wie Tab (nichts an der
    // Standard-Bedienung zu verhindern, blur() reicht) – Review-Fix (🟢
    // Finding 4): explizit auf defaultPrevented===false statt der
    // wirkungslosen toBeTruthy()-Prüfung (ein KeyboardEvent ist immer
    // truthy), damit diese bewusste Entscheidung auch bei einem künftigen
    // versehentlichen preventDefault() fehlschlägt.
    expect(ev.defaultPrevented).toBe(false);
  });

  it("Escape mit gedrückter Umschalt-Taste verlässt das Feld ebenfalls (kein Sonderfall wie bei Tab)", () => {
    const { container: c, props } = mount([baseNote({ text: "abcdef" })]);
    const el = c.querySelector("textarea");
    el.focus();

    keydown(el, "Escape", { shiftKey: true });

    expect(document.activeElement).not.toBe(el);
    expect(props.onChange).not.toHaveBeenCalled();
  });
});
