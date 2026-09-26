// @vitest-environment jsdom
//
// v7.57 (DECISIONS #117, Nutzerwunsch A'/A''): iOS Safari zoomt beim
// Fokussieren eines Eingabefelds mit einer Schriftgröße unter 16px
// automatisch in die Seite hinein – das Chat-Eingabefeld ist seit v7.57
// bewusst text-sm (14px), die Einstellungsfelder waren es bereits vorher;
// der Schutz läuft deshalb jetzt über maximum-scale=1 im viewport-Meta-Tag
// statt über eine erzwungene Mindestschriftgröße. isIOSLike()/
// withMaximumScale() sind reine
// Funktionen, applyIOSInputZoomGuard() der einzige DOM-berührende Helfer
// (nimmt doc/nav als Parameter statt globaler document/navigator-Zugriffe –
// dadurch ohne echten Browser testbar).
import { describe, it, expect } from "vitest";
import { isIOSLike, withMaximumScale, applyIOSInputZoomGuard } from "../src/lib/viewport.js";

describe("isIOSLike (v7.57, DECISIONS #117)", () => {
  it("iPhone Safari: true", () => {
    expect(isIOSLike({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
      platform: "iPhone",
      maxTouchPoints: 5,
    })).toBe(true);
  });

  it("iPad, klassischer (alter) UA mit 'iPad' im String: true", () => {
    expect(isIOSLike({
      userAgent: "Mozilla/5.0 (iPad; CPU OS 13_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0 Mobile/15E148 Safari/604.1",
      platform: "iPad",
      maxTouchPoints: 5,
    })).toBe(true);
  });

  it("iPadOS im Desktop-Modus (macOS-artiger UA, aber platform MacIntel + maxTouchPoints > 1): true", () => {
    expect(isIOSLike({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
      platform: "MacIntel",
      maxTouchPoints: 5,
    })).toBe(true);
  });

  it("echtes macOS Safari (MacIntel, KEINE Touchpoints): false", () => {
    expect(isIOSLike({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
      platform: "MacIntel",
      maxTouchPoints: 0,
    })).toBe(false);
  });

  it("MacIntel mit genau 1 Touchpoint (Grenzfall, > 1 verlangt): false", () => {
    expect(isIOSLike({ userAgent: "irrelevant", platform: "MacIntel", maxTouchPoints: 1 })).toBe(false);
  });

  it("Android Chrome: false (weder iPhone/iPad/iPod im UA noch MacIntel)", () => {
    expect(isIOSLike({
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
      platform: "Linux armv81",
      maxTouchPoints: 5,
    })).toBe(false);
  });

  it("Windows Chrome (Desktop, kein Touch): false", () => {
    expect(isIOSLike({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      platform: "Win32",
      maxTouchPoints: 0,
    })).toBe(false);
  });

  it("leeres Objekt / fehlende Felder: false, kein Fehler", () => {
    expect(isIOSLike({})).toBe(false);
    expect(() => isIOSLike({})).not.toThrow();
  });

  it("kein Argument (undefined): false, kein Fehler", () => {
    expect(isIOSLike()).toBe(false);
    expect(() => isIOSLike(undefined)).not.toThrow();
  });

  // Review-Fix (Runde 5, blau/optional): "= {}" als Default-Parameter greift
  // NUR bei undefined - ein expliziter null-Aufruf hätte vorher trotzdem
  // geworfen ("nav || {}" statt Destrukturierungs-Default, siehe viewport.js).
  it("explizites null statt eines Objekts: false, kein Fehler (Destrukturierungs-Default '= {}' greift NUR bei undefined)", () => {
    expect(() => isIOSLike(null)).not.toThrow();
    expect(isIOSLike(null)).toBe(false);
  });

  it("Nicht-String-Werte (Zahlen/Objekte statt userAgent/platform): robust, liefert false", () => {
    expect(isIOSLike({ userAgent: 42, platform: {}, maxTouchPoints: "5" })).toBe(false);
  });

  it("maxTouchPoints als NaN: wird wie 0 behandelt (kein Crash, kein falsches true)", () => {
    expect(isIOSLike({ platform: "MacIntel", maxTouchPoints: NaN })).toBe(false);
  });
});

