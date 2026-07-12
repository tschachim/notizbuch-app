import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { diffLines, contextize } from "../src/lib/diff.js";
import { extForMime, mimeForName, dataUrlParts, newImgId } from "../src/lib/images.js";
import {
  safeFileName, extractPathFor, isExtractPath, knowledgeDir, extractText,
} from "../src/lib/knowledge.js";
import { loadSettings, saveSettings, clearSettings } from "../src/lib/settings.js";

describe("diffLines / contextize", () => {
  it("erkennt Zusatz, Löschung und unveränderte Zeilen", () => {
    const d = diffLines("a\nb\nc", "a\nX\nc");
    expect(d).toEqual([
      { t: "s", l: "a" },
      { t: "d", l: "b" },
      { t: "a", l: "X" },
      { t: "s", l: "c" },
    ]);
  });
  it("contextize kürzt lange unveränderte Strecken zu Lücken", () => {
    const oldT = ["k1", ...Array.from({ length: 20 }, (_, i) => "z" + i), "k2"].join("\n");
    const newT = oldT.replace("k2", "k2neu");
    const rows = contextize(diffLines(oldT, newT));
    expect(rows.some((r) => r.t === "gap")).toBe(true);
    expect(rows.filter((r) => r.t !== "gap").length).toBeLessThan(10);
  });
  it("meldet 'keine Änderung' bei identischen Texten", () => {
    expect(contextize(diffLines("a\nb", "a\nb"))).toEqual([
      { t: "info", l: "Keine inhaltliche Änderung." },
    ]);
  });
  it("kapituliert bei riesigen Texten kontrolliert (null statt Freeze)", () => {
    const big = Array.from({ length: 700 }, (_, i) => "l" + i).join("\n");
    expect(diffLines(big, big + "\nx")).toBeNull();
  });
});

describe("images-Helfer", () => {
  it("MIME↔Endung in beide Richtungen, Unbekanntes fällt auf png zurück", () => {
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(extForMime("image/webp")).toBe("webp");
    expect(extForMime("application/pdf")).toBe("png");
    expect(mimeForName("Foto.JPG")).toBe("image/jpeg");
    expect(mimeForName("x.gif")).toBe("image/gif");
    expect(mimeForName("ohne-endung")).toBe("image/png");
  });
  it("dataUrlParts zerlegt korrekt und lehnt Nicht-data-URLs ab", () => {
    expect(dataUrlParts("data:image/png;base64,QUJD")).toEqual({ mime: "image/png", base64: "QUJD" });
    expect(dataUrlParts("https://x.de/bild.png")).toBeNull();
  });
  it("newImgId liefert URL-sichere, praktisch eindeutige IDs", () => {
    const ids = new Set(Array.from({ length: 200 }, newImgId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+$/);
  });
});

describe("knowledge-Helfer", () => {
  it("safeFileName entschärft Umlaute/Sonderzeichen und erhält die Endung", () => {
    expect(safeFileName("Straßen-Übersicht (final).PDF")).toBe("strassen-uebersicht-final.pdf");
    expect(safeFileName("...")).toBe("datei");
    expect(safeFileName("a".repeat(120) + ".txt")).toBe("a".repeat(80) + ".txt");
  });
  it("Extrakt-Pfade sind erkennbar und kollisionsfrei", () => {
    expect(extractPathFor("wissen/nb/handbuch.pdf")).toBe("wissen/nb/handbuch.pdf.extrakt.md");
    expect(isExtractPath("handbuch.pdf.extrakt.md")).toBe(true);
    expect(isExtractPath("handbuch.pdf")).toBe(false);
    expect(knowledgeDir("koch")).toBe("wissen/koch");
  });
  it("extractText liest txt/md direkt und lehnt Unbekanntes mit klarer Meldung ab", async () => {
    const txt = new File(["  Hallo Wissen  "], "notiz.txt", { type: "text/plain" });
    expect(await extractText(txt)).toBe("Hallo Wissen");
    const leer = new File([""], "leer.txt", { type: "text/plain" });
    await expect(extractText(leer)).rejects.toThrow(/leer/);
    const exe = new File(["MZ"], "tool.exe");
    await expect(extractText(exe)).rejects.toThrow(/nicht unterstützt/);
  });
});

describe("settings (localStorage)", () => {
  const store = new Map();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("Roundtrip speichert und lädt vollständige Zugangsdaten", () => {
    const s = { owner: "o", repo: "r", pat: "p", apiKey: "k" };
    saveSettings(s);
    expect(loadSettings()).toEqual(s);
    clearSettings();
    expect(loadSettings()).toBeNull();
  });
  it("unvollständige oder kaputte Daten ergeben null statt Crash", () => {
    saveSettings({ owner: "o", repo: "r" }); // ohne pat/apiKey
    expect(loadSettings()).toBeNull();
    store.set("notizbuch:settings", "{kaputtes json");
    expect(loadSettings()).toBeNull();
  });
});
