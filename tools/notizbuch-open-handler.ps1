<#
====================================================================
notizbuch-open-handler.ps1  (Kontrakt v1, Notizbuch-App v7.35)
====================================================================
ENCODING: UTF-8 MIT BOM (bewusst, nicht die sonst im Projekt uebliche
  BOM-lose Variante) - Windows PowerShell 5.1 (die Registry startet
  GENAU diese Engine, siehe notizbuch-open-setup.ps1) erkennt eine
  BOM-lose UTF-8-Datei nicht zuverlaessig und kann Nicht-ASCII-Zeichen
  in String-Literalen (z. B. deutsche Umlaute in einer MessageBox)
  verstuemmeln. Beim Bearbeiten IMMER als "UTF-8 mit BOM" speichern -
  ein Editor, der die BOM beim Speichern entfernt, reisst diesen Schutz
  wieder ein.

ZWECK
  Handler fuer das eigene URL-Protokoll "notizbuch-open:". Die App laeuft
  auf GitHub Pages (https) und darf aus dem Browser heraus NICHT direkt
  zu "file://..." navigieren (Browser blockieren das aus
  Sicherheitsgruenden, siehe Kopfkommentar in src/lib/filelinks.js). Ein
  file:-Link baut deshalb ZUSAETZLICH eine
  "notizbuch-open:v1?path=<encodeURIComponent(Windows-Pfad, Backslash-
  Form)>"-URL (buildProtocolUrl, src/lib/filelinks.js). Nach einmaliger
  Einrichtung (notizbuch-open-setup.ps1) fragt der Browser beim ERSTEN
  Klick, ob dieses Protokoll geoeffnet werden darf; ab dann ruft Windows
  GENAU DIESES Skript mit der KOMPLETTEN URL als einzigem Argument (%1)
  auf (siehe Registry-Befehl in notizbuch-open-setup.ps1) - exakt die
  Doppelklick-Semantik des Explorers (registriertes Standardprogramm).

