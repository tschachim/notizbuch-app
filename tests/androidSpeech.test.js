// Web-Anbindung der Android-Brücke (v7.60, DECISIONS #140): lib/androidSpeech.js
// im Zusammenspiel mit dem ECHTEN Controller createDictation (dictation.js),
// dazu die Hinweistexte, getDictationCtor/isDictationAvailable und der
// Einstellungs-Abschnitt in SettingsDialog (statisch gerendert).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BRIDGE_CALLBACK, BRIDGE_ERRORS, SPEECH_PREFS_KEY,
  getAndroidBridge, readBridgeInfo, readBridgeLog, openAndroidSettings,
  sanitizeSpeechPrefs, readSpeechPrefs, writeSpeechPrefs, buildStartOptions,
  mapNativeError, createBridgeRecognitionClass, buildDiagnosticsText,
} from "../src/lib/androidSpeech.js";
import {
  createDictation, dictationStep, isDictationAvailable, getDictationCtor, dictationErrorInfo,
  resolveDictationError,
} from "../src/lib/dictation.js";
import SettingsDialog from "../src/components/SettingsDialog.jsx";

const WV_UA = "Mozilla/5.0 (Linux; Android 15; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/155.0.8059.84 Mobile Safari/537.36";
const CHROME_UA = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.8059.84 Mobile Safari/537.36";

// Fake der Java-Brücke: zeichnet Aufrufe auf; send() spielt Java-Ereignisse
// so ein, wie SpeechBridge.emit() sie per evaluateJavascript liefert
// (JSON-STRING an window.__notizbuchAndroidSpeech).
function fakeWin({ info, log, throwOn } = {}) {
  const calls = [];
  const bridge = {
    getInfo: () => (info === undefined ? JSON.stringify({ bridge: 1, sdk: 34, autoProvider: "com.google.android.tts/com.google.android.apps.speech.tts.googletts.service.GoogleTTSRecognitionService" }) : info),
    getLog: () => (log === undefined ? JSON.stringify(["+0.100s start d1", "+0.300s ready d1"]) : log),
    speechStart: (sid, json) => { if (throwOn === "start") throw new Error("bridge weg"); calls.push(["start", sid, JSON.parse(json)]); },
    speechStop: (sid) => { if (throwOn === "stop") throw new Error("x"); calls.push(["stop", sid]); },
    speechAbort: (sid) => { if (throwOn === "abort") throw new Error("x"); calls.push(["abort", sid]); },
    openSettings: (t) => { if (throwOn === "settings") throw new Error("x"); calls.push(["settings", t]); },
  };
  const win = { NotizbuchAndroid: bridge, isSecureContext: true, navigator: { userAgent: WV_UA } };
  const lastSid = () => {
    const s = calls.filter((c) => c[0] === "start");
    return s.length ? s[s.length - 1][1] : null;
  };
  const send = (type, extra = {}, sid = lastSid()) =>
    win[BRIDGE_CALLBACK](JSON.stringify({ v: 1, sid, type, ...extra }));
  return { win, bridge, calls, send, lastSid };
}

function spyHandlers(r) {
  const log = [];
  for (const h of ["onstart", "onaudiostart", "onsoundstart", "onspeechstart", "onspeechend", "onsoundend", "onaudioend", "onresult", "onnomatch", "onerror", "onend"]) {
    r[h] = (ev) => log.push([h, ev]);
  }
  return log;
}

const transcripts = (ev) => ev.results.map((r) => [r[0].transcript, r.isFinal]);

describe("getAndroidBridge / readBridgeInfo / readBridgeLog", () => {
  it("erkennt nur vollständige Brücken", () => {
    const { win, bridge } = fakeWin();
    expect(getAndroidBridge(win)).toBe(bridge);
    expect(getAndroidBridge(null)).toBe(null);
    expect(getAndroidBridge({})).toBe(null);
    expect(getAndroidBridge({ NotizbuchAndroid: "x" })).toBe(null);
    const { speechAbort, ...half } = bridge; // eslint-disable-line no-unused-vars
    expect(getAndroidBridge({ NotizbuchAndroid: half })).toBe(null);
    const throwing = {};
    Object.defineProperty(throwing, "NotizbuchAndroid", { get() { throw new Error("gesperrt"); } });
    expect(getAndroidBridge(throwing)).toBe(null);
  });
  it("liest getInfo als JSON und verlangt bridge >= 1", () => {
    expect(readBridgeInfo(fakeWin().win).sdk).toBe(34);
    expect(readBridgeInfo(fakeWin({ info: "kaputt{" }).win)).toBe(null);
    expect(readBridgeInfo(fakeWin({ info: JSON.stringify({ bridge: 0 }) }).win)).toBe(null);
    expect(readBridgeInfo(fakeWin({ info: JSON.stringify({ bridge: "1" }) }).win)).toBe(null);
    expect(readBridgeInfo(fakeWin({ info: "null" }).win)).toBe(null);
    expect(readBridgeInfo({})).toBe(null);
  });
  it("liest das Protokoll und filtert Nicht-Strings", () => {
    expect(readBridgeLog(fakeWin().win)).toEqual(["+0.100s start d1", "+0.300s ready d1"]);
    expect(readBridgeLog(fakeWin({ log: JSON.stringify(["a", 3, null, "b"]) }).win)).toEqual(["a", "b"]);
    expect(readBridgeLog(fakeWin({ log: "{" }).win)).toEqual([]);
    expect(readBridgeLog(fakeWin({ log: "{}" }).win)).toEqual([]);
    const { win } = fakeWin();
    delete win.NotizbuchAndroid.getLog;
    expect(readBridgeLog(win)).toEqual([]);
    expect(readBridgeLog(null)).toEqual([]);
  });
});

describe("openAndroidSettings", () => {
  it("öffnet die App-Einstellungen bzw. den Erkenner-Dienst", () => {
    const f = fakeWin();
    expect(openAndroidSettings(f.win, "app")).toBe(true);
    expect(openAndroidSettings(f.win, "recognizer")).toBe(true);
    expect(f.calls).toEqual([["settings", "app"], ["settings", "com.google.android.tts"]]);
  });
  it("fällt bei unbrauchbarem autoProvider auf die App zurück", () => {
    const f = fakeWin({ info: JSON.stringify({ bridge: 1, autoProvider: "default" }) });
    openAndroidSettings(f.win, "recognizer");
    const g = fakeWin({ info: JSON.stringify({ bridge: 1, autoProvider: "<script>/x" }) });
    openAndroidSettings(g.win, "recognizer");
    expect(f.calls.concat(g.calls)).toEqual([["settings", "app"], ["settings", "app"]]);
  });
  it("ohne openSettings oder bei Wurf -> false", () => {
    const f = fakeWin({ throwOn: "settings" });
    expect(openAndroidSettings(f.win, "app")).toBe(false);
    delete f.win.NotizbuchAndroid.openSettings;
    expect(openAndroidSettings(f.win, "app")).toBe(false);
    expect(openAndroidSettings(null, "app")).toBe(false);
  });
});

