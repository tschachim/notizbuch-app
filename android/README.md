# Notizbuch – Android-App

Rahmenlose WebView-Hülle um https://tschachim.github.io/notizbuch-app/
(DECISIONS #30). Die App lädt immer die aktuelle Website – neue Funktionen
der Web-App kommen ohne App-Update an. Seit Version 2.0 (DECISIONS #140)
kann die App zusätzlich die Android-Spracherkennung für den Mikrofon-Knopf
im Chat benutzen.

Download (fester Link):
https://github.com/tschachim/notizbuch-app/releases/download/android-apk/notizbuch.apk

## Einmaliger Umstieg von Version 1.0 auf 2.0

Version 1.0 war mit einem wechselnden Test-Schlüssel signiert; ab 2.0 gibt es
einen festen Schlüssel. Android lässt deshalb **genau einmal** kein Update zu:
die alte App muss vorher runter. Dabei löscht Android die App-Daten
(Verbindung, PAT, API-Key, lokale Einstellungen). Ab 2.0 ist das vorbei.

1. **Vorher bereitlegen:** GitHub-Owner (tschachim), Daten-Repo-Name,
   GitHub-PAT und Anthropic-API-Key – z. B. im Passwortmanager. Ist der PAT
   nirgends gespeichert: auf GitHub einen neuen anlegen (gleiche Rechte wie
   der alte, alter PAT kann danach widerrufen werden).
2. Die Release-Seite öffnen:
   https://github.com/tschachim/notizbuch-app/releases/tag/android-apk –
   der Release-Text nennt den festen Signierschlüssel (Zertifikat SHA-256).
   Daran erkennst du Version 2.0; das alte 1.0-Release hatte diesen Hinweis
   nicht.
3. Alte App deinstallieren (lange auf das Symbol tippen → App-Info →
   Deinstallieren).
4. `notizbuch.apk` von der Release-Seite (oder über den Link oben)
   herunterladen und öffnen; ggf. „Installation aus dieser Quelle erlauben“
   bestätigen. Hinweise von Play Protect („unbekannte App“) mit „Trotzdem
   installieren“ bestätigen.
5. App öffnen, im Einstellungsdialog Owner, Repo, PAT und API-Key eintragen,
   „Speichern & Verbinden“.
6. Mikrofon-Knopf im Chat antippen → Android fragt nach dem Mikrofon →
   **„Bei Nutzung der App zulassen“**. Sprechen; der Text erscheint im Feld.
7. Kontrolle: Einstellungen → „Spracheingabe (Android-App)“ → „Diagnose
   anzeigen“ nennt die App-Version 2.0.

## Updates ab Version 2.0

Neues APK über denselben Link herunterladen und öffnen → „Aktualisieren“.
Nichts deinstallieren – Verbindung, PAT und API-Key bleiben erhalten.

## Spracheingabe in der App

- Antippen startet, Sprechpause oder erneutes Antippen beendet; der Text wird
  an vorhandenen Text angehängt, nie automatisch gesendet.
- Erkannt wird über den Sprachdienst des Geräts (in der Regel „Speech
  Services by Google“), das Audio geht also an Google – wie beim
  Mikrofon der Gboard-Tastatur.
- Mikrofon versehentlich verweigert: Der Hinweis im Chat bietet
  „Einstellungen öffnen“ an → Berechtigungen → Mikrofon → „Bei Nutzung der
  App zulassen“.
- Klappt etwas nicht: Einstellungen (Zahnrad) → „Spracheingabe
  (Android-App)“ → „Diagnose anzeigen“ und den Text an Claude geben. Dort
  lässt sich zum Test auch auf den „WebView-Erkenner“ umschalten – ohne neues
  APK.

## Für den Betreiber: Signierschlüssel

- Erzeugen (einmalig, im eigenen PowerShell-Fenster im Repo-Ordner):
  `pwsh -ExecutionPolicy Bypass -File android\tools\signierschluessel-erzeugen.ps1`
  Legt `Dokumente\Notizbuch-Signatur\` an (Schlüssel, Zertifikat,
  LIESMICH.txt), legt das Zufallspasswort in die Zwischenablage (sofort in
  den Passwortmanager; ist die Zwischenablage nicht beschreibbar, bricht das
  Skript ab, ohne einen Schlüssel zu hinterlassen – dann einfach erneut
  ausführen, ggf. mit pwsh 7) und setzt die zwei Repo-Secrets
  `NOTIZBUCH_KEYSTORE_BASE64` und `NOTIZBUCH_KEYSTORE_PASSWORD`. Der
  Schlüssel-Alias `notizbuch` ist kein Geheimnis und steht deshalb als
  Konstante `NOTIZBUCH_KEY_ALIAS` im Workflow (als Secret maskierte GitHub
  jedes „notizbuch“ im Log); ein früher angelegtes Secret dieses Namens
  wird nicht gebraucht und lässt sich mit
  `gh secret delete NOTIZBUCH_KEY_ALIAS --repo tschachim/notizbuch-app`
  löschen. Am Ende steht der öffentliche
  SHA-256-Fingerabdruck – er gehört als `EXPECTED_CERT_SHA256` in
  `.github/workflows/android.yml`.
- **Sichern:** den Ordner `Notizbuch-Signatur` zusätzlich an einem zweiten
  Ort ablegen. Ohne Schlüssel + Passwort keine Updates mehr: dann wieder
  deinstallieren/neu installieren und ein neuer Schlüssel (und später keine
  Registrierung des Pakets bei Googles Entwickler-Verifizierung).
  Wird „Dokumente“ von OneDrive synchronisiert, liegt die – mit dem Passwort
  verschlüsselte – `.p12` auch dort; das ist als Zusatz-Backup in Ordnung,
  das Passwort steht nie im Ordner (nur im Passwortmanager).
- Secrets neu setzen (Schlüssel bleibt): Skript mit `-NurSecretsSetzen`.
- Der Schlüssel kommt **nie** ins Repo (`.gitignore`: `*.p12`, `*.jks`,
  `*.keystore`, `keystore.properties`). Der Workflow bekommt ihn nur über die
  zwei Secrets; das Passwort wird nie ausgegeben.

## Für den Betreiber: Bauen und Veröffentlichen

- Änderungen unter `android/` zuerst auf einen **Branch** pushen: Der Job
  „check“ baut Debug + Lint, macht mit den Secrets einen signierten
  Probebuild mit allen Prüfungen (nichts wird veröffentlicht) und – optional –
  einen Emulator-Smoke-Test der Spracheingabe-Brücke.
- Erst danach auf `main`: Der Job „release“ baut signiert, prüft
  Zertifikat-Fingerabdruck, RECORD_AUDIO, „nicht debuggable“ und
  versionCode > veröffentlicht – und ersetzt erst dann das Release
  „android-apk“. Scheitert etwas, bleibt das alte Release unverändert.
- `versionCode` in `android/app/build.gradle` bei **jeder** APK-Änderung um 1
  erhöhen. Der Job „release“ scheitert absichtlich, wenn der versionCode nicht
  größer ist als der des veröffentlichten APK – auch bei einem Push auf
  `main`, der nur den Workflow ändert. Das bisherige Release bleibt dann
  unberührt; für eine reine Workflow-Änderung ist das Rot also erwartet.
- Startet der erste Push eines neuen Branches den Lauf nicht (Pfad-Filter
  des Workflows), von Hand anstoßen:
  `gh workflow run android.yml --ref <branch>`.
- Der Smoke-Test ist **nicht blockierend** (`continue-on-error`): ein grüner
  Workflow sagt allein nichts, das Log des Jobs „smoke“ gehört gelesen. Der
  CI-Emulator hat kein Mikrofonsignal; erwartet sind Erkennungsfehler, aber
  immer genau ein „end“ pro Sitzung.
- Pull-Requests aus Forks haben keinen Zugriff auf die Secrets: dort laufen
  nur Debug-Build und Lint, der signierte Probebuild wird übersprungen.
- Das Debug-APK aus dem Artefakt „notizbuch-debug-NICHT-INSTALLIEREN“ hat
  eine andere Signatur als die Release-App und darf nicht installiert
  werden (ein Update scheitert an der Signatur; nach einer Deinstallation
  wären Verbindung, PAT und API-Key weg).
