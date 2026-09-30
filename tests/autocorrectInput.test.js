// v7.58: AutoKorrektur im Schnellnotiz-<textarea> – reine Logik in
// src/lib/autocorrectInput.js (Klassifikation des Input-Events, Matching
// mit denselben Regeln wie der Dokument-Editor, Rücknahme). Der Editor-Teil
// (TipTap-InputRules) ist in tests/docEditorAutocorrect.test.jsx gepinnt;
// HIER geht es darum, dass das textarea-Pendant dieselben Ergebnisse liefert
// (Paritäts-Korpus, Zeichen für Zeichen getippt) und wo es bewusst
// abweicht (Zeile statt Absatz, Enter als Abschlusszeichen, Text hinter dem
// Cursor, Fensterbegrenzung).
import { describe, it, expect } from "vitest";
import { buildActiveRules } from "../src/lib/autocorrect.js";
import {
  AUTOCORRECT_LOOKBACK,
  typedTextFromInputEvent,
  autocorrectTypedText,
  revertAutocorrect,
  isAutocorrectTriggerRange,
} from "../src/lib/autocorrectInput.js";

const RULES = buildActiveRules(null); // Defaults: alle defaultEnabled-Kategorien
const QUOTE_CFG = { enabled: true, categories: { anfuehrung_de: true }, custom: [] };

// Tippt `str` Codepoint für Codepoint an den Cursor (Standard: ans Ende des
// leeren Felds) und wendet nach jedem Zeichen die AutoKorrektur an – exakt
// die Reihenfolge im Browser: Zeichen kommt ins Feld, DANN prüft handleChange.
// Liefert den Endzustand plus alle Ersetzungs-Schritte samt Rohzustand.
function typeAll(rules, str, start = { text: "", caret: 0 }) {
  let { text, caret } = start;
  const steps = [];
  for (const ch of str) {
    const rawText = text.slice(0, caret) + ch + text.slice(caret);
    const rawCaret = caret + ch.length;
    const r = autocorrectTypedText(rawText, rawCaret, ch, rules);
    if (r) {
      steps.push({ rawText, rawCaret, r });
      text = r.text;
      caret = r.caret;
    } else {
      text = rawText;
      caret = rawCaret;
    }
  }
  return { text, caret, steps };
}
const typed = (str, cfg = null) => typeAll(buildActiveRules(cfg), str).text;

describe("typedTextFromInputEvent: nur ECHTES Tippen (Positivliste, fail closed)", () => {
  it.each([
    ["insertText", ">", false, ">"],
    ["insertText", "a", undefined, "a"], // isComposing fehlt: nur "=== true" sperrt
    ["insertText", " ", false, " "],
    ["insertText", "\n", false, "\n"], // 1 Codepoint, auch wenn ein Browser Enter so meldet
    ["insertText", "😀", false, "😀"], // Surrogatpaar = ein Codepoint (Emoji-Tastatur)
    ["insertLineBreak", null, false, "\n"], // Enter/Umschalt+Enter, data ist dort null
    ["insertParagraph", null, false, "\n"],
  ])("%s / %j / composing=%j -> %j", (inputType, data, isComposing, expected) => {
    expect(typedTextFromInputEvent(inputType, data, isComposing)).toBe(expected);
  });

  it.each([
    ["insertText", "->", false], // Mehrzeichen-Einfügung (Diktat, Wortvorschlag, Automations-"type")
    ["insertText", "❤️", false], // zwei Codepoints (U+2764 U+FE0F)
    ["insertText", "", false],
    ["insertText", null, false],
    ["insertText", undefined, false],
    ["insertText", 5, false], // kein String
    ["insertText", ">", true], // Komposition (Android-Buchstaben, IME)
    ["insertLineBreak", null, true],
    ["insertFromPaste", ">", false],
    ["insertFromDrop", ">", false],
    ["insertFromYank", ">", false],
    ["insertReplacementText", ">", false], // Rechtschreib-/Bildschirmtastatur-Ersetzung
    ["insertCompositionText", ">", false],
    ["insertFromComposition", ">", false], // Safari nach einer Komposition
    ["deleteContentBackward", null, false],
    ["deleteContentForward", null, false],
    ["historyUndo", null, false],
    ["historyRedo", null, false],
    [undefined, ">", false], // new Event("input") ohne inputType
    ["", ">", false],
    [null, ">", false],
  ])("%s / %j / composing=%j -> null", (inputType, data, isComposing) => {
    expect(typedTextFromInputEvent(inputType, data, isComposing)).toBeNull();
  });
});

