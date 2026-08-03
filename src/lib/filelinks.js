/* ------------------------------------------------------------------ */
/* file:-Links (v7.31, Nutzer-Befund Live): Markdown wie                */
/* "[Titel](file:///C:/Users/x/Bericht.docx)" wurde im Dokument-Viewer   */
/* als LITERALTEXT gerendert – LINK_URL_RE (markdown.jsx) erlaubt nur    */
/* http(s). Zusätzlicher Nutzerwunsch: ein absoluter Windows-Pfad, der   */
/* per Chat/Editor in eine Notiz gelangt, soll beim Speichern            */
/* automatisch zu einem file:-Link mit dem Dateinamen OHNE Endung als    */
/* Linktext werden.                                                     */
/*                                                                       */
/* BLATT im Abhängigkeitsbaum wie code.jsx/linkProviders.jsx: importiert */
/* NICHTS aus markdown.jsx/DocEditor.jsx (Zirkelbezug-Regel – markdown.jsx*/
/* UND DocEditor.jsx importieren umgekehrt AUS dieser Datei die file:-   */
/* URL-Grammatik/Pfad-Helfer).                                          */
/*                                                                       */
/* SICHERHEIT: Die file:-Grammatik ist bewusst ENG (NUR "file:///" mit   */
/* Laufwerksbuchstabe ODER UNC "file://server/…", kein Whitespace) –     */
/* keine dritte, freizügigere Alternative, über die sich javascript:/    */
/* data: einschleichen könnten (die bleiben strukturell unmöglich, siehe */
/* markdown.jsx/DocEditor.jsx, die diese Grammatik statt einer eigenen    */
/* Kopie verwenden).                                                    */
/*                                                                       */
/* BROWSER-KONTEXT (wichtig für Design in markdown.jsx/DocEditor.jsx):   */
/* Die App läuft auf GitHub Pages (https) – Browser blockieren die       */
/* Navigation von einer https-Seite zu file:// aus Sicherheitsgründen,   */
/* ein Klick auf einen file:-Link tut dort also meist NICHTS Sichtbares  */
/* (nur lokal geöffnet oder mit einer Browser-Extension funktioniert er  */
/* wirklich). Deshalb kopiert ein Klick im Viewer ZUSÄTZLICH den         */
/* Windows-Pfad (Backslash-Form, siehe fileUrlToWinPath) in die          */
/* Zwischenablage – siehe FileLink-Komponente in markdown.jsx.           */
/* ------------------------------------------------------------------ */

import { splitFenceSegments } from "./code.jsx";

/* ---------------- Grammatik: file:-URLs ---------------- */
// Zwei Formen, beide streng (kein Whitespace, %-Encoding erlaubt, da es nur
// aus [^\s] besteht):
//  - Laufwerksbuchstabe: "file:///" + "C:/" + Rest, z. B.
//    file:///C:/Users/x/Bericht.docx
//  - UNC-Freigabe:       "file://" + "server" + "/share/…", z. B.
//    file://server/share/datei.md
// Längen-Cap je Alternative (analog LINK_URL_RE/INLINE_TOKEN_RE in
// markdown.jsx, dortiger Kommentar "Nachbesserung v7.8, Finding 3"):
// ein UNGECAPPTES "[^\s]*" ließe die Regex-Engine bei jedem Startindex den
// kompletten Rest der Zeile durchprobieren, bevor sie aufgibt (quadratisches
// Backtracking bei langen, dot-losen Zeichenketten ohne Whitespace) – der
// Cap begrenzt JEDEN EINZELNEN Versuch auf eine Konstante. WICHTIG (Review-
// Fix, Sicherheits-Review Runde 4 – der ursprüngliche Kommentar hier war
// FALSCH): Dieser Cap wirkt auf die bereits PROZENT-KODIERTE URL, NICHT auf
// den rohen Windows-Pfad – "Windows MAX_PATH liegt bei 260, 300 ist
// reichlich" vergleicht damit zwei verschiedene Längen-Domänen. Kodierung
// EXPANDIERT: ein Leerzeichen wird zu "%20" (Faktor 3), ein mehrbytiges
// UTF-8-Zeichen (z. B. ein Umlaut) zu bis zu drei "%XX"-Gruppen (Faktor 6).
// Gemessen an der echten, gebündelten Implementierung: mit Leerzeichen im
// Pfad brach das alte {0,300}-Cap bereits ab 229 Rohzeichen (~297 kodierte
// Zeichen) und erkannte ab 244 Rohzeichen GAR KEINEN Treffer mehr – ein
// uralter MAX_PATH-Pfad mit Leerzeichen wäre damit NICHT mehr als Link
// erkannt worden. Cap deshalb auf 1000 angehoben – deckt einen vollen
// MAX_PATH-Pfad (260 Zeichen) auch bei durchgehender Leerzeichen-Kodierung
// (260×3=780) UND die in der Praxis übliche Mischung aus ASCII/Leerzeichen/
// vereinzelten Umlauten komfortabel ab (ein rein aus mehrbytigen Umlauten
// bestehender 260-Zeichen-Pfad – ein unrealistisches Extrem – würde
// theoretisch immer noch nicht vollständig passen; das wird bewusst in Kauf
// genommen, siehe Restrisiko in docs/TESTFAELLE.md D14b). Der Faktor 3,3
// gegenüber 300 ändert NICHTS an der Backtracking-KOMPLEXITÄTSKLASSE: das
// Muster ist eine EINZELNE, flache, quantifizierte Zeichenklasse ohne
// verschachtelte/mehrdeutige Wiederholungen – ein größerer, aber weiterhin
// KONSTANTER Cap bedeutet nur einen größeren konstanten Faktor (linear in
// Zeilenlänge × Cap), kein katastrophales (exponentielles) Backtracking.
// Negativer Lookahead "(?![A-Za-z]:\/)" vor der UNC-Alternative: OHNE ihn
// würde z. B. das kaputte/unvollständige "file://C:/a.txt" (nur ZWEI Slashes
// vor dem Laufwerksbuchstaben statt der geforderten drei) fälschlich als
// UNC-Form mit Servername "C:" durchgehen ("[^\s\/]{1,300}" verlangt nichts
// weiter als "kein Whitespace/Slash" und lässt "C:" damit anstandslos als
// Servername zu). Der Lookahead schließt GENAU dieses eine Zwei-Punkt-Muster
// (ein Buchstabe + Doppelpunkt + Slash direkt nach "file://") aus der
// UNC-Alternative aus – ein Laufwerksbuchstabe ist NUR über die strikte
// Drei-Slash-Form (erste Alternative) gültig. Der Servername-Cap
// ({1,300}, VOR dem ersten "/" der UNC-Form) bleibt bewusst bei 300 – ein
// Hostname ist keine kodierte URL-Domäne und wird durch DNS ohnehin auf
// 255 Oktette begrenzt, 300 ist dafür weiterhin reichlich.
export const FILE_URL_SRC =
  "file:\\/\\/(?:\\/[A-Za-z]:\\/[^\\s]{0,1000}|(?![A-Za-z]:\\/)[^\\s\\/]{1,300}\\/[^\\s]{0,1000})";
