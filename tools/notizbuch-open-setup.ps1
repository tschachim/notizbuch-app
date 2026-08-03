<#
====================================================================
notizbuch-open-setup.ps1  (Notizbuch-App v7.38)
====================================================================
ZWECK
  Einmalige Einrichtung PRO WINDOWS-BENUTZERKONTO des eigenen
  URL-Protokolls "notizbuch-open:" (Kontrakt v1, siehe Kopfkommentar von
  notizbuch-open.js). Danach oeffnet ein Klick auf einen file:-Link im
  Dokument-Viewer der App die Datei im dafuer registrierten
  Windows-Programm (wie ein Explorer-Doppelklick).

  NUR HKCU (Software\Classes), KEINE Adminrechte noetig - HKCU\Software\
  Classes wird von Windows beim Aufloesen eines Protokolls/einer
  Dateiendung IMMER VOR HKLM\Software\Classes geprueft, ein normaler
  Benutzer kann sich damit ein eigenes Protokoll registrieren, ohne
  Maschinen-weite (HKLM) Einstellungen zu veraendern oder erhoehte
  Rechte zu benoetigen - genau richtig fuer ein Ein-Nutzer-Tool wie
  dieses.

  ARCHITEKTUR-WECHSEL v7.38 (vollstaendiger Beleg in DECISIONS.md #79):
  Die Registry zeigt jetzt DIREKT auf node.exe mit notizbuch-open.js als
  Argument - KEIN PowerShell-Handler, KEIN eigens kompilierter C#-
  Launcher mehr. Kurze Chronik (Details/Kontrollmessungen siehe
  DECISIONS.md #79):
    1. v7.35/v7.36: Registry -> powershell.exe direkt. Windows loeste das
       Protokoll korrekt auf, ein Klick in Chrome tat aber NICHTS.
    2. v7.37: Kontrollmessungen zeigten, dass Chrome ein Ziel-Executable
       ablehnt, das ein SKRIPT-INTERPRETER ist (powershell.exe, cmd.exe,
       ...) - Fix war ein eigener, kompilierter C#-Launcher als
       "normales" Zwischen-Executable.
    3. v7.37 (nach echter Installation beim Nutzer - fruehere
       Installationsversuche liefen technisch bedingt nie wirklich vor
       Chromes Augen, siehe DECISIONS.md #79 fuer die ehrliche
       Fehleinschaetzung): Der Launcher funktionierte per Doppelklick UND
       direktem PowerShell-Aufruf zuverlaessig, aber IMMER NOCH nicht aus
       Chrome heraus - selbst mit gueltiger Code-Signatur.
    4. Entscheidende Kontrollmessung: ein Schema mit Ziel notepad.exe
       startet aus Chrome sofort, ein Schema mit Ziel "node.exe -e ..."
       EBENFALLS - der selbst kompilierte/signierte Launcher NIE.
       SCHLUSSFOLGERUNG: nicht "Interpreter ja/nein" ist die Huerde,
       sondern vermutlich Etabliertheit/Vertrauen des konkreten Binaries
       aus Sicht des Endpoint-Schutzes. node.exe (beim Nutzer bereits
       installiert) wird akzeptiert - der eigene Launcher entfaellt
       ersatzlos.
  GENAU EINE Implementierung der Sicherheitspruefung
  (validateProtocolUrl in notizbuch-open.js) statt drei parallele
  Fassungen (PowerShell-Handler + C#-Launcher + diese hier), die
  auseinanderlaufen koennten - notizbuch-open-handler.ps1 und
  NotizbuchOpenLauncher.cs wurden deshalb ERSATZLOS ENTFERNT (siehe
  Deinstallations-Hinweis unten fuer Alt-Installationen).

  notizbuch-open.js UND eine winzige eigene package.json (deklariert
  "type":"module" fuer den installierten Ordner, siehe Kopfkommentar der
  .js-Datei "MODUL-FORMAT") werden gemeinsam nach
  "%LOCALAPPDATA%\NotizbuchOpen\" KOPIERT (statt die Registry direkt auf
  Pfade in diesem Repo zeigen zu lassen): LOCALAPPDATA ist ein STABILER,
  vom jeweiligen Repo-Klon-Pfad unabhaengiger Ort - verschiebt/loescht
  der Nutzer sein Repo-Verzeichnis spaeter, bliebe ein direkt auf das
  Repo zeigender Registry-Eintrag sonst kaputt.

  Dieses Skript veraendert AUSSCHLIESSLICH die eine Registry-Struktur
  HKCU:\Software\Classes\notizbuch-open (samt Unterschluesseln) und den
  eigenen Ordner "%LOCALAPPDATA%\NotizbuchOpen\" - sonst NICHTS. Es
  installiert KEIN Node.js - node.exe muss beim Nutzer bereits vorhanden
  sein (wird hier nur AUFGELOEST/VERIFIZIERT, nicht installiert).

PARAMETER
  -Uninstall   Entfernt Registry-Schluessel + kopierten Ordner
               (notizbuch-open.js, package.json, Log-Dateien UND jeden
               Altbestand einer fruegeren Installation - NotizbuchOpen-
               Launcher.exe, notizbuch-open-handler.ps1, deren Logs -
               siehe Begruendung unten) wieder rueckstandsfrei
               (idempotent, auch wenn nichts installiert war).

AUFRUF
  Installieren:   powershell -ExecutionPolicy Bypass -File notizbuch-open-setup.ps1
  Deinstallieren: powershell -ExecutionPolicy Bypass -File notizbuch-open-setup.ps1 -Uninstall
  Mehrfacher Aufruf ist idempotent (kopiert/erstellt einfach neu).

  WICHTIG FUER BESTEHENDE INSTALLATIONEN (v7.35/v7.36/fruehes v7.37):
  Dieses Skript MUSS erneut ausgefuehrt werden, damit die Registry auf
  node.exe statt auf den alten Launcher/PowerShell-Handler zeigt - eine
  bestehende Installation wird dabei automatisch mit-aktualisiert
  (idempotent), Altdateien (NotizbuchOpenLauncher.exe, notizbuch-open-
  handler.ps1, deren *.log[.old]) werden dabei aus dem Installations-
  ordner ENTFERNT (siehe Schritt 1 unten) - kein manueller Zwischenschritt
  noetig.
====================================================================
#>
param(
    [switch]$Uninstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$InstallDir = Join-Path $env:LOCALAPPDATA 'NotizbuchOpen'
$InstalledScriptPath = Join-Path $InstallDir 'notizbuch-open.js'
$InstalledPackageJsonPath = Join-Path $InstallDir 'package.json'
$SourceScriptPath = Join-Path $PSScriptRoot 'notizbuch-open.js'
$SourcePackageJsonPath = Join-Path $PSScriptRoot 'package.json'
$RegKeyPath = 'HKCU:\Software\Classes\notizbuch-open'
$RegCommandKeyPath = Join-Path $RegKeyPath 'shell\open\command'

# Dateinamen einer VORHERIGEN Installation (v7.35/v7.36/fruehes v7.37) -
# werden bei JEDEM Lauf (Install UND -Uninstall) aus dem Installations-
# ordner entfernt, falls vorhanden (siehe Kopfkommentar "GENAU EINE
# Implementierung" - drei parallele Validierungs-Fassungen im selben
# Ordner waeren genau die Divergenzfalle, die vermieden werden soll).
# Ein STILLER Uebergangszustand - der alte Launcher liegt zwar noch
# nutzlos herum, wird aber von der NEUEN Registry-Eintragung ohnehin
# nicht mehr referenziert - waere unnoetig verwirrend fuer jeden, der den
# Ordner spaeter inspiziert.
$LegacyFileNames = @(
    'notizbuch-open.exe',
    'notizbuch-open-handler.ps1',
    'notizbuch-open-handler.log',
    'notizbuch-open-handler.log.old',
    'notizbuch-open-launcher.log',
    'notizbuch-open-launcher.log.old'
)

function Remove-LegacyInstallFiles {
    foreach ($name in $LegacyFileNames) {
        $legacyPath = Join-Path $InstallDir $name
        if (Test-Path -LiteralPath $legacyPath) {
            Remove-Item -LiteralPath $legacyPath -Force -ErrorAction SilentlyContinue
            Write-Host "  [OK] Altbestand entfernt: $legacyPath"
        }
    }
}

if ($Uninstall) {
    Write-Host 'Entferne notizbuch-open Protokoll-Registrierung ...'

    if (Test-Path -LiteralPath $RegKeyPath) {
        Remove-Item -LiteralPath $RegKeyPath -Recurse -Force
        Write-Host "  [OK] Registry-Schluessel entfernt: $RegKeyPath"
    } else {
        Write-Host "  [--] Registry-Schluessel war nicht vorhanden: $RegKeyPath"
    }

    if (Test-Path -LiteralPath $InstallDir) {
        # Entfernt den GESAMTEN Installationsordner (notizbuch-open.js,
        # package.json, Logs UND jeden Altbestand aus fruegeren Versionen
        # in EINEM Schritt, unabhaengig vom konkreten Dateinamen) - kein
        # separates Aufzaehlen einzelner Dateien noetig, "-Recurse"
        # erfasst alles, was jemals in diesem Ordner gelandet ist.
        Remove-Item -LiteralPath $InstallDir -Recurse -Force
        Write-Host "  [OK] Installationsordner (inkl. jedem Altbestand) entfernt: $InstallDir"
    } else {
        Write-Host "  [--] Installationsordner war nicht vorhanden: $InstallDir"
    }

    Write-Host 'Deinstallation abgeschlossen.'
    exit 0
}

if (-not (Test-Path -LiteralPath $SourceScriptPath)) {
    throw "Handler-Skript nicht gefunden: $SourceScriptPath (dieses Setup-Skript muss im selben Ordner wie notizbuch-open.js liegen, z. B. tools/)"
}
if (-not (Test-Path -LiteralPath $SourcePackageJsonPath)) {
    throw "package.json nicht gefunden: $SourcePackageJsonPath (dieses Setup-Skript muss im selben Ordner wie tools/package.json liegen - noetig, damit node.exe notizbuch-open.js im installierten Ordner als ES-Modul erkennt, siehe deren Kopfkommentar 'MODUL-FORMAT')"
}

# --- Schritt 0: node.exe AUFLOESEN UND VERIFIZIEREN - VOR JEDEM
#     SCHREIBZUGRIFF (dieselbe Lektion wie beim vorherigen powershell.exe-
#     Check, siehe Review-Fix Sicherheits-Review Runde 4: eine fruehere
#     Fassung dieses Skripts legte bereits Ordner/Registry an, BEVOR die
#     Interpreter-Pruefung ueberhaupt lief - bei fehlendem Interpreter
#     waere ein HALB registriertes Protokoll zurueckgeblieben, das der
#     Browser bereits als installiert anbietet, aber bei jedem Klick nur
#     scheitert). Reihenfolge bewusst: ERST pruefen, DANN erst
#     irgendetwas auf die Platte/in die Registry schreiben.
# Reihenfolge der Kandidaten:
#   1. "Get-Command node" - respektiert PATH, deckt damit automatisch
#      auch nvm-windows/Chocolatey/winget/benutzerdefinierte Installationen
#      ab, die PATH bereits korrekt gesetzt haben (der haeufigste Fall).
#      "-Select-Object -First 1" ist hier bewusst gesetzt: Get-Command
#      liefert bei MEHREREN node.exe im PATH (z. B. ein alter Rest-Eintrag
#      neben einer aktuellen nvm-windows-Installation) ein ARRAY von
#      Treffern zurueck - ohne die Begrenzung wuerde ".Source" darauf ein
#      eigenes Array liefern (PowerShell-Member-Enumeration), das sich in
#      der spaeteren Pfad-/Registry-String-Verkettung nicht sauber wie ein
#      einzelner Pfad verhaelt. GENAU EIN Treffer (der laut PATH-Reihenfolge
#      zuerst gefundene, exakt wie ein manueller "node"-Aufruf in einer
#      normalen Shell ihn auch verwenden wuerde) wird verwendet.
$nodeExe = $null
$nodeCommand = Get-Command 'node.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($nodeCommand) {
    $nodeExe = $nodeCommand.Source
} else {
    $nodeCandidates = @(
        (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe')
    )
    $nodeExe = $nodeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
}
if (-not $nodeExe -or -not (Test-Path -LiteralPath $nodeExe)) {
    throw "node.exe wurde nicht gefunden (weder ueber PATH noch unter den " +
        "Standard-Installationspfaden) - Einrichtung ABGEBROCHEN, BEVOR " +
        "irgendetwas geschrieben wurde. Node.js wird fuer den notizbuch-" +
        "open-Handler benoetigt (siehe DECISIONS.md #79 fuer den Grund: " +
        "Chrome akzeptiert node.exe als Protokoll-Ziel, einen selbst " +
        "kompilierten Launcher dagegen nicht) - bitte Node.js von " +
        "https://nodejs.org installieren und dieses Setup erneut ausfuehren."
}

# Registry-Befehl zeigt DIREKT auf node.exe (siehe Kopfkommentar
# "ARCHITEKTUR-WECHSEL v7.38") - node.exe bekommt notizbuch-open.js als
# ERSTES Argument, die geklickte URL als "%1" (von Windows eingesetzt)
# als ZWEITES.
$command = '"' + $nodeExe + '" "' + $InstalledScriptPath + '" "%1"'

Write-Host 'Richte das notizbuch-open Protokoll ein ...'
Write-Host "  [OK] node.exe verifiziert unter: $nodeExe"

# Merkt sich, was VOR diesem Lauf bereits existierte - ein Fehlschlag
# mittendrin rollt NUR das zurueck, was DIESER Lauf neu angelegt hat,
# nicht eine eventuell schon laenger bestehende, funktionierende
# Installation aus einem frueheren erfolgreichen Lauf.
$installDirExistedBefore = Test-Path -LiteralPath $InstallDir
$regKeyExistedBefore = Test-Path -LiteralPath $RegKeyPath

try {
    # 1. Installationsordner anlegen, ALTBESTAND aus fruegeren Versionen
    #    entfernen (siehe Kopfkommentar/Remove-LegacyInstallFiles), dann
    #    notizbuch-open.js + package.json kopieren. -Force macht den
    #    Kopiervorgang idempotent (ueberschreibt eine vorhandene aeltere
    #    Kopie anstandslos).
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Remove-LegacyInstallFiles
    Copy-Item -LiteralPath $SourceScriptPath -Destination $InstalledScriptPath -Force
    Write-Host "  [OK] Handler-Skript kopiert nach: $InstalledScriptPath"
    Copy-Item -LiteralPath $SourcePackageJsonPath -Destination $InstalledPackageJsonPath -Force
    Write-Host "  [OK] package.json kopiert nach: $InstalledPackageJsonPath"

    # 2. Registry-Eintrag NUR unter HKCU (keine Adminrechte, siehe
    #    Kopfkommentar). "URL Protocol" (leerer String-Wert) ist der von
    #    Windows verlangte Marker, der einen Klassen-Schluessel ueberhaupt
    #    erst als Protokoll-Handler kennzeichnet (ohne ihn wird der
    #    Default-Befehl unten schlicht ignoriert).
    New-Item -Path $RegKeyPath -Force | Out-Null
    Set-ItemProperty -LiteralPath $RegKeyPath -Name '(Default)' -Value 'URL:Notizbuch Open Protocol'
    Set-ItemProperty -LiteralPath $RegKeyPath -Name 'URL Protocol' -Value ''

    New-Item -Path $RegCommandKeyPath -Force | Out-Null
    Set-ItemProperty -LiteralPath $RegCommandKeyPath -Name '(Default)' -Value $command
} catch {
    Write-Host "  [FEHLER] Einrichtung fehlgeschlagen: $($_.Exception.Message)"
    Write-Host '  Rolle NUR die in diesem Lauf NEU angelegten Teile zurueck ...'
    if (-not $regKeyExistedBefore -and (Test-Path -LiteralPath $RegKeyPath)) {
        Remove-Item -LiteralPath $RegKeyPath -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  [OK] Neu angelegten Registry-Schluessel zurueckgerollt: $RegKeyPath"
    }
    if (-not $installDirExistedBefore -and (Test-Path -LiteralPath $InstallDir)) {
        Remove-Item -LiteralPath $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  [OK] Neu angelegten Installationsordner zurueckgerollt: $InstallDir"
    }
    throw
}

# Der TATSAECHLICH geschriebene Befehl wird hier nochmal AUS DER REGISTRY
# ZURUECKGELESEN (nicht einfach die lokale Variable erneut ausgegeben) -
# ein Fehlschlag beim Schreiben (z. B. Berechtigungsproblem) waere sonst
# nicht sichtbar, obwohl der Text stimmt.
$writtenCommand = (Get-ItemProperty -LiteralPath $RegCommandKeyPath -Name '(Default)').'(Default)'
Write-Host "  [OK] Registry-Schluessel gesetzt: $RegKeyPath"
Write-Host "  [OK] Tatsaechlich in der Registry stehender Befehl: $writtenCommand"
if ($writtenCommand -ne $command) {
    Write-Host "  [WARNUNG] Der aus der Registry gelesene Befehl weicht vom geschriebenen Wert ab - bitte pruefen!"
}
Write-Host ''
Write-Host 'Fertig. notizbuch-open:-Links werden ab jetzt fuer dieses Windows-Benutzerkonto per registriertem Programm geoeffnet (Doppelklick-Semantik).'
Write-Host 'Der Browser fragt beim allerersten Klick einmalig um Erlaubnis, dieses Protokoll zu oeffnen.'
Write-Host "Zum Entfernen: powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Uninstall"
