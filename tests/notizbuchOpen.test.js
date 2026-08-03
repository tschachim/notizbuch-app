import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { validateProtocolUrl, ALLOWED_EXTENSIONS, shortenPath } from "../tools/notizbuch-open.js";

// GROSSER GEWINN gegenueber dem bisherigen PowerShell-Handler (Auftrag):
// validateProtocolUrl() hat KEINE Seiteneffekte und ist deshalb direkt aus
// Vitest testbar. Die MEHRHEIT der Tests hier nutzt bewusst ECHTE
// Temp-Dateien/-Ordner (kein fs-Mock) - genau die Kanonisierungs-
// Eigenheiten von Windows (8.3-Kurznamen, Gross-/Kleinschreibung,
// Existenzpruefung) sind ECHTES Betriebssystemverhalten, das ein Mock
// unbemerkt falsch nachbilden koennte (siehe Kopfkommentar von
// notizbuch-open.js, Abschnitt "8.3-KURZNAMEN", fuer den empirischen
// Beleg, der genau DESHALB mit einer echten Datei gefuehrt wurde). Das
// injizierbare deps-Interface (siehe validateProtocolUrl) wird NUR fuer
// die grosse Anzahl-Endungen-Matrix (schneller, kein Dateisystem-Grind
// fuer >80 Dateien) sowie fuer die beiden Fehlerpfad-Tests genutzt, die
// mit echten Dateien praktisch nicht ausloesbar sind.
const PREFIX = "notizbuch-open:v1?path=";
function urlFor(winPath) {
  return PREFIX + encodeURIComponent(winPath);
}

let tmpDir;

beforeAll(() => {
  // Eigener Unterordner in os.tmpdir() - real auf der Platte, wird am Ende
  // wieder vollstaendig entfernt (siehe afterAll).
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "notizbuch-open-test-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (junctionDir) {
    fs.rmSync(junctionDir, { recursive: true, force: true });
  }
});

function writeTempFile(name, content = "x") {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content);
  return p;
}

// ---------------------------------------------------------------------
// Junction-Infrastruktur (Review-Fund 🟡1/🟡2, VOR dem Commit gemeldet):
// "mklink /J" erzeugt eine NTFS-Verzeichnis-Junction OHNE Adminrechte
// (anders als ein echter Symlink) - das macht sie zum idealen, DETER-
// MINISTISCHEN Ersatz fuer den 8.3-Kurzname-Integrationstest weiter
// unten, der sich auf vielen Firmen-Volumes (8.3-Generierung dort haeufig
// deaktiviert) still selbst uebersprang und damit VACUOUSLY GREEN laufen
// konnte, OHNE die zentrale Eigenschaft "Struktur/Endung kommen vom
// KANONISCHEN, aufgeloesten Pfad, nicht vom rohen Alias" tatsaechlich zu
// pruefen. Junctions sind dagegen NICHT von einer Volume-Einstellung
// abhaengig - funktionieren also auf praktisch jedem NTFS-Windows-System.
//
// Die Einrichtung laeuft BEWUSST auf MODUL-EBENE (synchron, VOR jedem
// describe/it) statt in beforeAll(): "it.skipIf(...)" wertet seine
// Bedingung bereits zur COLLECTION-Zeit aus (bevor beforeAll ueberhaupt
// laeuft) - waere junctionAvailable erst in einem beforeAll gesetzt,
// haette skipIf immer den (falschen) Ausgangswert gesehen.
//
// "Test muss LAUT fehlschlagen oder explizit als skipped markiert sein,
// nicht still durchrutschen" (Auftrag): Schlaegt die Junction-Erstellung
// fehl (z. B. weil "Erstellen symbolischer Verknuepfungen" per
// Gruppenrichtlinie eingeschraenkt ist - selten, aber moeglich), werden
// die betroffenen Tests unten ueber "it.skipIf(!junctionAvailable)"
// EXPLIZIT als "skipped" im Testbericht gefuehrt (sichtbar UNTERSCHIEDEN
// von "passed", siehe Vitest-Ausgabe) statt einfach zu bestehen - PLUS
// eine console.warn-Zeile zur sofortigen Sichtbarkeit beim Testlauf.
let junctionAvailable = false;
let junctionDir;
let clsidAliasFile; // Alias-Datei OHNE ".{" im Pfad, Ziel-Segment TRAEGT ".{...}"
let plainAliasExeFile; // Alias auf eine .exe-Zieldatei (verbotene Endung)
let plainAliasTxtFile; // Alias auf eine .txt-Zieldatei (erlaubte Endung) im SELBEN Zielordner
let plainAliasTargetDir; // der aufgeloeste, kanonische Zielordner (fuer Pfad-Assertions)

