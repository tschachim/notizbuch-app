import { describe, it, expect } from "vitest";
import {
  pathToFileUrl, fileUrlToWinPath, linkifyFilePaths, FILE_URL_RE, buildProtocolUrl,
} from "../src/lib/filelinks.js";

describe("pathToFileUrl", () => {
  it("wandelt einen einfachen Laufwerks-Pfad um", () => {
    expect(pathToFileUrl("C:\\Users\\x\\Bericht.docx")).toBe("file:///C:/Users/x/Bericht.docx");
  });

  it("kodiert Leerzeichen im Pfad", () => {
    expect(pathToFileUrl("C:\\Users\\x\\Mein Bericht.docx")).toBe(
      "file:///C:/Users/x/Mein%20Bericht.docx"
    );
  });

  it("kodiert Umlaute", () => {
    expect(pathToFileUrl("C:\\Users\\x\\Übersicht.docx")).toBe(
      "file:///C:/Users/x/%C3%9Cbersicht.docx"
    );
  });

  it("kodiert '#', '%' und '?' im Dateinamen", () => {
    expect(pathToFileUrl("C:\\Users\\x\\Fr#age%wert?.txt")).toBe(
      "file:///C:/Users/x/Fr%23age%25wert%3F.txt"
    );
  });

  it("wandelt einen UNC-Pfad um", () => {
    expect(pathToFileUrl("\\\\server\\share\\datei.md")).toBe("file://server/share/datei.md");
  });

  it("wandelt einen UNC-Pfad mit Leerzeichen im Freigabenamen um", () => {
    expect(pathToFileUrl("\\\\server\\Freigabe Ordner\\datei.md")).toBe(
      "file://server/Freigabe%20Ordner/datei.md"
    );
  });

  it("akzeptiert bereits vorwärts-geschrägte Pfade (C:/...)", () => {
    expect(pathToFileUrl("C:/Users/x/Bericht.docx")).toBe("file:///C:/Users/x/Bericht.docx");
  });

  it("ein reiner Laufwerks-Wurzelpfad bleibt ohne weiteren Inhalt", () => {
    expect(pathToFileUrl("C:\\")).toBe("file:///C:/");
  });

  it("liefert null für einen relativen Pfad", () => {
    expect(pathToFileUrl("Unterordner\\datei.txt")).toBeNull();
    expect(pathToFileUrl("datei.txt")).toBeNull();
  });

  it("liefert null für eine leere/nur-Whitespace-Eingabe", () => {
    expect(pathToFileUrl("")).toBeNull();
    expect(pathToFileUrl("   ")).toBeNull();
  });

  // Review-Fix 🟡 Finding 2 (Idempotenz-Bruch bei unbalancierten Klammern,
  // vor dem Commit gemeldet): "(" und ")" werden zusätzlich zu
  // encodeURIComponent explizit zu "%28"/"%29" kodiert (encSeg) – ein roher
  // "(" hätte PROTECTED_SPAN_RE (siehe linkifyFilePaths-Tests unten) beim
  // zweiten Lauf daran gehindert, den bereits erzeugten Link korrekt als
  // geschützte Spanne zu erkennen (Doppel-Wrap).
  it("kodiert runde Klammern im Dateinamen zu %28/%29 (Windows-Kopie-Konvention, Idempotenz-Fix)", () => {
    expect(pathToFileUrl("C:\\Users\\x\\Kopie (1).docx")).toBe(
      "file:///C:/Users/x/Kopie%20%281%29.docx"
    );
  });

  it("kodiert eine UNBALANCIERTE Klammer im Dateinamen ebenfalls (der eigentliche Regressionsfall)", () => {
    expect(pathToFileUrl("C:\\x\\a(b.docx")).toBe("file:///C:/x/a%28b.docx");
  });
});

