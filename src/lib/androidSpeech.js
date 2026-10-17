// Spracheingabe in der eigenen Android-App (android/), DECISIONS #140.
//
// Die APK stellt window.NotizbuchAndroid bereit (SpeechBridge.java) und
// liefert bewusst nur einen ROHEN Ereignisstrom der Android-Spracherkennung
// (android.speech.SpeechRecognizer): listening, ready, beginning,
// endofspeech, partial, segment, results, error (Zahlencode), end - genau
// EIN "end" pro Sitzungs-ID (sid). Die Übersetzung in die Semantik der Web
// Speech API passiert HIER: so ist sie per Vitest prüfbar und lässt sich
// ohne APK-Update (nur Pages-Deploy) korrigieren. Die APK ändert sich fast
// nie, die Web-App oft.
//
// createBridgeRecognitionClass() liefert eine Klasse im SpeechRecognition-
// Vertrag (lang/continuous/interimResults/maxAlternatives, start/stop/abort,
// on*-Handler, event.results als Liste von Ergebnis-Arrays mit isFinal).
// Der Controller createDictation() in dictation.js bleibt dadurch
// unverändert; getDictationCtor() (dictation.js) hängt die Klasse ein.
//
// Wie dictation.js: KEIN Zugriff auf globale window/navigator/localStorage
// beim Import - alles kommt als Parameter (Tests laufen in node).

export const BRIDGE_NAME = "NotizbuchAndroid";
export const BRIDGE_CALLBACK = "__notizbuchAndroidSpeech";
export const SPEECH_PREFS_KEY = "notizbuch.androidSpeech.v1";

// Muss zur Java-Seite passen (SpeechBridge.ERR_*). Positive Codes sind die
// SpeechRecognizer.ERROR_*-Werte von Android.
export const BRIDGE_ERRORS = Object.freeze({
  MIC_DENIED: -1,
  MIC_BLOCKED: -2,
  START_FAILED: -3,
  APP_HIDDEN: -4,
  ABORTED: -5,
  NOT_APP_PAGE: -6,
  NO_RECOGNIZER: -7,
  NATIVE_TIMEOUT: -8,
});

const REQUIRED_METHODS = ["getInfo", "speechStart", "speechStop", "speechAbort"];
const LANG_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,3}$/;
const PKG_RE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;

/* ---------- Brücke finden und lesen ---------- */

// Die Brücke gilt nur als vorhanden, wenn ALLE Pflicht-Methoden da sind
// (ein halbes Objekt - z. B. eine künftige, umgebaute APK - zählt nicht).
// Nur typeof-Prüfungen: KEIN Java-Aufruf, also billig genug für jeden Render.
export function getAndroidBridge(win) {
  try {
    const b = win ? win[BRIDGE_NAME] : null;
    if (!b || typeof b !== "object") return null;
    for (const m of REQUIRED_METHODS) {
      if (typeof b[m] !== "function") return null;
    }
    return b;
  } catch {
    return null;
  }
}

// getInfo() ist ein synchroner Java-Aufruf mit Paketmanager-Abfragen: NUR
// für Diagnose/Hinweise benutzen, nie pro Render.
export function readBridgeInfo(win) {
  const b = getAndroidBridge(win);
  if (!b) return null;
  try {
    const info = JSON.parse(b.getInfo());
    if (!info || typeof info !== "object" || !Number.isInteger(info.bridge) || info.bridge < 1) return null;
    return info;
  } catch {
    return null;
  }
}

