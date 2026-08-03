// ====================================================================
// notizbuch-open.js  (Kontrakt v1, Notizbuch-App v7.38)
// ====================================================================
// ZWECK
//   Handler fuer das eigene URL-Protokoll "notizbuch-open:". Die App
//   laeuft auf GitHub Pages (https) und darf aus dem Browser heraus NICHT
//   direkt zu "file://..." navigieren (siehe Kopfkommentar in
//   src/lib/filelinks.js). Ein file:-Link baut deshalb zusaetzlich eine
//   "notizbuch-open:v1?path=<encodeURIComponent(Windows-Pfad, Backslash-
//   Form)>"-URL (buildProtocolUrl, src/lib/filelinks.js). Nach einmaliger
//   Einrichtung (notizbuch-open-setup.ps1) fragt der Browser beim ERSTEN
//   Klick, ob dieses Protokoll geoeffnet werden darf; ab dann ruft
//   Windows GENAU DIESES Skript mit der KOMPLETTEN URL als einzigem
//   Argument (%1) auf (siehe Registry-Befehl in notizbuch-open-setup.ps1).
//
// ARCHITEKTUR-CHRONIK (Notizbuch v7.35 -> v7.38, vollstaendiger Beleg in
//   DECISIONS.md #79 - hier nur die Kurzfassung, damit klar wird, WARUM
//   das hier ein Node-Skript ist und keine dritte PowerShell-Fassung):
//   1. v7.35/v7.36: Registry zeigte DIREKT auf powershell.exe. Windows
//      loeste das Protokoll nachweislich korrekt auf, ein Klick in Chrome
//      tat aber NICHTS.
//   2. v7.37: Kontrollmessungen (ALLE im echten Chrome) zeigten: ein
//      Ziel-Executable, das ein SKRIPT-INTERPRETER ist (powershell.exe,
//      cmd.exe, wscript.exe, ...), wird von Chrome beim externen-
//      Protokoll-Dialog gar nicht erst geoeffnet - ein "normales"
//      Programm (notepad.exe) dagegen sofort. Fix: ein eigener,
//      kompilierter C#-Launcher (NotizbuchOpenLauncher.cs) als
//      "normales" Zwischen-Executable.
//   3. v7.37 (spaeter, NACH echter Installation beim Nutzer - fruehere
//      Installationsversuche waren technisch bedingt NIE wirklich fuer
//      Chrome sichtbar, siehe DECISIONS.md #79 fuer die ehrliche
//      Fehleinschaetzung): Der Launcher lief zuverlaessig per Doppelklick
//      UND per direktem PowerShell-Aufruf - aber IMMER NOCH nicht aus
//      Chrome heraus (Bestaetigungsdialog erscheint, Chrome meldet
//      "Launched external handler", aber nicht einmal die ALLERERSTE
//      Instrumentierungs-Log-Zeile des Launchers entsteht). Selbst mit
//      einer gueltigen (selbst erzeugten) Code-Signatur kein Unterschied.
//   4. Entscheidende Kontrollmessung: ein Schema, dessen Ziel notepad.exe
//      ist, startet aus Chrome sofort. Ein Schema, dessen Ziel
//      "node.exe -e <Einzeiler>" ist, startet EBENFALLS zuverlaessig
//      (schreibt seine Test-Datei). Der selbst kompilierte, selbst
//      signierte Launcher dagegen NIE. SCHLUSSFOLGERUNG: Nicht "ist es
//      ein Interpreter" ist die Huerde (node.exe IST in gewissem Sinn
//      auch ein Interpreter und funktioniert trotzdem) - vermutlich
//      etabliert/bereits-installiert/vertrauenswuerdig laut dem
//      Endpoint-Schutz des konkreten Rechners (notepad.exe/node.exe sind
//      lang etablierte, weit verbreitete, signierte Binaries; eine frisch
//      selbst kompilierte .exe ist es nicht - unabhaengig von einer
//      eigenen Signatur). Fix (dieses Skript): kein eigener Launcher mehr
//      noetig, die Registry zeigt jetzt DIREKT auf node.exe (das laut
//      Kontrollmessung von Chrome akzeptiert wird) mit DIESEM Skript als
//      Argument. Der komplette PowerShell-Handler UND der C#-Launcher
//      entfallen ersatzlos (siehe notizbuch-open-setup.ps1) - GENAU EINE
//      Implementierung der Validierung statt drei parallele Fassungen,
//      die auseinanderlaufen koennten.
//
//   WARUM explorer.exe ZUM OEFFNEN (nicht cmd.exe/"start", siehe Schritt
//   "Oeffnen" unten): cmd.exe ist selbst ein Skript-Interpreter - GENAU
//   die Kategorie, deren direkte Ansteuerung Chrome laut obiger Diagnose
//   blockiert. Zwar wuerde cmd.exe hier NICHT von Chrome direkt
//   gestartet (sondern von node.exe, das Chrome bereits akzeptiert hat),
//   aber OB ein Endpoint-Schutz auch bei einer KINDPROZESS-Kette
//   "akzeptiertes node.exe startet cmd.exe startet <Ziel>" eingreift, ist
//   UNGETESTET und wuerde exakt das Angriffsmuster (ein durch Web-Content
//   beeinflusstes Argument an einen Interpreter) reproduzieren, das diese
//   gesamte Architektur vermeiden soll. explorer.exe ist dagegen ein
//   signiertes, etabliertes Windows-System-Binary OHNE Interpreter-
//   Charakter (dieselbe Kategorie wie das erfolgreiche notepad.exe/
//   node.exe in der Kontrollmessung oben) - empirisch bestaetigt (siehe
//   DECISIONS.md #79): "explorer.exe <Dateipfad>" oeffnet die Datei
//   zuverlaessig im dafuer REGISTRIERTEN Programm (nicht nur eine
//   Ordneransicht), "explorer.exe <Ordnerpfad>" oeffnet ein Explorer-
//   Fenster - beides exakt die Invoke-Item-/Doppelklick-Semantik des
//   bisherigen PowerShell-Handlers. BEKANNTE EIGENHEIT: explorer.exe
//   liefert so gut wie IMMER Exit-Code 1 zurueck, UNABHAENGIG vom Erfolg
//   (dokumentiertes, empirisch bestaetigtes Verhalten) - dieser Code
//   behandelt einen rein NUMERISCHEN, nicht-null Exit-Code deshalb NICHT
//   als Fehler (nur ein echter Start-Fehler wie "explorer.exe nicht
//   gefunden" wird geloggt, siehe openWithExplorer unten). Node startet
//   explorer.exe zudem ueber execFile() OHNE eigene Shell (Standard bei
//   execFile, anders als exec()) - es wird also so oder so NIE ein
//   cmd.exe/eine Shell dazwischengeschaltet.
//
//   NUTZER-FEEDBACK BEI ABLEHNUNG (bewusste Einschraenkung ggue. dem
//   bisherigen PowerShell-Handler, der eine WinForms-MessageBox zeigte):
//   Eine gleichwertige, garantiert zuverlaessige MessageBox OHNE
//   Skript-Interpreter-Start ist aus Node OHNE eine zusaetzliche
//   Abhaengigkeit NICHT sauber erreichbar. "msg.exe" (Windows-Bordmittel,
//   kein Interpreter) wurde erwogen und PRAKTISCH GEPRUEFT - es benoetigt
//   den "TermService" (Remote Desktop Services), der auf gewoehnlichen
//   Windows-Client-Installationen typischerweise DEAKTIVIERT (Manual/
//   Stopped) ist; ein Test schlug entsprechend fehl ("Verbindung ist
//   getrennt"). Da eine unzuverlaessige Benachrichtigung schlechter waere
//   als GAR keine (der Nutzer wuerde sich auf sie verlassen), wird bei
//   einer Ablehnung NUR geloggt (siehe unten), KEINE MessageBox gezeigt.
//   FRUEHERER Rueckfallweg ENTFALLEN (v7.39, Nutzer-Feedback nach Live-
//   Test): Bis v7.38 kopierte die App (FileLink, markdown.jsx) den
//   Windows-Pfad bei JEDEM Klick zusaetzlich in die Zwischenablage,
//   unabhaengig vom Ausgang dieses Handlers - das war selbst ein
//   Rueckfallweg aus der Zeit, in der der Protokollstart noch nicht
//   zuverlaessig funktionierte. Seit der Protokollstart LIVE bestaetigt
//   funktioniert, wurde die Kopie ERSATZLOS entfernt (sie ueberschrieb
//   sonst ungefragt den Zwischenablage-Inhalt des Nutzers) - eine
//   Ablehnung ist fuer den Nutzer jetzt NUR noch im Log sichtbar, ohne
//   jeden Rueckfallweg in der App selbst. Bewusst hingenommen (siehe
//   Restrisiko in DECISIONS.md #79) - Alternative waere ein erneuter
//   Griff zur MessageBox (siehe oben, verworfen) oder ein neuer,
//   eigenstaendiger Zwischenablage-Mechanismus NUR fuer den Ablehnungsfall
//   (Overengineering fuer einen seltenen Pfad, nicht umgesetzt).
//
// BEDROHUNGSMODELL (SICHERHEITSKRITISCH - bitte vor Aenderungen lesen,
//   UNVERAENDERT ggue. dem bisherigen PowerShell-Handler)
//   Nach der Einrichtung kann PRINZIPIELL JEDE Webseite (nicht nur diese
//   App!) nach einem Nutzer-Klick eine "notizbuch-open:..."-URL feuern -
//   der registrierte Handler ist system-/browserweit fuer den
//   angemeldeten Windows-Benutzer aktiv, nicht auf diese App beschraenkt.
//   Dieses Skript (genauer: validateProtocolUrl unten) ist deshalb die
//   EINZIGE Verteidigungslinie gegen einen boesartig praeparierten Link,
//   der versucht, ueber diesen Umweg beliebige Dateien/Programme auf dem
//   Rechner des Nutzers zu oeffnen/auszufuehren.
//
//   ARCHITEKTUR: POSITIVLISTE, NICHT SPERRLISTE (unveraendert seit
//   Review-Nachbesserung 3 des PowerShell-Handlers, siehe DECISIONS.md
//   #79 fuer den vollstaendigen 94-Endungen-Beleg). NUR Endungen aus
//   ALLOWED_EXTENSIONS (unten) werden geoeffnet - ALLES andere
//   (einschliesslich jeder heute noch unbekannten, kuenftigen Endung)
//   wird ABGELEHNT.
//
//   Die Pruefreihenfolge in validateProtocolUrl() unten ist 1:1 aus dem
//   bisherigen PowerShell-Handler (Test-NotizbuchOpenUrl) portiert:
//     1. NUR absolute Laufwerkspfade ("C:\..."), UNC-Pfade
//        ("\\server\share\...") werden ABGELEHNT (SMB-Credential-Leak-
//        Risiko, siehe DECISIONS.md #79 fuer die vollstaendige
//        Begruendung - inkl. dem dokumentierten Restrisiko eines
//        bereits zugeordneten Netzlaufwerksbuchstabens).
//     2. Keine ".."-Segmente (Split auf "\" UND "/"), keine
//        Steuerzeichen/Nullbytes, keine erkennbaren Umgebungsvariablen-
//        Platzhalter ("%NAME%"/"$env:...").
//     2b. Kanonisierungs-/Namespace-Tricks: Trailing Space/Punkt,
//         Alternate Data Streams (weiterer ":" nach dem Laufwerks-
//         Praefix), Shell-Namespace-Ordner (".{"-Segmente, "God-Mode-
//         Ordner"-Muster).
//     3. Der Pfad muss tatsaechlich existieren.
//     4. POSITIVLISTE, abgeleitet vom KANONISCHEN, tatsaechlich
//        aufgeloesten Dateisystem-Eintrag (NICHT vom rohen String) -
//        siehe "8.3-KURZNAMEN" unten fuer die Node-spezifische
//        Umsetzung. Ordner sind strukturell erlaubt (ausser dem
//        Shell-Namespace-Fall aus 2b), eine Datei OHNE erkennbare
//        Endung wird ABGELEHNT (fail-closed).
//
//   8.3-KURZNAMEN / KANONISCHE AUFLOESUNG (Node-spezifischer Beleg, per
//   echtem Test auf einer eigens angelegten Datei
//   "ThisIsAVeryLongFileName.application" MIT ihrem generierten
//   Kurznamen "THISIS~1.APP" bestaetigt - siehe DECISIONS.md #79):
//   fs.realpathSync() (die REINE JS-Implementierung ohne systemnahen
//   Aufruf) loest einen 8.3-Kurznamen NICHT auf - der Kurzname bleibt im
//   Ergebnis unveraendert stehen. fs.realpathSync.native() (ruft die
//   Betriebssystem-API auf, das Node-Aequivalent zu PowerShells
//   "Get-Item -Force") loest ihn dagegen ZUVERLAESSIG zur kanonischen,
//   LANGEN Form auf ("...ThisIsAVeryLongFileName.application"). DESHALB
//   wird hier ausschliesslich die ".native"-Variante verwendet (siehe
//   defaultResolveCanonical unten) - dieselbe Umgehung, die beim
//   PowerShell-Handler den Wechsel zu "Get-Item -Force" ausloeste, waere
//   mit der reinen JS-Variante sonst wieder moeglich gewesen.
//
//   UNICODE-/GROSS-KLEINSCHREIBUNGS-FALLE, DIE ES IN JS NICHT GIBT
//   (Kontext fuer kuenftige Aenderungen, siehe DECISIONS.md #79 fuer den
//   vollstaendigen PowerShell-Befund): Der bisherige PowerShell-Handler
//   musste an mehreren Stellen explizit "-cmatch"/HashSet mit
//   OrdinalIgnoreCase statt der PowerShell-Standardoperatoren verwenden,
//   weil .NETs case-insensitiver Regex-Modus UND PowerShells
//   "-contains" das KELVIN-ZEICHEN (U+212A) faelschlich als
//   gross-/kleinschreibungs-aequivalent zu "K"/"k" behandelten. JS-
//   Regex ohne "i"-Flag ist bereits ordinal/case-sensitiv (Standard-
//   verhalten, keine Sonderbehandlung noetig); per Test bestaetigt, dass
//   selbst JS-Regex MIT "i"-Flag das Kelvin-Zeichen NICHT zu "k" faltet.
//   Ein einfaches Set.has() (SameValueZero-Vergleich) ist ebenfalls
//   bereits ordinal, ohne linguistische Kollation - kein Aequivalent zum
//   PowerShell-"-contains"-Problem vorhanden. Die explizite Nicht-ASCII-
//   Ablehnung der Endung (Schritt 4 unten) bleibt TROTZDEM als
//   Verteidigung-in-der-Tiefe erhalten (identisch zur bisherigen
//   Begruendung: jeder Positivlisten-Eintrag ist ohnehin reines ASCII).
//
//   Bei jeder Ablehnung entsteht ein Log-Eintrag (siehe appendLog unten,
//   Datei "notizbuch-open.log" NEBEN diesem Skript) - kein Popup (siehe
//   "NUTZER-FEEDBACK BEI ABLEHNUNG" oben). Ein reiner PRAEFIX-Mismatch
//   (die URL beginnt gar nicht mit "notizbuch-open:v1?path=") ist KEIN
//   abgelehnter Notizbuch-Link, sondern schlicht kein gueltiger Aufruf
//   dieses Handlers - ebenfalls nur ein Log-Eintrag, kein Reject.
//
//   KONTRAKT: DIESES SKRIPT VERARBEITET AUSSCHLIESSLICH WINDOWS-PFADE
//   (Review-Fund, VOR dem Commit gemeldet). Es laeuft IMMER unter echtem
//   win32 (Registry-Aufruf durch Windows, siehe ZWECK oben) - trotzdem
//   verwenden ALLE Pfad-Operationen hier bewusst EXPLIZIT die
//   "path.win32"-Variante des Node-"path"-Moduls (extname/join/resolve/
//   dirname), NICHT den plattformabhaengigen Default-Export "path.*".
//   Grund: der DEFAULT-Export von "path" wechselt je nach
//   "process.platform" zwischen win32- und posix-Semantik - das hat in
//   der Praxis KEINE Auswirkung auf die Produktion (die laeuft immer
//   unter win32), wohl aber auf Tests, die dieselbe Datei unter Linux-CI
//   importieren (siehe DECISIONS.md #79, CI-Deploy-Fix): fuer einen
//   Pfad wie "C:\Users\test\.geheim" liefert path.posix.extname()
//   FAELSCHLICH ".geheim" (erkennt "\" nicht als Trenner, behandelt den
//   kompletten String als EIN Segment), waehrend path.win32.extname()
//   korrekt "" liefert (kein Extension-Zeichen VOR dem Basisnamen). Die
//   explizite ".win32"-Variante beseitigt diese Klasse "CI-Semantik ungleich
//   Produktions-Semantik" strukturell, unabhaengig davon, unter welchem
//   Betriebssystem Vitest gerade laeuft.
//
// AUFRUF
//   Normalbetrieb (durch die Registry, siehe notizbuch-open-setup.ps1):
//     node.exe notizbuch-open.js "notizbuch-open:v1?path=..."
//   Diagnose (oeffnet NICHTS, nur Textausgabe, Exit-Code 0 bei "Ok", sonst 1):
//     node notizbuch-open.js --validate "notizbuch-open:v1?path=..."
//   Tests (Vitest, tests/notizbuchOpen.test.js):
//     import { validateProtocolUrl } from "../tools/notizbuch-open.js";
//     validateProtocolUrl() hat KEINE Seiteneffekte (kein Log, kein
//     Oeffnen) - reine Pruefung, siehe Funktionskommentar unten.
//
// MODUL-FORMAT (tools/package.json): Diese Datei nutzt ES-Module-Syntax
// (import/export), wie der Rest des Repos (notizbuch-app/package.json
// setzt bereits "type":"module"). notizbuch-open-setup.ps1 kopiert diese
// Datei aber aus dem Repo HERAUS nach "%LOCALAPPDATA%\NotizbuchOpen\" (ein
// Ordner OHNE jede package.json in seinem Elternpfad). Per Test bestaetigt
// (Node v24 auf dem Entwicklungsrechner): neuere Node-Versionen erkennen
// ES-Module-Syntax auch OHNE ein deklariertes "type":"module" automatisch
// (Modul-Syntax-Erkennung, seit Node 22/23 Standard) - VERLAESSLICH ist
// das aber nur fuer eine bekannte Mindestversion, der Node-Stand beim
// Nutzer ist nicht garantiert so aktuell. Deshalb kopiert das Setup
// zusaetzlich, unabhaengig von dieser Automatik, eine winzige eigene
// "package.json" (Inhalt: {"type":"module"}) MIT in denselben
// Zielordner - das Modul-Format "reist" dadurch explizit und
// versionsunabhaengig mit der Datei mit.
// ====================================================================

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

