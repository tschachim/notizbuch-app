// @vitest-environment jsdom
//
// v7.57.1 (DECISIONS #119, E2E-Befund E2 "Schnellnotiz-Sync"): mountet die
// ECHTE App (src/App.jsx) gegen ein In-Memory-Daten-Repo (lib/github.js
// gemockt) und simuliert "Seite neu laden" durch Unmount + Abräumen ALLER
// ausstehenden Timer (= die Seite stirbt, ein laufender Debounce-Write
// fällt ersatzlos weg) + erneutes Mounten mit demselben localStorage.
// Muster/Harness übernommen aus dem Analyse-Scratchpad der Root-Cause-
// Untersuchung (dort gegen den UNGEFIXTEN Code 11/11 grün, d. h. es hat
// dort den VERLUST nachweislich fixiert – hier pinnt es das FIX-Verhalten,
// siehe DECISIONS #119 für die Gegenprobe "Fix kurz zurückgenommen").
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";

// v7.57.1-Nachbesserung (Review-Fund R4, DECISIONS #120): das Fake-Repo ist
// jetzt PRO "owner/repo" getrennt (statt eine einzige globale Datei-Map) –
// ein Reconnect-Test muss echt unterscheiden können, ob eine Notiz aus dem
// ALTEN oder dem NEUEN Repo kommt. "fake.files" bleibt ein STABILER Alias
// auf das Default-Repo (aus notizbuch:settings, siehe beforeEach) – alle
// BISHERIGEN Tests kennen nur dieses eine Repo und bleiben unverändert.
const DEFAULT_OWNER = "o";
const DEFAULT_REPO = "notizbuch-data-qa";
const fake = vi.hoisted(() => {
  const f = {
    repos: new Map(), // "owner/repo" -> Map(path -> {text, sha})
    files: null, // Alias auf das Default-Repo, siehe reset()
    seq: 0,
    // v7.57.1-Nachbesserung (Review-Fund R1, DECISIONS #120): künstliche
    // Verzögerung NUR für state.json-GET/PUT, per Test aktivierbar – öffnet
    // ein "Zeitfenster", in dem der Test WÄHREND einer laufenden Konflikt-
    // auflösung (PUT-409 -> GET -> PUT) weitertippen kann. Nutzt die von
    // vi.useFakeTimers() gesteuerte Zeit (setTimeout), siehe settle().
    stateDelayMs: 0,
    // v7.57.1-Nachbesserung (Review-Fund M2, DECISIONS #121): per Test
    // aktivierbarer, NICHT-Konflikt-Fehlschlag für den NÄCHSTEN
    // state.json-PUT (z. B. "Netz kurz weg") – zählt sich selbst runter,
    // damit genau EIN PUT betroffen ist.
    failStatePut: 0,
    // v7.57.1-NACHBESSERUNG Runde 4 (Review-Fund 🟡, DECISIONS #123): zählt
    // JEDEN state.json-PUT (Default-Repo UND ggf. weitere, siehe R4/PP2) –
    // damit lässt sich "kein weiterer Write nach der Angleichung" auf
    // App-Ebene ASSERTEN statt nur auf reiner Funktions-Ebene (mergeQuickNotes)
    // geprüft zu werden. reset() setzt ihn pro Test zurück.
    statePuts: 0,
    newSha() { f.seq += 1; return "sha" + f.seq; },
    repoKey(cfg) { return (cfg && cfg.owner) + "/" + (cfg && cfg.repo); },
    filesFor(cfg) {
      const k = f.repoKey(cfg);
      if (!f.repos.has(k)) f.repos.set(k, new Map());
      return f.repos.get(k);
    },
    set(path, text) { f.files.set(path, { text, sha: f.newSha() }); },
    // NUR für Tests, die ein ZWEITES Repo vorbereiten (R4) – schreibt NICHT
    // in das Default-Repo.
    setFor(owner, repo, path, text) {
      f.filesFor({ owner, repo }).set(path, { text, sha: f.newSha() });
    },
    reset() {
      f.repos = new Map();
      f.stateDelayMs = 0;
      f.failStatePut = 0;
      f.statePuts = 0;
      f.files = f.filesFor({ owner: DEFAULT_OWNER, repo: DEFAULT_REPO });
    },
  };
  return f;
});

vi.mock("../src/lib/github.js", async (importOriginal) => {
  const orig = await importOriginal();
  const STATE_PATH = "data/state.json";
  const delayIfState = async (path) => {
    if (path === STATE_PATH && fake.stateDelayMs) {
      await new Promise((r) => setTimeout(r, fake.stateDelayMs));
    }
  };
  const doWrite = (files, path, text, sha) => {
    const cur = files.get(path);
    if (cur && sha !== cur.sha) throw new orig.ShaConflictError();
    const nsha = fake.newSha();
    files.set(path, { text, sha: nsha });
    return { sha: nsha, commitSha: "c" + nsha };
  };
  const listDir = (files, dir) => [...files.keys()]
    .filter((p) => (dir === "" ? !p.includes("/") : p.startsWith(dir + "/") && !p.slice(dir.length + 1).includes("/")))
    .map((p) => ({ name: dir === "" ? p : p.slice(dir.length + 1), path: p, sha: files.get(p).sha }));
  return {
    ...orig,
    ghCheckRepo: async () => true,
    ghGetFile: async (cfg, path) => {
      await delayIfState(path);
      const e = fake.filesFor(cfg).get(path);
      return e ? { text: e.text, sha: e.sha } : null;
    },
    ghGetBlob: async () => null,
    ghListDir: async (cfg, dir) => listDir(fake.filesFor(cfg), dir),
    ghPutFile: async (cfg, path, b64, msg, sha) => {
      await delayIfState(path);
      if (path === STATE_PATH && fake.failStatePut) {
        fake.failStatePut -= 1;
        throw new Error("Netz weg"); // KEIN ShaConflictError – anderer Fehlerpfad, siehe M2
      }
      if (path === STATE_PATH) fake.statePuts += 1;
      return doWrite(fake.filesFor(cfg), path, orig.b64ToUtf8(b64), sha);
    },
    ghDeleteFile: async () => true,
    ghListCommits: async () => [],
    ghCommitMeta: async () => ({ count: 1, lastTs: 0 }),
  };
});

import App from "../src/App.jsx";

const QN_KEY = "notizbuch:quicknotes";
const STATE = "data/state.json";
const PH = "Kurz notieren …";
const X_TITLE = "Verwerfen (ohne Übernahme löschen)";
let container = null;
let root = null;

const settle = async (ms = 0) => {
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
    if (ms) await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
};

async function mountApp() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<App />); });
  await settle(0);
  await settle(0);
}