function createJunction(alias, target) {
  // "mklink /J" ist ein cmd.exe-BORDMITTEL, hier NUR im TEST zur
  // Einrichtung verwendet (kein Bezug zur eigentlichen Handler-Logik in
  // notizbuch-open.js, die bewusst OHNE cmd.exe/Shell arbeitet, siehe
  // dortiger Kopfkommentar "WARUM explorer.exe").
  execFileSync("cmd.exe", ["/c", "mklink", "/J", alias, target], { stdio: "pipe" });
}

try {
  junctionDir = fs.mkdtempSync(path.join(os.tmpdir(), "notizbuch-open-junction-"));

  const clsidTarget = path.join(junctionDir, "ZielClsid.{21EC2020-3AEA-1069-A2DD-08002B30309D}");
  fs.mkdirSync(clsidTarget);
  fs.writeFileSync(path.join(clsidTarget, "erlaubt.txt"), "x");
  const clsidAlias = path.join(junctionDir, "AliasOhneClsidImNamen");
  createJunction(clsidAlias, clsidTarget);
  clsidAliasFile = path.join(clsidAlias, "erlaubt.txt");

  plainAliasTargetDir = path.join(junctionDir, "ZielHarmlos");
  fs.mkdirSync(plainAliasTargetDir);
  fs.writeFileSync(path.join(plainAliasTargetDir, "ziel.exe"), "x");
  fs.writeFileSync(path.join(plainAliasTargetDir, "ziel.txt"), "x");
  const plainAlias = path.join(junctionDir, "AliasHarmlos");
  createJunction(plainAlias, plainAliasTargetDir);
  plainAliasExeFile = path.join(plainAlias, "ziel.exe");
  plainAliasTxtFile = path.join(plainAlias, "ziel.txt");

  junctionAvailable = true;
} catch (e) {
  junctionAvailable = false;
  console.warn(
    "[notizbuchOpen.test.js] Junction-Erstellung fehlgeschlagen - Junction-basierte Tests werden als 'skipped' markiert, NICHT still uebersprungen. Fehler: " +
      (e && e.message)
  );
}

describe("validateProtocolUrl: Praefix/Kontrakt", () => {
  it("leeres Argument -> PrefixMismatch", () => {
    const result = validateProtocolUrl("");
    expect(result.status).toBe("PrefixMismatch");
  });

  it("null/undefined -> PrefixMismatch (kein Crash)", () => {
    expect(validateProtocolUrl(null).status).toBe("PrefixMismatch");
    expect(validateProtocolUrl(undefined).status).toBe("PrefixMismatch");
  });

  it("komplett andere URL (kein Notizbuch-Link) -> PrefixMismatch", () => {
    const result = validateProtocolUrl("https://example.com/evil");
    expect(result.status).toBe("PrefixMismatch");
  });

  it("Praefix fehlt nur das '='  -> PrefixMismatch", () => {
    const result = validateProtocolUrl("notizbuch-open:v1?path");
    expect(result.status).toBe("PrefixMismatch");
  });

  it("Praefix in ABWEICHENDER Gross-/Kleinschreibung wird TROTZDEM akzeptiert (RFC 3986: URL-Schemas sind nicht case-sensitiv)", () => {
    const p = writeTempFile("Case.txt");
    const url = "Notizbuch-Open:V1?path=" + encodeURIComponent(p);
    const result = validateProtocolUrl(url);
    expect(result.status).toBe("Ok");
  });

  it("EIN angehaengter Trailing-Slash wird toleriert (Chrome haengt bei Custom-Schemes ohne '//' einen '/' an)", () => {
    const p = writeTempFile("TrailingSlash.txt");
    const result = validateProtocolUrl(urlFor(p) + "/");
    expect(result.status).toBe("Ok");
    expect(result.path).toBe(p);
  });

  it("ZWEI angehaengte Trailing-Slashes (kein realistischer Browser-Fall - Chrome haengt nachweislich nur GENAU EINEN an): nur EINER wird algorithmisch abgeschnitten, der verbleibende landet im dekodierten Pfad - bleibt hier bewusst 'Ok', DOKUMENTIERTER Unterschied zum fruegeren PowerShell-Handler (siehe unten)", () => {
    // ECHTER, per Test GEFUNDENER Unterschied ggue. dem fruegeren
    // PowerShell-Handler (dort per -Validate bestaetigt: derselbe Fall
    // lieferte "Reject: Pfad/Datei existiert nicht", weil PowerShells
    // Test-Path einen trailing "/" auf einem DATEI-Pfad NICHT toleriert).
    // Node/Windows sind an dieser Stelle LAXER: fs.existsSync() UND
    // fs.realpathSync.native() ignorieren einen ueberzaehligen trailing
    // "/" auf einer bereits existierenden Datei und loesen trotzdem
    // korrekt zur SELBEN, bereits validierten Datei auf. SICHERHEITS-
    // EINSCHAETZUNG (bewusst NICHT als Bug behandelt/gefixt): kein neuer
    // Bypass, weil (a) dieser Fall nur bei ZWEI ODER MEHR trailing
    // Slashes eintritt - weder Chrome (haengt nachweislich GENAU EINEN
    // an) noch buildProtocolUrl (kodiert IMMER vollstaendig, kann selbst
    // nie roh auf "/" enden) erzeugen das je -, und (b) die aufgeloeste
    // Datei exakt DIESELBE bleibt wie ohne den ueberzaehligen Slash -
    // weder Traversal noch Endungs-/ADS-/Namespace-Pruefung werden
    // dadurch umgangen. Siehe DECISIONS.md #79 fuer die vollstaendige
    // Einordnung.
    const p = writeTempFile("DoubleSlash.txt");
    const result = validateProtocolUrl(urlFor(p) + "//");
    expect(result.status).toBe("Ok");
  });
});

