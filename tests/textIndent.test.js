// v7.56, Nutzerwunsch "in der Schnellnotiz mit Tab einrücken" –
// indentSelection() ist eine reine Text-Funktion (kein DOM), VS-Code-artige
// Semantik, siehe Kopfkommentar in src/lib/textIndent.js. Diese Tests
// decken JEDEN im Auftrag benannten Fall mit konkreten Datenlagen ab
// (exakte text- UND Selektions-Erwartungen), nicht nur Stichproben.
import { describe, it, expect } from "vitest";
import { indentSelection, trimNoteBlock } from "../src/lib/textIndent.js";

describe("indentSelection – Tab, leere Auswahl (unit an Cursorposition einfügen)", () => {
  it("Cursor am Textanfang", () => {
    const r = indentSelection("abc", 0, 0);
    expect(r).toEqual({ text: "\tabc", selStart: 1, selEnd: 1 });
  });

  it("Cursor mitten im Text", () => {
    const r = indentSelection("abcdef", 3, 3);
    expect(r).toEqual({ text: "abc\tdef", selStart: 4, selEnd: 4 });
  });

  it("Cursor am Textende", () => {
    const r = indentSelection("abc", 3, 3);
    expect(r).toEqual({ text: "abc\t", selStart: 4, selEnd: 4 });
  });
});

describe("indentSelection – Tab, Teilauswahl INNERHALB einer Zeile (ersetzen, kollabiert)", () => {
  it("Auswahl mitten in der Zeile, nicht am Anfang/Ende", () => {
    // "ab[cd]ef" -> Auswahl "cd" (Index 2..4) wird durch "\t" ersetzt.
    const r = indentSelection("abcdef", 2, 4);
    expect(r).toEqual({ text: "ab\tef", selStart: 3, selEnd: 3 });
  });

  it("Auswahl beginnt am Zeilenanfang, endet aber NICHT am Zeilenende -> zählt als Teilauswahl", () => {
    const r = indentSelection("abcdef\nzz", 0, 3);
    expect(r).toEqual({ text: "\tdef\nzz", selStart: 1, selEnd: 1 });
  });

  it("Auswahl endet am Zeilenende, beginnt aber NICHT am Zeilenanfang -> zählt als Teilauswahl", () => {
    const r = indentSelection("xxabc", 2, 5);
    expect(r).toEqual({ text: "xx\t", selStart: 3, selEnd: 3 });
  });
});

describe("indentSelection – Tab, genau eine ganze Zeile markiert (Start=Zeilenanfang, Ende=Zeilenende)", () => {
  it("einzige Zeile komplett markiert", () => {
    const r = indentSelection("abc", 0, 3);
    expect(r).toEqual({ text: "\tabc", selStart: 0, selEnd: 4 });
  });

  it("mittlere Zeile eines Mehrzeilers komplett markiert", () => {
    const text = "eins\nzwei\ndrei";
    const s = text.indexOf("zwei");
    const e = s + "zwei".length;
    const r = indentSelection(text, s, e);
    expect(r.text).toBe("eins\n\tzwei\ndrei");
    expect(r.selStart).toBe(s); // stand am Zeilenanfang -> bleibt
    expect(r.selEnd).toBe(e + 1);
  });
});

