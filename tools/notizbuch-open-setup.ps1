<#
====================================================================
notizbuch-open-setup.ps1  (Notizbuch-App v7.37)
====================================================================
ZWECK
  Einmalige Einrichtung PRO WINDOWS-BENUTZERKONTO des eigenen
  URL-Protokolls "notizbuch-open:" (Kontrakt v1, siehe Kopfkommentar von
  notizbuch-open-handler.ps1). Danach oeffnet ein Klick auf einen
  file:-Link im Dokument-Viewer der App die Datei im dafuer registrierten
  Windows-Programm (wie ein Explorer-Doppelklick).

  NUR HKCU (Software\Classes), KEINE Adminrechte noetig - HKCU\Software\
  Classes wird von Windows beim Aufloesen eines Protokolls/einer
  Dateiendung IMMER VOR HKLM\Software\Classes geprueft, ein normaler
  Benutzer kann sich damit ein eigenes Protokoll registrieren, ohne
  Maschinen-weite (HKLM) Einstellungen zu veraendern oder erhoehte
  Rechte zu benoetigen - genau richtig fuer ein Ein-Nutzer-Tool wie
  dieses.

  Die Registry zeigt NICHT (mehr) direkt auf powershell.exe, sondern auf
  einen eigenen, schlanken Launcher (NotizbuchOpenLauncher.cs, wird HIER
  bei der Einrichtung MIT dem im System vorhandenen csc.exe kompiliert -
  siehe Schritt 2 unten). LIVE-BEFUND (v7.37, siehe DECISIONS.md #79 fuer
  die vollstaendige Fassung): Chrome blockiert einen Protokoll-Handler,
  dessen Ziel-Executable ein SKRIPT-INTERPRETER ist (powershell.exe,
  cmd.exe, ...) - ein Klick loeste zwar "beforeunload" aus (Chrome begann
  die Navigation), aber NIE einen Handler-Aufruf, obwohl Windows selbst
  das Protokoll nachweislich korrekt aufloeste (Start-Process/
  AssocQueryString funktionierten). Ein "normales" Programm (getestet mit
  notepad.exe) als Ziel loeste dagegen sofort den erwarteten Browser-
  Erlaubnis-Dialog aus. Der Launcher ist fuer Chrome ein "normales"
  Programm, tut selbst aber NICHTS ausser den bestehenden PowerShell-
  Handler unveraendert weiterzureichen (siehe Kopfkommentar der .cs-Datei)
  - die GESAMTE Sicherheitspruefung bleibt ausschliesslich im Handler.

  Handler-Skript UND kompilierter Launcher werden gemeinsam nach
  "%LOCALAPPDATA%\NotizbuchOpen\" KOPIERT/geschrieben (statt die Registry
  direkt auf Pfade in diesem Repo zeigen zu lassen): LOCALAPPDATA ist ein
  STABILER, vom jeweiligen Repo-Klon-Pfad unabhaengiger Ort - verschiebt/
  loescht der Nutzer sein Repo-Verzeichnis spaeter (z. B. beim
  Umbenennen/Neu-Klonen), bliebe ein direkt auf das Repo zeigender
  Registry-Eintrag sonst kaputt, ohne dass das fuer den Nutzer beim
  naechsten Link-Klick ersichtlich waere.

  Dieses Skript veraendert AUSSCHLIESSLICH die eine Registry-Struktur
  HKCU:\Software\Classes\notizbuch-open (samt Unterschluesseln) und den
  eigenen Ordner "%LOCALAPPDATA%\NotizbuchOpen\" - sonst NICHTS. Es
  installiert KEINEN Compiler - csc.exe ist Teil jeder Standard-Windows-
  Installation mit .NET Framework (kein zusaetzliches SDK noetig), wird
  hier nur AUFGERUFEN, nicht veraendert/installiert.

PARAMETER
  -Uninstall   Entfernt Registry-Schluessel + kopierten Ordner (Handler-
               Skript UND kompilierter Launcher) wieder rueckstandsfrei
               (idempotent, auch wenn nichts installiert war).

AUFRUF
  Installieren:   powershell -ExecutionPolicy Bypass -File notizbuch-open-setup.ps1
  Deinstallieren: powershell -ExecutionPolicy Bypass -File notizbuch-open-setup.ps1 -Uninstall
  Mehrfacher Aufruf ist idempotent (kompiliert/kopiert/erstellt einfach neu).