describe("validateProtocolUrl: Dekodierung", () => {
  it("kaputte %-Sequenz -> Reject (kein Crash)", () => {
    const result = validateProtocolUrl(PREFIX + "%zz");
    expect(result.status).toBe("Reject");
    expect(result.reason).toMatch(/dekodieren/);
  });
});

describe("validateProtocolUrl: Schritt 1 (nur absolute Laufwerkspfade, UNC verboten)", () => {
  it("UNC-Pfad (\\\\server\\share\\...) wird abgelehnt", () => {
    const result = validateProtocolUrl(urlFor("\\\\server\\share\\datei.txt"));
    expect(result.status).toBe("Reject");
    expect(result.reason).toMatch(/UNC/);
  });

  it("relativer Pfad wird abgelehnt", () => {
    const result = validateProtocolUrl(urlFor("relativ\\datei.txt"));
    expect(result.status).toBe("Reject");
    expect(result.reason).toMatch(/Laufwerkspfad/);
  });

  it("leerer Pfad nach dem Praefix wird abgelehnt", () => {
    const result = validateProtocolUrl(PREFIX);
    expect(result.status).toBe("Reject");
  });

  it("Laufwerksbuchstabe MIT Schraegstrich statt Backslash wird abgelehnt (Kontrakt verlangt Backslash-Form, siehe buildProtocolUrl)", () => {
    const result = validateProtocolUrl(urlFor("C:/Users/x/datei.txt"));
    expect(result.status).toBe("Reject");
  });
});

describe("validateProtocolUrl: Schritt 2 (Traversal / Steuerzeichen / Umgebungsvariablen)", () => {
  it("'..'-Segment mit Backslash wird abgelehnt", () => {
    const result = validateProtocolUrl(urlFor("C:\\Users\\x\\..\\..\\Windows\\evil.txt"));
    expect(result.status).toBe("Reject");
    expect(result.reason).toMatch(/Traversal/);
  });

  it("'..'-Segment mit Schraegstrich (gemischt mit Backslash) wird ebenfalls abgelehnt (Split auf BEIDE Trenner)", () => {
    const result = validateProtocolUrl(urlFor("C:\\Users\\x/../../Windows\\evil.txt"));
    expect(result.status).toBe("Reject");
    expect(result.reason).toMatch(/Traversal/);
  });

  it("Steuerzeichen/Nullbyte im Pfad wird abgelehnt", () => {
    const result = validateProtocolUrl(urlFor("C:\\Users\\x\\datei\u0000.txt"));
    expect(result.status).toBe("Reject");
    expect(result.reason).toMatch(/Steuerzeichen/);
  });

  it("Umgebungsvariablen-Platzhalter %APPDATA% wird abgelehnt", () => {
    const result = validateProtocolUrl(urlFor("C:\\Users\\x\\%APPDATA%\\evil.txt"));
    expect(result.status).toBe("Reject");
    expect(result.reason).toMatch(/Umgebungsvariablen/);
  });

  it("PowerShell-Variablenform $env:APPDATA wird abgelehnt", () => {
    const result = validateProtocolUrl(urlFor("C:\\Users\\x\\$env:APPDATA\\evil.txt"));
    expect(result.status).toBe("Reject");
    expect(result.reason).toMatch(/Umgebungsvariablen/);
  });

  it("$ENV: in ABWEICHENDER Gross-/Kleinschreibung wird ebenfalls abgelehnt (bewusst case-insensitiv geprueft)", () => {
    const result = validateProtocolUrl(urlFor("C:\\Users\\x\\$ENV:APPDATA\\evil.txt"));
    expect(result.status).toBe("Reject");
  });

  it("EIN legitimer Dateiname mit ZWEI Prozentzeichen wird NICHT als Umgebungsvariable fehlinterpretiert (Regression, siehe DECISIONS #79)", () => {
    const p = writeTempFile("50% Rabatt 100%.txt");
    const result = validateProtocolUrl(urlFor(p));
    expect(result.status).toBe("Ok");
  });
});

