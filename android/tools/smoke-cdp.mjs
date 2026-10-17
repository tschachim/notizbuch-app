// Emulator-Smoke-Test der Spracheingabe-Bruecke (DECISIONS #140).
// Prueft Verdrahtung, Threads, JSON-Rueckkanal und Lebenszyklus der
// SpeechBridge - NICHT die Erkennungsqualitaet (der CI-Emulator hat kein
// Mikrofonsignal; erwartet sind daher Fehler wie audio-capture/no-speech,
// aber IMMER genau ein "end" pro Sitzung).
// Aufruf im android-emulator-runner (Node >= 22: fetch + WebSocket global):
//   node android/tools/smoke-cdp.mjs <pfad/zum/app-debug.apk>
import { execFileSync } from "node:child_process";

const APP = "io.github.tschachim.notizbuch";
const APP_URL = "https://tschachim.github.io/notizbuch-app/";
const apk = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...args) => execFileSync("adb", args, { encoding: "utf8" }).trim();
const failures = [];
const fail = (msg) => { failures.push(msg); console.error("SMOKE-FEHLER: " + msg); };

async function waitFor(fn, timeoutMs, stepMs = 1000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const v = await fn();
      if (v) return v;
    } catch { /* weiter warten */ }
    await sleep(stepMs);
  }
  return null;
}

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data));
    const cb = m.id && pending.get(m.id);
    if (cb) { pending.delete(m.id); cb(m); }
  };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const evaluate = (expression, timeoutMs = 90000) => new Promise((resolve, reject) => {
    const myId = ++id;
    const t = setTimeout(() => { pending.delete(myId); reject(new Error("CDP-Timeout")); }, timeoutMs);
    pending.set(myId, (m) => {
      clearTimeout(t);
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else if (m.result.exceptionDetails) reject(new Error(JSON.stringify(m.result.exceptionDetails)));
      else resolve(m.result.result.value);
    });
    ws.send(JSON.stringify({ id: myId, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  return { ready, evaluate, close: () => ws.close() };
}

// Seite bereit? Dokument fertig geladen UND React-App gerendert (die
// Kopfzeile mit dem Einstellungen-Knopf, title="Einstellungen", steht in
// App.jsx unbedingt - auch im unverbundenen Zustand). Waehrend eines
// Kontextwechsels (Neuladen/Navigation) wirft evaluate -> waitFor wartet weiter.
const PAGE_READY = `document.readyState === "complete" && !!document.querySelector('button[title^="Einstellungen"]')`;

// Sammler in der Seite: haengt sich VOR einen evtl. vorhandenen Verteiler.
// Idempotent und selbstheilend: installiert nur, wenn window.__smoke fehlt
// (z. B. weil das Dokument nach dem SETUP ersetzt wurde - Navigation oder
// Neuladen; so geschehen im CI-Lauf, als die Seite noch lud). Liefert true,
// wenn NEU installiert wurde. Steht am Anfang JEDES Ausdrucks, der den
// Sammler braucht; ein Neuaufbau mitten in einer Sitzungsreihe geht dabei nicht
// still durch, sondern wird als "reinstalled" gemeldet (siehe noteReinstall).
const INSTALL = `const __smokeInstall = () => {
  if (window.__smoke) return false;
  window.__smoke = { ev: {} };
  const prev = window.__notizbuchAndroidSpeech;
  window.__notizbuchAndroidSpeech = (raw) => {
    try { const m = JSON.parse(raw); (window.__smoke.ev[m.sid] = window.__smoke.ev[m.sid] || []).push(m); } catch (e) {}
    if (typeof prev === "function") { try { prev(raw); } catch (e) {} }
  };
  return true;
};`;

const SETUP = `(() => {
  ${INSTALL}
  const installed = __smokeInstall();
  const b = window.NotizbuchAndroid;
  const ok = !!b && typeof b.speechStart === "function";
  return { installed, hasBridge: ok, info: ok ? JSON.parse(b.getInfo()) : null, webkit: typeof window.webkitSpeechRecognition };
})()`;

// Hinweis, wenn der Sammler waehrend des Laufs neu aufgebaut werden musste:
// bis dahin gesammelte Ereignisse sind dann weg, ein Folgefehler ("0x end")
// hat also vermutlich diese Ursache und nicht die Bruecke.
const noteReinstall = (name, r) => {
  if (r && r.reinstalled) {
    console.log(`${name}: Hinweis - Sammler war weg und wurde neu installiert (Seite neu geladen/ersetzt? Fruehere Ereignisse sind verloren)`);
  }
};

const fmt = (m) => m.type + (m.code !== undefined ? ":" + m.code : "") + (Array.isArray(m.texts) ? "[" + m.texts.length + "]" : "");

// Startet sid, bricht optional nach abortAfterMs ab, wartet auf end (+1 s Nachlauf).
const RUN = (sid, opts, abortAfterMs, waitMs) => `(async () => {
  ${INSTALL}
  const reinstalled = __smokeInstall();
  const b = window.NotizbuchAndroid, E = window.__smoke.ev, sid = ${JSON.stringify(sid)};
  b.speechStart(sid, ${JSON.stringify(JSON.stringify(opts))});
  const t0 = Date.now(); let aborted = false;
  while (Date.now() - t0 < ${waitMs}) {
    if ((E[sid] || []).some((m) => m.type === "end")) break;
    if (${abortAfterMs} >= 0 && !aborted && Date.now() - t0 >= ${abortAfterMs}) { b.speechAbort(sid); aborted = true; }
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 1000));
  return { aborted, events: (E[sid] || []), reinstalled };
})()`;

function checkSession(name, r, abortCode) {
  const ev = r.events.map(fmt);
  console.log(`${name}: ${ev.join(" -> ") || "(keine Ereignisse)"}${r.aborted ? " [abgebrochen]" : ""}`);
  const ends = ev.filter((e) => e === "end").length;
  if (ends !== 1) return fail(`${name}: ${ends}x end statt genau 1`);
  if (ev[ev.length - 1] !== "end") return fail(`${name}: Ereignis nach end`);
  if (!(ev[0] === "listening" || ev[0].startsWith("error:"))) fail(`${name}: erstes Ereignis ${ev[0]}`);
  const errs = ev.filter((e) => e.startsWith("error:"));
  if (errs.length > 1) fail(`${name}: mehrere Fehler ${errs.join(",")}`);
  // Kein harter Fehler: der Dienst kann vor dem Abbruch selbst geendet haben.
  if (r.aborted && abortCode !== undefined && errs.length === 1 && errs[0] !== "error:" + abortCode) {
    console.log(`${name}: Hinweis - Ende mit ${errs[0]} statt error:${abortCode}`);
  }
}

async function main() {
  if (!apk) throw new Error("APK-Pfad fehlt");
  adb("install", "-r", apk);
  adb("shell", "pm", "grant", APP, "android.permission.RECORD_AUDIO");
  adb("shell", "am", "start", "-W", "-n", `${APP}/.MainActivity`);

  const pid = await waitFor(() => adb("shell", "pidof", APP), 60000);
  if (!pid) throw new Error("App-Prozess nicht gefunden");
  const sock = `webview_devtools_remote_${pid}`;
  if (!(await waitFor(() => adb("shell", "cat", "/proc/net/unix").includes(sock), 60000))) {
    throw new Error("DevTools-Socket fehlt (Debug-APK? setWebContentsDebuggingEnabled)");
  }
  adb("forward", "tcp:9222", `localabstract:${sock}`);
  const page = await waitFor(async () => {
    const list = await (await fetch("http://127.0.0.1:9222/json")).json();
    return list.find((p) => p.type === "page" && String(p.url).startsWith(APP_URL));
  }, 120000);
  if (!page) throw new Error("App-Seite nicht geladen (Netz?)");

  const cdp = connect(page.webSocketDebuggerUrl);
  await cdp.ready;
  // Die Seite wird oft schon "gefunden", waehrend sie noch laedt; ein
  // Neuladen/Dokumentwechsel nach dem SETUP vernichtet den Sammler. Darum
  // erst auf fertiges Dokument + gerenderte App warten (kurze Einzel-Timeouts,
  // damit ein haengender evaluate im Kontextwechsel die Schleife nicht blockiert),
  // dann kurz zur Ruhe kommen lassen.
  if (!(await waitFor(() => cdp.evaluate(PAGE_READY, 10000), 120000))) {
    throw new Error("App-Seite nicht bereit (readyState/Einstellungen-Knopf nach 120 s)");
  }
  await sleep(1000);
  const setup = await cdp.evaluate(SETUP);
  console.log("Setup: " + JSON.stringify(setup));
  if (!setup.hasBridge) throw new Error("window.NotizbuchAndroid fehlt");
  if (setup.info.bridge !== 1) fail("getInfo().bridge != 1");
  if (setup.info.mic !== "granted") fail("getInfo().mic = " + setup.info.mic + " (pm grant?)");

  // 1) Natuerlicher Lauf (Abbruch nach 20 s, falls der Dienst haengt)
  const s1 = await cdp.evaluate(RUN("smoke1", { lang: "de-DE", partial: true }, 20000, 25000));
  noteReinstall("S1 natuerlich", s1);
  checkSession("S1 natuerlich", s1, -5);
  // 2) Abbruch nach 1,5 s
  const s2 = await cdp.evaluate(RUN("smoke2", { lang: "de-DE", partial: true }, 1500, 6000));
  noteReinstall("S2 abort", s2);
  checkSession("S2 abort", s2, -5);
  // 3) Ersetzen: zweiter Start beendet den ersten mit genau einem end
  const rep = await cdp.evaluate(`(async () => {
    ${INSTALL}
    const reinstalled = __smokeInstall();
    const b = window.NotizbuchAndroid, E = window.__smoke.ev;
    b.speechStart("smoke3", "{}"); b.speechStart("smoke4", "{}");
    const t0 = Date.now();
    while (Date.now() - t0 < 4000 && !(E.smoke3 || []).some((m) => m.type === "end")) await new Promise((r) => setTimeout(r, 100));
    b.speechAbort("smoke4");
    await new Promise((r) => setTimeout(r, 2000));
    return { s3: E.smoke3 || [], s4: E.smoke4 || [], reinstalled };
  })()`);
  noteReinstall("S3/S4", rep);
  checkSession("S3 ersetzt", { events: rep.s3, aborted: true }, -5);
  checkSession("S4 ersetzend", { events: rep.s4, aborted: true }, -5);
  // 4) Ungueltige sid / kaputte Optionen: keine Ereignisse bzw. Standardwerte, kein Absturz
  const bad = await cdp.evaluate(`(async () => {
    ${INSTALL}
    const reinstalled = __smokeInstall();
    const b = window.NotizbuchAndroid;
    b.speechStart("bad sid!", "{}"); b.speechStart("smoke5", "{kaputt");
    await new Promise((r) => setTimeout(r, 1500)); b.speechAbort("smoke5");
    await new Promise((r) => setTimeout(r, 1500));
    return { badSid: window.__smoke.ev["bad sid!"] || null, s5: window.__smoke.ev.smoke5 || [], reinstalled };
  })()`);
  noteReinstall("S5 kaputte Optionen", bad);
  if (bad.badSid) fail("Ereignisse fuer ungueltige sid");
  checkSession("S5 kaputte Optionen", { events: bad.s5, aborted: true }, -5);

  // 5) Lebenszyklus: App in den Hintergrund -> error:-4 + end
  // (Sammler auch hier absichern: er muss beim Start von smoke6 vorhanden sein.)
  const s6start = await cdp.evaluate(`(() => {
    ${INSTALL}
    const reinstalled = __smokeInstall();
    window.NotizbuchAndroid.speechStart("smoke6", "{}");
    return { reinstalled };
  })()`);
  noteReinstall("S6 Start", s6start);
  await sleep(2000);
  adb("shell", "input", "keyevent", "KEYCODE_HOME");
  await sleep(3000);
  adb("shell", "am", "start", "-n", `${APP}/.MainActivity`);
  await sleep(3000);
  const s6 = await cdp.evaluate(`(() => {
    ${INSTALL}
    const reinstalled = __smokeInstall();
    return { events: window.__smoke.ev.smoke6 || [], reinstalled };
  })()`);
  noteReinstall("S6 Hintergrund", s6);
  checkSession("S6 Hintergrund", { events: s6.events, aborted: true }, -4);

  // 6) Protokoll lesbar, enthaelt Eintraege
  const log = await cdp.evaluate(`JSON.parse(window.NotizbuchAndroid.getLog())`);
  if (!Array.isArray(log) || log.length === 0) fail("getLog leer");
  console.log("Protokoll (letzte 25):\n  " + log.slice(-25).join("\n  "));

  // 7) Info: WebView-eigener Erkenner (Rueckfall) - nur berichten, nicht bewerten
  if (setup.webkit === "function") {
    const wv = await cdp.evaluate(`(async () => {
      const R = window.webkitSpeechRecognition, r = new R(), ev = [];
      for (const n of ["start","audiostart","result","nomatch","error","end"]) r["on" + n] = (e) => ev.push(n + (e && e.error ? ":" + e.error : ""));
      r.lang = "de-DE"; r.interimResults = true; r.start();
      const t0 = Date.now();
      while (Date.now() - t0 < 15000 && !ev.includes("end")) await new Promise((x) => setTimeout(x, 200));
      if (!ev.includes("end")) { r.abort(); await new Promise((x) => setTimeout(x, 1500)); }
      return ev;
    })()`);
    console.log("WebView-Erkenner (Info): " + wv.join(" -> "));
  }
  cdp.close();
}

main().then(() => {
  if (failures.length) { console.error(`${failures.length} Smoke-Fehler`); process.exit(1); }
  console.log("Smoke-Test bestanden.");
  process.exit(0);
}, (e) => {
  console.error("Smoke-Test abgebrochen: " + (e && e.message));
  try { console.error(adb("logcat", "-d", "-s", "NotizbuchSpeech:*", "AndroidRuntime:E", "chromium:E")); } catch { /* egal */ }
  process.exit(1);
});