// v7.57.1-NACHBESSERUNG Runde 4 (Review-Fund 🟡, DECISIONS #123): mountet
// eine ZUSÄTZLICHE, UNABHÄNGIGE App-Instanz (eigener Container + eigene
// React-Root) OHNE die globalen container/root-Variablen zu überschreiben –
// nötig, um "zwei Geräte gleichzeitig offen" nachzubilden (PP2). Jede
// Instanz liest quickNotesCacheRef beim eigenen Mount-Zeitpunkt EINMALIG aus
// localStorage (useRef-Initialisierung) – ein localStorage.setItem()
// zwischen zwei mountInto()-Aufrufen wirkt deshalb NUR auf die JEWEILS
// SPÄTER gemountete Instanz, exakt wie ein zweites Gerät mit eigenem,
// vorher separat synchronisiertem Cache-Stand. Beide Instanzen teilen sich
// dasselbe (globale) Fake-Repo.
async function mountInto() {
  const c = document.createElement("div");
  document.body.appendChild(c);
  const r = createRoot(c);
  await act(async () => { r.render(<App />); });
  await settle(0);
  await settle(0);
  return { r, c };
}

// "Reload": Unmount räumt React ab, vi.clearAllTimers() nimmt auch den
// laufenden state.json-Debounce mit (die Seite stirbt, EXAKT die Situation
// aus dem Live-Befund) - der localStorage-Cache bleibt (echtes Verhalten
// des Browsers) erhalten, danach frisches Mounten.
async function reload() {
  act(() => root.unmount());
  container.remove();
  vi.clearAllTimers();
  await mountApp();
}

const lsCache = () => JSON.parse(localStorage.getItem(QN_KEY) || "null");
const remoteState = () => JSON.parse(fake.files.get(STATE).text);
const textareas = () => [...container.querySelectorAll("textarea")].filter((t) => t.placeholder === PH);

async function clickAddNote() {
  const btn = container.querySelector('button[title="Neue Schnellnotiz (Post-it)"]');
  expect(btn).toBeTruthy();
  await act(async () => { btn.click(); });
  await settle(0);
}