describe("withMaximumScale (v7.57, DECISIONS #117)", () => {
  it("ergänzt maximum-scale=1, wenn es fehlt, und erhält die Reihenfolge der übrigen Einträge", () => {
    const out = withMaximumScale("width=device-width, initial-scale=1.0, viewport-fit=cover");
    expect(out).toBe("width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1");
  });

  it("ersetzt ein vorhandenes maximum-scale=5 durch maximum-scale=1, an derselben Position", () => {
    const out = withMaximumScale("width=device-width, maximum-scale=5, initial-scale=1.0");
    expect(out).toBe("width=device-width, maximum-scale=1, initial-scale=1.0");
  });

  it("ist idempotent: ein zweiter Aufruf ändert nichts mehr", () => {
    const once = withMaximumScale("width=device-width, initial-scale=1.0");
    const twice = withMaximumScale(once);
    expect(twice).toBe(once);
  });

  it("Leerzeichen-Varianten (unregelmäßige Abstände um Kommas/Gleichheitszeichen) werden normalisiert verarbeitet", () => {
    const out = withMaximumScale("  width=device-width ,initial-scale=1.0  ,   maximum-scale=2  ");
    expect(out).toBe("width=device-width, initial-scale=1.0, maximum-scale=1");
  });

  it("leerer String: liefert nur maximum-scale=1", () => {
    expect(withMaximumScale("")).toBe("maximum-scale=1");
  });

  it("Nicht-String-Eingabe (null/undefined/Zahl): wie leerer String behandelt, kein Crash", () => {
    expect(withMaximumScale(null)).toBe("maximum-scale=1");
    expect(withMaximumScale(undefined)).toBe("maximum-scale=1");
    expect(withMaximumScale(42)).toBe("maximum-scale=1");
  });

  it("setzt NIEMALS user-scalable=no – ein vorhandener Eintrag bleibt unangetastet stehen", () => {
    const out = withMaximumScale("width=device-width, user-scalable=yes");
    expect(out).not.toContain("user-scalable=no");
    expect(out).toContain("user-scalable=yes");
    expect(out).toContain("maximum-scale=1");
  });

  // Review-Fix (Runde "Nachbesserung", blau/optional): bisher nur Leerzeichen
  // um KOMMAS getestet (Zeile "Leerzeichen-Varianten" oben) – Leerzeichen um
  // das Gleichheitszeichen selbst UND Groß-/Kleinschreibung des Schlüssels
  // waren ungetestet, obwohl viewport.js explizit trim()/toLowerCase() dafür
  // einsetzt (eine Regression, z. B. ein entferntes toLowerCase(), bliebe
  // sonst unbemerkt und würde ein zweites, konkurrierendes maximum-scale
  // anhängen statt das vorhandene zu ersetzen).
  it("Leerzeichen um das Gleichheitszeichen UND Großschreibung des Schlüssels werden normalisiert erkannt und ersetzt", () => {
    expect(withMaximumScale("width=device-width, maximum-scale = 2")).toBe("width=device-width, maximum-scale=1");
    expect(withMaximumScale("width=device-width, Maximum-Scale=2")).toBe("width=device-width, maximum-scale=1");
    expect(withMaximumScale("width=device-width, Maximum-Scale = 2")).toBe("width=device-width, maximum-scale=1");
  });
});

