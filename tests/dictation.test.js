// Spracheingabe (v7.59, DECISIONS #139): reine Logik + Controller aus
// src/lib/dictation.js. Läuft in der node-Umgebung (KEIN jsdom): der
// Controller bekommt Konstruktor, Uhr und Callbacks als Parameter, die
// Web Speech API wird durch eine Fake-Erkennerklasse ersetzt, deren
// on*-Handler die Tests direkt aufrufen (wie der Browser es täte).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DICTATION_TIMEOUTS,
  getSpeechRecognitionCtor,
  isAndroidWebView,
  isDictationAvailable,
  pickDictationLang,
  normalizeSpoken,
  transcriptFromResults,
  joinTranscript,
  appendDictation,
  dictationStep,
  dictationErrorInfo,
  queryMicPermission,
  resolveDictationError,
  createDictation,
} from "../src/lib/dictation.js";

/* ---------- Hilfen ---------- */

// Ergebnis-Fabrik: res(["text", isFinal, confidence], ...) -> SpeechRecognitionEvent-ähnlich.
const res = (...parts) => ({
  resultIndex: 0,
  results: parts.map(([t, f, c = 0]) => Object.assign([{ transcript: t, confidence: c }], { isFinal: !!f })),
});
const results = (...parts) => res(...parts).results;

const UA_WEBVIEW =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240305.019.A1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/155.0.7000.80 Mobile Safari/537.36";
const UA_CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.7000.80 Mobile Safari/537.36";
const UA_CHROME_DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";

/* ---------- Fake-Erkenner ---------- */

class FakeRecognition {
  static instances = [];
  static ctorThrows = false;
  static startThrows = false;
  static syncStart = false; // start() ruft onstart sofort
  static syncEnd = false; // stop()/abort() rufen onend sofort
  static syncFail = false; // start() liefert sofort error not-allowed + end (Headless-Muster)
  static reset() {
    FakeRecognition.instances = [];
    FakeRecognition.ctorThrows = false;
    FakeRecognition.startThrows = false;
    FakeRecognition.syncStart = false;
    FakeRecognition.syncEnd = false;
    FakeRecognition.syncFail = false;
  }
  constructor() {
    if (FakeRecognition.ctorThrows) throw new Error("Konstruktor kaputt");
    this.calls = [];
    FakeRecognition.instances.push(this);
  }
  start() {
    this.calls.push("start");
    if (FakeRecognition.startThrows) throw new Error("InvalidStateError");
    if (FakeRecognition.syncFail) {
      if (this.onerror) this.onerror({ error: "not-allowed" });
      if (this.onend) this.onend({});
      return;
    }
    if (FakeRecognition.syncStart && this.onstart) this.onstart({});
  }
  stop() {
    this.calls.push("stop");
    if (FakeRecognition.syncEnd && this.onend) this.onend({});
  }
  abort() {
    this.calls.push("abort");
    if (FakeRecognition.syncEnd) {
      if (this.onerror) this.onerror({ error: "aborted" });
      if (this.onend) this.onend({});
    }
  }
}

// Ereignis wie der Browser auslösen: ein abgehängter (null) Handler wird
// nicht aufgerufen.
const fire = (r, name, ev = {}) => {
  const fn = r[name];
  if (typeof fn === "function") fn.call(r, ev);
};

// Controller + Protokoll; das "Feld" wird wie in App.jsx geführt
// (onText -> dictationStep auf den aktuellen Feldtext).
function mk(opts = {}) {
  const { field = "", ...rest } = opts;
  const log = { states: [], errors: [], texts: [] };
  const h = { log, field };
  h.d = createDictation({
    getCtor: () => FakeRecognition,
    lang: "de-AT",
    onText: (p, n) => {
      log.texts.push([p, n]);
      h.field = dictationStep(h.field, p, n);
    },
    onState: (s) => log.states.push(s),
    onError: (c) => log.errors.push(c),
    ...rest,
  });
  Object.defineProperty(h, "r", { get: () => FakeRecognition.instances[FakeRecognition.instances.length - 1] });
  return h;
}

// Bis "listening" bringen (onstart nach dem Antippen).
function startListening(opts) {
  const h = mk(opts);
  expect(h.d.start()).toBe(true);
  fire(h.r, "onstart");
  expect(h.d.getState()).toBe("listening");
  return h;
}