describe("validateProtocolUrl: Schritt 2b (Kanonisierungs-/Namespace-Tricks)", () => {
  it("Pfad endet auf Leerzeichen -> Reject", () => {
    const result = validateProtocolUrl(urlFor("C:\\Users\\x\\datei.txt "));
    expect(result.status).toBe("Reject");
    expect(result.reason).toMatch(/Leerzeichen\/Punkt/);
  });

  it("Pfad endet auf Punkt -> Reject", () => {
    const result = validateProtocolUrl(urlFor("C:\\Users\\x\\datei.txt."));
    expect(result.status).toBe("Reject");
    expect(result.reason).toMatch(/Leerzeichen\/Punkt/);
  });

  it("Alternate Data Stream (weiterer ':' nach dem Laufwerks-Praefix) wird abgelehnt", () => {
    const result = validateProtocolUrl(urlFor("C:\\Users\\x\\datei.txt:geheim"));
    expect(result.status).toBe("Reject");
    expect(result.reason).toMatch(/Alternate Data Stream/);
  });

  it("ADS mit dem klassischen '::$DATA'-Suffix wird ebenfalls abgelehnt", () => {
    const result = validateProtocolUrl(urlFor("C:\\Users\\x\\datei.txt::$DATA"));
    expect(result.status).toBe("Reject");
  });

  it("Shell-Namespace-Segment ('.{GUID}', God-Mode-Ordner-Muster) wird abgelehnt", () => {
    const result = validateProtocolUrl(
      urlFor("C:\\Users\\x\\Systemsteuerung.{21EC2020-3AEA-1069-A2DD-08002B30309D}\\evil.txt")
    );
    expect(result.status).toBe("Reject");
    expect(result.reason).toMatch(/Shell-Namespace/);
  });

  it("Shell-Namespace-Muster in einem ZWISCHEN-Segment (nicht dem letzten) wird ebenfalls abgelehnt (alle Segmente werden geprueft)", () => {
    const result = validateProtocolUrl(urlFor("C:\\Users\\x.{GUID}\\Unterordner\\datei.txt"));
    expect(result.status).toBe("Reject");
    expect(result.reason).toMatch(/Shell-Namespace/);
  });
});

describe("validateProtocolUrl: Schritt 3 (Existenz)", () => {
  it("nicht existierender Pfad wird abgelehnt", () => {
    const result = validateProtocolUrl(urlFor(path.join(tmpDir, "existiert-nicht-12345.txt")));
    expect(result.status).toBe("Reject");
    expect(result.reason).toMatch(/existiert nicht/);
  });

  it("ein existierender ORDNER (ohne Endung) wird akzeptiert - Ordner sind strukturell erlaubt", () => {
    const dir = path.join(tmpDir, "Ein Ordner");
    fs.mkdirSync(dir, { recursive: true });
    const result = validateProtocolUrl(urlFor(dir));
    expect(result.status).toBe("Ok");
    expect(result.path).toBe(dir);
  });
});

describe("validateProtocolUrl: Schritt 4 - alle 49 Positivlisten-Endungen werden angenommen", () => {
  it.each(ALLOWED_EXTENSIONS)("'.%s' wird geoeffnet (Ok)", (ext) => {
    const p = writeTempFile(`Positivliste-${ext}.${ext}`);
    const result = validateProtocolUrl(urlFor(p));
    expect(result.status).toBe("Ok");
    expect(result.path.toLowerCase().endsWith("." + ext)).toBe(true);
  });

  it("Endung in GROSSSCHREIBUNG wird ebenfalls akzeptiert (case-insensitiver Abgleich)", () => {
    const p = writeTempFile("Grossschreibung.TXT");
    const result = validateProtocolUrl(urlFor(p));
    expect(result.status).toBe("Ok");
  });

  it("Endung in GEMISCHTER Schreibung (.DoCx) wird ebenfalls akzeptiert", () => {
    const p = writeTempFile("Gemischt.DoCx");
    const result = validateProtocolUrl(urlFor(p));
    expect(result.status).toBe("Ok");
  });
});