export const FILE_URL_RE = new RegExp(FILE_URL_SRC);
// Anker-Variante für "ist dieser GANZE String eine file:-URL" – wie
// LINK_URL_FULL_RE in DocEditor.jsx (dort per "^" + LINK_URL_RE.source + "$"
// lokal gebaut) NUR intern hier gebraucht (linkifyFilePaths, Ganze-Zeile-Fall).
const FILE_URL_FULL_RE = new RegExp("^" + FILE_URL_SRC + "$");

/* ---------------- Pfad <-> file:-URL ---------------- */

// Try/catch-Wrapper: eine kaputte %-Sequenz (z. B. ein einzelnes "%" ohne
// zwei Hex-Ziffern) darf beim Anzeigen/Kopieren nie werfen – im Zweifel
// bleibt das Rohsegment unverändert stehen statt eines Crashs.
function safeDecode(seg) {
  try {
    return decodeURIComponent(seg);
  } catch (e) {
    return seg;
  }
}

// Segment-Encoder für pathToFileUrl (Review-Fix 🟡 Finding 2, gefunden beim
// Testschreiben, VOR dem Commit gemeldet): encodeURIComponent lässt "(" und
// ")" bewusst UNKODIERT (Teil seines "unreserved-ish"-Zeichensatzes) – ein
// Dateiname mit einer UNBALANCIERTEN Klammer (z. B. "a(b.docx", ein "("
// ohne eigenes schließendes Gegenstück) landete dadurch roh in der URL.
// PROTECTED_SPAN_RE (unten) erkennt "[Titel](url)" nur mit GENAU EINER
// Ebene balancierter Klammern im URL-Teil (wie LINK_URL_RE) – die rohe
// unbalancierte "(" ließ die Regex beim ZWEITEN linkifyFilePaths-Lauf die
// schließende Klammer des WRAPPERS fälschlich als Klammer-Partner der
// Datei-Klammer lesen, wodurch der bereits erzeugte Link NICHT mehr als
// geschützte Spanne erkannt und ein zweites Mal verlinkt wurde
// (Doppel-Wrap, Idempotenz gebrochen). Fix: "(" / ")" werden zusätzlich zu
// encodeURIComponent explizit zu "%28"/"%29" kodiert (entspricht der
// bestehenden Konvention für http(s)-URLs in normalizeLinkUrl,
// DocEditor.jsx) – ein roher "(" kommt in einer SELBST erzeugten file:-URL
// dadurch gar nicht mehr vor.
const encSeg = (s) => encodeURIComponent(s).replace(/\(/g, "%28").replace(/\)/g, "%29");

// pathToFileUrl("C:\Users\x\Mein Bericht.docx") -> "file:///C:/Users/x/Mein%20Bericht.docx"
// pathToFileUrl("\\server\share\datei.md")      -> "file://server/share/datei.md"
// Segmente werden EINZELN per encSeg kodiert (Leerzeichen, Umlaute, "#",
// "%", "?", "(", ")" korrekt encodiert, siehe encSeg oben) – der
// Laufwerksbuchstabe/Doppelpunkt sowie die Trennschrägstriche selbst
// bleiben roh. Sowohl "\" als auch "/" werden als Pfadtrenner akzeptiert
// (ein Nutzer/eine bereits halb umgewandelte Zeile kann beide Formen
// enthalten, siehe linkifyFilePaths unten, Regel c: "Beginn [A-Za-z]:\
// ODER [A-Za-z]:/"). Liefert null für alles, was KEIN absoluter
// Windows-Pfad ist (u. a. relative Pfade) – bewusst KEIN Fehlertext, der
// Aufrufer entscheidet, was in dem Fall passiert.
export function pathToFileUrl(winPath) {
  const p = String(winPath ?? "").trim();
  if (!p) return null;

  const uncM = /^\\\\([^\\/\s]+)[\\/](.*)$/.exec(p);
  if (uncM) {
    const [, server, rest] = uncM;
    const segs = rest.split(/[\\/]/).filter(Boolean).map(encSeg);
    return "file://" + encSeg(server) + "/" + segs.join("/");
  }

  const driveM = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (driveM) {
    const [, drive, rest] = driveM;
    const segs = rest.split(/[\\/]/).filter(Boolean).map(encSeg);
    return "file:///" + drive + ":/" + segs.join("/");
  }

  return null; // relativer Pfad o. Ä. – kein absoluter Windows-Pfad
}