// POSITIVLISTE erlaubter Endungen (49 Eintraege, 1:1 identisch zur
// bisherigen $script:AllowedExtensions in notizbuch-open-handler.ps1 -
// siehe DECISIONS.md #79 fuer die vollstaendige Begruendung/Abgrenzung
// jedes Zweifelsfalls, hier bewusst NICHT dupliziert).
export const ALLOWED_EXTENSIONS = [
  "pdf", "txt", "md", "markdown", "log", "csv", "tsv", "json", "xml", "yaml",
  "yml", "ini", "cfg", "conf", "rtf",
  "doc", "docx", "odt",
  "xls", "xlsx", "ods",
  "ppt", "pptx", "odp",
  "png", "jpg", "jpeg", "gif", "bmp", "webp", "tif", "tiff", "heic",
  "mp3", "wav", "flac", "m4a",
  "mp4", "mkv", "mov", "avi", "webm",
  "zip", "7z", "tar", "gz",
  "eml", "msg", "epub",
];
// Set.has() ist ordinal (SameValueZero) - siehe Kopfkommentar
// "UNICODE-/GROSS-KLEINSCHREIBUNGS-FALLE" fuer die Begruendung, warum JS
// hier (anders als PowerShells "-contains") KEINEN expliziten
// OrdinalIgnoreCase-Ersatz braucht. Alle Eintraege oben sind bereits
// kleingeschrieben - der Nachschlagewert wird deshalb VOR dem
// Set.has()-Aufruf per toLowerCase() normalisiert (siehe
// validateProtocolUrl, Schritt 4).
const ALLOWED_EXTENSION_SET = new Set(ALLOWED_EXTENSIONS);

