import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  utf8ToB64, b64ToUtf8, ghGetFile, ghGetBlob, ghListDir, ghPutFile, ghDeleteFile,
  ghListCommits, ghCommitMeta, ghCheckRepo, ShaConflictError, reconcileNotebooksWithRemote,
  truncateToCurrentIncarnation,
} from "../src/lib/github.js";

const CFG = { owner: "o", repo: "r", pat: "PAT" };

describe("Base64 mit UTF-8", () => {
  it("Roundtrip erhält Umlaute, Emoji und Sonderzeichen", () => {
    const s = "Größe ✓ – „Anführung“ 🚀 \n Zeile2";
    expect(b64ToUtf8(utf8ToB64(s))).toBe(s);
  });
  it("b64ToUtf8 ignoriert Whitespace im Base64 (GitHub liefert Zeilenumbrüche)", () => {
    const b64 = utf8ToB64("Hallo Welt");
    const wrapped = b64.slice(0, 4) + "\n" + b64.slice(4);
    expect(b64ToUtf8(wrapped)).toBe("Hallo Welt");
  });
});

describe("Lesen", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("ghGetFile liefert Text+SHA, null bei 404, klare Fehlermeldung bei 401", async () => {
    fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ encoding: "base64", content: utf8ToB64("# Doc"), sha: "abc", size: 5 }),
    });
    expect(await ghGetFile(CFG, "wissensbasis.md")).toEqual({ text: "# Doc", sha: "abc" });

    fetch.mockResolvedValueOnce({ ok: false, status: 404 });
    expect(await ghGetFile(CFG, "fehlt.md")).toBeNull();

    fetch.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(ghGetFile(CFG, "x.md")).rejects.toThrow(/PAT ungültig/);
  });

  it("ghGetFile lädt große Dateien über den raw-Medientyp nach", async () => {
    fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ encoding: "none", content: "", sha: "big", size: 2000000 }),
    });
    fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => "RIESIG" });
    expect(await ghGetFile(CFG, "gross.md")).toEqual({ text: "RIESIG", sha: "big" });
    expect(fetch.mock.calls[1][1].headers.Accept).toContain("raw");
  });

  it("ghListDir: nur Dateien, [] bei 404 (Ordner darf fehlen)", async () => {
    fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => [
        { type: "file", name: "a.md", path: "d/a.md", sha: "1" },
        { type: "dir", name: "sub", path: "d/sub", sha: "2" },
      ],
    });
    expect(await ghListDir(CFG, "d")).toEqual([{ name: "a.md", path: "d/a.md", sha: "1" }]);
    fetch.mockResolvedValueOnce({ ok: false, status: 404 });
    expect(await ghListDir(CFG, "leer")).toEqual([]);
  });
});