describe("autocorrectTypedText: Paritäts-Korpus (dieselben Eingaben und Erwartungen wie tests/docEditorAutocorrect.test.jsx)", () => {
  it.each([
    // repräsentative Ersetzungen je Kategorie
    ["Pfeil: -> Ziel", "Pfeil: → Ziel"],
    ["Gedanke -- weiter", "Gedanke – weiter"],
    ["---", "—"],
    ["Bald...", "Bald…"],
    ["Copyright (c) 2026", "Copyright © 2026"],
    ["(a) erstens", "@ erstens"],
    ["a != b", "a ≠ b"],
    ["a <= b", "a ≤ b"],
    ["Feld 2x3 cm", "Feld 2×3 cm"],
    ["Nummer 12x3", "Nummer 12x3"], // mitten in einer Zahl: bleibt
    ["nimm 1/2 Becher", "nimm ½ Becher"],
    ["Ordner 13/24 bleibt", "Ordner 13/24 bleibt"], // Bruch nur als eigenständiges Wort
    ["Hi :)", "Hi 😊"],
    ["Winkel \\alpha.", "Winkel α."],
    ["Summe \\sum wert", "Summe ∑ wert"],
    // Ketten-Konflikte: kein kurzer Trigger darf einen längeren blockieren
    ["Pfeil --> Ziel", "Pfeil ⟶ Ziel"],
    ["a -- b", "a – b"],
    ["Trennlinie --- Ende", "Trennlinie — Ende"],
    ["Rueckpfeil <-- Start", "Rueckpfeil ⟵ Start"],
    ["a <-> b", "a ↔ b"],
    ["a <== b", "a ⇐ b"],
    ["a <=> b", "a ⇔ b"],
    ["a ==> b", "a ⇒ b"],
    ["Zitat: << Text", "Zitat: « Text"],
    // Roundtrip-Satz aus dem Editor-Test
    ["Pfeil -> Ende, Gedanke -- weiter, Serie..., (c) 2026, +- Toleranz, a <= b.", "Pfeil → Ende, Gedanke – weiter, Serie…, © 2026, ± Toleranz, a ≤ b."],
    // Anführungszeichen default AUS
    ['Er sagte "Hallo".', 'Er sagte "Hallo".'],
  ])("%j -> %j", (input, expected) => {
    expect(typed(input)).toBe(expected);
  });

  it("Anführungszeichen eingeschaltet: kontextabhängig öffnend/schließend", () => {
    expect(typed('Er sagte "Hallo".', QUOTE_CFG)).toBe("Er sagte „Hallo“.");
  });

  it("Master-Toggle aus: gar keine Ersetzung", () => {
    expect(typed("Pfeil -> Ende (c)", { enabled: false, categories: {}, custom: [] })).toBe("Pfeil -> Ende (c)");
  });

  it("eine ausgeschaltete Kategorie feuert nicht mehr, andere bleiben unberührt", () => {
    expect(typed("Pfeil -> Ende (c)", { enabled: true, categories: { pfeile: false }, custom: [] })).toBe("Pfeil -> Ende ©");
  });

  it("eine eigene Ersetzung (custom) wirkt wie ein eingebauter Trigger", () => {
    const cfg = { enabled: true, categories: {}, custom: [{ trigger: "btw", replacement: "übrigens" }] };
    expect(typed("Das ist btw wichtig.", cfg)).toBe("Das ist übrigens wichtig.");
  });

  it("custom überschreibt einen eingebauten Trigger mit identischem Text", () => {
    const cfg = { enabled: true, categories: {}, custom: [{ trigger: "->", replacement: "⇢" }] };
    expect(typed("a -> b", cfg)).toBe("a ⇢ b");
    // die längere Kette bleibt davon unberührt
    expect(typed("a --> b", cfg)).toBe("a ⟶ b");
  });

  it("custom mit identischem Trigger UND Ersatz schaltet einen einzelnen Trigger ab (kein Treffer, kein Absturz)", () => {
    const cfg = { enabled: true, categories: {}, custom: [{ trigger: "(a)", replacement: "(a)" }] };
    expect(typed("(a) erstens", cfg)).toBe("(a) erstens");
    expect(typed("(c)", cfg)).toBe("©"); // andere Trigger unberührt
  });
});

