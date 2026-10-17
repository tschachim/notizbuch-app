// Spracheingabe (Diktat) am Chat-Eingabefeld, v7.59 (DECISIONS #139).
//
// Reine Logik plus ein kleiner Controller um die Web Speech API
// (SpeechRecognition). Bewusst OHNE React und OHNE Zugriff auf globale
// window/navigator/document: alles Browser-Spezifische (Konstruktor,
// Sprache, Berechtigungsabfrage, Uhr) kommt als Parameter herein. Dadurch
// laufen die Unit-Tests in der node-Umgebung gegen eine Fake-Erkennerklasse,
// und beim Import dieser Datei passiert nichts.
//
// Leitentscheidungen (Begründung in DECISIONS #139):
// - Pro Antippen GENAU EINE Sitzung (continuous = false), kein automatischer
//   Neustart. Chrome Android macht im continuous-Modus (bis einschließlich
//   Version 156) jedes Teilergebnis zum Final, die Ergebnisliste wächst dann
//   kumulativ ("hallo", "hallo wie", "hallo wie geht"). Eine Sitzung pro
//   Diktat plus die Netz-Regel in transcriptFromResults() umgeht das.
// - Pro Diktat eine NEUE Erkenner-Instanz (start() auf einer laufenden
//   Instanz wirft InvalidStateError).
// - KEIN Schnappschuss des Feldtexts: jedes Ergebnis wird per dictationStep()
//   in den AKTUELLEN Feldtext eingespleißt und ersetzt dort nur das eigene,
//   unveränderte Endstück. Andere Schreiber auf das Feld (Schnellnotiz-
//   Übernahme, Wiederherstellung nach Sendefehler) werden so nie
//   überschrieben; passt das Endstück nicht mehr, bleibt das Feld
//   unverändert (das Diktat "koppelt sich ab").
// - Android-App (v7.60, DECISIONS #140): Der Controller bleibt unverändert.
//   Die eigene APK stellt über window.NotizbuchAndroid eine native Brücke
//   bereit; lib/androidSpeech.js liefert dazu eine SpeechRecognition-
//   kompatible Klasse, getDictationCtor() wählt sie bzw. die Web Speech API,
//   und die Hinweistexte unten kennen die Brücken-Fehlercodes.

import { getAndroidBridge, createBridgeRecognitionClass, sanitizeSpeechPrefs } from "./androidSpeech.js";

export const DICTATION_TIMEOUTS = Object.freeze({
  STOP_MS: 3000, // nach stop(): so lange auf "end" warten, dann abort()
  ABORT_MS: 1500, // nach abort()/error: so lange auf "end" warten, dann Zwangs-Ende
  MAX_MS: 60000, // Deckel pro Abschnitt ab "listening"
  TAP_GUARD_MS: 400, // zweiter Tipp so kurz nach dem Start wird ignoriert
});

/* ---------- Verfügbarkeit ---------- */

// Chrome (ab 139) kennt SpeechRecognition unpräfixiert, ältere Chrome/Edge/
// Safari nur webkitSpeechRecognition. Bei JEDEM Aufruf frisch lesen: Tests
// (und Browser-Erweiterungen) können die API zur Laufzeit ersetzen oder
// entfernen. Ein Nicht-Funktions-Wert (z. B. ein Platzhalter-Objekt) zählt
// als "nicht vorhanden", damit dann noch der präfixierte Name versucht wird.
export function getSpeechRecognitionCtor(win) {
  try {
    if (!win) return null;
    const plain = win.SpeechRecognition;
    if (typeof plain === "function") return plain;
    const prefixed = win.webkitSpeechRecognition;
    if (typeof prefixed === "function") return prefixed;
    return null;
  } catch {
    // z. B. ein werfender Getter (gesperrte Fenster-Umgebung)
    return null;
  }
}

// WebViews erkennt man am "; wv)" im User-Agent. Die ALTE APK (versionCode 1,
// ohne Brücke) ist eine WebView ohne RECORD_AUDIO und ohne
// onPermissionRequest: dort bleibt der Knopf aus. Die neue APK erkennt man
// an der Brücke window.NotizbuchAndroid (DECISIONS #140).
export function isAndroidWebView(userAgent) {
  return typeof userAgent === "string" && /;\s*wv\)/.test(userAgent);
}

