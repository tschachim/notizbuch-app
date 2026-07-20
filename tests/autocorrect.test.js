// AutoKorrektur-Bibliothek (v7.25, src/lib/autocorrect.js) – reines
// Node-Umfeld reicht, die Bibliothek ist ein DOM-/TipTap-freies Blatt
// (siehe Kopfkommentar dort). Die eigentlichen Ketten-Konflikt-Tests
// ("-->", "a -- b", "---" beim echten Tippen) laufen headless gegen den
// TipTap-Editor in tests/docEditorAutocorrect.test.jsx – hier wird die
// REGEX-Konstruktion selbst geprüft (jede "kind" für sich, Grenzfälle,
// Sanitize/Validierung), siehe Auftrag Abschnitt D.
import { describe, it, expect } from "vitest";
import {
  AUTOCORRECT_CATEGORIES, buildActiveRules, isCategoryEnabled,
  sanitizeAutocorrectConfig, validateCustomTrigger, validateCustomReplacement,
} from "../src/lib/autocorrect.js";

const cat = (id) => AUTOCORRECT_CATEGORIES.find((c) => c.id === id);
const findRule = (rules, trigger) => rules.filter((r) => r.trigger === trigger);

describe("AUTOCORRECT_CATEGORIES: Bibliothek vollständig, Anzahl je Kategorie gepinnt", () => {
  it("acht Kategorien in der erwarteten Reihenfolge", () => {
    expect(AUTOCORRECT_CATEGORIES.map((c) => c.id)).toEqual([
      "pfeile", "typografie", "marken", "vergleiche", "brueche", "smileys", "symbole", "anfuehrung_de",
    ]);
  });

  it("pfeile: 9 Einträge, default an", () => {
    expect(cat("pfeile").entries).toHaveLength(9);
    expect(cat("pfeile").defaultEnabled).toBe(true);
  });

  it("typografie: 5 Einträge, default an", () => {
    expect(cat("typografie").entries).toHaveLength(5);
    expect(cat("typografie").defaultEnabled).toBe(true);
  });

  it("marken: 6 Einträge (inkl. (a)→@), default an", () => {
    expect(cat("marken").entries).toHaveLength(6);
    expect(cat("marken").entries.map((e) => e.trigger)).toContain("(a)");
  });

  it("vergleiche: 6 Einträge (inkl. Multiplikation), default an", () => {
    expect(cat("vergleiche").entries).toHaveLength(6);
    expect(cat("vergleiche").entries.some((e) => e.kind === "multiply")).toBe(true);
  });

  it("brueche: 15 Einträge, alle kind:'word', default an", () => {
    expect(cat("brueche").entries).toHaveLength(15);
    expect(cat("brueche").entries.every((e) => e.kind === "word")).toBe(true);
  });

  it("smileys: 5 Einträge, default an", () => {
    expect(cat("smileys").entries).toHaveLength(5);
  });

  it("symbole: 68 Einträge (24 griech. Kleinbuchstaben + 10 griech. Großbuchstaben + 34 Math-Kommandos), default an, alle kind:'backslash'", () => {
    expect(cat("symbole").entries).toHaveLength(68);
    expect(cat("symbole").entries.every((e) => e.kind === "backslash")).toBe(true);
    expect(cat("symbole").entries.every((e) => e.trigger.startsWith("\\"))).toBe(true);
    // Großbuchstaben NUR mit eigenem Unicode-Zeichen (Auftrag) – A/B/E/…
    // sehen wie lateinische Buchstaben aus und fehlen bewusst.
    const upperTriggers = cat("symbole").entries.map((e) => e.trigger).filter((t) => /^\\[A-Z]/.test(t));
    expect(upperTriggers.sort()).toEqual(
      ["\\Delta", "\\Gamma", "\\Lambda", "\\Leftrightarrow", "\\Omega", "\\Phi", "\\Pi", "\\Psi", "\\Rightarrow", "\\Sigma", "\\Theta", "\\Xi"].sort()
    );
  });

  it("anfuehrung_de: 2 Einträge, default AUS (riskant bei technischen Texten)", () => {
    expect(cat("anfuehrung_de").entries).toHaveLength(2);
    expect(cat("anfuehrung_de").defaultEnabled).toBe(false);
  });
});