describe("autocorrectTypedText: textarea-spezifisch (Zeilen, Enter, Cursor mitten im Text, Fenster)", () => {
  it("Enter zählt als Abschlusszeichen: 'a --' + Enter -> 'a –⏎', Cursor in der neuen Zeile", () => {
    const r = autocorrectTypedText("a --\n", 5, "\n", RULES);
    expect(r).toEqual({ from: 2, to: 5, insert: "–\n", raw: "--\n", text: "a –\n", caret: 4 });
  });

  it("Enter nach Backslash-Kommando und Bruch: '\\alpha' -> 'α⏎', '1/2' -> '½⏎'", () => {
    expect(autocorrectTypedText("\\alpha\n", 7, "\n", RULES).text).toBe("α\n");
    expect(autocorrectTypedText("x 1/2\n", 6, "\n", RULES).text).toBe("x ½\n");
  });

  it("Enter nach einem instant-Trigger feuert NICHT ('$' matcht nicht vor dem Umbruch) und nach 'a1/2' greift die Wortgrenze", () => {
    expect(autocorrectTypedText("->\n", 3, "\n", RULES)).toBeNull();
    expect(autocorrectTypedText("a1/2\n", 5, "\n", RULES)).toBeNull();
  });

  it("Trigger greifen nie über eine Zeilengrenze: '-⏎>' und '2⏎x3' und '2x⏎3' bleiben roh", () => {
    expect(typeAll(RULES, "-\n>").text).toBe("-\n>");
    expect(typeAll(RULES, "2\nx3").text).toBe("2\nx3");
    expect(typeAll(RULES, "2x\n3").text).toBe("2x\n3");
  });

  it("die Zeilengrenze ist zugleich Wortgrenze: Bruch am Anfang von Zeile 2 feuert, Anführungszeichen öffnet", () => {
    expect(typeAll(RULES, "x\n1/2 ").text).toBe("x\n½ ");
    expect(typeAll(buildActiveRules(QUOTE_CFG), 'x\n"a"').text).toBe("x\n„a“");
    // ... aber ein Bruch hinter einer Ziffer derselben Zeile nicht
    expect(typeAll(RULES, "x1\n/2 ").text).toBe("x1\n/2 ");
  });

  it("Einfügen mitten im Text: der Rest bleibt, der Cursor steht hinter dem Ersatz (NICHT am Textende)", () => {
    // Feld "x- y", Cursor zwischen "-" und " ", ">" getippt
    const r = autocorrectTypedText("x-> y", 3, ">", RULES);
    expect(r).toMatchObject({ from: 1, to: 3, insert: "→", raw: "->", text: "x→ y", caret: 2 });
    expect(r.caret).toBeLessThan(r.text.length);
  });

  it("terminator mitten im Text: '<=' + 'y' vor 'rest' -> '≤y' (Abschlusszeichen bleibt), Rest unberührt", () => {
    const r = autocorrectTypedText("x<=yrest", 4, "y", RULES);
    expect(r).toMatchObject({ from: 1, insert: "≤y", raw: "<=y", text: "x≤yrest", caret: 3 });
  });

  it("'<3' -> '❤️' (zwei UTF-16-Einheiten): Cursor = from + 2, Text danach unberührt", () => {
    const r = autocorrectTypedText("x<3y", 3, "3", RULES);
    expect(r.text).toBe("x❤️y");
    expect(r.text.length).toBe(4);
    expect(r.caret).toBe(1 + "❤️".length);
    expect(r.caret).toBe(3);
  });

  it("':)' -> Emoji (Surrogatpaar): Cursor = from + Länge des Ersatzes", () => {
    const r = autocorrectTypedText("a :)", 4, ")", RULES);
    expect(r.text).toBe("a 😊");
    expect(r.caret).toBe(2 + "😊".length);
  });

  it("eine Zeile mit 600 Zeichen ohne Umbruch: der Trigger am Ende feuert weiterhin", () => {
    const long = "x".repeat(600);
    expect(typeAll(RULES, long + "->").text).toBe(long + "→");
  });

  it("Fenster = höchstens 500 Zeichen VOR der Einfügestelle (AUTOCORRECT_LOOKBACK)", () => {
    expect(AUTOCORRECT_LOOKBACK).toBe(500);
    // multiply braucht die erste Ziffer im Fenster; \s* dazwischen kann lang sein.
    const build = (gap) => "1" + " ".repeat(gap) + "x3";
    // gap 498: Einfügestelle bei 500 -> Fenster beginnt bei 0 -> "1" ist drin
    const inWin = build(498);
    expect(autocorrectTypedText(inWin, inWin.length, "3", RULES).insert).toBe("1" + " ".repeat(498) + "×3");
    // gap 499: Einfügestelle bei 501 -> Fenster beginnt bei 1 -> "1" ist draußen
    const outWin = build(499);
    expect(autocorrectTypedText(outWin, outWin.length, "3", RULES)).toBeNull();
  });

  it("multiply-Drift-Pin gegen den Editor (DocEditor.jsx: m[1]+m[2]+'×'+m[3]+m[4]): nur das 'x' wird zu '×', Ziffern und Leerraum bleiben", () => {
    expect(autocorrectTypedText("Feld 2x3", 8, "3", RULES)).toMatchObject({ from: 5, to: 8, insert: "2×3", raw: "2x3", text: "Feld 2×3", caret: 8 });
    expect(typed("2 x 3")).toBe("2 × 3");
    expect(typed("2  x   3")).toBe("2  ×   3");
    // dokumentiertes Restrisiko der Bibliothek: eine zweite mehrstellige Zahl feuert schon bei der ersten Ziffer
    expect(typed("2x34")).toBe("2×34");
  });

  it("ein Astralzeichen (Emoji-Tastatur) direkt nach '--' zerreißt nichts und ersetzt nichts", () => {
    const r = typeAll(RULES, "a --😀");
    expect(r.text).toBe("a --😀");
    expect(r.steps).toHaveLength(0);
    // kein losgelöstes Surrogat im Ergebnis
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(r.text)).toBe(false);
  });

  it("eine Ersetzung, die selbst auf einen Trigger endet, wird NICHT weiter ersetzt (genau EINE Regel pro Eingabe)", () => {
    const cfg = { enabled: true, categories: {}, custom: [{ trigger: "xx", replacement: "->" }] };
    const r = typeAll(buildActiveRules(cfg), "xx");
    expect(r.text).toBe("->"); // kein Pfeil "→"
    expect(r.steps).toHaveLength(1);
    // das nächste getippte Zeichen wird wieder normal geprüft, "-> " bleibt roh
    expect(typeAll(buildActiveRules(cfg), "xx ").text).toBe("-> ");
  });

  it("Regex-Sonderzeichen in Trigger und Ersatz wirken buchstäblich (Escaping, kein String.replace mit '$&')", () => {
    const cfg = {
      enabled: true,
      categories: {},
      custom: [
        { trigger: "a.b", replacement: "X" },
        { trigger: "[x]", replacement: "Y" },
        { trigger: "qq", replacement: "$&$1$$" },
      ],
    };
    const rules = buildActiveRules(cfg);
    expect(typeAll(rules, "axb").text).toBe("axb"); // "." ist kein Joker
    expect(typeAll(rules, "a.b").text).toBe("X");
    expect(typeAll(rules, "[x]").text).toBe("Y");
    expect(typeAll(rules, "qq").text).toBe("$&$1$$"); // Ersatz unverändert
  });

  it("Ergibt die Ersetzung denselben Text wie der Rohtext, gilt das als kein Treffer und die Kette endet dort: keine weitere Regel greift (wie im Editor)", () => {
    const noop = { kind: "text", find: /(->)$/, replacement: "->" };
    expect(autocorrectTypedText("ab->", 4, ">", [noop])).toBeNull();
    // die ERSTE passende Regel beendet die Suche auch dann, wenn sie nichts ändert:
    // die eingebaute "->"-Regel dahinter darf NICHT mehr zu "→" ersetzen
    expect(autocorrectTypedText("ab->", 4, ">", [noop, ...RULES])).toBeNull();
    // eine NICHT passende Regel davor stoppt die Kette dagegen nicht
    const other = { kind: "text", find: /(zz)$/, replacement: "Y" };
    expect(autocorrectTypedText("ab->", 4, ">", [other, ...RULES]).text).toBe("ab→");
  });

  it("Abschalt-Trick per custom (identischer Ersatz) lässt kürzere Suffix-Trigger NICHT durchrutschen: '-->' -> '-→', '<=>' -> '<⇒', '==>' -> '=⇒', '<->' -> '<→' wären Fehler", () => {
    // Bevor die Kette bei einem No-op-Treffer endete, ergab "a --> b" hier "a -→ b".
    for (const trigger of ["-->", "<=>", "==>", "<->"]) {
      const cfg = { enabled: true, categories: {}, custom: [{ trigger, replacement: trigger }] };
      expect(typeAll(buildActiveRules(cfg), `a ${trigger} b`).text, trigger).toBe(`a ${trigger} b`);
    }
    // Gegenprobe: ohne custom-Override greifen dieselben Trigger wie gehabt
    expect(typed("a --> b")).toBe("a ⟶ b");
    // und der Override wirkt nur auf seinen eigenen Trigger, das kürzere "->" bleibt
    const cfg = { enabled: true, categories: {}, custom: [{ trigger: "-->", replacement: "-->" }] };
    expect(typeAll(buildActiveRules(cfg), "a -> b").text).toBe("a → b");
  });

  it("match[1]-Mechanik mit mehrfach vorkommendem Gruppentext: der ERSATZ beginnt beim LETZTEN Vorkommen (lastIndexOf, wie textInputRule.ts), nicht beim ersten", () => {
    // find /x(x)$/ trifft "xx"; m[1] = "x" steht in m[0] an Index 0 UND 1.
    // lastIndexOf -> Offset 1: nur das letzte "x" wird ersetzt ("axY");
    // indexOf -> Offset 0: das Ersatz-Ergebnis wäre "aYx".
    const r = autocorrectTypedText("axx", 3, "x", [{ kind: "text", find: /x(x)$/, replacement: "Y" }]);
    expect(r.text).toBe("axY");
    expect(r).toMatchObject({ from: 2, to: 3, insert: "Y", raw: "x", caret: 3 });
  });
});