const PROTOCOL_PREFIX = "notizbuch-open:v1?path=";

// Node-Aequivalent zu "Get-Item -Force" (siehe Kopfkommentar
// "8.3-KURZNAMEN"): fs.realpathSync.native() loest 8.3-Kurznamen UND
// Symlinks/Junctions zur kanonischen, langen Form auf - die REINE JS-
// Variante (fs.realpathSync(), ohne ".native") tut das NICHT (per Test
// bestaetigt) und waere hier eine Sicherheitsluecke (die Endung koennte
// vom Kurznamen statt vom echten Dateinamen abgeleitet werden). Liefert
// zusaetzlich die Objektart (Datei/Ordner) vom AUFGELOESTEN Pfad, nicht
// vom rohen String - genau wie $item.PSIsContainer beim bisherigen
// PowerShell-Handler.
function defaultResolveCanonical(rawPath) {
  const fullPath = fs.realpathSync.native(rawPath);
  const stat = fs.statSync(fullPath);
  return { fullPath, isDirectory: stat.isDirectory() };
}

// Kuerzt einen Pfad fuer die Log-Anzeige (identisch zur Absicht von
// Get-ShortenedPath im bisherigen PowerShell-Handler) - vermeidet eine
// ausufernd lange Log-Zeile bei einem absichtlich sehr langen
// Angriffs-Pfad.
export function shortenPath(p) {
  if (!p) return "(kein Pfad)";
  return p.length > 200 ? p.slice(0, 200) + "..." : p;
}