describe("compileEntry (über buildActiveRules): jede Feuer-Art (kind) einzeln", () => {
  const rules = buildActiveRules({ enabled: true, categories: {}, custom: [] });

  it("'instant' (z. B. '->'): feuert exakt am Trigger-Ende, ohne Bedingung", () => {
    const [r] = findRule(rules, "->");
    expect(r.find.test("->")).toBe(true);
    expect(r.find.test("a->")).toBe(true);
    expect(r.find.test("-")).toBe(false);
  });

  it("'terminator' ('<-', Präfix von '<--'/'<->'): feuert NICHT ohne Abschlusszeichen, NICHT vor '-'/'>' (Fortsetzung), sonst ja", () => {
    const [r] = findRule(rules, "<-");
    expect(r.find.test("<-")).toBe(false); // noch kein Abschlusszeichen getippt
    expect(r.find.test("<--")).toBe(false); // Fortsetzung zu "<--"
    expect(r.find.test("<->")).toBe(false); // Fortsetzung zu "<->"
    expect(r.find.test("<- ")).toBe(true);
    expect(r.find.test("<-x")).toBe(true);
    const m = r.find.exec("<- ");
    expect(m[1]).toBe("<-"); // Capture-Gruppe = reiner Trigger, Terminator bleibt außerhalb
  });

  it("'terminator' ('<=', Präfix von '<=='/'<=>'): feuert NICHT vor '='/'>' , sonst ja", () => {
    const [r] = findRule(rules, "<=");
    expect(r.find.test("<=")).toBe(false);
    expect(r.find.test("<==")).toBe(false);
    expect(r.find.test("<=>")).toBe(false);
    expect(r.find.test("<= ")).toBe(true);
  });

  it("'terminator' ('--', Präfix von '---'/'-->'): feuert NICHT vor '-'/'>' , sonst ja (Kernfall des Auftrags)", () => {
    const [r] = findRule(rules, "--");
    expect(r.find.test("--")).toBe(false);
    expect(r.find.test("---")).toBe(false);
    expect(r.find.test("-->")).toBe(false);
    expect(r.find.test("-- ")).toBe(true);
    expect(r.find.test("a -- b".slice(0, 5))).toBe(true); // "a -- " endet auf Leerzeichen
  });

  it("'word' (Brüche, '1/2'): nur als eigenständiges Wort – Wortgrenze davor UND Ziffer-Terminator danach", () => {
    const [r] = findRule(rules, "1/2");
    expect(r.find.test("1/2")).toBe(false); // noch kein Abschlusszeichen
    expect(r.find.test("1/2 ")).toBe(true);
    expect(r.find.test(" 1/2 ")).toBe(true); // Wortanfang (Leerzeichen davor)
    expect(r.find.test("1/2.")).toBe(true); // Satzzeichen als Terminator ok
    expect(r.find.test("11/2 ")).toBe(false); // Ziffer direkt davor -> keine Wortgrenze
    expect(r.find.test("a1/2 ")).toBe(false); // Buchstabe direkt davor -> keine Wortgrenze
    expect(r.find.test("1/23")).toBe(false); // weitere Ziffer danach -> kein Terminator
  });

  it("Brüche: '13/24' feuert bei KEINER definierten Bruch-Regel (Auftrags-Testfall)", () => {
    const fractionRules = rules.filter((r) => cat("brueche").entries.some((e) => e.trigger === r.trigger));
    expect(fractionRules.some((r) => r.find.test("13/24"))).toBe(false);
    expect(fractionRules.some((r) => r.find.test("13/24 "))).toBe(false);
  });

  it("'backslash' (Symbole, '\\alpha'): feuert erst nach einem Nicht-Buchstaben, nicht mitten im Wort", () => {
    const [r] = findRule(rules, "\\alpha");
    expect(r.find.test("\\alpha")).toBe(false);
    expect(r.find.test("\\alpha ")).toBe(true);
    expect(r.find.test("\\alphax")).toBe(false); // Buchstabe als "Terminator" zählt nicht
    expect(r.find.test("\\alpha.")).toBe(true);
    expect(r.find.test("\\alpha3")).toBe(true); // Ziffer ist ein gültiger Terminator
  });

  it("'backslash': '\\in' ist Präfix von '\\int'/'\\infty' – feuert nicht, solange weitere Buchstaben folgen", () => {
    const [inRule] = findRule(rules, "\\in");
    expect(inRule.find.test("\\in")).toBe(false);
    expect(inRule.find.test("\\int")).toBe(false); // "t" ist Buchstabe -> keine Fortsetzung erlaubt
    expect(inRule.find.test("\\inf")).toBe(false); // "f" ist Buchstabe (Fortsetzung zu "infty")
    expect(inRule.find.test("\\in ")).toBe(true);
    const [intRule] = findRule(rules, "\\int");
    expect(intRule.find.test("\\int ")).toBe(true);
    const [inftyRule] = findRule(rules, "\\infty");
    expect(inftyRule.find.test("\\infty ")).toBe(true);
  });

  it("'multiply' ('Ziffer x Ziffer'): einstellig auf beiden Seiten, Leerraum optional, keine Fortsetzung einer mehrstelligen ersten Zahl", () => {
    const [r] = findRule(rules, "2x3");
    expect(r.kind).toBe("multiply");
    expect(r.find.test("2x3")).toBe(true);
    expect(r.find.test("2 x 3")).toBe(true);
    expect(r.find.test("12x3")).toBe(false); // "2" hier Teil von "12", keine Wortgrenze
    expect(r.find.test("ax3")).toBe(false); // kein Digit vor "x"
    const m = r.find.exec("2 x 3");
    expect([m[1], m[2], m[3], m[4]]).toEqual(["2", " ", " ", "3"]);
  });
});