describe("autocorrectTypedText: Guards (wirft nie, kaputte Argumente -> null)", () => {
  it("Ausgangslage: gültige Argumente liefern die Ersetzung", () => {
    expect(autocorrectTypedText("ab->", 4, ">", RULES)).toEqual({ from: 2, to: 4, insert: "→", raw: "->", text: "ab→", caret: 3 });
  });

  it.each([
    ["text null", [null, 4, ">"]],
    ["text undefined", [undefined, 4, ">"]],
    ["text Zahl", [1234, 4, ">"]],
    ["typed leer", ["ab->", 4, ""]],
    ["typed null", ["ab->", 4, null]],
    ["typed Zahl", ["ab->", 4, 5]],
    ["caret NaN", ["ab->", NaN, ">"]],
    ["caret Kommazahl", ["ab->", 4.5, ">"]],
    ["caret String", ["ab->", "4", ">"]],
    ["caret undefined", ["ab->", undefined, ">"]],
    ["caret Infinity", ["ab->", Infinity, ">"]],
    ["caret negativ", ["ab->", -1, ">"]],
    ["caret hinter dem Textende", ["ab->", 5, ">"]],
    ["caret kleiner als typed.length", ["ab->", 0, ">"]],
    ["Text vor dem Cursor ungleich typed", ["ab->", 4, "x"]],
    ["Text vor dem Cursor ungleich typed (Cursor verrutscht)", ["ab->", 3, ">"]],
  ])("%s -> null", (_name, args) => {
    expect(autocorrectTypedText(...args, RULES)).toBeNull();
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["leeres Array", []],
    ["String", "rules"],
    ["Objekt", {}],
  ])("rules %s -> null", (_name, rules) => {
    expect(autocorrectTypedText("ab->", 4, ">", rules)).toBeNull();
  });

  it("Regeln ohne RegExp werden übersprungen, die nächste gültige Regel gewinnt", () => {
    const broken = [null, undefined, {}, { find: "->$", replacement: "X" }, { find: { exec() { return null; } }, replacement: "X" }, 5];
    expect(autocorrectTypedText("ab->", 4, ">", [...broken, ...RULES]).text).toBe("ab→");
    expect(autocorrectTypedText("ab->", 4, ">", broken)).toBeNull();
  });

  it("Regel mit nicht-String-Ersatz wird übersprungen (nächste Regel gewinnt), allein liefert sie null", () => {
    const bad = { kind: "text", find: /(->)$/, replacement: 5 };
    expect(autocorrectTypedText("ab->", 4, ">", [bad])).toBeNull();
    expect(autocorrectTypedText("ab->", 4, ">", [bad, ...RULES]).text).toBe("ab→");
  });

  it("Regel, deren exec wirft, wird übersprungen statt den Tastendruck zu sprengen", () => {
    const boom = Object.assign(/(->)$/, { exec() { throw new Error("boom"); } });
    expect(() => autocorrectTypedText("ab->", 4, ">", [{ kind: "text", find: boom, replacement: "X" }, ...RULES])).not.toThrow();
    expect(autocorrectTypedText("ab->", 4, ">", [{ kind: "text", find: boom, replacement: "X" }, ...RULES]).text).toBe("ab→");
  });

  it("lastIndex einer globalen Fremd-Regex wird zurückgesetzt (sonst würde ab dem alten Index gesucht)", () => {
    const g = /(->)$/g;
    g.lastIndex = 10;
    expect(autocorrectTypedText("ab->", 4, ">", [{ kind: "text", find: g, replacement: "→" }]).text).toBe("ab→");
    g.lastIndex = 3;
    expect(autocorrectTypedText("ab->", 4, ">", [{ kind: "text", find: g, replacement: "→" }]).text).toBe("ab→");
  });

  it("Regel OHNE Capture-Gruppe: ersetzt ab dem Match-Anfang", () => {
    expect(autocorrectTypedText("ab->", 4, ">", [{ kind: "text", find: /->$/, replacement: "→" }])).toMatchObject({ from: 2, text: "ab→" });
  });

  it("nur Treffer, die am Fensterende (= Cursor) enden, zählen", () => {
    // Regex ohne '$': matcht mitten im Fenster, endet aber nicht am Cursor
    expect(autocorrectTypedText("a-> ", 4, " ", [{ kind: "text", find: /(->)/, replacement: "→" }])).toBeNull();
  });

  it("multiply-Regel ohne die vier Ziffern-/Leerraum-Gruppen wird übersprungen", () => {
    expect(autocorrectTypedText("2x3", 3, "3", [{ kind: "multiply", find: /x3$/ }])).toBeNull();
  });

  it("multiply-Regel mit nicht teilnehmenden Leerraum-Gruppen (undefined statt '') liefert trotzdem '2×3' und nie 'undefined'", () => {
    const optional = { kind: "multiply", find: /(\d)(\s+)?x(\s+)?(\d)$/ };
    expect(autocorrectTypedText("2x3", 3, "3", [optional])).toMatchObject({ insert: "2×3", text: "2×3" });
    expect(autocorrectTypedText("2 x 3", 5, "3", [optional])).toMatchObject({ insert: "2 × 3" });
  });

  it("ein Treffer, der vor dem Fenster beginnt (defekte Fremd-Regex), wird verworfen statt Text vor dem Fenster zu überschreiben", () => {
    const evil = Object.assign(/x/, {
      exec() {
        const m = ["ab->!!"]; // länger als das Fenster, endet aber rechnerisch am Fensterende
        m.index = -2;
        return m;
      },
    });
    expect(autocorrectTypedText("ab->", 4, ">", [{ kind: "text", find: evil, replacement: "X" }])).toBeNull();
  });
});