// Umkehrung, für Tooltip/Zwischenablage im Viewer (FileLink, markdown.jsx):
// dekodiert %-Sequenzen zurück und setzt "/" wieder in "\" um. Erkennt der
// Aufrufer die URL nicht als eine unserer beiden Formen (z. B. weil sie von
// woanders kommt und nicht exakt der Grammatik entspricht), wird der
// ROHE Eingabewert unverändert zurückgegeben – defensiv, damit ein Tooltip
// nie leer/verzerrt wird, statt zu werfen oder null zu liefern.
export function fileUrlToWinPath(fileUrl) {
  const u = String(fileUrl ?? "");

  const driveM = /^file:\/\/\/([A-Za-z]):\/(.*)$/.exec(u);
  if (driveM) {
    const [, drive, rest] = driveM;
    const decoded = rest ? rest.split("/").map(safeDecode).join("\\") : "";
    return drive + ":\\" + decoded;
  }

  // Negativer Lookahead wie bei FILE_URL_SRC oben: ein (kaputtes/nicht
  // grammatikkonformes) "file://C:/…" mit nur ZWEI Slashes vor dem
  // Laufwerksbuchstaben soll NICHT als UNC mit Servername "C:" gedeutet
  // werden (das driveM-Muster oben verlangt dafür konsequent drei Slashes).
  const uncM = /^file:\/\/(?![A-Za-z]:\/)([^/\s]+)\/(.*)$/.exec(u);
  if (uncM) {
    const [, server, rest] = uncM;
    const decoded = rest ? rest.split("/").map(safeDecode).join("\\") : "";
    return "\\\\" + safeDecode(server) + "\\" + decoded;
  }

  return u;
}

/* ---------------- buildProtocolUrl: notizbuch-open:-Kontrakt ---------------- */

// v7.35: Browser dürfen aus https (GitHub Pages) NICHT direkt zu file://
// navigieren (siehe Kopfkommentar oben) – ein eigenes, lokal registriertes
// URL-Protokoll "notizbuch-open:" umgeht das (tools/notizbuch-open-setup.ps1
// registriert es NUR in HKCU, siehe Kopfkommentar dort für das vollständige
// Bedrohungsmodell/den Kontrakt). buildProtocolUrl baut aus einer file:-URL
// GENAU die Kontrakt-URL, die der lokale Handler
// (tools/notizbuch-open.js, seit v7.38 – siehe DECISIONS.md #79
// "Architektur-Wechsel v7.38" für den Grund des Wechsels von PowerShell
// auf Node.js) erwartet:
//   "notizbuch-open:v1?path=" + encodeURIComponent(<Windows-Pfad, Backslash>)
// Beispiel: "file:///C:/Users/x/Mein%20Bericht.docx"
//        -> "notizbuch-open:v1?path=C%3A%5CUsers%5Cx%5CMein%20Bericht.docx"
//
// Nutzt fileUrlToWinPath (dieselbe Umwandlung, die FileLink/markdown.jsx
// bereits für die Zwischenablage verwendet) statt einer zweiten, potenziell
// abweichenden Pfad-Herleitung – EIN Backslash-Pfad-Format für beide
// Mechanismen.
//
// UNC-Ziele (file://server/share/…) liefern bewusst null: fileUrlToWinPath
// liefert dafür ein "\\server\…"-Ergebnis, das NICHT dem Muster
// "^[A-Za-z]:\\" entspricht – der Handler lehnt UNC-Pfade GRUNDSÄTZLICH ab
// (SMB-Credential-Leak-Risiko, siehe dessen Kopfkommentar). Die App bietet
// das Protokoll für solche Links deshalb gar nicht erst an (FileLink löst
// dann NUR noch den bisherigen Clipboard-Copy aus, siehe markdown.jsx),
// statt einen Klick anzubieten, der beim Handler ohnehin nur mit einer
// Ablehnungs-MessageBox endet – beidseitiges UNC-Verbot, konsistent.
//
// Dieselbe Prüfung fängt zusätzlich defensiv den Fall ab, dass
// fileUrlToWinPath eine NICHT erkannte URL unverändert zurückgibt (siehe
// Kommentar dort) – auch das ist kein gültiger Windows-Laufwerkspfad und
// liefert hier konsequent null statt einer kaputten Kontrakt-URL.
export function buildProtocolUrl(fileUrl) {
  const winPath = fileUrlToWinPath(fileUrl);
  if (!/^[A-Za-z]:\\/.test(winPath)) return null;
  return "notizbuch-open:v1?path=" + encodeURIComponent(winPath);
}

/* ---------------- linkifyFilePaths: nackte Pfade/URLs -> Links ---------------- */

// Beginn eines absoluten Windows-Pfads (Regel c des Auftrags): Laufwerks-
// buchstabe gefolgt von "\" ODER "/" ("C:\" bzw. "C:/") oder eine
// UNC-Freigabe ("\\server\..."). NUR der Beginn – die Fortsetzung prüfen
// die beiden Verwendungsstellen unten (Inline: ohne Whitespace bis zur
// Endung; Ganze-Zeile: mit Whitespace erlaubt bis Zeilenende).
const WIN_PATH_START_RE = /(?:[A-Za-z]:[\\/]|\\\\[^\s\\]+\\)/;