describe("Anführungszeichen (anfuehrung_de, kontextabhängig öffnend/schließend)", () => {
  const rules = buildActiveRules({ enabled: true, categories: { anfuehrung_de: true }, custom: [] });
  const quoteRules = findRule(rules, '"');

  it("liefert genau zwei Regeln (öffnend + schließend) für das gerade Anführungszeichen", () => {
    expect(quoteRules).toHaveLength(2);
    expect(quoteRules.map((r) => r.replacement).sort()).toEqual(["„", "“"].sort());
  });

  it("öffnend feuert am Zeilenanfang, nach Leerzeichen oder nach einer öffnenden Klammer", () => {
    const open = quoteRules.find((r) => r.replacement === "„");
    expect(open.find.test('"')).toBe(true); // Zeilenanfang
    expect(open.find.test('Text "')).toBe(true);
    expect(open.find.test('("')).toBe(true);
    expect(open.find.test('Wort"')).toBe(false); // mitten im/nach einem Wort -> schließend
  });

  it("schließend feuert als Rückfall NACH einem Wortzeichen", () => {
    const close = quoteRules.find((r) => r.replacement === "“");
    expect(close.find.test('Wort"')).toBe(true);
  });

  it("ist per default AUS: buildActiveRules ohne explizites Einschalten liefert KEINE Anführungs-Regel", () => {
    const defaultRules = buildActiveRules({ enabled: true, categories: {}, custom: [] });
    expect(findRule(defaultRules, '"')).toHaveLength(0);
  });
});