describe("Schreiben", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("ghPutFile schickt SHA nur bei Update mit und liefert neue SHAs", async () => {
    fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ content: { sha: "neu" }, commit: { sha: "c1" } }),
    });
    const res = await ghPutFile(CFG, "x.md", "QjY0", "msg", "alt");
    expect(res).toEqual({ sha: "neu", commitSha: "c1" });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.sha).toBe("alt");
    expect(body.content).toBe("QjY0");

    fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ content: { sha: "n2" }, commit: { sha: "c2" } }),
    });
    await ghPutFile(CFG, "neu.md", "QjY0", "msg"); // ohne sha = anlegen
    expect(JSON.parse(fetch.mock.calls[1][1].body)).not.toHaveProperty("sha");
  });

  it("409 und SHA-422 werden zum ShaConflictError", async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 409 });
    await expect(ghPutFile(CFG, "x.md", "QQ==", "m", "s")).rejects.toBeInstanceOf(ShaConflictError);

    fetch.mockResolvedValueOnce({
      ok: false, status: 422, text: async () => '{"message":"x.md does not match sha"}',
    });
    await expect(ghPutFile(CFG, "x.md", "QQ==", "m", "s")).rejects.toBeInstanceOf(ShaConflictError);
  });

  it("Schreibzugriffe laufen strikt nacheinander (Warteschlange)", async () => {
    const order = [];
    let release1;
    fetch.mockImplementationOnce(() => new Promise((res) => {
      release1 = () => { order.push("put1"); res({ ok: true, status: 200, json: async () => ({ content: {}, commit: {} }) }); };
    }));
    fetch.mockImplementationOnce(async () => {
      order.push("put2");
      return { ok: true, status: 200, json: async () => ({ content: {}, commit: {} }) };
    });
    const p1 = ghPutFile(CFG, "a.md", "QQ==", "m1");
    const p2 = ghPutFile(CFG, "b.md", "QQ==", "m2");
    // put2 darf nicht starten, bevor put1 fertig ist
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual([]);
    release1();
    await Promise.all([p1, p2]);
    expect(order).toEqual(["put1", "put2"]);
  });

  it("die Warteschlange läuft nach einem Fehler weiter", async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 409 });
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ content: { sha: "ok" }, commit: {} }) });
    await expect(ghPutFile(CFG, "a.md", "QQ==", "m", "s")).rejects.toBeInstanceOf(ShaConflictError);
    const res = await ghPutFile(CFG, "b.md", "QQ==", "m");
    expect(res.sha).toBe("ok");
  });

  it("ghGetBlob liefert Blob über raw-Medientyp, null bei 404", async () => {
    const blob = { size: 3 };
    fetch.mockResolvedValueOnce({ ok: true, status: 200, blob: async () => blob });
    expect(await ghGetBlob(CFG, "bilder/a.png")).toBe(blob);
    expect(fetch.mock.calls[0][1].headers.Accept).toContain("raw");
    fetch.mockResolvedValueOnce({ ok: false, status: 404 });
    expect(await ghGetBlob(CFG, "fehlt.png")).toBeNull();
  });

  it("ghDeleteFile toleriert 404 (schon gelöscht), wirft bei 409", async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(ghDeleteFile(CFG, "weg.md", "m", "s")).resolves.toBe(true);
    fetch.mockResolvedValueOnce({ ok: false, status: 409 });
    await expect(ghDeleteFile(CFG, "x.md", "m", "s")).rejects.toBeInstanceOf(ShaConflictError);
  });
});