describe("Einstellungen (localStorage)", () => {
  it("sanitizeSpeechPrefs: nur erlaubte Werte", () => {
    expect(sanitizeSpeechPrefs(null)).toEqual({ engine: "native", provider: "auto", formatting: "off", preferOffline: false });
    expect(sanitizeSpeechPrefs({ engine: "webview", provider: "ondevice", formatting: "quality", preferOffline: true }))
      .toEqual({ engine: "webview", provider: "ondevice", formatting: "quality", preferOffline: true });
    expect(sanitizeSpeechPrefs({ engine: "x", provider: "com.evil", formatting: "<b>", preferOffline: "ja" }))
      .toEqual({ engine: "native", provider: "auto", formatting: "off", preferOffline: false });
    expect(sanitizeSpeechPrefs({ provider: "default", formatting: "latency" }).provider).toBe("default");
  });
  it("read/write mit Fake-Speicher, kaputtem JSON und werfendem Speicher", () => {
    const store = new Map();
    const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
    expect(readSpeechPrefs(storage).engine).toBe("native");
    expect(writeSpeechPrefs(storage, { engine: "webview", provider: "böse" })).toBe(true);
    expect(JSON.parse(store.get(SPEECH_PREFS_KEY))).toEqual({ engine: "webview", provider: "auto", formatting: "off", preferOffline: false });
    expect(readSpeechPrefs(storage).engine).toBe("webview");
    store.set(SPEECH_PREFS_KEY, "{kaputt");
    expect(readSpeechPrefs(storage).engine).toBe("native");
    const boom = { getItem: () => { throw new Error("gesperrt"); }, setItem: () => { throw new Error("voll"); } };
    expect(readSpeechPrefs(boom).engine).toBe("native");
    expect(writeSpeechPrefs(boom, {})).toBe(false);
    expect(readSpeechPrefs(null).engine).toBe("native");
  });
  it("buildStartOptions: Sprache prüfen, Optionen nur wenn gewählt", () => {
    expect(buildStartOptions({ lang: "de-AT", interimResults: true }, null)).toEqual({ lang: "de-AT", partial: true, provider: "auto" });
    expect(buildStartOptions({ lang: "de DE; x", interimResults: false }, null).lang).toBe("de-DE");
    expect(buildStartOptions({ lang: 42 }, null)).toEqual({ lang: "de-DE", partial: false, provider: "auto" });
    expect(buildStartOptions({ lang: "de-DE", continuous: true }, { formatting: "quality", preferOffline: true, provider: "default" }))
      .toEqual({ lang: "de-DE", partial: false, provider: "default", formatting: "quality", preferOffline: true, segmentedMs: 300000 });
    expect(buildStartOptions(null, null).lang).toBe("de-DE");
  });
});

describe("mapNativeError", () => {
  it("bildet alle Android- und Brücken-Codes ab", () => {
    const m = (c, r = true) => mapNativeError(c, r);
    expect([m(1), m(2), m(4)]).toEqual(["network", "network", "network"]);
    expect(m(3)).toBe("audio-capture");
    expect(m(5, false)).toBe("recognizer-unavailable");
    expect(m(5, true)).toBe("aborted");
    expect(m(6)).toBe("no-speech");
    expect(m(7)).toBe("nomatch");
    expect([m(8), m(10)]).toEqual(["recognizer-busy", "recognizer-busy"]);
    expect(m(9)).toBe("recognizer-mic-denied");
    expect(m(11)).toBe("recognizer-unavailable");
    expect([m(12), m(13)]).toEqual(["language-unavailable", "language-unavailable"]);
    expect(m(BRIDGE_ERRORS.MIC_DENIED)).toBe("app-mic-denied");
    expect(m(BRIDGE_ERRORS.MIC_BLOCKED)).toBe("app-mic-blocked");
    expect(m(BRIDGE_ERRORS.START_FAILED)).toBe("start-failed");
    expect([m(BRIDGE_ERRORS.APP_HIDDEN), m(BRIDGE_ERRORS.ABORTED)]).toEqual(["aborted", "aborted"]);
    expect(m(BRIDGE_ERRORS.NOT_APP_PAGE)).toBe("service-not-allowed");
    expect(m(BRIDGE_ERRORS.NO_RECOGNIZER)).toBe("no-recognizer");
    expect(m(BRIDGE_ERRORS.NATIVE_TIMEOUT)).toBe("timeout");
    expect([m(14), m(15), m(99), m(-42), m(0), m("3"), m(undefined)]).toEqual(Array(7).fill("android-error"));
  });
  it("jeder Name passt zur Fehlercode-Regel der Hinweiszeile", () => {
    for (let c = -10; c <= 20; c++) {
      expect(mapNativeError(c, false)).toMatch(/^[a-z][a-z-]{0,39}$/);
      expect(mapNativeError(c, true)).toMatch(/^[a-z][a-z-]{0,39}$/);
    }
  });
});