describe("buildActiveRules: Master-Toggle, Kategorie-Toggles, custom-Merge/-Override, Sortierung", () => {
  it("enabled:false liefert eine leere Regel-Liste, unabhängig von Kategorien/custom", () => {
    const rules = buildActiveRules({
      enabled: false,
      categories: { pfeile: true },
      custom: [{ trigger: "btw", replacement: "übrigens" }],
    });
    expect(rules).toHaveLength(0);
  });

  it("ohne jede Angabe (null/undefined) gelten alle defaultEnabled-Kategorien (z. B. Pfeile enthalten, Anführung nicht)", () => {
    const rules = buildActiveRules(null);
    expect(findRule(rules, "->")).toHaveLength(1);
    expect(findRule(rules, '"')).toHaveLength(0);
  });

  it("eine explizit ausgeschaltete Kategorie liefert keinen ihrer Trigger mehr", () => {
    const rules = buildActiveRules({ enabled: true, categories: { smileys: false }, custom: [] });
    expect(findRule(rules, ":)")).toHaveLength(0);
    expect(findRule(rules, "->")).toHaveLength(1); // andere Kategorien unberührt
  });

  it("eine explizit eingeschaltete Kategorie (z. B. anfuehrung_de:true) ergänzt ihre Trigger", () => {
    const rules = buildActiveRules({ enabled: true, categories: { anfuehrung_de: true }, custom: [] });
    expect(findRule(rules, '"').length).toBeGreaterThan(0);
  });

  it("custom-Einträge werden ergänzt (neuer Trigger, kind:'instant')", () => {
    const rules = buildActiveRules({ enabled: true, categories: {}, custom: [{ trigger: "btw", replacement: "übrigens" }] });
    const [r] = findRule(rules, "btw");
    expect(r).toBeDefined();
    expect(r.replacement).toBe("übrigens");
    expect(r.kind).toBe("text");
    expect(r.find.test("btw")).toBe(true); // instant: feuert sofort
  });

  it("custom-Eintrag mit IDENTISCHEM Trigger wie ein eingebauter überschreibt diesen (Auftrags-Entscheidung: custom gewinnt)", () => {
    const rules = buildActiveRules({ enabled: true, categories: {}, custom: [{ trigger: "->", replacement: "GEHT ZU" }] });
    const matches = findRule(rules, "->");
    expect(matches).toHaveLength(1); // kein Duplikat, nur EINE Regel für diesen Trigger
    expect(matches[0].replacement).toBe("GEHT ZU");
    // custom läuft immer im simplen "instant"-Modus (feuert sofort, keine
    // Terminator-Bedingung), selbst wenn der überschriebene Trigger im
    // eingebauten Bestand terminator-basiert wäre.
    const overrideDash = buildActiveRules({ enabled: true, categories: {}, custom: [{ trigger: "--", replacement: "MINUS" }] });
    const [dash] = findRule(overrideDash, "--");
    expect(dash.replacement).toBe("MINUS");
    expect(dash.find.test("--")).toBe(true); // instant statt terminator-gated
  });

  it("Trigger-Länge absteigend sortiert: längere/spezifischere Regeln stehen vor kürzeren Suffix-Kollisionen", () => {
    const rules = buildActiveRules(null);
    const idxLong = rules.findIndex((r) => r.trigger === "-->");
    const idxShort = rules.findIndex((r) => r.trigger === "->");
    expect(idxLong).toBeGreaterThanOrEqual(0);
    expect(idxShort).toBeGreaterThan(idxLong);
    const idxTripleEq = rules.findIndex((r) => r.trigger === "==>");
    const idxDoubleEq = rules.findIndex((r) => r.trigger === "=>");
    expect(idxTripleEq).toBeLessThan(idxDoubleEq);
  });
});

describe("isCategoryEnabled", () => {
  it("liefert defaultEnabled, wenn die Kategorie in der Konfiguration nicht erwähnt ist", () => {
    expect(isCategoryEnabled({ enabled: true, categories: {}, custom: [] }, "pfeile")).toBe(true);
    expect(isCategoryEnabled({ enabled: true, categories: {}, custom: [] }, "anfuehrung_de")).toBe(false);
  });

  it("eine explizite Übersteuerung gewinnt gegen defaultEnabled", () => {
    expect(isCategoryEnabled({ enabled: true, categories: { pfeile: false }, custom: [] }, "pfeile")).toBe(false);
    expect(isCategoryEnabled({ enabled: true, categories: { anfuehrung_de: true }, custom: [] }, "anfuehrung_de")).toBe(true);
  });

  it("liefert false für eine unbekannte Kategorie-Id", () => {
    expect(isCategoryEnabled({ enabled: true, categories: {}, custom: [] }, "nichtvorhanden")).toBe(false);
  });
});