// Bekannte gefaehrliche Endungen (Positivlisten-Architektur, DECISIONS.md
// #79): Diese Liste kombiniert ALLE im dortigen 94-Endungen-Probelauf
// NAMENTLICH als "unter der frueheren Sperrliste faelschlich durchgelassen"
// dokumentierten Endungen (py/pyw/rdp/iqy/slk/mam/accde/accdr/diagpkg/
// diagcfg/psc1/pssc/ps1xml/msh/mshxml/cdxml/cer/crt/pfx/p12/p7b/xla/xlam/
// ppam/ppkg/xlsm/xlsb/docm/pptm/img/vhds/avhdx/wim/wsb/job/mst/cab/xnk/
// udl/mht/prf/printerexport/appv/ins/isp/ahk/pl/rb/php/dif/search-ms/
// msrcincident) PLUS die dort nur als "bereits bekannte Faelle wie exe"
// erwaehnte Kategorie klassischer Windows-Ausfuehrungsformate, hier
// explizit ausbuchstabiert (exe/bat/cmd/com/scr/msi/vbs/vbe/js/jse/jar/
// hta/lnk/reg/dll/sys/ps1/msc/chm/application/gadget/ws/wsf/wsc/cpl/msp/
// mde/wsh/scf/url/website/library-ms/searchconnector-ms/theme/
// deskthemepack). Kein Anspruch, BYTE-IDENTISCH mit dem historischen,
// nicht mehr rekonstruierbaren 94er-Rohdatensatz zu sein - aber jede
// einzelne Endung hier ist entweder direkt aus DECISIONS.md #79 zitiert
// oder eine allgemein bekannte gefaehrliche Windows-Endung derselben
// Kategorie (Interpreter/Ausfuehrung/Fernzugriff/Makro/Zertifikat).
//
// deps injiziert statt echter Dateien (bewusste Wahl, siehe
// Kopfkommentar oben): fuer >80 Endungen echte Dateien anzulegen waere
// nur Dateisystem-Overhead ohne zusaetzlichen Erkenntnisgewinn - die
// Positivlisten-PRUEFUNG selbst (Set.has() nach toLowerCase()) haengt
// nicht von echten OS-Aufloesungseigenheiten ab (die sind separat durch
// den 8.3-Kurzname-Test unten mit einer ECHTEN Datei abgedeckt).
const DANGEROUS_EXTENSIONS = [
  // Direkt aus DECISIONS.md #79 (94-Endungen-Probelauf) zitiert:
  "py", "pyw", "rdp", "iqy", "slk", "mam", "accde", "accdr", "diagpkg",
  "diagcfg", "psc1", "pssc", "ps1xml", "msh", "mshxml", "cdxml", "cer",
  "crt", "pfx", "p12", "p7b", "xla", "xlam", "ppam", "ppkg", "xlsm",
  "xlsb", "docm", "pptm", "img", "vhds", "avhdx", "wim", "wsb", "job",
  "mst", "cab", "xnk", "udl", "mht", "prf", "printerexport", "appv",
  "ins", "isp", "ahk", "pl", "rb", "php", "dif", "search-ms",
  "msrcincident",
  // Allgemein bekannte, klassische Windows-Ausfuehrungs-/Skript-/
  // Installationsformate (in DECISIONS.md #79 nur pauschal als "bereits
  // bekannte Faelle wie exe" erwaehnt):
  "exe", "bat", "cmd", "com", "scr", "msi", "vbs", "vbe", "js", "jse",
  "jar", "hta", "lnk", "reg", "dll", "sys", "ps1", "msc", "chm",
  "application", "gadget", "ws", "wsf", "wsc", "cpl", "msp", "mde",
  "wsh", "scf", "url", "website", "library-ms", "searchconnector-ms",
  "theme", "deskthemepack",
];

describe("validateProtocolUrl: Schritt 4 - Positivliste (fail-closed) - bekannte gefaehrliche Endungen werden ALLE abgelehnt", () => {
  it.each(DANGEROUS_EXTENSIONS)("'.%s' wird abgelehnt (Reject)", (ext) => {
    const fakePath = "C:\\Users\\test\\evil." + ext;
    const result = validateProtocolUrl(urlFor(fakePath), {
      exists: () => true,
      resolveCanonical: () => ({ fullPath: fakePath, isDirectory: false }),
    });
    expect(result.status).toBe("Reject");
    expect(result.reason).toMatch(/Sicherheitsgruenden nicht geoeffnet/);
  });

  it("KEINE der 87 getesteten gefaehrlichen Endungen steht (versehentlich) auch auf der Positivliste - beide Listen ueberschneiden sich nicht", () => {
    const allowedLower = new Set(ALLOWED_EXTENSIONS.map((e) => e.toLowerCase()));
    for (const ext of DANGEROUS_EXTENSIONS) {
      expect(allowedLower.has(ext.toLowerCase())).toBe(false);
    }
  });
});

describe("validateProtocolUrl: Datei ohne erkennbare Endung wird abgelehnt (fail-closed)", () => {
  it("Datei ohne Punkt im Namen", () => {
    const p = writeTempFile("DateiOhneEndung");
    const result = validateProtocolUrl(urlFor(p));
    expect(result.status).toBe("Reject");
    expect(result.reason).toMatch(/ohne erkennbare Endung/);
  });

  it("Datei, deren Name NUR aus einem fuehrenden Punkt besteht (z. B. '.gitignore'-Stil) wird ebenfalls als 'ohne Endung' behandelt", () => {
    const p = writeTempFile(".geheim");
    const result = validateProtocolUrl(urlFor(p));
    expect(result.status).toBe("Reject");
    expect(result.reason).toMatch(/ohne erkennbare Endung/);
  });
});