// Knopf nur zeigen, wenn Diktat überhaupt Aussicht auf Erfolg hat. Die
// Mikrofon-Berechtigung wird hier bewusst NICHT geprüft (sie ist erst beim
// Antippen entscheidbar, und permissions.query() ist nicht überall für das
// Mikrofon verfügbar) - das passiert nur nach einem not-allowed-Fehler.
// Die Brücken-Prüfung sind reine typeof-Abfragen (kein Java-Aufruf), also
// pro Render vertretbar.
export function isDictationAvailable(win) {
  try {
    if (!win || win.isSecureContext === false) return false;
    if (getAndroidBridge(win)) return true; // eigene APK ab versionCode 2
    if (!getSpeechRecognitionCtor(win)) return false;
    const ua = win.navigator && win.navigator.userAgent;
    return !isAndroidWebView(ua);
  } catch {
    return false;
  }
}

// Konstruktor für createDictation({ getCtor }): in der eigenen APK die
// Brücken-Klasse (natives android.speech.SpeechRecognizer), außer der
// Nutzer hat in den Einstellungen "WebView-Erkenner" gewählt (Rückfall/
// Diagnose ohne APK-Update); sonst die Web Speech API. getPrefs wird bei
// JEDEM Aufruf gelesen (Umschalten wirkt beim nächsten Antippen).
export function getDictationCtor(win, getPrefs) {
  try {
    if (getAndroidBridge(win)) {
      let prefs = null;
      try { prefs = typeof getPrefs === "function" ? getPrefs() : null; } catch { prefs = null; }
      if (sanitizeSpeechPrefs(prefs).engine !== "webview") {
        return createBridgeRecognitionClass(win, getPrefs);
      }
    }
  } catch {
    /* weiter mit der Web Speech API */
  }
  return getSpeechRecognitionCtor(win);
}

/* ---------- Sprache ---------- */

// Chrome ignoriert das lang-Attribut der Seite und fiele ohne explizite
// Sprache auf den ersten Accept-Language-Eintrag bzw. en-US zurück. Wir
// nehmen den ersten deutschen Eintrag der Browser-Sprachen; nur DE/AT/CH
// werden übernommen (die Erkenner kennen de-LU o. Ä. nicht zuverlässig),
// alles andere und reines "de" wird zu de-DE.
export function pickDictationLang(languages) {
  if (Array.isArray(languages)) {
    for (const l of languages) {
      if (typeof l !== "string") continue;
      const m = /^de(?:[-_]([a-z]{2}))?$/i.exec(l.trim());
      if (!m) continue;
      const region = m[1] ? m[1].toUpperCase() : "";
      return region === "AT" || region === "CH" ? "de-" + region : "de-DE";
    }
  }
  return "de-DE";
}

/* ---------- Transkript aus den Erkenner-Ergebnissen ---------- */

// Leerraum-Läufe (auch Zeilenumbrüche) zu EINEM Leerzeichen: Diktat ist
// einzeilig, und die Erkenner liefern gern führende/doppelte Leerzeichen.
export function normalizeSpoken(s) {
  return typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";
}