describe("fileUrlToWinPath", () => {
  it("ist die Umkehrung von pathToFileUrl (Laufwerksbuchstabe)", () => {
    expect(fileUrlToWinPath("file:///C:/Users/x/Mein%20Bericht.docx")).toBe(
      "C:\\Users\\x\\Mein Bericht.docx"
    );
  });

  it("dekodiert Umlaute zurück", () => {
    expect(fileUrlToWinPath("file:///C:/Users/x/%C3%9Cbersicht.docx")).toBe(
      "C:\\Users\\x\\Übersicht.docx"
    );
  });

  it("ist die Umkehrung von pathToFileUrl (UNC)", () => {
    expect(fileUrlToWinPath("file://server/share/datei.md")).toBe("\\\\server\\share\\datei.md");
  });

  it("dekodiert Leerzeichen im UNC-Freigabenamen zurück", () => {
    expect(fileUrlToWinPath("file://server/Freigabe%20Ordner/datei.md")).toBe(
      "\\\\server\\Freigabe Ordner\\datei.md"
    );
  });

  it("dekodiert kodierte Klammern zurück (Umkehrung des Finding-2-Fixes)", () => {
    expect(fileUrlToWinPath("file:///C:/Users/x/Kopie%20%281%29.docx")).toBe(
      "C:\\Users\\x\\Kopie (1).docx"
    );
  });

  it("liefert den reinen Laufwerksbuchstaben bei einer Wurzel-URL", () => {
    expect(fileUrlToWinPath("file:///C:/")).toBe("C:\\");
  });

  it("wirft NICHT bei einer kaputten %-Sequenz, sondern lässt sie stehen", () => {
    expect(fileUrlToWinPath("file:///C:/Users/x/kaputt%2.txt")).toBe("C:\\Users\\x\\kaputt%2.txt");
  });

  it("liefert die rohe Eingabe unverändert zurück, wenn sie keiner der beiden Formen entspricht", () => {
    expect(fileUrlToWinPath("https://example.org/a")).toBe("https://example.org/a");
    expect(fileUrlToWinPath("")).toBe("");
  });
});