describe("validateProtocolUrl: 8.3-Kurzname wird zur KANONISCHEN, LANGEN Endung aufgeloest (fs.realpathSync.native)", () => {
  it("Kern-Eigenschaft deterministisch geprueft (deps injiziert): die Endung wird IMMER von canonical.fullPath abgeleitet, NIEMALS vom rohen/dekodierten String - genau das ist der Schutz gegen einen 8.3-Kurznamen mit irrefuehrender Kuerzel-Endung", () => {
    // Der ROHE Pfad (wie er in der URL stand) traegt eine scheinbar
    // ERLAUBTE Endung (".txt") - die KANONISCHE Aufloesung liefert aber
    // einen ANDEREN, NICHT erlaubten Dateinamen/Endung (".application") -
    // exakt die Situation, die ein 8.3-Kurzname ("...~1.TXT" fuer eine in
    // Wahrheit ".application"-Datei waere theoretisch denkbar) erzeugen
    // wuerde. Ergebnis MUSS sich nach der kanonischen Form richten.
    const rawShortLooking = "C:\\Users\\test\\KURZFO~1.TXT";
    const canonicalLongForm = "C:\\Users\\test\\KurzformTestDatei.application";
    const result = validateProtocolUrl(urlFor(rawShortLooking), {
      exists: () => true,
      resolveCanonical: () => ({ fullPath: canonicalLongForm, isDirectory: false }),
    });
    expect(result.status).toBe("Reject");
    expect(result.reason).toMatch(/application/);
  });

  it("umgekehrt: eine kanonische Aufloesung MIT erlaubter Endung wird angenommen, selbst wenn der rohe String anders/kuerzer aussah", () => {
    const rawShortLooking = "C:\\Users\\test\\LANGNA~1.DOC";
    const canonicalLongForm = "C:\\Users\\test\\LangerNameMitEcht.docx";
    const result = validateProtocolUrl(urlFor(rawShortLooking), {
      exists: () => true,
      resolveCanonical: () => ({ fullPath: canonicalLongForm, isDirectory: false }),
    });
    expect(result.status).toBe("Ok");
    expect(result.path).toBe(canonicalLongForm);
  });

  it("Integrationstest mit einer ECHTEN, von Windows selbst generierten 8.3-Kurzname-Datei (kein Mock) - wird uebersprungen, falls 8.3-Kurznamen auf diesem Volume/System deaktiviert sind", () => {
    const longName = "EineSehrLangeDateiMitVerdaechtigerEndung.application";
    writeTempFile(longName);
    // "dir /x" ist Windows-Bordmittel (kein PowerShell/Interpreter-Umweg
    // in der eigentlichen Handler-Logik - NUR hier im Test zur Ermittlung
    // des von WINDOWS SELBST generierten Kurznamens verwendet) - per
    // echtem Lauf bestaetigt: fuer "EineSehrLange....application" liefert
    // Windows deterministisch "EINESE~1.APP" (siehe DECISIONS.md #79).
    let dirOutput = "";
    try {
      dirOutput = execFileSync("cmd.exe", ["/c", "dir", "/x", tmpDir], { encoding: "utf8" });
    } catch {
      return; // "dir" nicht verfuegbar (unerwartet) - Integrationstest ohne Aussagekraft, ueberspringen
    }
    const shortNameMatch = dirOutput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.endsWith(longName));
    if (!shortNameMatch) {
      return; // 8.3-Kurznamen auf diesem Volume/System deaktiviert - kein Kurzname generiert, Test ohne Aussagekraft
    }
    // Zeilenformat: "<Datum> <Zeit> <Groesse> <KURZNAME> <Langname>"
    const shortNameToken = shortNameMatch.split(/\s+/).find((tok) => tok !== longName && /~/.test(tok));
    if (!shortNameToken) {
      return; // kein separater Kurzname in der Ausgabe (Langname war bereits 8.3-konform) - kein aussagekraeftiger Fall
    }
    const shortPath = path.join(tmpDir, shortNameToken);
    expect(fs.existsSync(shortPath)).toBe(true);
    const result = validateProtocolUrl(urlFor(shortPath));
    // Der ROHE String endet auf ein kurzes ".APP"-Kuerzel - die kanonische
    // Aufloesung (fs.realpathSync.native) liefert die WAHRE, lange Endung
    // ".application", die NICHT auf der Positivliste steht.
    expect(result.status).toBe("Reject");
    expect(result.reason).toMatch(/application/);
  });
});