async function setViaNativeSetter(el, text) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  await act(async () => {
    setter.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

// v7.57.1-Nachbesserung (Review-Fund R2, DECISIONS #120): öffnet den
// Bestätigen-Dialog und klickt "Archivieren" – zwei Klicks, siehe
// SettingsDialog/App.jsx (Archive-Knopf mit Bestätigung).
async function archiveChatUi() {
  const openBtn = container.querySelector(
    'button[title="Chat archivieren: als Markdown im Daten-Repo ablegen und leeren"]'
  );
  expect(openBtn).toBeTruthy();
  await act(async () => { openBtn.click(); });
  await settle(0);
  const confirmBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Archivieren");
  expect(confirmBtn).toBeTruthy();
  await act(async () => { confirmBtn.click(); });
  await settle(0);
}

// v7.57.1-Nachbesserung (Review-Fund R4, DECISIONS #120): öffnet den
// Einstellungen-Dialog, füllt owner/repo/pat/apiKey über den echten
// SettingsDialog aus und klickt "Speichern & Verbinden" – wie ein echter
// Reconnect auf ein (ggf. anderes) Daten-Repo im selben Tab.
async function openSettingsAndConnect({ owner, repo, pat, apiKey }) {
  const gearBtn = container.querySelector('button[title="Einstellungen"]');
  expect(gearBtn).toBeTruthy();
  await act(async () => { gearBtn.click(); });
  await settle(0);
  const setVal = (sel, val) => {
    const el = container.querySelector(sel);
    expect(el).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  await act(async () => {
    setVal("#settings-owner", owner);
    setVal("#settings-repo", repo);
    setVal("#settings-pat", pat);
    setVal("#settings-api-key", apiKey);
  });
  await settle(0);
  const saveBtn = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Speichern & Verbinden"));
  expect(saveBtn).toBeTruthy();
  await act(async () => { saveBtn.click(); });
  await settle(0);
  await settle(0);
}

function seedRepo(quicknotes, chat) {
  fake.set("wissensbasis.md", "# Wissensbasis\n\n## Inbox\n\nText\n");
  const st = { v: 2, active: "wissensbasis", chat: chat || [], model: "x", collapsed: {}, order: ["wissensbasis"] };
  if (quicknotes !== undefined) st.quicknotes = quicknotes;
  fake.set(STATE, JSON.stringify(st, null, 2));
}

beforeEach(() => {
  vi.useFakeTimers();
  fake.reset();
  localStorage.clear();
  localStorage.setItem("notizbuch:settings", JSON.stringify({ owner: DEFAULT_OWNER, repo: DEFAULT_REPO, pat: "p", apiKey: "k" }));
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  if (root) { try { act(() => root.unmount()); } catch (e) { /* schon weg */ } root = null; }
  if (container) { container.remove(); container = null; }
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("E2-Regression (DECISIONS #119): Schnellnotiz-Text überlebt einen Reload während des Debounce", () => {
  it("Kernbefund E2: Text getippt, Reload NACH 1s (2,5s-Debounce noch offen) – Text bleibt statt zu verschwinden", async () => {
    seedRepo({ wissensbasis: [] });
    await mountApp();
    await clickAddNote();
    // Post-it einmal zu Ende schreiben lassen (Basis kennt jetzt die leere Notiz).
    await settle(3000);
    expect(remoteState().quicknotes.wissensbasis[0].text).toBe("");
    await setViaNativeSetter(textareas()[0], "QA-Sync-Test");
    await settle(1000); // < 2,5s: Debounce hat NICHT geflusht
    expect(lsCache().notes.wissensbasis[0].text).toBe("QA-Sync-Test");
    expect(remoteState().quicknotes.wissensbasis[0].text).toBe(""); // Repo weiß noch nichts
    await reload();
    expect(textareas().map((t) => t.value)).toEqual(["QA-Sync-Test"]);
  });

  it("bleibt bei mehreren Reloads in Folge stabil (Basis wandert korrekt mit)", async () => {
    seedRepo({ wissensbasis: [] });
    await mountApp();
    await clickAddNote();
    await settle(3000);
    await setViaNativeSetter(textareas()[0], "QA-Sync-Test");
    await settle(1000);
    await reload();
    expect(textareas().map((t) => t.value)).toEqual(["QA-Sync-Test"]);
    await settle(3000); // jetzt sauber durchgeschrieben
    expect(remoteState().quicknotes.wissensbasis[0].text).toBe("QA-Sync-Test");
    await reload();
    expect(textareas().map((t) => t.value)).toEqual(["QA-Sync-Test"]);
  });

  it("P8 (Umkehrfall): lokal gelöscht, Remote kennt die Notiz noch (nicht abgeholt) – bleibt NACH Reload gelöscht", async () => {
    seedRepo({ wissensbasis: [] });
    await mountApp();
    await clickAddNote();
    await settle(3000); // Basis kennt jetzt die (leere) Notiz
    const xBtn = container.querySelector(`button[title="${X_TITLE}"]`);
    expect(xBtn).toBeTruthy();
    await act(async () => { xBtn.click(); });
    await settle(1000); // < 2,5s: Löschung ist NICHT im Repo angekommen
    expect(remoteState().quicknotes.wissensbasis.length).toBe(1); // Repo hat sie noch
    await reload();
    expect(textareas().length).toBe(0); // bleibt gelöscht, kein Wiederauftauchen
  });

  // v7.57.1-NACHBESSERUNG Runde 3 (Review-Fund 🔵, DECISIONS #122): das
  // wörtliche Befundsymptom P1c (X + neu anlegen + Text tippen + Reload
  // NACH 0,8s) hatte bisher keinen eigenen App-Test (nur eine reine
  // Logging-Probe im Analyse-Scratchpad, KEINE Assertion) – dieser Test
  // pinnt das tatsächliche Verhalten: die ALTE (gelöschte) ID darf nach dem
  // Reload NICHT wieder auftauchen, der getippte Text muss erhalten bleiben.
  it("P1c: X + neu anlegen + Text tippen, Reload NACH 0,8s – Text bleibt, die ALTE (gelöschte) ID ersteht NICHT wieder auf", async () => {
    seedRepo({ wissensbasis: [] });
    await mountApp();
    await clickAddNote();
    await settle(3000); // Basis kennt die erste (leere) Notiz
    const oldId = lsCache().notes.wissensbasis[0].id;
    const xBtn = container.querySelector(`button[title="${X_TITLE}"]`);
    expect(xBtn).toBeTruthy();
    await act(async () => { xBtn.click(); });
    await settle(0);
    await clickAddNote(); // NEUE Notiz mit einer ANDEREN ID
    await setViaNativeSetter(textareas()[0], "QA-Sync-Test");
    await settle(800); // < 2,5s: NICHT ins Repo geschrieben
    await reload();
    expect(textareas().map((t) => t.value)).toEqual(["QA-Sync-Test"]);
    // v7.57.1-NACHBESSERUNG Runde 4 (Review-Fund 🔵, DECISIONS #123): OHNE
    // dieses Warten liest lsCache() noch den Cache-Stand von VOR dem Reload
    // (der 300ms-Cache-Effect des NEU gemounteten Baums ist noch nicht
    // gelaufen) – die folgende Assertion prüfte dann gar nicht das
    // Reload-Verhalten, sondern einen Zufallstreffer (die alte ID fehlte im
    // alten Cache ohnehin schon).
    await settle(400); // 300ms-Cache-Effect des NEUEN Mounts abwarten
    const idsAfterReload = (lsCache().notes.wissensbasis || []).map((n) => n.id);
    expect(idsAfterReload).not.toContain(oldId); // die gelöschte alte ID kommt NICHT zurück
    await settle(3000); // jetzt durchgeschrieben
    const remoteNotes = remoteState().quicknotes.wissensbasis;
    expect(remoteNotes.map((n) => n.text)).toEqual(["QA-Sync-Test"]);
    expect(remoteNotes.some((n) => n.id === oldId)).toBe(false);
  });

  it("P6 (Mehrgeräte): Gerät B legt währenddessen ein eigenes Post-it an – Konflikt-Merge verliert es NICHT mehr", async () => {
    seedRepo({ wissensbasis: [] });
    await mountApp();
    await clickAddNote();
    await settle(3000);
    await setViaNativeSetter(textareas()[0], "Text von A");
    await settle(500); // A hat jetzt einen ausstehenden lokalen Write
    // Gerät B schreibt währenddessen direkt ins Repo (anderer SHA).
    const st = remoteState();
    st.quicknotes.wissensbasis.push({ id: "geraetB1", text: "Text von B", x: 1, y: 1, w: 260, h: 200, u: Date.now() });
    fake.set(STATE, JSON.stringify(st, null, 2));
    await settle(2600); // A's Debounce flusht jetzt -> SHA-Konflikt -> Merge
    const remote = remoteState().quicknotes.wissensbasis;
    expect(remote.some((n) => n.id === "geraetB1" && n.text === "Text von B")).toBe(true);
    expect(remote.some((n) => n.text === "Text von A")).toBe(true);
  });

  it("P7 (maxWait): Dauertippen mit Pausen unter 2,5s über die 10s-Grenze hinaus wird trotzdem geschrieben", async () => {
    seedRepo({ wissensbasis: [] });
    await mountApp();
    await clickAddNote();
    await settle(3000);
    const ta = textareas()[0];
    // 6 Änderungen im 2s-Takt = 12s Dauertippen, jede einzelne Pause bleibt
    // unter dem 2,5s-Debounce (ohne maxWait würde NIE geflusht).
    for (let i = 0; i < 6; i++) {
      await setViaNativeSetter(ta, "Text " + i);
      await settle(2000);
    }
    expect(remoteState().quicknotes.wissensbasis[0].text).not.toBe("");
  });
});

// v7.57.1-NACHBESSERUNG (Review-Fund, DECISIONS #120): fünf 🔴/🟡-Review-
// Findings zur Erst-Fassung von #118/#119, jeweils mit einem Regressions-
// test, der vor dem jeweiligen Fix nachweislich rot wird (siehe
// Mutationsprobe im Abschlussbericht) und danach grün bleibt.
describe("Review-Nachbesserung (DECISIONS #120): R1-R5b", () => {
  it("R1: Eingabe WÄHREND der Konfliktauflösung (PUT-409 → GET → PUT) geht NICHT mehr verloren", async () => {
    seedRepo({ wissensbasis: [] });
    await mountApp();
    await clickAddNote();
    await settle(3000); // Basis kennt die (leere) Notiz
    await setViaNativeSetter(textareas()[0], "A1");
    await settle(2000); // Debounce (2,5s) noch nicht abgelaufen
    // Gerät B schreibt DAZWISCHEN direkt ins Repo – der gleich folgende
    // Flush von A trifft dadurch auf einen SHA-Konflikt.
    const st = remoteState();
    st.quicknotes.wissensbasis.push({ id: "geraetB1", text: "Von B", x: 1, y: 1, w: 260, h: 200, u: Date.now() });
    fake.set(STATE, JSON.stringify(st, null, 2));
    fake.stateDelayMs = 1000; // GET/PUT im Konfliktpfad künstlich verzögert
    await settle(1000); // Debounce läuft jetzt ab -> erster PUT (verzögert), noch nicht abgeschlossen
    // WÄHREND die Konfliktauflösung noch läuft (PUT/GET/PUT je 1s), weitertippen:
    await setViaNativeSetter(textareas()[0], "A1 und mehr");
    await settle(5000); // erster PUT (409) + GET + zweiter PUT vollständig durchlaufen
    fake.stateDelayMs = 0;
    // Beide Notizen sind jetzt da: "A1 und mehr" (Eingabe WÄHREND der
    // Konfliktauflösung, das eigentliche R1) UND "Von B" (Gerät B, kam schon
    // mit demselben Merge herein).
    expect(textareas().map((t) => t.value).sort()).toEqual(["A1 und mehr", "Von B"]);
    // Nachsynchronisation: weicht der State vom Merge-Payload ab, pusht der
    // Save-Effect automatisch nach (evtl. über einen weiteren Konflikt-
    // Zyklus, falls der zweite Debounce mit dem ersten überlappt).
    await settle(6000);
    await settle(6000);
    const remote = remoteState().quicknotes.wissensbasis;
    expect(remote.some((n) => n.text === "A1 und mehr")).toBe(true);
    expect(remote.some((n) => n.id === "geraetB1" && n.text === "Von B")).toBe(true);
  });

  it("R2: 'Chat archivieren' bleibt geleert, auch wenn der anschließende Flush in einen SHA-Konflikt läuft", async () => {
    seedRepo({ wissensbasis: [] }, [
      { role: "user", ts: 1000, text: "Alte Frage" },
      { role: "assistant", ts: 1001, text: "Alte Antwort" },
    ]);
    await mountApp();
    await archiveChatUi();
    // Gerät B hat (unabhängig, VOR diesem Flush) ebenfalls state.json
    // geschrieben – die SHA, die A kennt, ist jetzt veraltet. Inhalt bleibt
    // gleich (der ALTE, noch nicht archivierte Chat), das reicht für den
    // Konflikt und ist genau der Fall, in dem mergeChats() den Chat wieder
    // zurückgeholt hätte.
    fake.set(STATE, fake.files.get(STATE).text);
    await settle(3000); // Save-Effect-Debounce -> SHA-Konflikt -> Merge
    const remote = remoteState();
    expect(remote.chat.filter((m) => m.ts).length).toBe(0);
    const archived = [...fake.files.keys()].some((p) => p.startsWith("chats/"));
    expect(archived).toBe(true);
  });

  it("R3: Erfolgreicher Flush schreibt den AKTUELLEN (nicht den zu Flush-Beginn eingefrorenen) Stand in den Cache", async () => {
    seedRepo({ wissensbasis: [] });
    await mountApp();
    await clickAddNote();
    await settle(3000); // Basis kennt die (leere) Notiz
    fake.stateDelayMs = 500; // PUT künstlich verzögert
    await setViaNativeSetter(textareas()[0], "AB");
    await settle(2500); // Debounce läuft ab -> PUT startet (verzögert), noch pending
    await setViaNativeSetter(textareas()[0], "ABC"); // WÄHREND der PUT noch läuft
    await settle(400); // < 500ms: PUT noch pending, aber der 300ms-Cache-Write ist schon durch
    expect(lsCache().notes.wissensbasis[0].text).toBe("ABC");
    await settle(300); // PUT löst jetzt auf (Erfolgspfad)
    fake.stateDelayMs = 0;
    expect(lsCache().notes.wissensbasis[0].text).toBe("ABC"); // NICHT auf "AB" zurückgesetzt
  });

  it("R4: Reconnect auf ein ANDERES Daten-Repo mischt KEINE lokalen Post-its aus dem alten Repo ins neue", async () => {
    seedRepo({ wissensbasis: [] });
    await mountApp();
    await clickAddNote();
    await settle(3000); // Post-it in Repo A synchronisiert
    await setViaNativeSetter(textareas()[0], "Geheim aus A");
    await settle(500); // < 2,5s: NICHT ins Repo A geschrieben (nur lokaler State)

    // Repo B vorbereiten: eigenes, unabhängiges Post-it.
    fake.setFor("o", "repo-b", "wissensbasis.md", "# Wissensbasis\n\n## Inbox\n\nText\n");
    fake.setFor("o", "repo-b", STATE, JSON.stringify({
      v: 2, active: "wissensbasis", chat: [], model: "x", collapsed: {}, order: ["wissensbasis"],
      quicknotes: { wissensbasis: [{ id: "bNote", text: "Notiz B", x: 5, y: 5, w: 260, h: 200, u: Date.now() }] },
    }, null, 2));

    await openSettingsAndConnect({ owner: "o", repo: "repo-b", pat: "p", apiKey: "k" });

    const remoteB = JSON.parse(fake.filesFor({ owner: "o", repo: "repo-b" }).get(STATE).text).quicknotes.wissensbasis;
    expect(remoteB.map((n) => n.text)).toEqual(["Notiz B"]); // NICHT "Geheim aus A"
    expect(textareas().map((t) => t.value)).toEqual(["Notiz B"]);
  });

  it("R5b: Nach einem maxWait-Flush bleibt der Fokus-/Poll-Refresh NICHT dauerhaft blockiert", async () => {
    seedRepo({ wissensbasis: [] });
    await mountApp();
    await clickAddNote();
    await settle(3000);
    const ta = textareas()[0];
    // Dauertippen über die 10s-maxWait-Grenze (wie P7) – löst den maxWait-
    // Zweig im Save-Effect aus.
    for (let i = 0; i < 6; i++) {
      await setViaNativeSetter(ta, "Text " + i);
      await settle(2000);
    }
    expect(remoteState().quicknotes.wissensbasis[0].text).not.toBe("");
    // Gerät B schreibt jetzt ein eigenes Post-it direkt ins Repo.
    const st = remoteState();
    st.quicknotes.wissensbasis.push({ id: "geraetB1", text: "Von B", x: 1, y: 1, w: 260, h: 200, u: Date.now() });
    fake.set(STATE, JSON.stringify(st, null, 2));
    // Der 25s-Poll (maybeRefresh) muss B's Notiz abholen – ohne den Fix
    // blieb "!stateTimer.current" nach dem maxWait-Flush dauerhaft falsch.
    await settle(26000);
    expect(textareas().map((t) => t.value)).toContain("Von B");
  });

  // v7.57.1-Nachbesserung Runde 2 (Review-Fund 🟡, DECISIONS #121): reine
  // TESTLÜCKEN (kein Code-Fehler) – die vorhandenen Tests deckten den
  // Poll-Merge NICHT für den Fall ab, dass ein vorheriger lokaler Write
  // NICHT-Konflikt-fehlgeschlagen ist (M2), den pagehide-Sofort-Write (M3)
  // und den "u"-Zeitstempel (M4). DECISIONS.md:15251 (#120) behauptete
  // fälschlich, M2 sei über R5b "indirekt abgedeckt" – R5b bleibt grün, weil
  // dessen Remote-Stand ohnehin BEIDE Notizen enthält, unabhängig davon, ob
  // hier gemergt oder blind gespreadet würde.
  it("M2: Nach einem gescheiterten (NICHT-Konflikt-)Write verwirft der nächste Poll den lokalen Text NICHT mehr", async () => {
    seedRepo({ wissensbasis: [] });
    await mountApp();
    await clickAddNote();
    await settle(3000); // Basis kennt die (leere) Notiz
    fake.failStatePut = 1; // der NÄCHSTE state.json-PUT scheitert (kein SHA-Konflikt)
    await setViaNativeSetter(textareas()[0], "Offline-Text");
    await settle(3000); // Debounce löst aus -> PUT scheitert -> saveState "error", KEIN Retry
    expect(remoteState().quicknotes.wissensbasis[0].text).toBe(""); // Repo weiß nichts vom Write
    // Gerät B schreibt jetzt direkt (kein Konflikt mit A, A's Versuch kam ja nie an).
    const st = remoteState();
    st.quicknotes.wissensbasis.push({ id: "geraetB1", text: "Von B", x: 1, y: 1, w: 260, h: 200, u: Date.now() });
    fake.set(STATE, JSON.stringify(st, null, 2));
    await settle(26000); // 25s-Poll holt B's Änderung
    const values = textareas().map((t) => t.value);
    expect(values).toContain("Offline-Text"); // lokale Eingabe bleibt (3-Wege-Merge statt blinder Spread)
    expect(values).toContain("Von B");
  });

  it("M3: pagehide schreibt den Schnellnotizen-Cache SOFORT, ohne die 300ms-Debounce abzuwarten", async () => {
    seedRepo({ wissensbasis: [] });
    await mountApp();
    await clickAddNote();
    await settle(3000);
    await setViaNativeSetter(textareas()[0], "Vor dem Verlassen");
    // Direkt danach (0ms, der 300ms-Cache-Effect ist noch NICHT gelaufen):
    expect(lsCache().notes.wissensbasis[0].text).toBe("");
    expect(remoteState().quicknotes.wissensbasis[0].text).toBe(""); // Repo weiß noch nichts (< 2,5s-Debounce)
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    expect(lsCache().notes.wissensbasis[0].text).toBe("Vor dem Verlassen");
    // v7.57.1-NACHBESSERUNG Runde 3 (Review-Fund 🔵, DECISIONS #122): M3 prüfte
    // bisher NUR den Cache-Write, nicht den sofortigen PUT, der den 2,5s-
    // Debounce-Timer ersetzt (App.jsx#flushBeforeUnload ruft flushState()
    // direkt auf) – ein Mutant, der NUR diesen PUT entfernt, blieb dadurch
    // unentdeckt.
    await settle(0); // reicht für den (ungedelayten) Mock-PUT, VOR Ablauf der 2,5s
    expect(remoteState().quicknotes.wissensbasis[0].text).toBe("Vor dem Verlassen");
  });

  // v7.57.1-NACHBESSERUNG Runde 3 (Review-Fund 🔵, DECISIONS #122): derselbe
  // Sofort-Flush wie M3, aber über den ANDEREN Auslöser (visibilitychange=
  // "hidden" statt pagehide) – auf Mobilgeräten oft das einzige Signal, das
  // beim Tab-Wechsel zuverlässig ankommt. App.jsx#onHidden ruft dieselbe
  // flushBeforeUnload()-Funktion auf wie der pagehide-Listener.
  it("A3c: visibilitychange='hidden' löst denselben Sofort-Flush aus wie pagehide", async () => {
    seedRepo({ wissensbasis: [] });
    await mountApp();
    await clickAddNote();
    await settle(3000);
    await setViaNativeSetter(textareas()[0], "Vor dem Tabwechsel");
    expect(remoteState().quicknotes.wissensbasis[0].text).toBe("");
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange", { bubbles: true })); });
    await settle(0);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    expect(lsCache().notes.wissensbasis[0].text).toBe("Vor dem Tabwechsel");
    expect(remoteState().quicknotes.wissensbasis[0].text).toBe("Vor dem Tabwechsel");
  });

  // v7.57.1-Nachbesserung (Testlücke a, DECISIONS #124): M3/A3c dispatchen
  // das Event bisher über `await act(async () => { ... })` und lesen den
  // Cache DANACH – React/`act()` flusht dabei alle anstehenden Microtasks,
  // wodurch der (mit stateDelayMs=0 praktisch sofort auflösende) PUT in
  // `flushState()` Zeit genug bekommt, den Cache über seinen EIGENEN
  // Erfolgspfad (`saveQuickNotesCache(..., written)`, App.jsx#flushState)
  // ebenfalls zu aktualisieren – ein Mutant, der NUR den synchronen
  // `saveQuickNotesCache(...)`-Aufruf in `flushBeforeUnload()` entfernt,
  // blieb dadurch unentdeckt (M3/A3c blieben grün, siehe Bericht). Dieser
  // Test dispatcht bewusst über das SYNCHRONE `act(() => { ... })` (kein
  // `async`, kein `await`) und lässt den PUT über `fake.stateDelayMs`
  // absichtlich "hängen" (löst während des Tests nie auf) – der Cache MUSS
  // also allein durch den synchronen Aufruf in `flushBeforeUnload()`
  // aktuell sein, ohne dass irgendein Promise abgewartet wurde.
  it("A9 (Testlücke a): der Cache-Write in flushBeforeUnload ist SYNCHRON, unabhängig vom (hier nie auflösenden) PUT", async () => {
    seedRepo({ wissensbasis: [] });
    await mountApp();
    await clickAddNote();
    await settle(3000);
    await setViaNativeSetter(textareas()[0], "Sync-Cache-Text");
    expect(lsCache().notes.wissensbasis[0].text).toBe("");
    fake.stateDelayMs = 3600000; // PUT "hängt" für den Rest des Tests
    act(() => { window.dispatchEvent(new Event("pagehide")); }); // bewusst SYNCHRON
    expect(lsCache().notes.wissensbasis[0].text).toBe("Sync-Cache-Text");
  });

  it("M4: eine Textänderung stempelt 'u' neu (Zeitstempel-Grundlage für den Merge-Tiebreak)", async () => {
    seedRepo({ wissensbasis: [] });
    await mountApp();
    await clickAddNote();
    await settle(3000);
    const before = lsCache().notes.wissensbasis[0].u;
    expect(typeof before).toBe("number");
    await settle(5000); // Zeit vergeht, damit sich Date.now() beim nächsten Stempel unterscheidet
    await setViaNativeSetter(textareas()[0], "Geändert");
    await settle(400); // 300ms-Cache-Effect abwarten
    const after = lsCache().notes.wissensbasis[0].u;
    expect(after).toBeGreaterThan(before);
  });

  // v7.57.1-Nachbesserung (Review-Fund 🟡, DECISIONS #121): derselbe
  // foreignRepo-Schutz wie R4, aber das NEUE Repo hat GAR KEIN
  // "quicknotes"-Feld (F1: gar keine state.json, F2: state.json ohne das
  // Feld) – vorher griff der foreignRepo-Vergleich NUR innerhalb
  // "if (nQuick)" und ließ die lokalen Post-its aus dem ALTEN Repo
  // unangetastet im UI stehen, der Save-Effect schrieb sie anschließend INS
  // NEUE Repo zurück.
  it("F1: Reconnect auf ein fremdes Repo OHNE state.json verwirft die lokalen Post-its des alten Repos", async () => {
    seedRepo({ wissensbasis: [] });
    await mountApp();
    await clickAddNote();
    await settle(3000);
    await setViaNativeSetter(textareas()[0], "Geheim aus A");
    await settle(500); // < 2,5s: NICHT ins Repo A geschrieben

    // Repo B: NUR die Notizbuch-Datei, GAR KEINE state.json.
    fake.setFor("o", "repo-b", "wissensbasis.md", "# Wissensbasis\n\n## Inbox\n\nText\n");

    await openSettingsAndConnect({ owner: "o", repo: "repo-b", pat: "p", apiKey: "k" });

    expect(textareas().length).toBe(0); // "Geheim aus A" NICHT im neuen Repo sichtbar
    await settle(3000); // Save-Effect schreibt jetzt den initialen State ins neue Repo
    const stB = fake.filesFor({ owner: "o", repo: "repo-b" }).get(STATE);
    // v7.57.1-NACHBESSERUNG Runde 3 (Review-Fund 🔵, DECISIONS #122): die
    // Assertion war bisher UNTER "if (stB)" bedingt – schriebe der Save-
    // Effect aus irgendeinem Grund GAR NICHT, lief der Test ohne jede
    // Prüfung grün durch. Der Save-Effect schreibt hier IMMER (der
    // Merge-Stand "wissensbasis: []" weicht vom initialen "kein
    // lastSavedState" ab) – die Assertion ist deshalb jetzt unbedingt.
    expect(stB).toBeTruthy();
    expect(JSON.parse(stB.text).quicknotes).toEqual({ wissensbasis: [] }); // NICHT "Geheim aus A"
  });

  it("F2: Reconnect auf ein fremdes Repo mit state.json OHNE 'quicknotes'-Feld verwirft die lokalen Post-its des alten Repos", async () => {
    seedRepo({ wissensbasis: [] });
    await mountApp();
    await clickAddNote();
    await settle(3000);
    await setViaNativeSetter(textareas()[0], "Geheim aus A");
    await settle(500);

    fake.setFor("o", "repo-b", "wissensbasis.md", "# Wissensbasis\n\n## Inbox\n\nText\n");
    fake.setFor("o", "repo-b", STATE, JSON.stringify(
      { v: 2, active: "wissensbasis", chat: [], model: "x", collapsed: {}, order: ["wissensbasis"] }, null, 2
    )); // KEIN "quicknotes"-Feld

    await openSettingsAndConnect({ owner: "o", repo: "repo-b", pat: "p", apiKey: "k" });

    expect(textareas().length).toBe(0);
    await settle(3000);
    const stB = JSON.parse(fake.filesFor({ owner: "o", repo: "repo-b" }).get(STATE).text);
    expect(JSON.stringify(stB.quicknotes || {})).not.toContain("Geheim aus A"); // NICHT zurückgeschrieben
  });
});

/* -------------------------------------------------------------------- */
/* v7.57.1-NACHBESSERUNG Runde 4 (Review-Fund 🟡🔵, DECISIONS #123): das    */
/* Zwei-Geräte-Kriterium aus Auftrag #119/#122 ("nach der Angleichung     */
/* KEIN weiterer state.json-PUT") war bisher NUR auf reiner Funktions-     */
/* Ebene (tests/quicknotes.test.js) gepinnt, nicht im tatsächlichen        */
/* App.jsx-Zusammenspiel (lastSavedState wird in connect()/maybeRefresh    */
/* aus dem Remote-Rohstand gebildet, quickNotesAll aus dem Merge-Ergebnis  */
/* – ein vertauschtes Argument dort wäre unbemerkt geblieben). Zusätzlich  */
/* zwei Regressionstests für die zwei Fallback-Stellen im Konfliktpfad     */
/* (App.jsx#flushState, remoteQuick-Fallback auf null bzw. Basis), die     */
/* #122 als "eventuell gleichwertiger Mutant" offen gelassen hatte – beide */
/* sind tatsächlich KEINE gleichwertigen Mutanten (siehe DECISIONS #123).  */
/* -------------------------------------------------------------------- */
describe("Review-Nachbesserung Runde 4 (DECISIONS #123): App-Level-Schreibschleife + Konfliktpfad-Fallbacks", () => {
  it("PP2: zwei Geräte mit abweichender Notizbuch-Reihenfolge – nach dem Laden KEIN state.json-PUT", async () => {
    fake.set("wissensbasis.md", "# Wissensbasis\n\n## Inbox\n\nText\n");
    fake.set("notizbuecher/p.md", "# P\n\n## Inbox\n\nx\n");
    fake.set("notizbuecher/q.md", "# Q\n\n## Inbox\n\ny\n");
    const nt = (id) => ({ id, text: id, x: 10, y: 10, w: 260, h: 200, u: 1000 });
    const wqp = { wissensbasis: [], q: [nt("q1")], p: [nt("p1")] }; // Remote-Reihenfolge W,Q,P
    const wpq = { wissensbasis: [], p: [nt("p1")], q: [nt("q1")] }; // Gerät B: Cache-Reihenfolge W,P,Q
    fake.set(STATE, JSON.stringify({
      v: 2, active: "wissensbasis", chat: [], model: "x", collapsed: {}, order: ["wissensbasis", "p", "q"], quicknotes: wqp,
    }, null, 2));
    // Gerät A: Cache-Reihenfolge entspricht bereits der Remote-Reihenfolge.
    localStorage.setItem(QN_KEY, JSON.stringify({ v: 2, notes: wqp, base: wqp }));
    const A = await mountInto();
    // Gerät B: ANDERE Cache-Reihenfolge (nur die Objekt-Schlüsselreihenfolge
    // weicht ab, der Inhalt ist identisch) – wirkt nur auf B, siehe mountInto().
    localStorage.setItem(QN_KEY, JSON.stringify({ v: 2, notes: wpq, base: wpq }));
    const B = await mountInto();
    // Testlücke d (DECISIONS #124): das Abräumen der beiden ZUSÄTZLICHEN
    // Instanzen stand bisher NACH den Assertions, ohne try/finally – ein
    // fehlschlagender Test (z. B. bei einem echten Regressions-Fund) hätte
    // A/B unmounted+ungeräumt hinterlassen (laufende 25s-Poll-Intervalle,
    // nicht entfernte DOM-Container), was NACHFOLGENDE Tests in dieser
    // Datei verunreinigen könnte (zusätzliche `window`-Event-Listener bzw.
    // Timer, die auf denselben `fake`-Mock zugreifen). finally garantiert
    // das Abräumen auch im Fehlerfall.
    try {
      const sha0 = fake.files.get(STATE).sha;
      // 12×10s = 120s, wie in der Review-Probe – beide Geräte pollen alle 25s
      // (maybeRefresh) zusätzlich zum initialen Save-Effect.
      for (let i = 0; i < 12; i++) await settle(10000);
      expect(fake.statePuts).toBe(0);
      expect(fake.files.get(STATE).sha).toBe(sha0);
    } finally {
      for (const X of [A, B]) { act(() => X.r.unmount()); X.c.remove(); }
    }
  });

  // Testlücke c (DECISIONS #124): PP2 oben läuft zwar 120s (mehrere
  // 25s-Polls), erreicht den "if (nQuick) {…}"-Merge-Zweig in
  // App.jsx#maybeRefresh dabei aber NIE – ohne EIGENEN inhaltlichen Write
  // ändert sich die Remote-SHA nie, `st.sha !== stateSha.current` bleibt
  // während des GESAMTEN Testlaufs falsch, der Zweig wird schlicht nie
  // betreten. Dieser Test erzwingt EINE echte SHA-Änderung (ein "anderes
  // Gerät" schreibt dieselben Notizen mit ABWEICHENDER Notizbuch-
  // Reihenfolge zurück) und prüft GENAU das PP2-Kriterium ("kein Folge-PUT
  // nach der Angleichung"), aber diesmal ÜBER DEN POLL-PFAD statt über
  // connect().
  it("PP3 (Testlücke c, Gegenstück zu PP2 für den Poll-Pfad): ein remote SHA-Wechsel mit abweichender Notizbuch-Reihenfolge (gleicher Inhalt) löst im Poll (maybeRefresh) KEINEN Folge-PUT aus", async () => {
    fake.set("wissensbasis.md", "# Wissensbasis\n\n## Inbox\n\nText\n");
    fake.set("notizbuecher/p.md", "# P\n\n## Inbox\n\nx\n");
    fake.set("notizbuecher/q.md", "# Q\n\n## Inbox\n\ny\n");
    const nt = (id) => ({ id, text: id, x: 10, y: 10, w: 260, h: 200, u: 1000 });
    const wqp = { wissensbasis: [], q: [nt("q1")], p: [nt("p1")] };
    fake.set(STATE, JSON.stringify({
      v: 2, active: "wissensbasis", chat: [], model: "x", collapsed: {}, order: ["wissensbasis", "p", "q"], quicknotes: wqp,
    }, null, 2));
    localStorage.setItem(QN_KEY, JSON.stringify({ v: 2, notes: wqp, base: wqp }));
    await mountApp();
    await settle(3000); // Save-Effect ggf. einmal anlaufen lassen; Inhalt identisch -> kein Diff
    const putsAfterConnect = fake.statePuts;
    expect(putsAfterConnect).toBe(0);
    const shaAfterConnect = fake.files.get(STATE).sha;

    // Ein anderes Gerät schreibt DIESELBEN Notizen zurück, NUR die
    // Notizbuch-Reihenfolge im JSON weicht ab (neue SHA, gleicher Inhalt).
    const wpq = { wissensbasis: [], p: [nt("p1")], q: [nt("q1")] };
    fake.set(STATE, JSON.stringify({
      v: 2, active: "wissensbasis", chat: [], model: "x", collapsed: {}, order: ["wissensbasis", "p", "q"], quicknotes: wpq,
    }, null, 2));
    expect(fake.files.get(STATE).sha).not.toBe(shaAfterConnect);

    // 25s-Poll (maybeRefresh) liest den neuen Stand ein und mergt die
    // Schnellnotizen über GENAU den Zweig, den PP2 nie erreicht. Zusätzlich
    // 5s für den 2,5s-Debounce des Save-Effects abwarten, DER erst NACH dem
    // Poll ausgelöst würde, falls der Merge einen (fälschlichen) Unterschied
    // zu lastSavedState hinterlässt.
    await settle(25000);
    await settle(5000);
    expect(fake.statePuts).toBe(putsAfterConnect); // KEIN Folge-PUT durch den Poll-Merge
    // Review-Fund 🔵 (DECISIONS #125): reine "kein PUT"-Prüfung wird auch
    // grün, wenn der Poll den "if (nQuick)"-Merge-Zweig künftig GAR NICHT
    // mehr erreicht (Drosselung, geänderte Bedingung) – exakt die Schwäche,
    // die PP2 vor #124 hatte. Positive Erreichbarkeits-Probe: die lokale
    // Cache-Reihenfolge war w,q,p; NUR der Poll-Merge übernimmt die
    // Remote-Reihenfolge w,p,q – das belegt, dass der Zweig TATSÄCHLICH lief.
    expect(Object.keys(lsCache().notes)).toEqual(["wissensbasis", "p", "q"]);
  });

  // v7.57.1-NACHBESSERUNG Runde 4 (Review-Fund 🔵, DECISIONS #123, korrigiert
  // #122s "bewusst NICHT umgesetzt"-Einschätzung): der `remoteQuick`-Fallback
  // in App.jsx#flushState (Konfliktpfad) fällt auf `null` zurück, wenn das
  // Remote-state.json GAR KEIN "quicknotes"-Feld hat ("unverändert", siehe
  // Kommentar dort) – NICHT auf `{}` ("Remote hat alles gelöscht"). Ein
  // Mutant, der den Fallback auf `{}` ändert, löscht ein unverändertes,
  // bereits synchronisiertes zweites Post-it, sobald GENAU DANN ein
  // SHA-Konflikt mit einem ALTEN Remote-Stand (ohne "quicknotes") auftritt.
  it("A7: Konflikt mit einem Remote-state.json OHNE 'quicknotes'-Feld löscht ein unverändertes zweites Post-it NICHT", async () => {
    seedRepo({ wissensbasis: [] });
    await mountApp();
    await clickAddNote();
    await clickAddNote();
    await settle(3000); // Basis kennt jetzt beide (leeren) Notizen
    await setViaNativeSetter(textareas()[0], "geändert");
    await settle(500); // < 2,5s: NICHT ins Repo geschrieben, Debounce steht noch aus
    // Ein altes Gerät schreibt DAZWISCHEN eine state.json OHNE "quicknotes".
    const st = remoteState();
    delete st.quicknotes;
    fake.set(STATE, JSON.stringify(st, null, 2));
    await settle(3000); // Debounce löst aus -> SHA-Konflikt -> Merge im Konfliktpfad
    expect(textareas().length).toBe(2);
    expect(remoteState().quicknotes.wissensbasis.length).toBe(2);
  });

  // Derselbe Konfliktpfad, aber die Basis für den Merge (App.jsx#flushState:
  // `mergeQuickNotes(quickNotesBaseRef.current, flushedQuick, remoteQuick)`).
  // Fiele die Basis dort auf `null` ("unbekannt") zurück, würde ein per X
  // gelöschtes Post-it im Konfliktpfad wieder auferstehen (reine Vereinigung
  // ohne Löschsemantik bei unbekannter Basis, siehe quicknotes.js).
  it("A8: Konflikt nach lokaler Löschung – das gelöschte Post-it ersteht NICHT wieder auf", async () => {
    seedRepo({ wissensbasis: [] });
    await mountApp();
    await clickAddNote();
    await settle(3000); // Basis kennt die (leere) Notiz
    const xBtn = container.querySelector(`button[title="${X_TITLE}"]`);
    expect(xBtn).toBeTruthy();
    await act(async () => { xBtn.click(); });
    await settle(500); // < 2,5s: Löschung ist NICHT im Repo angekommen
    // Ein anderes Gerät schreibt DAZWISCHEN dieselbe (unveränderte) Notiz mit
    // neuer SHA zurück (z. B. ein rein kosmetischer Save ohne inhaltliche
    // Änderung) – das reicht für einen SHA-Konflikt im nächsten Flush.
    fake.set(STATE, fake.files.get(STATE).text);
    await settle(3000); // Debounce löst aus -> SHA-Konflikt -> Merge im Konfliktpfad
    expect(textareas().length).toBe(0);
    expect(remoteState().quicknotes.wissensbasis).toEqual([]);
  });

  // Testlücke b (DECISIONS #124): A8 oben deckt nur EINEN Konflikt ab, bei
  // dem die Basis von VOR dem Konflikt bereits korrekt war. Dieser Test
  // prüft die NACHFÜHRUNG der Basis NACH einem Konflikt
  // (`quickNotesBaseRef.current = mergedQuick;`, App.jsx#flushState) über
  // ZWEI aufeinanderfolgende Konflikte: Runde 1 lernt eine fremde Notiz "Y"
  // NEU kennen (Basis kannte sie vorher nicht); Runde 2 prüft, ob eine
  // ZWISCHENZEITLICHE Löschung von "Y" durch ein anderes Gerät korrekt
  // respektiert wird. Ohne die Nachführung bliebe die Basis in Runde 2 auf
  // dem Runde-1-Stand (kennt "Y" nicht) stehen – für "Y" gilt dann
  // "Basis unbekannt", und `mergeOneNote()` behandelt eine bei unbekannter
  // Basis NUR-remote-gelöschte Notiz als reine Vereinigung: "Y" ersteht im
  // lokalen Stand (der die Löschung nie erfahren hat) wieder auf.
  it("A10 (Testlücke b): die Merge-Basis wird NACH einem Konflikt nachgeführt – sonst ersteht ein von einem anderen Gerät gelöschtes Post-it wieder auf", async () => {
    seedRepo({ wissensbasis: [] });
    await mountApp();
    await clickAddNote(); // Notiz "X"
    await setViaNativeSetter(textareas()[0], "X-original");
    await settle(3000); // Basis kennt jetzt genau "X-original"

    // Runde 1: lokal wird eine zweite (leere) Notiz "L" angelegt, WÄHREND
    // ein anderes Gerät parallel eine dritte Notiz "Y" ins Repo schreibt –
    // das erzeugt beim nächsten Flush einen SHA-Konflikt, der Merge lernt
    // "Y" dabei zum ERSTEN MAL kennen.
    await clickAddNote(); // Notiz "L" (leer)
    const st1 = remoteState();
    st1.quicknotes.wissensbasis.push({ id: "geraetB-Y", text: "Von B (Y)", x: 5, y: 5, w: 260, h: 200, u: Date.now() });
    fake.set(STATE, JSON.stringify(st1, null, 2));
    await settle(3000); // Debounce -> SHA-Konflikt -> Merge (Runde 1)
    expect(textareas().length).toBe(3);
    expect(remoteState().quicknotes.wissensbasis.map((n) => n.text)).toContain("Von B (Y)");

    // Runde 2: lokal wird die (noch leere) Notiz "L" bearbeitet (pending),
    // WÄHREND ein anderes Gerät "Y" wieder LÖSCHT.
    const idxL = textareas().findIndex((t) => t.value === "");
    expect(idxL).toBeGreaterThanOrEqual(0);
    await setViaNativeSetter(textareas()[idxL], "L-bearbeitet");
    await settle(500); // < 2,5s: noch nicht geflusht
    const st2 = remoteState();
    st2.quicknotes.wissensbasis = st2.quicknotes.wissensbasis.filter((n) => n.text !== "Von B (Y)");
    fake.set(STATE, JSON.stringify(st2, null, 2));
    await settle(3000); // Debounce -> SHA-Konflikt -> Merge (Runde 2)

    // "Y" bleibt gelöscht (Basis kannte "Y" seit Runde 1, die Löschung wird
    // respektiert) – sowohl im Repo als auch im UI.
    expect(remoteState().quicknotes.wissensbasis.map((n) => n.text)).not.toContain("Von B (Y)");
    expect(textareas().map((t) => t.value)).not.toContain("Von B (Y)");
    expect(textareas().map((t) => t.value)).toContain("X-original");
    expect(textareas().map((t) => t.value)).toContain("L-bearbeitet");
  });
});

/* -------------------------------------------------------------------- */
/* v7.57.1-Nachbesserung (Review-Fund 🔵, DECISIONS #125): A10 oben     */
/* deckt die Basis-Nachführung nur für den KONFLIKT-Pfad (flushState) ab. */
/* Dieselbe Fehlerklasse (Basis nicht nachgeführt -> ein woanders          */
/* gelöschtes Post-it ersteht wieder auf) gilt strukturell auch für die    */
/* beiden ANDEREN Stellen, die quickNotesBaseRef.current setzen: den       */
/* 25s-Poll (App.jsx#maybeRefresh, "nQuick"-Zweig) und den connect()-Pfad  */
/* (Reload/Reconnect). Mutationsprobe (manuell durchgeführt, danach        */
/* zurückgesetzt): Entfernt man `quickNotesBaseRef.current = nQuick;` im    */
/* Poll-Pfad bzw. `quickNotesBaseRef.current = effQuick;` im connect()-     */
/* Pfad, bleiben ALLE bisherigen 23 Tests in dieser Datei GRÜN – erst „CR6“ */
/* bzw. „CR6c“ unten werden bei der jeweiligen Mutation ROT.               */
/* -------------------------------------------------------------------- */
describe("CR6 Poll-Basis (Review-Fund 🔵, DECISIONS #125)", () => {
  it("CR6: Post-it, das Gerät B anlegt und wieder löscht, bleibt nach zwei Polls gelöscht", async () => {
    seedRepo({ wissensbasis: [] });
    await mountApp();
    await clickAddNote();
    await setViaNativeSetter(textareas()[0], "X-original");
    await settle(3000); // Basis kennt jetzt "X-original"
    // Poll 1: Gerät B legt "Y" NEU an – der Poll-Merge lernt "Y" zum ERSTEN
    // MAL kennen und muss quickNotesBaseRef.current NACHFÜHREN, sonst gilt
    // "Y" beim nächsten Poll weiterhin als "Basis unbekannt".
    const st1 = remoteState();
    st1.quicknotes.wissensbasis.push({ id: "geraetB-Y", text: "Von B (Y)", x: 5, y: 5, w: 260, h: 200, u: Date.now() });
    fake.set(STATE, JSON.stringify(st1, null, 2));
    await settle(26000);
    expect(textareas().map((t) => t.value)).toContain("Von B (Y)");
    // Poll 2: Gerät B löscht "Y" wieder. Ohne Nachführung der Basis in Poll 1
    // behandelt der Merge "Y" hier als reine (unbekannte) Vereinigung statt
    // eine respektierte Löschung – "Y" würde lokal wieder auftauchen.
    const st2 = remoteState();
    st2.quicknotes.wissensbasis = st2.quicknotes.wissensbasis.filter((n) => n.id !== "geraetB-Y");
    fake.set(STATE, JSON.stringify(st2, null, 2));
    await settle(26000);
    await settle(5000);
    expect(textareas().map((t) => t.value)).not.toContain("Von B (Y)");
    expect(remoteState().quicknotes.wissensbasis.map((n) => n.text)).not.toContain("Von B (Y)");
  });
});

describe("CR6 Connect-Basis (Review-Fund 🔵, DECISIONS #125)", () => {
  it("CR6c: Post-it, das Gerät B während eines Reloads anlegt und danach löscht, bleibt gelöscht", async () => {
    seedRepo({ wissensbasis: [] });
    await mountApp();
    await clickAddNote();
    await setViaNativeSetter(textareas()[0], "X-original");
    await settle(3000);
    // Gerät B legt "Y" an, WÄHREND dieses Gerät "neu lädt" – reload() ruft
    // connect() erneut auf, das die Basis (effQuick) für "Y" NACHFÜHREN muss.
    const st1 = remoteState();
    st1.quicknotes.wissensbasis.push({ id: "geraetB-Y", text: "Von B (Y)", x: 5, y: 5, w: 260, h: 200, u: Date.now() });
    fake.set(STATE, JSON.stringify(st1, null, 2));
    await reload();
    await settle(3000);
    expect(textareas().map((t) => t.value)).toContain("Von B (Y)");
    // Gerät B löscht "Y" wieder – der nächste Poll muss die Löschung
    // respektieren, statt "Y" als unbekannt wieder aufzunehmen.
    const st2 = remoteState();
    st2.quicknotes.wissensbasis = st2.quicknotes.wissensbasis.filter((n) => n.id !== "geraetB-Y");
    fake.set(STATE, JSON.stringify(st2, null, 2));
    await settle(26000);
    await settle(5000);
    expect(textareas().map((t) => t.value)).not.toContain("Von B (Y)");
    expect(remoteState().quicknotes.wissensbasis.map((n) => n.text)).not.toContain("Von B (Y)");
  });
});