beforeEach(() => {
  FakeRecognition.reset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/* ---------- Verfügbarkeit ---------- */

describe("DICTATION_TIMEOUTS", () => {
  it("hat die vereinbarten Werte und ist eingefroren", () => {
    expect(DICTATION_TIMEOUTS).toEqual({ STOP_MS: 3000, ABORT_MS: 1500, MAX_MS: 60000, TAP_GUARD_MS: 400 });
    expect(Object.isFrozen(DICTATION_TIMEOUTS)).toBe(true);
  });
});

describe("getSpeechRecognitionCtor", () => {
  it("bevorzugt das unpräfixierte SpeechRecognition", () => {
    const A = function A() {};
    const B = function B() {};
    expect(getSpeechRecognitionCtor({ SpeechRecognition: A, webkitSpeechRecognition: B })).toBe(A);
  });
  it("fällt auf webkitSpeechRecognition zurück", () => {
    const B = function B() {};
    expect(getSpeechRecognitionCtor({ webkitSpeechRecognition: B })).toBe(B);
  });
  it("liefert null ohne jeden Konstruktor", () => {
    expect(getSpeechRecognitionCtor({})).toBeNull();
  });
  it("ein Nicht-Funktions-Wert bei SpeechRecognition zählt nicht, webkit greift", () => {
    const B = function B() {};
    expect(getSpeechRecognitionCtor({ SpeechRecognition: {}, webkitSpeechRecognition: B })).toBe(B);
    expect(getSpeechRecognitionCtor({ SpeechRecognition: "x", webkitSpeechRecognition: 5 })).toBeNull();
  });
  it("null/undefined als Fenster -> null", () => {
    expect(getSpeechRecognitionCtor(null)).toBeNull();
    expect(getSpeechRecognitionCtor(undefined)).toBeNull();
  });
  it("ein werfender Getter -> null statt Ausnahme", () => {
    const win = {};
    Object.defineProperty(win, "SpeechRecognition", { get() { throw new Error("gesperrt"); } });
    expect(getSpeechRecognitionCtor(win)).toBeNull();
  });
  it("liest bei jedem Aufruf frisch (API kann zur Laufzeit verschwinden/ersetzt werden)", () => {
    const A = function A() {};
    const win = { SpeechRecognition: A };
    expect(getSpeechRecognitionCtor(win)).toBe(A);
    delete win.SpeechRecognition;
    expect(getSpeechRecognitionCtor(win)).toBeNull();
  });
});

describe("isAndroidWebView", () => {
  it("erkennt den WebView-User-Agent", () => {
    expect(isAndroidWebView(UA_WEBVIEW)).toBe(true);
    expect(isAndroidWebView("Mozilla/5.0 (Linux; Android 13;wv) AppleWebKit/537.36")).toBe(true);
  });
  it("Chrome auf Android und Desktop sind keine WebView", () => {
    expect(isAndroidWebView(UA_CHROME_ANDROID)).toBe(false);
    expect(isAndroidWebView(UA_CHROME_DESKTOP)).toBe(false);
  });
  it("ein bloßes 'wv' ohne Klammer-Struktur zählt nicht", () => {
    expect(isAndroidWebView("Foo wv bar")).toBe(false);
  });
  it("Nicht-Strings -> false", () => {
    for (const v of [undefined, null, 42, {}, [], true]) expect(isAndroidWebView(v)).toBe(false);
  });
});

describe("isDictationAvailable", () => {
  const C = function C() {};
  it("Chrome-Android-UA mit Konstruktor -> true", () => {
    expect(isDictationAvailable({ SpeechRecognition: C, navigator: { userAgent: UA_CHROME_ANDROID }, isSecureContext: true })).toBe(true);
  });
  it("WebView-UA mit Konstruktor -> false", () => {
    expect(isDictationAvailable({ SpeechRecognition: C, navigator: { userAgent: UA_WEBVIEW }, isSecureContext: true })).toBe(false);
  });
  it("unsicherer Kontext -> false, fehlendes isSecureContext reicht nicht zum Ausblenden", () => {
    expect(isDictationAvailable({ SpeechRecognition: C, isSecureContext: false })).toBe(false);
    expect(isDictationAvailable({ SpeechRecognition: C })).toBe(true);
  });
  it("ohne navigator, aber mit Konstruktor -> true", () => {
    expect(isDictationAvailable({ webkitSpeechRecognition: C })).toBe(true);
  });
  it("ohne Konstruktor -> false", () => {
    expect(isDictationAvailable({ navigator: { userAgent: UA_CHROME_DESKTOP }, isSecureContext: true })).toBe(false);
  });
  it("null/undefined als Fenster -> false", () => {
    expect(isDictationAvailable(null)).toBe(false);
    expect(isDictationAvailable(undefined)).toBe(false);
  });
  it("werfender Zugriff -> false statt Ausnahme", () => {
    const win = { SpeechRecognition: C };
    Object.defineProperty(win, "navigator", { get() { throw new Error("gesperrt"); } });
    expect(isDictationAvailable(win)).toBe(false);
    const proxy = new Proxy({}, { get() { throw new Error("alles gesperrt"); } });
    expect(isDictationAvailable(proxy)).toBe(false);
  });
});

/* ---------- Sprache ---------- */

describe("pickDictationLang", () => {
  it.each([
    [["en-US", "de-AT"], "de-AT"],
    [["DE-ch"], "de-CH"],
    [["de_at"], "de-AT"],
    [["de"], "de-DE"],
    [["de-DE"], "de-DE"],
    [["de-LU"], "de-DE"],
    [["deu"], "de-DE"],
    [["de-AT-1996"], "de-DE"],
    [[42, null, "de-DE"], "de-DE"],
    [[42, null, { x: 1 }, "de-CH"], "de-CH"],
    [[" de-AT "], "de-AT"],
    [["en-US", "fr"], "de-DE"],
    [[], "de-DE"],
    [undefined, "de-DE"],
    [null, "de-DE"],
    ["de-AT", "de-DE"], // kein Array
  ])("%j -> %s", (input, expected) => {
    expect(pickDictationLang(input)).toBe(expected);
  });
  it("nimmt den ERSTEN deutschen Eintrag, auch wenn er auf de-DE normalisiert wird", () => {
    expect(pickDictationLang(["de-LU", "de-AT"])).toBe("de-DE");
  });
});

/* ---------- Transkript ---------- */

describe("normalizeSpoken", () => {
  it("fasst Leerraum-Läufe (auch Tab/Zeilenumbruch/NBSP) zusammen und trimmt", () => {
    expect(normalizeSpoken("  a \t b\n\nc\u00a0d  ")).toBe("a b c d");
  });
  it("Nicht-Strings -> leer", () => {
    for (const v of [undefined, null, 5, {}, []]) expect(normalizeSpoken(v)).toBe("");
  });
});

describe("transcriptFromResults", () => {
  it("nur Interim", () => {
    expect(transcriptFromResults(results(["hallo wel", false]))).toEqual({ finalText: "", interimText: "hallo wel" });
  });
  it("Final und Interim werden getrennt", () => {
    expect(transcriptFromResults(results(["Hallo Welt", true], ["wie ge", false]))).toEqual({
      finalText: "Hallo Welt",
      interimText: "wie ge",
    });
  });
  it("mehrere Interim-Stücke mit Rand-Leerzeichen werden sauber verbunden", () => {
    expect(transcriptFromResults(results([" milch und ", false], ["  eier\n", false])).interimText).toBe("milch und eier");
  });
  it("zwei verschiedene Finals werden angehängt", () => {
    expect(transcriptFromResults(results(["Milch", true], ["und Eier", true])).finalText).toBe("Milch und Eier");
  });
  it("Android-kumulativ (3 Finals, confidence 0) -> nur das letzte", () => {
    const r = results(["hallo", true, 0], ["hallo wie", true, 0], ["hallo wie geht", true, 0]);
    expect(transcriptFromResults(r).finalText).toBe("hallo wie geht");
  });
  it("kumulativ gilt unabhängig von Groß-/Kleinschreibung (Umlaute inklusive)", () => {
    expect(transcriptFromResults(results(["äpfel", true], ["Äpfel und Birnen", true])).finalText).toBe("Äpfel und Birnen");
  });
  it("doppeltes identisches Final -> einmal", () => {
    expect(transcriptFromResults(results(["Milch kaufen", true], ["Milch kaufen", true])).finalText).toBe("Milch kaufen");
  });
  it("'ok' + 'OK' -> 'OK' (gleich bis auf Schreibweise ersetzt das vorige)", () => {
    expect(transcriptFromResults(results(["ok", true], ["OK", true])).finalText).toBe("OK");
  });
  it("nur an der Wortgrenze: 'ja' + 'jawohl' bleibt beides", () => {
    expect(transcriptFromResults(results(["ja", true], ["jawohl", true])).finalText).toBe("ja jawohl");
    expect(transcriptFromResults(results(["Haus", true], ["Hausaufgaben", true])).finalText).toBe("Haus Hausaufgaben");
  });
  it("confidence 0 bleibt final (auf Android legitim)", () => {
    expect(transcriptFromResults(results(["hallo", true, 0])).finalText).toBe("hallo");
  });
  it("Umlaute und ß bleiben unverändert erhalten", () => {
    expect(transcriptFromResults(results(["Größe äöü ß", true])).finalText).toBe("Größe äöü ß");
  });
  it("resultIndex ändert nichts: es wird immer ab Index 0 aufgebaut (idempotent bei doppelter Zustellung)", () => {
    const ev = res(["Milch", true], ["und eier", false]);
    const first = transcriptFromResults(ev.results);
    const shifted = transcriptFromResults({ ...ev, resultIndex: 1 }.results);
    expect(shifted).toEqual(first);
    expect(first).toEqual({ finalText: "Milch", interimText: "und eier" });
  });
  it("Kaputtes wird übersprungen bzw. ergibt leere Teile", () => {
    const empty = { finalText: "", interimText: "" };
    expect(transcriptFromResults(null)).toEqual(empty);
    expect(transcriptFromResults(undefined)).toEqual(empty);
    expect(transcriptFromResults({})).toEqual(empty);
    expect(transcriptFromResults({ length: 0 })).toEqual(empty);
    expect(transcriptFromResults([null])).toEqual(empty);
    expect(transcriptFromResults([[]])).toEqual(empty);
    expect(transcriptFromResults([[{}]])).toEqual(empty);
    expect(transcriptFromResults([Object.assign([{ transcript: 42 }], { isFinal: true })])).toEqual(empty);
    expect(transcriptFromResults([Object.assign([{ transcript: "   " }], { isFinal: true })])).toEqual(empty);
  });
  it("kaputte Einträge zwischen guten stören nicht", () => {
    const r = [null, Object.assign([{ transcript: "eins" }], { isFinal: true }), [{}], Object.assign([{ transcript: "zwei" }], { isFinal: false })];
    expect(transcriptFromResults(r)).toEqual({ finalText: "eins", interimText: "zwei" });
  });
  it("unsinnige length-Werte laufen nicht endlos und ergeben leer", () => {
    for (const length of [Infinity, NaN, -3, 1.5, "2"]) {
      expect(transcriptFromResults({ length, 0: Object.assign([{ transcript: "x" }], { isFinal: true }) })).toEqual({ finalText: "", interimText: "" });
    }
  });
  it("array-artiges Objekt {length, 0: ...} wird ausgewertet", () => {
    const like = { length: 1, 0: Object.assign([{ transcript: "hallo" }], { isFinal: true }) };
    expect(transcriptFromResults(like)).toEqual({ finalText: "hallo", interimText: "" });
  });
});

describe("joinTranscript", () => {
  it("verbindet Final und Interim mit einem Leerzeichen", () => {
    expect(joinTranscript("Hallo Welt", "wie ge")).toBe("Hallo Welt wie ge");
  });
  it("nur final / nur interim", () => {
    expect(joinTranscript("Hallo", "")).toBe("Hallo");
    expect(joinTranscript("", "wie ge")).toBe("wie ge");
  });
  it("Leerraum-Teile und Nicht-Strings werden ignoriert, innerer Leerraum normalisiert", () => {
    expect(joinTranscript("   ", "\n\t")).toBe("");
    expect(joinTranscript(null, undefined)).toBe("");
    expect(joinTranscript(" a   b ", " c ")).toBe("a b c");
  });
});

/* ---------- Anhängen und Einspleißen ---------- */

describe("appendDictation", () => {
  it.each([
    ["", "milch", "milch"],
    ["Einkauf", "milch", "Einkauf milch"],
    ["Einkauf ", "milch", "Einkauf milch"],
    ["Liste:\n", "milch", "Liste:\nmilch"],
    ["Zitat „", "hallo", "Zitat „hallo"],
    ["Zitat ‚", "hallo", "Zitat ‚hallo"],
    ["f(", "x", "f(x"],
    ["a[", "x", "a[x"],
    ["a{", "x", "a{x"],
    ["Tab\t", "x", "Tab\tx"],
    ["x", "  ", "x"],
    ["  Rand  ", "a", "  Rand  a"],
    ["  ", "a", "  a"],
    ["x", "a   b\n c", "x a b c"],
    ["x", "", "x"],
    ["x", undefined, "x"],
    ["", "", ""],
    // leeres Gesprochenes lässt die Basis unangetastet (kein Trimmen des Nutzertexts)
    ["  Rand  ", "", "  Rand  "],
    ["Text \n", "   ", "Text \n"],
    ["  ", "", "  "],
  ])("(%j, %j) -> %j", (base, spoken, expected) => {
    expect(appendDictation(base, spoken)).toBe(expected);
  });
  it("Nicht-String-Basis verhält sich wie ''", () => {
    expect(appendDictation(undefined, "a")).toBe("a");
    expect(appendDictation(null, "a")).toBe("a");
    expect(appendDictation(5, "a")).toBe("a");
    expect(appendDictation({}, "")).toBe("");
  });
  it("verändert die Basis nie (kein Trimmen, kein Großschreiben, keine Satzzeichen)", () => {
    expect(appendDictation("  rand.  ", "klein")).toBe("  rand.  klein");
  });
});

describe("dictationStep", () => {
  it("erster Schritt eines Abschnitts hängt an", () => {
    expect(dictationStep("Einkauf", "", "milch")).toBe("Einkauf milch");
    expect(dictationStep("", "", "milch")).toBe("milch");
  });
  it("Folgeschritt ersetzt das eigene Endstück", () => {
    expect(dictationStep("Einkauf milch", "milch", "milch und eier")).toBe("Einkauf milch und eier");
  });
  it("Basis mit Leerzeichen am Ende bleibt erhalten", () => {
    const step1 = dictationStep("Einkauf ", "", "milch");
    expect(step1).toBe("Einkauf milch");
    expect(dictationStep(step1, "milch", "milch und eier")).toBe("Einkauf milch und eier");
  });
  it("Basis mit ZWEI Leerzeichen am Ende ('x  ') bleibt unverändert davor", () => {
    const step1 = dictationStep("x  ", "", "a");
    expect(step1).toBe("x  a");
    expect(dictationStep(step1, "a", "ab")).toBe("x  ab");
  });
  it("Basis endet auf öffnende Klammer: kein Leerzeichen dazwischen, auch im Folgeschritt", () => {
    const step1 = dictationStep("f(", "", "x");
    expect(step1).toBe("f(x");
    expect(dictationStep(step1, "x", "x plus y")).toBe("f(x plus y");
  });
  it("Basis endet auf Zeilenumbruch", () => {
    const step1 = dictationStep("Liste:\n", "", "milch");
    expect(dictationStep(step1, "milch", "milch und eier")).toBe("Liste:\nmilch und eier");
  });
  it("Wiederherstellungs-Fall: Code setzt das Feld auf 'Wiederhergestellt', dann beginnt das Diktat", () => {
    expect(dictationStep("Wiederhergestellt", "", "hallo")).toBe("Wiederhergestellt hallo");
  });
  it("Schnellnotiz HINTER dem Endstück -> Feld unverändert (Diktat koppelt ab)", () => {
    const cur = "Einkauf eins\n\nNeue Schnellnotiz:\nX";
    expect(dictationStep(cur, "eins", "eins zwei")).toBe(cur);
  });
  it("vom Nutzer veränderter Schwanz -> unverändert", () => {
    expect(dictationStep("Einkauf eins zwoi", "eins zwei", "eins zwei drei")).toBe("Einkauf eins zwoi");
    expect(dictationStep("Einkauf eins zwei!", "eins zwei", "eins zwei drei")).toBe("Einkauf eins zwei!");
  });
  it("Nutzer hat das Trennzeichen entfernt -> kein Verschmelzen mit Fremdtext, unverändert", () => {
    expect(dictationStep("Daseins", "eins", "einsam")).toBe("Daseins");
  });
  it("Feld wurde geleert -> bleibt leer (nichts wird neu hineingeschrieben)", () => {
    expect(dictationStep("", "hallo", "hallo welt")).toBe("");
  });
  it("'to' leer oder gleich 'from' (auch nach Normalisierung) -> unverändert", () => {
    expect(dictationStep("Einkauf milch", "milch", "")).toBe("Einkauf milch");
    expect(dictationStep("Einkauf milch", "milch", "milch")).toBe("Einkauf milch");
    expect(dictationStep("Einkauf milch", "milch", "  milch \n")).toBe("Einkauf milch");
    expect(dictationStep("Einkauf", "", "   ")).toBe("Einkauf");
  });
  it("ein nicht normalisiertes 'from' (Rand-/Doppel-Leerraum) trifft das Endstück trotzdem", () => {
    expect(dictationStep("Einkauf milch und", "  milch\n und ", "milch und eier")).toBe("Einkauf milch und eier");
  });
  it("Nicht-String-Feld wird wie '' behandelt", () => {
    expect(dictationStep(undefined, "", "hallo")).toBe("hallo");
    expect(dictationStep(null, "hallo", "hallo welt")).toBe("");
  });
  it("Sonderzeichen ($&, Klammern, .*, Backslash) werden wörtlich behandelt, nie als Muster/Ersetzung", () => {
    const step1 = dictationStep("Preis", "", "$& (x");
    expect(step1).toBe("Preis $& (x");
    const step2 = dictationStep(step1, "$& (x", "$& (x) .* \\1 $1 $$");
    expect(step2).toBe("Preis $& (x) .* \\1 $1 $$");
    // Kontrolle: 'from' darf auch selbst nur aus Sonderzeichen bestehen
    expect(dictationStep("A .*", ".*", ".* +")).toBe("A .* +");
  });
  it("Faltungstest: Zwischenergebnisse ersetzen sich, die Basis bleibt in JEDEM Schritt Präfix", () => {
    const steps = ["eins", "eins zwei", "eins zwei drei"];
    for (const base of ["", "X", "X ", "x  ", "Liste:\n", "f(", "Zitat „", "  Rand  "]) {
      let field = base;
      let prev = "";
      for (const next of steps) {
        field = dictationStep(field, prev, next);
        expect(field.startsWith(base)).toBe(true);
        expect(field).toBe(appendDictation(base, next));
        prev = next;
      }
    }
    expect(steps.reduce((f, n, i) => dictationStep(f, i ? steps[i - 1] : "", n), "X")).toBe("X eins zwei drei");
  });
  it("Zwischenergebnis, das das Gesprochene verkürzt/umschreibt, wird trotzdem sauber ersetzt", () => {
    // Interim 'milch und' -> Final 'Milch' (kürzer, andere Schreibweise)
    expect(dictationStep("Einkauf milch und", "milch und", "Milch")).toBe("Einkauf Milch");
  });
});

/* ---------- Fehlertexte ---------- */

describe("dictationErrorInfo", () => {
  it("still: aborted, '', null, undefined", () => {
    for (const c of ["aborted", "", null, undefined]) expect(dictationErrorInfo(c, "granted")).toBeNull();
  });
  it("no-speech und nomatch sind info", () => {
    expect(dictationErrorInfo("no-speech")).toEqual({ kind: "info", text: "Nichts gehört. Mikrofon antippen und direkt lossprechen." });
    expect(dictationErrorInfo("nomatch")).toEqual({ kind: "info", text: "Nicht verstanden – bitte noch einmal versuchen." });
  });
  it("not-allowed: die drei Varianten je nach Berechtigungsstand", () => {
    const denied = dictationErrorInfo("not-allowed", "denied");
    expect(denied.kind).toBe("warn");
    expect(denied.text).toContain("für diese Seite blockiert");
    expect(denied.text).toContain("Berechtigungen → Mikrofon → Zulassen");
    const granted = dictationErrorInfo("not-allowed", "granted");
    expect(granted.kind).toBe("warn");
    expect(granted.text).toContain("gerade nicht verfügbar");
    expect(granted.text).toContain("Speech Services by Google");
    for (const st of ["prompt", "unknown", undefined, "quatsch"]) {
      const other = dictationErrorInfo("not-allowed", st);
      expect(other).toEqual({ kind: "warn", text: "Kein Zugriff auf das Mikrofon. Beim nächsten Antippen bitte „Zulassen“ wählen." });
    }
  });
  it("Berechtigungsstand beeinflusst andere Codes nicht", () => {
    expect(dictationErrorInfo("network", "denied")).toEqual(dictationErrorInfo("network", "granted"));
  });
  it.each([
    ["audio-capture", "Kein Mikrofon verfügbar"],
    ["network", "nicht erreichbar"],
    ["service-not-allowed", "nicht freigegeben"],
    ["language-not-supported", "Deutsche Spracherkennung"],
    ["start-failed", "konnte nicht gestartet werden"],
    ["unsupported", "nicht unterstützt"],
    ["timeout", "nicht reagiert"],
  ])("%s -> warn mit passendem Text", (code, snippet) => {
    const info = dictationErrorInfo(code);
    expect(info.kind).toBe("warn");
    expect(info.text).toContain(snippet);
  });
  it("unbekannter, harmloser Code wird im Text genannt", () => {
    expect(dictationErrorInfo("bad-grammar")).toEqual({ kind: "warn", text: "Spracherkennung fehlgeschlagen (bad-grammar)." });
  });
  it("Fremdtext/HTML/Riesenstring wird NICHT eingesetzt", () => {
    const plain = { kind: "warn", text: "Spracherkennung fehlgeschlagen." };
    expect(dictationErrorInfo("<b>x</b>")).toEqual(plain);
    expect(dictationErrorInfo("a".repeat(60))).toEqual(plain);
    expect(dictationErrorInfo("Bad-Code")).toEqual(plain);
    expect(dictationErrorInfo("1abc")).toEqual(plain);
    expect(dictationErrorInfo("a\nb")).toEqual(plain);
    expect(dictationErrorInfo(42)).toEqual(plain);
    expect(dictationErrorInfo({ toString: () => "x" })).toEqual(plain);
  });
  it("Längengrenze: 40 Zeichen noch ja, 41 nicht", () => {
    expect(dictationErrorInfo("a".repeat(40)).text).toContain("(" + "a".repeat(40) + ")");
    expect(dictationErrorInfo("a".repeat(41)).text).toBe("Spracherkennung fehlgeschlagen.");
  });
});

describe("queryMicPermission", () => {
  const navWith = (query) => ({ permissions: { query } });

  it.each(["granted", "denied", "prompt"])("liefert den Stand %s", async (state) => {
    const query = vi.fn().mockResolvedValue({ state });
    expect(await queryMicPermission(navWith(query))).toBe(state);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith({ name: "microphone" });
  });
  it("räumt den Zeitgeber nach der Auflösung auf", async () => {
    await queryMicPermission(navWith(vi.fn().mockResolvedValue({ state: "granted" })));
    expect(vi.getTimerCount()).toBe(0);
    await queryMicPermission(navWith(vi.fn().mockRejectedValue(new Error("x"))));
    expect(vi.getTimerCount()).toBe(0);
  });
  it("exotischer oder fehlender state -> unknown", async () => {
    expect(await queryMicPermission(navWith(vi.fn().mockResolvedValue({ state: "geheimnisvoll" })))).toBe("unknown");
    expect(await queryMicPermission(navWith(vi.fn().mockResolvedValue(null)))).toBe("unknown");
    expect(await queryMicPermission(navWith(vi.fn().mockResolvedValue({})))).toBe("unknown");
  });
  it("query wirft synchron -> unknown", async () => {
    const query = vi.fn(() => { throw new TypeError("microphone ist kein gültiger Name"); });
    expect(await queryMicPermission(navWith(query))).toBe("unknown");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("query wird abgelehnt -> unknown", async () => {
    expect(await queryMicPermission(navWith(vi.fn().mockRejectedValue(new TypeError("nope"))))).toBe("unknown");
  });
  it("ohne nav / permissions / query -> unknown", async () => {
    expect(await queryMicPermission(null)).toBe("unknown");
    expect(await queryMicPermission(undefined)).toBe("unknown");
    expect(await queryMicPermission({})).toBe("unknown");
    expect(await queryMicPermission({ permissions: {} })).toBe("unknown");
    expect(await queryMicPermission({ permissions: { query: "kein-Funktion" } })).toBe("unknown");
  });
  it("werfender permissions-Getter -> unknown statt Ausnahme", async () => {
    const nav = {};
    Object.defineProperty(nav, "permissions", { get() { throw new Error("gesperrt"); } });
    expect(await queryMicPermission(nav)).toBe("unknown");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("hängende query -> nach 1000 ms unknown (nicht früher)", async () => {
    const nav = navWith(vi.fn(() => new Promise(() => {})));
    let result;
    queryMicPermission(nav).then((v) => { result = v; });
    await vi.advanceTimersByTimeAsync(999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBe("unknown");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("eigenes Zeitlimit wird respektiert; eine verspätete Antwort ändert das Ergebnis nicht", async () => {
    let resolveQuery;
    const nav = navWith(vi.fn(() => new Promise((r) => { resolveQuery = r; })));
    let result;
    queryMicPermission(nav, 50).then((v) => { result = v; });
    await vi.advanceTimersByTimeAsync(49);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBe("unknown");
    resolveQuery({ state: "granted" });
    await vi.advanceTimersByTimeAsync(0);
    expect(result).toBe("unknown");
  });
});

describe("resolveDictationError", () => {
  it("not-allowed + denied -> Blockiert-Text", async () => {
    const info = await resolveDictationError("not-allowed", () => Promise.resolve("denied"));
    expect(info.kind).toBe("warn");
    expect(info.text).toContain("blockiert");
  });
  it("not-allowed + granted -> 'gerade nicht verfügbar'", async () => {
    const info = await resolveDictationError("not-allowed", async () => "granted");
    expect(info.text).toContain("gerade nicht verfügbar");
  });
  it("not-allowed + prompt -> allgemeiner Zugriffstext", async () => {
    const info = await resolveDictationError("not-allowed", async () => "prompt");
    expect(info.text).toContain("Kein Zugriff auf das Mikrofon");
  });
  it("wirft/lehnt queryPermission ab oder fehlt sie -> Text für unbekannten Stand", async () => {
    const generic = dictationErrorInfo("not-allowed", "unknown");
    expect(await resolveDictationError("not-allowed", () => { throw new Error("x"); })).toEqual(generic);
    expect(await resolveDictationError("not-allowed", () => Promise.reject(new Error("x")))).toEqual(generic);
    expect(await resolveDictationError("not-allowed", undefined)).toEqual(generic);
  });
  it("andere Codes rufen queryPermission NICHT auf", async () => {
    const q = vi.fn(async () => "denied");
    expect(await resolveDictationError("network", q)).toEqual(dictationErrorInfo("network"));
    expect(await resolveDictationError("no-speech", q)).toEqual(dictationErrorInfo("no-speech"));
    expect(await resolveDictationError("aborted", q)).toBeNull();
    expect(await resolveDictationError(undefined, q)).toBeNull();
    expect(q).not.toHaveBeenCalled();
  });
});

/* ---------- Controller ---------- */

describe("createDictation - Start und Zustände", () => {
  it("start: genau eine Instanz, richtige Konfiguration, Zustand 'starting'", () => {
    const h = mk();
    expect(h.d.getState()).toBe("idle");
    expect(h.d.start()).toBe(true);
    expect(FakeRecognition.instances).toHaveLength(1);
    expect(h.r.lang).toBe("de-AT");
    expect(h.r.continuous).toBe(false);
    expect(h.r.interimResults).toBe(true);
    expect(h.r.maxAlternatives).toBe(1);
    expect(h.r.calls).toEqual(["start"]);
    expect(h.d.getState()).toBe("starting");
    expect(h.log.states).toEqual(["starting"]);
  });
  it("ohne lang-Option wird de-DE gesetzt (lang immer explizit)", () => {
    const h = mk({ lang: undefined });
    h.d.start();
    expect(h.r.lang).toBe("de-DE");
  });
  it("start außerhalb von idle -> false, keine zweite Instanz", () => {
    const h = mk();
    h.d.start();
    expect(h.d.start()).toBe(false);
    fire(h.r, "onstart");
    expect(h.d.start()).toBe(false);
    expect(FakeRecognition.instances).toHaveLength(1);
  });
  it("onstart -> 'listening'; weitere Start-Signale lösen keinen weiteren Zustandswechsel aus", () => {
    const h = mk();
    h.d.start();
    fire(h.r, "onstart");
    fire(h.r, "onaudiostart");
    fire(h.r, "onsoundstart");
    fire(h.r, "onspeechstart");
    expect(h.log.states).toEqual(["starting", "listening"]);
  });
  it("jedes der vier Start-Signale genügt für 'listening' (Chrome Android sendet nicht immer onstart zuerst)", () => {
    for (const ev of ["onstart", "onaudiostart", "onsoundstart", "onspeechstart"]) {
      FakeRecognition.reset();
      const h = mk();
      h.d.start();
      fire(h.r, ev);
      expect(h.d.getState()).toBe("listening");
    }
  });
  it("timeouts-Option überschreibt nur die genannten Werte", () => {
    const h = startListening({ timeouts: { MAX_MS: 100 } });
    vi.advanceTimersByTime(99);
    expect(h.d.getState()).toBe("listening");
    vi.advanceTimersByTime(1);
    expect(h.d.getState()).toBe("stopping");
    // STOP_MS blieb beim Standard
    vi.advanceTimersByTime(2999);
    expect(h.r.calls).not.toContain("abort");
    vi.advanceTimersByTime(1);
    expect(h.r.calls).toContain("abort");
  });
});

describe("createDictation - Ergebnisse", () => {
  it("Normalfall auf Feld 'Einkauf': Zwischenergebnisse ersetzen sich, Final landet im Feld, Ende -> idle", () => {
    const h = startListening({ field: "Einkauf" });
    fire(h.r, "onresult", res(["milch", false]));
    expect(h.field).toBe("Einkauf milch");
    fire(h.r, "onresult", res(["milch und", false], ["eier", false]));
    expect(h.field).toBe("Einkauf milch und eier");
    fire(h.r, "onresult", res(["Milch und Eier", true]));
    expect(h.field).toBe("Einkauf Milch und Eier");
    fire(h.r, "onend");
    expect(h.d.getState()).toBe("idle");
    expect(h.field).toBe("Einkauf Milch und Eier");
    expect(h.log.errors).toEqual([]);
    expect(h.log.states).toEqual(["starting", "listening", "idle"]);
    expect(h.log.texts).toEqual([
      ["", "milch"],
      ["milch", "milch und eier"],
      ["milch und eier", "Milch und Eier"],
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("dasselbe Ergebnis-Ereignis doppelt -> onText nur einmal", () => {
    const h = startListening({ field: "A" });
    const ev = res(["Milch", true], ["und eier", false]);
    fire(h.r, "onresult", ev);
    fire(h.r, "onresult", ev);
    expect(h.log.texts).toHaveLength(1);
    expect(h.field).toBe("A Milch und eier");
  });
  it("Ergebnisse ohne verwertbaren Text lösen kein onText aus und lassen das Feld unberührt", () => {
    const h = startListening({ field: "A" });
    fire(h.r, "onresult", res(["   ", false]));
    fire(h.r, "onresult", res());
    fire(h.r, "onresult", { results: null });
    fire(h.r, "onresult", undefined);
    expect(h.log.texts).toEqual([]);
    expect(h.field).toBe("A");
  });
  it("ein Ergebnis ohne vorheriges onstart bringt den Zustand auf 'listening'", () => {
    const h = mk({ field: "A" });
    h.d.start();
    fire(h.r, "onresult", res(["hallo", false]));
    expect(h.d.getState()).toBe("listening");
    expect(h.field).toBe("A hallo");
    expect(vi.getTimerCount()).toBe(1); // MAX-Deckel läuft
  });
  it("Abbruch ohne Final (Android-App-Wechsel): Zwischentext bleibt, kein Fehler", () => {
    const h = startListening();
    fire(h.r, "onresult", res(["zwischen", false]));
    fire(h.r, "onerror", { error: "aborted" });
    expect(h.d.getState()).toBe("stopping");
    fire(h.r, "onend");
    expect(h.d.getState()).toBe("idle");
    expect(h.field).toBe("zwischen");
    expect(h.log.errors).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("kommt nach stop() noch ein Final, wird es übernommen (Endergebnis nach Nutzer-Stopp)", () => {
    const h = startListening({ field: "Einkauf" });
    fire(h.r, "onresult", res(["milch und", false]));
    h.d.stop();
    expect(h.d.getState()).toBe("stopping");
    expect(h.r.calls).toEqual(["start", "stop"]);
    expect(vi.getTimerCount()).toBe(1); // nur der Stop-Zeitgeber, der MAX-Deckel ist abgeräumt
    fire(h.r, "onresult", res(["Milch und Eier", true]));
    fire(h.r, "onaudiostart"); // auch späte Start-Signale holen den Zustand nicht zurück
    expect(h.d.getState()).toBe("stopping");
    expect(h.field).toBe("Einkauf Milch und Eier");
    fire(h.r, "onend");
    expect(h.d.getState()).toBe("idle");
    expect(h.log.errors).toEqual([]);
    expect(h.log.states).toEqual(["starting", "listening", "stopping", "idle"]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("createDictation - Fehler", () => {
  it("Headless-Muster ohne onstart: error not-allowed + end -> starting, stopping, idle, onError", () => {
    const h = mk();
    h.d.start();
    fire(h.r, "onerror", { error: "not-allowed" });
    fire(h.r, "onend");
    expect(h.log.states).toEqual(["starting", "stopping", "idle"]);
    expect(h.log.errors).toEqual(["not-allowed"]);
    expect(h.d.getState()).toBe("idle");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("synchron gelieferter Fehler innerhalb von start() (Headless-Muster) hinterlässt keine Timer", () => {
    FakeRecognition.syncFail = true;
    const h = mk();
    expect(h.d.start()).toBe(true);
    expect(h.log.states).toEqual(["starting", "stopping", "idle"]);
    expect(h.log.errors).toEqual(["not-allowed"]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("nomatch + end -> onError('nomatch')", () => {
    const h = startListening();
    fire(h.r, "onnomatch");
    fire(h.r, "onend");
    expect(h.log.errors).toEqual(["nomatch"]);
  });
  it("nomatch, dann error no-speech -> der echte Fehler gewinnt", () => {
    const h = startListening();
    fire(h.r, "onnomatch");
    fire(h.r, "onerror", { error: "no-speech" });
    fire(h.r, "onend");
    expect(h.log.errors).toEqual(["no-speech"]);
  });
  it("no-speech OHNE Stopp und OHNE Text wird gemeldet", () => {
    const h = startListening();
    fire(h.r, "onerror", { error: "no-speech" });
    fire(h.r, "onend");
    expect(h.log.errors).toEqual(["no-speech"]);
  });
  it("no-speech/nomatch nachdem Text kam -> still (nur die Stille nach dem Satz)", () => {
    for (const mkErr of [() => ["onerror", { error: "no-speech" }], () => ["onnomatch", {}]]) {
      FakeRecognition.reset();
      const h = startListening();
      fire(h.r, "onresult", res(["hallo", false]));
      fire(h.r, ...mkErr());
      fire(h.r, "onend");
      expect(h.log.errors).toEqual([]);
      expect(h.field).toBe("hallo");
    }
  });
  it("no-speech/nomatch nach Nutzer-Stopp -> still", () => {
    for (const mkErr of [() => ["onerror", { error: "no-speech" }], () => ["onnomatch", {}]]) {
      FakeRecognition.reset();
      const h = startListening();
      h.d.stop();
      fire(h.r, ...mkErr());
      fire(h.r, "onend");
      expect(h.log.errors).toEqual([]);
    }
  });
  it("andere Fehler werden auch nach Text oder Stopp gemeldet (network, audio-capture)", () => {
    const h = startListening();
    fire(h.r, "onresult", res(["hallo", false]));
    h.d.stop();
    fire(h.r, "onerror", { error: "network" });
    fire(h.r, "onend");
    expect(h.log.errors).toEqual(["network"]);
    expect(h.field).toBe("hallo");
  });
  it("der erste echte Fehler gewinnt; nomatch überschreibt keinen Fehler", () => {
    const h = startListening();
    fire(h.r, "onerror", { error: "audio-capture" });
    fire(h.r, "onnomatch");
    fire(h.r, "onerror", { error: "network" });
    fire(h.r, "onend");
    expect(h.log.errors).toEqual(["audio-capture"]);
  });
  it("Fehler ohne Code -> 'unknown'", () => {
    for (const ev of [{}, undefined, { error: "" }, { error: 42 }]) {
      FakeRecognition.reset();
      const h = startListening();
      fire(h.r, "onerror", ev);
      fire(h.r, "onend");
      expect(h.log.errors).toEqual(["unknown"]);
    }
  });
  it("Fehlerzustand startet NICHT neu: genau ein start()-Aufruf, auch nach Fehler und end", () => {
    const h = startListening();
    fire(h.r, "onerror", { error: "network" });
    fire(h.r, "onend");
    expect(FakeRecognition.instances).toHaveLength(1);
    expect(h.r.calls).toEqual(["start"]);
  });
  it("error ohne end: nach ABORT_MS (1500) Zwangs-Ende mit dem Fehlercode (nicht 'timeout')", () => {
    const h = startListening();
    fire(h.r, "onerror", { error: "network" });
    expect(h.d.getState()).toBe("stopping");
    // nur die Abbruch-Wache läuft; der MAX-Deckel ist abgeräumt
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1499);
    expect(h.d.getState()).toBe("stopping");
    vi.advanceTimersByTime(1);
    expect(h.d.getState()).toBe("idle");
    expect(h.log.errors).toEqual(["network"]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("ein zweiter Fehler startet die Abbruch-Wache nicht neu (Zwangs-Ende bleibt bei 1500 ms ab dem ersten)", () => {
    const h = startListening();
    fire(h.r, "onerror", { error: "audio-capture" });
    vi.advanceTimersByTime(1000);
    fire(h.r, "onerror", { error: "network" });
    vi.advanceTimersByTime(500);
    expect(h.d.getState()).toBe("idle");
    expect(h.log.errors).toEqual(["audio-capture"]);
  });
  it("Fehler nach Nutzer-Stopp räumt den Stop-Zeitgeber ab: nur die Abbruch-Wache bleibt", () => {
    const h = startListening();
    h.d.stop();
    expect(vi.getTimerCount()).toBe(1); // Stop-Zeitgeber
    fire(h.r, "onerror", { error: "network" });
    expect(vi.getTimerCount()).toBe(1); // jetzt die Abbruch-Wache
    vi.advanceTimersByTime(1500);
    expect(h.d.getState()).toBe("idle");
    expect(h.r.calls).not.toContain("abort"); // der Stop-Zeitgeber hat nicht mehr gefeuert
    expect(h.log.errors).toEqual(["network"]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("benutzerdefiniertes Zeitlimit: error ohne end beachtet ABORT_MS aus timeouts", () => {
    const h = startListening({ timeouts: { ABORT_MS: 200 } });
    fire(h.r, "onerror", { error: "network" });
    vi.advanceTimersByTime(199);
    expect(h.d.getState()).toBe("stopping");
    vi.advanceTimersByTime(1);
    expect(h.d.getState()).toBe("idle");
  });
  it("Pro Sitzung werden Nutzer-Stopp, Text und Fehler zurückgesetzt (kein Durchsickern in das nächste Diktat)", () => {
    const h = startListening();
    fire(h.r, "onresult", res(["hallo", true]));
    h.d.stop();
    fire(h.r, "onend");
    expect(h.log.errors).toEqual([]);
    // zweites Diktat: no-speech ohne Stopp/ohne Text muss wieder gemeldet werden
    expect(h.d.start()).toBe(true);
    fire(h.r, "onstart");
    fire(h.r, "onerror", { error: "no-speech" });
    fire(h.r, "onend");
    expect(h.log.errors).toEqual(["no-speech"]);
    // und ein Fehler der zweiten Sitzung bleibt nicht für die dritte hängen
    expect(h.d.start()).toBe(true);
    fire(h.r, "onstart");
    fire(h.r, "onend");
    expect(h.log.errors).toEqual(["no-speech"]);
  });
});

describe("createDictation - stop, Wächter und Deckel", () => {
  it("stop() aus idle ist ein No-op", () => {
    const h = mk();
    h.d.stop();
    expect(h.log.states).toEqual([]);
    expect(FakeRecognition.instances).toHaveLength(0);
  });
  it("zweites stop() ruft nicht erneut stop() der Instanz auf", () => {
    const h = startListening();
    h.d.stop();
    h.d.stop();
    expect(h.r.calls.filter((c) => c === "stop")).toHaveLength(1);
  });
  it("stop() in 'starting' (Ansichtswechsel bei offenem Berechtigungsdialog) bricht still ab statt zu finalisieren", () => {
    const h = mk({ field: "A" });
    h.d.start();
    h.d.stop();
    expect(h.r.calls).toEqual(["start", "abort"]);
    expect(h.d.getState()).toBe("stopping");
    fire(h.r, "onerror", { error: "not-allowed" });
    fire(h.r, "onend");
    expect(h.d.getState()).toBe("idle");
    expect(h.log.errors).toEqual([]);
    expect(h.field).toBe("A");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("stop() ohne end: +2999 ms kein abort, +3000 ms abort, +1500 ms Zwangs-Ende mit 'timeout'", () => {
    const h = startListening();
    h.d.stop();
    vi.advanceTimersByTime(2999);
    expect(h.r.calls).not.toContain("abort");
    vi.advanceTimersByTime(1);
    expect(h.r.calls).toContain("abort");
    expect(h.d.getState()).toBe("stopping");
    vi.advanceTimersByTime(1499);
    expect(h.d.getState()).toBe("stopping");
    vi.advanceTimersByTime(1);
    expect(h.d.getState()).toBe("idle");
    expect(h.log.errors).toEqual(["timeout"]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("kommt end nach abort, aber vor Ablauf der Wache -> idle ohne 'timeout'", () => {
    const h = startListening();
    h.d.stop();
    vi.advanceTimersByTime(3000);
    expect(h.r.calls).toContain("abort");
    vi.advanceTimersByTime(1000);
    fire(h.r, "onend");
    expect(h.d.getState()).toBe("idle");
    expect(h.log.errors).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10000);
    expect(h.log.errors).toEqual([]);
  });
  it("kommt end rechtzeitig nach stop(), läuft der Stop-Zeitgeber nicht weiter", () => {
    const h = startListening();
    h.d.stop();
    fire(h.r, "onend");
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10000);
    expect(h.r.calls).toEqual(["start", "stop"]);
  });
  it("wirft stop()/abort() der Instanz, hängt der Controller trotzdem nicht (Wächter greift)", () => {
    const h = startListening();
    h.r.stop = () => { throw new Error("InvalidStateError"); };
    h.r.abort = () => { throw new Error("InvalidStateError"); };
    h.d.stop();
    expect(h.d.getState()).toBe("stopping");
    vi.advanceTimersByTime(3000 + 1500);
    expect(h.d.getState()).toBe("idle");
    expect(h.log.errors).toEqual(["timeout"]);
  });
  it("MAX: nach 60000 ms ab 'listening' wird gestoppt", () => {
    const h = startListening();
    vi.advanceTimersByTime(59999);
    expect(h.d.getState()).toBe("listening");
    expect(h.r.calls).toEqual(["start"]);
    vi.advanceTimersByTime(1);
    expect(h.d.getState()).toBe("stopping");
    expect(h.r.calls).toEqual(["start", "stop"]);
    fire(h.r, "onend");
    expect(h.d.getState()).toBe("idle");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("MAX-Stopp gilt nicht als Nutzer-Stopp: no-speech danach wird gemeldet", () => {
    const h = startListening();
    vi.advanceTimersByTime(60000);
    fire(h.r, "onerror", { error: "no-speech" });
    fire(h.r, "onend");
    expect(h.log.errors).toEqual(["no-speech"]);
  });
  it("in 'starting' läuft KEIN Wächter (Berechtigungsdialog darf beliebig lange offen sein)", () => {
    const h = mk();
    h.d.start();
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(h.d.getState()).toBe("starting");
    expect(h.r.calls).toEqual(["start"]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("ein vorzeitiges Ende löscht den MAX-Zeitgeber (kein späteres stop() einer toten Sitzung)", () => {
    const h = startListening();
    fire(h.r, "onend");
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(120000);
    expect(h.r.calls).toEqual(["start"]);
  });
  it("end ohne vorheriges Ergebnis/Fehler (z. B. Browser beendet still) -> idle, kein Fehler", () => {
    const h = startListening();
    fire(h.r, "onend");
    expect(h.d.getState()).toBe("idle");
    expect(h.log.errors).toEqual([]);
  });
});

describe("createDictation - toggle und cancel", () => {
  it("toggle aus idle startet; zweiter toggle nach 100 ms wird vom Tap-Guard geschluckt", () => {
    const h = mk();
    expect(h.d.toggle()).toBe(true);
    expect(h.d.getState()).toBe("starting");
    vi.advanceTimersByTime(100);
    expect(h.d.toggle()).toBe(false);
    expect(h.d.getState()).toBe("starting");
    expect(h.r.calls).toEqual(["start"]);
    fire(h.r, "onstart");
    expect(h.d.toggle()).toBe(false);
    expect(h.d.getState()).toBe("listening");
  });
  it("Tap-Guard-Grenze: bei 399 ms noch gesperrt, ab 400 ms erlaubt", () => {
    let t = 5000;
    const h = startListening({ now: () => t });
    t = 5399;
    expect(h.d.toggle()).toBe(false);
    expect(h.r.calls).toEqual(["start"]);
    t = 5400;
    expect(h.d.toggle()).toBe(true);
    expect(h.r.calls).toEqual(["start", "stop"]);
  });
  it("toggle in 'starting' nach 500 ms bricht ab (abort), Zustand 'stopping', end -> idle OHNE Fehler", () => {
    const h = mk();
    h.d.toggle();
    vi.advanceTimersByTime(500);
    expect(h.d.toggle()).toBe(true);
    expect(h.r.calls).toEqual(["start", "abort"]);
    expect(h.d.getState()).toBe("stopping");
    fire(h.r, "onerror", { error: "aborted" });
    fire(h.r, "onend");
    expect(h.d.getState()).toBe("idle");
    expect(h.log.errors).toEqual([]);
    expect(h.log.states).toEqual(["starting", "stopping", "idle"]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("toggle in 'stopping' -> false", () => {
    const h = startListening();
    vi.advanceTimersByTime(500);
    h.d.toggle();
    expect(h.d.getState()).toBe("stopping");
    expect(h.d.toggle()).toBe(false);
    expect(h.r.calls).toEqual(["start", "stop"]);
  });
  it("toggle in 'listening' (nach dem Guard) -> stop()", () => {
    const h = startListening();
    vi.advanceTimersByTime(500);
    expect(h.d.toggle()).toBe(true);
    expect(h.d.getState()).toBe("stopping");
    expect(h.r.calls).toEqual(["start", "stop"]);
    fire(h.r, "onend");
    expect(h.d.toggle()).toBe(true); // wieder idle -> neuer Start
    expect(FakeRecognition.instances).toHaveLength(2);
  });
  it("cancel(): abort, 'stopping'; späte Ergebnisse/Fehler/Ende verändern das Feld nicht und melden nichts", () => {
    const h = startListening({ field: "Einkauf" });
    fire(h.r, "onresult", res(["eins", false]));
    expect(h.field).toBe("Einkauf eins");
    h.d.cancel();
    expect(h.r.calls).toEqual(["start", "abort"]);
    expect(h.d.getState()).toBe("stopping");
    fire(h.r, "onresult", res(["eins zwei", true]));
    fire(h.r, "onerror", { error: "network" });
    fire(h.r, "onend");
    expect(h.d.getState()).toBe("idle");
    expect(h.field).toBe("Einkauf eins");
    expect(h.log.errors).toEqual([]);
    expect(h.log.texts).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancel() in 'starting' mit nachgeliefertem not-allowed bleibt still (Nutzer hat selbst abgebrochen)", () => {
    const h = mk();
    h.d.start();
    h.d.cancel();
    fire(h.r, "onerror", { error: "not-allowed" });
    fire(h.r, "onend");
    expect(h.log.errors).toEqual([]);
    expect(h.d.getState()).toBe("idle");
  });
  it("cancel() ohne end: nach ABORT_MS idle, still", () => {
    const h = startListening();
    h.d.cancel();
    vi.advanceTimersByTime(1499);
    expect(h.d.getState()).toBe("stopping");
    vi.advanceTimersByTime(1);
    expect(h.d.getState()).toBe("idle");
    expect(h.log.errors).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancel() aus idle/ohne Sitzung ist ein No-op; zweites cancel() ruft abort nicht erneut", () => {
    const h = mk();
    h.d.cancel();
    expect(h.log.states).toEqual([]);
    h.d.start();
    h.d.cancel();
    h.d.cancel();
    expect(h.r.calls.filter((c) => c === "abort")).toHaveLength(1);
  });
  it("cancel() nach stop() verwirft auch noch ausstehende Endergebnisse", () => {
    const h = startListening({ field: "A" });
    h.d.stop();
    expect(vi.getTimerCount()).toBe(1); // Stop-Zeitgeber
    h.d.cancel();
    expect(vi.getTimerCount()).toBe(1); // jetzt nur noch die Abbruch-Wache
    fire(h.r, "onresult", res(["spät", true]));
    expect(h.field).toBe("A");
    vi.advanceTimersByTime(1500);
    expect(h.d.getState()).toBe("idle");
    expect(h.r.calls).toEqual(["start", "stop", "abort"]); // abort kam vom cancel, nicht vom Stop-Zeitgeber
  });
});

describe("createDictation - Startfehler", () => {
  it("r.start() wirft -> idle + onError('start-failed'), kein Timer, erneuter Start möglich", () => {
    FakeRecognition.startThrows = true;
    const h = mk();
    expect(h.d.start()).toBe(false);
    expect(h.d.getState()).toBe("idle");
    expect(h.log.states).toEqual(["starting", "idle"]);
    expect(h.log.errors).toEqual(["start-failed"]);
    expect(vi.getTimerCount()).toBe(0);
    FakeRecognition.startThrows = false;
    expect(h.d.start()).toBe(true);
    expect(FakeRecognition.instances).toHaveLength(2);
    // die verworfene erste Instanz darf die zweite Sitzung nicht beeinflussen
    expect(FakeRecognition.instances[0].onend).toBeNull();
  });
  it("Konstruktor wirft -> 'start-failed', kein Zustandswechsel", () => {
    FakeRecognition.ctorThrows = true;
    const h = mk();
    expect(h.d.start()).toBe(false);
    expect(h.log.errors).toEqual(["start-failed"]);
    expect(h.log.states).toEqual([]);
    expect(h.d.getState()).toBe("idle");
  });
  it("werfender Setter bei der Konfiguration -> 'start-failed'", () => {
    class Picky {
      set lang(_v) { throw new Error("nein"); }
    }
    const h = mk({ getCtor: () => Picky });
    expect(h.d.start()).toBe(false);
    expect(h.log.errors).toEqual(["start-failed"]);
    expect(h.log.states).toEqual([]);
  });
  it("kein Konstruktor (null / wirft / Nicht-Funktion / keine Option) -> 'unsupported', kein Zustandswechsel", () => {
    for (const getCtor of [() => null, () => { throw new Error("x"); }, () => ({}), undefined]) {
      const errors = [];
      const states = [];
      const d = createDictation({ getCtor, onError: (c) => errors.push(c), onState: (s) => states.push(s) });
      expect(d.start()).toBe(false);
      expect(errors).toEqual(["unsupported"]);
      expect(states).toEqual([]);
      expect(d.getState()).toBe("idle");
    }
  });
  it("fehlende Callbacks sind kein Problem (no-ops), auch ohne jede Option", () => {
    const d = createDictation();
    expect(d.start()).toBe(false);
    const d2 = createDictation({ getCtor: () => FakeRecognition });
    expect(d2.start()).toBe(true);
    const r = FakeRecognition.instances[0];
    fire(r, "onstart");
    fire(r, "onresult", res(["x", true]));
    fire(r, "onerror", { error: "network" });
    fire(r, "onend");
    expect(d2.getState()).toBe("idle");
  });
});

describe("createDictation - Instanzen, Synchronität, dispose", () => {
  it("zweites Diktat -> neue Instanz; Ereignisse der ERSTEN Instanz werden ignoriert", () => {
    const h = startListening({ field: "A" });
    const r1 = h.r;
    fire(r1, "onresult", res(["eins", true]));
    const stale = { onresult: r1.onresult, onerror: r1.onerror, onend: r1.onend, onstart: r1.onstart };
    fire(r1, "onend");
    expect(h.d.getState()).toBe("idle");
    // Handler der ersten Instanz sind abgehängt
    expect(r1.onresult).toBeNull();
    expect(r1.onend).toBeNull();

    expect(h.d.start()).toBe(true);
    const r2 = h.r;
    expect(r2).not.toBe(r1);
    stale.onstart({});
    expect(h.d.getState()).toBe("starting"); // spätes onstart der alten Instanz zählt nicht
    fire(r2, "onstart");
    stale.onresult(res(["gespenst", true]));
    stale.onerror({ error: "network" });
    stale.onend({});
    expect(h.d.getState()).toBe("listening");
    fire(r2, "onresult", res(["zwei", true]));
    fire(r2, "onend");
    expect(h.field).toBe("A eins zwei");
    expect(h.log.errors).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("nach einem Zwangs-Ende darf ein spätes 'end' der alten Instanz die neue Sitzung nicht beenden", () => {
    const h = startListening();
    const r1 = h.r;
    const lateEnd = r1.onend;
    h.d.stop();
    vi.advanceTimersByTime(3000 + 1500);
    expect(h.d.getState()).toBe("idle");
    h.d.start();
    fire(h.r, "onstart");
    lateEnd({});
    expect(h.d.getState()).toBe("listening");
  });
  it("synchroner Fake (start ruft onstart, stop/abort rufen sofort onend): Zustände korrekt, keine Timer übrig", () => {
    FakeRecognition.syncStart = true;
    FakeRecognition.syncEnd = true;
    const h = mk();
    expect(h.d.start()).toBe(true);
    expect(h.d.getState()).toBe("listening");
    expect(h.log.states).toEqual(["starting", "listening"]);
    vi.advanceTimersByTime(500);
    expect(h.d.toggle()).toBe(true);
    expect(h.d.getState()).toBe("idle");
    expect(h.log.states).toEqual(["starting", "listening", "stopping", "idle"]);
    expect(h.log.errors).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("synchroner Fake: cancel() hinterlässt ebenfalls keine Timer", () => {
    FakeRecognition.syncStart = true;
    FakeRecognition.syncEnd = true;
    const h = mk();
    h.d.start();
    h.d.cancel();
    expect(h.d.getState()).toBe("idle");
    expect(h.log.errors).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("dispose(): abort, danach KEIN Callback mehr (weder durch späte Ereignisse noch durch Zeitgeber)", () => {
    const h = startListening({ field: "A" });
    fire(h.r, "onresult", res(["eins", false]));
    const r = h.r;
    const late = { onresult: r.onresult, onerror: r.onerror, onend: r.onend, onstart: r.onstart };
    const statesBefore = [...h.log.states];
    const textsBefore = h.log.texts.length;
    h.d.dispose();
    expect(r.calls).toContain("abort");
    expect(h.d.getState()).toBe("idle");
    expect(vi.getTimerCount()).toBe(0);
    late.onstart({});
    late.onresult(res(["zwei", true]));
    late.onerror({ error: "network" });
    late.onend({});
    vi.advanceTimersByTime(200000);
    expect(h.log.states).toEqual(statesBefore); // kein 'idle'-Callback nach dispose
    expect(h.log.texts).toHaveLength(textsBefore);
    expect(h.log.errors).toEqual([]);
    expect(h.field).toBe("A eins");
  });
  it("dispose() mitten in 'stopping' meldet später kein 'timeout'", () => {
    const h = startListening();
    h.d.stop();
    h.d.dispose();
    vi.advanceTimersByTime(60000);
    expect(h.log.errors).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("nach dispose liefern toggle/start false und erzeugen keine Instanz", () => {
    const h = mk();
    h.d.dispose();
    expect(h.d.toggle()).toBe(false);
    expect(h.d.start()).toBe(false);
    expect(FakeRecognition.instances).toHaveLength(0);
    expect(h.log.errors).toEqual([]);
  });
  it("dispose() zweimal und im Leerlauf ist unkritisch; abort wird nur einmal aufgerufen", () => {
    const h = startListening();
    h.d.dispose();
    expect(() => h.d.dispose()).not.toThrow();
    expect(h.r.calls.filter((c) => c === "abort")).toHaveLength(1);
    const idle = mk();
    expect(() => idle.d.dispose()).not.toThrow();
  });
  it("wirft abort() bei dispose, bleibt dispose still", () => {
    const h = startListening();
    h.r.abort = () => { throw new Error("InvalidStateError"); };
    expect(() => h.d.dispose()).not.toThrow();
    expect(h.d.getState()).toBe("idle");
  });
});

describe("createDictation - Zusammenspiel mit anderen Schreibern auf das Feld", () => {
  it("Schnellnotiz während des Diktats angehängt -> nächstes Ergebnis lässt das Feld unverändert", () => {
    const h = startListening({ field: "Einkauf" });
    fire(h.r, "onresult", res(["eins", false]));
    expect(h.field).toBe("Einkauf eins");
    h.field = h.field + "\n\nNeue Schnellnotiz:\nX"; // wie submitQuickNote in App.jsx
    const external = h.field;
    fire(h.r, "onresult", res(["eins zwei", false]));
    fire(h.r, "onresult", res(["Eins zwei drei", true]));
    expect(h.field).toBe(external);
    fire(h.r, "onend");
    expect(h.field).toBe(external);
    expect(h.log.errors).toEqual([]);
  });
  it("Wiederherstellung nach Sendefehler (Code setzt leeres Feld auf den alten Text) -> Diktat hängt dahinter an", () => {
    const h = startListening({ field: "" });
    h.field = "Wiederhergestellt"; // setInput(prev => prev.trim() ? prev : text) in send()
    fire(h.r, "onresult", res(["hallo", false]));
    expect(h.field).toBe("Wiederhergestellt hallo");
    fire(h.r, "onresult", res(["hallo welt", true]));
    expect(h.field).toBe("Wiederhergestellt hallo welt");
  });
  it("Nutzer löscht während des Diktats das Feld -> spätere Ergebnisse schreiben nichts zurück", () => {
    const h = startListening({ field: "Einkauf" });
    fire(h.r, "onresult", res(["eins", false]));
    h.field = "";
    fire(h.r, "onresult", res(["eins zwei", false]));
    expect(h.field).toBe("");
  });
});