describe("validateProtocolUrl: Struktur-Regeln (UNC/ADS/Shell-Namespace/Trailing) werden AUCH gegen den kanonischen, aufgeloesten Pfad geprueft (Review-Fund 🟡1, echte Junction OHNE Adminrechte)", () => {
  // WARUM eine Junction statt weiterer 8.3-Kurzname-Tests: der 8.3-
  // Integrationstest oben haengt von einer VOLUME-Einstellung ab, die auf
  // vielen Firmenrechnern deaktiviert ist (siehe dortiger Kommentar) - er
  // kann deshalb VACUOUSLY GREEN laufen, ohne je etwas zu pruefen. Eine
  // NTFS-Verzeichnis-Junction ("mklink /J") ist dagegen NICHT von einer
  // Volume-Einstellung abhaengig und funktioniert OHNE Adminrechte (siehe
  // Einrichtung oben, Modul-Ebene) - ein deterministischerer Nachweis
  // fuer dieselbe Kern-Eigenschaft: was tatsaechlich GEOEFFNET/GEPRUEFT
  // wird, ist IMMER der kanonische, aufgeloeste Pfad (fs.realpathSync.
  // native), NIE der rohe Alias-String.
  it.skipIf(!junctionAvailable)(
    "ein Alias OHNE '.{' im eigenen Namen, dessen Junction-Ziel ein Shell-Namespace-Ordner ('.{GUID}') ist, wird abgelehnt (VOR dem Fix: 'Ok', per Review belegt)",
    () => {
      const result = validateProtocolUrl(urlFor(clsidAliasFile));
      expect(result.status).toBe("Reject");
      expect(result.reason).toMatch(/Struktur-Regel/);
    }
  );

  it.skipIf(!junctionAvailable)(
    "eine GANZ NORMALE Junction auf einen harmlosen Zielordner mit einer ERLAUBTEN Datei bleibt 'Ok' (kein legitimer Fall darf brechen) - Pfad ist der AUFGELOESTE Zielpfad",
    () => {
      const result = validateProtocolUrl(urlFor(plainAliasTxtFile));
      expect(result.status).toBe("Ok");
      expect(result.path).toBe(path.join(plainAliasTargetDir, "ziel.txt"));
    }
  );

  it.skipIf(!junctionAvailable)(
    "dieselbe Junction auf eine NICHT erlaubte Endung (.exe) im SELBEN Zielordner bleibt 'Reject' - Beleg, dass die Endungspruefung (Schritt 4) bereits VORHER korrekt vom kanonischen Pfad ableitete und vom neuen Struktur-Recheck nicht versehentlich mit falscher Begruendung ueberschrieben wird",
    () => {
      const result = validateProtocolUrl(urlFor(plainAliasExeFile));
      expect(result.status).toBe("Reject");
      expect(result.reason).toMatch(/exe/);
    }
  );

  it.skipIf(!junctionAvailable)("der Junction-Alias-ORDNER selbst (ohne Datei dahinter) bleibt oeffenbar ('Ok') - Ordner-Oeffnen bricht nicht", () => {
    const aliasDir = path.dirname(plainAliasTxtFile);
    const result = validateProtocolUrl(urlFor(aliasDir));
    expect(result.status).toBe("Ok");
    expect(result.path).toBe(plainAliasTargetDir);
  });

  it("Junction auf ein UNC-Ziel wird abgelehnt (per injizierten deps nachgebildet - eine ECHTE UNC-Freigabe ist ohne Netzwerk-/Adminrechte in dieser Umgebung nicht verfuegbar, siehe Bericht): eine kanonische Aufloesung, die auf '\\\\server\\share\\...' zeigt, wird unabhaengig vom (harmlos aussehenden) rohen Alias abgelehnt", () => {
    const result = validateProtocolUrl(urlFor("C:\\Users\\test\\NetzwerkAlias\\datei.txt"), {
      exists: () => true,
      resolveCanonical: () => ({ fullPath: "\\\\server\\share\\datei.txt", isDirectory: false }),
    });
    expect(result.status).toBe("Reject");
    expect(result.reason).toMatch(/Struktur-Regel/);
  });

  it("eine kanonische Aufloesung mit einem zusaetzlichen ':' (ADS) wird abgelehnt, selbst wenn der rohe Alias sauber aussah", () => {
    const result = validateProtocolUrl(urlFor("C:\\Users\\test\\Alias\\datei.txt"), {
      exists: () => true,
      resolveCanonical: () => ({ fullPath: "C:\\Users\\test\\datei.txt:stream", isDirectory: false }),
    });
    expect(result.status).toBe("Reject");
    expect(result.reason).toMatch(/Struktur-Regel/);
  });

  it("der Struktur-Recheck bricht den bloßen Laufwerks-Wurzelpfad 'C:\\\\' NICHT (kein falscher Treffer bei slice(2) auf einem kurzen Pfad)", () => {
    const result = validateProtocolUrl(urlFor("C:\\Users\\test\\WurzelAlias"), {
      exists: () => true,
      resolveCanonical: () => ({ fullPath: "C:\\", isDirectory: true }),
    });
    expect(result.status).toBe("Ok");
    expect(result.path).toBe("C:\\");
  });

  it("eine kanonische Aufloesung mit Trailing-Leerzeichen/-Punkt wird abgelehnt", () => {
    const withSpace = validateProtocolUrl(urlFor("C:\\Users\\test\\Alias"), {
      exists: () => true,
      resolveCanonical: () => ({ fullPath: "C:\\Users\\test\\datei.txt ", isDirectory: false }),
    });
    expect(withSpace.status).toBe("Reject");
    const withDot = validateProtocolUrl(urlFor("C:\\Users\\test\\Alias2"), {
      exists: () => true,
      resolveCanonical: () => ({ fullPath: "C:\\Users\\test\\datei.txt.", isDirectory: false }),
    });
    expect(withDot.status).toBe("Reject");
  });
});