describe("revertAutocorrect: Rücknahme (Vorbild undoInputRule)", () => {
  // Zustand direkt nach einer Ersetzung, wie ihn die Komponente als Merker hält
  const applied = (str, start) => {
    const { steps } = typeAll(RULES, str, start);
    return steps[steps.length - 1];
  };

  it("instant: 'a→|' -> 'a->|', Cursor hinter dem Rohtext", () => {
    const { r } = applied("a->");
    expect(revertAutocorrect(r, "a→", 2, 2)).toEqual({ from: 1, to: 2, insert: "->", text: "a->", caret: 3 });
  });

  it("terminator: 'a – |' -> 'a -- |' (das Abschlusszeichen bleibt, Rohtext kommt zurück)", () => {
    const { r } = applied("a -- ");
    expect(r.text).toBe("a – ");
    const rev = revertAutocorrect(r, r.text, r.caret, r.caret);
    expect(rev).toMatchObject({ insert: "-- ", text: "a -- ", caret: 5 });
  });

  it("Enter als Abschlusszeichen: 'a –⏎|' -> 'a --⏎|'", () => {
    const { r } = applied("a --\n");
    const rev = revertAutocorrect(r, r.text, r.caret, r.caret);
    expect(rev).toMatchObject({ text: "a --\n", caret: 5 });
  });

  it("mitten im Text: Rest hinter dem Cursor bleibt, 'x→| y' -> 'x->| y'", () => {
    const r = autocorrectTypedText("x-> y", 3, ">", RULES);
    expect(revertAutocorrect(r, r.text, r.caret, r.caret)).toMatchObject({ text: "x-> y", caret: 3 });
  });

  it("Roundtrip über den GANZEN Korpus: revert(apply(x)) stellt an jeder Ersetzungsstelle exakt den Rohzustand wieder her", () => {
    const corpus = [
      "Pfeil: -> Ziel", "Gedanke -- weiter", "---", "Bald...", "Copyright (c) 2026", "(a) erstens", "a != b",
      "a <= b", "Feld 2x3 cm", "2 x 3", "nimm 1/2 Becher", "Hi :)", "Winkel \\alpha.", "Summe \\sum wert",
      "Pfeil --> Ziel", "Trennlinie --- Ende", "Rueckpfeil <-- Start", "a <-> b", "a <== b", "a <=> b",
      "a ==> b", "Zitat: << Text", "x <3 y", "a --\nb", "\\alpha\n", "x\n1/2 ",
    ];
    let checked = 0;
    for (const input of corpus) {
      for (const s of typeAll(RULES, input).steps) {
        const rev = revertAutocorrect(s.r, s.r.text, s.r.caret, s.r.caret);
        expect(rev, input).not.toBeNull();
        expect(rev.text, input).toBe(s.rawText);
        expect(rev.caret, input).toBe(s.rawCaret);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(corpus.length); // jede Zeile hat mindestens eine Ersetzung
    // mit Anführungszeichen: öffnend und schließend
    for (const s of typeAll(buildActiveRules(QUOTE_CFG), 'Er sagte "Hallo".').steps) {
      const rev = revertAutocorrect(s.r, s.r.text, s.r.caret, s.r.caret);
      expect(rev.text).toBe(s.rawText);
    }
  });

  it("nach der Rücknahme löst das nächste Zeichen nichts erneut aus: '->' + Leerzeichen bleibt roh", () => {
    const { r } = applied("a->");
    const rev = revertAutocorrect(r, "a→", 2, 2);
    expect(typeAll(RULES, " ", { text: rev.text, caret: rev.caret }).text).toBe("a-> ");
  });

  it("ungültig bei anderem Text, anderem Cursor, Auswahl oder abweichendem Selektionsende", () => {
    const { r } = applied("ab->");
    expect(revertAutocorrect(r, "ab→", 3, 3)).not.toBeNull(); // Ausgangslage
    expect(revertAutocorrect(r, "ab→x", 3, 3)).toBeNull(); // Text weiter getippt
    expect(revertAutocorrect(r, "REMOTE", 3, 3)).toBeNull(); // fremder Merge
    expect(revertAutocorrect(r, "ab→", 2, 2)).toBeNull(); // Cursor bewegt
    expect(revertAutocorrect(r, "ab→", 2, 3)).toBeNull(); // Auswahl
    expect(revertAutocorrect(r, "ab→", 3, 2)).toBeNull();
    expect(revertAutocorrect(r, "ab→", 0, 3)).toBeNull();
    expect(revertAutocorrect(r, undefined, 3, 3)).toBeNull();
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["String", "a→"],
    ["leeres Objekt", {}],
    ["Text fehlt", { from: 1, insert: "→", raw: "->", caret: 2 }],
    ["caret NaN", { from: 1, insert: "→", raw: "->", text: "a→", caret: NaN }],
    ["from als String", { from: "1", insert: "→", raw: "->", text: "a→", caret: 2 }],
    ["raw fehlt", { from: 1, insert: "→", text: "a→", caret: 2 }],
    ["insert fehlt", { from: 1, raw: "->", text: "a→", caret: 2 }],
    ["from negativ", { from: -1, insert: "→", raw: "->", text: "a→", caret: 2 }],
    ["from hinter caret", { from: 3, insert: "→", raw: "->", text: "a→", caret: 2 }],
    ["caret hinter dem Textende", { from: 1, insert: "→", raw: "->", text: "a→", caret: 9 }],
    ["Ersatz steht nicht an der behaupteten Stelle", { from: 0, insert: "→", raw: "->", text: "a→", caret: 2 }],
  ])("kaputter Merker (%s) -> null, nie ein Schreibvorgang", (_name, record) => {
    expect(revertAutocorrect(record, "a→", 2, 2)).toBeNull();
  });
});

describe("isAutocorrectTriggerRange: ist die markierte Spanne genau eine Trigger-Spanne?", () => {
  it("positiv: '->' in 'ab->', '<= ' (Terminator samt Abschlusszeichen), '<3', '2x3' mitten im Text", () => {
    expect(isAutocorrectTriggerRange("ab->", 2, 4, RULES)).toBe(true);
    expect(isAutocorrectTriggerRange("a <= ", 2, 5, RULES)).toBe(true);
    expect(isAutocorrectTriggerRange("x<3", 1, 3, RULES)).toBe(true);
    expect(isAutocorrectTriggerRange("Feld 2x3 cm", 5, 8, RULES)).toBe(true);
    expect(isAutocorrectTriggerRange("a --\n", 2, 5, RULES)).toBe(true);
  });

  it("positiv auch bei einem Trigger, der auf ein Astralzeichen endet (letzter Codepoint = 2 Einheiten)", () => {
    const rules = buildActiveRules({ enabled: true, categories: {}, custom: [{ trigger: "a😀", replacement: "A" }] });
    expect(isAutocorrectTriggerRange("a😀", 0, 3, rules)).toBe(true);
  });

  it("negativ: kollabiert, zu große/zu kleine Spanne, Text ohne Trigger, Regeln aus", () => {
    expect(isAutocorrectTriggerRange("ab->", 4, 4, RULES)).toBe(false); // leer
    expect(isAutocorrectTriggerRange("ab->", 1, 4, RULES)).toBe(false); // größer als der Trigger
    expect(isAutocorrectTriggerRange("ab->", 3, 4, RULES)).toBe(false); // nur ">"
    expect(isAutocorrectTriggerRange("ab->", 0, 4, RULES)).toBe(false); // ganzer Text
    expect(isAutocorrectTriggerRange("abc", 0, 3, RULES)).toBe(false);
    expect(isAutocorrectTriggerRange("ab->", 2, 4, [])).toBe(false);
    expect(isAutocorrectTriggerRange("ab->", 2, 4, buildActiveRules({ enabled: false }))).toBe(false);
    expect(isAutocorrectTriggerRange("ab->", 2, 4, buildActiveRules({ categories: { pfeile: false } }))).toBe(false);
  });

  it("negativ bei kaputten Argumenten (wirft nie)", () => {
    expect(isAutocorrectTriggerRange(null, 0, 2, RULES)).toBe(false);
    expect(isAutocorrectTriggerRange("ab->", NaN, 4, RULES)).toBe(false);
    expect(isAutocorrectTriggerRange("ab->", 2, "4", RULES)).toBe(false);
    expect(isAutocorrectTriggerRange("ab->", 4, 2, RULES)).toBe(false); // umgekehrt
    expect(isAutocorrectTriggerRange("ab->", -1, 4, RULES)).toBe(false);
    expect(isAutocorrectTriggerRange("ab->", 2, 9, RULES)).toBe(false);
    expect(isAutocorrectTriggerRange("ab->", 2, 4, null)).toBe(false);
  });
});
