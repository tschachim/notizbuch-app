#Requires -Version 5.1
<#
.SYNOPSIS
  Erzeugt EINMALIG den festen Signierschluessel der Notizbuch-Android-App und
  hinterlegt ihn als GitHub-Secrets (DECISIONS #140).

.DESCRIPTION
  Im EIGENEN PowerShell-Fenster ausfuehren (nicht durch einen Agenten - dessen
  Dateien ausserhalb des Projektordners sind fuer dich unsichtbar):

    pwsh -ExecutionPolicy Bypass -File android\tools\signierschluessel-erzeugen.ps1

  Legt im Zielordner (Standard: Dokumente\Notizbuch-Signatur) an:
    notizbuch-release.p12  privater Schluessel + Zertifikat (PKCS12, mit Passwort)
    zertifikat.pem         oeffentliches Zertifikat
    LIESMICH.txt           Fingerabdruck, Datum, Hinweise (OHNE Passwort)

  Das Passwort wird zufaellig erzeugt, nur in die Zwischenablage gelegt und
  nirgends gespeichert - sofort im Passwortmanager ablegen. Danach setzt das
  Skript per gh die ZWEI Repo-Secrets NOTIZBUCH_KEYSTORE_BASE64 und
  NOTIZBUCH_KEYSTORE_PASSWORD. Der Schluessel-Alias "notizbuch" ist kein
  Geheimnis und steht als Konstante in .github/workflows/android.yml (als
  Secret maskierte GitHub jedes "notizbuch" im Log).

  Ein vorhandener Schluessel wird NIE ueberschreiben (ein neuer Schluessel hiesse:
  App deinstallieren, PAT/API-Key neu eingeben). Secrets aus einem
  vorhandenen Schluessel neu setzen: Schalter -NurSecretsSetzen.

.PARAMETER Zielordner
  Ablage des Schluessels - AUSSERHALB des Repos.
.PARAMETER Repo
  GitHub-Repo fuer die Secrets.
.PARAMETER OhneSecrets
  Nur Schluessel erzeugen, keine Secrets setzen.
.PARAMETER NurSecretsSetzen
  Keinen Schluessel erzeugen; Secrets aus dem vorhandenen
  notizbuch-release.p12 setzen (fragt nach dem Passwort).
#>
[CmdletBinding()]
param(
  [string]$Zielordner = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Notizbuch-Signatur'),
  [string]$Repo = 'tschachim/notizbuch-app',
  [switch]$OhneSecrets,
  [switch]$NurSecretsSetzen
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

# Alias im PKCS12. KEIN Secret: muss mit NOTIZBUCH_KEY_ALIAS in
# .github/workflows/android.yml uebereinstimmen (dort als Konstante).
$Alias = 'notizbuch'
$PassVar = 'NOTIZBUCH_KS_PASS' # nur fuer die Kindprozesse (openssl -pass env:), am Ende geloescht

# Native Programme ohne PowerShell-Fehlerumwandlung von stderr aufrufen
# (Windows PowerShell 5.1 machte daraus sonst abbrechende Fehler).
function Invoke-Native {
  param([string]$Exe, [string[]]$ArgList, [string]$Was)
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & $Exe @ArgList 2>&1 | ForEach-Object { "$_" } | Out-String
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $old
  }
  if ($code -ne 0) { throw "$Was fehlgeschlagen (Exit $code):`n$out" }
  return $out
}

function Find-OpenSsl {
  # Bevorzugt das native OpenSSL 3 aus Git for Windows.
  foreach ($p in @("$env:ProgramFiles\Git\mingw64\bin\openssl.exe", "$env:ProgramFiles\Git\usr\bin\openssl.exe")) {
    if (Test-Path -LiteralPath $p) { return $p }
  }
  $cmd = Get-Command openssl -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw 'openssl nicht gefunden (kommt mit Git for Windows).'
}

function Get-Fingerprint([string]$Ossl, [string]$CertPem) {
  $line = Invoke-Native $Ossl @('x509', '-in', $CertPem, '-noout', '-fingerprint', '-sha256') 'Fingerabdruck'
  $fp = (($line -replace '(?s)^.*?Fingerprint=', '') -replace '[^0-9A-Fa-f]', '').ToLowerInvariant()
  if ($fp.Length -ne 64) { throw "Unerwartete Fingerabdruck-Ausgabe: $line" }
  return $fp
}

# Zwischenablage mit Wiederholung: CLIPBRD_E_CANT_OPEN ist ein bekannter
# transienter Windows-Fehler (Zwischenablage-/Passwortmanager mit
# Clipboard-Ueberwachung greifen kurz zu). Das Passwort liegt NUR dort - ein
# einzelner Fehlschlag darf es nicht verloren gehen lassen.
function Set-ClipboardSicher([string]$Text) {
  $letzter = ''
  for ($i = 1; $i -le 5; $i++) {
    try {
      Set-Clipboard -Value $Text -ErrorAction Stop
      return
    } catch {
      $letzter = $_.Exception.Message
      if ($i -lt 5) { Start-Sleep -Milliseconds 300 }
    }
  }
  throw "Zwischenablage nicht beschreibbar (Zwischenablage-Manager, RDP, Sandbox?): $letzter"
}

function Set-RepoSecrets([string]$P12, [string]$Pw) {
  $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($P12))
  # --body statt stdin: exakter Wert ohne angehaengten Zeilenumbruch. Beide
  # Werte sind Base64 bzw. Hex (keine Sonderzeichen). Der Alias ist KEIN
  # Secret (siehe $Alias oben) und wird deshalb nicht gesetzt.
  Invoke-Native 'gh' @('secret', 'set', 'NOTIZBUCH_KEYSTORE_BASE64', '--repo', $Repo, '--body', $b64) 'gh secret set NOTIZBUCH_KEYSTORE_BASE64' | Out-Null
  Invoke-Native 'gh' @('secret', 'set', 'NOTIZBUCH_KEYSTORE_PASSWORD', '--repo', $Repo, '--body', $Pw) 'gh secret set NOTIZBUCH_KEYSTORE_PASSWORD' | Out-Null
  Write-Host "Secrets in $Repo gesetzt (erwartet: NOTIZBUCH_KEYSTORE_BASE64 und NOTIZBUCH_KEYSTORE_PASSWORD):" -ForegroundColor Green
  Invoke-Native 'gh' @('secret', 'list', '--repo', $Repo) 'gh secret list' | Write-Host
}