// Geschützte Spannen, die linkifyFilePaths NIE anfasst (Regel a/b):
// Codespans ("`…`") und bereits vorhandene Markdown-Link-/Bild-Syntax
// ("[…](…)"/"![…](…)", mit EINER Ebene balancierter runder Klammern in der
// Ziel-URL wie LINK_URL_RE in markdown.jsx – Wikipedia-artige URLs). Fenced-
// Codeblöcke werden bereits VORHER über splitFenceSegments ausgenommen
// (siehe linkifyFilePaths), Codespans/Links laufen HIER als geschützte
// Spannen mit demselben split-mit-Capture-Group-Muster wie renumberCitations
// (markdown.jsx).
const PROTECTED_SPAN_RE = /(`[^`\n]+`|!?\[[^\]\n]*\]\((?:[^()\n]|\([^()\n]*\))*\))/;

// Ziel-Muster INNERHALB einer Zeile, OHNE Whitespace (Regel c): Windows-Pfad
// bis zu einer Datei-Endung ("\.[A-Za-z0-9]{1,10}") ODER eine nackte
// file:-URL. Lookbehind/Lookahead auf "\w" verhindern Wortmitte-Treffer
// (z. B. "seeC:\a.txt" wird NICHT angetastet, weil "C" direkt auf einen
// Wortzeichen folgt).
const INLINE_TARGET_RE = new RegExp(
  "(?<![\\w])(?:" +
    WIN_PATH_START_RE.source + "[^\\s]{0,300}\\.[A-Za-z0-9]{1,10}(?![\\w])" +
    "|" + FILE_URL_SRC +
    ")",
  "g"
);

// Ganze-Zeile-Muster (Regel d): wie oben, aber der Pfad-Körper darf
// Leerzeichen enthalten (häufigster Paste-Fall: kompletter Pfad allein auf
// einer Zeile) – dafür ANKERT das Muster auf die komplette (bereits
// getrimmte) Zeile ("^…$"), ein Whitespace-Rest am Rand ist also
// ausgeschlossen (der Aufrufer trimmt vorher selbst und hängt die
// ursprüngliche Umgebung wieder an, siehe linkifyWholeLine).
const WHOLE_LINE_WIN_PATH_RE = new RegExp(
  "^" + WIN_PATH_START_RE.source + "[\\s\\S]{0,300}\\.[A-Za-z0-9]{1,10}$"
);

// Aus dem letzten Pfad-/URL-Segment den Dateinamen OHNE die (letzte)
// Endung ableiten – z. B. "Report.final.docx" -> "Report.final" (nur die
// LETZTE Endung fällt weg, wie beim Betriebssystem-Explorer).
function basenameNoExt(winPath) {
  const segs = String(winPath).split(/[\\/]/).filter(Boolean);
  const last = segs.length ? segs[segs.length - 1] : String(winPath);
  return last.replace(/\.[A-Za-z0-9]{1,10}$/, "");
}

// Baut aus einem rohen Treffer (entweder schon eine file:-URL ODER ein
// Windows-Pfad) das fertige "[Titel](file:///…)"-Markdown. Liefert null,
// wenn der Treffer sich (defensiv, sollte bei einem Regex-Treffer nicht
// vorkommen) nicht in eine gültige file:-URL umwandeln lässt – der Aufrufer
// lässt den Originaltext dann unangetastet stehen statt etwas Falsches
// einzusetzen.
function buildFileLinkMarkdown(raw) {
  let url;
  let winPath;
  if (FILE_URL_FULL_RE.test(raw)) {
    url = raw;
    winPath = fileUrlToWinPath(raw);
  } else {
    winPath = raw;
    url = pathToFileUrl(raw);
    if (!url) return null;
  }
  const title = basenameNoExt(winPath);
  if (!title) return null; // z. B. ein Pfad, der auf "\"/"/" endet
  return "[" + title + "](" + url + ")";
}

// Wortzahl-Obergrenze je Pfad-SEGMENT (Review-Fix 🔴 Finding 1, v7.31,
// ursprünglich NUR für den Ganze-Zeile-Fall unten, siehe linkifyWholeLine –
// seit dem Review-Fix zu den zitierten Pfaden (v7.37, Runde 2) auch DORT
// wiederverwendet, siehe linkifyQuotedPathsInSegment): ein legitimer
// Ordner-/Dateiname mit Leerzeichen hat realistisch wenige Wörter ("Max
// Mustermann", "Mein Bericht.docx"); ein SATZ, der zufällig direkt nach
// einem kurzen Pfad-Anfang ohne weiteren Trennschrägstrich weiterläuft
// ("C:\temp ist der Ordner fuer report.docx" – EIN Segment mit sechs
// Wörtern), hat deutlich mehr. Bewusst großzügig gewählt: ein längerer,
// aber echter mehrwortiger Dateiname bleibt im Zweifel lieber Klartext
// (False Negative, sicher) statt dass ein Satz fälschlich verlinkt wird
// (False Positive, zerstört Nutzertext beim dokumentweiten Self-Healing,
// siehe App.jsx). Deshalb VOR die Zitierte-Pfade-Sektion verschoben (war
// bis Review-Runde 2 weiter unten, direkt bei linkifyWholeLine).
const WORDS_PER_SEGMENT_CAP = 5;

/* ---------------- Zitierte Pfade (v7.37) ---------------- */
//
// Nutzer-Befund Live: Windows liefert einen Pfad bei "Als Pfad kopieren"
// (Explorer, Umschalt+Rechtsklick) IN doppelten Anführungszeichen, z. B.
// "C:\Users\x\OneDrive - Firma\Bericht.docx" – genau SO fügt ein Nutzer ihn
// typischerweise ein. Weder die Inline-Regel (c, verlangt Whitespace-
// Freiheit) noch die Ganze-Zeile-Regel (d, verlangt, dass die getrimmte
// Zeile GENAU mit dem Pfad beginnt – ein führendes Anführungszeichen bricht
// diesen Anker) erkennen das, selbst wenn man die Anführungszeichen entfernen
// würde, kämen zusätzlich noch die PROSA-SCHUTZ-Guards aus Regel d
// (WORDS_PER_SEGMENT_CAP etc., siehe oben) ins Spiel.
//
// SONDERBEHANDLUNG: Ein in Anführungszeichen eingeschlossener absoluter
// Pfad wird verlinkt – inline, an beliebiger Stelle im Text, unabhängig von
// Leerzeichen. Begründung: Die Anführungszeichen sind (meistens) ein vom
// NUTZER bewusst gesetzter, eindeutiger Begrenzer. **Review-Fix Runde 2
// (🟡 A1/A2, Sicherheits-/Qualitäts-Review, VOR dem Commit gemeldet):**
// Die ursprüngliche v7.37-Fassung verzichtete DESHALB komplett auf die
// Prosa-Guards aus Regel d – das war zu weitgehend: Anführungszeichen
// werden in echtem Fließtext auch für PROSA-ZITATE verwendet, die zufällig
// mit einem gültigen Laufwerks-/UNC-Anfang beginnen können, z. B.
// `Er sagte: "C:\Windows ist der Systemordner und darf nie geloescht
// werden" und ging.` – das komplette Zitat wäre sonst zu einem einzigen,
// den Nutzertext irreversibel umschreibenden Link verschluckt worden
// (exakt dieselbe Schadensklasse wie Finding 1 in v7.31, nur diesmal durch
// die Anführungszeichen statt durch die Zeilen-Anker ausgelöst). Ein
// zweiter Fall belegte zusätzlich, dass UNBALANCIERTE Anführungszeichen
// (z. B. drei "-Zeichen in einer Zeile statt eines geraden Paars) Text
// zwischen zwei UNZUSAMMENGEHÖRIGEN Zitaten fälschlich verschluckten. Die
// Guards unten (siehe linkifyQuotedPathsInSegment) beheben BEIDE Fälle,
// OHNE die Erkennung der eigentlichen Nutzer-Pfade einzuschränken (Live-
// Fall "OneDrive - Planon" bleibt grün) – konsistent mit v7.31: Prosa-
// Schutz schlägt Erkennungsrate.
//
// Datei-ENDUNG NICHT zwingend erforderlich (anders als Inline-/Ganze-Zeile-
// Regel c/d): ein zitierter ORDNER-Pfad ist genauso eindeutig abgegrenzt wie
// ein zitierter Datei-Pfad (die Anführungszeichen allein reichen als
// Begrenzung, nicht die Endung) – und der Handler
// (tools/notizbuch-open.js, seit v7.38) öffnet Ordner ausdrücklich.
//
// Die Anführungszeichen werden beim Ersetzen ENTFERNT (nicht um den
// fertigen Link herum stehen gelassen): '"[Bericht](file:///…)"' sähe mit
// zusätzlichen Anführungszeichen um einen bereits farbig/unterstrichen
// hervorgehobenen Link unnötig unruhig aus – kein anderer Fall dieser
// Heuristik umgibt den erzeugten Link mit zusätzlicher Interpunktion, das
// bleibt hier konsistent.
//
// TYPOGRAFISCHE Anführungszeichen werden GLEICHERMASSEN unterstützt
// (Review-Fix 🟡 A3): Der System-Prompt schreibt dem Modell im
// Dokumenttext ausdrücklich "typografische Anführungszeichen" vor (siehe
// anthropic.js) – ein vom Modell selbst geschriebener zitierter Pfad in
// „…" (deutsche Konvention) wäre von einer rein ASCII-basierten Regel NIE
// erkannt worden. OEFFNER-Klasse ("/„/") und SCHLIESSER-Klasse ("/"/")
// überschneiden sich bewusst in "（U+201C) statt eine strikte, konventions-
// abhängige Öffner/Schließer-PAARUNG zu erzwingen (deutsch „…", englisch
// "…") – es geht nur darum, EINEN zitierten Pfad zu erkennen, nicht
// typografische Korrektheit zu prüfen; ein "gemischtes" Paar wie „…"
// funktioniert also ebenfalls.
const QUOTE_OPEN_RE_SRC = '["\u201E\u201C]';
const QUOTE_CLOSE_RE_SRC = '["\u201C\u201D]';
// Der Pfad-KÖRPER schließt ALLE unterstützten Anführungszeichen-Glyphen aus
// (nicht nur die konkrete Öffner-Glyphe DIESES Treffers) – sonst könnte er
// über eine ANDERE Anführungszeichen-Art hinaus konsumieren, falls beide
// Stile im selben Text gemischt vorkommen.
const QUOTED_PATH_BODY_EXCLUDE = '"\u201C\u201D\u201E';
//
// Lookbehind "(?<![\w])" (Review-Fix 🔵 A4, dieselbe Wortmitte-Absicherung
// wie bei INLINE_TARGET_RE oben): OHNE ihn würde z. B. `sieh"C:\a\b.txt"an`
// (das öffnende Anführungszeichen klebt direkt an einem Wortzeichen) den
// Pfad trotzdem erkennen – analog zu "seeC:\a.txt" beim unquotierten
// Inline-Fall bewusst NICHT gewünscht. Am SCHLIESSENDEN Anführungszeichen
// ist dagegen KEIN analoger Lookahead nötig: das schließende Zeichen ist
// bereits ein eindeutiger, vom Nutzer gesetzter Begrenzer (anders als beim
// unquotierten Fall, wo der Wortmitte-Schutz die EINZIGE Abgrenzung ist) –
// direkt danach folgender Text wie in `"Bugfix"artig` ist normale,
// legitime Prosa und kein Erkennungsproblem.
//
// Cap {0,300} auf den ROHEN (nicht kodierten) Pfad-Körper zwischen den
// Anführungszeichen – dieselbe Backtracking-Überlegung wie bei
// WHOLE_LINE_WIN_PATH_RE (flache, quantifizierte Zeichenklasse ohne
// Verschachtelung, linear in der Textlänge): 300 rohe Zeichen sind für
// einen MAX_PATH-Pfad (260) reichlich (anders als der {0,1000}-Cap in
// FILE_URL_SRC, der auf bereits PROZENT-KODIERTEN Text wirkt, siehe
// Kommentar dort – hier ist der Pfad noch roh, keine Kodierungs-Expansion).
// Die Suche endet zwangsläufig am nächsten Anführungszeichen (jeder
// unterstützten Art), ohne dass eine (lazy-artige) Rückwärtssuche nötig wäre.
const QUOTED_WIN_PATH_RE = new RegExp(
  "(?<![\\w])" + QUOTE_OPEN_RE_SRC +
    "(" + WIN_PATH_START_RE.source + "[^" + QUOTED_PATH_BODY_EXCLUDE + "\\n]{0,300})" +
    QUOTE_CLOSE_RE_SRC,
  "g"
);

