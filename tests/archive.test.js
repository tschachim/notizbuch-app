import { describe, it, expect } from "vitest";
import { chatToMarkdown, archiveBaseName, mergeChats } from "../src/lib/archive.js";

const TS = new Date(2026, 6, 14, 9, 15).getTime(); // lokale Zeit

describe("archiveBaseName", () => {
  it("baut einen sortierbaren Namen aus lokaler Zeit (mit Nullauffüllung)", () => {
    expect(archiveBaseName(new Date(2026, 6, 14, 9, 5))).toBe("chat-2026-07-14-0905");
    expect(archiveBaseName(new Date(2026, 11, 3, 23, 59))).toBe("chat-2026-12-03-2359");
  });
});

describe("chatToMarkdown", () => {
  it("rendert Nutzer- und Assistent-Nachrichten mit Rollen-Label und Zeitstempel", () => {
    const md = chatToMarkdown([
      { role: "user", ts: TS, text: "Merke dir: Zahnarzt am Freitag." },
      { role: "assistant", ts: TS + 60000, text: "Notiert." },
    ]);
    expect(md).toMatch(/^# Chat-Archiv vom \d{2}\.\d{2}\.\d{4}/);
    expect(md).toContain("2 Nachrichten · archiviert aus der Notizbuch-App");
    expect(md).toMatch(/\*\*Nutzer\*\* · \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}/);
    expect(md).toMatch(/\*\*Assistent\*\* · \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}/);
    expect(md).toContain("Merke dir: Zahnarzt am Freitag.");
    expect(md).toContain("Notiert.");
  });

  it("überspringt Nachrichten ohne Zeitstempel (Begrüßung)", () => {
    const md = chatToMarkdown([
      { role: "assistant", ts: 0, text: "Hallo! Ich bin dein Notizbuch." },
      { role: "user", ts: TS, text: "Echte Notiz" },
    ]);
    expect(md).toContain("1 Nachrichten");
    expect(md).not.toContain("Hallo! Ich bin dein Notizbuch.");
    expect(md).toContain("Echte Notiz");
  });

  it("wandelt cite-Marker in nummerierte Fußnoten-Links um – gleiche URL = gleiche Nummer über Nachrichten hinweg", () => {
    const src = [{ url: "https://example.org/a", title: "A" }];
    const md = chatToMarkdown([
      {
        role: "assistant", ts: TS, sources: src,
        text: 'Erstens <cite index="1-1">Fakt eins</cite>.',
      },
      {
        role: "assistant", ts: TS + 1, sources: src,
        text: 'Zweitens <cite index="1-2">Fakt zwei</cite>.',
      },
    ]);
    expect(md).not.toContain("<cite");
    // beide Marker zeigen auf dieselbe URL → beide werden [1]
    const hits = md.match(/\[1\]\(https:\/\/example\.org\/a\)/g) || [];
    expect(hits.length).toBe(2);
    expect(md).not.toContain("[0](");
    expect(md).not.toContain("[2](");
  });

  it("nummeriert verschiedene URLs in Reihenfolge des Auftretens", () => {
    const md = chatToMarkdown([
      {
        role: "assistant", ts: TS,
        sources: [
          { url: "https://one.example/", title: "Eins" },
          { url: "https://two.example/", title: "Zwei" },
        ],
        text: 'A <cite index="1">x</cite> B <cite index="2">y</cite>',
      },
    ]);
    expect(md).toContain("[1](https://one.example/)");
    expect(md).toContain("[2](https://two.example/)");
  });

  it("listet konsultierte Quellen auf, wenn recherchiert, aber nichts inline zitiert wurde – ohne unsichere Schemata", () => {
    const md = chatToMarkdown([
      {
        role: "assistant", ts: TS, text: "Antwort ohne Marker.",
        sources: [
          { url: "https://example.org/x", title: "Quelle X" },
          { url: "javascript:alert(1)", title: "Böse" },
        ],
      },
    ]);
    expect(md).toContain("Quellen:");
    expect(md).toContain("- [Quelle X](https://example.org/x)");
    expect(md).not.toContain("javascript:");
  });

  it("strippt cite-Marker restlos, wenn keine Quellenliste vorliegt", () => {
    const md = chatToMarkdown([
      { role: "assistant", ts: TS, text: 'Text <cite index="1">markiert</cite> Ende.' },
    ]);
    expect(md).toContain("Text markiert Ende.");
    expect(md).not.toContain("<cite");
    expect(md).not.toContain("Quellen:");
  });

  it("verlinkt abgelegte Bilder relativ zu chats/ und kennzeichnet nicht abgelegte", () => {
    const md = chatToMarkdown(
      [
        { role: "user", ts: TS, imgId: "img-1", text: "Screenshot dazu" },
        { role: "user", ts: TS + 1, imgId: "img-2", text: "" },
      ],
      { resolveImg: (id) => (id === "img-1" ? "bilder/img-1.png" : null) }
    );
    expect(md).toContain("![Bild](../bilder/img-1.png)");
    expect(md).toContain("_[Bild – nicht im Daten-Repo abgelegt]_");
  });

  it("nennt Dateianhänge mit Ablageort", () => {
    const md = chatToMarkdown([
      { role: "user", ts: TS, fileName: "protokoll.pdf", text: "Bitte ablegen" },
    ]);
    expect(md).toContain("📎 Datei „protokoll.pdf“ (im Ordner dateien/ abgelegt)");
  });

  it("kennzeichnet Fehler-Nachrichten und Info-Pillen", () => {
    const md = chatToMarkdown([
      { role: "assistant", error: true, ts: TS, text: "Anfrage fehlgeschlagen: kaputt" },
      { role: "user", info: true, ts: TS + 1, text: "Notizbuch „QA“ manuell bearbeitet" },
    ]);
    expect(md).toMatch(/\*\*Assistent · Fehler\*\* · \d{2}\.\d{2}\.\d{4}/);
    expect(md).toContain("> ℹ️ Notizbuch „QA“ manuell bearbeitet");
  });

  it("vermerkt Dokument-Commits als Zitatzeile", () => {
    const md = chatToMarkdown([
      { role: "assistant", ts: TS, text: "Notiert.", commit: "Zahnarzt-Termin ergänzt" },
    ]);
    expect(md).toContain("> 💾 Ins Notizbuch übernommen: „Zahnarzt-Termin ergänzt“");
  });

  // v7.16 (globales Gedächtnis): eigene Badge-Zeile analog zur 💾-Zeile.
  it("vermerkt ein aktualisiertes globales Gedächtnis als Zitatzeile", () => {
    const md = chatToMarkdown([
      { role: "assistant", ts: TS, text: "Notiert.", memory: true },
    ]);
    expect(md).toContain("> 🧠 Gedächtnis aktualisiert");
  });

  it("ohne memory-Flag erscheint KEINE Gedächtnis-Zeile", () => {
    const md = chatToMarkdown([
      { role: "assistant", ts: TS, text: "Notiert." },
    ]);
    expect(md).not.toContain("🧠");
  });

  it("ein Turn mit BEIDEM (Notizbuch-Commit UND Gedächtnis-Update) zeigt beide Zeilen", () => {
    const md = chatToMarkdown([
      { role: "assistant", ts: TS, text: "Notiert.", commit: "Zahnarzt-Termin ergänzt", memory: true },
    ]);
    expect(md).toContain("> 💾 Ins Notizbuch übernommen: „Zahnarzt-Termin ergänzt“");
    expect(md).toContain("> 🧠 Gedächtnis aktualisiert");
  });

  // v7.21 (Ops-Zuverlässigkeit, siehe DECISIONS #63): ⚠️-Warn-Badge läuft
  // wie die bestehenden Commit-/Gedächtnis-Zeilen ins Archiv, kein
  // Sonderpfad – das ⚠️-Präfix aus App.jsx#buildOpsWarning reicht.
  it("vermerkt eine EINZEILIGE ⚠️-Warnung als eigene Zitatzeile", () => {
    const md = chatToMarkdown([
      {
        role: "assistant", ts: TS, text: "Erledigt.",
        warning: '⚠️ Nicht angewendet: delete_section „Warenkunde“ (Abschnitt „Warenkunde“ nicht gefunden)',
      },
    ]);
    expect(md).toContain('> ⚠️ Nicht angewendet: delete_section „Warenkunde“ (Abschnitt „Warenkunde“ nicht gefunden)');
  });

  it("eine MEHRZEILIGE ⚠️-Warnung bekommt auf JEDER Zeile ein eigenes '>' (bleibt ein zusammenhängendes Markdown-Zitat)", () => {
    const md = chatToMarkdown([
      {
        role: "assistant", ts: TS, text: "Teilweise erledigt.",
        warning: "⚠️ Nicht angewendet:\n– delete_section „Warenkunde“ (Abschnitt „Warenkunde“ nicht gefunden)\n– memory_append (leerer content)",
      },
    ]);
    expect(md).toContain("> ⚠️ Nicht angewendet:");
    expect(md).toContain('> – delete_section „Warenkunde“ (Abschnitt „Warenkunde“ nicht gefunden)');
    expect(md).toContain("> – memory_append (leerer content)");
  });

  it("ohne warning-Feld erscheint KEINE ⚠️-Zeile", () => {
    const md = chatToMarkdown([{ role: "assistant", ts: TS, text: "Alles gut." }]);
    expect(md).not.toContain("⚠️");
  });

  it("ein Turn mit Commit UND Warnung zeigt beide Zeilen (Teilerfolg ehrlich abgebildet)", () => {
    const md = chatToMarkdown([
      {
        role: "assistant", ts: TS, text: "Teilweise erledigt.", commit: "Warenkunde bereinigt",
        warning: "⚠️ Nicht angewendet: memory_append (leerer content)",
      },
    ]);
    expect(md).toContain("> 💾 Ins Notizbuch übernommen: „Warenkunde bereinigt“");
    expect(md).toContain("> ⚠️ Nicht angewendet: memory_append (leerer content)");
  });

  it("entfernt Nullbytes auch aus der ⚠️-Warnung", () => {
    // String.fromCharCode(0) statt eines Escape-Literals (Konvention wie
    // memory.js#NUL) - vermeidet jedes Risiko, dass ein rohes Steuerzeichen
    // im Quelltext selbst landet.
    const NUL = String.fromCharCode(0);
    const md = chatToMarkdown([
      { role: "assistant", ts: TS, text: "x", warning: "Nicht angewendet: delete_section „B" + NUL + "se“ (...)" },
    ]);
    expect(md).not.toContain(NUL);
    expect(md).toContain("Bse");
  });

  it("liefert bei leerem Verlauf nur den Kopf", () => {
    const md = chatToMarkdown([]);
    expect(md).toContain("0 Nachrichten");
    expect(md).not.toContain("---");
  });

  it("reicht Roh-Markdown/HTML im Nachrichtentext unverändert durch (bewusster Kontrakt)", () => {
    const md = chatToMarkdown([
      { role: "user", ts: TS, text: "Zeile 1\n\n---\n\n<img src=x onerror=alert(1)>" },
    ]);
    expect(md).toContain("<img src=x onerror=alert(1)>");
    // das eigenständige --- des Nutzers bleibt zusätzlich zum Trenner erhalten
    expect((md.match(/^---$/gm) || []).length).toBe(2);
  });

  it("nummeriert auch literale Fußnoten-Links im Nachrichtentext archivweit um (Kontrakt)", () => {
    const md = chatToMarkdown([
      { role: "user", ts: TS, text: "Siehe [7](https://alt.example/) dazu." },
    ]);
    expect(md).toContain("[1](https://alt.example/)");
    expect(md).not.toContain("[7](");
  });

  it("lässt Bild-Links bei gleichzeitiger Umnummerierung unangetastet", () => {
    const md = chatToMarkdown(
      [
        { role: "user", ts: TS, imgId: "img-9", text: "Bild dazu" },
        {
          role: "assistant", ts: TS + 1,
          sources: [{ url: "https://example.org/q", title: "Q" }],
          text: 'Fakt <cite index="1">belegt</cite>.',
        },
      ],
      { resolveImg: () => "bilder/img-9.png" }
    );
    expect(md).toContain("![Bild](../bilder/img-9.png)");
    expect(md).toContain("[1](https://example.org/q)");
  });

  it("Quellen-Liste: rein numerischer Titel überlebt die Umnummerierung, Klammern werden escaped", () => {
    const md = chatToMarkdown([
      {
        role: "assistant", ts: TS, text: "Ohne Marker.",
        sources: [
          { url: "https://a.example/", title: "2024" },
          { url: "https://b.example/", title: "Titel [mit] Klammern" },
        ],
      },
      // zweite Nachricht MIT Marker, damit die Umnummerierung wirklich läuft
      {
        role: "assistant", ts: TS + 1,
        sources: [{ url: "https://c.example/", title: "C" }],
        text: 'Fakt <cite index="1">x</cite>.',
      },
    ]);
    expect(md).toContain("- [2024](https://a.example/)");
    expect(md).toContain("- [Titel \\[mit\\] Klammern](https://b.example/)");
    expect(md).toContain("[1](https://c.example/)");
  });

  it("v7.7: ein Fenced-Codeblock im Nachrichtentext bleibt byte-identisch erhalten (kein Verschlucken der Zäune, keine Umnummerierung darin)", () => {
    const md = chatToMarkdown([
      {
        role: "user", ts: TS,
        text: "Snippet:\n\n```bash\nfind . -name \"*.tmp\" -exec rm {} \\;\n```\n\nSiehe [7](https://alt.example/) dazu.",
      },
    ]);
    expect(md).toContain('```bash\nfind . -name "*.tmp" -exec rm {} \\;\n```');
    // Die echte Fußnote AUSSERHALB des Codeblocks wird trotzdem umnummeriert.
    expect(md).toContain("[1](https://alt.example/)");
    expect(md).not.toContain("[7](");
  });

  it("entfernt Nullbytes aus Nachrichtentexten (kein Einschleusen von SRC-Platzhaltern)", () => {
    const md = chatToMarkdown([
      {
        role: "user", ts: TS,
        text: "Böse \u0000SRC0\u0000 Injektion",
      },
      {
        role: "assistant", ts: TS + 1, text: "Ohne Marker.",
        sources: [{ url: "https://echt.example/", title: "Echt" }],
      },
    ]);
    expect(md).toContain("Böse SRC0 Injektion");
    expect(md).not.toContain("\u0000");
    expect((md.match(/Quellen:/g) || []).length).toBe(1);
  });
});

describe("mergeChats", () => {
  const A = { role: "user", ts: 100, text: "von Gerät A" };
  const B = { role: "assistant", ts: 200, text: "von Gerät B" };

  it("vereint lokale und Remote-Nachrichten chronologisch und ohne Duplikate", () => {
    const merged = mergeChats([A, B], [B, { role: "user", ts: 150, text: "nur remote" }]);
    expect(merged.map((m) => m.ts)).toEqual([100, 150, 200]);
    expect(merged.filter((m) => m.text === "von Gerät B").length).toBe(1);
  });

  it("unterscheidet gleiche Zeitstempel mit unterschiedlichem Inhalt", () => {
    const merged = mergeChats(
      [{ role: "user", ts: 100, text: "eins" }],
      [{ role: "user", ts: 100, text: "zwei" }]
    );
    expect(merged.length).toBe(2);
  });

  it("lässt Nachrichten ohne Zeitstempel (Begrüßung) weg und verträgt kaputte Eingaben", () => {
    const merged = mergeChats(
      [{ role: "assistant", ts: 0, text: "Hallo!" }, A],
      null
    );
    expect(merged).toEqual([A]);
  });
});