// Kernpruefung: nimmt die KOMPLETTE rohe URL entgegen, liefert IMMER ein
// Ergebnisobjekt zurueck (nie eine Exception fuer einen ungueltigen Wert -
// nur fuer echte Programmierfehler in den injizierten deps). KEINE
// Seiteneffekte (kein Log, kein Oeffnen) - dadurch aus Vitest heraus
// direkt testbar, was mit dem bisherigen PowerShell-Handler nicht ging
// (das war der Hauptgrund fuer den Umstieg auf Node, siehe Auftrag).
//
// Status ist eines von:
//   "PrefixMismatch" - kein gueltiger Aufruf dieses Handlers (stiller Exit)
//   "Reject"         - Praefix stimmt, aber Validierung 1-4 schlaegt fehl
//   "Ok"             - alle Pruefungen bestanden, path ist geoeffnet-bereit
//
// deps erlaubt das Injizieren von Datei-Existenzpruefung/kanonischer
// Aufloesung fuer Tests (siehe tests/notizbuchOpen.test.js): die
// UEBERWIEGENDE MEHRHEIT der Tests nutzt trotzdem ECHTE Temp-Dateien mit
// den STANDARD-deps (kein Mock) - genau die 8.3-Kurznamen-/Kanonisierungs-
// Eigenheiten oben sind echtes Betriebssystemverhalten, das ein Mock
// unbemerkt falsch nachbilden koennte. deps wird NUR fuer die wenigen
// Fehlerpfade injiziert, die mit echten Dateien praktisch nicht (oder nur
// sehr aufwendig, z. B. per Berechtigungsentzug) auszuloesen sind (z. B.
// eine Exception aus dem Dateisystem waehrend der Pruefung).
export function validateProtocolUrl(rawUrl, deps = {}) {
  const exists = deps.exists || fs.existsSync;
  const resolveCanonical = deps.resolveCanonical || defaultResolveCanonical;

  if (rawUrl === null || rawUrl === undefined || rawUrl === "") {
    return { status: "PrefixMismatch", reason: "kein Argument uebergeben", path: null, rawUrl: rawUrl ?? "" };
  }

  // Trailing-Slash-Toleranz: Chrome/Edge haengen an eine per Registry
  // registrierte Protokoll-URL OHNE "//" nach dem Schema-Doppelpunkt
  // bekanntermassen automatisch einen einzelnen "/" an. Da die App-Seite
  // (buildProtocolUrl, filelinks.js) den Pfad per encodeURIComponent
  // kodiert (jeder rohe "/"/"\" wird zu "%2F"/"%5C"), kann eine SELBST
  // gebaute Kontrakt-URL nie roh auf "/" enden - ein angehaengter
  // trailing "/" stammt also garantiert vom Browser und wird hier
  // defensiv GENAU EINMAL abgeschnitten, VOR dem Praefix-Vergleich.
  let normalized = rawUrl;
  if (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  // Case-insensitiver Praefix-Vergleich (URL-Schemas sind laut RFC 3986
  // nicht gross-/kleinschreibungs-sensitiv). PROTOCOL_PREFIX ist bereits
  // rein ASCII-kleingeschrieben - toLowerCase() auf der Kandidaten-Seite
  // reicht (siehe Kopfkommentar: JS hat hier keine Kelvin-Zeichen-Falle,
  // anders als .NETs IgnoreCase-Regex-Modus).
  if (normalized.slice(0, PROTOCOL_PREFIX.length).toLowerCase() !== PROTOCOL_PREFIX) {
    return {
      status: "PrefixMismatch",
      reason: `Praefix fehlt/falsch (erwartet '${PROTOCOL_PREFIX}')`,
      path: null,
      rawUrl,
    };
  }

  const encoded = normalized.slice(PROTOCOL_PREFIX.length);
  let decoded;
  try {
    decoded = decodeURIComponent(encoded);
  } catch (e) {
    return { status: "Reject", reason: `Pfad liess sich nicht dekodieren (${e.message})`, path: null, rawUrl };
  }

  // --- Schritt 1: absoluter Laufwerkspfad, UNC explizit verboten -------
  if (/^\\\\/.test(decoded)) {
    return {
      status: "Reject",
      reason: "UNC-Pfade (Netzwerkfreigaben, \\\\server\\...) sind nicht erlaubt",
      path: decoded,
      rawUrl,
    };
  }
  if (!/^[A-Za-z]:\\/.test(decoded)) {
    return { status: "Reject", reason: "kein absoluter Laufwerkspfad (erwartet z. B. C:\\...)", path: decoded, rawUrl };
  }

  // --- Schritt 2: Traversal / Steuerzeichen / Umgebungsvariablen -------
  // Split auf BEIDE Trenner ("\" UND "/") - ein Split nur auf "\" liesse
  // ein NUR per "/" gebildetes ".."-Segment durch, obwohl Windows/
  // explorer.exe "/" genauso wie "\" aufloest.
  const segments = decoded.split(/[\\/]/);
  if (segments.includes("..")) {
    return { status: "Reject", reason: "Pfad enthaelt '..'-Segmente (Traversal)", path: decoded, rawUrl };
  }
  if (/[\u0000-\u001F]/.test(decoded)) {
    return { status: "Reject", reason: "Pfad enthaelt Steuerzeichen/Nullbytes", path: decoded, rawUrl };
  }
  // "%NAME%" eng an eine echte Windows-Variablennamensform angelehnt
  // (Buchstabe/Unterstrich als erstes Zeichen, danach alphanumerisch/
  // Unterstrich/Klammern) - ein pauschales "irgendwo zwei %-Zeichen"
  // lehnte nachweislich legitime Dateinamen wie "50% Rabatt 100%.txt" ab
  // (siehe DECISIONS.md #79).
  if (/%[A-Za-z_][A-Za-z0-9_()]{0,63}%/.test(decoded)) {
    return {
      status: "Reject",
      reason: "Pfad enthaelt einen moeglichen Umgebungsvariablen-Platzhalter (%NAME%)",
      path: decoded,
      rawUrl,
    };
  }
  if (/\$env:/i.test(decoded)) {
    return {
      status: "Reject",
      reason: "Pfad enthaelt einen moeglichen Umgebungsvariablen-Platzhalter ($env:...)",
      path: decoded,
      rawUrl,
    };
  }

  // --- Schritt 2b: Kanonisierungs-/Namespace-Tricks ---------------------
  // (a) Trailing Space/Punkt - Windows kanonisiert beides beim
  //     TATSAECHLICHEN Dateizugriff weg; eine gegen den rohen String
  //     geprueften Endung wuerde das nicht erkennen.
  if (/[ .]$/.test(decoded)) {
    return {
      status: "Reject",
      reason: "Pfad endet auf Leerzeichen/Punkt (wird von Windows kanonisiert - moeglicher Umgehungsversuch)",
      path: decoded,
      rawUrl,
    };
  }
  // (b) Alternate Data Stream: jeder weitere ":" nach dem
  //     Laufwerks-Praefix (Index 0-1, "C:") ist in einem gueltigen
  //     Windows-Pfad nie erlaubt - slice(2) ist sicher, weil Schritt 1
  //     oben bereits "^[A-Za-z]:\\" (mindestens 3 Zeichen) erzwungen hat.
  if (decoded.slice(2).includes(":")) {
    return { status: "Reject", reason: 'Alternate Data Stream (weiterer ":" im Pfad) ist nicht erlaubt', path: decoded, rawUrl };
  }
  // (c) Shell-Namespace-Ordner (CLSID-Suffix, "God-Mode-Ordner"-Muster):
  //     ein Segment, das ".{" enthaelt, wird abgelehnt. Alle Segmente
  //     werden geprueft (nicht nur das letzte) - kostet nichts und
  //     schuetzt auch vor einer kuenftig geaenderten Aufloese-Reihenfolge
  //     (siehe DECISIONS.md #79 fuer die vollstaendige Abwaegung).
  if (segments.some((s) => s.includes(".{"))) {
    return {
      status: "Reject",
      reason: 'Ordnername mit Shell-Namespace-Muster (".{...}") ist nicht erlaubt',
      path: decoded,
      rawUrl,
    };
  }

  // --- Schritt 3: Existenz ----------------------------------------------
  let itemExists;
  try {
    itemExists = exists(decoded);
  } catch (e) {
    return { status: "Reject", reason: `Pfad konnte nicht geprueft werden (${e.message})`, path: decoded, rawUrl };
  }
  if (!itemExists) {
    return { status: "Reject", reason: "Pfad/Datei existiert nicht", path: decoded, rawUrl };
  }

  // --- Schritt 4: POSITIVLISTE, aus dem KANONISCHEN Dateisystem-Eintrag
  //     abgeleitet (NICHT vom rohen String) ------------------------------
  let canonical;
  try {
    canonical = resolveCanonical(decoded);
  } catch (e) {
    return { status: "Reject", reason: `Pfad konnte nicht aufgeloest werden (${e.message})`, path: decoded, rawUrl };
  }

  // --- Schritt 4a: STRUKTUR-Regeln (Schritt 1/2b) ERNEUT gegen den
  //     KANONISCHEN (aufgeloesten) Pfad pruefen (Review-Fund, VOR dem
  //     Commit gemeldet, 🟡 Pflicht) -------------------------------------
  // WARUM NOCHMAL: Die Struktur-Pruefungen oben (UNC, ADS, Trailing-Space/
  // Punkt, ".{"-Shell-Namespace) liefen bisher NUR auf "decoded" (dem
  // ROHEN, vom Nutzer/der URL kommenden String) - GEOEFFNET wird aber
  // "canonical.fullPath" aus resolveCanonical (fs.realpathSync.native),
  // und genau DAS loest Junctions/Symlinks/Reparse-Points zu ihrem ZIEL
  // auf. Ein per "mklink /J" OHNE Adminrechte erzeugter Ordner-Alias, der
  // selbst voellig unauffaellig aussieht (kein ".{" im eigenen Namen, kein
  // "\\" am Anfang), kann trotzdem auf ein STRUKTURELL verbotenes Ziel
  // zeigen (einen Shell-Namespace-/"God-Mode"-Ordner ODER - technisch
  // ebenfalls per Junction moeglich - eine UNC-Freigabe) - die
  // Endungspruefung (Schritt 4 unten) ist davon NICHT betroffen (sie
  // leitet die Endung ohnehin bereits vom KANONISCHEN Pfad ab), aber die
  // Struktur-Pruefungen sehr wohl, weil sie bisher nur auf dem
  // UNAUFGELOESTEN Alias liefen. EMPIRISCH BELEGT (Review-Fund, per
  // eigens angelegter Junction OHNE Adminrechte reproduziert): ein Alias-
  // Ordner ohne ".{" im Namen, dessen JUNCTION-Ziel auf einen Ordner mit
  // CLSID-Suffix zeigt, lieferte VOR diesem Fix "Ok" statt "Reject" -
  // fs.realpathSync.native loeste den Alias zuverlaessig zum ZIEL mit dem
  // ".{...}"-Segment auf, das aber nie geprueft wurde.
  //
  // Bewusst NICHT die volle Schritt-1/2b-Logik dupliziert, sondern NUR
  // die vier Struktur-Signale, die bei einer Umleitung relevant werden
  // koennten (Laufwerksbuchstabe-vs-UNC, ADS, ".{"-Segmente, Trailing-
  // Space/Punkt) - Traversal (".."-Segmente) und Umgebungsvariablen-
  // Platzhalter sind hier NICHT erneut noetig: fs.realpathSync.native
  // liefert einen bereits vollstaendig aufgeloesten, normalisierten Pfad
  // OHNE ".."-Segmente oder rohe "%NAME%"/"$env:"-Zeichenketten (das
  // Betriebssystem loest beides bereits bei der Aufloesung auf/entfernt
  // sie strukturell, anders als die UNC-/CLSID-/ADS-/Trailing-Muster, die
  // als LITERALE Zeichenfolgen im aufgeloesten Ergebnis erhalten bleiben
  // koennen).
  //
  // slice(2).includes(":") bei kurzen kanonischen Pfaden (z. B. dem
  // Wurzelpfad "C:\"): slice(2) liefert dann nur "\" (kein ":") - sicher,
  // KEIN falscher Treffer. Bei einem (durch die erste Bedingung ohnehin
  // schon separat erfassten) UNC-Ergebnis wie "\\server\share\..." prueft
  // slice(2) zwar nicht sinnvoll auf ein Laufwerks-Praefix, das aendert
  // aber nichts an der Korrektheit: die ERSTE Bedingung
  // ("/^\\\\/.test(...)") greift für diesen Fall bereits unabhaengig,
  // die Gesamt-Oder-Verknuepfung lehnt so oder so ab.
  const canonSegs = canonical.fullPath.split(/[\\/]/);
  if (
    /^\\\\/.test(canonical.fullPath) ||
    canonical.fullPath.slice(2).includes(":") ||
    canonSegs.some((s) => s.includes(".{")) ||
    /[ .]$/.test(canonical.fullPath)
  ) {
    return {
      status: "Reject",
      reason: "Aufgeloester Pfad verletzt eine Struktur-Regel (Symlink-/Junction-/Kurzname-Umgehungsversuch)",
      path: decoded,
      rawUrl,
    };
  }

  if (!canonical.isDirectory) {
    // Datei: nur eine Endung aus der Positivliste wird geoeffnet. Eine
    // Datei OHNE erkennbare Endung wird ABGELEHNT (fail-closed).
    const extWithDot = path.win32.extname(canonical.fullPath);
    const extRaw = extWithDot.startsWith(".") ? extWithDot.slice(1) : extWithDot;
    if (!extRaw) {
      return {
        status: "Reject",
        reason: "Dateien ohne erkennbare Endung werden aus Sicherheitsgruenden nicht geoeffnet.",
        path: decoded,
        rawUrl,
      };
    }
    // Nicht-ASCII-Zeichen in der Endung IMMER ablehnen (Verteidigung-in-
    // der-Tiefe, siehe Kopfkommentar - in JS strukturell nicht noetig,
    // aber bewusst beibehalten: jeder Positivlisten-Eintrag ist ohnehin
    // reines ASCII, eine "erlaubte" Endung kann also nie ein Nicht-ASCII-
    // Zeichen enthalten).
    if (/[^\x00-\x7F]/.test(extRaw)) {
      return {
        status: "Reject",
        reason:
          "Dateityp enthaelt Nicht-ASCII-Zeichen (moeglicher Unicode-Bypass-Versuch) und wird aus Sicherheitsgruenden nicht geoeffnet.",
        path: decoded,
        rawUrl,
      };
    }
    const extLower = extRaw.toLowerCase();
    if (!ALLOWED_EXTENSION_SET.has(extLower)) {
      return {
        status: "Reject",
        reason: `Dateityp '.${extLower}' wird aus Sicherheitsgruenden nicht geoeffnet.`,
        path: decoded,
        rawUrl,
      };
    }
  }
  // Ordner: strukturell erlaubt - der Shell-Namespace-Check (Schritt 2b/c)
  // hat fuer ".{"-Muster bereits VOR diesem Punkt gegriffen.

  // path = die KANONISCHE FullName (NICHT der Rohstring) - der
  // Normalbetrieb unten ruft explorer.exe bewusst mit GENAU diesem Wert
  // auf.
  return { status: "Ok", reason: null, path: canonical.fullPath, rawUrl };
}

// ======================= Ab hier: Seiteneffekte =======================
// (Logging, Oeffnen, CLI-Einstiegspunkt) - ALLES oben ist reine,
// seiteneffektfreie Pruefung (validateProtocolUrl). Der folgende Teil
// laeuft NUR, wenn dieses Skript DIREKT ausgefuehrt wird (siehe
// isMainModule unten) - ein "import { validateProtocolUrl } ..." aus
// Vitest fuehrt NICHTS davon aus.

const LOG_MAX_BYTES = 1 * 1024 * 1024; // 1 MB, wie beim bisherigen PowerShell-Handler

function formatTimestamp(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
    " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds())
  );
}