describe("Historie & Verbindungscheck", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  const commit = (sha, msg, date, parents = []) => ({
    sha, parents,
    commit: { message: msg, committer: { date } },
  });

  it("ghListCommits mappt auf {sha,msg,ts,parent} und nimmt nur die erste Message-Zeile", async () => {
    fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => [
        commit("c2", "Zweite Änderung\n\nDetails im Body", "2026-02-02T10:00:00Z", [{ sha: "c1" }]),
        commit("c1", "Initial", "2026-01-01T09:00:00Z"),
      ],
    });
    const list = await ghListCommits(CFG, "wissensbasis.md");
    expect(list).toEqual([
      { sha: "c2", msg: "Zweite Änderung", ts: Date.parse("2026-02-02T10:00:00Z"), parent: "c1" },
      { sha: "c1", msg: "Initial", ts: Date.parse("2026-01-01T09:00:00Z"), parent: null },
    ]);
  });

  // v7.51: ghCommitMeta fragt jetzt per_page=100 in EINEM Request ab und
  // schneidet über truncateToCurrentIncarnation (siehe eigene describe-Gruppe
  // unten für die reine Schnittlogik). Diese Tests decken die drei Zweige
  // des Umbaus ab: Grenzfund, <100 Einträge ohne Grenze, 100-Fallback.
  it("ghCommitMeta ohne Grenz-Commit und <100 Einträgen: EIN Request genügt, count = Rohlisten-Länge", async () => {
    fetch.mockResolvedValueOnce({
      ok: true, status: 200, headers: { get: () => null },
      json: async () => [
        commit("c3", "dritte Version", "2026-03-03T12:00:00Z"),
        commit("c2", "zweite Version", "2026-02-02T00:00:00Z"),
        commit("c1", "erste Version", "2026-01-01T00:00:00Z"),
      ],
    });
    const meta = await ghCommitMeta(CFG, "wissensbasis.md");
    expect(meta).toEqual({ count: 3, lastTs: Date.parse("2026-03-03T12:00:00Z") });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain("per_page=100");
  });

  it("ghCommitMeta: ohne Commits count=0/lastTs=null, kein zweiter Request", async () => {
    fetch.mockResolvedValueOnce({
      ok: true, status: 200, headers: { get: () => null }, json: async () => [],
    });
    expect(await ghCommitMeta(CFG, "leer.md")).toEqual({ count: 0, lastTs: null });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  // Exakt das E2E-Finding (v7.50-Testerlauf, 🟡): "QA-Test Automatisch" zeigte
  // nach einem Notizbuch-Wechsel "96 Versionen" statt "1 Versionen", weil
  // /commits?path=... die Historie eines früher gelöschten, gleichnamigen
  // Notizbuchs mitliefert. Mit der Anlage-Grenze INKLUSIVE geschnitten zeigt
  // der Zähler wieder nur die aktuelle Inkarnation.
  it("ghCommitMeta: Anlage-Grenze gefunden – zeigt NUR die aktuelle Inkarnation, nicht die Historie eines gelöschten, gleichnamigen Vorgängers (E2E-Finding v7.51)", async () => {
    const vorgaenger = Array.from({ length: 20 }, (_, i) =>
      commit("v" + i, "Vorgänger-Version " + i, "2025-01-01T00:00:00Z"));
    fetch.mockResolvedValueOnce({
      ok: true, status: 200, headers: { get: () => null },
      json: async () => [
        commit("cNeu", "Notizbuch „QA-Test Automatisch“ angelegt", "2026-08-14T09:00:00Z"),
        ...vorgaenger,
      ],
    });
    const meta = await ghCommitMeta(CFG, "notizbuecher/qa-test-automatisch.md");
    expect(meta).toEqual({ count: 1, lastTs: Date.parse("2026-08-14T09:00:00Z") });
    expect(fetch).toHaveBeenCalledTimes(1); // Grenze gefunden - kein Fallback-Request nötig
  });

  it("ghCommitMeta: Lösch-Grenze eines Vorgängers EXKLUSIVE geschnitten (der Lösch-Commit gehört noch zum Vorgänger)", async () => {
    fetch.mockResolvedValueOnce({
      ok: true, status: 200, headers: { get: () => null },
      json: async () => [
        commit("c4", "vierte Version", "2026-04-04T00:00:00Z"),
        commit("c3", "dritte Version", "2026-03-03T00:00:00Z"),
        commit("c2", "Notizbuch „Vorgänger Name“ gelöscht", "2026-02-02T00:00:00Z"),
        commit("c1", "uralte Vorgänger-Version", "2025-01-01T00:00:00Z"),
      ],
    });
    const meta = await ghCommitMeta(CFG, "notizbuecher/wiederverwendet.md");
    expect(meta).toEqual({ count: 2, lastTs: Date.parse("2026-04-04T00:00:00Z") });
  });

  // Review-Fix 🔵 (v7.51): Liegt der Anlage-Commit EXAKT an Position 100
  // (Index 99), kürzt der inklusive Schnitt nichts (truncated.length ===
  // list.length) – ohne die Zusatzprüfung auf den ältesten Eintrag fiele
  // genau dieser Randfall fälschlich in den Link-Header-Fallback und zeigte
  // wieder die Gesamtzahl inkl. Vorgänger statt der korrekten 100.
  it("ghCommitMeta: Anlage-Grenze EXAKT an Position 100 – KEIN Fallback, count = 100", async () => {
    const aktuelle = Array.from({ length: 99 }, (_, i) =>
      commit("a" + i, "aktuelle Version " + i, "2026-06-06T00:00:00Z"));
    fetch.mockResolvedValueOnce({
      ok: true, status: 200, headers: { get: () => null },
      json: async () => [
        ...aktuelle,
        commit("a99", "Notizbuch „Randfall“ angelegt", "2026-01-01T00:00:00Z"),
      ],
    });
    const meta = await ghCommitMeta(CFG, "notizbuecher/randfall.md");
    expect(meta).toEqual({ count: 100, lastTs: Date.parse("2026-06-06T00:00:00Z") });
    expect(fetch).toHaveBeenCalledTimes(1); // Grenze sichtbar - kein zweiter Request
  });

  it("ghCommitMeta: exakt 100 Einträge ohne erkennbare Grenze – Fallback auf den Link-Header-Trick (zweiter Request)", async () => {
    const hundert = Array.from({ length: 100 }, (_, i) =>
      commit("h" + i, "normale Version " + i, "2026-05-05T00:00:00Z"));
    fetch.mockResolvedValueOnce({
      ok: true, status: 200, headers: { get: () => null },
      json: async () => hundert,
    });
    fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      headers: { get: (h) => (h === "Link"
        ? '<https://api.github.com/repos/o/r/commits?path=x&per_page=1&page=2>; rel="next", ' +
          '<https://api.github.com/repos/o/r/commits?path=x&per_page=1&page=142>; rel="last"'
        : null) },
      json: async () => [commit("h0", "normale Version 0", "2026-05-05T00:00:00Z")],
    });
    const meta = await ghCommitMeta(CFG, "sehr-alte-datei.md");
    expect(meta).toEqual({ count: 142, lastTs: Date.parse("2026-05-05T00:00:00Z") });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toContain("per_page=100");
    expect(fetch.mock.calls[1][0]).toContain("per_page=1");
  });

  it("ghCheckRepo: true bei Erfolg, 403-Meldung nennt die PAT-Berechtigung", async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 200 });
    expect(await ghCheckRepo(CFG)).toBe(true);
    fetch.mockResolvedValueOnce({ ok: false, status: 403 });
    await expect(ghCheckRepo(CFG)).rejects.toThrow(/Contents: Read and write/);
  });
});

