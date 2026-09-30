// @vitest-environment jsdom
//
// v7.58: DOM-Helfer für die native Ersetzung/Rücknahme im Schnellnotiz-
// <textarea> (src/lib/nativeTextEdit.js, Präzedenz: tests/images-dom.test.js).
// jsdom kennt document.execCommand NICHT – die Tests stubben es so, wie es
// Chromium für ein <textarea> tut: insertText ersetzt die aktuelle Auswahl
// und feuert ein input-Event, undo stellt den Vorwert wieder her und markiert
// die zurückgeholte Spanne. Nicht getestet werden kann hier, ob ein echter
// Browser den Undo-Verlauf wirklich erhält – das bleibt Sache des E2E-Falls.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { replaceRangeNative, undoNative } from "../src/lib/nativeTextEdit.js";

let el = null;
let history = [];

function mountField(value, { focus = true } = {}) {
  el = document.createElement("textarea");
  document.body.appendChild(el);
  el.value = value;
  if (focus) el.focus();
  return el;
}

// Stub wie Chromium: insertText ersetzt die Auswahl (Cursor dahinter) und
// feuert input; undo holt den zuletzt gemerkten Vorwert zurück und markiert
// [start, end) des zurückgeholten Texts.
function installExecCommand(overrides = {}) {
  document.execCommand = vi.fn((cmd, _ui, arg) => {
    if (overrides[cmd]) return overrides[cmd](cmd, _ui, arg);
    if (cmd === "insertText") {
      history.push({ value: el.value, start: el.selectionStart, end: el.selectionEnd });
      el.setRangeText(arg, el.selectionStart, el.selectionEnd, "end");
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: arg }));
      return true;
    }
    if (cmd === "undo") {
      const prev = history.pop();
      if (!prev) return false;
      el.value = prev.value;
      el.setSelectionRange(prev.start, prev.end);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "historyUndo" }));
      return true;
    }
    return false;
  });
  return document.execCommand;
}

beforeEach(() => { history = []; });
afterEach(() => {
  delete document.execCommand;
  if (el) { el.remove(); el = null; }
});

describe("replaceRangeNative", () => {
  it("Erfolg: setzt die Auswahl auf [from, to), ruft execCommand('insertText') genau einmal, Wert stimmt, Cursor steht hinter dem Einfügten", () => {
    mountField("ab->XYZ");
    const cmd = installExecCommand();
    const impl = cmd.getMockImplementation();
    let selAtCall = null;
    // Auswahl im Moment des Aufrufs mitschneiden, Verhalten des Stubs bleibt
    cmd.mockImplementation((...args) => {
      selAtCall = [el.selectionStart, el.selectionEnd, el.value];
      return impl(...args);
    });

    const ok = replaceRangeNative(el, 2, 4, "→", "ab→XYZ");

    expect(ok).toBe(true);
    expect(document.execCommand).toHaveBeenCalledTimes(1);
    expect(document.execCommand).toHaveBeenCalledWith("insertText", false, "→");
    expect(selAtCall).toEqual([2, 4, "ab->XYZ"]); // Auswahl war [from, to) zum Zeitpunkt des Aufrufs
    expect(el.value).toBe("ab→XYZ");
    // Cursor DAHINTER, nicht am Textende (7)
    expect(el.selectionStart).toBe(3);
    expect(el.selectionEnd).toBe(3);
  });

  it("der Cursor wird explizit hinter das Eingefügte gesetzt, egal wo der Browser ihn hinterlässt (hier: eingefügter Text markiert)", () => {
    mountField("ab->XYZ");
    installExecCommand({
      insertText: (_c, _u, a) => {
        el.setRangeText(a, el.selectionStart, el.selectionEnd, "select");
        return true;
      },
    });
    expect(replaceRangeNative(el, 2, 4, "→", "ab→XYZ")).toBe(true);
    expect([el.selectionStart, el.selectionEnd]).toEqual([3, 3]);
  });

  it("Cursor wird in UTF-16-Einheiten gesetzt: Ersatz '❤️' (Länge 2) -> Cursor from + 2", () => {
    mountField("x<3y");
    installExecCommand();
    expect(replaceRangeNative(el, 1, 3, "❤️", "x❤️y")).toBe(true);
    expect(el.selectionStart).toBe(3);
    expect(el.selectionEnd).toBe(3);
  });

  it("execCommand fehlt (jsdom, alter Browser) -> false, Wert und Auswahl unangetastet", () => {
    mountField("ab->");
    el.setSelectionRange(4, 4);
    expect(typeof document.execCommand).not.toBe("function");
    expect(replaceRangeNative(el, 2, 4, "→", "ab→")).toBe(false);
    expect(el.value).toBe("ab->");
    expect([el.selectionStart, el.selectionEnd]).toEqual([4, 4]);
  });

  it("execCommand liefert false -> false, Wert unverändert, ursprüngliche Auswahl wiederhergestellt", () => {
    mountField("ab->");
    el.setSelectionRange(4, 4);
    installExecCommand({ insertText: () => false });
    expect(replaceRangeNative(el, 2, 4, "→", "ab→")).toBe(false);
    expect(el.value).toBe("ab->");
    // NICHT [2, 4]: die für den Versuch gesetzte Auswahl darf nicht stehenbleiben
    expect([el.selectionStart, el.selectionEnd]).toEqual([4, 4]);
  });

  it("execCommand wirft -> false, kein Fehler nach außen, Auswahl wiederhergestellt", () => {
    mountField("ab->");
    el.setSelectionRange(4, 4);
    installExecCommand({ insertText: () => { throw new Error("nicht erlaubt"); } });
    expect(() => replaceRangeNative(el, 2, 4, "→", "ab→")).not.toThrow();
    expect(replaceRangeNative(el, 2, 4, "→", "ab→")).toBe(false);
    expect(el.value).toBe("ab->");
    expect([el.selectionStart, el.selectionEnd]).toEqual([4, 4]);
  });

  it("Feld nicht fokussiert -> false, execCommand wird NIE aufgerufen (es würde sonst ein anderes Element treffen)", () => {
    mountField("ab->", { focus: false });
    const cmd = installExecCommand();
    expect(document.activeElement).not.toBe(el);
    expect(replaceRangeNative(el, 2, 4, "→", "ab→")).toBe(false);
    expect(cmd).not.toHaveBeenCalled();
    expect(el.value).toBe("ab->");
  });

  it("Wert weicht von expectedText ab (Browser hat etwas anderes getan) -> false", () => {
    mountField("ab->");
    installExecCommand({
      insertText: (_c, _u, a) => {
        el.setRangeText(a + "!", el.selectionStart, el.selectionEnd, "end");
        return true;
      },
    });
    expect(replaceRangeNative(el, 2, 4, "→", "ab→")).toBe(false);
    // Der Helfer räumt den fremden Zustand NICHT weg – das entscheidet der Aufrufer
    expect(el.value).toBe("ab→!");
  });

  it("execCommand meldet true, ändert aber nichts -> false (kein Vertrauen in den Rückgabewert allein)", () => {
    mountField("ab->");
    installExecCommand({ insertText: () => true });
    expect(replaceRangeNative(el, 2, 4, "→", "ab→")).toBe(false);
    expect(el.value).toBe("ab->");
  });

  it("execCommand ändert den Wert richtig, meldet aber false -> false", () => {
    mountField("ab->");
    installExecCommand({
      insertText: (_c, _u, a) => {
        el.setRangeText(a, el.selectionStart, el.selectionEnd, "end");
        return false;
      },
    });
    expect(replaceRangeNative(el, 2, 4, "→", "ab→")).toBe(false);
  });

  it.each([
    ["el null", () => null],
    ["el undefined", () => undefined],
    ["el ohne ownerDocument", () => ({ value: "ab->" })],
  ])("kaputtes Element (%s) -> false, wirft nie", (_n, make) => {
    installExecCommand();
    expect(replaceRangeNative(make(), 2, 4, "→", "ab→")).toBe(false);
  });

  it("kaputte Positionen/Einfügetexte -> false, execCommand nicht aufgerufen", () => {
    mountField("ab->");
    const cmd = installExecCommand();
    expect(replaceRangeNative(el, NaN, 4, "→", "ab→")).toBe(false);
    expect(replaceRangeNative(el, 2, "4", "→", "ab→")).toBe(false);
    expect(replaceRangeNative(el, 2, 4, null, "ab→")).toBe(false);
    expect(cmd).not.toHaveBeenCalled();
  });
});

