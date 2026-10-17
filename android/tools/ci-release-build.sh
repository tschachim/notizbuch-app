#!/usr/bin/env bash
# Signierter Release-Build der Android-Huelle mit Pflichtpruefungen
# (DECISIONS #140). Aufruf aus .github/workflows/android.yml:
#   bash android/tools/ci-release-build.sh probe    # Branch/PR: ohne Secrets still ueberspringen
#   bash android/tools/ci-release-build.sh release  # main: ohne Secrets FEHLER, Ergebnis notizbuch.apk
# Erwartete Umgebung: EXPECTED_CERT_SHA256, APP_ID, NOTIZBUCH_KEYSTORE_BASE64,
# NOTIZBUCH_KEYSTORE_PASSWORD (die beiden echten Secrets), GH_TOKEN,
# GITHUB_REPOSITORY, ANDROID_HOME, RUNNER_TEMP; keytool und gradle im PATH.
# NOTIZBUCH_KEY_ALIAS ist KEIN Secret (Konstante im Workflow, Standard
# "notizbuch"), build.gradle liest ihn aus der Umgebung.
set -euo pipefail

mode="${1:-}"
case "$mode" in
  probe|release) ;;
  *) echo "Aufruf: $0 probe|release" >&2; exit 2 ;;
esac

fail() { echo "::error::$*"; exit 1; }

# Nur die zwei ECHTEN Secrets pruefen. Der Alias ist kein Geheimnis: er kommt
# aus der Umgebung (Workflow-Konstante) und hat hier den Standard "notizbuch";
# exportiert, damit gradle (build.gradle: System.getenv) ihn sieht.
export NOTIZBUCH_KEY_ALIAS="${NOTIZBUCH_KEY_ALIAS:-notizbuch}"
if [ -z "${NOTIZBUCH_KEYSTORE_BASE64:-}" ] || [ -z "${NOTIZBUCH_KEYSTORE_PASSWORD:-}" ]; then
  if [ "$mode" = probe ]; then
    echo "::notice::Signier-Secrets nicht verfuegbar (Fork-PR oder noch nicht angelegt) - signierter Probebuild uebersprungen."
    exit 0
  fi
  fail "Signier-Secrets fehlen (NOTIZBUCH_KEYSTORE_BASE64, NOTIZBUCH_KEYSTORE_PASSWORD) - es wird NICHTS veroeffentlicht. Siehe android/README.md."
fi
[[ "${EXPECTED_CERT_SHA256:-}" =~ ^[0-9a-f]{64}$ ]] || fail "EXPECTED_CERT_SHA256 im Workflow fehlt oder ist ungueltig (64 Hex-Zeichen, klein)."
[[ "${APP_ID:-}" =~ ^[a-z][a-z0-9_.]*$ ]] || fail "APP_ID fehlt."

tmp="${RUNNER_TEMP:-$(mktemp -d)}"
ks="$tmp/notizbuch-release.p12"
trap 'rm -f "$ks"' EXIT

# Secret -> Datei. Leerraum (z. B. beim Kopieren entstandene Umbrueche) entfernen.
printf '%s' "$NOTIZBUCH_KEYSTORE_BASE64" | tr -d ' \t\r\n' | base64 --decode > "$ks" \
  || fail "NOTIZBUCH_KEYSTORE_BASE64 ist kein gueltiges Base64."

# Ladeprobe mit derselben JDK, die Gradle benutzt (PKCS12 aus OpenSSL 3:
# AES-256-CBC/PBKDF2/HMAC-SHA256 - liest Java ab 11.0.12/17).
keytool -list -keystore "$ks" -storetype pkcs12 -storepass:env NOTIZBUCH_KEYSTORE_PASSWORD \
  -alias "$NOTIZBUCH_KEY_ALIAS" > /dev/null \
  || fail "Keystore laesst sich nicht laden (Passwort, Alias oder Format). Siehe android/README.md."

export NOTIZBUCH_KEYSTORE_PATH="$ks"
gradle -p android assembleRelease lintRelease

apk=android/app/build/outputs/apk/release/app-release.apk
[ -f "$apk" ] || fail "$apk fehlt - wurde unsigniert gebaut?"

sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[ -d "$sdk/build-tools" ] || fail "Android-SDK (ANDROID_HOME/build-tools) nicht gefunden."
bt="$(ls -d "$sdk"/build-tools/*/ | sort -V | tail -n 1)"
bt="${bt%/}"
echo "build-tools: $bt"