// v7.35: buildProtocolUrl baut aus einer file:-URL die Kontrakt-URL für den
// lokalen Handler (tools/notizbuch-open-handler.ps1) – siehe Kopfkommentar
// dort für den vollständigen Kontrakt/Bedrohungsmodell. Die Tests spiegeln
// die -Validate-Probe-Aufrufe aus dem Abschlussbericht (Roundtrip-Fälle).
describe("buildProtocolUrl", () => {
  it("baut die Kontrakt-URL aus dem Beispiel im Auftrag (Backslash-Encoding)", () => {
    expect(buildProtocolUrl("file:///C:/Users/x/Mein%20Bericht.docx")).toBe(
      "notizbuch-open:v1?path=C%3A%5CUsers%5Cx%5CMein%20Bericht.docx"
    );
  });

  it("kodiert Umlaute im Pfad korrekt (UTF-8-Prozent-Encoding)", () => {
    expect(buildProtocolUrl("file:///C:/Users/x/%C3%9Cbersicht.docx")).toBe(
      "notizbuch-open:v1?path=" + encodeURIComponent("C:\\Users\\x\\Übersicht.docx")
    );
    // Explizit ausgeschrieben, damit ein künftiger Encoding-Regressionsfehler
    // nicht durch einen zirkulären Vergleich (encodeURIComponent gegen sich
    // selbst) verdeckt wird:
    expect(buildProtocolUrl("file:///C:/Users/x/%C3%9Cbersicht.docx")).toBe(
      "notizbuch-open:v1?path=C%3A%5CUsers%5Cx%5C%C3%9Cbersicht.docx"
    );
  });

  it("kodiert '#' und '%' im Dateinamen", () => {
    expect(buildProtocolUrl("file:///C:/Users/x/Fr%23age%25wert.txt")).toBe(
      "notizbuch-open:v1?path=C%3A%5CUsers%5Cx%5CFr%23age%25wert.txt"
    );
  });

  it("liefert null für ein UNC-Ziel (Handler lehnt UNC grundsätzlich ab)", () => {
    expect(buildProtocolUrl("file://server/share/datei.md")).toBeNull();
    expect(buildProtocolUrl("file://server/Freigabe%20Ordner/datei.md")).toBeNull();
  });

  it("liefert null für eine fremde/nicht erkannte URL (http/https, kein file:-Ziel)", () => {
    expect(buildProtocolUrl("https://example.org/a")).toBeNull();
  });

  it("liefert null für eine leere Eingabe", () => {
    expect(buildProtocolUrl("")).toBeNull();
  });

  // Roundtrip zum Handler-Format: [Uri]::UnescapeDataString (PowerShell,
  // siehe tools/notizbuch-open-handler.ps1) entspricht funktional
  // decodeURIComponent – der Handler muss aus dem "path="-Teil GENAU den
  // ursprünglichen Backslash-Pfad zurückgewinnen.
  it("ist per decodeURIComponent zum ursprünglichen Backslash-Pfad umkehrbar (Roundtrip zum Handler-Kontrakt)", () => {
    const winPath = "C:\\Users\\Max Mustermann\\Kopie (1) - Bericht #3 100%.docx";
    const url = buildProtocolUrl(pathToFileUrl(winPath));
    expect(url.startsWith("notizbuch-open:v1?path=")).toBe(true);
    const encoded = url.slice("notizbuch-open:v1?path=".length);
    expect(decodeURIComponent(encoded)).toBe(winPath);
  });

  it("kodiert einen Pfad mit runden Klammern (keine zusätzliche %28/%29-Sonderbehandlung wie bei pathToFileUrl nötig)", () => {
    // Anders als pathToFileUrl (encSeg, siehe dort) baut buildProtocolUrl
    // KEINE Markdown-Link-Syntax, in der eine rohe Klammer eine spätere
    // Regex-Erkennung stören könnte – encodeURIComponent lässt "(" / ")"
    // deshalb bewusst UNVERÄNDERT (Standardverhalten), der Handler dekodiert
    // trotzdem korrekt zurück (siehe Roundtrip-Test oben).
    expect(buildProtocolUrl("file:///C:/x/Kopie%20%281%29.docx")).toBe(
      "notizbuch-open:v1?path=" + encodeURIComponent("C:\\x\\Kopie (1).docx")
    );
  });
});

describe("FILE_URL_RE", () => {
  it("matcht eine Laufwerks-URL und eine UNC-URL", () => {
    expect(FILE_URL_RE.test("file:///C:/Users/x/a.txt")).toBe(true);
    expect(FILE_URL_RE.test("file://server/share/a.txt")).toBe(true);
  });

  it("matcht KEIN javascript:/data:-Schema und keine file://-URL ohne Laufwerksbuchstaben-Slash", () => {
    expect(FILE_URL_RE.test("javascript:alert(1)")).toBe(false);
    expect(FILE_URL_RE.test("data:text/html,x")).toBe(false);
    expect(new RegExp("^" + FILE_URL_RE.source + "$").test("file://C:/a.txt")).toBe(false);
  });

  it("matcht keine file:-URL mit rohem Leerzeichen", () => {
    expect(new RegExp("^" + FILE_URL_RE.source + "$").test("file:///C:/a b.txt")).toBe(false);
  });
});