// Wendet die Zitierte-Pfade-Regel auf EIN Text-Segment außerhalb jedes
// Fenced-Codeblocks an (derselbe Aufrufkontext wie linkifySegment unten) –
// respektiert dieselben geschützten Spannen (Codespans/bestehende Links,
// Regel a/b) über eine EIGENE PROTECTED_SPAN_RE-Aufteilung: ein zitierter
// Pfad INNERHALB eines Codespans (z. B. "`\"C:\\a.txt\"`") bleibt dadurch
// unangetastet. Läuft bewusst als SEPARATER, VORGELAGERTER Durchlauf vor
// linkifySegment (siehe linkifyFilePaths) – nicht als weitere Alternative
// innerhalb von INLINE_TARGET_RE/linkifyWholeLine, weil die Zitierte-Pfade-
// Regel strukturell andere Eigenschaften hat (kein Whitespace-Verbot, keine
// Endungspflicht). IDEMPOTENT: Ein bereits erzeugter Link "[Titel](file:///
// …)" enthält keine Anführungszeichen mehr (die wurden ja entfernt) und
// wird beim zweiten Lauf schon von der eigenen PROTECTED_SPAN_RE-Aufteilung
// hier ALS GESCHÜTZTE SPANNE erkannt, lange bevor QUOTED_WIN_PATH_RE
// überhaupt zum Zug käme.
//
// PROSA-GUARDS (Review-Fix Runde 2, 🟡 A1/A2 – siehe Begründung oben,
// gefunden VOM REVIEWER beim Testschreiben, VOR dem Commit gemeldet): DREI
// Signale werden geprüft, JEDES MUSS fehlen, sonst bleibt der Treffer
// unangetastet Klartext (`m`, der komplette Roh-Treffer INKLUSIVE
// Anführungszeichen, wird unverändert zurückgegeben – kein Textverlust):
// (a) der Körper endet auf ein Leerzeichen – ein ECHTER Windows-Pfad endet
//     nie auf Leerzeichen (siehe auch Schritt 2b im PowerShell-Handler,
//     dieselbe Prämisse); ein Prosa-Zitat, das zufällig VOR dem
//     schließenden Anführungszeichen noch normalen Text hat, endet dagegen
//     fast immer auf ein Leerzeichen-getrenntes Wort. Fängt zusätzlich den
//     Unbalanciert-Quotes-Fall (A2) ab: ein "verschluckendes" Match bis zum
//     NÄCHSTEN (eigentlich unzusammengehörigen) Anführungszeichen hat an
//     der Bruchstelle so gut wie immer ein Leerzeichen davor.
// (b) der Körper (ab dem dritten Zeichen, ALSO NACH Laufwerksbuchstabe +
//     ":") enthält eines der in Windows-Dateinamen verbotenen Zeichen
//     `: * ? < > |` – ein Doppelpunkt MITTEN im Text (z. B. "D: die
//     Datenpartition") verrät zuverlässig, dass der Rest kein Pfad-Körper
//     mehr ist, sondern Prosa. Der ERSTE Doppelpunkt (Laufwerksbuchstabe)
//     wird bewusst NICHT mitgeprüft (core.slice(2) überspringt "X:").
// (c) ein Pfad-SEGMENT mit mehr als WORDS_PER_SEGMENT_CAP Wörtern – exakt
//     derselbe, bereits bewährte dritte Guard wie im unquotierten
//     Ganze-Zeile-Fall (siehe linkifyWholeLine unten), hier wiederverwendet
//     statt dupliziert.
// Zusätzlich (d): ein bloßer Laufwerks-WURZELPFAD ohne jeden weiteren
// Inhalt (z. B. `"C:\"`) wird abgelehnt (Review-Fix 🔵 A5) – kein echter
// Datei-/Ordnername, den ein Nutzer sinnvoll zitieren würde, der Titel
// wäre nur der nackte Laufwerksbuchstabe. Ein Pfad MIT Inhalt, der auf
// einen Trennstrich endet (z. B. `"C:\Users\x\"`), bleibt dagegen bewusst
// ERLAUBT – der abgeleitete Titel ("x") ist sinnvoll, ein häufiger,
// legitimer Copy-Paste-Fall (Ordnerpfad mit Trailing-Backslash aus der
// Explorer-Adressleiste).
const QUOTED_PATH_ROOT_ONLY_RE = /^[A-Za-z]:[\\/]$/;
const QUOTED_PATH_FORBIDDEN_CHARS_RE = /[:*?<>|]/;