describe("Brücken-Klasse (SpeechRecognition-Vertrag)", () => {
  it("ohne Brücke -> null", () => {
    expect(createBridgeRecognitionClass({}, null)).toBe(null);
  });

  it("start: sid, Optionen aus Instanz + Einstellungen; zweiter start wirft", () => {
    const f = fakeWin();
    const C = createBridgeRecognitionClass(f.win, () => ({ formatting: "latency" }));
    const r = new C();
    r.lang = "de-CH"; r.interimResults = true;
    r.start();
    expect(f.calls).toHaveLength(1);
    const [, sid, opts] = f.calls[0];
    expect(sid).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(opts).toEqual({ lang: "de-CH", partial: true, provider: "auto", formatting: "latency" });
    expect(() => r.start()).toThrow(/bereits/);
    // Eine zweite Instanz bekommt eine andere sid
    const r2 = new C(); r2.start();
    expect(f.calls[1][1]).not.toBe(sid);
  });

  it("werfende Einstellungs-Funktion -> Standardoptionen", () => {
    const f = fakeWin();
    const C = createBridgeRecognitionClass(f.win, () => { throw new Error("x"); });
    new C().start();
    expect(f.calls[0][2]).toEqual({ lang: "de-DE", partial: false, provider: "auto" });
  });

  it("speechStart wirft -> start wirft, sid abgemeldet, Instanz verbraucht", () => {
    const f = fakeWin({ throwOn: "start" });
    const C = createBridgeRecognitionClass(f.win);
    const r = new C();
    const log = spyHandlers(r);
    expect(() => r.start()).toThrow("bridge weg");
    expect(() => r.start()).toThrow(/bereits/);
    r.stop(); r.abort(); // no-ops
    expect(log).toEqual([]);
  });

  it("Normalablauf: Ereignisse -> Web-Speech-Handler, Interim mit UNSTABLE_TEXT, Final ersetzt Interim", () => {
    const f = fakeWin();
    const C = createBridgeRecognitionClass(f.win);
    const r = new C(); r.interimResults = true;
    const log = spyHandlers(r);
    r.start();
    f.send("listening");
    f.send("ready");
    f.send("beginning");
    f.send("partial", { texts: ["hallo"], unstable: " wie geht"});
    f.send("partial", { texts: ["hallo wie geht"], unstable: "s" });
    f.send("endofspeech");
    f.send("results", { texts: ["Hallo, wie geht's", "hallo wie gehts"], scores: [0.9, 0.1] });
    f.send("end");
    expect(log.map(([h]) => h)).toEqual([
      "onstart", "onaudiostart", "onsoundstart", "onspeechstart",
      "onresult", "onresult", "onspeechend", "onsoundend", "onaudioend", "onresult", "onend",
    ]);
    const res = log.filter(([h]) => h === "onresult").map(([, ev]) => ev);
    expect(transcripts(res[0])).toEqual([["hallo wie geht", false]]);
    expect(transcripts(res[1])).toEqual([["hallo wie gehts", false]]);
    expect(transcripts(res[2])).toEqual([["Hallo, wie geht's", true]]);
    expect(res[2].results[0][0].confidence).toBe(0.9);
    expect(res[2].results[0].item(0).transcript).toBe("Hallo, wie geht's");
    expect(res[2].results[0].item(5)).toBe(null);
    expect(res[2].resultIndex).toBe(0);
    // nach end: alles ignoriert, stop/abort sind no-ops
    f.send("partial", { texts: ["spät"] });
    f.send("end");
    r.stop(); r.abort();
    expect(log).toHaveLength(11);
    expect(f.calls.map((c) => c[0])).toEqual(["start"]);
  });

  it("interimResults=false: Zwischenstände werden verschluckt, Final kommt", () => {
    const f = fakeWin();
    const r = new (createBridgeRecognitionClass(f.win))();
    const log = spyHandlers(r);
    r.start();
    f.send("partial", { texts: ["zwischen"] });
    f.send("results", { texts: ["Zwischen"] });
    expect(log.filter(([h]) => h === "onresult").map(([, ev]) => transcripts(ev))).toEqual([[["Zwischen", true]]]);
  });

  it("leere/kaputte Ergebnisse: kein result, Zwischenstand bleibt das Letzte", () => {
    const f = fakeWin();
    const r = new (createBridgeRecognitionClass(f.win))(); r.interimResults = true;
    const log = spyHandlers(r);
    r.start();
    f.send("partial", { texts: ["eins"] });
    f.send("partial", { texts: [""], unstable: "  " });
    f.send("partial", { texts: "kein Array" });
    f.send("partial", { texts: [42] });
    f.send("results", { texts: [] });
    f.send("results", {});
    f.send("end");
    const res = log.filter(([h]) => h === "onresult");
    expect(res).toHaveLength(1);
    expect(transcripts(res[0][1])).toEqual([["eins", false]]);
    expect(log[log.length - 1][0]).toBe("onend");
    // kam schon ein Zwischentext, ist ein leeres Endergebnis kein "nichts verstanden"
    expect(log.filter(([h]) => h === "onnomatch")).toEqual([]);
  });

  it("leeres Endergebnis nach einem Zwischentext: KEIN onnomatch, der Zwischenstand bleibt das Letzte (leere results, fehlende texts, Leerraum)", () => {
    for (const empty of [{ texts: [] }, {}, { texts: ["   "] }, { texts: [""] }]) {
      const f = fakeWin();
      const r = new (createBridgeRecognitionClass(f.win))(); r.interimResults = true;
      const log = spyHandlers(r);
      r.start();
      f.send("partial", { texts: ["milch und eier"] });
      f.send("results", empty);
      f.send("end");
      expect(log.map(([h]) => h), JSON.stringify(empty)).toEqual(["onresult", "onend"]);
      expect(transcripts(log[0][1])).toEqual([["milch und eier", false]]);
    }
  });

  it("leeres Endergebnis nach einem Final (Segment oder results): KEIN onnomatch; erst ganz ohne Text kommt eines", () => {
    const f = fakeWin();
    const r = new (createBridgeRecognitionClass(f.win))();
    const log = spyHandlers(r);
    r.start();
    f.send("segment", { texts: ["Erster Satz."] });
    f.send("results", { texts: [] });
    f.send("end");
    expect(log.map(([h]) => h)).toEqual(["onresult", "onend"]);
    expect(transcripts(log[0][1])).toEqual([["Erster Satz.", true]]);

    const g = fakeWin();
    const r2 = new (createBridgeRecognitionClass(g.win))(); r2.interimResults = true;
    const log2 = spyHandlers(r2);
    r2.start();
    g.send("partial", { texts: ["   "] }); // reiner Leerraum zählt nicht als Text
    g.send("results", { texts: [] });
    g.send("end");
    expect(log2.map(([h]) => h)).toEqual(["onnomatch", "onend"]);
  });

  it("leeres Endergebnis ganz ohne Text -> onnomatch; leeres Segment nicht", () => {
    const f = fakeWin();
    const r = new (createBridgeRecognitionClass(f.win))(); r.interimResults = true;
    const log = spyHandlers(r);
    r.start();
    f.send("segment", { texts: [""] });
    f.send("results", { texts: ["   "] });
    f.send("end");
    expect(log.map(([h]) => h)).toEqual(["onnomatch", "onend"]);
  });

  // continuous === true: der Dauer-Modus (segmentierte Sitzung), in dem der
  // Google-Dienst vor Android 13 Abschnitte per final_result abschließt.
  it("continuous=true: Segmente und final_result-Teilergebnisse sammeln sich als Finals", () => {
    const f = fakeWin();
    const r = new (createBridgeRecognitionClass(f.win))(); r.interimResults = true; r.continuous = true;
    const log = spyHandlers(r);
    r.start();
    f.send("segment", { texts: ["Erster Satz."] });
    f.send("partial", { texts: ["zweit"] });
    f.send("partial", { texts: ["Zweiter Satz."], fin: true, unstable: "ignoriert" });
    f.send("partial", { texts: ["  "], fin: true });
    f.send("partial", { texts: ["drei"] });
    const res = log.filter(([h]) => h === "onresult").map(([, ev]) => ev);
    expect(transcripts(res[res.length - 1])).toEqual([["Erster Satz.", true], ["Zweiter Satz.", true], ["drei", false]]);
    expect(res[res.length - 1].resultIndex).toBe(2);
  });

  it("continuous=true: ein fin-Partial ist auch ohne interimResults ein Final (die fin-Prüfung steht vor der Zwischenstand-Sperre)", () => {
    const f = fakeWin();
    const r = new (createBridgeRecognitionClass(f.win))(); r.continuous = true; // interimResults bleibt false
    const log = spyHandlers(r);
    r.start();
    f.send("partial", { texts: ["nur Zwischenstand"] }); // verschluckt
    f.send("partial", { texts: ["Abschnitt eins."], fin: true });
    const res = log.filter(([h]) => h === "onresult").map(([, ev]) => ev);
    expect(res).toHaveLength(1);
    expect(transcripts(res[0])).toEqual([["Abschnitt eins.", true]]);
  });

  // continuous === false: so fährt der Controller IMMER. Das Endergebnis kommt
  // regulär per "results"; ein fin-Partial darf dort kein zweites Final
  // ergeben (sonst stünde der Satz bei abweichendem Endtext doppelt im Feld).
  it("continuous=false: ein fin-Partial ist nur ein Zwischenstand, das Endergebnis aus results ist das EINZIGE Final", () => {
    const f = fakeWin();
    const r = new (createBridgeRecognitionClass(f.win))(); r.interimResults = true;
    expect(r.continuous).toBe(false);
    const log = spyHandlers(r);
    r.start();
    f.send("partial", { texts: ["hallo welt"], fin: true });
    let res = log.filter(([h]) => h === "onresult").map(([, ev]) => ev);
    expect(res).toHaveLength(1);
    expect(transcripts(res[0])).toEqual([["hallo welt", false]]); // Zwischenstand, kein Final
    expect(res[0].resultIndex).toBe(0);
    f.send("results", { texts: ["Hallo Welt."], scores: [0.8] });
    f.send("end");
    res = log.filter(([h]) => h === "onresult").map(([, ev]) => ev);
    expect(res).toHaveLength(2);
    expect(transcripts(res[1])).toEqual([["Hallo Welt.", true]]); // ersetzt den Zwischenstand, kein Doppel
    expect(res[1].results[0][0].confidence).toBe(0.8);
    expect(res[1].resultIndex).toBe(0);
    expect(log.some(([h]) => h === "onnomatch")).toBe(false);
  });

  it("continuous=false: fin-Partial läuft durch den normalen Zwischenstand-Zweig (unstable angehängt; leer ignoriert; ohne interimResults verschluckt)", () => {
    const f = fakeWin();
    const r = new (createBridgeRecognitionClass(f.win))(); r.interimResults = true;
    const log = spyHandlers(r);
    r.start();
    f.send("partial", { texts: ["hallo"], fin: true, unstable: " welt" });
    f.send("partial", { texts: ["  "], fin: true }); // leer: Zwischenstand bleibt
    const res = log.filter(([h]) => h === "onresult").map(([, ev]) => ev);
    expect(res).toHaveLength(1);
    expect(transcripts(res[0])).toEqual([["hallo welt", false]]);

    const g = fakeWin();
    const r2 = new (createBridgeRecognitionClass(g.win))(); // interimResults=false, continuous=false
    const log2 = spyHandlers(r2);
    r2.start();
    g.send("partial", { texts: ["hallo welt"], fin: true });
    expect(log2.filter(([h]) => h === "onresult")).toEqual([]);
    g.send("results", { texts: ["Hallo Welt."] });
    expect(log2.filter(([h]) => h === "onresult").map(([, ev]) => transcripts(ev))).toEqual([[["Hallo Welt.", true]]]);
  });

  it("Fehlercodes: 7 -> onnomatch, andere -> onerror mit gemapptem Code", () => {
    const f = fakeWin();
    const C = createBridgeRecognitionClass(f.win);
    const run = (events) => {
      const r = new C();
      const log = spyHandlers(r);
      r.start();
      for (const [t, x] of events) f.send(t, x);
      return log;
    };
    let log = run([["listening"], ["error", { code: 7 }], ["end"]]);
    expect(log.map(([h]) => h)).toEqual(["onstart", "onnomatch", "onend"]);
    log = run([["listening"], ["error", { code: 5 }], ["end"]]);
    expect(log[1][1]).toMatchObject({ error: "recognizer-unavailable", nativeCode: 5 });
    log = run([["listening"], ["ready"], ["error", { code: 5 }], ["end"]]);
    expect(log[2][1].error).toBe("aborted");
    // ERROR_CLIENT nach eigenem stop() (vor ready) ist ein normales Ende
    {
      const r = new C(); const l = spyHandlers(r);
      r.start(); f.send("listening"); r.stop(); f.send("error", { code: 5 }); f.send("end");
      expect(l[1][1].error).toBe("aborted");
    }
    log = run([["error", { code: BRIDGE_ERRORS.MIC_BLOCKED }], ["end"]]);
    expect(log.map(([h, ev]) => [h, ev.error])).toEqual([["onerror", "app-mic-blocked"], ["onend", undefined]]);
    log = run([["error", { code: "9" }], ["end"]]);
    expect(log[0][1]).toMatchObject({ error: "android-error", nativeCode: 0 });
  });

  it("stop/abort reichen die sid an Java; werfende Brücke wirft nicht weiter", () => {
    const f = fakeWin();
    const r = new (createBridgeRecognitionClass(f.win))();
    r.stop(); r.abort(); // vor start: no-op
    r.start();
    r.stop(); r.abort();
    const sid = f.lastSid();
    expect(f.calls.slice(1)).toEqual([["stop", sid], ["abort", sid]]);
    const g = fakeWin({ throwOn: "stop" });
    const r2 = new (createBridgeRecognitionClass(g.win))();
    r2.start();
    expect(() => r2.stop()).not.toThrow();
    const h = fakeWin({ throwOn: "abort" });
    const r3 = new (createBridgeRecognitionClass(h.win))();
    r3.start();
    expect(() => r3.abort()).not.toThrow();
  });

  it("Verteiler: kaputte Nachrichten, fremde sid, unbekannter Typ, werfender Handler", () => {
    const f = fakeWin();
    const r = new (createBridgeRecognitionClass(f.win))();
    const log = spyHandlers(r);
    r.onstart = () => { throw new Error("Handler kaputt"); };
    r.start();
    const cb = f.win[BRIDGE_CALLBACK];
    expect(() => {
      cb("{kaputt"); cb(42); cb(null); cb(JSON.stringify(null)); cb(JSON.stringify({ sid: 1, type: "end" }));
      cb(JSON.stringify({ sid: "fremd", type: "end" }));
      f.send("neuerTyp");
      f.send("listening"); // Handler wirft
    }).not.toThrow();
    f.send("end");
    expect(log.map(([h]) => h)).toEqual(["onend"]);
  });

  it("Verteiler wird ersetzt, falls jemand window.__notizbuchAndroidSpeech überschreibt", () => {
    const f = fakeWin();
    const C = createBridgeRecognitionClass(f.win);
    const r = new C(); const log = spyHandlers(r);
    r.start();
    f.win[BRIDGE_CALLBACK] = () => {};
    const r2 = new C(); const log2 = spyHandlers(r2);
    r2.start(); // installiert den Verteiler neu - bestehende Sitzungen bleiben erreichbar
    f.send("end", {}, f.calls[0][1]);
    f.send("end", {}, f.calls[1][1]);
    expect(log.map(([h]) => h)).toEqual(["onend"]);
    expect(log2.map(([h]) => h)).toEqual(["onend"]);
  });
});