// Review-Fix (Sicherheits-Review Runde 4): Der Längen-Cap in FILE_URL_SRC
// wirkt auf die bereits PROZENT-KODIERTE URL, nicht auf den rohen Windows-
// Pfad - der alte Kommentar ("MAX_PATH 260, 300 ist reichlich") verglich
// zwei verschiedene Längen-Domänen. Mit Leerzeichen im Pfad (Faktor-3-
// Kodierung, "%20") brach das alte {0,300}-Cap bereits deutlich VOR einem
// vollen MAX_PATH-Pfad (260 Zeichen) ab. Diese Tests pinnen, dass ein
// realistischer MAX_PATH-langer Pfad mit Leerzeichen/Umlauten jetzt (Cap
// 1000) vollständig erkannt wird.
describe("FILE_URL_RE: Längen-Cap deckt einen vollen MAX_PATH-Pfad (Review-Fix Runde 4)", () => {
  // Deterministischer, exakt "rawLen" Zeichen langer Windows-Pfad, aus
  // einem sich wiederholenden Segment mit Leerzeichen aufgebaut (reali-
  // stischer Fall: "Eigene Dateien", "Meine Dokumente Q3" usw.) - repro-
  // duzierbar statt zufällig.
  function buildLongWinPath(rawLen, segment) {
    const prefix = "C:\\Users\\x\\";
    const suffix = ".docx";
    let body = "";
    while (prefix.length + body.length + suffix.length < rawLen) {
      body += segment;
    }
    body = body.slice(0, rawLen - prefix.length - suffix.length);
    return prefix + body + suffix;
  }

  it("ein MAX_PATH-langer Pfad (260 Zeichen) mit vielen Leerzeichen wird als gültige file:-URL erkannt", () => {
    const winPath = buildLongWinPath(260, "Ordner mit Leerzeichen und Text ");
    expect(winPath.length).toBe(260);
    const url = pathToFileUrl(winPath);
    expect(FILE_URL_RE.test(url)).toBe(true);
  });

  it("ein MAX_PATH-langer Pfad (260 Zeichen) mit Umlauten wird als gültige file:-URL erkannt", () => {
    const winPath = buildLongWinPath(260, "Übersicht Änderungen Größe ");
    expect(winPath.length).toBe(260);
    const url = pathToFileUrl(winPath);
    expect(FILE_URL_RE.test(url)).toBe(true);
  });

  it("linkifyFilePaths erkennt eine bereits kodierte, MAX_PATH-lange bare file:-URL im Fließtext (mit Leerzeichen im Ursprungspfad)", () => {
    const winPath = buildLongWinPath(260, "Ordner mit Leerzeichen und Text ");
    const url = pathToFileUrl(winPath);
    const md = "Siehe " + url + " bitte.";
    const result = linkifyFilePaths(md);
    expect(result).not.toBe(md); // wurde tatsächlich verlinkt
    expect(result).toMatch(/^Siehe \[.+\]\(file:\/\/\/C:\/Users\/x\/.+\) bitte\.$/);
  });

  it("ein weit über MAX_PATH hinausgehender Pfad (deutlich > 1000 kodierte Zeichen) matcht als GANZES nicht mehr vollständig (Cap ist endlich, kein Backtracking-Risiko)", () => {
    const winPath = buildLongWinPath(2000, "Ordner mit sehr viel Leerzeichen und langem Text ");
    const url = pathToFileUrl(winPath);
    expect(url.length).toBeGreaterThan(1000); // Kontrolle: die KODIERTE URL überschreitet den Cap tatsächlich
    // FILE_URL_RE ist unverankert (kein "^"/"$") - .test() fände sonst
    // einfach die ERSTEN 1000 Zeichen als gültiges Teilstück und meldete
    // "true", obwohl der Rest der URL gar nicht mehr erfasst ist. Die
    // GANZE-STRING-Variante (wie in den bestehenden Tests oben, z. B.
    // "matcht KEIN javascript:/...") zeigt den Cap-Effekt korrekt.
    const FULL = new RegExp("^" + FILE_URL_RE.source + "$");
    expect(FULL.test(url)).toBe(false);
  });
});