function linkifyQuotedPathsInSegment(raw) {
  const chunks = raw.split(PROTECTED_SPAN_RE);
  return chunks
    .map((chunk, ci) =>
      ci % 2
        ? chunk // geschützte Spanne: byte-genau unangetastet
        : chunk.replace(QUOTED_WIN_PATH_RE, (m, core) => {
            if (/ $/.test(core)) return m; // (a)
            if (QUOTED_PATH_FORBIDDEN_CHARS_RE.test(core.slice(2))) return m; // (b)
            if (
              core.split(/[\\/]/).some(
                (seg) => seg.trim().split(/\s+/).filter(Boolean).length > WORDS_PER_SEGMENT_CAP
              )
            ) {
              return m; // (c)
            }
            if (QUOTED_PATH_ROOT_ONLY_RE.test(core)) return m; // (d)
            return buildFileLinkMarkdown(core) ?? m;
          })
    )
    .join("");
}

// WORDS_PER_SEGMENT_CAP ist jetzt WEITER OBEN definiert (vor der Zitierte-
// Pfade-Sektion) – seit Review-Fix Runde 2 (v7.37) wird derselbe Guard
// AUCH von linkifyQuotedPathsInSegment verwendet, keine zweite Konstante
// mehr nötig.

// Ganze Zeile prüfen (Regel d) – "line" ist eine VOLLSTÄNDIGE Original-Zeile
// (der Aufrufer stellt das sicher, siehe linkifySegment). Liefert die
// ersetzte Zeile (inkl. wiederhergestelltem Rand-Whitespace) oder null, wenn
// die Zeile NICHT komplett aus einem Pfad/einer file:-URL besteht – der
// Aufrufer versucht dann stattdessen die Inline-Regel auf dieselbe Zeile.
//
// PROSA-SCHUTZ (Review-Fix 🔴 Finding 1, gefunden beim Testschreiben/vom
// Code-Reviewer, VOR dem Commit gemeldet): WHOLE_LINE_WIN_PATH_RE oben
// erlaubt Leerzeichen im Pfad-Körper (Regel d des Auftrags) – das lässt sich
// nicht von einer kompletten PROSA-Zeile unterscheiden, die zufällig mit
// einem Pfad beginnt und mit einer datei-endungs-artigen Sequenz endet.
// Drei Signale dagegen, alle MÜSSEN fehlen, sonst bleibt die Zeile Klartext
// (False Negative ist sicher, ein False Positive zerstört Nutzertext beim
// dokumentweiten Self-Healing, siehe App.jsx):
// (a) ein WEITERER Pfad-Start nach einem Leerzeichen mitten in der Zeile
//     (zwei Pfade in einem Satz, z. B. "C:\a\Eins.txt, dann C:\b\Zwei.pdf");
// (b) eine endungsartige Sequenz VOR dem Zeilenende, der noch Text folgt
//     (z. B. "C:\Users\x\Report.docx enthaelt die Zahlen zu plan.xlsx" –
//     ".docx" ist hier keine echte Endung, sondern mitten im Satz);
// (c) ein Pfad-SEGMENT mit zu vielen Wörtern (WORDS_PER_SEGMENT_CAP oben) –
//     deckt den Fall ab, den (a) und (b) NICHT erkennen: "C:\temp ist der
//     Ordner fuer report.docx" hat weder einen zweiten Pfad-Start noch eine
//     Endung mitten im Satz (die einzige Endung steht korrekt am Ende!),
//     ist aber trotzdem ein kompletter Satz, kein Dateiname.
// Bewusste Folge (siehe DECISIONS #73): "C:\a\Bericht v1.2 final.docx"
// (Leerzeichen VOR der echten Endung, aber < 6 Wörter im letzten Segment)
// bleibt fälschlich Klartext – eine hingenommene Grenze der Heuristik.
function linkifyWholeLine(line) {
  const leadWS = /^\s*/.exec(line)[0];
  const trailWS = /\s*$/.exec(line)[0];
  const core = line.slice(leadWS.length, line.length - trailWS.length);
  if (!core) return null;
  if (!WHOLE_LINE_WIN_PATH_RE.test(core) && !FILE_URL_FULL_RE.test(core)) return null;
  if (new RegExp("\\s" + WIN_PATH_START_RE.source).test(core)) return null; // (a)
  if (/\.[A-Za-z0-9]{1,10}(?=\s)/.test(core)) return null; // (b)
  if (core.split(/[\\/]/).some((seg) => seg.trim().split(/\s+/).filter(Boolean).length > WORDS_PER_SEGMENT_CAP)) {
    return null; // (c)
  }
  const link = buildFileLinkMarkdown(core);
  return link ? leadWS + link + trailWS : null;
}