describe("validateProtocolUrl: Nicht-ASCII-Zeichen in der Endung werden abgelehnt (Verteidigung-in-der-Tiefe)", () => {
  it("eine (injizierte) Endung, die wie die erlaubte Endung 'mkv' aussieht, aber das KELVIN-ZEICHEN (U+212A) statt eines echten 'k' enthaelt, wird abgelehnt statt stillschweigend als 'mkv' durchzugehen", () => {
    // "m" + KELVIN-ZEICHEN + "v" sieht optisch wie "mkv" aus (eine unserer
    // 49 erlaubten Endungen) - .NETs IgnoreCase-Regex-Modus faltete dieses
    // Zeichen beim bisherigen PowerShell-Handler faelschlich zu "k" (siehe
    // DECISIONS.md #79); die explizite Nicht-ASCII-Ablehnung VOR dem
    // Positivlisten-Vergleich verhindert das strukturell, unabhaengig
    // davon, ob JS an dieser Stelle dieselbe Faltung haette (siehe
    // Kopfkommentar "UNICODE-/GROSS-KLEINSCHREIBUNGS-FALLE" - JS hat sie
    // nachweislich NICHT, die Pruefung bleibt trotzdem als
    // Verteidigung-in-der-Tiefe bestehen).
    const fakePath = "C:\\Users\\test\\datei.m\u212Av";
    const result = validateProtocolUrl(urlFor(fakePath), {
      exists: () => true,
      resolveCanonical: () => ({ fullPath: fakePath, isDirectory: false }),
    });
    expect(result.status).toBe("Reject");
    expect(result.reason).toMatch(/Nicht-ASCII/);
  });
});

describe("validateProtocolUrl: legitime Sonderzeichen im Dateinamen (echte Temp-Dateien)", () => {
  it("Klammern im Dateinamen (Windows-Kopie-Muster 'Kopie (1).txt')", () => {
    const p = writeTempFile("Kopie (1).txt");
    const result = validateProtocolUrl(urlFor(p));
    expect(result.status).toBe("Ok");
  });

  it("Umlaute im Dateinamen", () => {
    const p = writeTempFile("Bericht Übersicht äöüß.txt");
    const result = validateProtocolUrl(urlFor(p));
    expect(result.status).toBe("Ok");
  });

  it("mehrere aufeinanderfolgende Leerzeichen im Dateinamen", () => {
    const p = writeTempFile("Viele    Leerzeichen.txt");
    const result = validateProtocolUrl(urlFor(p));
    expect(result.status).toBe("Ok");
  });

  it("Datei mit mehreren Punkten im Namen: NUR die letzte Endung zaehlt", () => {
    const p = writeTempFile("Archiv.tar.gz");
    const result = validateProtocolUrl(urlFor(p));
    expect(result.status).toBe("Ok");
  });
});

describe("validateProtocolUrl: injizierte Fehlerpfade (mit echten Dateien praktisch nicht ausloesbar)", () => {
  it("exists() wirft eine Exception -> Reject statt Crash", () => {
    const result = validateProtocolUrl(urlFor("C:\\Users\\test\\datei.txt"), {
      exists: () => {
        throw new Error("simulierter Dateisystem-Fehler");
      },
    });
    expect(result.status).toBe("Reject");
    expect(result.reason).toMatch(/nicht geprueft werden/);
  });

  it("resolveCanonical() wirft eine Exception -> Reject statt Crash", () => {
    const result = validateProtocolUrl(urlFor("C:\\Users\\test\\datei.txt"), {
      exists: () => true,
      resolveCanonical: () => {
        throw new Error("simulierter Aufloesungs-Fehler");
      },
    });
    expect(result.status).toBe("Reject");
    expect(result.reason).toMatch(/nicht aufgeloest werden/);
  });
});

describe("shortenPath", () => {
  it("kurzer Pfad bleibt unveraendert", () => {
    expect(shortenPath("C:\\a\\b.txt")).toBe("C:\\a\\b.txt");
  });

  it("Pfad ueber 200 Zeichen wird gekuerzt und mit '...' markiert", () => {
    const long = "C:\\" + "a".repeat(250) + ".txt";
    const out = shortenPath(long);
    expect(out.length).toBe(203); // 200 + "..."
    expect(out.endsWith("...")).toBe(true);
  });

  it("kein Pfad (null/leer) liefert einen lesbaren Platzhalter", () => {
    expect(shortenPath(null)).toBe("(kein Pfad)");
    expect(shortenPath("")).toBe("(kein Pfad)");
  });
});