describe("applyIOSInputZoomGuard (v7.57, DECISIONS #117)", () => {
  const makeMetaDoc = (content) => {
    const meta = {
      _content: content,
      getAttribute(name) { return name === "content" ? this._content : null; },
      setAttribute(name, value) { if (name === "content") this._content = value; },
    };
    const doc = { querySelector: (sel) => (sel === 'meta[name="viewport"]' ? meta : null) };
    return { doc, meta };
  };

  const iosNav = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)", platform: "iPhone", maxTouchPoints: 5 };
  const desktopNav = { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", platform: "Win32", maxTouchPoints: 0 };

  it("iOS mit vorhandenem meta[name=viewport]: content wird ersetzt, Rückgabewert true", () => {
    const { doc, meta } = makeMetaDoc("width=device-width, initial-scale=1.0, viewport-fit=cover");
    const result = applyIOSInputZoomGuard(doc, iosNav);
    expect(result).toBe(true);
    expect(meta._content).toBe("width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1");
  });

  it("nicht-iOS (Windows Chrome): meta bleibt unangetastet, Rückgabewert false", () => {
    const { doc, meta } = makeMetaDoc("width=device-width, initial-scale=1.0, viewport-fit=cover");
    const result = applyIOSInputZoomGuard(doc, desktopNav);
    expect(result).toBe(false);
    expect(meta._content).toBe("width=device-width, initial-scale=1.0, viewport-fit=cover");
  });

  it("iOS OHNE meta[name=viewport] im Dokument: No-op, Rückgabewert false, wirft nicht", () => {
    const doc = { querySelector: () => null };
    expect(() => applyIOSInputZoomGuard(doc, iosNav)).not.toThrow();
    expect(applyIOSInputZoomGuard(doc, iosNav)).toBe(false);
  });

  it("kaputtes doc (querySelector wirft): wirft NIE, liefert false", () => {
    const brokenDoc = { querySelector: () => { throw new Error("boom"); } };
    expect(() => applyIOSInputZoomGuard(brokenDoc, iosNav)).not.toThrow();
    expect(applyIOSInputZoomGuard(brokenDoc, iosNav)).toBe(false);
  });

  it("Default-Parameter (echtes jsdom-document/navigator dieser Testumgebung): wirft nicht", () => {
    // jsdom liefert hier einen Desktop-UA ohne Touch – Ergebnis ist also
    // false, aber die eigentliche Aussage dieses Tests ist: kein Fehler
    // beim Zugriff auf die globalen document/navigator-Objekte.
    expect(() => applyIOSInputZoomGuard()).not.toThrow();
  });

  it("nav ist explizit null: wirft nicht, liefert false (kein Crash in isIOSLike)", () => {
    const { doc } = makeMetaDoc("width=device-width");
    expect(() => applyIOSInputZoomGuard(doc, null)).not.toThrow();
    expect(applyIOSInputZoomGuard(doc, null)).toBe(false);
  });

  // Review-Fix (Runde 5, blau/optional): die bisherigen Tests arbeiteten
  // ausschließlich mit einem handgebauten Mock-meta-Objekt, obwohl die Datei
  // unter jsdom läuft – ob der Selektor auf einem ECHTEN
  // meta[name="viewport"]-Element in document.head greift und
  // getAttribute/setAttribute dort funktionieren, war ungetestet.
  it("echtes jsdom-DOM: ein echtes meta[name=viewport]-Element in document.head wird ersetzt", () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "viewport");
    meta.setAttribute("content", "width=device-width, initial-scale=1.0, viewport-fit=cover");
    document.head.appendChild(meta);
    try {
      const result = applyIOSInputZoomGuard(document, iosNav);
      expect(result).toBe(true);
      expect(document.querySelector('meta[name="viewport"]').getAttribute("content")).toBe(
        "width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1"
      );
    } finally {
      meta.remove();
    }
  });

  // Review-Fix (Runde "Nachbesserung", blau/optional): der Guard wurde bisher
  // nur mit dem iPhone-UA durchlaufen – der zweite von isIOSLike() erkannte
  // Fall (iPadOS im Desktop-Modus: platform "MacIntel" MIT maxTouchPoints > 1)
  // erreichte applyIOSInputZoomGuard() in keinem Test, obwohl genau dieser
  // Fall in main.jsx/App.jsx praktisch relevant ist (iPad-Nutzer mit
  // "Desktop-Website anfordern").
  it("iPadOS im Desktop-Modus (MacIntel, maxTouchPoints > 1): content wird ebenfalls ersetzt, Rückgabewert true", () => {
    const { doc, meta } = makeMetaDoc("width=device-width, initial-scale=1.0");
    const ipadDesktopNav = {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
      platform: "MacIntel",
      maxTouchPoints: 5,
    };
    const result = applyIOSInputZoomGuard(doc, ipadDesktopNav);
    expect(result).toBe(true);
    expect(meta._content).toBe("width=device-width, initial-scale=1.0, maximum-scale=1");
  });
});