describe("indentSelection – Tab, Mehrzeilen-Auswahl", () => {
  it("zwei volle Zeilen (ganzer Text markiert)", () => {
    const r = indentSelection("a\nb", 0, 3);
    expect(r).toEqual({ text: "\ta\n\tb", selStart: 0, selEnd: 5 });
  });

  it("leere Zwischenzeile wird beim Einrücken übersprungen", () => {
    const text = "eins\n\nzwei"; // Zeile 2 ist leer
    const r = indentSelection(text, 0, text.length);
    expect(r.text).toBe("\teins\n\n\tzwei");
    // eingefügt: 1 (Zeile1) + 0 (leere Zeile) + 1 (Zeile3) = 2 Zeichen
    expect(r.selStart).toBe(0);
    expect(r.selEnd).toBe(text.length + 2);
  });

  it("Auswahl endet exakt am Anfang einer Zeile -> diese letzte Zeile wird NICHT eingerückt", () => {
    const text = "eins\nzwei\ndrei";
    const s = 0;
    const e = text.indexOf("zwei"); // direkt vor "zwei", Zeichen davor ist "\n"
    const r = indentSelection(text, s, e);
    expect(r.text).toBe("\teins\nzwei\ndrei");
    expect(r.selStart).toBe(0);
    // nur 1 Zeichen eingefügt (Zeile "eins"), "zwei" bleibt unangetastet
    expect(r.selEnd).toBe(e + 1);
  });

  it("Auswahl beginnt mitten in der ersten Zeile -> selStart wandert um unit.length", () => {
    const text = "eins\nzwei\ndrei";
    const s = 2; // mitten in "eins"
    const e = text.indexOf("drei") + "drei".length; // bis zum Textende
    const r = indentSelection(text, s, e);
    expect(r.text).toBe("\teins\n\tzwei\n\tdrei");
    expect(r.selStart).toBe(s + 1); // +1 == +unit.length ("\t")
    expect(r.selEnd).toBe(e + 3); // 3 Zeilen eingerückt
  });

  it("Auswahl deckt NUR den Zeilenumbruch ab: Endzeile (Spalte 1) fällt raus, nur Zeile 1 wird eingerückt", () => {
    // "abc[\n]def" -> Auswahl ist genau das "\n" (Index 3..4). Wie bei einer
    // ganz normalen Mehrzeilen-Auswahl endet sie am Anfang von Zeile 2 (Regel
    // aus touchedLineStarts: "Anfang < e" -> Zeile 2 zählt NICHT), Zeile 1
    // (Anfang 0) zählt. Die Auswahl bleibt danach auf dem Umbruch.
    const r = indentSelection("abc\ndef", 3, 4);
    expect(r).toEqual({ text: "\tabc\ndef", selStart: 4, selEnd: 5 });
  });

  it("wiederholtes Tab auf der eigenen Rückgabe rückt weiter ein (Selektion deckt weiter alle Zeilen ab)", () => {
    const first = indentSelection("a\nb", 0, 3);
    expect(first).toEqual({ text: "\ta\n\tb", selStart: 0, selEnd: 5 });
    const second = indentSelection(first.text, first.selStart, first.selEnd);
    expect(second).toEqual({ text: "\t\ta\n\t\tb", selStart: 0, selEnd: 7 });
  });
});

describe("indentSelection – unit als zwei Leerzeichen (Alternative zu Tab)", () => {
  it("leere Auswahl", () => {
    const r = indentSelection("ab", 1, 1, { unit: "  " });
    expect(r).toEqual({ text: "a  b", selStart: 3, selEnd: 3 });
  });

  it("Mehrzeilen-Einrückung", () => {
    const r = indentSelection("a\nb", 0, 3, { unit: "  " });
    expect(r).toEqual({ text: "  a\n  b", selStart: 0, selEnd: 7 });
  });
});