describe("linkifyFilePaths: Inline-Pfad ohne Leerzeichen (Regel c)", () => {
  it("verlinkt einen Laufwerks-Pfad mitten im Satz", () => {
    const md = "Siehe C:\\Users\\x\\Report.docx dazu.";
    expect(linkifyFilePaths(md)).toBe(
      "Siehe [Report](file:///C:/Users/x/Report.docx) dazu."
    );
  });

  it("verlinkt einen UNC-Pfad mitten im Satz", () => {
    const md = "Datei liegt unter \\\\server\\share\\datei.md, siehe dort.";
    expect(linkifyFilePaths(md)).toBe(
      "Datei liegt unter [datei](file://server/share/datei.md), siehe dort."
    );
  });

  it("erkennt einen Pfad mit Vorwärtsslash-Beginn (C:/...)", () => {
    const md = "Pfad: C:/Users/x/Report.docx Ende.";
    expect(linkifyFilePaths(md)).toBe("Pfad: [Report](file:///C:/Users/x/Report.docx) Ende.");
  });

  it("lässt einen Pfad OHNE Datei-Endung inline unangetastet", () => {
    const md = "Ordner ist C:\\Users\\x\\Projekt und fertig.";
    expect(linkifyFilePaths(md)).toBe(md);
  });

  it("lässt einen RELATIVEN Pfad unangetastet (kein Treffer)", () => {
    const md = "Öffne temp\\report.docx im Ordner.";
    expect(linkifyFilePaths(md)).toBe(md);
  });

  it("keine Wortmitte-Treffer: ein Pfad, der direkt an ein Wortzeichen grenzt, bleibt Klartext", () => {
    const md = "seeC:\\Users\\x\\Report.docx ist kein Treffer.";
    expect(linkifyFilePaths(md)).toBe(md);
  });

  it("verlinkt eine nackte file:-URL im Fließtext", () => {
    const md = "Siehe file:///C:/Users/x/Report.docx bitte.";
    expect(linkifyFilePaths(md)).toBe(
      "Siehe [Report](file:///C:/Users/x/Report.docx) bitte."
    );
  });

  // Review-Fix 🟡 Finding 3 (Pflicht, vor dem Commit gemeldet): der Körper
  // der nackten file:-URL-Alternative ist bis zum nächsten Whitespace
  // ungebunden – ein direkt folgendes Satzzeichen landete dadurch als Teil
  // der (kaputten) URL/des Titels. Der Windows-Pfad-Zweig ist davon NICHT
  // betroffen (dessen Endungs-Gruppe ist ohnehin auf Alnum-Zeichen
  // begrenzt), siehe Test "verlinkt einen Laufwerks-Pfad mitten im Satz"
  // oben (dort bereits ein Wort NACH dem Pfad, kein Satzzeichen direkt
  // dahinter – jetzt zusätzlich mit einem Satzzeichen UNMITTELBAR danach).
  it("eine nackte file:-URL mit direkt folgendem Satzpunkt verlinkt NICHT den Punkt mit", () => {
    const md = "Siehe file:///C:/Users/x/Report.docx. Dazu mehr.";
    expect(linkifyFilePaths(md)).toBe(
      "Siehe [Report](file:///C:/Users/x/Report.docx). Dazu mehr."
    );
  });

  it("eine nackte file:-URL mit direkt folgendem Komma verlinkt NICHT das Komma mit", () => {
    const md = "Siehe file:///C:/Users/x/Report.docx, dann weiter.";
    expect(linkifyFilePaths(md)).toBe(
      "Siehe [Report](file:///C:/Users/x/Report.docx), dann weiter."
    );
  });

  it("eine nackte file:-URL am Satzende (mehrere Satzzeichen) verlinkt keines davon mit", () => {
    const md = "Ergebnis siehe file:///C:/x/a.txt!?";
    expect(linkifyFilePaths(md)).toBe("Ergebnis siehe [a](file:///C:/x/a.txt)!?");
  });

  it("verlinkt mehrere unabhängige Pfade im selben Dokument", () => {
    const md = "Erst C:\\a\\Eins.txt, dann C:\\b\\Zwei.pdf.";
    expect(linkifyFilePaths(md)).toBe(
      "Erst [Eins](file:///C:/a/Eins.txt), dann [Zwei](file:///C:/b/Zwei.pdf)."
    );
  });

  it("nutzt bei mehreren Endungen im Namen nur die LETZTE als Datei-Endung", () => {
    const md = "Datei: C:\\a\\Report.final.docx Ende.";
    expect(linkifyFilePaths(md)).toBe("Datei: [Report.final](file:///C:/a/Report.final.docx) Ende.");
  });
});