BEDROHUNGSMODELL (SICHERHEITSKRITISCH - bitte vor Aenderungen lesen)
  Nach der Einrichtung kann PRINZIPIELL JEDE Webseite (nicht nur diese
  App!) nach einem Nutzer-Klick eine "notizbuch-open:..."-URL feuern -
  der registrierte Handler ist system-/browserweit fuer den angemeldeten
  Windows-Benutzer aktiv, nicht auf diese App beschraenkt. Dieses Skript
  ist deshalb die EINZIGE Verteidigungslinie gegen einen boesartig
  praeparierten Link, der versucht, ueber diesen Umweg beliebige
  Dateien/Programme auf dem Rechner des Nutzers zu oeffnen/auszufuehren.

  ARCHITEKTUR: POSITIVLISTE, NICHT (mehr) SPERRLISTE (Review-Nachbesserung
  3, siehe DECISIONS.md #79 fuer den vollstaendigen Beleg). Eine fruehere
  Fassung dieses Skripts sperrte NUR bekannte gefaehrliche Endungen
  (Blocklist) - ein systematischer Probelauf mit 94 real existierenden
  Windows-Dateiendungen belegte, dass DIESER Ansatz nicht gewinnbar ist:
  88 von 94 Endungen liefen unter der Sperrliste als "OK" durch, u. a.
  .py/.pyw (Python-Interpreter fuehrt den Code aus), .rdp (Remote-Desktop-
  Verbindung zu einem angreifergewaehlten Host), .iqy/.slk (Excel holt
  beim Oeffnen eine REMOTE-URL nach - dasselbe SMB-/WebDAV-Credential-Leck,
  das Schritt 1 fuer UNC-Pfade eigentlich schliessen soll), .mam/.accde
  (Access mit Makro-/VBA-Code), .diagpkg/.diagcfg (startet msdt.exe -
  Windows liefert allein unter System32 21 solcher Dateien selbst mit
  aus), .psc1/.pssc/.ps1xml (PowerShell-Konsolen-/Session-Konfiguration),
  .cer/.crt/.pfx/.p12 (Zertifikats-Installationsdialog) und weitere. Jede
  Ergaenzung der Sperrliste liess die naechste, strukturell gleichartige
  Geschwister-Endung offen (z. B. wurden .xla/.xlam/.ppam als
  Office-Add-Ins mit Makro-Ausfuehrung beim Sperrlisten-Update schlicht
  vergessen) - das Prinzip selbst ist die Schwachstelle, nicht eine
  einzelne vergessene Endung.

  Deshalb jetzt der umgekehrte, FAIL-CLOSED-Ansatz: NUR Endungen aus einer
  explizit gepflegten POSITIVLISTE ($script:AllowedExtensions, Schritt 4)
  werden geoeffnet - ALLES andere (inkl. jeder heute noch unbekannten,
  kuenftigen Endung) wird ABGELEHNT, mit einer MessageBox, die auf die
  bereits versuchte Zwischenablage-Kopie verweist (die App kopiert bei
  JEDEM Klick, siehe FileLink/markdown.jsx - schlaegt die Zwischenablage
  im Einzelfall fehl, z. B. weil der Browser sie verweigert, bleibt davon
  unberuehrt zumindest die MessageBox als Hinweis). Praktische Folge fuer
  den Nutzer:
  file:-Links auf Formate ausserhalb der Positivliste (z. B. eine .py-
  Datei) oeffnen sich NICHT mehr automatisch per Klick - das ist eine
  BEWUSSTE Design-Entscheidung (Sicherheit vor Bequemlichkeit fuer den
  seltenen Fall), keine Einschraenkung, die sich per Sperrlisten-Tuning
  wieder aufloesen liesse.

  Alle Validierungsschritte unten MUESSEN vor jedem Oeffnen greifen, in
  GENAU dieser Reihenfolge (siehe Test-NotizbuchOpenUrl):
    1. NUR absolute Laufwerkspfade ("C:\...") - UNC-Pfade
       ("\\server\share\...") werden ABGELEHNT: Ein Zugriff auf eine
       UNC-Freigabe schickt automatisch die aktuellen Anmeldeinformationen
       des angemeldeten Benutzers per SMB-Handshake an den Zielserver -
       ein boesartiger Link mit einem Pfad auf einen vom Angreifer
       kontrollierten Server koennte darueber NTLM-Hash-/Credential-
       Material abgreifen (bekannte "UNC-Path-Injection"-Angriffsklasse,
       seit Jahren u. a. ueber Office-Dokumente/Browser-Downloads
       ausgenutzt). Ein einfaches "keine \\-Pfade" VERRINGERT dieses
       Risiko fuer den ueblichen Fall deutlich, OHNE die eigentliche
       Funktion (lokale Dateien oeffnen) einzuschraenken - schliesst es
       aber NICHT restlos: ein vom Nutzer bereits zugeordnetes Netzlaufwerk
       (z. B. "Z:" fuer "\\server\share") sieht fuer diesen Pruefschritt
       wie ein ganz normaler Laufwerksbuchstabe aus und wird NICHT als UNC
       erkannt - bekanntes, dokumentiertes Restrisiko (siehe Restrisiken,
       DECISIONS.md #79), kein voelliger Schutz. Die Positivliste
       (Schritt 4) hilft hier zusaetzlich: Formate, die INTERN selbst
       wieder auf eine UNC-/WebDAV-Adresse zeigen koennten (.iqy, .slk,
       .scf, .library-ms, .theme, ...), stehen schlicht NICHT auf der
       Liste.
    2. Keine ".."-Segmente (Split auf BEIDE Trennzeichen "\" UND "/" -
       Windows akzeptiert beide gleichwertig als Pfadtrenner, ein Split
       nur auf "\" liesse ein Segment wie "Public/../../Windows"
       unentdeckt durch), keine Steuerzeichen/Nullbytes, keine
       erkennbaren Umgebungsvariablen-Platzhalter. Das %-Muster ist
       ENG an eine echte Variablennamen-Form angelehnt
       ("%[A-Za-z_][A-Za-z0-9_()]{0,63}%") statt eines pauschalen
       "irgendwo zwei %-Zeichen" - Letzteres lehnte nachweislich legitime
       Dateinamen mit zwei Prozentzeichen ab (z. B. "50% Rabatt 100%.txt",
       "Anteil 5%-10% Analyse.txt").
    2b. Kanonisierungs-/Namespace-Tricks, die eine Pruefung auf dem ROHEN
        (unkanonisierten) String umgehen wuerden:
        (a) Pfad endet auf Leerzeichen/Punkt ("datei.txt " / "datei.txt."):
            Windows entfernt beide beim TATSAECHLICHEN Dateizugriff, eine
            gegen den ROHEN String gepruefte Endung wuerde das NICHT
            erkennen.
        (b) Alternate Data Stream (ein weiterer ":" nach dem
            Laufwerksbuchstaben, z. B. "datei.txt:strom" oder
            "datei.txt::$DATA"): in einem gueltigen Windows-Pfad
            ausserhalb des Laufwerks-Praefixes nie erlaubt.
        (c) Shell-Namespace-Ordner (CLSID-Suffix, z. B. ein Ordner namens
            "Systemsteuerung.{21EC2020-3AEA-1069-A2DD-08002B30309D}" -
            das klassische "God-Mode-Ordner"-Muster): Ein ECHTER, auf der
            Festplatte existierender Ordner, dessen Name auf ".{<GUID>}"
            endet bzw. eine solche Sequenz enthaelt, wird von Explorer/
            ShellExecute (also auch von Invoke-Item unten) NICHT als
            normaler Ordnerinhalt geoeffnet, sondern startet die
            registrierte Shell-Namespace-Erweiterung fuer diese CLSID -
            per -Validate belegt (lief vor diesem Fix als "OK" durch).
            "Ordner sind grundsaetzlich harmlos" gilt deshalb NICHT
            uneingeschraenkt - Ordner bleiben erlaubt, mit GENAU dieser
            einen Ausnahme. Geprueft wird JEDES Pfad-Segment (nicht nur
            das letzte), auch wenn das eigentliche Risiko am ZIEL-Segment
            haengt (siehe Kommentar an der Pruefstelle fuer die
            Abwaegung, warum trotzdem alle Segmente geprueft werden).
            BEKANNTE GRENZE dieser Musterpruefung (dokumentiertes
            Restrisiko, nicht geschlossen): dieselbe Shell-Namespace-
            Wirkung laesst sich auch OHNE ".{" im Ordnernamen erzeugen,
            per "desktop.ini" MIT einem CLSID-Eintrag ("CLSID=..."/
            "IconResource=..." o. Ae.) im Zielordner - das erkennt diese
            Pfad-Muster-Pruefung NICHT, da der Ordnername selbst
            unauffaellig bleibt.
        8.3-Kurzname-Segmente ("LONGFI~1.APP") wurden HIER FRUEHER
        ebenfalls per Muster abgelehnt - nach einem gezielten empirischen
        Test (siehe DECISIONS.md #79) ENTFERNT: Get-Item -Force loest
        einen 8.3-Kurznamen zuverlaessig zur KANONISCHEN, LANGEN Endung
        auf (verifiziert u. a. mit einer eigens angelegten
        "...Testing.application", ueber ihren generierten Kurznamen
        "...~1.APP" geoeffnet - $item.Extension lieferte ".application",
        NICHT ".APP") - die Positivlisten-Pruefung in Schritt 4 sieht
        damit bereits die WAHRE Endung, unabhaengig vom Kurz- oder
        Langnamen-Zugriffspfad. Die dedizierte Vorab-Pruefung war damit
        redundant UND lehnte nachweislich legitime Dateinamen wie
        "Backup~2024" oder "Bericht~1.txt" faelschlich ab.
    3. Test-Path muss den Pfad tatsaechlich bestaetigen - verhindert u. a.
       Tippfehler-/Race-Verwechslungen und laeuft VOR der Endungspruefung,
       damit Schritt 4 die Endung vom KANONISCHEN, tatsaechlich
       aufgeloesten Element ableiten kann statt vom Rohstring.
    4. POSITIVLISTE (siehe oben): abgeleitet vom KANONISCHEN, ueber
       Get-Item aufgeloesten Dateisystem-Eintrag (NICHT vom rohen String -
       das war bei der frueheren Sperrliste der Trailing-Space/Punkt-
       Bypass). Ordner sind strukturell erlaubt (Invoke-Item oeffnet sie
       im Explorer) - AUSSER dem CLSID-Namespace-Fall aus Schritt 2b/c.
       Eine Datei OHNE erkennbare Endung wird ABGELEHNT (fail-closed - im
       Unterschied zu einem Ordner ist bei einer namenlosen Endung nicht
       feststellbar, was Windows damit tatsaechlich tut). Die Positivliste
       selbst (siehe $script:AllowedExtensions) begrenzt bewusst NUR, WAS
       der Handler ueberhaupt zum Oeffnen ANBIETET - typische Dokument-/
       Medien-/Daten-Formate ohne einen bekannten Windows-Ausfuehrungsweg
       (WELCHES konkrete Programm eine Endung tatsaechlich oeffnet, ist
       geraeteabhaengig, siehe Begruendung/Abgrenzung direkt bei der Liste
       im Code).
  Bei JEDER Ablehnung (Schritte 1-4) erscheint eine kleine MessageBox mit
  Grund + gekuerztem Pfad - ein Klick, der einfach nichts sichtbar tut,
  wirkt fuer den Nutzer wie ein kaputtes Feature (schlechte UX) UND
  verschleiert im Zweifel einen aktiven Angriffsversuch. Bei einer
  abgelehnten Endung/einem abgelehnten Dateityp verweist die MessageBox
  zusaetzlich auf die Zwischenablage - die App (FileLink, markdown.jsx)
  VERSUCHT den Windows-Pfad bei JEDEM Klick ohnehin schon dorthin zu
  kopieren (Formulierung bewusst mit Vorbehalt: die Kopie kann im
  Einzelfall fehlschlagen, z. B. wenn der Browser die Berechtigung
  verweigert), das ist also ein bereits vorhandener, meist brauchbarer
  Rueckfallweg fuer den Nutzer. Ein reiner PRAEFIX-Mismatch (die
  uebergebene URL beginnt gar nicht mit "notizbuch-open:v1?path=",
  case-insensitiv verglichen - siehe weitere Anmerkung unten) ist dagegen KEIN
  abgelehnter Notizbuch-Link, sondern schlicht kein gueltiger Aufruf
  dieses Handlers - dafuer nur ein STILLER Exit + Log-Eintrag (kein Popup
  fuer etwas, das gar nicht erst vorgab, ein Notizbuch-Link zu sein; Log
  dient der Diagnose bei kuenftigen Kontrakt-Versionen).

  WEITERE HAERTUNGEN (Review-Nachbesserung 3):
  - PRAEFIX-Vergleich ist jetzt CASE-INSENSITIVE (OrdinalIgnoreCase): die
    Windows-Protokollaufloesung selbst ist es (URL-Schemas sind laut
    RFC 3986 case-insensitiv) - ein Browser/eine andere Quelle koennte das
    Schema in abweichender Gross-/Kleinschreibung liefern
    ("Notizbuch-Open:v1?..."), was beim vorherigen ordinalen (case-
    sensitiven) Vergleich als PraefixMismatch (stiller Exit) statt als
    gueltiger Aufruf behandelt worden waere.
  - EndsWith("/") laeuft jetzt EXPLIZIT ordinal (nicht die .NET-Default-
    Kulturvergleich) - identisch im Ergebnis fuer dieses einfache Zeichen,
    aber unabhaengig von der System-Kultur des Rechners, auf dem der
    Handler laeuft (Robustheit/Vorhersagbarkeit).
  - Write-NotizbuchLog serialisiert ueber einen benannten Mutex (JEDER
    Klick startet einen NEUEN powershell.exe-Prozess - zwei schnelle
    Klicks koennten sonst gleichzeitig in dieselbe Datei schreiben und
    Zeilen ineinander verschmelzen lassen) und rotiert die Log-Datei bei
    > 1 MB (eine Ebene Historie als ".log.old") - verhindert unbegrenztes
    Wachstum ueber viele Klicks/Ablehnungen hinweg.
  - "-Validate" liefert jetzt einen Exit-Code ungleich 0 bei "Reject"/
    "PrefixMismatch" (0 nur bei "Ok") - macht Validate-Laeufe aus einem
    Skript/einer Testliste heraus automatisch auswertbar, ohne die
    Textausgabe parsen zu muessen.

AUFRUF
  Normalbetrieb (durch die Registry, siehe notizbuch-open-setup.ps1):
    powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden
      -File notizbuch-open-handler.ps1 "notizbuch-open:v1?path=..."
  Diagnose/Tests (oeffnet NICHTS, nur Textausgabe des Pruefergebnisses,
  Exit-Code 0 bei "Ok", sonst 1):
    powershell.exe -File notizbuch-open-handler.ps1 -Validate "notizbuch-open:v1?path=..."
====================================================================
#>
param(
    # Von der Registry als "%1" uebergeben: die KOMPLETTE geklickte URL.
    [Parameter(Position = 0)]
    [string]$Url,

    # Diagnose-Modus: prueft dieselbe URL wie oben, oeffnet aber NICHTS
    # und zeigt KEINE MessageBox - nur eine Textzeile mit dem Ergebnis auf
    # stdout (fuer manuelle Tests/Automatisierung). Exit-Code 0 = "Ok",
    # sonst 1 (siehe Ende der Datei).
    [Parameter()]
    [string]$Validate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# POSITIVLISTE erlaubter Endungen (case-insensitive geprueft, ohne
# fuehrenden Punkt gespeichert - siehe Test-NotizbuchOpenUrl, Schritt 4).
# Architekturwechsel Sperrliste -> Positivliste, siehe Kopfkommentar fuer
# den vollstaendigen Beleg (94-Endungen-Probelauf, DECISIONS.md #79).
#
# AUSWAHL-PRINZIP (ehrlich formuliert, Review-Fix Runde 4 - die vorherige
# Formulierung "Windows ANZEIGT statt AUSFUEHRT" ist zu absolut: WELCHES
# Programm fuer eine Endung startet, entscheidet die Registrierung auf
# JEDER einzelnen Maschine, nicht die Endung selbst - auf einem konkret
# gepruesften Windows-Rechner oeffneten z. B. .md/.markdown/.json/.yaml/
# .yml/.cfg in VS Code und .xml im Browser, nicht in einem reinen
# Text-Editor. Kein belegter Code-AUSFUEHRUNGS-Weg darunter, aber die
# Formulierung darf das nicht versprechen): Diese Liste begrenzt NUR, WAS
# der Handler ueberhaupt zum Oeffnen ANBIETET - typische Dokument-/Medien-/
# Daten-Formate, bei denen KEIN registriertes Windows-Standardprogramm
# bekannt ist, das eine Datei dieses Typs als KOMMANDO/CODE interpretiert
# (im Unterschied zu den 66 in Blocker 1 durchgefallenen Formaten, wo
# genau das nachweislich passiert - Interpreter, Fernzugriff, Makro-
# Ausfuehrung, Zertifikats-Installation, ...). Kurz begruendete Abgrenzung
# bei den Zweifelsfaellen:
#   - Dokumente (docx/xlsx/pptx/odt/ods/odp, PDF, rtf, txt, md, ...):
#     reine Anzeige-Formate. docm/xlsm/pptm (Makro-Varianten) sind
#     BEWUSST NICHT enthalten. Die AELTEREN Binaerformate doc/xls/ppt
#     kennen (anders als die docx/xlsx/pptx-Familie) KEINE separate
#     Makro-Variante - ein VBA-Makro kann technisch im selben Container
#     stecken. Trotzdem aufgenommen (Praxisnutzen ueberwiegt), aber als
#     NAMED Restrisiko dokumentiert (siehe DECISIONS.md #79) statt
#     stillschweigend hingenommen.
#   - csv/tsv: ebenfalls ein bekanntes, aelteres Risiko ("CSV/Formula-
#     Injection", z. B. "=cmd|'/c calc'!A1"), von modernen Excel-Versionen
#     seit Jahren durch deaktiviertes DDE/Warnhinweise stark entschaerft,
#     aber nicht theoretisch ausgeschlossen - ebenfalls als Restrisiko
#     benannt statt ausgeschlossen (reiner Text/Tabellendaten-Anwendung).
#   - svg: BEWUSST AUSGESCHLOSSEN (Zweifelsfall, konservativ entschieden).
#     Anders als PNG/JPG (reine Rasterdaten) kann eine SVG eingebettetes
#     JavaScript enthalten - je nachdem, welches Programm auf diesem
#     Windows-Rechner als Standard fuer .svg registriert ist (Bild-Viewer
#     vs. ein Browser), koennte dieses Skript beim Oeffnen ausgefuehrt
#     werden. Fehlt bewusst in der Startmenge.
#   - zip/7z/tar/gz: Invoke-Item oeffnet nur eine Inhalts-ANSICHT
#     (Explorer-Zip-Ordner bzw. die GUI von 7-Zip/WinRAR, falls
#     installiert) - NICHTS darin wird automatisch entpackt oder
#     ausgefuehrt, der Nutzer muesste separat auf ein Element IM Archiv
#     klicken (identisch zum manuellen Oeffnen eines heruntergeladenen
#     Zips ueber den Explorer) - vertretbar aufgenommen.
#   - Medien (png/jpg/.../mp3/.../mp4/...): das inhaerente Restrisiko
#     eines fehlerhaften Datei-PARSERS (Codec-/Bild-Bibliotheks-CVEs) gilt
#     grundsaetzlich fuer JEDES geoeffnete Format, auch PDF/DOCX - keine
#     Eigenschaft, die sich per Positiv-/Sperrliste ausschliessen liesse;
#     als allgemeines Restrisiko der GESAMTEN Funktion dokumentiert
#     (DECISIONS.md #79), nicht je Format wiederholt.
$script:AllowedExtensions = @(
    'pdf', 'txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'json', 'xml', 'yaml',
    'yml', 'ini', 'cfg', 'conf', 'rtf',
    'doc', 'docx', 'odt',
    'xls', 'xlsx', 'ods',
    'ppt', 'pptx', 'odp',
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tif', 'tiff', 'heic',
    'mp3', 'wav', 'flac', 'm4a',
    'mp4', 'mkv', 'mov', 'avi', 'webm',
    'zip', '7z', 'tar', 'gz',
    'eml', 'msg', 'epub'
)
# ORDINALER Nachschlage-Satz statt PowerShells eingebautem "-contains"
# (Review-Fix, Sicherheits-Review Runde 4, per -Validate belegt): "-contains"
# vergleicht Strings NICHT ordinal, sondern linguistisch/kollationsbasiert
# (CurrentCulture-artige Regeln) - das laesst Unicode-Kollisionen zu, die
# ordinal UNGLEICH sind, aber als "gleich" durchgehen: das KELVIN-ZEICHEN
# (U+212A, sieht aus wie "K", bleibt auch nach ToLowerInvariant() ERHALTEN
# statt zu "k" zu werden) wurde von "-contains" trotzdem als Treffer fuer
# "mkv" gewertet; ein eingestreutes SOFT HYPHEN (U+00AD, unsichtbar) wird
# von der Kollation komplett ignoriert und damit "wegverglichen". Ein
# HashSet mit [System.StringComparer]::OrdinalIgnoreCase vergleicht
# stattdessen Zeichen-fuer-Zeichen (nur ASCII-Gross-/Kleinschreibung wird
# noch gefaltet, keine linguistische Aequivalenz).
$script:AllowedExtensionSet = [System.Collections.Generic.HashSet[string]]::new(
    [string[]]$script:AllowedExtensions,
    [System.StringComparer]::OrdinalIgnoreCase
)

# Log-Datei liegt NEBEN dem Skript (egal ob im Repo oder im installierten
# LOCALAPPDATA-Ordner, siehe notizbuch-open-setup.ps1) - rein diagnostisch,
# ein Schreibfehler dabei (z. B. schreibgeschuetzter Ordner) darf den
# Handler nie zum Absturz bringen.
$script:LogPath = Join-Path $PSScriptRoot 'notizbuch-open-handler.log'
$script:LogMutexName = 'NotizbuchOpenHandlerLogMutex'
$script:LogMaxBytes = 1MB

function Write-NotizbuchLog {
    param([string]$Message)
    $mutex = $null
    try {
        # Serialisiert den Schreibzugriff ueber Prozessgrenzen hinweg
        # (JEDER Klick startet einen NEUEN powershell.exe-Prozess, siehe
        # Kopfkommentar "Weitere Haertungen") - kurze Wartezeit, danach
        # lieber KEIN Log-Eintrag als ein haengender Prozess (Logging ist
        # Diagnose, kein Kernpfad).
        $mutex = New-Object System.Threading.Mutex($false, $script:LogMutexName)
        $acquired = $false
        try { $acquired = $mutex.WaitOne(2000) } catch { $acquired = $false }
        if (-not $acquired) { return }
        try {
            # Rotation bei > 1 MB (eine Ebene Historie als ".log.old") -
            # verhindert unbegrenztes Wachstum ueber sehr viele
            # Klicks/Ablehnungen hinweg.
            if ((Test-Path -LiteralPath $script:LogPath) -and
                ((Get-Item -LiteralPath $script:LogPath -Force).Length -gt $script:LogMaxBytes)) {
                $oldPath = $script:LogPath + '.old'
                Remove-Item -LiteralPath $oldPath -Force -ErrorAction SilentlyContinue
                Rename-Item -LiteralPath $script:LogPath -NewName (Split-Path -Leaf $oldPath) -Force -ErrorAction SilentlyContinue
            }
            # $Message kann einen ROHEN Wert enthalten, der NIE durch die
            # Steuerzeichen-Pruefung aus Schritt 2 gelaufen ist (z. B. der
            # komplette Rohwert bei einem Praefix-Mismatch - der wird VOR
            # jeder Pruefung geloggt) oder einen Pfad, dessen Steuerzeichen
            # zwar zur Ablehnung fuehrten, aber TROTZDEM in der Reject-
            # Zeile mitprotokolliert werden. Ohne Bereinigung liesse sich
            # per eingebettetem CR/LF eine vom echten Log-Format nicht mehr
            # unterscheidbare Zusatzzeile einschleusen (Log-Injection) -
            # Zeilenumbrueche werden deshalb IMMER ersetzt.
            $safeMessage = $Message -replace '[\r\n]', ' '
            $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $safeMessage
            Add-Content -LiteralPath $script:LogPath -Value $line -Encoding UTF8
        } finally {
            $mutex.ReleaseMutex()
        }
    } catch {
        # Logging ist Diagnose, kein Kernpfad - jeder Fehler (Mutex,
        # Dateisystem, ...) wird still ignoriert.
    } finally {
        if ($mutex) { $mutex.Dispose() }
    }
}

# Kuerzt einen Pfad fuer die Anzeige in Log/MessageBox (Auftrag: "gekuerzter
# Pfad") - vermeidet eine ausufernd lange MessageBox bei einem absichtlich
# sehr langen Angriffs-Pfad.
function Get-ShortenedPath {
    param([string]$Path)
    if (-not $Path) { return '(kein Pfad)' }
    if ($Path.Length -gt 200) { return $Path.Substring(0, 200) + '...' }
    return $Path
}

# Kernpruefung: nimmt die KOMPLETTE rohe URL entgegen, liefert IMMER ein
# Ergebnisobjekt zurueck (nie eine Exception fuer einen ungueltigen Wert -
# nur fuer echte Programmierfehler). Status ist eines von:
#   "PrefixMismatch" - kein gueltiger Aufruf dieses Handlers (stiller Exit)
#   "Reject"         - Praefix stimmt, aber Validierung 1-4 schlaegt fehl
#   "Ok"             - alle Pruefungen bestanden, Path ist geoeffnet-bereit
function Test-NotizbuchOpenUrl {
    param([Parameter(Mandatory)] [AllowEmptyString()] [string]$RawUrl)

    $prefix = 'notizbuch-open:v1?path='

    if ([string]::IsNullOrEmpty($RawUrl)) {
        return [pscustomobject]@{ Status = 'PrefixMismatch'; Reason = 'kein Argument uebergeben'; Path = $null; RawUrl = $RawUrl }
    }

    # Trailing-Slash-Toleranz: Chrome/Edge haengen an eine per Registry
    # registrierte Protokoll-URL OHNE "//" nach dem Schema-Doppelpunkt
    # (unser Kontrakt hat kein "//") bekanntermassen automatisch einen
    # einzelnen "/" an. Da die App-Seite (buildProtocolUrl, filelinks.js)
    # den Pfad per encodeURIComponent kodiert und das JEDEN rohen "/"/"\"
    # zu "%2F"/"%5C" kodiert, kann eine SELBST gebaute Kontrakt-URL NIE roh
    # auf "/" enden - ein angehaengter trailing "/" stammt also garantiert
    # vom Browser und wird hier defensiv genau EINMAL abgeschnitten, VOR
    # dem Praefix-Vergleich. Ordinal (nicht die .NET-Default-
    # Kulturvergleich) fuer ein vorhersagbares Ergebnis unabhaengig von der
    # System-Kultur.
    $normalized = $RawUrl
    if ($normalized.EndsWith('/', [System.StringComparison]::Ordinal)) {
        $normalized = $normalized.Substring(0, $normalized.Length - 1)
    }

    # Case-insensitiv (OrdinalIgnoreCase): URL-Schemas sind laut RFC 3986
    # nicht Gross-/Kleinschreibungs-sensitiv - ein ordinaler (case-
    # sensitiver) Vergleich haette z. B. "Notizbuch-Open:v1?..." faelschlich
    # als PraefixMismatch (stiller Exit) statt als gueltigen Aufruf
    # behandelt.
    if (-not $normalized.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        return [pscustomobject]@{ Status = 'PrefixMismatch'; Reason = "Praefix fehlt/falsch (erwartet '$prefix')"; Path = $null; RawUrl = $RawUrl }
    }

    $encoded = $normalized.Substring($prefix.Length)
    try {
        $decoded = [Uri]::UnescapeDataString($encoded)
    } catch {
        return [pscustomobject]@{ Status = 'Reject'; Reason = "Pfad liess sich nicht dekodieren ($($_.Exception.Message))"; Path = $null; RawUrl = $RawUrl }
    }

    # --- Schritt 1: absoluter Laufwerkspfad, UNC explizit verboten -----
    if ($decoded -match '^\\\\') {
        return [pscustomobject]@{ Status = 'Reject'; Reason = 'UNC-Pfade (Netzwerkfreigaben, \\server\...) sind nicht erlaubt'; Path = $decoded; RawUrl = $RawUrl }
    }
    # "-cnotmatch" statt "-notmatch" (Review-Fix, Sicherheits-Review Runde 4,
    # per Test belegt): PowerShell-Vergleichsoperatoren OHNE "c"-Praefix sind
    # per Default CASE-INSENSITIV, und .NETs IgnoreCase-Regex-Modus faltet
    # bestimmte Zeichen mit einer Gross-/Kleinschreibungs-Aequivalenz - das
    # KELVIN-ZEICHEN (U+212A, sieht aus wie "K", faltet unter IgnoreCase zu
    # "k") liess einen Pfad, der mit DIESEM Zeichen statt einem echten
    # ASCII-Buchstaben beginnt (z. B. "<Kelvin-Zeichen>:\Users\..."), unter
    # "-notmatch '^[A-Za-z]:\\'" faelschlich als "matcht doch" (also NICHT
    # abgelehnt) durch - per direktem Test bestaetigt ("-match" gab "True"
    # zurueck, "-cmatch" korrekt "False"). Windows selbst kennt keine
    # Nicht-ASCII-Laufwerksbuchstaben, ein solcher Pfad waere ohnehin beim
    # spaeteren Test-Path/Get-Item gescheitert (kein Datenzugriff moeglich) -
    # trotzdem wird die Pruefung hier korrekt/praezise gehalten, statt sich
    # auf einen zufaelligen nachgelagerten Fehlschlag zu verlassen.
    if ($decoded -cnotmatch '^[A-Za-z]:\\') {
        return [pscustomobject]@{ Status = 'Reject'; Reason = 'kein absoluter Laufwerkspfad (erwartet z. B. C:\...)'; Path = $decoded; RawUrl = $RawUrl }
    }

    # --- Schritt 2: Traversal / Steuerzeichen / Umgebungsvariablen ------
    # Split auf BEIDE Trenner ("\" UND "/") - siehe Kopfkommentar. Ein
    # Split nur auf "\" liesse ein NUR per "/" gebildetes ".."-Segment
    # durch, obwohl Test-Path/Invoke-Item "/" genauso wie "\" aufloesen.
    $segments = $decoded -split '[\\/]'
    if ($segments -contains '..') {
        return [pscustomobject]@{ Status = 'Reject'; Reason = "Pfad enthaelt '..'-Segmente (Traversal)"; Path = $decoded; RawUrl = $RawUrl }
    }
    if ($decoded -match '[\u0000-\u001F]') {
        return [pscustomobject]@{ Status = 'Reject'; Reason = 'Pfad enthaelt Steuerzeichen/Nullbytes'; Path = $decoded; RawUrl = $RawUrl }
    }
    # "%NAME%" (klassische Windows-Env-Var-Syntax) bzw. "$env:NAME"
    # (PowerShell-Syntax). Das %-Muster ist ENG an eine echte Variablen-
    # namensform angelehnt (Buchstabe/Unterstrich als erstes Zeichen,
    # danach alphanumerisch/Unterstrich/Klammern) - ein vorheriges,
    # pauschales "irgendwo zwei %-Zeichen im Segment" lehnte nachweislich
    # legitime Dateinamen mit zwei Prozentzeichen ab (z. B.
    # "50% Rabatt 100%.txt", "Anteil 5%-10% Analyse.txt" - der Inhalt
    # ZWISCHEN den beiden % beginnt dort mit Leerzeichen/Ziffer/Bindestrich,
    # nicht mit einem gueltigen Variablennamen-Zeichen, und matcht deshalb
    # mit dem neuen Muster nicht mehr).
    # "-cmatch" statt "-match" (Review-Fix, Sicherheits-Review Runde 4) -
    # dieselbe Kelvin-Zeichen-/IgnoreCase-Falt-Problematik wie beim
    # Laufwerksbuchstaben-Check oben gilt fuer JEDES "[A-Za-z...]"-Muster in
    # diesem Skript, nicht nur fuer den einen urspruenglich gemeldeten Fall -
    # konsequent auf case-sensitive/ordinale Muster umgestellt.
    if ($decoded -cmatch '%[A-Za-z_][A-Za-z0-9_()]{0,63}%') {
        return [pscustomobject]@{ Status = 'Reject'; Reason = 'Pfad enthaelt einen moeglichen Umgebungsvariablen-Platzhalter (%NAME%)'; Path = $decoded; RawUrl = $RawUrl }
    }
    if ($decoded -match '\$env:') {
        return [pscustomobject]@{ Status = 'Reject'; Reason = 'Pfad enthaelt einen moeglichen Umgebungsvariablen-Platzhalter ($env:...)'; Path = $decoded; RawUrl = $RawUrl }
    }

    # --- Schritt 2b: Kanonisierungs-/Namespace-Tricks ---------------------
    # (a) Trailing Space/Punkt - siehe Kopfkommentar fuer die vollstaendige
    #     Begruendung. "$" ankert an das ENDE des ganzen Strings (nicht nur
    #     eines Segments) - ausreichend, weil ein solcher Trick nur am
    #     ENDE des Pfads (also im Dateinamen-Segment) etwas bewirkt.
    if ($decoded -match '[ .]$') {
        return [pscustomobject]@{ Status = 'Reject'; Reason = 'Pfad endet auf Leerzeichen/Punkt (wird von Windows kanonisiert - moeglicher Umgehungsversuch)'; Path = $decoded; RawUrl = $RawUrl }
    }
    # (b) Alternate Data Stream: JEDER weitere ":" nach dem Laufwerks-
    #     Praefix (Position 0-1, "C:") ist in einem gueltigen Windows-Pfad
    #     nie erlaubt - Substring(2) ist hier sicher, weil Schritt 1 oben
    #     bereits "^[A-Za-z]:\" (mindestens 3 Zeichen) erzwungen hat.
    if ($decoded.Substring(2) -match ':') {
        return [pscustomobject]@{ Status = 'Reject'; Reason = 'Alternate Data Stream (weiterer ":" im Pfad) ist nicht erlaubt'; Path = $decoded; RawUrl = $RawUrl }
    }
    # (c) Shell-Namespace-Ordner (CLSID-Suffix, "God-Mode-Ordner"-Muster,
    #     siehe Kopfkommentar): ein Segment, das ".{" enthaelt (deckt sowohl
    #     "enthaelt mittendrin" als auch "endet auf .{...}" ab), wird
    #     abgelehnt. Das eigentliche Risiko haengt zwar strukturell nur am
    #     ZIEL-Segment (Invoke-Item/ShellExecute interpretiert nur DESSEN
    #     Namen shell-speziell, Zwischen-Segmente durchlaeuft Get-Item rein
    #     dateisystem-basiert und damit shell-neutral) - alle Segmente
    #     werden trotzdem defensiv geprueft: kostet nichts (echte Ordner-
    #     namen mit ".{" sind praktisch nie legitim) und schuetzt auch vor
    #     einer kuenftig geaenderten Aufloese-Reihenfolge.
    if ($segments | Where-Object { $_ -match '\.\{' }) {
        return [pscustomobject]@{ Status = 'Reject'; Reason = 'Ordnername mit Shell-Namespace-Muster (".{...}") ist nicht erlaubt'; Path = $decoded; RawUrl = $RawUrl }
    }

    # --- Schritt 3: Existenz --------------------------------------------
    # Test-Path kann bei bestimmten, von den Schritten oben nicht
    # abgedeckten ungueltigen Zeichen (z. B. "<", "|", '"') mit
    # $ErrorActionPreference='Stop' eine Exception werfen - ohne try/catch
    # waere das ein STILLER Absturz (kein Log, keine MessageBox) statt
    # eines sauberen Reject.
    try {
        $exists = Test-Path -LiteralPath $decoded
    } catch {
        return [pscustomobject]@{ Status = 'Reject'; Reason = "Pfad konnte nicht geprueft werden ($($_.Exception.Message))"; Path = $decoded; RawUrl = $RawUrl }
    }
    if (-not $exists) {
        return [pscustomobject]@{ Status = 'Reject'; Reason = 'Pfad/Datei existiert nicht'; Path = $decoded; RawUrl = $RawUrl }
    }

    # --- Schritt 4: POSITIVLISTE, aus dem KANONISCHEN Dateisystem-Eintrag
    #     abgeleitet (NICHT vom rohen String) --------------------------
    try {
        $item = Get-Item -LiteralPath $decoded -Force
    } catch {
        return [pscustomobject]@{ Status = 'Reject'; Reason = "Pfad konnte nicht aufgeloest werden ($($_.Exception.Message))"; Path = $decoded; RawUrl = $RawUrl }
    }

    if (-not $item.PSIsContainer) {
        # Datei: nur eine Endung aus der Positivliste (siehe
        # $script:AllowedExtensions/$script:AllowedExtensionSet oben) wird
        # geoeffnet. Eine Datei OHNE erkennbare Endung wird ABGELEHNT
        # (fail-closed) - anders als bei einem Ordner ist hier nicht
        # feststellbar, welches Programm Windows dafuer aufrufen wuerde.
        $extRaw = $item.Extension.TrimStart('.')
        if (-not $extRaw) {
            return [pscustomobject]@{ Status = 'Reject'; Reason = 'Dateien ohne erkennbare Endung werden aus Sicherheitsgruenden nicht geoeffnet. Der Pfad wurde - sofern der Browser das zulaesst - in die Zwischenablage kopiert.'; Path = $decoded; RawUrl = $RawUrl }
        }
        # Nicht-ASCII-Zeichen in der Endung IMMER ablehnen (Review-Fix,
        # Sicherheits-Review Runde 4): schliesst die GESAMTE Klasse von
        # Unicode-Kollisions-/Homoglyphen-Tricks (Kelvin-Zeichen,
        # Soft-Hyphen, kyrillische/griechische Doppelgaenger, ...) auf
        # einen Schlag - jeder Eintrag der Positivliste ist ohnehin reines
        # ASCII, eine "erlaubte" Endung kann also nie ein Nicht-ASCII-
        # Zeichen enthalten. BEWUSST "-cmatch" (case-SENSITIV/ordinal),
        # NICHT das gewoehnliche "-match": PowerShell-Vergleichsoperatoren
        # sind OHNE "c"-Praefix per Default CASE-INSENSITIV, und .NETs
        # IgnoreCase-Regex-Modus faltet Zeichen mit einer Gross-/
        # Kleinschreibungs-Aequivalenz - das KELVIN-ZEICHEN (U+212A, sieht
        # aus wie "K", faltet unter IgnoreCase zu "k") wurde von einem
        # ersten "-match '[^\x00-\x7F]'" NICHT als Nicht-ASCII erkannt
        # (per Test an einer echten, auf der Platte angelegten Datei
        # belegt: "-match" lieferte "False", "-cmatch" UND
        # "[regex]::IsMatch(...)" lieferten korrekt "True") - obwohl das
        # Zeichen unstrittig ausserhalb von \x00-\x7F liegt. Ohne "-cmatch"
        # haette diese Pruefung den Kelvin-Fall STILL durchgelassen (der
        # nachfolgende ordinale HashSet-Vergleich haette ihn zwar TROTZDEM
        # noch abgefangen - Verteidigung in der Tiefe -, aber mit der
        # falschen, weniger aussagekraeftigen Fehlermeldung).
        if ($extRaw -cmatch '[^\x00-\x7F]') {
            return [pscustomobject]@{ Status = 'Reject'; Reason = "Dateityp enthaelt Nicht-ASCII-Zeichen (moeglicher Unicode-Bypass-Versuch) und wird aus Sicherheitsgruenden nicht geoeffnet. Der Pfad wurde - sofern der Browser das zulaesst - in die Zwischenablage kopiert."; Path = $decoded; RawUrl = $RawUrl }
        }
        $extNoDot = $extRaw.ToLowerInvariant()
        if (-not $script:AllowedExtensionSet.Contains($extNoDot)) {
            return [pscustomobject]@{ Status = 'Reject'; Reason = "Dateityp '.$extNoDot' wird aus Sicherheitsgruenden nicht geoeffnet. Der Pfad wurde - sofern der Browser das zulaesst - in die Zwischenablage kopiert."; Path = $decoded; RawUrl = $RawUrl }
        }
    }
    # Ordner: strukturell erlaubt (Invoke-Item oeffnet den Explorer) - der
    # Shell-Namespace-Check (Schritt 2b/c) hat fuer ".{"-Muster bereits VOR
    # diesem Punkt gegriffen.

    # Path = die KANONISCHE FullName (NICHT der Rohstring) - der Normal-
    # betrieb unten ruft bewusst "Invoke-Item -LiteralPath $result.Path" mit
    # GENAU diesem Wert auf.
    return [pscustomobject]@{ Status = 'Ok'; Reason = $null; Path = $item.FullName; RawUrl = $RawUrl }
}

function Show-NotizbuchRejectMessageBox {
    param([string]$Reason, [string]$Path)
    # powershell.exe (Windows PowerShell 5.1, so registriert notizbuch-open-
    # setup.ps1 den Aufruf) startet standardmaessig im STA-Apartment-Modus -
    # WinForms MessageBox braucht genau das, kein zusaetzlicher Schalter
    # noetig.
    Add-Type -AssemblyName System.Windows.Forms | Out-Null
    $shown = Get-ShortenedPath -Path $Path
    [System.Windows.Forms.MessageBox]::Show(
        "Der Link konnte nicht geoeffnet werden:`n$Reason`n`nPfad: $shown",
        'Notizbuch - Link oeffnen',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning
    ) | Out-Null
}

# --- Diagnose-Modus: NUR pruefen, NICHTS oeffnen, NICHTS anzeigen -------
# Exit-Code 0 nur bei "Ok", sonst 1 - macht Validate-Laeufe aus einer
# Testliste/einem Skript heraus automatisch auswertbar.
if ($PSBoundParameters.ContainsKey('Validate')) {
    $result = Test-NotizbuchOpenUrl -RawUrl $Validate
    if ($result.Status -eq 'Ok') {
        Write-Output "OK: $($result.Path)"
        exit 0
    } else {
        Write-Output "$($result.Status): $($result.Reason) [Pfad: $(Get-ShortenedPath -Path $result.Path)]"
        exit 1
    }
}

# --- Normalbetrieb (Aufruf durch die Registry, %1) ----------------------
$result = Test-NotizbuchOpenUrl -RawUrl $Url

if ($result.Status -eq 'PrefixMismatch') {
    Write-NotizbuchLog "PrefixMismatch: $($result.Reason) | Rohwert: $($result.RawUrl)"
    exit 0
}

if ($result.Status -ne 'Ok') {
    Write-NotizbuchLog "Reject: $($result.Reason) | Pfad: $($result.Path)"
    Show-NotizbuchRejectMessageBox -Reason $result.Reason -Path $result.Path
    exit 0
}

Write-NotizbuchLog "Open: $($result.Path)"
try {
    # Invoke-Item = exakt die Doppelklick-Semantik des Explorers (oeffnet
    # das fuer die Endung registrierte Standardprogramm bzw. den Explorer
    # bei einem Ordner).
    Invoke-Item -LiteralPath $result.Path
} catch {
    Write-NotizbuchLog "Invoke-Item-Fehler: $($_.Exception.Message)"
    Show-NotizbuchRejectMessageBox -Reason "Datei konnte nicht geoeffnet werden ($($_.Exception.Message))" -Path $result.Path
}