// Trailing-Satzzeichen (Review-Fix 🟡 Finding 3, gefunden beim
// Testschreiben/vom Code-Reviewer, VOR dem Commit gemeldet): anders als der
// Windows-Pfad-Zweig (dessen Endungs-Gruppe "\.[A-Za-z0-9]{1,10}" ohnehin nur
// alphanumerische Zeichen konsumiert und daher nie mit einem Satzzeichen
// endet) ist der Körper der nackten file:-URL-Alternative
// "[^\s]{0,300}" UNGEBUNDEN bis zum nächsten Whitespace – ein Satzpunkt
// direkt hinter einer nackten "file:///…"-URL ("Siehe file:///C:/x/a.docx.
// dazu.") landete dadurch als Teil der URL/des Dateinamens. Analog zu
// trimBareUrl (linkProviders.jsx, für http(s)-URLs im Fließtext) werden
// abschließende Satzzeichen VOR dem Verlinken abgetrennt und danach wieder
// angehängt – ein GFM-ähnliches, aber bewusst einfacheres Trimming (keine
// Klammer-Bilanz-Prüfung nötig: eine SELBST erzeugte file:-URL enthält seit
// dem Finding-2-Fix oben nie mehr eine rohe, unbalancierte Klammer).
const TRAILING_PUNCT_RE = /[.,;:!?]+$/;

function linkifyInline(line) {
  return line.replace(INLINE_TARGET_RE, (m) => {
    const trailM = TRAILING_PUNCT_RE.exec(m);
    const trail = trailM ? trailM[0] : "";
    const core = trail ? m.slice(0, -trail.length) : m;
    return (buildFileLinkMarkdown(core) ?? core) + trail;
  });
}

// Ein Text-Segment AUSSERHALB jedes Fenced-Codeblocks (siehe linkifyFilePaths
// unten) verarbeiten: erst geschützte Spannen (Codespans/bestehende Links,
// Regel a/b) ausklammern, dann für jeden verbleibenden Klartext-Teil
// zeilenweise entscheiden, ob die Ganze-Zeile-Regel (d) oder nur die
// Inline-Regel (c) greift.
//
// Ein Klartext-"chunk" zwischen zwei geschützten Spannen KANN mehrere Zeilen
// enthalten (eine geschützte Spanne selbst enthält nie "\n", siehe
// PROTECTED_SPAN_RE) – die ERSTE Zeile eines chunks ist nur dann eine
// VOLLSTÄNDIGE Original-Zeile, wenn der chunk der ALLERERSTE im Segment ist
// (sonst grenzt links eine geschützte Spanne MITTEN in derselben Zeile an);
// symmetrisch ist die LETZTE Zeile eines chunks nur beim ALLERLETZTEN chunk
// vollständig. Zeilen STRIKT DAZWISCHEN (weder erste noch letzte Zeile des
// chunks) sind dagegen IMMER vollständige Original-Zeilen, weil eine
// geschützte Spanne (ohne "\n") einen internen Zeilenumbruch nie verursacht
// haben kann.
function linkifySegment(raw) {
  const chunks = raw.split(PROTECTED_SPAN_RE);
  const lastChunkIdx = chunks.length - 1;
  return chunks
    .map((chunk, ci) => {
      if (ci % 2) return chunk; // geschützte Spanne: byte-genau unangetastet
      const lines = chunk.split("\n");
      const lastLineIdx = lines.length - 1;
      return lines
        .map((line, li) => {
          const isCompleteLine = (li > 0 || ci === 0) && (li < lastLineIdx || ci === lastChunkIdx);
          if (isCompleteLine) {
            const whole = linkifyWholeLine(line);
            if (whole !== null) return whole;
          }
          return linkifyInline(line);
        })
        .join("\n");
    })
    .join("");
}