// v7.51-Fix (E2E-Finding 🟡, siehe DECISIONS #105): GitHubs
// /commits?path=... liefert auch Commits eines früher gelöschten,
// gleichnamigen Notizbuchs mit (der Dateipfad wird aus dem Namen
// abgeleitet und bei erneuter Anlage desselben Namens wiederverwendet).
// truncateToCurrentIncarnation() ist die reine, netzlose Schnittlogik, die
// ghCommitMeta UND der Historie-Dialog in App.jsx gemeinsam nutzen, damit
// Zähler und Liste konsistent bleiben (siehe eigene Tests für ghCommitMeta
// oben für den Netz-Umbau).
describe("truncateToCurrentIncarnation (v7.51, Grenz-Commit-Abgrenzung gegen Pfad-Wiederverwendung)", () => {
  const c = (sha, msg, ts = 0) => ({ sha, msg, ts, parent: null });

  it("kein Grenz-Commit: Liste bleibt inhaltlich unverändert (aber als frische Kopie)", () => {
    const list = [c("c3", "dritte Änderung"), c("c2", "zweite Änderung"), c("c1", "Initial")];
    const res = truncateToCurrentIncarnation(list);
    expect(res).toEqual(list);
    expect(res).not.toBe(list); // eigene Kopie, kein Alias auf die Eingabe
  });

  it("leere Liste bleibt leer", () => {
    expect(truncateToCurrentIncarnation([])).toEqual([]);
  });

  it("Anlage-Grenze mittendrin: INKLUSIVE Schnitt (die Anlage-Version gehört noch zur aktuellen Inkarnation)", () => {
    const list = [
      c("c4", "vierte Änderung"),
      c("c3", "Notizbuch „QA-Test Automatisch“ angelegt"),
      c("c2", "Notizbuch „QA-Test Automatisch“ gelöscht"), // gehört zum Vorgänger, muss weg
      c("c1", "Initial des Vorgängers"),
    ];
    expect(truncateToCurrentIncarnation(list)).toEqual([list[0], list[1]]);
  });

  it("Lösch-Grenze mittendrin: EXKLUSIVE Schnitt (der Lösch-Commit selbst gehört noch zum Vorgänger)", () => {
    const list = [
      c("c3", "dritte Version der aktuellen Inkarnation"),
      c("c2", "zweite Version der aktuellen Inkarnation"),
      c("c1", "Notizbuch „X“ gelöscht"), // Vorgänger-Grenze, exklusive raus
      c("c0", "uralte Vorgänger-Version"),
    ];
    expect(truncateToCurrentIncarnation(list)).toEqual([list[0], list[1]]);
  });

  it("beide Grenzmuster in derselben Liste: der ERSTE (neueste) Treffer gewinnt", () => {
    const list = [
      c("c5", "Notizbuch „X“ angelegt"), // näher an "neu" - gewinnt
      c("c4", "Notizbuch „Y“ gelöscht"),
      c("c3", "Vorgänger-Version"),
    ];
    expect(truncateToCurrentIncarnation(list)).toEqual([list[0]]);
  });

  it("Umbenennen-Commit ist KEINE Grenze (committet auf denselben Pfad, normale Version innerhalb der Inkarnation)", () => {
    const list = [
      c("c3", "Notizbuch umbenannt: „A“ → „B“"),
      c("c2", "Notizbuch „A“ angelegt"),
      c("c1", "Vorgänger-Rest, darf nicht mehr auftauchen"),
    ];
    expect(truncateToCurrentIncarnation(list)).toEqual([list[0], list[1]]);
  });

  it("Lösch-Suffix-Varianten ('… gelöscht: Wissensdatei entfernt' / '… gelöscht: Icon entfernt') matchen NICHT (Muster exakt mit $ verankert)", () => {
    const list = [
      c("c3", "Notizbuch „X“ gelöscht: Wissensdatei entfernt"),
      c("c2", "Notizbuch „X“ gelöscht: Icon entfernt"),
      c("c1", "normale Version"),
    ];
    expect(truncateToCurrentIncarnation(list)).toEqual(list);
  });

  it("Anlage-Commit mit ANDEREM Namen (vor einer späteren Umbenennung) ist trotzdem eine gültige Grenze", () => {
    const list = [
      c("c3", "Notizbuch umbenannt: „Alter Name“ → „Neuer Name“"),
      c("c2", "Notizbuch „Alter Name“ angelegt"),
      c("c1", "Vorgänger-Rest, muss weg"),
    ];
    expect(truncateToCurrentIncarnation(list)).toEqual([list[0], list[1]]);
  });

  // Review-Fix 🔵 (v7.51): Der Notizbuchname darf SELBST typografische
  // Anführungszeichen enthalten – ein nicht-gieriges [^“]* im Muster könnte
  // „Zitate „Goethe““ nicht überspannen, die Grenze bliebe für genau diese
  // Notizbücher dauerhaft unerkannt (Vor-Fix-Zustand: Vorgänger zählt mit).
  it("Notizbuchname mit typografischen Anführungszeichen im Namen ist trotzdem eine gültige Grenze (.* statt [^“]*)", () => {
    const list = [
      c("c3", "neue Version"),
      c("c2", "Notizbuch „Zitate „Goethe““ angelegt"),
      c("c1", "Vorgänger-Rest, muss weg"),
    ];
    expect(truncateToCurrentIncarnation(list)).toEqual([list[0], list[1]]);
    const delList = [
      c("d2", "aktuelle Version"),
      c("d1", "Notizbuch „Zitate „Goethe““ gelöscht"),
      c("d0", "Vorgänger-Rest, muss weg"),
    ];
    expect(truncateToCurrentIncarnation(delList)).toEqual([delList[0]]);
  });
});