$ossl = Find-OpenSsl
$ver = (Invoke-Native $ossl @('version') 'openssl version').Trim()
if ($ver -notmatch '^OpenSSL 3\.') { throw "OpenSSL 3 erwartet, gefunden: $ver ($ossl)" }

if (-not $OhneSecrets) {
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'GitHub CLI (gh) nicht gefunden.' }
  Invoke-Native 'gh' @('auth', 'status', '--hostname', 'github.com') 'gh auth status (bitte vorher "gh auth login")' | Out-Null
}

$p12 = Join-Path $Zielordner 'notizbuch-release.p12'
$certPem = Join-Path $Zielordner 'zertifikat.pem'
$keyPem = Join-Path $Zielordner 'schluessel.tmp.pem'

if ($NurSecretsSetzen) {
  if (-not (Test-Path -LiteralPath $p12)) { throw "$p12 nicht gefunden." }
  $sec = Read-Host 'Passwort des vorhandenen Schluessels' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { $pw = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  Set-Item -Path "Env:$PassVar" -Value $pw
  try {
    Invoke-Native $ossl @('pkcs12', '-in', $p12, '-nokeys', '-clcerts', '-out', $certPem, '-passin', "env:$PassVar") 'Schluessel oeffnen (Passwort falsch?)' | Out-Null
  } finally {
    Remove-Item -Path "Env:$PassVar" -ErrorAction SilentlyContinue
  }
  if (-not $OhneSecrets) { Set-RepoSecrets $p12 $pw }
  Write-Host ''
  Write-Host "Zertifikat-Fingerabdruck (SHA-256): $(Get-Fingerprint $ossl $certPem)" -ForegroundColor Cyan
  return
}

if (Test-Path -LiteralPath $p12) {
  throw "Es gibt bereits $p12. Ein neuer Schluessel hiesse erneute Neuinstallation der App - abgebrochen. (Secrets neu setzen: -NurSecretsSetzen)"
}

# Zwischenablage VOR der Schluesselerzeugung pruefen: Ist sie nicht beschreibbar,
# waere das Passwort nach der Erzeugung unwiederbringlich verloren und ein
# zweiter Lauf scheiterte am Nie-ueberschreiben-Schutz. Probe mit einem
# Leerzeichen (nicht mit dem Passwort, damit bei einem spaeteren Abbruch kein
# Passwort einer nie entstandenen Datei in der Zwischenablage zurueckbleibt).
try {
  Set-ClipboardSicher ' '
} catch {
  throw "$($_.Exception.Message) Es wurde noch KEIN Schluessel erzeugt - bitte erneut ausfuehren (pwsh 7 empfohlen)."
}

New-Item -ItemType Directory -Force -Path $Zielordner | Out-Null

# Zufallspasswort: 24 Byte aus dem Kryptozufall, als Hex (192 Bit, keine Sonderzeichen).
$bytes = New-Object byte[] 24
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$pw = -join ($bytes | ForEach-Object { $_.ToString('x2') })

Set-Item -Path "Env:$PassVar" -Value $pw
try {
  # RSA 4096, SHA-256, ~27 Jahre gueltig (Android empfiehlt >= 25 Jahre). Der
  # private Schluessel liegt nie unverschluesselt auf der Platte.
  Invoke-Native $ossl @('req', '-x509', '-newkey', 'rsa:4096', '-sha256', '-days', '10000',
    '-subj', '/CN=Notizbuch Android/O=tschachim', '-keyout', $keyPem, '-out', $certPem,
    '-passout', "env:$PassVar") 'Schluessel erzeugen' | Out-Null
  Invoke-Native $ossl @('pkcs12', '-export', '-inkey', $keyPem, '-passin', "env:$PassVar",
    '-in', $certPem, '-name', $Alias, '-out', $p12, '-passout', "env:$PassVar") 'PKCS12 erzeugen' | Out-Null
  Invoke-Native $ossl @('pkcs12', '-in', $p12, '-noout', '-passin', "env:$PassVar") 'Probe-Oeffnen' | Out-Null
} finally {
  Remove-Item -Path "Env:$PassVar" -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $keyPem) { Remove-Item -LiteralPath $keyPem -Force }
}