describe("Integration mit createDictation (dictation.js)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(field = "Einkauf") {
    const f = fakeWin();
    const states = [];
    const errors = [];
    const box = { field };
    const d = createDictation({
      getCtor: () => getDictationCtor(f.win, () => null),
      lang: "de-DE",
      onText: (p, n) => { box.field = dictationStep(box.field, p, n); },
      onState: (s) => states.push(s),
      onError: (c) => errors.push(c),
    });
    return { f, d, states, errors, box };
  }

  it("Diktat mit Berechtigungsdialog: starting bleibt bis listening, Text wird angehängt, Ende ohne Fehler", () => {
    const { f, d, states, errors, box } = setup();
    expect(d.toggle()).toBe(true);
    expect(f.calls[0][2]).toEqual({ lang: "de-DE", partial: true, provider: "auto" });
    expect(d.getState()).toBe("starting");
    vi.advanceTimersByTime(30000); // Android-Dialog offen: kein Wächter
    expect(d.getState()).toBe("starting");
    f.send("listening");
    expect(d.getState()).toBe("listening");
    f.send("ready");
    f.send("partial", { texts: ["milch"], unstable: " und" });
    expect(box.field).toBe("Einkauf milch und");
    f.send("partial", { texts: ["milch und eier"] });
    f.send("results", { texts: ["Milch und Eier"] });
    expect(box.field).toBe("Einkauf Milch und Eier");
    f.send("end");
    expect(states).toEqual(["starting", "listening", "idle"]);
    expect(errors).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("App-Wechsel (Java: error -4 + end): Zwischentext bleibt, kein Hinweis", () => {
    const { f, d, errors, box } = setup();
    d.start();
    f.send("listening");
    f.send("partial", { texts: ["zwischen"] });
    f.send("error", { code: BRIDGE_ERRORS.APP_HIDDEN });
    f.send("end");
    expect(box.field).toBe("Einkauf zwischen");
    expect(d.getState()).toBe("idle");
    expect(errors).toEqual([]);
  });

  it("Berechtigung dauerhaft verweigert: Hinweis mit Einstellungs-Knopf", () => {
    const { f, d, errors } = setup();
    d.start();
    f.send("error", { code: BRIDGE_ERRORS.MIC_BLOCKED });
    f.send("end");
    expect(errors).toEqual(["app-mic-blocked"]);
    expect(dictationErrorInfo("app-mic-blocked", "unknown")).toMatchObject({ kind: "warn", action: "app-settings" });
  });

  it("Nutzer-Stopp: stop an Java, Endergebnis wird übernommen; Sprechpause ohne Text -> no-speech", () => {
    const { f, d, errors, box } = setup("");
    d.start();
    f.send("listening");
    vi.advanceTimersByTime(500);
    f.send("partial", { texts: ["hallo"] });
    d.toggle();
    expect(f.calls.map((c) => c[0])).toEqual(["start", "stop"]);
    expect(d.getState()).toBe("stopping");
    f.send("results", { texts: ["Hallo Welt"] });
    f.send("end");
    expect(box.field).toBe("Hallo Welt");
    expect(errors).toEqual([]);
    d.start();
    f.send("listening");
    f.send("error", { code: 6 });
    f.send("end");
    expect(errors).toEqual(["no-speech"]);
  });

  it("Antippen während starting bricht ab (abort an Java), späte Ereignisse ändern nichts", () => {
    const { f, d, errors, box, states } = setup();
    d.toggle();
    vi.advanceTimersByTime(500);
    d.toggle();
    expect(f.calls.map((c) => c[0])).toEqual(["start", "abort"]);
    f.send("error", { code: BRIDGE_ERRORS.ABORTED });
    f.send("end");
    expect(states).toEqual(["starting", "stopping", "idle"]);
    expect(box.field).toBe("Einkauf");
    expect(errors).toEqual([]);
  });

  it("Java antwortet nach stop nicht: Controller-Wachen beenden (abort, dann timeout)", () => {
    const { f, d, errors } = setup();
    d.start();
    f.send("listening");
    vi.advanceTimersByTime(500);
    d.stop();
    vi.advanceTimersByTime(3000);
    expect(f.calls.map((c) => c[0])).toEqual(["start", "stop", "abort"]);
    vi.advanceTimersByTime(1500);
    expect(d.getState()).toBe("idle");
    expect(errors).toEqual(["timeout"]);
    // spätes end der alten Sitzung stört die nächste nicht
    d.start();
    f.send("end", {}, f.calls[0][1]);
    expect(d.getState()).toBe("starting");
  });

  it("fin-Partial + abweichender Endtext (Formatierung): der Satz steht genau EINMAL im Feld (Controller fährt continuous=false)", () => {
    const { f, d, errors, box } = setup();
    d.start();
    f.send("listening");
    // Bei Doppel-Finals stünde hier "Einkauf hallo welt Hallo Welt." im Feld:
    // die Netz-Regel (transcriptFromResults) greift nur bei gleichem Text bzw.
    // Präfix an der Wortgrenze, "hallo welt" -> "Hallo Welt." ist keins von beidem.
    f.send("partial", { texts: ["hallo welt"], fin: true });
    expect(box.field).toBe("Einkauf hallo welt");
    f.send("results", { texts: ["Hallo Welt."] });
    f.send("end");
    expect(box.field).toBe("Einkauf Hallo Welt.");
    expect(box.field.match(/welt/gi)).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("fin-Partial ohne Endergebnis: der Zwischentext bleibt im Feld stehen, es geht nichts verloren", () => {
    const { f, d, errors, box } = setup();
    d.start();
    f.send("listening");
    f.send("partial", { texts: ["nur der Zwischentext"], fin: true });
    f.send("end"); // Java liefert kein results
    expect(box.field).toBe("Einkauf nur der Zwischentext");
    expect(d.getState()).toBe("idle");
    expect(errors).toEqual([]);
  });

  it("Leeres Endergebnis: ohne Text 'Nicht verstanden', nach Nutzer-Stopp still", () => {
    const { f, d, errors } = setup();
    d.start();
    f.send("listening");
    f.send("results", { texts: [] });
    f.send("end");
    expect(errors).toEqual(["nomatch"]);
    d.start();
    f.send("listening");
    vi.advanceTimersByTime(500);
    d.toggle(); // Nutzer beendet
    f.send("results", { texts: [] });
    f.send("end");
    expect(errors).toEqual(["nomatch"]);
  });

  it("Brücke wirft beim Start: start-failed", () => {
    const f = fakeWin({ throwOn: "start" });
    const errors = [];
    const d = createDictation({ getCtor: () => getDictationCtor(f.win, () => null), onError: (c) => errors.push(c) });
    expect(d.start()).toBe(false);
    expect(errors).toEqual(["start-failed"]);
  });
});

describe("Verfügbarkeit und Konstruktor-Wahl (dictation.js-Delta)", () => {
  it("alte APK (WebView ohne Brücke) -> aus; neue APK -> an, auch ohne webkitSpeechRecognition", () => {
    function Rec() {}
    expect(isDictationAvailable({ isSecureContext: true, webkitSpeechRecognition: Rec, navigator: { userAgent: WV_UA } })).toBe(false);
    const { win } = fakeWin();
    expect(isDictationAvailable(win)).toBe(true);
    expect(isDictationAvailable({ ...win, isSecureContext: false })).toBe(false);
    expect(isDictationAvailable({ isSecureContext: true, SpeechRecognition: Rec, navigator: { userAgent: CHROME_UA } })).toBe(true);
  });
  it("getDictationCtor: Brücke bevorzugt, 'webview' nimmt die Web Speech API, ohne Brücke unverändert", () => {
    function Web() {}
    const { win } = fakeWin();
    win.webkitSpeechRecognition = Web;
    const C = getDictationCtor(win, () => ({ engine: "native" }));
    expect(C).not.toBe(Web);
    expect(typeof C).toBe("function");
    expect(getDictationCtor(win, () => ({ engine: "webview" }))).toBe(Web);
    expect(typeof getDictationCtor(win, () => { throw new Error("x"); })).toBe("function");
    expect(getDictationCtor({ webkitSpeechRecognition: Web }, () => ({ engine: "native" }))).toBe(Web);
    expect(getDictationCtor(null)).toBe(null);
  });

  it("Erkenner 'WebView' nimmt beim Start frisch gelesen die Web Speech API: die Brücke bekommt keinen Aufruf", () => {
    const { win, calls } = fakeWin();
    const started = [];
    win.webkitSpeechRecognition = function Web() {
      this.start = () => started.push("web");
      this.stop = () => {};
      this.abort = () => {};
    };
    let prefs = { engine: "webview" };
    const d = createDictation({ getCtor: () => getDictationCtor(win, () => prefs), lang: "de-DE" });
    expect(d.start()).toBe(true);
    expect(started).toEqual(["web"]);
    expect(calls).toEqual([]);
    d.dispose();
    // Umschalten wirkt beim NÄCHSTEN Start, ohne den Controller neu anzulegen
    prefs = { engine: "native" };
    const d2 = createDictation({ getCtor: () => getDictationCtor(win, () => prefs), lang: "de-DE" });
    expect(d2.start()).toBe(true);
    expect(calls.map((c) => c[0])).toEqual(["start"]);
    expect(started).toEqual(["web"]);
    d2.dispose();
  });

  it("Erkenner 'WebView' ohne Web Speech API in der WebView -> Controller meldet 'unsupported', Brücke bleibt unberührt", () => {
    const { win, calls } = fakeWin();
    const errors = [];
    const d = createDictation({ getCtor: () => getDictationCtor(win, () => ({ engine: "webview" })), onError: (c) => errors.push(c) });
    expect(d.start()).toBe(false);
    expect(errors).toEqual(["unsupported"]);
    expect(calls).toEqual([]);
    expect(dictationErrorInfo("unsupported").text).toContain("nicht unterstützt");
  });

  it("die Brücken-Klasse läuft mit den Einstellungen aus dem Speicher (Satzzeichen, offline, Dienst) bis in speechStart", () => {
    const { win, calls } = fakeWin();
    const store = new Map([[SPEECH_PREFS_KEY, JSON.stringify({ provider: "ondevice", formatting: "quality", preferOffline: true })]]);
    const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
    const d = createDictation({ getCtor: () => getDictationCtor(win, () => readSpeechPrefs(storage)), lang: "de-AT" });
    d.start();
    const starts = () => calls.filter((c) => c[0] === "start").map((c) => c[2]);
    expect(starts()).toEqual([{ lang: "de-AT", partial: true, provider: "ondevice", formatting: "quality", preferOffline: true }]);
    d.dispose(); // bricht die Sitzung per abort ab (gehört nicht zu den Start-Aufrufen)
    // Nutzer stellt in den Einstellungen zurück: der nächste Start nimmt es ohne Neuladen
    writeSpeechPrefs(storage, { provider: "auto" });
    const d2 = createDictation({ getCtor: () => getDictationCtor(win, () => readSpeechPrefs(storage)), lang: "de-AT" });
    d2.start();
    expect(starts()[1]).toEqual({ lang: "de-AT", partial: true, provider: "auto" });
    d2.dispose();
  });
});

describe("Hinweistexte der App-Codes (dictation.js-Delta)", () => {
  it("jeder App-Code hat einen eigenen Text, Aktion nur wo sinnvoll", () => {
    const codes = ["app-mic-denied", "app-mic-blocked", "recognizer-mic-denied", "recognizer-busy", "recognizer-unavailable", "no-recognizer", "language-unavailable"];
    for (const c of codes) {
      const info = dictationErrorInfo(c, "unknown");
      expect(info.text).not.toMatch(/fehlgeschlagen \(/);
      expect(["info", "warn"]).toContain(info.kind);
    }
    expect(dictationErrorInfo("recognizer-mic-denied").action).toBe("recognizer-settings");
    expect(dictationErrorInfo("app-mic-denied").action).toBeUndefined();
    expect(dictationErrorInfo("recognizer-busy").kind).toBe("info");
    expect(dictationErrorInfo("android-error").text).toBe("Spracherkennung fehlgeschlagen (android-error).");
    // Jeder Code erklärt etwas anderes: keine zwei gleichen Texte.
    const texts = codes.map((c) => dictationErrorInfo(c).text);
    expect(new Set(texts).size).toBe(codes.length);
  });

  it("nur die beiden Berechtigungs-Hinweise mit Einstellungs-Sprung; der Text verweist auf den Knopf", () => {
    const withAction = ["app-mic-denied", "app-mic-blocked", "recognizer-mic-denied", "recognizer-busy", "recognizer-unavailable", "no-recognizer", "language-unavailable"]
      .filter((c) => dictationErrorInfo(c).action);
    expect(withAction).toEqual(["app-mic-blocked", "recognizer-mic-denied"]);
    expect(dictationErrorInfo("app-mic-blocked")).toMatchObject({ kind: "warn", action: "app-settings" });
    expect(dictationErrorInfo("app-mic-blocked").text).toContain("Einstellungen öffnen");
    expect(dictationErrorInfo("recognizer-mic-denied").text).toContain("Speech Services by Google");
  });

  it("ein Code ohne Hinweis (aborted) und Fremdtext als Code bleiben wie in v7.59", () => {
    expect(dictationErrorInfo("aborted")).toBe(null);
    expect(dictationErrorInfo("<img src=x onerror=alert(1)>").text).toBe("Spracherkennung fehlgeschlagen.");
  });

  it("resolveDictationError: Brücken-Codes ohne Berechtigungsabfrage, action bleibt für den Knopf in der Hinweiszeile erhalten", async () => {
    const query = vi.fn(async () => "denied");
    for (const code of ["app-mic-blocked", "recognizer-mic-denied", "app-mic-denied", "no-recognizer"]) {
      const info = await resolveDictationError(code, query);
      expect(info).toEqual(dictationErrorInfo(code, "unknown"));
    }
    expect(query).not.toHaveBeenCalled(); // permissions.query liefert in der WebView ohnehin immer "prompt"
    expect((await resolveDictationError("recognizer-mic-denied", query)).action).toBe("recognizer-settings");
  });
});

describe("buildDiagnosticsText", () => {
  it("enthält Brücke, Einstellungen und Protokoll", () => {
    const { win } = fakeWin();
    const t = buildDiagnosticsText(win, { engine: "webview" }, "v7.60");
    expect(t).toContain("Web-App: v7.60");
    expect(t).toContain('"sdk":34');
    expect(t).toContain('"engine":"webview"');
    expect(t).toContain("+0.300s ready d1");
    expect(t).toContain(WV_UA);
  });
  it("ohne Brücke / ohne navigator", () => {
    const t = buildDiagnosticsText({}, null);
    expect(t).toContain("Brücke: nicht vorhanden");
    expect(t).toContain("Web-App: ?");
    expect(t).toContain("Protokoll (0):");
    const throwing = {};
    Object.defineProperty(throwing, "navigator", { get() { throw new Error("x"); } });
    expect(buildDiagnosticsText(throwing, null)).toContain("User-Agent: \n");
  });
  const settingsLine = (t) => t.split("\n").find((l) => l.startsWith("Einstellungen: "));

  it("Einstellungen: genau die vier bekannten Felder, Fremdfelder des übergebenen Objekts (pat/apiKey/token, auch verschachtelt) fehlen", () => {
    const { win } = fakeWin();
    const prefs = {
      engine: "webview", provider: "ondevice", formatting: "quality", preferOffline: true,
      pat: "ghp_FREMD_PAT", apiKey: "sk-ant-FREMD_KEY", token: "FREMD_TOKEN", nested: { secret: "FREMD_NESTED" },
    };
    const t = buildDiagnosticsText(win, prefs, "v7.60");
    expect(t).not.toContain("FREMD");
    // Die Zeile ist EXAKT das sanitisierte Objekt (kein Feld mehr, keins weniger).
    expect(JSON.parse(settingsLine(t).slice("Einstellungen: ".length))).toEqual({
      engine: "webview", provider: "ondevice", formatting: "quality", preferOffline: true,
    });
    // Ohne Objekt (null/Müll) erscheinen die Standardwerte statt Fremdinhalt.
    for (const bad of [null, undefined, "pat=ghp_FREMD_PAT", 42]) {
      const u = buildDiagnosticsText(win, bad, "v7.60");
      expect(settingsLine(u)).toBe('Einstellungen: {"engine":"native","provider":"auto","formatting":"off","preferOffline":false}');
      expect(u).not.toContain("FREMD");
    }
  });

  it("liest weder localStorage noch sessionStorage: Zugangsdaten im Speicher gelangen nie in die Diagnose", () => {
    const { win } = fakeWin();
    const getItem = vi.fn(() => JSON.stringify({ pat: "ghp_SPEICHER_PAT", apiKey: "sk-ant-SPEICHER_KEY" }));
    win.localStorage = { getItem, key: vi.fn(), length: 1 };
    win.sessionStorage = { getItem: vi.fn(() => "SPEICHER_SESSION") };
    const t = buildDiagnosticsText(win, { engine: "native" }, "v7.60");
    expect(getItem).not.toHaveBeenCalled();
    expect(win.localStorage.key).not.toHaveBeenCalled();
    expect(win.sessionStorage.getItem).not.toHaveBeenCalled();
    expect(t).not.toContain("SPEICHER");
  });

  it("Brücke: ein gültiges getInfo-JSON erscheint unverändert (auch neue Felder einer künftigen APK), ein ungültiges nie", () => {
    // Bewusst KEIN Feld-Filter auf der Web-Seite: Die Diagnose soll genau
    // zeigen, was die APK meldet. Dass dort keine Zugangsdaten stehen, ist
    // Vertrag der Java-Seite (getInfo hat feste Felder, siehe SpeechBridge).
    const info = { bridge: 1, sdk: 35, neuesFeld: "von-einer-neueren-APK", features: ["speech", "neu"] };
    const t = buildDiagnosticsText(fakeWin({ info: JSON.stringify(info) }).win, null, "v7.60");
    const line = t.split("\n").find((l) => l.startsWith("Brücke: "));
    expect(JSON.parse(line.slice("Brücke: ".length))).toEqual(info);
    // Ungültig (bridge < 1, kein JSON, kein Objekt): "nicht vorhanden", der Rohtext wird NICHT ausgegeben.
    for (const raw of [JSON.stringify({ bridge: 0, pat: "ghp_ROH_PAT" }), "kein json ghp_ROH_PAT", JSON.stringify("ghp_ROH_PAT")]) {
      const u = buildDiagnosticsText(fakeWin({ info: raw }).win, null, "v7.60");
      expect(u).toContain("Brücke: nicht vorhanden");
      expect(u).not.toContain("ROH_PAT");
    }
  });

  it("Protokoll: Länge in der Überschrift stimmt, Nicht-Strings aus getLog fallen heraus", () => {
    const { win } = fakeWin({ log: JSON.stringify(["+0.1s start d1", { transcript: "geheimer Satz" }, 7, "+0.2s end d1"]) });
    const t = buildDiagnosticsText(win, null, "v7.60");
    expect(t).toContain("Protokoll (2):\n+0.1s start d1\n+0.2s end d1");
    expect(t).not.toContain("geheimer Satz");
  });
});

describe("Einstellungs-Abschnitt 'Spracheingabe (Android-App)' (SettingsDialog, statisch gerendert)", () => {
  const noop = () => {};
  const baseProps = {
    initial: null, model: "sonnet-5", onModelChange: noop, onSave: noop, onProvidersChange: noop,
    onLogout: noop, onClose: noop, connecting: false, error: null,
  };

  // SettingsDialog liest window nur für Brücke und localStorage; die node-
  // Testumgebung hat keines, deshalb ein Fake setzen und IMMER zurücknehmen.
  function renderSettings(win, props = {}) {
    const had = "window" in globalThis;
    const prev = globalThis.window;
    if (win === undefined) delete globalThis.window; else globalThis.window = win;
    try {
      return renderToStaticMarkup(createElement(SettingsDialog, { ...baseProps, hasSettings: true, ...props }));
    } finally {
      if (had) globalThis.window = prev; else delete globalThis.window;
    }
  }
  const withStorage = (win, raw) => ({ ...win, localStorage: { getItem: () => raw, setItem: () => {} } });
  // Nur den Abschnitt ab seiner Markierung auswerten: der AutoKorrektur-
  // Abschnitt davor enthält ebenfalls ein angehaktes Kontrollkästchen.
  const speechSection = (html) => {
    const i = html.indexOf("data-android-speech");
    expect(i, "Abschnitt fehlt").toBeGreaterThan(-1);
    return html.slice(i);
  };

  it("ohne Brücke (Browser, alte APK, ohne window) fehlt der Abschnitt", () => {
    const { win } = fakeWin();
    const { NotizbuchAndroid, ...ohneBruecke } = win;
    const { speechAbort, ...halb } = NotizbuchAndroid; // eslint-disable-line no-unused-vars
    for (const w of [undefined, {}, ohneBruecke, { ...ohneBruecke, NotizbuchAndroid: halb }]) {
      const html = renderSettings(w);
      expect(html).not.toContain("data-android-speech");
      expect(html).not.toContain("Spracheingabe (Android-App)");
    }
  });

  it("mit Brücke erscheint er, unabhängig vom Verbindungszustand; die Diagnose bleibt bis zum Klick verborgen", () => {
    const { win } = fakeWin();
    for (const hasSettings of [true, false]) {
      const html = renderSettings(win, { hasSettings });
      expect(html).toContain("data-android-speech");
      expect(html).toContain("Spracheingabe (Android-App)");
      expect(html).toContain("Diagnose anzeigen");
      expect(html).not.toContain("data-android-speech-diag");
      expect(html).not.toContain(">Kopieren<");
    }
  });

  it("Standardwerte ohne gespeicherte Einstellungen: Android-Erkenner, automatischer Dienst, Satzzeichen aus, online", () => {
    const html = speechSection(renderSettings(fakeWin().win));
    expect(html).toMatch(/<option value="native" selected="">/);
    expect(html).toMatch(/<option value="auto" selected="">/);
    expect(html).toMatch(/<option value="off" selected="">/);
    expect(html).not.toMatch(/<input type="checkbox" checked=""/);
  });

  it("gespeicherte Geräte-Einstellungen werden vorbelegt", () => {
    const raw = JSON.stringify({ engine: "webview", provider: "ondevice", formatting: "latency", preferOffline: true });
    const html = speechSection(renderSettings(withStorage(fakeWin().win, raw)));
    expect(html).toMatch(/<option value="webview" selected="">/);
    expect(html).toMatch(/<option value="ondevice" selected="">/);
    expect(html).toMatch(/<option value="latency" selected="">/);
    expect(html).toMatch(/<input type="checkbox" checked=""/);
    expect(html).not.toMatch(/<option value="native" selected="">/);
  });

  it("manipulierter, kaputter oder nicht lesbarer Speicher fällt auf die Standardwerte zurück", () => {
    const hostile = JSON.stringify({ engine: "<script>x</script>", provider: "com.evil.app", formatting: "../../x", preferOffline: "true" });
    for (const raw of [hostile, "{kaputt", "null", "[]"]) {
      const html = speechSection(renderSettings(withStorage(fakeWin().win, raw)));
      expect(html).toMatch(/<option value="native" selected="">/);
      expect(html).toMatch(/<option value="auto" selected="">/);
      expect(html).toMatch(/<option value="off" selected="">/);
      expect(html).not.toContain("<script>x");
      expect(html).not.toMatch(/<input type="checkbox" checked=""/);
    }
    const gesperrt = { ...fakeWin().win };
    Object.defineProperty(gesperrt, "localStorage", { get() { throw new Error("SecurityError"); } });
    expect(speechSection(renderSettings(gesperrt))).toMatch(/<option value="native" selected="">/);
  });
});

// Der Versionsstring steht zweimal in App.jsx (Kopfzeile und appVersion-Prop
// für die Diagnose). Beim Versions-Bump vergisst man leicht das zweite
// Literal; dann stünde in der kopierten Diagnose eine falsche Version und
// die Fern-Fehlersuche liefe auf der falschen Fährte.
describe("Versionsstring in App.jsx", () => {
  it("Kopfzeile und appVersion für die Diagnose zeigen dieselbe Version", () => {
    const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
    const header = src.match(/font-mono text-xs text-slate-400">(v\d+\.\d+(?:\.\d+)?)</);
    const prop = src.match(/appVersion="(v\d+\.\d+(?:\.\d+)?)"/);
    expect(header, "Versionsstring in der Kopfzeile nicht gefunden").not.toBeNull();
    expect(prop, "appVersion-Prop am SettingsDialog nicht gefunden").not.toBeNull();
    expect(prop[1]).toBe(header[1]);
  });
});