describe("indentSelection – Umschalt+Tab (outdent)", () => {
  it("entfernt einen führenden Tab", () => {
    const r = indentSelection("\tabc", 4, 4, { outdent: true });
    expect(r).toEqual({ text: "abc", selStart: 3, selEnd: 3 });
  });

  it("entfernt 4 führende Leerzeichen", () => {
    const r = indentSelection("    abc", 7, 7, { outdent: true });
    expect(r).toEqual({ text: "abc", selStart: 3, selEnd: 3 });
  });

  it("entfernt nur 2 führende Leerzeichen, wenn nur 2 da sind", () => {
    const r = indentSelection("  abc", 5, 5, { outdent: true });
    expect(r).toEqual({ text: "abc", selStart: 3, selEnd: 3 });
  });

  it("6 führende Leerzeichen: nur max. 4 werden entfernt, 2 bleiben", () => {
    const r = indentSelection("      abc", 9, 9, { outdent: true });
    expect(r).toEqual({ text: "  abc", selStart: 5, selEnd: 5 });
  });

  it("Zeile ohne Einzug bleibt unverändert (kein Text-, kein Selektionswechsel)", () => {
    const r = indentSelection("abc", 1, 1, { outdent: true });
    expect(r).toEqual({ text: "abc", selStart: 1, selEnd: 1 });
  });

  it("Tab bevorzugt vor Leerzeichen (Zeile beginnt mit Tab): nur der Tab fällt weg", () => {
    const r = indentSelection("\t  abc", 0, 0, { outdent: true });
    expect(r).toEqual({ text: "  abc", selStart: 0, selEnd: 0 });
  });

  it("Cursor klemmt am Zeilenanfang, wenn er innerhalb der entfernten Einrückung stand", () => {
    // Cursor zwischen den beiden führenden Leerzeichen (Position 1).
    const r = indentSelection("  abc", 1, 1, { outdent: true });
    expect(r).toEqual({ text: "abc", selStart: 0, selEnd: 0 });
  });

  it("leere Auswahl outdentet NUR die aktuelle Zeile, nicht die Zeile davor", () => {
    const text = "\teins\n\tzwei"; // beide Zeilen sind eingerückt
    const s = text.indexOf("wei"); // mitten in "zwei", NICHT am Zeilenanfang
    const r = indentSelection(text, s, s, { outdent: true });
    expect(r.text).toBe("\teins\nzwei"); // nur Zeile 2 verliert den Tab
    expect(r.selStart).toBe(s - 1); // der vor dem Cursor entfernte Tab zieht ihn mit
    expect(r.selEnd).toBe(s - 1);
  });

  it("Mehrzeilen-Outdent, gemischt: Tab / 2 Leerzeichen / kein Einzug", () => {
    const text = "\tfoo\n  bar\nbaz";
    const r = indentSelection(text, 0, text.length, { outdent: true });
    expect(r.text).toBe("foo\nbar\nbaz");
    expect(r.selStart).toBe(0);
    // insgesamt 1 (Tab) + 2 (Leerzeichen) + 0 = 3 Zeichen entfernt
    expect(r.selEnd).toBe(text.length - 3);
  });

  it("Auswahl endet exakt am Anfang einer Zeile -> diese letzte Zeile bleibt beim Outdent unberührt", () => {
    const text = "\teins\n\tzwei";
    const e = text.indexOf("\tzwei"); // direkt vor der 2. Zeile
    const r = indentSelection(text, 0, e, { outdent: true });
    expect(r.text).toBe("eins\n\tzwei");
    expect(r.selEnd).toBe(e - 1);
  });

  it("Selektion über mehrere eingerückte Zeilen rückt beide aus (kein Wechsel auf Teilauswahl-Ersetzung wie bei Tab)", () => {
    const text = "\ta\n\tb";
    const r = indentSelection(text, 1, text.length, { outdent: true });
    expect(r.text).toBe("a\nb");
    // selStart=1 lag INNERHALB des entfernten Tabs der ersten Zeile und muss
    // auf deren (unveränderten) Zeilenanfang klemmen (0). selEnd=5 lag am
    // Textende, hinter beiden entfernten Tabs -> 5 - 1 (Zeile1) - 1 (Zeile2) = 3.
    expect(r.selStart).toBe(0);
    expect(r.selEnd).toBe(3);
  });
});