describe("linkifyFilePaths: Ganze-Zeile-Fall mit Leerzeichen (Regel d)", () => {
  it("verlinkt eine Zeile, die komplett aus einem Pfad MIT Leerzeichen besteht", () => {
    const md = "C:\\Users\\Max Mustermann\\Mein Bericht.docx";
    expect(linkifyFilePaths(md)).toBe(
      "[Mein Bericht](file:///C:/Users/Max%20Mustermann/Mein%20Bericht.docx)"
    );
  });

  it("erhält führenden/nachgestellten Whitespace der Zeile", () => {
    const md = "  C:\\Users\\Max Mustermann\\Mein Bericht.docx  ";
    expect(linkifyFilePaths(md)).toBe(
      "  [Mein Bericht](file:///C:/Users/Max%20Mustermann/Mein%20Bericht.docx)  "
    );
  });

  it("funktioniert als eine von mehreren Zeilen eines Dokuments", () => {
    const md = "# Notizbuch\n\n## Abschnitt\n\nC:\\Users\\Max Mustermann\\Mein Bericht.docx\n\nWeiterer Text.";
    expect(linkifyFilePaths(md)).toBe(
      "# Notizbuch\n\n## Abschnitt\n\n[Mein Bericht](file:///C:/Users/Max%20Mustermann/Mein%20Bericht.docx)\n\nWeiterer Text."
    );
  });

  it("eine Zeile, die NUR TEILWEISE ein Pfad ist (Text davor/danach), löst NICHT den Ganze-Zeile-Fall aus", () => {
    // Kein Treffer, weil der Pfad Leerzeichen enthält und NICHT die ganze
    // Zeile ausmacht – die Inline-Regel (ohne Leerzeichen) greift hier nicht.
    const md = "Bericht liegt unter C:\\Users\\Max Mustermann\\Bericht.docx sicher.";
    expect(linkifyFilePaths(md)).toBe(md);
  });
});