// v7.47, Fehler 2 (E2E-Befund gegen v7.41): "Notizbuch anlegen und direkt
// danach einmal 'nach oben' klicken" ließ das gerade angelegte Notizbuch
// kurzzeitig aus dem Verwalten-Dialog verschwinden UND das aktive Notizbuch
// unerwartet zur Wissensbasis wechseln. Ursache GENAU eingegrenzt (Auftrag:
// "Ursache eingrenzen"): NICHT die Sortier-Aktion selbst und KEIN
// verschluckter SHA-Konflikt beim Schreiben von state.json (ein solcher
// Konflikt betrifft nur "order"/"chat" INNERHALB von state.json, niemals das
// "notebooks"-Array selbst) - sondern maybeRefresh (App.jsx, Fokus-/Poll-
// Refresh, DECISIONS #4): dessen ghListDir-Momentaufnahme des
// "notizbuecher/"-Ordners kann - unabhängig vom Klick auf "nach oben" -
// bereits VOR der Neuanlage gestartet worden sein (z. B. durch den
// 25s-Hintergrund-Poll) und erst NACH ihr auswerten. Wird ein frisch
// angelegtes (lokal längst bekanntes) Notizbuch in einer SOLCHEN veralteten
// Auflistung noch nicht gefunden, behandelt die bisherige Logik es identisch
// zu einem ECHTEN "auf einem anderen Gerät gelöscht" - inklusive
// Aktiv-Wechsel, falls es das aktive Notizbuch war.
//
// reconcileNotebooksWithRemote selbst KANN "Alter"/Frische ihrer Eingabe
// nicht beurteilen (sie bekommt nur IDs, keine Epoche) - das ist bewusst so
// (siehe Kopfkommentar in github.js): der eigentliche Fix ist der
// "notebookEpoch"-Guard in App.jsx (maybeRefresh verwirft eine zu alte
// Momentaufnahme VOR dem Aufruf dieser Funktion komplett, siehe
// "Momentaufnahme zu alt"-Test unten, der genau diesen Vertrag dokumentiert,
// statt ihn stillschweigend vorauszusetzen). Die Tests hier decken die REINE
// Zuordnungslogik ab (bei einer GARANTIERT frischen Eingabe).
describe("reconcileNotebooksWithRemote (v7.47, Notizbuch-Abgleich beim Fokus-Refresh)", () => {
  const NBS = [
    { id: "wissensbasis", path: "wissensbasis.md", name: "Wissensbasis" },
    { id: "projekt-a", path: "notizbuecher/projekt-a.md", name: "Projekt A" },
    { id: "projekt-b", path: "notizbuecher/projekt-b.md", name: "Projekt B" },
  ];

  it("nichts entfernt: liefert changed:false, inhaltsgleiche Liste – aber IMMER eine frische Kopie", () => {
    const res = reconcileNotebooksWithRemote(NBS, "projekt-a", ["wissensbasis", "projekt-a", "projekt-b"]);
    expect(res).toEqual({ changed: false, notebooks: NBS, activeId: "projekt-a", removedIds: [] });
    // Review-Nachbesserung zu v7.47: NICHT dieselbe Referenz. Der Aufrufer
    // (App.jsx#maybeRefresh) mutiert die Liste anschließend per push/
    // Index-Zuweisung; träfe das die identische Referenz, die React bereits
    // als "notebooks"-State kennt, bliebe setNotebooks() wegen
    // Object.is-Gleichheit folgenlos. Genau daran ist der erste Entwurf
    // gescheitert – der Kontrakt gehört in die Funktion, nicht in die
    // Disziplin jedes künftigen Aufrufers.
    expect(res.notebooks).not.toBe(NBS);
    expect(res.notebooks).toEqual(NBS);
  });

  it("ein NICHT aktives Notizbuch fehlt remote: wird entfernt, aktives Notizbuch bleibt UNVERÄNDERT", () => {
    const res = reconcileNotebooksWithRemote(NBS, "wissensbasis", ["wissensbasis", "projekt-a"]);
    expect(res.changed).toBe(true);
    expect(res.notebooks.map((n) => n.id)).toEqual(["wissensbasis", "projekt-a"]);
    expect(res.activeId).toBe("wissensbasis"); // unverändert - war nicht betroffen
    expect(res.removedIds).toEqual(["projekt-b"]);
  });

  it("das AKTIVE Notizbuch fehlt remote: wird entfernt, Aktivität wechselt auf das erste verbleibende", () => {
    const res = reconcileNotebooksWithRemote(NBS, "projekt-b", ["wissensbasis", "projekt-a"]);
    expect(res.changed).toBe(true);
    expect(res.notebooks.map((n) => n.id)).toEqual(["wissensbasis", "projekt-a"]);
    expect(res.activeId).toBe("wissensbasis"); // erstes verbleibendes, wie in App.jsx vor v7.47 (nbs[0])
    expect(res.removedIds).toEqual(["projekt-b"]);
  });

  it("mehrere Notizbücher fehlen remote gleichzeitig: alle werden entfernt, activeId wechselt nur wenn nötig", () => {
    const res = reconcileNotebooksWithRemote(NBS, "projekt-a", ["wissensbasis"]);
    expect(res.changed).toBe(true);
    expect(res.notebooks.map((n) => n.id)).toEqual(["wissensbasis"]);
    expect(res.activeId).toBe("wissensbasis");
    expect(res.removedIds.sort()).toEqual(["projekt-a", "projekt-b"]);
  });

  it("KEIN einziges lokales Notizbuch bleibt remote übrig: bewusstes No-op (lieber nichts tun als eine leere Liste anzeigen)", () => {
    const res = reconcileNotebooksWithRemote(NBS, "projekt-a", []);
    expect(res).toEqual({ changed: false, notebooks: NBS, activeId: "projekt-a", removedIds: [] });
  });

  it("eine leere lokale Liste bleibt ein No-op (keine Division durch/Zugriff auf ein nicht existentes erstes Element)", () => {
    const res = reconcileNotebooksWithRemote([], "irgendwas", ["wissensbasis"]);
    expect(res).toEqual({ changed: false, notebooks: [], activeId: "irgendwas", removedIds: [] });
  });

  it("Vertrag dokumentiert (Momentaufnahme zu alt): mit einer VERALTETEN Eingabe (frisch angelegtes Notizbuch fehlt noch remote) würde diese Funktion es fälschlich entfernen - GENAU deshalb prüft App.jsx die notebookEpoch VOR dem Aufruf und ruft die Funktion bei einer zu alten Momentaufnahme gar nicht erst auf", () => {
    // "projekt-c" ist LOKAL bereits bekannt (gerade angelegt), aber die
    // übergebene "remoteIds"-Liste stammt aus einer Anfrage, die VOR dem
    // Anlegen gestartet wurde und kennt es folglich noch nicht.
    const withNew = [...NBS, { id: "projekt-c", path: "notizbuecher/projekt-c.md", name: "Projekt C" }];
    const staleRemoteIds = ["wissensbasis", "projekt-a", "projekt-b"]; // kennt "projekt-c" noch nicht
    const res = reconcileNotebooksWithRemote(withNew, "projekt-c", staleRemoteIds);
    // Isoliert betrachtet "korrekt" (die Funktion kann die Staleness nicht
    // erkennen) - genau DAS ist der Grund für den Epoch-Guard in App.jsx.
    expect(res.changed).toBe(true);
    expect(res.removedIds).toEqual(["projekt-c"]);
    expect(res.activeId).toBe("wissensbasis"); // aktives Notizbuch würde ungewollt wechseln
  });
});