describe("indentSelection – CRLF (\\r\\n) robust: nie zwischen \\r und \\n eingefügt/entfernt", () => {
  it("Tab an leerer Auswahl direkt vor einem \\r\\n", () => {
    const text = "abc\r\ndef";
    const r = indentSelection(text, 3, 3); // direkt nach "abc", vor \r\n
    expect(r.text).toBe("abc\t\r\ndef");
    expect(r.selStart).toBe(4);
  });

  it("Mehrzeilen-Einrückung: Zeilenanfang der zweiten Zeile liegt NACH dem \\n, nicht zwischen \\r und \\n", () => {
    const text = "abc\r\ndef";
    const r = indentSelection(text, 0, text.length);
    expect(r.text).toBe("\tabc\r\n\tdef");
  });

  it("Outdent: führendes Leerzeichen der zweiten Zeile nach \\r\\n wird korrekt erkannt", () => {
    const text = "abc\r\n  def";
    const r = indentSelection(text, 0, text.length, { outdent: true });
    expect(r.text).toBe("abc\r\ndef");
  });

  it("leere CRLF-Zwischenzeile wird beim Einrücken übersprungen (Regression: \\r statt \\n am Zeilenanfang)", () => {
    const text = "eins\r\n\r\nzwei"; // Zeile 2 ist leer, aber CRLF-typisch beginnt sie mit \r
    const r = indentSelection(text, 0, 12);
    expect(r.text).toBe("\teins\r\n\r\n\tzwei");
    expect(r.selStart).toBe(0);
    expect(r.selEnd).toBe(14);
  });

  it("ganze Zeile ohne Zeilenende markiert (CRLF): zählt als Ganze-Zeile-Einrückung, nicht als Teilauswahl-Ersatz (Regression: \\r zählte zum Inhalt)", () => {
    const text = "abc\r\ndef";
    const r = indentSelection(text, 0, 3); // "abc" komplett markiert, ohne das \r
    expect(r.text).toBe("\tabc\r\ndef");
    expect(r.selStart).toBe(0);
    expect(r.selEnd).toBe(4);
  });

  it("Cursor exakt zwischen \\r und \\n: wird vor das \\r zurückgezogen, nicht mitten in den Zeilenumbruch eingefügt (Regression)", () => {
    const text = "abc\r\ndef";
    const r = indentSelection(text, 4, 4); // Position 4 liegt zwischen \r (Index 3) und \n (Index 4)
    expect(r.text).toBe("abc\t\r\ndef");
    expect(r.selStart).toBe(4);
    expect(r.selEnd).toBe(4);
  });
});

describe("indentSelection – kaputte Eingaben", () => {
  it("text === null -> leerer String, Selektion 0/0", () => {
    expect(indentSelection(null, 5, 5)).toEqual({ text: "", selStart: 0, selEnd: 0 });
  });

  it("text === undefined -> leerer String, Selektion 0/0", () => {
    expect(indentSelection(undefined, 2, 9)).toEqual({ text: "", selStart: 0, selEnd: 0 });
  });

  it("text als Zahl -> komplett unverändert durchgereicht (kein Crash)", () => {
    expect(indentSelection(123, 0, 0)).toEqual({ text: 123, selStart: 0, selEnd: 0 });
  });

  it("selStart > selEnd -> werden vertauscht", () => {
    const r = indentSelection("abcdef", 4, 2);
    // entspricht indentSelection("abcdef", 2, 4)
    expect(r).toEqual({ text: "ab\tef", selStart: 3, selEnd: 3 });
  });

  it("negative Positionen werden auf 0 geklemmt", () => {
    const r = indentSelection("abc", -5, -1);
    expect(r).toEqual({ text: "\tabc", selStart: 1, selEnd: 1 });
  });

  it("zu große Positionen werden auf text.length geklemmt", () => {
    const r = indentSelection("abc", 100, 200);
    expect(r).toEqual({ text: "abc\t", selStart: 4, selEnd: 4 });
  });

  it("NaN-Positionen werden als 0 behandelt", () => {
    const r = indentSelection("abc", NaN, NaN);
    expect(r).toEqual({ text: "\tabc", selStart: 1, selEnd: 1 });
  });

  it("nicht-numerische Positionen (Strings/undefined) werden als 0 behandelt", () => {
    const r1 = indentSelection("abc", "2", "2");
    expect(r1).toEqual({ text: "\tabc", selStart: 1, selEnd: 1 });
    const r2 = indentSelection("abc", undefined, undefined);
    expect(r2).toEqual({ text: "\tabc", selStart: 1, selEnd: 1 });
  });

  it("leerer Text bleibt bei Tab/Outdent robust (kein Crash, Outdent no-op)", () => {
    expect(indentSelection("", 0, 0)).toEqual({ text: "\t", selStart: 1, selEnd: 1 });
    expect(indentSelection("", 0, 0, { outdent: true })).toEqual({ text: "", selStart: 0, selEnd: 0 });
  });

  it("opts === null wird wie ein fehlendes opts behandelt (Default-Parameter greift nur bei undefined, nicht bei null)", () => {
    const r = indentSelection("ab", 1, 1, null);
    expect(r).toEqual({ text: "a\tb", selStart: 2, selEnd: 2 });
  });
});