// Review-Fix 🔴 Finding 1 (Pflicht, vor dem Commit gemeldet): der
// Ganze-Zeile-Fall (Regel d) erlaubt Leerzeichen im Pfad-Körper – ohne
// Prosa-Schutz verschluckt/verschmilzt er komplette Sätze, die zufällig mit
// einem Pfad beginnen und mit etwas Endungs-Artigem enden. Drei Guards in
// linkifyWholeLine (siehe dort): (a) zweiter Pfad-Start nach Whitespace,
// (b) Endungs-artige Sequenz VOR Zeilenende mit folgendem Text, (c)
// Wortzahl-Obergrenze je Segment (WORDS_PER_SEGMENT_CAP) – (a)/(b) allein
// reichen NICHT für jeden Fall (siehe zweiter Testfall unten, empirisch
// verifiziert), (c) schließt die Lücke.
describe("linkifyFilePaths: Prosa-Schutz im Ganze-Zeile-Fall (Review-Fix 🔴 Finding 1)", () => {
  it("zwei Pfade in einer Zeile verschmelzen NICHT zu einem kaputten Link – jeder Pfad wird stattdessen EINZELN (inline) korrekt verlinkt", () => {
    const md = "C:\\a\\Eins.txt, dann C:\\b\\Zwei.pdf";
    const out = linkifyFilePaths(md);
    expect(out).toBe("[Eins](file:///C:/a/Eins.txt), dann [Zwei](file:///C:/b/Zwei.pdf)");
    // Insbesondere NICHT der ursprüngliche Bug: ein einzelner Link über die
    // GESAMTE Zeile mit Komma/"dann" mitten in der (kaputten) URL.
    expect(out).not.toMatch(/\[Eins\]\(file:\/\/\/C:\/a\/Eins\.txt, dann/);
  });

  it("eine komplette Prosa-Zeile OHNE zweiten Pfad-Start und OHNE Endung mitten im Satz bleibt trotzdem Klartext (Guard c, Wortzahl-Obergrenze)", () => {
    // Empirisch verifiziert: weder Guard (a) noch Guard (b) greifen hier
    // (kein zweiter "X:\"/UNC-Start, die einzige Endung ".docx" steht
    // korrekt am Zeilenende) – ohne Guard (c) würde die GESAMTE Zeile
    // fälschlich zu einem einzigen, falschen Link.
    const md = "C:\\temp ist der Ordner fuer report.docx";
    expect(linkifyFilePaths(md)).toBe(md);
  });

  it("ein Pfad gefolgt von Prosa, die zufällig eine zweite '.xxx'-Sequenz enthält, verlinkt NUR den echten Pfad – der Rest bleibt Prosa (Guard b)", () => {
    const md = "C:\\Users\\x\\Report.docx enthaelt die Zahlen zu plan.xlsx";
    expect(linkifyFilePaths(md)).toBe(
      "[Report](file:///C:/Users/x/Report.docx) enthaelt die Zahlen zu plan.xlsx"
    );
  });

  it("ein legitimer, aber sehr wortreicher Dateiname (> WORDS_PER_SEGMENT_CAP Wörter in einem Segment) bleibt bewusst Klartext (dokumentierte Heuristik-Grenze)", () => {
    const md = "C:\\a\\Bericht mit sehr vielen Wörtern im Dateinamen version zwei.docx";
    expect(linkifyFilePaths(md)).toBe(md);
  });

  it("die bestehende, unkritische Ganze-Zeile-Erkennung (kurze Segmente) bleibt weiterhin funktionsfähig (Regressionsschutz für den Fix selbst)", () => {
    const md = "C:\\Users\\Max Mustermann\\Mein Bericht.docx";
    expect(linkifyFilePaths(md)).toBe(
      "[Mein Bericht](file:///C:/Users/Max%20Mustermann/Mein%20Bericht.docx)"
    );
  });
});

describe("linkifyFilePaths: Fence/Codespan/Bestehender-Link-Ausnahmen (Regel a/b)", () => {
  it("lässt einen Pfad INNERHALB eines Fenced-Codeblocks unangetastet", () => {
    const md = "Text davor.\n\n```\nC:\\Users\\x\\Report.docx\n```\n\nText danach.";
    expect(linkifyFilePaths(md)).toBe(md);
  });

  it("lässt einen Pfad INNERHALB eines Codespans unangetastet", () => {
    const md = "Siehe `C:\\Users\\x\\Report.docx` im Code.";
    expect(linkifyFilePaths(md)).toBe(md);
  });

  it("verlinkt einen Pfad AUSSERHALB, lässt denselben Pfad IM Codespan aber unangetastet", () => {
    const md = "C:\\a\\Report.docx und `C:\\a\\Report.docx` im selben Satz.";
    expect(linkifyFilePaths(md)).toBe(
      "[Report](file:///C:/a/Report.docx) und `C:\\a\\Report.docx` im selben Satz."
    );
  });

  it("fasst einen bestehenden [Titel](url)-Link nicht doppelt an", () => {
    const md = "Siehe [Bericht](https://example.org/a) dazu.";
    expect(linkifyFilePaths(md)).toBe(md);
  });

  it("fasst einen bestehenden file:-Link nicht doppelt an (kein erneutes Wrapping)", () => {
    const md = "Siehe [Report](file:///C:/Users/x/Report.docx) dazu.";
    expect(linkifyFilePaths(md)).toBe(md);
  });

  it("fasst ein bestehendes Bild ![Alt](url) nicht an", () => {
    const md = "![C:\\a\\Report.docx](img:ab12cd)";
    expect(linkifyFilePaths(md)).toBe(md);
  });

  it("verändert nur den Pfad AUSSERHALB eines bestehenden Links, nicht die URL DARIN", () => {
    const md = "[Titel](https://example.org/a) und C:\\a\\Report.docx separat.";
    expect(linkifyFilePaths(md)).toBe(
      "[Titel](https://example.org/a) und [Report](file:///C:/a/Report.docx) separat."
    );
  });
});

describe("linkifyFilePaths: Idempotenz (Regel e)", () => {
  it("ein zweiter Lauf über das bereits verlinkte Ergebnis ändert nichts (Inline-Fall)", () => {
    const once = linkifyFilePaths("Siehe C:\\Users\\x\\Report.docx dazu.");
    const twice = linkifyFilePaths(once);
    expect(twice).toBe(once);
  });

  it("ein zweiter Lauf über das bereits verlinkte Ergebnis ändert nichts (Ganze-Zeile-Fall)", () => {
    const once = linkifyFilePaths("C:\\Users\\Max Mustermann\\Mein Bericht.docx");
    const twice = linkifyFilePaths(once);
    expect(twice).toBe(once);
  });

  it("ein komplettes Dokument mit gemischten Fällen bleibt nach zwei Läufen stabil", () => {
    const md =
      "# T\n\n## A\n\nC:\\a\\Eins.txt mitten im Text.\n\nC:\\Users\\Max Mustermann\\Ganze Zeile.docx\n\n" +
      "`C:\\code\\Beispiel.txt` bleibt Code.\n\n```\nC:\\fence\\Beispiel.txt\n```\n";
    const once = linkifyFilePaths(md);
    const twice = linkifyFilePaths(once);
    expect(twice).toBe(once);
  });

  // Review-Fix 🟡 Finding 2 (Pflicht, vor dem Commit gemeldet): eine
  // UNBALANCIERTE Klammer im Dateinamen ließ PROTECTED_SPAN_RE den bereits
  // erzeugten Link beim zweiten Lauf NICHT mehr als geschützte Spanne
  // erkennen (die Regex fand stattdessen die schließende Wrapper-Klammer als
  // vermeintlichen Partner der Datei-Klammer) – der Link wurde ein zweites
  // Mal verlinkt (Doppel-Wrap). Mit dem encSeg-Fix (pathToFileUrl, "(" ->
  // "%28") kommt eine rohe Klammer in einer selbst erzeugten URL nicht mehr
  // vor, der Regressionsfall bleibt jetzt idempotent.
  it("eine unbalancierte Klammer im Dateinamen bleibt über ZWEI Läufe stabil (kein Doppel-Wrap)", () => {
    const md = "Siehe C:\\x\\a(b.docx dazu.";
    const once = linkifyFilePaths(md);
    expect(once).toBe("Siehe [a(b](file:///C:/x/a%28b.docx) dazu.");
    const twice = linkifyFilePaths(once);
    expect(twice).toBe(once);
  });
});

describe("linkifyFilePaths: unveränderte Fälle ohne jeden Pfad", () => {
  it("ein Dokument ganz ohne Pfad/file:-URL bleibt byte-identisch", () => {
    const md = "# T\n\n## A\n\nGanz normaler Text ohne jeden Pfad.";
    expect(linkifyFilePaths(md)).toBe(md);
  });

  it("eine leere Eingabe liefert eine leere Zeichenkette", () => {
    expect(linkifyFilePaths("")).toBe("");
  });
});
