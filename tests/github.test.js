import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  utf8ToB64, b64ToUtf8, ghGetFile, ghGetBlob, ghListDir, ghPutFile, ghDeleteFile,
  ghListCommits, ghCommitMeta, ghCheckRepo, ShaConflictError,
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

  it("ghCommitMeta liest die Commit-Anzahl aus dem Link-Header (rel=last)", async () => {
    fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      headers: { get: (h) => (h === "Link"
        ? '<https://api.github.com/repos/o/r/commits?path=x&per_page=1&page=2>; rel="next", ' +
          '<https://api.github.com/repos/o/r/commits?path=x&per_page=1&page=42>; rel="last"'
        : null) },
      json: async () => [commit("c9", "m", "2026-03-03T12:00:00Z")],
    });
    const meta = await ghCommitMeta(CFG, "wissensbasis.md");
    expect(meta.count).toBe(42);
    expect(meta.lastTs).toBe(Date.parse("2026-03-03T12:00:00Z"));
  });

  it("ghCommitMeta: ohne Link-Header count=1, ohne Commits count=0", async () => {
    fetch.mockResolvedValueOnce({
      ok: true, status: 200, headers: { get: () => null },
      json: async () => [commit("c1", "m", "2026-01-01T00:00:00Z")],
    });
    expect((await ghCommitMeta(CFG, "x.md")).count).toBe(1);
    fetch.mockResolvedValueOnce({
      ok: true, status: 200, headers: { get: () => null }, json: async () => [],
    });
    expect(await ghCommitMeta(CFG, "leer.md")).toEqual({ count: 0, lastTs: null });
  });

  it("ghCheckRepo: true bei Erfolg, 403-Meldung nennt die PAT-Berechtigung", async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 200 });
    expect(await ghCheckRepo(CFG)).toBe(true);
    fetch.mockResolvedValueOnce({ ok: false, status: 403 });
    await expect(ghCheckRepo(CFG)).rejects.toThrow(/Contents: Read and write/);
  });
});
