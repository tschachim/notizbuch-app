import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { diffLines, contextize } from "../src/lib/diff.js";
import { extForMime, mimeForName, dataUrlParts, newImgId } from "../src/lib/images.js";
import {
  safeFileName, extractPathFor, isExtractPath, knowledgeDir, extractText,
  splitPages, lookupInExtract,
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

describe("lookupInExtract (Abruf aus großen Wissensdateien)", () => {
  const EXTRACT = [
    "## Seite 1\n\nEinleitung und Inhaltsverzeichnis",
    "## Seite 2\n\nGrundlagen der Konfiguration",
    "## Seite 3\n\nKeyMapping: IsAllowedForReceiver steuert den Empfang",
    "## Seite 4\n\nWeitere Details zum KeyMapping-Schritt",
    "## Seite 5\n\nAnhang und Glossar",
  ].join("\n\n");

  it("splitPages erkennt Seiten-Blöcke des PDF-Extrakts mit Nummern", () => {
    const pages = splitPages(EXTRACT);
    expect(pages.map((p) => p.page)).toEqual([1, 2, 3, 4, 5]);
    expect(pages[2].text).toContain("IsAllowedForReceiver");
  });

  it("splitPages zerlegt Extrakte ohne Seitenmarker in Kunst-Abschnitte", () => {
    const pages = splitPages("x".repeat(9000));
    expect(pages.length).toBe(3);
    expect(pages[0].text).toContain("## Abschnitt 1");
  });

  it("Stichwortsuche liefert Treffer-Seiten mit ±1 Seite Kontext in Dokumentreihenfolge", () => {
    const res = lookupInExtract(EXTRACT, { suchbegriffe: "keymapping" });
    expect(res).toContain("## Seite 2"); // Kontext davor
    expect(res).toContain("## Seite 3"); // Treffer
    expect(res).toContain("## Seite 4"); // Treffer
    expect(res).toContain("## Seite 5"); // Kontext danach
    expect(res).not.toContain("## Seite 1");
    expect(res.indexOf("Seite 2")).toBeLessThan(res.indexOf("Seite 5"));
  });

  it("Seitenbereich und Einzelseite werden direkt geliefert (auch mit Gedankenstrich)", () => {
    expect(lookupInExtract(EXTRACT, { seiten: "2-3" })).toContain("Grundlagen");
    expect(lookupInExtract(EXTRACT, { seiten: "2-3" })).not.toContain("Anhang");
    expect(lookupInExtract(EXTRACT, { seiten: "5" })).toContain("Glossar");
    // Modelle schreiben gern den typografischen Gedankenstrich
    expect(lookupInExtract(EXTRACT, { seiten: "2–3" })).toContain("Grundlagen");
  });

  it("splitPages: genau EIN Seitenmarker fällt bewusst auf Kunst-Abschnitte zurück", () => {
    // Ein einzelner Block bietet keine sinnvolle Seiten-Navigation – der
    // 4k-Fallback hält Suche und Deckel trotzdem funktionsfähig.
    const pages = splitPages("## Seite 1\n\n" + "x".repeat(5000));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0].text).toContain("## Abschnitt 1");
  });

  it("ohne Treffer oder mit nur Mini-Begriffen kommt null (Modell soll umformulieren)", () => {
    expect(lookupInExtract(EXTRACT, { suchbegriffe: "quantenkryptografie" })).toBeNull();
    expect(lookupInExtract(EXTRACT, { suchbegriffe: "im an zu" })).toBeNull();
    expect(lookupInExtract(EXTRACT, {})).toBeNull();
  });

  it("deckelt das Ergebnis und weist auf den Schnitt hin", () => {
    const big = Array.from({ length: 30 }, (_, i) =>
      "## Seite " + (i + 1) + "\n\nZielbegriff " + "Füllung ".repeat(400)).join("\n\n");
    const res = lookupInExtract(big, { suchbegriffe: "zielbegriff" }, 10000);
    expect(res.length).toBeLessThan(12000);
    expect(res).toContain("abgeschnitten");
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
    // v7.9: loadSettings ergänzt fehlendes linkProviders defensiv zu []
    // (siehe sanitizeLinkProviders, lib/linkProviders.jsx) – bestehende,
    // vor v7.9 gespeicherte Settings-Objekte haben dieses Feld noch nicht.
    expect(loadSettings()).toEqual({ ...s, linkProviders: [] });
    clearSettings();
    expect(loadSettings()).toBeNull();
  });
  it("unvollständige oder kaputte Daten ergeben null statt Crash", () => {
    saveSettings({ owner: "o", repo: "r" }); // ohne pat/apiKey
    expect(loadSettings()).toBeNull();
    store.set("notizbuch:settings", "{kaputtes json");
    expect(loadSettings()).toBeNull();
  });

  // v7.9 (Link-Provider): loadSettings reicht ein GÜLTIGES linkProviders-
  // Array unverändert (normalisiert) durch und filtert kaputte Einträge
  // defensiv heraus, statt an einem manuell editierten/älteren
  // localStorage-Objekt zu crashen.
  it("gültiges linkProviders-Array bleibt (normalisiert) erhalten", () => {
    const s = {
      owner: "o", repo: "r", pat: "p", apiKey: "k",
      linkProviders: [
        { id: "lp1", type: "azure-devops", name: "DevOps", prefix: "https://dev.azure.com/", pat: "test-pat" },
      ],
    };
    saveSettings(s);
    const loaded = loadSettings();
    expect(loaded.linkProviders).toEqual([
      { id: "lp1", type: "azure-devops", name: "DevOps", prefix: "https://dev.azure.com/", icon: "", pat: "test-pat", email: "" },
    ]);
  });

  it("kaputte linkProviders-Einträge werden gefiltert, gültige bleiben", () => {
    const s = {
      owner: "o", repo: "r", pat: "p", apiKey: "k",
      linkProviders: [
        { id: "ok", type: "custom", name: "Intranet", prefix: "https://intranet.example/", icon: "🏠" },
        { id: "kaputt-typ", type: "unbekannt", name: "X", prefix: "https://x.example/" }, // unbekannter Typ
        { id: "kaputt-prefix", type: "custom", name: "Y", prefix: "ftp://y.example/" }, // kein http(s)
        { name: "ohne-id", type: "custom", prefix: "https://z.example/" }, // fehlende id
        null,
        "kaputt",
      ],
    };
    saveSettings(s);
    const loaded = loadSettings();
    expect(loaded.linkProviders).toEqual([
      { id: "ok", type: "custom", name: "Intranet", prefix: "https://intranet.example/", icon: "🏠", pat: "", email: "" },
    ]);
  });

  it("fehlendes/kaputtes linkProviders-Feld ergibt ein leeres Array (kein Crash)", () => {
    saveSettings({ owner: "o", repo: "r", pat: "p", apiKey: "k", linkProviders: "kaputt" });
    expect(loadSettings().linkProviders).toEqual([]);
  });
});