// linkifyFilePaths(md): wandelt nackte absolute Windows-Pfade und nackte
// file:///-URLs in "[Basename-ohne-Endung](file:///…)"-Links um. Läuft bei
// jedem Schreiben in derselben Kette wie renumberCitations (siehe App.jsx) –
// Fenced-Codeblöcke bleiben über splitFenceSegments (code.jsx, gleiches
// Muster wie renumberCitations in markdown.jsx) komplett unangetastet,
// Codespans/bestehende Links über PROTECTED_SPAN_RE (siehe linkifySegment).
// IDEMPOTENT (Regel e): ein bereits erzeugter Link "[Titel](file:///…)" ist
// beim zweiten Lauf eine geschützte Spanne (PROTECTED_SPAN_RE) und wird
// unverändert übersprungen.
//
// ZITIERTE PFADE (v7.37, siehe eigener Abschnitt oben "Zitierte Pfade"):
// Ein in doppelte Anführungszeichen eingeschlossener absoluter Pfad läuft
// VOR der unquotierten Heuristik unten und ist von FAST ALLEN Grenzen
// dieses Abschnitts ausgenommen (kein Whitespace-Verbot, keine
// Endungspflicht, keine Prosa-Guards) – siehe QUOTED_WIN_PATH_RE/
// linkifyQuotedPathsInSegment weiter oben für die vollständige Begründung.
//
// GRENZEN DER (unquotierten) HEURISTIK (bewusst, siehe Auftrag):
// - Pfade/Ordner OHNE Datei-Endung werden UNQUOTIERT inline NIE angefasst
//   (Regel c verlangt zwingend eine Endung) – ein Verzeichnispfad wie
//   "C:\Users\x\Projekt" bleibt Klartext. Grund: ohne Endung lässt sich ein
//   Pfad im Fließtext nicht zuverlässig von umgebender Prosa abgrenzen
//   (wo genau hört er auf?) – der Ganze-Zeile-Fall (Regel d) hat dasselbe
//   Endung-Erfordernis, aus demselben Grund. Ein ZITIERTER Ordnerpfad
//   (siehe oben) IST dagegen erkannt, weil die Anführungszeichen die
//   Abgrenzung übernehmen, keine Endung nötig ist.
// - Ein file:-Pfad/-URL, der VOR dem allerersten Segment-/Zeilenzeichen von
//   einem Wortzeichen "berührt" wird (siehe Lookbehind), wird bewusst NICHT
//   erkannt ("keine Wortmitte-Treffer") – das kann in seltenen Fällen einen
//   echten, aber ungewöhnlich eingebetteten Pfad übersehen.
// - Literale runde Klammern IM Dateinamen (z. B. Windows' automatisches
//   "Kopie (1).docx") werden zu "%28"/"%29" kodiert (encSeg, pathToFileUrl,
//   siehe Kommentar dort/Review-Fix Finding 2) – NICHT roh gelassen: eine
//   unbalancierte Klammer hätte PROTECTED_SPAN_RE beim zweiten Lauf daran
//   gehindert, den bereits erzeugten Link als geschützte Spanne zu erkennen
//   (Idempotenz-Bruch, per Regressionstest gepinnt).
// - Der Ganze-Zeile-Fall (Regel d) erkennt einen Pfad NUR, wenn die
//   getrimmte Zeile GENAU DAMIT beginnt (WIN_PATH_START_RE bzw. FILE_URL_RE
//   verankert an "^") – eine List-/Zitat-Zeile wie "- C:\Users\x\Bericht.docx"
//   oder "> C:\Users\x\Bericht.docx" beginnt stattdessen mit dem
//   Marker-Zeichen ("-"/"> ") und bleibt deshalb bewusst Klartext (die
//   Inline-Regel (c) greift hier ebenfalls nicht, weil der Pfad in diesem
//   Beispiel Leerzeichen enthält). Ein Nutzer, der einen Pfad in einen
//   Listenpunkt einfügen will, muss ihn also ohne umgebende Leerzeichen
//   schreiben (Regel c greift dann) oder ihn manuell verlinken.
// - PROSA-SCHUTZ im Ganze-Zeile-Fall (drei Guards, siehe linkifyWholeLine):
//   selbst danach bleiben Grenzfälle bewusst Klartext, z. B. ein echter,
//   aber sehr wortreicher Dateiname mit mehr als WORDS_PER_SEGMENT_CAP
//   Wörtern in einem Segment ("C:\a\Bericht v1.2 final.docx" o. Ä.) – siehe
//   DECISIONS für die vollständige Begründung.
export function linkifyFilePaths(md) {
  const text = String(md ?? "");
  return splitFenceSegments(text)
    .map((seg) => {
      if (seg.code) return seg.raw;
      // Zitierte Pfade (v7.37) laufen ZUERST, als eigener, vollständig
      // isolierter Durchlauf (siehe linkifyQuotedPathsInSegment oben) –
      // linkifySegment (unquotierte Heuristik) verarbeitet danach das
      // ERGEBNIS: ein dabei frisch erzeugter Link "[Titel](file:///…)"
      // wird von linkifySegments EIGENER PROTECTED_SPAN_RE-Aufteilung
      // korrekt als bereits fertige, geschützte Spanne erkannt und nicht
      // ein zweites Mal angefasst (kein Doppel-Wrap, kein Hineinpfuschen
      // in die frisch gebaute URL).
      return linkifySegment(linkifyQuotedPathsInSegment(seg.raw));
    })
    .join("\n");
}