export function readBridgeLog(win) {
  const b = getAndroidBridge(win);
  if (!b || typeof b.getLog !== "function") return [];
  try {
    const list = JSON.parse(b.getLog());
    return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// which: "app" (eigene App-Einstellungen) oder "recognizer" (App-Info des
// Erkennungsdienstes, Paket aus getInfo().autoProvider; Java prüft das Paket
// gegen die installierten RecognitionServices).
export function openAndroidSettings(win, which) {
  const b = getAndroidBridge(win);
  if (!b || typeof b.openSettings !== "function") return false;
  let target = "app";
  if (which === "recognizer") {
    const info = readBridgeInfo(win);
    const pkg = info && typeof info.autoProvider === "string" ? info.autoProvider.split("/")[0] : "";
    if (PKG_RE.test(pkg)) target = pkg;
  }
  try {
    b.openSettings(target);
    return true;
  } catch {
    return false;
  }
}

/* ---------- Geräte-Einstellungen (nur dieses Gerät, localStorage) ---------- */

export const DEFAULT_SPEECH_PREFS = Object.freeze({
  engine: "native", // "native" = Brücke, "webview" = Web Speech API der WebView (Rückfall/Diagnose)
  provider: "auto", // "auto" = wie Chrome (Google-Dienst), "default" = System-Standard, "ondevice"
  formatting: "off", // "off" | "quality" | "latency" (Satzzeichen, ab Android 13, Wirkung je Dienst)
  preferOffline: false,
});

export function sanitizeSpeechPrefs(p) {
  const o = p && typeof p === "object" ? p : {};
  return {
    engine: o.engine === "webview" ? "webview" : "native",
    provider: o.provider === "default" || o.provider === "ondevice" ? o.provider : "auto",
    formatting: o.formatting === "quality" || o.formatting === "latency" ? o.formatting : "off",
    preferOffline: o.preferOffline === true,
  };
}

// storage darf fehlen oder werfen (privater Modus, gesperrter Speicher).
export function readSpeechPrefs(storage) {
  try {
    const raw = storage ? storage.getItem(SPEECH_PREFS_KEY) : null;
    return sanitizeSpeechPrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return sanitizeSpeechPrefs(null);
  }
}

export function writeSpeechPrefs(storage, prefs) {
  const clean = sanitizeSpeechPrefs(prefs);
  try {
    storage.setItem(SPEECH_PREFS_KEY, JSON.stringify(clean));
    return true;
  } catch {
    return false;
  }
}

// Startoptionen für speechStart(sid, json). Die Java-Seite prüft/klemmt
// jeden Wert erneut (Vertrauensgrenze), hier nur Vorbelegung.
export function buildStartOptions(rec, prefs) {
  const p = sanitizeSpeechPrefs(prefs);
  const r = rec || {};
  const o = {
    lang: typeof r.lang === "string" && LANG_RE.test(r.lang) ? r.lang : "de-DE",
    partial: r.interimResults === true,
    provider: p.provider,
  };
  if (p.formatting !== "off") o.formatting = p.formatting;
  if (p.preferOffline) o.preferOffline = true;
  // continuous: segmentierte Sitzung (Android 13+, Höchstwert des Google-
  // Dienstes laut Chromium). Der Controller setzt continuous = false - die
  // Option ist für ein späteres "längeres Diktat" ohne APK-Update vorbereitet.
  if (r.continuous === true) o.segmentedMs = 300000;
  return o;
}

/* ---------- Fehlercodes ---------- */

// Android-/Brücken-Code -> Fehlercode im Stil der Web Speech API. Codes, die
// es in der Web-Spezifikation nicht gibt, bekommen eigene Namen mit eigenem
// Hinweistext (dictationErrorInfo). Alle Namen passen auf
// /^[a-z][a-z-]{0,39}$/. ERROR_CLIENT (5) VOR "ready" heißt: Dienst nicht
// erreichbar (Bindung gescheitert) - danach ist es Chromes "aborted".
export function mapNativeError(code, sawReady) {
  switch (code) {
    case 1: // ERROR_NETWORK_TIMEOUT
    case 2: // ERROR_NETWORK
    case 4: // ERROR_SERVER
      return "network";
    case 3: return "audio-capture";
    case 5: return sawReady ? "aborted" : "recognizer-unavailable";
    case 6: return "no-speech";
    case 7: return "nomatch";
    case 8: // ERROR_RECOGNIZER_BUSY
    case 10: // ERROR_TOO_MANY_REQUESTS
      return "recognizer-busy";
    case 9: return "recognizer-mic-denied"; // App hat RECORD_AUDIO (vorher geprüft) -> dem Dienst fehlt es
    case 11: return "recognizer-unavailable"; // ERROR_SERVER_DISCONNECTED
    case 12: // ERROR_LANGUAGE_NOT_SUPPORTED
    case 13: // ERROR_LANGUAGE_UNAVAILABLE
      return "language-unavailable";
    case BRIDGE_ERRORS.MIC_DENIED: return "app-mic-denied";
    case BRIDGE_ERRORS.MIC_BLOCKED: return "app-mic-blocked";
    case BRIDGE_ERRORS.START_FAILED: return "start-failed";
    case BRIDGE_ERRORS.APP_HIDDEN:
    case BRIDGE_ERRORS.ABORTED:
      return "aborted";
    case BRIDGE_ERRORS.NOT_APP_PAGE: return "service-not-allowed";
    case BRIDGE_ERRORS.NO_RECOGNIZER: return "no-recognizer";
    case BRIDGE_ERRORS.NATIVE_TIMEOUT: return "timeout";
    default: return "android-error";
  }
}

/* ---------- Ereignis-Verteiler ---------- */

// Ein Verteiler pro Fenster: window.__notizbuchAndroidSpeech(jsonString)
// wird von Java per evaluateJavascript (nur Hauptframe) aufgerufen und
// reicht die Nachricht an die Instanz mit passender sid weiter. Unbekannte
// sid (z. B. Sitzung einer vorherigen Seite), kaputtes JSON, falsche Typen:
// still verwerfen.
const dispatchers = new WeakMap();

function ensureDispatcher(win) {
  const known = dispatchers.get(win);
  if (known && win[BRIDGE_CALLBACK] === known.fn) return known.map;
  const map = known ? known.map : new Map();
  const fn = (raw) => {
    let msg;
    try {
      msg = typeof raw === "string" ? JSON.parse(raw) : null;
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object" || typeof msg.sid !== "string" || typeof msg.type !== "string") return;
    const handler = map.get(msg.sid);
    if (handler) handler(msg);
  };
  win[BRIDGE_CALLBACK] = fn;
  dispatchers.set(win, { map, fn });
  return map;
}

/* ---------- SpeechRecognition-kompatible Klasse ---------- */

const HANDLERS = [
  "onstart", "onaudiostart", "onsoundstart", "onspeechstart",
  "onspeechend", "onsoundend", "onaudioend",
  "onresult", "onnomatch", "onerror", "onend",
];

let sidCounter = 0;

function firstText(msg) {
  return Array.isArray(msg.texts) && typeof msg.texts[0] === "string" ? msg.texts[0] : "";
}

function firstScore(msg) {
  const s = Array.isArray(msg.scores) ? msg.scores[0] : undefined;
  return typeof s === "number" && s >= 0 && s <= 1 ? s : 0;
}

function makeResult(transcript, confidence, isFinal) {
  const r = [{ transcript, confidence }];
  r.isFinal = isFinal;
  r.item = (i) => r[i] || null;
  return r;
}

// getPrefs: () => Prefs-Objekt, wird bei JEDEM start() gelesen.
export function createBridgeRecognitionClass(win, getPrefs) {
  const bridge = getAndroidBridge(win);
  if (!bridge) return null;
  const readPrefs = typeof getPrefs === "function" ? getPrefs : () => null;

  return class BridgeSpeechRecognition {
    constructor() {
      this.lang = "";
      this.continuous = false;
      this.interimResults = false;
      this.maxAlternatives = 1;
      for (const h of HANDLERS) this[h] = null;
      this._sid = null;
      this._state = "new"; // new -> running -> ended (eine Instanz = eine Sitzung, wie im Browser)
      this._finals = []; // [{ text, confidence }]
      this._interim = "";
      this._sawReady = false;
      this._stopRequested = false;
    }

    start() {
      if (this._state !== "new") {
        const e = new Error("Spracherkennung wurde bereits gestartet.");
        e.name = "InvalidStateError";
        throw e;
      }
      const map = ensureDispatcher(win);
      let prefs = null;
      try { prefs = readPrefs(); } catch { prefs = null; }
      const opts = buildStartOptions(this, prefs);
      const sid = "d" + Date.now().toString(36) + "-" + (++sidCounter).toString(36);
      this._sid = sid;
      this._state = "running";
      map.set(sid, (msg) => this._onNative(msg));
      try {
        bridge.speechStart(sid, JSON.stringify(opts));
      } catch (e) {
        map.delete(sid);
        this._state = "ended";
        throw e; // Controller meldet start-failed
      }
    }

    // stop/abort: Ergebnis (results/error + end) kommt asynchron von Java.
    // Wirft die Brücke, greifen die Wachen des Controllers (STOP_MS/ABORT_MS).
    stop() {
      if (this._state !== "running") return;
      this._stopRequested = true;
      try { bridge.speechStop(this._sid); } catch { /* Controller-Wache */ }
    }

    abort() {
      if (this._state !== "running") return;
      this._stopRequested = true;
      try { bridge.speechAbort(this._sid); } catch { /* Controller-Wache */ }
    }

    _fire(name, ev) {
      const h = this[name];
      if (typeof h !== "function") return;
      // Ein werfender Handler darf den Verteiler nicht stören (der Browser
      // meldet Handler-Fehler auch nur und arbeitet weiter).
      try { h.call(this, ev || { type: name.slice(2) }); } catch { /* egal */ }
    }

    _results() {
      const list = this._finals.map((f) => makeResult(f.text, f.confidence, true));
      if (this._interim) list.push(makeResult(this._interim, 0, false));
      return list;
    }

    _emitResults(resultIndex) {
      this._fire("onresult", { type: "result", resultIndex, results: this._results() });
    }

    _addFinal(text, confidence) {
      this._finals.push({ text, confidence });
      this._interim = "";
      this._emitResults(this._finals.length - 1);
    }

    _onNative(msg) {
      if (this._state !== "running") return;
      switch (msg.type) {
        case "listening": // startListening ist durch (Mikrofon-Berechtigung liegt vor)
          this._fire("onstart");
          break;
        case "ready":
          this._sawReady = true;
          this._fire("onaudiostart");
          break;
        case "beginning":
          this._fire("onsoundstart");
          this._fire("onspeechstart");
          break;
        case "endofspeech":
          this._fire("onspeechend");
          this._fire("onsoundend");
          this._fire("onaudioend");
          break;
        case "partial": {
          const stable = firstText(msg);
          // final_result-Flag des Google-Dienstes (undokumentiert; Dauer-Modus
          // vor Android 13): ein abgeschlossener Abschnitt. NUR bei
          // continuous === true ein Final. Der Controller fährt immer
          // continuous = false; dort kommt das Endergebnis regulär per
          // "results" - zählte das fin-Partial hier schon als Final, stünden
          // bei abweichendem Endtext (Formatierung, Re-Ranking) ZWEI Finals im
          // Feld. Verloren geht im Einzelmodus nichts: der zuletzt angezeigte
          // Zwischentext bleibt im Feld stehen, bis "results" ihn ersetzt.
          // Ohne continuous fällt das fin-Partial in den normalen Zweig
          // (Zwischentext ersetzen). DECISIONS #140.
          if (msg.fin === true && this.continuous === true) {
            if (stable.trim()) this._addFinal(stable, firstScore(msg));
            break;
          }
          if (!this.interimResults) break;
          // UNSTABLE_TEXT (undokumentiertes Google-Extra, wie Chrome ab 157):
          // stabiler Teil + unsicherer Rest ergibt den vollständigen Stand.
          const full = stable + (typeof msg.unstable === "string" ? msg.unstable : "");
          if (!full.trim()) break;
          this._interim = full;
          this._emitResults(this._finals.length);
          break;
        }
        case "segment":
        case "results": {
          const t = firstText(msg);
          if (t.trim()) {
            this._addFinal(t, firstScore(msg));
          } else if (msg.type === "results" && !this._finals.length && !this._interim) {
            // Leeres Endergebnis ganz ohne Text (manche Dienste statt
            // ERROR_NO_MATCH): als nomatch melden. Kam schon Text, bleibt
            // der letzte Zwischenstand stehen (wie Chrome, kein Ereignis).
            this._fire("onnomatch", { type: "nomatch", results: [] });
          }
          break;
        }
        case "error": {
          const code = Number.isInteger(msg.code) ? msg.code : 0;
          if (code === 7) {
            // ERROR_NO_MATCH: in der Web Speech API ein eigenes Ereignis.
            this._fire("onnomatch", { type: "nomatch", results: this._results() });
          } else {
            // ERROR_CLIENT nach eigenem stop/abort ist ein normales Ende,
            // kein "Dienst nicht erreichbar".
            const started = this._sawReady || this._stopRequested;
            this._fire("onerror", { type: "error", error: mapNativeError(code, started), message: "", nativeCode: code });
          }
          break;
        }
        case "end": {
          this._state = "ended";
          const d = dispatchers.get(win);
          if (d) d.map.delete(this._sid);
          this._fire("onend");
          break;
        }
        default:
          break; // unbekannter Typ (neuere APK): ignorieren
      }
    }
  };
}

/* ---------- Diagnose (Einstellungen -> Spracheingabe) ---------- */

// Text zum Kopieren für Fern-Diagnose: enthält KEINE Transkripte (die Java-
// Seite protokolliert nur Längen) und KEINE Zugangsdaten.
export function buildDiagnosticsText(win, prefs, appVersion) {
  const info = readBridgeInfo(win);
  const log = readBridgeLog(win);
  let ua = "";
  try { ua = String((win && win.navigator && win.navigator.userAgent) || ""); } catch { ua = ""; }
  return [
    "Notizbuch – Diagnose Spracheingabe",
    "Web-App: " + (appVersion || "?"),
    "User-Agent: " + ua,
    "Brücke: " + (info ? JSON.stringify(info) : "nicht vorhanden"),
    "Einstellungen: " + JSON.stringify(sanitizeSpeechPrefs(prefs)),
    "Protokoll (" + log.length + "):",
    ...log,
  ].join("\n");
}