====================================================================
#>
param(
    [switch]$Uninstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$InstallDir = Join-Path $env:LOCALAPPDATA 'NotizbuchOpen'
$InstalledHandlerPath = Join-Path $InstallDir 'notizbuch-open-handler.ps1'
$InstalledLauncherPath = Join-Path $InstallDir 'notizbuch-open.exe'
$SourceHandlerPath = Join-Path $PSScriptRoot 'notizbuch-open-handler.ps1'
$SourceLauncherPath = Join-Path $PSScriptRoot 'NotizbuchOpenLauncher.cs'
$RegKeyPath = 'HKCU:\Software\Classes\notizbuch-open'
$RegCommandKeyPath = Join-Path $RegKeyPath 'shell\open\command'

if ($Uninstall) {
    Write-Host 'Entferne notizbuch-open Protokoll-Registrierung ...'

    if (Test-Path -LiteralPath $RegKeyPath) {
        Remove-Item -LiteralPath $RegKeyPath -Recurse -Force
        Write-Host "  [OK] Registry-Schluessel entfernt: $RegKeyPath"
    } else {
        Write-Host "  [--] Registry-Schluessel war nicht vorhanden: $RegKeyPath"
    }

    if (Test-Path -LiteralPath $InstallDir) {
        # Entfernt den GESAMTEN Installationsordner (Handler-Skript UND
        # kompilierten Launcher gemeinsam, siehe Kopfkommentar) - keine
        # separate Pruefung je Datei noetig, "-Recurse" erfasst beide.
        Remove-Item -LiteralPath $InstallDir -Recurse -Force
        Write-Host "  [OK] Installationsordner (Handler + Launcher) entfernt: $InstallDir"
    } else {
        Write-Host "  [--] Installationsordner war nicht vorhanden: $InstallDir"
    }

    Write-Host 'Deinstallation abgeschlossen.'
    exit 0
}

if (-not (Test-Path -LiteralPath $SourceHandlerPath)) {
    throw "Handler-Skript nicht gefunden: $SourceHandlerPath (dieses Setup-Skript muss im selben Ordner wie notizbuch-open-handler.ps1 liegen, z. B. tools/)"
}
if (-not (Test-Path -LiteralPath $SourceLauncherPath)) {
    throw "Launcher-Quelltext nicht gefunden: $SourceLauncherPath (dieses Setup-Skript muss im selben Ordner wie NotizbuchOpenLauncher.cs liegen, z. B. tools/)"
}

# --- Schritt 0: Interpreter/Compiler AUFLOESEN UND VERIFIZIEREN - VOR
#     JEDEM SCHREIBZUGRIFF (Review-Fix, Sicherheits-Review Runde 4: eine
#     fruehere Fassung legte bereits den Installationsordner an, kopierte
#     den Handler UND schrieb den kompletten Registry-Schluessel samt
#     "URL Protocol"-Marker, BEVOR diese Pruefung ueberhaupt lief - bei
#     fehlendem powershell.exe waere ein HALB registriertes Protokoll
#     zuruckgeblieben: der Browser haette es bereits als installiert
#     angeboten (der "URL Protocol"-Marker stand ja schon), ein Klick
#     haette aber NICHTS getan, weil der command-Registry-Wert auf eine
#     nicht existierende Datei gezeigt haette. Jetzt: ERST pruefen, DANN
#     erst irgendetwas auf die Platte/in die Registry schreiben - schlaegt
#     eine Pruefung fehl, bricht das Skript HIER ab, ohne auch nur EINEN
#     Schreibzugriff versucht zu haben. -----------------------------
# Windows PowerShell 5.1 EXPLIZIT ueber $env:SystemRoot aufloesen, NICHT
# ueber $PSHOME: $PSHOME ist der Installationsordner der GERADE
# AUSFUEHRENDEN PowerShell-Engine, NICHT zwingend der von Windows
# PowerShell 5.1. Fuehrt ein Nutzer dieses Setup-Skript unter PowerShell 7
# aus (haeufige Standard-Shell, z. B. Version 7.6.x), zeigt $PSHOME auf
# "C:\Program Files\PowerShell\7" - DORT liegt keine "powershell.exe" (die
# 7er-Engine heisst "pwsh.exe"). Handler.ps1 ist bewusst gegen Windows
# PowerShell 5.1 geschrieben (u. a. WinForms-MessageBox im STA-Standard-
# Apartment, siehe dessen Kopfkommentar) - deshalb wird hier IMMER die
# 64-Bit-System32-Variante von Windows PowerShell 5.1 verwendet,
# unabhaengig davon, unter welcher Engine dieses Setup-Skript selbst laeuft.
# Diese Pruefung bleibt bestehen, OBWOHL der Launcher powershell.exe zur
# LAUFZEIT selbst nochmal aufloest (siehe NotizbuchOpenLauncher.cs) - ein
# frueher, klarer Setup-Fehler ist besser als ein spaeterer, stiller
# Laufzeit-Fehlschlag beim ersten Link-Klick.
$powershellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $powershellExe)) {
    throw "Windows PowerShell 5.1 wurde nicht gefunden unter '$powershellExe' - Einrichtung ABGEBROCHEN, BEVOR irgendetwas geschrieben wurde (kein Installationsordner angelegt, kein Registry-Eintrag gesetzt). Der Handler (notizbuch-open-handler.ps1) braucht diese Engine (siehe deren Kopfkommentar); ohne sie kann das Protokoll nicht funktionieren."
}