// v7.56 Nachbesserung: submitQuickNote (App.jsx) nutzt trimNoteBlock statt
// text.trim(), damit der Einzug der ERSTEN Zeile einer Schnellnotiz beim
// Übernehmen in den Chat-Prompt erhalten bleibt (siehe DECISIONS #114).
describe("trimNoteBlock – führende Leerzeilen + Whitespace am Ende entfernen, ERSTE inhaltstragende Zeile behält ihren Einzug", () => {
  it("Einzug der ersten UND zweiten Zeile bleibt unverändert, wenn keine führende Leerzeile vorausgeht", () => {
    expect(trimNoteBlock("\tA\n\tB")).toBe("\tA\n\tB");
  });

  it("führende Leerzeilen (nur Leerzeichen bzw. leer) werden samt Zeilenumbruch entfernt, der Tab der ersten inhaltstragenden Zeile bleibt", () => {
    expect(trimNoteBlock("\n  \n\tA\n")).toBe("\tA");
  });

  it("Text aus ausschließlich Whitespace (kein Zeilenumbruch am Ende) wird zu einem leeren String", () => {
    expect(trimNoteBlock("   ")).toBe("");
  });

  it("Whitespace am Ende (inkl. Leerzeilen) wird entfernt, führende Inhalte bleiben", () => {
    expect(trimNoteBlock("A  \n\n")).toBe("A");
  });

  it("CRLF-tolerant: führende Leerzeile mit \\r\\n und Whitespace am Ende mit \\r\\n werden korrekt erkannt", () => {
    expect(trimNoteBlock("\r\n\tA\r\n")).toBe("\tA");
  });

  it("Nicht-String-Eingaben (null, Zahl) liefern einen leeren String statt zu crashen", () => {
    expect(trimNoteBlock(null)).toBe("");
    expect(trimNoteBlock(123)).toBe("");
    expect(trimNoteBlock(undefined)).toBe("");
  });

  it("Text ohne jeglichen Whitespace an Anfang/Ende bleibt unverändert", () => {
    expect(trimNoteBlock("Hallo Welt")).toBe("Hallo Welt");
  });

  it("mehrere gemischte führende Leerzeilen (Tabs, Leerzeichen, ganz leer) werden alle entfernt", () => {
    expect(trimNoteBlock("\t\n   \n\n\tZeile eins\n\tZeile zwei")).toBe("\tZeile eins\n\tZeile zwei");
  });

  it("eine Leerzeile MITTEN im Text bleibt unangetastet (nur FÜHRENDE Leerzeilen werden entfernt)", () => {
    expect(trimNoteBlock("A\n\n\tB")).toBe("A\n\n\tB");
  });

  // Review-Fix (🟢 Finding 6): eine per Paste (Word/HTML) eingeschleppte
  // führende Leerzeile aus einem NBSP (\u00A0) statt Space/Tab muss der
  // 1. Durchgang ebenfalls als Leerzeile erkennen (Symmetrie zum
  // \s-basierten 2. Durchgang, der NBSP längst als Whitespace behandelt).
  it("eine führende Leerzeile aus NBSP (\\u00A0) statt Space/Tab wird ebenfalls entfernt", () => {
    expect(trimNoteBlock("\u00A0\n\tA")).toBe("\tA");
  });
});