describe("sanitizeAutocorrectConfig: defensiv gegen jeden Fremd-/Alt-Zustand", () => {
  it("null/undefined/kein Objekt liefert die Defaults (enabled:true, leere categories/custom)", () => {
    expect(sanitizeAutocorrectConfig(null)).toEqual({ enabled: true, categories: {}, custom: [] });
    expect(sanitizeAutocorrectConfig(undefined)).toEqual({ enabled: true, categories: {}, custom: [] });
    expect(sanitizeAutocorrectConfig("kaputt")).toEqual({ enabled: true, categories: {}, custom: [] });
    expect(sanitizeAutocorrectConfig(42)).toEqual({ enabled: true, categories: {}, custom: [] });
  });

  it("übernimmt enabled:false, verwirft einen Nicht-Boolean auf enabled (Default true)", () => {
    expect(sanitizeAutocorrectConfig({ enabled: false }).enabled).toBe(false);
    expect(sanitizeAutocorrectConfig({ enabled: "false" }).enabled).toBe(true);
  });

  it("übernimmt nur BEKANNTE Kategorie-Ids mit Boolean-Wert, ignoriert Rest", () => {
    const cfg = sanitizeAutocorrectConfig({
      categories: { pfeile: false, anfuehrung_de: true, unbekannt: true, marken: "ja" },
    });
    expect(cfg.categories).toEqual({ pfeile: false, anfuehrung_de: true });
  });

  it("filtert kaputte custom-Einträge (fehlende Felder, falscher Typ, zu kurz/zu lang, reines Leerzeichen)", () => {
    const cfg = sanitizeAutocorrectConfig({
      custom: [
        { trigger: "ok", replacement: "gut" }, // gültig
        { trigger: "a", replacement: "zu kurzer Trigger" }, // Trigger < 2
        { trigger: "x".repeat(21), replacement: "zu lang" }, // Trigger > 20
        { trigger: "gut", replacement: "" }, // Ersetzung leer
        { trigger: "gut2", replacement: "x".repeat(21) }, // Ersetzung > 20
        { trigger: "   ", replacement: "leer" }, // reines Leerzeichen
        { trigger: 5, replacement: "typ" }, // falscher Typ
        null,
        "kaputt",
        { trigger: "  pad  ", replacement: "  raum  " }, // wird getrimmt übernommen
      ],
    });
    expect(cfg.custom).toEqual([
      { trigger: "ok", replacement: "gut" },
      { trigger: "pad", replacement: "raum" },
    ]);
  });

  it("ist idempotent (zweifaches Sanitisieren liefert dasselbe Ergebnis)", () => {
    const raw = { enabled: false, categories: { pfeile: false }, custom: [{ trigger: "btw", replacement: "übrigens" }] };
    const once = sanitizeAutocorrectConfig(raw);
    const twice = sanitizeAutocorrectConfig(once);
    expect(twice).toEqual(once);
  });
});

describe("validateCustomTrigger / validateCustomReplacement (Formular-Vorprüfung)", () => {
  it("Trigger: 2–20 Zeichen (nach Trimmen) sind gültig, außerhalb liefert einen Fehlertext", () => {
    expect(validateCustomTrigger("ok")).toEqual({ value: "ok" });
    expect(validateCustomTrigger("x".repeat(20))).toEqual({ value: "x".repeat(20) });
    expect(validateCustomTrigger("a").error).toMatch(/2–20/);
    expect(validateCustomTrigger("x".repeat(21)).error).toBeDefined();
    expect(validateCustomTrigger("  ").error).toBeDefined(); // reines Leerzeichen -> nach Trimmen leer
    expect(validateCustomTrigger("  ab  ")).toEqual({ value: "ab" }); // wird getrimmt
    expect(validateCustomTrigger(undefined).error).toBeDefined(); // wirft nie, liefert Fehlertext
    expect(validateCustomTrigger(null).error).toBeDefined();
  });

  it("Ersetzung: 1–20 Zeichen (nach Trimmen) sind gültig, außerhalb liefert einen Fehlertext", () => {
    expect(validateCustomReplacement("x")).toEqual({ value: "x" });
    expect(validateCustomReplacement("x".repeat(20))).toEqual({ value: "x".repeat(20) });
    expect(validateCustomReplacement("").error).toBeDefined();
    expect(validateCustomReplacement("x".repeat(21)).error).toBeDefined();
    expect(validateCustomReplacement(undefined).error).toBeDefined();
    expect(validateCustomReplacement(null).error).toBeDefined();
  });
});