cert_sha256() { sed -n 's/^Signer #1 certificate SHA-256 digest: *//p' | tr -d '[:space:]' | tr 'A-F' 'a-f'; }
# Feld aus der "package:"-Zeile von aapt2 dump badging. Das Leerzeichen vor dem
# Feldnamen verhindert Treffer in compileSdkVersionCodename='..' u. Ae.
badging_field() { sed -n "s/^package:.* $1='\\([^']*\\)'.*/\\1/p"; }

# 1) Signatur: genau EIN Signer, und zwar mit dem festgeschriebenen Zertifikat.
certs="$("$bt/apksigner" verify --print-certs "$apk")" || fail "apksigner verify fehlgeschlagen."
signers="$(printf '%s\n' "$certs" | grep -c '^Signer #[0-9]* certificate SHA-256 digest:' || true)"
actual="$(printf '%s\n' "$certs" | cert_sha256)"
[ "$signers" = "1" ] || fail "Erwartet genau einen Signer, gefunden: $signers."
[ "$actual" = "$EXPECTED_CERT_SHA256" ] || fail "Falsches Zertifikat: erwartet $EXPECTED_CERT_SHA256, gefunden $actual."

# 2) Manifest: Paket, Mikrofon-Berechtigung, nicht debuggable.
badging="$("$bt/aapt2" dump badging "$apk")" || fail "aapt2 dump badging fehlgeschlagen."
pkg="$(printf '%s\n' "$badging" | badging_field name)"
vc="$(printf '%s\n' "$badging" | badging_field versionCode)"
vn="$(printf '%s\n' "$badging" | badging_field versionName)"
[ "$pkg" = "$APP_ID" ] || fail "Paketname '$pkg' statt '$APP_ID'."
[[ "$vc" =~ ^[0-9]+$ ]] || fail "versionCode nicht lesbar."
printf '%s\n' "$badging" | grep -q "^uses-permission: name='android.permission.RECORD_AUDIO'" \
  || fail "RECORD_AUDIO fehlt im Manifest."
if printf '%s\n' "$badging" | grep -q '^application-debuggable'; then fail "Release-APK ist debuggable."; fi

# 3) versionCode muss groesser sein als beim veroeffentlichten APK: Android
#    installiert ein Update nur ohne Versions-Rueckschritt (und nur bei
#    gleicher Signatur, siehe 1).
old="$tmp/released.apk"
rm -f "$old"
if dl_err="$(gh release download android-apk --repo "$GITHUB_REPOSITORY" --pattern notizbuch.apk --output "$old" 2>&1)"; then
  oldvc="$("$bt/aapt2" dump badging "$old" | badging_field versionCode)"
  oldcert="$("$bt/apksigner" verify --print-certs "$old" 2>/dev/null | cert_sha256 || true)"
  echo "Veroeffentlicht: versionCode ${oldvc:-?}, Zertifikat ${oldcert:-?}"
  [[ "$oldvc" =~ ^[0-9]+$ ]] || fail "versionCode des veroeffentlichten APK nicht lesbar."
  [ "$vc" -gt "$oldvc" ] || fail "versionCode $vc ist nicht groesser als der veroeffentlichte ($oldvc) - in android/app/build.gradle erhoehen."
  if [ "$oldcert" != "$EXPECTED_CERT_SHA256" ]; then
    echo "::warning::Das veroeffentlichte APK hat eine andere Signatur (Umstieg): die alte App muss EINMALIG deinstalliert werden."
  fi
elif printf '%s' "$dl_err" | grep -qiE 'not found|no assets match|HTTP 404'; then
  echo "::notice::Kein veroeffentlichtes APK gefunden - versionCode-Vergleich entfaellt."
elif [ "$mode" = release ]; then
  # Netz-/API-Fehler duerfen den Vergleich nicht stillschweigend aushebeln:
  # ein zu kleiner versionCode wuerde auf den Geraeten nicht installiert.
  fail "Veroeffentlichtes APK nicht ladbar, versionCode-Vergleich nicht moeglich: $dl_err"
else
  echo "::warning::Veroeffentlichtes APK nicht ladbar - versionCode-Vergleich uebersprungen: $dl_err"
fi

echo "OK: $pkg $vn (versionCode $vc), Zertifikat $actual"
if [ "$mode" = release ]; then
  cp "$apk" notizbuch.apk
fi