// Loggt EINE Zeile pro Aufruf (Open/Reject/PrefixMismatch/Fatal) in
// "notizbuch-open.log" NEBEN diesem Skript. WARUM KEIN MUTEX (Unterschied
// zum bisherigen PowerShell-Handler, der einen benannten Mutex nutzte):
// fs.appendFileSync() oeffnet die Datei mit dem 'a'-Flag, das
// Betriebssystem-seitig O_APPEND (POSIX) bzw. FILE_APPEND_DATA (Windows)
// verwendet - ein EINZELNER Schreibvorgang an das Dateiende ist damit auf
// BEIDEN Plattformen atomar (Standard-Betriebssystemgarantie), solange
// (wie hier) JEDE Log-Zeile in EINEM einzigen Schreibaufruf geschrieben
// wird. Zwei parallel gestartete Handler-Prozesse (zwei schnelle Klicks)
// koennen sich dadurch nicht gegenseitig mitten in einer Zeile
// ueberschreiben - ein zusaetzlicher, eigens verwalteter Mutex (wie im
// PowerShell-Handler, wo JEDER Klick einen komplett neuen Prozess
// startete) ist fuer dieses einfache Muster nicht noetig. Ein
// Schreibfehler (z. B. schreibgeschuetzter Ordner) wird still ignoriert -
// Logging ist Diagnose, kein Kernpfad, ein Fehler darf das Oeffnen selbst
// nie verhindern.
function appendLog(logPath, message) {
  try {
    try {
      const st = fs.statSync(logPath);
      if (st.size > LOG_MAX_BYTES) {
        // Rotation bei > 1 MB (eine Ebene Historie als ".log.old") -
        // verhindert unbegrenztes Wachstum ueber viele Klicks/
        // Ablehnungen hinweg.
        fs.rmSync(logPath + ".old", { force: true });
        fs.renameSync(logPath, logPath + ".old");
      }
    } catch {
      // Datei existiert noch nicht o. Ae. - keine Rotation noetig.
    }
    // Zeilenumbrueche IMMER ersetzen (Log-Injection-Schutz): $Message
    // kann einen Rohwert enthalten, der nie durch die
    // Steuerzeichen-Pruefung aus Schritt 2 gelaufen ist (z. B. der
    // komplette Rohwert bei einem Praefix-Mismatch).
    const safeMessage = String(message).replace(/[\r\n]/g, " ");
    const line = formatTimestamp(new Date()) + "  " + safeMessage + "\n";
    fs.appendFileSync(logPath, line, { encoding: "utf8" });
  } catch {
    // Logging ist Diagnose, kein Kernpfad - jeder Fehler wird still
    // ignoriert (identisch zur bisherigen PowerShell-Handler-Philosophie).
  }
}