$fp = Get-Fingerprint $ossl $certPem
$heute = Get-Date -Format 'yyyy-MM-dd'
@"
Notizbuch Android - Signierschluessel (DECISIONS #140)
Erzeugt am:         $heute
Datei:              notizbuch-release.p12 (PKCS12, Alias "$Alias")
Passwort:           NUR im Passwortmanager (Eintrag "Notizbuch Android Signierschluessel")
Zertifikat SHA-256: $fp

WICHTIG
- Diesen Ordner zusaetzlich an einem zweiten Ort sichern (z. B. USB-Stick).
  Geht Schluessel oder Passwort verloren, kann kein Update mehr ueber die
  installierte App gespielt werden: Neuinstallation (PAT/API-Key neu
  eingeben) und neuer Schluessel.
- Nie ins Repo kopieren, nie per Chat/Mail versenden.
- Secrets in GitHub neu setzen (z. B. nach versehentlichem Loeschen):
  pwsh -ExecutionPolicy Bypass -File android\tools\signierschluessel-erzeugen.ps1 -NurSecretsSetzen
"@ | Set-Content -LiteralPath (Join-Path $Zielordner 'LIESMICH.txt') -Encoding UTF8

try {
  Set-ClipboardSicher $pw
} catch {
  # Netz zum Vorab-Test: Schluessel ohne bekanntes Passwort ist wertlos und
  # wuerde den Neustart blockieren (Nie-ueberschreiben-Schutz). Das Passwort
  # wird dabei nie angezeigt.
  Remove-Item -LiteralPath $p12, $certPem, (Join-Path $Zielordner 'LIESMICH.txt') -Force -ErrorAction SilentlyContinue
  throw "$($_.Exception.Message) Der eben erzeugte Schluessel wurde wieder entfernt - bitte erneut ausfuehren (pwsh 7 empfohlen)."
}
Write-Host ''
Write-Host 'Das Passwort liegt jetzt in der Zwischenablage.' -ForegroundColor Yellow
Write-Host 'Bitte JETZT im Passwortmanager speichern (Eintrag "Notizbuch Android Signierschluessel").' -ForegroundColor Yellow
[void](Read-Host 'Danach Enter druecken')
# Das Leeren darf das Setzen der Secrets nicht verhindern (Schluessel und
# Passwort sind zu diesem Zeitpunkt schon gesichert).
try {
  Set-Clipboard -Value ' ' -ErrorAction Stop
  Write-Host '(Zwischenablage geleert - ggf. auch den Windows-Zwischenablageverlauf leeren: Win+V.)'
} catch {
  Write-Host 'Zwischenablage konnte nicht geleert werden - bitte manuell ueberschreiben (Passwort steht noch darin!).' -ForegroundColor Yellow
}

if (-not $OhneSecrets) {
  try {
    Set-RepoSecrets $p12 $pw
  } catch {
    # Der Schluessel existiert und das Passwort liegt im Passwortmanager:
    # nur die Secrets nachholen, NICHT von vorn anfangen (ein zweiter Lauf
    # bricht ohnehin ab, weil der Schluessel nie ueberschrieben wird).
    Write-Host ''
    Write-Host "Die Secrets konnten NICHT gesetzt werden. Der Schluessel liegt bereits in $Zielordner." -ForegroundColor Red
    Write-Host 'Nachholen mit: -NurSecretsSetzen (siehe LIESMICH.txt im Schluesselordner).' -ForegroundColor Red
    throw
  }
}
$pw = $null

Write-Host ''
Write-Host "Fertig. Schluesselordner: $Zielordner" -ForegroundColor Green
Write-Host "Zertifikat-Fingerabdruck (SHA-256, oeffentlich - bitte an Claude weitergeben):" -ForegroundColor Cyan
Write-Host $fp -ForegroundColor Cyan