// Baut das Transkript IMMER ab Index 0 neu auf (resultIndex wird nicht
// benutzt): dadurch ist die Auswertung idempotent, wenn ein Ereignis doppelt
// zugestellt wird. isFinal entscheidet über Final/Interim. Ein Konfidenz-
// Filter fehlt bewusst: confidence 0 ist auf Android legitim.
//
// Netz-Regel gegen kumulative/doppelte Finals (Android continuous-Bug,
// Safari 14.1-17): Ist ein Final - klein geschrieben verglichen - GLEICH dem
// vorigen Final oder beginnt mit "voriges + Leerzeichen", ERSETZT es das
// vorige, statt angehängt zu werden. Nur an der Wortgrenze: 'ja' + 'jawohl'
// bleibt 'ja jawohl'.
export function transcriptFromResults(results) {
  const finals = [];
  const interims = [];
  const len = results ? results.length : 0;
  // Number.isInteger: NaN/Infinity/Nicht-Zahlen dürfen die Schleife nie
  // endlos laufen lassen.
  const n = Number.isInteger(len) && len > 0 ? len : 0;
  for (let i = 0; i < n; i++) {
    const r = results[i];
    const alt = r && r[0];
    const t = normalizeSpoken(alt && alt.transcript);
    if (!t) continue;
    if (!r.isFinal) {
      interims.push(t);
      continue;
    }
    if (finals.length) {
      const last = finals[finals.length - 1].toLowerCase();
      const cur = t.toLowerCase();
      if (cur === last || cur.startsWith(last + " ")) {
        finals[finals.length - 1] = t;
        continue;
      }
    }
    finals.push(t);
  }
  return { finalText: finals.join(" "), interimText: interims.join(" ") };
}

export function joinTranscript(finalText, interimText) {
  return [normalizeSpoken(finalText), normalizeSpoken(interimText)].filter(Boolean).join(" ");
}

/* ---------- Einspleißen ins Eingabefeld ---------- */