// Oeffnet den bereits validierten, KANONISCHEN Pfad per explorer.exe
// (siehe Kopfkommentar "WARUM explorer.exe" fuer die vollstaendige
// Begruendung/den empirischen Beleg). execFile() startet OHNE eigene
// Shell (kein cmd.exe dazwischen, anders als exec()).
function openWithExplorer(canonicalPath, logPath) {
  execFile("explorer.exe", [canonicalPath], (err) => {
    // explorer.exe liefert so gut wie IMMER Exit-Code 1 zurueck,
    // UNABHAENGIG vom tatsaechlichen Erfolg (empirisch bestaetigt, siehe
    // Kopfkommentar) - node meldet einen solchen NUMERISCHEN Exit-Code
    // ueber err.code als ZAHL. Ein STRING in err.code (z. B. "ENOENT")
    // bedeutet dagegen, dass explorer.exe selbst gar nicht erst gestartet
    // werden konnte - NUR das ist ein echter, loggenswerter Fehler.
    if (err && typeof err.code === "string") {
      appendLog(logPath, "Open-Fehler (explorer.exe konnte nicht gestartet werden): " + err.code + ": " + err.message);
    }
  });
}

function resolveLogPath(scriptDir) {
  return path.win32.join(scriptDir, "notizbuch-open.log");
}