# C#-Compiler (csc.exe) fuer den Launcher (siehe Kopfkommentar/
# NotizbuchOpenLauncher.cs fuer das WARUM) - Teil jeder Standard-Windows-
# Installation mit .NET Framework, KEIN zusaetzliches SDK noetig. 64-Bit-
# Variante bevorzugt, 32-Bit als Fallback (beide erzeugen ein identisch
# funktionierendes, plattformneutrales "AnyCPU"-Kompilat - der Unterschied
# ist nur, WELCHER Compiler-Prozess selbst laeuft).
$cscCandidates = @(
    (Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:SystemRoot 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$cscExe = $cscCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $cscExe) {
    throw "Kein C#-Compiler gefunden - geprueft:`n  " + ($cscCandidates -join "`n  ") + "`nEinrichtung ABGEBROCHEN, BEVOR irgendetwas geschrieben wurde. Der Launcher (NotizbuchOpenLauncher.cs) kann ohne csc.exe nicht kompiliert werden."
}

# Registry-Befehl zeigt auf den LAUNCHER (NICHT mehr direkt auf
# powershell.exe, siehe Kopfkommentar "Live-Befund") - der Launcher reicht
# die geklickte URL unveraendert an genau denselben powershell.exe-Aufruf
# weiter, den fruehere Versionen direkt in die Registry geschrieben haben.
$command = '"' + $InstalledLauncherPath + '" "%1"'

Write-Host 'Richte das notizbuch-open Protokoll ein ...'
Write-Host "  [OK] powershell.exe verifiziert unter: $powershellExe"
Write-Host "  [OK] C#-Compiler verifiziert unter: $cscExe"

# Merkt sich, was VOR diesem Lauf bereits existierte - ein Fehlschlag
# mittendrin rollt NUR das zurueck, was DIESER Lauf neu angelegt hat,
# nicht eine eventuell schon laenger bestehende, funktionierende
# Installation aus einem frueheren erfolgreichen Lauf.
$installDirExistedBefore = Test-Path -LiteralPath $InstallDir
$regKeyExistedBefore = Test-Path -LiteralPath $RegKeyPath

try {
    # 1. Handler-Datei nach LOCALAPPDATA kopieren (siehe Kopfkommentar,
    #    "warum LOCALAPPDATA statt Repo-Pfad"). -Force macht den
    #    Kopiervorgang idempotent (ueberschreibt eine vorhandene aeltere
    #    Kopie anstandslos).
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Copy-Item -LiteralPath $SourceHandlerPath -Destination $InstalledHandlerPath -Force
    Write-Host "  [OK] Handler kopiert nach: $InstalledHandlerPath"

    # 2. Launcher-.exe kompilieren. "/target:winexe" verhindert ein
    #    Konsolenfenster (siehe Kopfkommentar der .cs-Datei), "/out"
    #    schreibt/UEBERSCHREIBT direkt an den Zielort - idempotent bei
    #    wiederholtem Setup. csc.exe meldet Fehler ueber den Exit-Code
    #    (NICHT ueber eine PowerShell-Exception) - deshalb wird der
    #    explizit geprueft; eine evtl. GERADE LAUFENDE alte Launcher-
    #    Instanz koennte die Zieldatei kurzzeitig sperren, das Kompilat
    #    ist aber ein kurzlebiger Fire-and-Forget-Prozess (beendet sich
    #    selbst nach dem Start des Handlers), ein Fehlschlag hier waere
    #    also die seltene Ausnahme, nicht der Normalfall.
    $cscArgs = @(
        '/nologo', '/target:winexe',
        ('/out:' + $InstalledLauncherPath),
        '/reference:System.dll', '/reference:System.Windows.Forms.dll',
        $SourceLauncherPath
    )
    $cscOutput = & $cscExe @cscArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Kompilieren des Launchers fehlgeschlagen (csc.exe Exit-Code $LASTEXITCODE):`n$($cscOutput -join [Environment]::NewLine)"
    }
    Write-Host "  [OK] Launcher kompiliert nach: $InstalledLauncherPath"

    # 3. Registry-Eintrag NUR unter HKCU (keine Adminrechte, siehe
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
