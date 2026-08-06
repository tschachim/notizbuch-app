// @vitest-environment jsdom
// FileReader-basierte Helfer brauchen DOM-APIs; Canvas-Funktionen
// (makeNotebookIcon, prepareImage-Verkleinerung) sind in jsdom nicht
// verfügbar und werden über die E2E-Testfälle abgedeckt.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prepareImage, readAsDataURL, uploadEditorImage } from "../src/lib/images.js";
import { fileToBase64 } from "../src/lib/knowledge.js";
import { b64ToUtf8 } from "../src/lib/github.js";

describe("readAsDataURL / fileToBase64", () => {
  it("liest Dateien als data-URL bzw. reines Base64 (Roundtrip)", async () => {
    const f = new File(["Inhalt äöü"], "t.txt", { type: "text/plain" });
    const dataUrl = await readAsDataURL(f);
    expect(dataUrl).toMatch(/^data:text\/plain;base64,/);
    const b64 = await fileToBase64(f);
    expect(dataUrl.endsWith(b64)).toBe(true);
    expect(b64ToUtf8(b64)).toBe("Inhalt äöü");
  });
});

describe("prepareImage (kleiner Pfad, ohne Canvas)", () => {
  it("gibt kleine Bilder unverändert zurück und übernimmt den MIME-Typ", async () => {
    const f = new File([new Uint8Array(100)], "mini.webp", { type: "image/webp" });
    const { dataUrl, mime } = await prepareImage(f);
    expect(mime).toBe("image/webp");
    expect(dataUrl).toMatch(/^data:image\/webp;base64,/);
  });
  it("fällt bei unbekanntem Typ auf png zurück", async () => {
    const f = new File([new Uint8Array(10)], "roh.bin", { type: "" });
    expect((await prepareImage(f)).mime).toBe("image/png");
  });
});

// uploadEditorImage (v7.41 Teil B, Nutzerwunsch "Bilder direkt in den
// Editor kopieren können"): App.jsx#addEditorImage ist nur noch ein
// dünner Wrapper um diese Funktion (siehe dortiger Kommentar) – die
// eigentliche Logik (Verbindungsprüfung, Upload, imgIndex/imgMap-Pflege)
// wird HIER mit echten Datenlagen geprüft, komplett ohne React/DOM.
// fetch wird wie in tests/github.test.js gestubbt, ghPutFile selbst bleibt
// die ECHTE Funktion (kein Mock der eigenen Logik).
describe("uploadEditorImage (v7.41 Teil B, Editor-Bild-Upload)", () => {
  const cfg = { owner: "o", repo: "r", pat: "PAT" };

  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("nicht verbunden (connected:false): klare Meldung, KEIN Netz-Aufruf, kein Eintrag in imgIndex/imgMap", async () => {
    const imgIndex = {};
    const setImgMap = vi.fn();
    const f = new File([new Uint8Array(10)], "shot.png", { type: "image/png" });
    await expect(
      uploadEditorImage(f, { connected: false, cfg, imgIndex, setImgMap })
    ).rejects.toThrow(/Nicht verbunden/);
    expect(fetch).not.toHaveBeenCalled();
    expect(imgIndex).toEqual({});
    expect(setImgMap).not.toHaveBeenCalled();
  });

  it("fehlende Konfiguration (cfg fehlt) wird ebenfalls als 'nicht verbunden' behandelt, KEIN Netz-Aufruf", async () => {
    const f = new File([new Uint8Array(10)], "shot.png", { type: "image/png" });
    await expect(
      uploadEditorImage(f, { connected: true, cfg: null, imgIndex: {}, setImgMap: vi.fn() })
    ).rejects.toThrow(/Nicht verbunden/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("Erfolgspfad: ghPutFile bekommt korrekten Pfad/Base64/Commit-Text, imgIndex UND imgMap werden befüllt, liefert {id, dataUrl}", async () => {
    fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ content: { sha: "s1" }, commit: { sha: "c1" } }),
    });
    const f = new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" });
    const imgIndex = {};
    // Simuliert den funktionalen React-Updater ohne echten useState-Hook –
    // bestehende Einträge dürfen NICHT verloren gehen (Auftrag: "prev" wird
    // gespreadet, nicht ersetzt).
    let mapState = { bestehend: "data:image/png;base64,EXIST" };
    const setImgMap = (fn) => { mapState = fn(mapState); };

    const result = await uploadEditorImage(f, { connected: true, cfg, imgIndex, setImgMap });

    expect(result.id).toMatch(/^[a-z0-9]+$/);
    expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(imgIndex[result.id]).toBe("bilder/" + result.id + ".png");
    expect(mapState.bestehend).toBe("data:image/png;base64,EXIST"); // bleibt erhalten
    expect(mapState[result.id]).toBe(result.dataUrl);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toContain("bilder/" + result.id + ".png");
    expect(url).not.toContain("bilder/" + result.id + ".jpg");
    const body = JSON.parse(opts.body);
    expect(body.message).toContain(result.id);
    // Base64 im GitHub-Request muss exakt dem Base64-Teil der data-URL entsprechen.
    expect(result.dataUrl.endsWith(body.content)).toBe(true);
    expect(body.sha).toBeUndefined(); // Neuanlage, kein Update
  });

  it("wählt die Dateiendung passend zum tatsächlichen MIME-Typ (JPEG -> .jpg)", async () => {
    fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ content: { sha: "s1" }, commit: { sha: "c1" } }),
    });
    const f = new File([new Uint8Array(10)], "shot.jpg", { type: "image/jpeg" });
    const result = await uploadEditorImage(f, {
      connected: true, cfg, imgIndex: {}, setImgMap: vi.fn(),
    });
    expect(result.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    const [url] = fetch.mock.calls[0];
    expect(url).toContain("bilder/" + result.id + ".jpg");
  });

  it("Upload-Fehler (z. B. GitHub-API-Fehler): kein halber Zustand – kein Eintrag in imgIndex/imgMap, Fehler wird weitergereicht", async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" });
    const f = new File([new Uint8Array(10)], "shot.png", { type: "image/png" });
    const imgIndex = {};
    const setImgMap = vi.fn();
    await expect(
      uploadEditorImage(f, { connected: true, cfg, imgIndex, setImgMap })
    ).rejects.toThrow();
    expect(imgIndex).toEqual({});
    expect(setImgMap).not.toHaveBeenCalled();
  });

  it("zwei nacheinander hochgeladene Bilder bekommen unterschiedliche IDs/Pfade und landen beide in imgIndex/imgMap", async () => {
    fetch.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ content: { sha: "s" }, commit: { sha: "c" } }),
    });
    const imgIndex = {};
    let mapState = {};
    const setImgMap = (fn) => { mapState = fn(mapState); };
    const f1 = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    const f2 = new File([new Uint8Array([2])], "b.png", { type: "image/png" });
    const r1 = await uploadEditorImage(f1, { connected: true, cfg, imgIndex, setImgMap });
    const r2 = await uploadEditorImage(f2, { connected: true, cfg, imgIndex, setImgMap });
    expect(r1.id).not.toBe(r2.id);
    expect(Object.keys(imgIndex).sort()).toEqual([r1.id, r2.id].sort());
    expect(Object.keys(mapState).sort()).toEqual([r1.id, r2.id].sort());
  });
});