// CLI-Einstiegspunkt: unterstuetzt sowohl den Normalbetrieb (ein
// Argument: die komplette URL, von der Registry als "%1" uebergeben) als
// auch "--validate <url>" (Aequivalent zum bisherigen PowerShell
// "-Validate"-Schalter: prueft, oeffnet aber NICHTS, zeigt nur eine
// Textzeile auf stdout, Exit-Code 0 nur bei "Ok").
export function runCli(argv, scriptDir) {
  const logPath = resolveLogPath(scriptDir);

  const validateIdx = argv.indexOf("--validate");
  if (validateIdx !== -1) {
    const url = argv[validateIdx + 1] ?? "";
    const result = validateProtocolUrl(url);
    if (result.status === "Ok") {
      console.log("OK: " + result.path);
      process.exitCode = 0;
    } else {
      console.log(result.status + ": " + result.reason + " [Pfad: " + shortenPath(result.path) + "]");
      process.exitCode = 1;
    }
    return;
  }

  const url = argv[0] ?? "";
  const result = validateProtocolUrl(url);

  if (result.status === "PrefixMismatch") {
    appendLog(logPath, "PrefixMismatch: " + result.reason + " | Rohwert: " + result.rawUrl);
    return;
  }
  if (result.status !== "Ok") {
    appendLog(logPath, "Reject: " + result.reason + " | Pfad: " + result.path);
    return;
  }
  appendLog(logPath, "Open: " + result.path);
  openWithExplorer(result.path, logPath);
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.win32.resolve(process.argv[1]);
if (isMainModule) {
  const scriptDir = path.win32.dirname(fileURLToPath(import.meta.url));
  try {
    // argv[0]=node, argv[1]=Skriptpfad, argv[2..]=eigentliche Argumente.
    runCli(process.argv.slice(2), scriptDir);
  } catch (e) {
    // Gelernte Lektion aus der Launcher-Diagnose (siehe DECISIONS #79):
    // JEDE unbehandelte Ausnahme wird geloggt, BEVOR der Prozess endet -
    // kein stiller Abbruch ohne jede Spur.
    appendLog(resolveLogPath(scriptDir), "FATAL: " + (e && e.stack ? e.stack : String(e)));
  }
}