describe("undoNative", () => {
  it("Erfolg: execCommand('undo') stellt den Vorwert wieder her -> true (Auswahl bleibt Sache des Aufrufers)", () => {
    mountField("ab->");
    const cmd = installExecCommand();
    el.setSelectionRange(2, 4);
    expect(replaceRangeNative(el, 2, 4, "→", "ab→")).toBe(true);

    expect(undoNative(el, "ab->")).toBe(true);

    expect(cmd).toHaveBeenLastCalledWith("undo");
    expect(el.value).toBe("ab->");
    // der Helfer kollabiert NICHT: der Stub (wie Chromium) markiert den Rohtext
    expect([el.selectionStart, el.selectionEnd]).toEqual([2, 4]);
  });

  it("execCommand fehlt -> false", () => {
    mountField("ab→");
    expect(undoNative(el, "ab->")).toBe(false);
    expect(el.value).toBe("ab→");
  });

  it("execCommand liefert false (leerer Undo-Verlauf) -> false", () => {
    mountField("ab→");
    installExecCommand({ undo: () => false });
    expect(undoNative(el, "ab->")).toBe(false);
  });

  it("execCommand wirft -> false, kein Fehler nach außen", () => {
    mountField("ab→");
    installExecCommand({ undo: () => { throw new Error("nicht erlaubt"); } });
    expect(() => undoNative(el, "ab->")).not.toThrow();
    expect(undoNative(el, "ab->")).toBe(false);
  });

  it("Feld nicht fokussiert -> false, execCommand nie aufgerufen", () => {
    mountField("ab→", { focus: false });
    const cmd = installExecCommand();
    expect(undoNative(el, "ab->")).toBe(false);
    expect(cmd).not.toHaveBeenCalled();
  });

  it("Wert weicht von expectedText ab (Undo hat etwas anderes zurückgenommen) -> false", () => {
    mountField("ab→");
    installExecCommand({
      undo: () => {
        el.value = "ganz was anderes";
        return true;
      },
    });
    expect(undoNative(el, "ab->")).toBe(false);
    expect(el.value).toBe("ganz was anderes");
  });

  it("execCommand meldet true, ändert aber nichts -> false", () => {
    mountField("ab→");
    installExecCommand({ undo: () => true });
    expect(undoNative(el, "ab->")).toBe(false);
  });

  it("kaputtes Element -> false, wirft nie", () => {
    installExecCommand();
    expect(undoNative(null, "x")).toBe(false);
    expect(undoNative({}, "x")).toBe(false);
  });
});