// Hängt Gesprochenes an einen vorhandenen Text an. Der vorhandene Text wird
// NIE getrimmt oder sonst verändert (es ist der Text des Nutzers). Genau ein
// Leerzeichen als Trenner - keins nach Leerraum (inkl. Zeilenumbruch) oder
// nach einer öffnenden Klammer/einem öffnenden Anführungszeichen. Keine
// Großschreibung und keine Satzzeichen-Nachbearbeitung: das Erkannte soll so
// erscheinen, wie der Browser es liefert.
export function appendDictation(base, spoken) {
  const b = typeof base === "string" ? base : "";
  const s = normalizeSpoken(spoken);
  if (!s) return b;
  if (b === "") return s;
  if (/[\s([{\u201E\u201A]$/.test(b)) return b + s;
  return b + " " + s;
}

// KERN: ersetzt im aktuellen Feldtext das zuvor eingefügte Gesprochene
// (fromSpoken) durch das neue (toSpoken). Ersetzt wird nur, wenn der
// Feldtext GENAU so endet, wie appendDictation() ihn für fromSpoken erzeugt
// hätte - sonst bleibt er unverändert (Diktat koppelt sich ab; nichts geht
// verloren, nichts wird doppelt geschrieben). Der Trenner, den appendDictation
// einst eingefügt hat, steckt dabei im verbleibenden Anfang "eff" (z. B.
// "Einkauf " bei "Einkauf milch"): so passt es für JEDE Basis, auch für eine
// mit zwei Leerzeichen am Ende ("x  ") oder einer öffnenden Klammer, deren
// Trenner hier nicht mehr bekannt ist. Eine Variante, die zusätzlich den
// Trenner " " einzeln abschneidet, liefert in jedem Fall dasselbe Ergebnis
// (per Brute-Force über ~110.000 Kombinationen geprüft) und entfällt daher.
// Es wird bewusst KEINE RegExp aus dem Text gebaut: Sonderzeichen wie $& , (
// oder .* im Diktat müssen wörtlich behandelt werden.
export function dictationStep(current, fromSpoken, toSpoken) {
  const cur = typeof current === "string" ? current : "";
  const from = normalizeSpoken(fromSpoken);
  const to = normalizeSpoken(toSpoken);
  if (!to || to === from) return cur;
  if (!from) return appendDictation(cur, to);
  if (!cur.endsWith(from)) return cur;
  const eff = cur.slice(0, cur.length - from.length);
  // Nur wenn der Anfang plus "from" genau den Feldtext ergibt, war es unser
  // Endstück (und nicht zufällig gleich lautender Text des Nutzers).
  return appendDictation(eff, from) === cur ? appendDictation(eff, to) : cur;
}

/* ---------- Fehlertexte ---------- */

// Liefert { kind, text[, action] } für die Hinweiszeile über dem Eingabefeld
// oder null (still). action gibt es nur bei Brücken-Codes (Android-App) und
// steuert den Knopf "Einstellungen öffnen" in App.jsx. "aborted" ist der normale Abbruch (App-Wechsel, abort()) und kein
// Fehler. permissionState (granted/denied/prompt/unknown) unterscheidet nur
// bei not-allowed: Android meldet auch einen belegten oder nicht
// erreichbaren Erkenner als not-allowed, obwohl die Berechtigung erteilt ist.
export function dictationErrorInfo(code, permissionState) {
  if (code === null || code === undefined || code === "" || code === "aborted") return null;
  switch (code) {
    case "no-speech":
      return { kind: "info", text: "Nichts gehört. Mikrofon antippen und direkt lossprechen." };
    case "nomatch":
      return { kind: "info", text: "Nicht verstanden – bitte noch einmal versuchen." };
    case "not-allowed":
      if (permissionState === "denied") {
        return {
          kind: "warn",
          text: "Das Mikrofon ist für diese Seite blockiert. Freigeben: Symbol links neben der Adresse antippen → Berechtigungen → Mikrofon → Zulassen (installierte App: Chrome → Einstellungen → Website-Einstellungen → Mikrofon).",
        };
      }
      if (permissionState === "granted") {
        return {
          kind: "warn",
          text: "Die Spracherkennung ist gerade nicht verfügbar (belegt oder ohne Mikrofon-Berechtigung). Kurz warten und erneut antippen. Hilft das nicht: in den Android-Einstellungen Chrome und „Speech Services by Google“ das Mikrofon erlauben.",
        };
      }
      return { kind: "warn", text: "Kein Zugriff auf das Mikrofon. Beim nächsten Antippen bitte „Zulassen“ wählen." };
    case "audio-capture":
      return { kind: "warn", text: "Kein Mikrofon verfügbar – es fehlt oder wird gerade von einer anderen App benutzt." };
    case "network":
      return { kind: "warn", text: "Die Spracherkennung ist nicht erreichbar. Bitte Internetverbindung prüfen." };
    case "service-not-allowed":
      return { kind: "warn", text: "Die Spracherkennung ist in diesem Browser nicht freigegeben." };
    case "language-not-supported":
      return { kind: "warn", text: "Deutsche Spracherkennung wird von diesem Browser nicht unterstützt." };
    case "start-failed":
      return { kind: "warn", text: "Die Spracherkennung konnte nicht gestartet werden." };
    case "unsupported":
      return { kind: "warn", text: "Spracheingabe wird von diesem Browser nicht unterstützt." };
    case "timeout":
      return { kind: "warn", text: "Die Spracherkennung hat nicht reagiert und wurde beendet." };
    // Nur aus der Android-App (Brücke, DECISIONS #140). action: optionaler
    // Knopf "Einstellungen öffnen" in der Hinweiszeile (openAndroidSettings).
    case "app-mic-denied":
      return { kind: "warn", text: "Mikrofon-Zugriff abgelehnt. Zum Diktieren erneut antippen und „Bei Nutzung der App zulassen“ wählen." };
    case "app-mic-blocked":
      return {
        kind: "warn",
        text: "Die App darf das Mikrofon nicht verwenden. Freigeben: „Einstellungen öffnen“ → Berechtigungen → Mikrofon → „Bei Nutzung der App zulassen“.",
        action: "app-settings",
      };
    case "recognizer-mic-denied":
      return {
        kind: "warn",
        text: "Der Spracherkennung des Geräts fehlt der Mikrofon-Zugriff. In den Android-Einstellungen „Speech Services by Google“ (bzw. der Google-App) das Mikrofon erlauben; außerdem prüfen, ob der Mikrofon-Zugriff in den Schnelleinstellungen gesperrt ist.",
        action: "recognizer-settings",
      };
    case "recognizer-busy":
      return { kind: "info", text: "Die Spracherkennung ist noch belegt – kurz warten und erneut antippen." };
    case "recognizer-unavailable":
      return { kind: "warn", text: "Die Spracherkennung des Geräts ist nicht erreichbar. Ist „Speech Services by Google“ (oder die Google-App) installiert und aktiviert?" };
    case "no-recognizer":
      return { kind: "warn", text: "Auf diesem Gerät ist keine Spracherkennung installiert (z. B. „Speech Services by Google“ aus dem Play Store)." };
    case "language-unavailable":
      return { kind: "warn", text: "Deutsch ist für die Spracherkennung auf diesem Gerät nicht verfügbar – in „Speech Services by Google“ das deutsche Sprachpaket laden." };
    default:
      // Den Code nur einsetzen, wenn er wie ein Fehlercode aussieht: kein
      // Fremdtext/HTML/Riesenstring in der Oberfläche.
      if (typeof code === "string" && /^[a-z][a-z-]{0,39}$/.test(code)) {
        return { kind: "warn", text: "Spracherkennung fehlgeschlagen (" + code + ")." };
      }
      return { kind: "warn", text: "Spracherkennung fehlgeschlagen." };
  }
}

// Fragt den Stand der Mikrofon-Berechtigung ab - NUR nach einem
// not-allowed-Fehler zur Textwahl benutzen, nie zum Ein-/Ausblenden des
// Knopfs. Alles Unerwartete (kein permissions-API, "microphone" nicht
// abfragbar, Wurf, Hänger, exotischer state) wird zu "unknown"; das Zeitlimit
// verhindert, dass ein hängendes query() den Hinweis ewig aufhält.
export async function queryMicPermission(nav, timeoutMs = 1000) {
  let timer = null;
  try {
    if (!nav || !nav.permissions || typeof nav.permissions.query !== "function") return "unknown";
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve("unknown"), timeoutMs);
    });
    const query = (async () => {
      const st = await nav.permissions.query({ name: "microphone" });
      const state = st && st.state;
      return state === "granted" || state === "denied" || state === "prompt" ? state : "unknown";
    })().catch(() => "unknown");
    return await Promise.race([query, timeout]);
  } catch {
    return "unknown";
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

// Fehlertext zu einem Fehlercode. Die (asynchrone) Berechtigungsabfrage läuft
// nur bei not-allowed, bei allen anderen Codes wäre sie überflüssig.
export async function resolveDictationError(code, queryPermission) {
  let state = "unknown";
  if (code === "not-allowed") {
    try {
      state = typeof queryPermission === "function" ? await queryPermission() : "unknown";
    } catch {
      state = "unknown";
    }
  }
  return dictationErrorInfo(code, state);
}

/* ---------- Controller ---------- */

const HANDLERS = [
  "onstart", "onaudiostart", "onsoundstart", "onspeechstart",
  "onresult", "onnomatch", "onerror", "onend",
];

// opts: { getCtor, lang, onText, onState, onError, now, timeouts } - alles
// optional (fehlende Callbacks sind no-ops).
//
// Zustände: "idle" -> "starting" -> "listening" -> "stopping" -> "idle".
// - starting: start() ist aufgerufen, der Browser fragt evtl. noch nach der
//   Mikrofon-Berechtigung. Hier läuft bewusst KEIN Wächter-Timer (der Dialog
//   darf beliebig lange offen sein); erneutes Antippen bricht ab.
// - listening: Audio läuft; MAX_MS-Deckel.
// - stopping: stop()/abort() ist raus oder ein Fehler kam; wir warten auf
//   "end". Kommt es nicht, greifen STOP_MS (-> abort) und ABORT_MS (->
//   Zwangs-Ende), damit der Knopf nie dauerhaft hängt.
// Der einzige Weg zurück nach idle ist finish() (plus Startfehler/dispose).
export function createDictation(opts) {
  const o = opts || {};
  const T = { ...DICTATION_TIMEOUTS, ...(o.timeouts || {}) };
  const getCtor = typeof o.getCtor === "function" ? o.getCtor : () => null;
  const onText = typeof o.onText === "function" ? o.onText : () => {};
  const onState = typeof o.onState === "function" ? o.onState : () => {};
  const onError = typeof o.onError === "function" ? o.onError : () => {};
  const now = typeof o.now === "function" ? o.now : () => Date.now();

  let phase = "idle";
  let session = null; // aktuelle Erkenner-Instanz; Ereignisse anderer Instanzen werden ignoriert
  let muted = false; // nach cancel(): keine Texte und keine Fehler mehr
  let userStopped = false; // Abschnitt wurde durch den Nutzer beendet
  let hadText = false; // in diesem Abschnitt kam schon Text
  let pendingError = null; // zuerst gemeldeter Fehlercode, wird erst in finish() ausgegeben
  let lastSpoken = "";
  let startedAt = 0;
  let disposed = false;
  const timers = { stop: null, abort: null, max: null };

  const clearTimer = (k) => {
    if (timers[k] !== null) {
      clearTimeout(timers[k]);
      timers[k] = null;
    }
  };
  const clearAllTimers = () => {
    for (const k of Object.keys(timers)) clearTimer(k);
  };
  const arm = (k, ms, fn) => {
    clearTimer(k);
    timers[k] = setTimeout(() => {
      timers[k] = null;
      fn();
    }, ms);
  };

  // Phase wird VOR dem Callback gesetzt: ein synchron zurückkommender
  // Aufruf (z. B. React-Setter -> Effekt) sieht schon den neuen Stand.
  const setPhase = (p) => {
    if (phase === p) return;
    phase = p;
    if (!disposed) onState(p);
  };
  const emitError = (code) => {
    if (!disposed) onError(code);
  };
  const detach = (r) => {
    for (const h of HANDLERS) {
      try { r[h] = null; } catch { /* egal */ }
    }
  };

  // Abbruch-Wache: nach abort()/error kommt normalerweise ein "end"; fehlt
  // es, beenden wir nach ABORT_MS zwangsweise.
  const armAbortWatch = () => {
    if (timers.abort === null) arm("abort", T.ABORT_MS, () => finish(true));
  };

  function finish(forced) {
    const r = session;
    if (!r) return;
    clearAllTimers();
    detach(r);
    session = null;
    let err = null;
    if (!muted) err = pendingError || (forced ? "timeout" : null);
    // "aborted" ist nie ein Fehler; "keine Sprache"/"kein Treffer" nur dann
    // nicht, wenn der Nutzer selbst beendet hat oder schon Text kam (dann
    // war das nur die Stille nach dem Satz).
    if (err === "aborted") err = null;
    else if ((err === "no-speech" || err === "nomatch") && (userStopped || hadText)) err = null;
    muted = false;
    userStopped = false;
    hadText = false;
    pendingError = null;
    lastSpoken = "";
    setPhase("idle");
    if (err) emitError(err);
  }

  function toListening() {
    if (phase !== "starting") return;
    setPhase("listening");
    arm("max", T.MAX_MS, () => requestStop(false));
  }

  // Abbruch ohne Endergebnis (Berechtigungsdialog offen, Ansichtswechsel
  // während des Starts, Doppel-Tipp): späte Texte und Fehler der Instanz
  // werden verworfen (muted), das Feld bleibt, wie es ist.
  function cancel() {
    const r = session;
    // muted = schon abgebrochen: ein zweiter abort() brächte nichts.
    if (!r || phase === "idle" || muted) return;
    muted = true;
    clearTimer("max");
    clearTimer("stop");
    setPhase("stopping");
    try { r.abort(); } catch { /* egal */ }
    // Ein synchrones "end" hat finish() schon ausgeführt - dann keine Wache.
    if (session === r) armAbortWatch();
  }

  // Beenden mit Endergebnis (stop()): Der Erkenner liefert nach stop() noch
  // das Final und dann "end". byUser = false beim MAX-Deckel (kein
  // Nutzer-Stopp, no-speech bleibt dann meldbar).
  function requestStop(byUser) {
    if (phase === "starting") {
      // Noch nichts zu finalisieren (z. B. Berechtigungsdialog offen).
      cancel();
      return;
    }
    const r = session;
    if (phase !== "listening" || !r) return;
    userStopped = byUser;
    clearTimer("max");
    setPhase("stopping");
    // Timer VOR r.stop() setzen: ein synchron folgendes "end" räumt ihn dann
    // über finish() selbst wieder ab.
    arm("stop", T.STOP_MS, () => {
      if (session !== r) return;
      try { r.abort(); } catch { /* egal */ }
      if (session === r) armAbortWatch();
    });
    try { r.stop(); } catch { /* egal */ }
  }

  function start() {
    if (disposed || phase !== "idle") return false;
    let Ctor = null;
    try { Ctor = getCtor(); } catch { Ctor = null; }
    if (typeof Ctor !== "function") {
      emitError("unsupported");
      return false;
    }
    let r;
    try {
      r = new Ctor();
      // lang immer explizit setzen (siehe pickDictationLang). continuous
      // false + interimResults true: eine Sitzung pro Antippen, Text schon
      // während des Sprechens (Leitentscheidungen im Dateikopf).
      r.lang = o.lang || "de-DE";
      r.continuous = false;
      r.interimResults = true;
      r.maxAlternatives = 1;
    } catch {
      emitError("start-failed");
      return false;
    }
    muted = false;
    userStopped = false;
    hadText = false;
    pendingError = null;
    lastSpoken = "";
    startedAt = now();
    session = r;
    // Sitzungs-Wache: Ereignisse einer abgelösten Instanz (späte Events nach
    // einem Zwangs-Ende) dürfen den Zustand der neuen nicht berühren.
    const guard = (fn) => (ev) => {
      if (session === r) fn(ev);
    };
    const activity = guard(() => toListening());
    r.onstart = activity;
    r.onaudiostart = activity;
    r.onsoundstart = activity;
    r.onspeechstart = activity;
    r.onresult = guard((ev) => {
      if (muted) return;
      toListening();
      const tr = transcriptFromResults(ev && ev.results);
      const spoken = joinTranscript(tr.finalText, tr.interimText);
      if (!spoken || spoken === lastSpoken) return;
      const prev = lastSpoken;
      lastSpoken = spoken;
      hadText = true;
      onText(prev, spoken);
    });
    r.onnomatch = guard(() => {
      pendingError = pendingError || "nomatch";
    });
    r.onerror = guard((ev) => {
      const code = ev && typeof ev.error === "string" && ev.error ? ev.error : "unknown";
      // Der erste echte Fehler gewinnt; "nomatch" ist schwächer (Android
      // meldet nomatch gern vor dem eigentlichen Fehler).
      if (!pendingError || pendingError === "nomatch") pendingError = code;
      clearTimer("max");
      clearTimer("stop");
      setPhase("stopping");
      // Bewusst KEIN Neustart im Fehlerhandler (Endlosschleife bei
      // dauerhaft blockiertem Mikrofon); die Wache beendet notfalls.
      if (session === r) armAbortWatch();
    });
    r.onend = guard(() => finish(false));
    // "starting" VOR r.start(): kommen Ereignisse synchron, sehen sie den
    // richtigen Zustand.
    setPhase("starting");
    try {
      r.start();
    } catch {
      if (session === r) {
        detach(r);
        session = null;
        clearAllTimers();
        muted = false;
        pendingError = null;
        setPhase("idle");
      }
      emitError("start-failed");
      return false;
    }
    return true;
  }

  function stop() {
    requestStop(true);
  }

  function toggle() {
    if (phase === "idle") return start();
    if (phase === "stopping") return false;
    // Doppel-Tipp direkt nach dem Start (Prellen, Berechtigungsdialog
    // schließt per Tipp): ignorieren, sonst bricht der Start sofort wieder ab.
    if (now() - startedAt < T.TAP_GUARD_MS) return false;
    if (phase === "starting") {
      cancel();
      return true;
    }
    requestStop(true);
    return true;
  }

  // Komponente wird abgebaut: Instanz abhängen und abbrechen, danach KEIN
  // Callback mehr (React-State darf nicht mehr gesetzt werden).
  function dispose() {
    if (disposed) return;
    disposed = true;
    const r = session;
    session = null;
    clearAllTimers();
    if (r) {
      detach(r);
      try { r.abort(); } catch { /* egal */ }
    }
    phase = "idle";
  }

  return { start, stop, cancel, toggle, dispose, getState: () => phase };
}
