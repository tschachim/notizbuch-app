# TODO – offene Punkte für kommende Runden

Sammelstelle für 🔵-Findings aus E2E-/Review-Läufen und bewusst
vertagte Punkte aus DECISIONS.md. Erledigte Einträge werden mit
Versions- und DECISIONS-Verweis gestrichen, nicht gelöscht.

## Aus der v7.60-Runde (APK 2.0, 2026-10-17)

Stand: Web-Seite und Android-Dateien liegen im Arbeitsbaum, die APK ist noch
nicht gebaut oder veröffentlicht. DECISIONS #140 enthält Begründung und
Restrisiken; die Fälle I0–I14 stehen in `docs/TESTFAELLE.md`.

- [ ] **Ausrollen der APK 2.0 (Reihenfolge, DECISIONS #140).** (1) Nutzer:
      `pwsh -ExecutionPolicy Bypass -File android\tools\signierschluessel-erzeugen.ps1`
      ausführen, Passwort im Passwortmanager ablegen, Ordner
      `Dokumente\Notizbuch-Signatur` zusätzlich sichern, Fingerabdruck
      weitergeben; `gh secret list --repo tschachim/notizbuch-app` muss die
      zwei Namen `NOTIZBUCH_KEYSTORE_BASE64` und
      `NOTIZBUCH_KEYSTORE_PASSWORD` zeigen (der Alias steht als Konstante im
      Workflow, kein Secret; ein früher angelegtes `NOTIZBUCH_KEY_ALIAS`
      wird nicht gebraucht und kann per `gh secret delete` weg). (2)
      `EXPECTED_CERT_SHA256` in
      `.github/workflows/android.yml` eintragen (steht auf einem Platzhalter,
      der absichtlich an der Formatprüfung scheitert). (3) Web v7.60
      deployen, Tester (I0). (4) Android auf Branch `android-v2`: Der Job
      `check` ist der ERSTE echte Compiler- und Lint-Lauf (kein JDK, kein
      Android-SDK lokal), bis er grün ist iterieren; das Log des Jobs `smoke`
      lesen (KVM auf Standard-Runnern und ein Sprachdienst im Emulator-Image
      sind unbelegt; ein grüner Workflow allein sagt nichts). (5)
      Fast-forward nach `main`, `gh release view android-apk` prüfen (neues
      Datum, Fingerabdruck in den Notes, Asset). (6) Nutzer: Umstieg nach
      `android/README.md`.
- [ ] **Geräte-Test der APK 2.0 durch den Nutzer (I1–I14).** Erst am Gerät
      zeigt sich, ob Dienstwahl (Google-Dienst wie Chrome), `UNSTABLE_TEXT`,
      Satzzeichen (Android 13+), Signalton und Sprechpause (~1 s) wie erwartet
      laufen. Bei Problemen den Text aus „Diagnose anzeigen“ in den Chat
      geben; Korrekturen bevorzugt im Web (Mapping, Engine, Dienst, Optionen),
      ein APK-Fix bekommt `versionCode` 3. DECISIONS #140.
- [ ] **CI (🔵, Entscheidung nötig): `release` bei unverändertem `versionCode`
      nicht rot werden lassen.** Nach dem ersten 2.0-Release macht jeder Push
      auf `main`, der `android/**` oder den Workflow berührt, ohne
      `versionCode`-Erhöhung den Job `release` absichtlich rot (steht in
      `android/README.md`): Fehl-Mails und ein rotes `main` bei reinen
      Workflow-/README-/Skript-Änderungen, obwohl nichts veröffentlicht werden
      soll (das Release bleibt dabei korrekt unberührt). Vorschlag in
      `android/tools/ci-release-build.sh` (ca. Z. 88, vor dem `-gt`-Vergleich),
      Modus `release`: `if [ "$vc" -eq "$oldvc" ] && [ "$oldcert" =
      "$EXPECTED_CERT_SHA256" ]; then echo '::notice::versionCode
      unverändert – keine Veröffentlichung.'; echo 'publish=false' >>
      "$GITHUB_OUTPUT"; exit 0; fi`; im Workflow dem Bau-Schritt `id: build`
      geben und den Veröffentlichen-Schritt mit `if: steps.build.outputs.
      publish != 'false'` versehen. Ein KLEINERER `versionCode` bleibt ein
      Fehler. Alternative: Ist-Zustand beibehalten.
- [ ] **CI (🔵): Asset ersetzen statt Release löschen und neu anlegen.**
      `.github/workflows/android.yml` (Schritt „Als Release "android-apk"
      veröffentlichen“, ca. Z. 150-154): Zwischen `gh release delete` und
      `gh release create` liefert der feste Download-Link einige Sekunden 404;
      scheitert `gh release create` (Netz/API), ist das Release weg, bis der
      Lauf wiederholt wird (Muster stammt aus #30). Vorschlag: `if gh release
      view android-apk >/dev/null 2>&1; then gh release upload android-apk
      notizbuch.apk --clobber && gh release edit android-apk --title … --notes
      "…"; else gh release create … --target "$GITHUB_SHA" …; fi`.
      Abwägung: Der Tag `android-apk` bliebe dann auf dem Commit des
      Erst-Releases; soll er mitwandern, den Ist-Zustand lassen.
- [ ] **Schlüsselskript (🔵): Secrets über stdin statt als Argument.**
      `android/tools/signierschluessel-erzeugen.ps1` (ca. Z. 88-90, `gh secret
      set … --body $Pw`): Base64-Keystore und Passwort stehen für die Laufzeit
      von `gh` in der Prozessliste (Task-Manager, `Get-CimInstance
      Win32_Process`); nur lokal beim Nutzer und kurz, aber vermeidbar. Gewählt
      wurde `--body` wegen „kein angehängter Zeilenumbruch“. Vorschlag: `$Pw |
      & gh secret set NOTIZBUCH_KEYSTORE_PASSWORD --repo $Repo` (`gh` entfernt
      abschließende Zeilenumbrüche selbst), in `Invoke-Native` ein optionaler
      `-Stdin`-Parameter. Vorher einmal mit `gh secret set TEST --repo
      <qa-repo>` und `gh api` prüfen, dass kein Zeilenumbruch anhängt; sonst
      Ist-Zustand lassen.
- [ ] **Versionsstring steht in `src/App.jsx` zweimal (🔵).** Kopfzeile
      (`font-mono text-xs text-slate-400`) und `appVersion="v7.60"` am
      `SettingsDialog` (die Diagnose braucht ihn); beim Bump müssen BEIDE
      Literale geändert werden, sonst wird der Versions-Test in
      `tests/androidSpeech.test.js` (ca. Z. 749-758) rot und die Diagnose
      nennt eine falsche Version. Der Test koppelt außerdem an die
      Header-Klassen und scheitert bei geändertem Header-Styling mit
      „Versionsstring in der Kopfzeile nicht gefunden“. Sauberer: `const
      APP_VERSION = "v7.60";` auf Modulebene, Kopfzeile `{APP_VERSION}` und
      `appVersion={APP_VERSION}`, den Test auf `/const APP_VERSION =
      "(v\d+\.\d+(?:\.\d+)?)"/` umstellen und prüfen, dass kein weiteres
      Versions-Literal im Header-JSX steht. DECISIONS #140, Restrisiko (11).
- [ ] **Test (🔵): Interaktion im Einstellungs-Abschnitt „Spracheingabe
      (Android-App)“ nur statisch gerendert.** `tests/androidSpeech.test.js`
      rendert den Abschnitt nur serverseitig (sichtbar nur mit Brücke,
      Standardwerte, kaputter Speicher). Ändern eines Auswahlfelds (schreibt
      `localStorage`), „Diagnose anzeigen“ und „Kopieren“ laufen nur über
      I0 (d)/(e) und am Gerät (I10, I11). Interaktionstests in jsdom bräuchten
      eine neue Testdatei (`@testing-library`-Muster wie in den anderen
      `*.test.jsx`). `src/components/SettingsDialog.jsx`.
- [ ] **CI (🔵): „Release nicht gefunden“ wird am `gh`-Fehlertext erkannt.**
      `android/tools/ci-release-build.sh` unterscheidet beim Laden des
      veröffentlichten APK „nicht gefunden“ (`not found`, `no assets match`,
      `HTTP 404`) von Netz-/API-Fehlern. Weicht der Text einer künftigen
      `gh`-Version ab, scheitert `release` vorsichtshalber (das Release bleibt
      unberührt). Heute existiert das 1.0-Release samt Asset, der Fall tritt
      also nicht auf. Bei einem unerwarteten Rot im Log nach dem
      `gh`-Fehlertext schauen.
- [ ] **Hygiene (🔵): `.gitignore` und README-Wortlaut.** (1) Die
      `.gitignore` enthält für `android/` nur die Signatur-Muster (`*.p12`,
      `*.jks`, `*.keystore`, `keystore.properties`), nicht die
      Build-Ordner-Muster `android/.gradle/` und `android/**/build/` aus dem
      Entwurf; sie wären bei einem lokalen Gradle-Lauf nötig (heute baut nur
      die CI). (2) `android/README.md` nennt UI-Texte („Spracheingabe
      (Android-App)“, „Diagnose anzeigen“, „Speichern & Verbinden“); bei einer
      Umbenennung in `SettingsDialog.jsx` dort nachziehen.
- [ ] **APK: `targetSdk` 35 (Edge-to-Edge) – eigene Runde mit Geräte-Test.**
      `android/app/build.gradle` bleibt bei `targetSdk 34`: Ab 35 erzwingt
      Android Edge-to-Edge, die WebView läge unter Status- und
      Navigationsleiste; ein Layout-Risiko ohne Gerät. `android/app/lint.xml`
      ignoriert `ExpiredTargetSdkVersion`/`OldTargetApi` (kein Play-Store).
      Bei der Umstellung `MainActivity.java` um Fenster-Insets ergänzen und am
      Gerät prüfen; `versionCode` erhöhen. DECISIONS #140.
- [ ] **Diktat: längeres Diktat über segmentierte Sitzungen – nach
      Nutzer-Feedback.** Die Brücke kann es schon (`segmentedMs` in
      `speechStart`, ab Android 13, `buildStartOptions` setzt es bei
      `continuous = true`, bis 300 s), die Web-Seite nutzt es noch nicht (der
      Controller fährt `continuous = false`). Ein „längeres Diktat“ wäre damit
      ein reiner Web-Deploy; erst nach Feedback aus den Geräte-Fällen (I2, I3,
      I12) und vorher den Nutzer fragen. Siehe auch den v7.59-Punkt „längeres
      Diktat über Sprechpausen hinweg“. DECISIONS #139, #140.

## Aus der v7.59-Runde (2026-10-17)

- [ ] **Diktat: längeres Diktat über Sprechpausen hinweg.** Heute endet ein
      Abschnitt nach ca. 0,5–1 s Pause (eine Sitzung pro Antippen,
      `continuous = false`). Optionen: Googles Neustart-Muster (bei jedem
      `end` neu starten, `no-speech`/`no-match` ignorieren, Abbruch nach 5
      erfolglosen Neustarts) oder `continuous` ab Chrome 157 (Stable geplant
      2026-11-03; Android-Fix Commit becd144). Erst nach Nutzer-Feedback aus
      Testfall C40, vorher fragen. DECISIONS #139. In der Android-App (APK
      2.0) kann die Brücke das schon über segmentierte Sitzungen, siehe den
      v7.60-Punkt oben (DECISIONS #140).
- [ ] **Diktat: Großschreibung am Satzanfang und Satzzeichen.** Der Browser
      liefert das Erkannte roh; ob Chrome Android Satzzeichen und
      Großschreibung setzt oder gesprochenes „Komma“ umsetzt, ist unbelegt.
      Erst Testfall C40 auswerten, dann entscheiden, ob `appendDictation`
      (`src/lib/dictation.js`) den ersten Buchstaben nach leerem Feld bzw.
      nach `.`/`!`/`?` großschreiben soll. DECISIONS #139. In der Android-App
      (APK 2.0) gibt es dazu die Geräte-Einstellung „Satzzeichen“ (Testfall
      I12, DECISIONS #140).
- [ ] **Diktat: schneller Neustart direkt nach einem Abschnittsende kann auf
      Android „belegt“ melden.** Android liefert einen belegten Erkenner als
      `not-allowed`; die App zeigt dann den Hinweis „gerade nicht verfügbar“
      (Berechtigung `granted`). Abkühlzeit nach dem Ende oder ein stiller
      Wiederholversuch, falls Testfall C40 das am Gerät zeigt.
      `src/lib/dictation.js`, DECISIONS #139.
- [ ] **Diktat (🔵 Review): Enter auf dem fokussierten Mikro-Knopf sendet
      nicht.** Nach dem Antippen des Mikro-Knopfs liegt der Fokus auf dem
      Knopf (das Feld wird beim Start geblurrt, so verlangt es die
      Spezifikation). Enter löst dann den Knopf aus: das Diktat endet, es
      wird aber NICHT aufgeschoben gesendet; erst ein zweites Enter im Feld
      sendet. Das aufgeschobene Senden per Enter greift nur im fokussierten
      (`readOnly`, aber fokussierbaren) Feld; der Senden-Knopf ist der
      Hauptpfad (Testfall C38 beschreibt das). Optionale Produktentscheidung:
      Enter auf dem Mikro-Knopf in `listening` als aufgeschobenes Senden
      werten (`onKeyDown` am Knopf: `if (e.key === "Enter" && dictState ===
      "listening") { e.preventDefault(); send(); }`). `src/App.jsx`
      (`toggleDictation`, Mikro-Knopf, Enter-Handler der textarea).
- [ ] **Diktat (🔵 Review): fehlender Pin-Test „Änderung VOR dem Endstück“.**
      `dictationStep` koppelt das Diktat NICHT ab, wenn der Nutzer Text VOR
      dem diktierten Endstück tippt oder ändert (das Endstück passt weiter
      und wird ersetzt); nur Änderungen am oder hinter dem Endstück koppeln
      ab. Das Verhalten ist erwünscht, aber nicht festgenagelt – eine
      spätere Umstellung (z. B. auf einen Basis-Schnappschuss) könnte es
      still verlieren. Test ergänzen: `const step1 = dictationStep("Einkauf",
      "", "milch")`; `const edited = "Heute: " + step1`;
      `dictationStep(edited, "milch", "milch und eier")` muss
      `"Heute: Einkauf milch und eier"` ergeben.
      `tests/dictation.test.js`, Block `describe("dictationStep")`.
- [ ] **Diktat (🔵 Review): Hinweistexte nur per Ausschnitt geprüft.**
      `tests/dictation.test.js`, Block `describe("dictationErrorInfo")`
      (ca. Z. 484–513): Die drei `not-allowed`-Varianten und die sieben
      Warn-Codes der `it.each`-Tabelle prüfen den Text nur per `toContain`
      auf einen Ausschnitt. Ein Tippfehler oder ein geändertes
      Anführungszeichen außerhalb des Ausschnitts bliebe unbemerkt (im Review
      manuell gegen den Auftrag verglichen: zeichengenau). Da die
      Hinweistexte Teil der Vereinbarung sind, den vollen Text festnageln:
      `expect(denied).toEqual({ kind: "warn", text: "Das Mikrofon ist für
      diese Seite blockiert. …" })`; in der Tabelle die Spalte `snippet`
      durch den vollständigen Text ersetzen und `toBe` verwenden.
- [ ] **Diktat (🔵 Review): Kommentar zu `dictationStep` begründet mit einer
      Messzahl statt mit dem Grund.** `src/lib/dictation.js` (Kommentar über
      `dictationStep`, „per Brute-Force über ~110.000 Kombinationen
      geprüft“): Der strukturelle Grund trägt besser als die Messzahl.
      `appendDictation(eff, from) === cur` trifft nur, wenn `eff` leer ist
      oder auf Leerraum/öffnende Klammer endet; dann liefert
      `appendDictation(eff, to)` bereits `eff + to`, also dasselbe wie die
      Variante mit abgeschnittenem Trenner `" "`. Kommentar entsprechend
      ersetzen (DECISIONS #139 enthält die Begründung bereits).
- [ ] **Tests (🔵 Review): toter Rest im Post-it-Test.** In
      `tests/quickNotesAutocorrect.test.jsx` (Test „beforeinput-Rücknahme
      meldet an den Handler des LETZTEN Renders …“, ca. Z. 420) ist
      `calls = [];` tot: `SwapHarness` schreibt nie in `calls`, der Test
      prüft `spyA`/`spyB`. Harmlos, suggeriert aber eine Abhängigkeit.
      Streichen oder den manuellen Mount in einen Helfer `mountSwap(notes,
      spyA, spyB)` neben `mount()` ziehen (macht auch den Aufräumpfad über
      `root`/`container` auf einen Blick erkennbar).
- [ ] **Hygiene (🔵 Review): Zeilenenden und Mutanten-Reset.** Mit
      `core.autocrlf=true` ist der Index überall LF, der Arbeitsbaum aber
      uneinheitlich (im Review gemessen: 5 von 94 Dateien unter `src/` und
      `tests/` mit CRLF – `App.jsx`, `DocEditor.jsx`, `index.css`,
      `lib/autocorrect.js`, `lib/math.jsx` –, 88 mit LF, 1 gemischt; auch
      `DECISIONS.md` und `docs/TESTFAELLE.md` sind im Arbeitsbaum CRLF).
      Folgen: `git status` zeigt `src/components/QuickNotes.jsx` weiter als
      ` M`, obwohl der Inhalt dem Index gleicht (Stat-Artefakt); ein
      `git checkout -- <datei>` stellt unter dieser Konfiguration CRLF statt
      LF her. Für Mutanten-Aufträge deshalb: Sicherung vorher per `cp`, Reset
      per `cp`, Nachweis mit `git hash-object <datei>` == `git ls-files -s
      <datei>`. Optional, als eigener Hygiene-Commit: `.gitattributes` mit
      `* text=auto eol=lf` und `git add --renormalize .`. Kein Effekt auf
      Commits (autocrlf normalisiert auf LF).
- [ ] **Flaky Test unter Last.** `tests/quickNotesAutocorrect.test.jsx`, Test
      „Parität zum echten TipTap-Editor … Korpus“ hat ein hartes
      5000-ms-Limit und lief in einem Gesamtlauf bei paralleler Last
      (mehrere Vitest-Läufe gleichzeitig) einmal in den Timeout; der
      Wiederholungslauf war grün. Bei Wiederauftreten das Zeitlimit für
      diesen Test anheben. Auch „Timeout waiting for worker to respond“ trat
      bei parallelen Mutantenläufen auf (Umgebungslast, kein Testergebnis;
      der Start der Vitest-Worker im Standard-Pool `forks` scheiterte
      reproduzierbar, `--pool=threads` lief unter derselben Last in ca. 20–30
      s durch). Für `npm run test:coverage` deshalb keine weiteren
      Vitest-Läufe parallel starten; bei einem Worker-Timeout einmal
      wiederholen statt es als Testfehler zu werten, notfalls
      `npx vitest run --coverage --pool=threads`. `vitest.config.js` braucht
      keine Änderung.

## Aus der v7.58-Runde (2026-09-30)

- [ ] **Editor: Enter direkt nach einem AutoKorrektur-Trigger verschluckt den
      Absatzwechsel (ENTSCHEIDUNG NÖTIG).** „a --“ + Enter, „1/2“ + Enter,
      „\alpha“ + Enter (terminator-/word-/backslash-Trigger) ergeben EINEN
      Absatz mit dem Text „a –\n“ (literales \n im Textknoten, kein neuer
      Absatz). Stand aus dem Review der AutoKorrektur-Aufgabe:
      BESTÄTIGT per Wegwerf-Test gegen den echten TipTap-Editor
      (`handleKeyDown` liefert true, `childCount` 1). Ursache: TipTap ruft
      die InputRules bei Enter mit dem Text „\n“ auf, die
      Abschlusszeichen-Klassen der Regeln (`[^->]$`, `[^0-9]$`, `[^A-Za-z]$`)
      passen darauf. Das Post-it verhält sich richtig („a –“ + Zeilenumbruch).
      Ansatz A: in der AutoCorrect-Extension Enter gesondert behandeln (Regel
      anwenden, das „\n“ aus dem Ersatz entfernen, danach den normalen
      Absatzwechsel auslösen). Ansatz B: Abschlussklassen in `compileEntry`
      um „\n“ erweitern, wenn der Editor bei Enter gar nicht ersetzen soll –
      das änderte auch das Post-it und bräuchte angepasste Enter-Tests.
      `src/components/DocEditor.jsx` (AutoCorrect-Extension,
      ca. Zeile 1794) / `src/lib/autocorrect.js`. Siehe DECISIONS #134.
- [ ] **AutoKorrektur im Chat-Eingabefeld ist nicht angebunden.** Die
      Funktionen in `src/lib/autocorrectInput.js` und `nativeTextEdit.js`
      sind feldunabhängig; das Cursor-Setzen nach einer Ersetzung braucht im
      Chat-`<textarea>` (`src/App.jsx`) einen eigenen Weg (kontrolliertes
      Feld, Selektion nach dem Re-Render nachziehen). Nur auf Nutzerwunsch.
- [ ] **AutoKorrektur im Post-it: Touch-Tastaturen und Firefox/Safari nur
      per Fallback abgesichert.** Der native Pfad (`execCommand`) ist nur in
      Chromium gemessen; Android/Gboard, iOS, Firefox und Safari laufen über
      den Zustands-Fallback bzw. die fail-closed-Positivliste, sind aber
      nicht am Gerät geprüft. Kein Feuern nach `compositionend` (bewusste
      Abweichung vom Editor). E2E-Fall E4/E4b prüft nur Chromium/Desktop.
      Bei Nutzerbefund am Gerät: `beforeinput`-Verhalten (Backspace als
      „Unidentified“) und Wortvorschläge gezielt untersuchen. DECISIONS #134.
- [ ] **AutoKorrektur im Post-it: historyUndo-Kollaps greift auch bei
      fremden Undo-Schritten (🔵, kosmetisch).** Nach einem nativen Strg+Z
      markiert Chromium den zurückgeholten Rohtext (z. B. „->“ selektiert);
      `handleChange` in `src/components/QuickNotes.jsx` kollabiert diese
      Markierung zum Cursor, wenn sie genau eine AutoKorrektur-Trigger-Spanne
      ist (`isAutocorrectTriggerRange`; bei Enter als Abschlusszeichen ggf.
      hinter den folgenden Umbruch), damit das nächste Zeichen den Rohtext
      nicht überschreibt (DECISIONS #134, Entscheidung 7). Die Prüfung ist
      zustandslos (hält so auch Wochen später) und greift deshalb auch bei
      einem FREMDEN Undo-Schritt, der zufällig genau so eine Spanne markiert
      wiederherstellt (z. B. das Undo einer Löschung): Der Nutzer sieht dann
      einen Cursor statt der Markierung, bei der Umbruch-Variante ggf. am
      Anfang der Folgezeile. Bewusst hingenommen; nur bei Nutzerbefund
      angehen. Die Testlücken (1)–(3) desselben Reviews sind in v7.59
      geschlossen (siehe „Erledigt“). `tests/quickNotesAutocorrect.test.jsx`.
- [ ] **Link-Popover: Entscheidungen und Bestand (🔵, Review).** Die
      Testlücken desselben Reviews (Fokus SYNCHRON im Handler; `removeLink`:
      ein Klick öffnet das Popover wieder, wartender Auto-Fetch wird
      verworfen) sind in v7.59 geschlossen (siehe „Erledigt“).
      (1) Nebenwirkung von `unsetMark`: direkt nach dem Einfügen ist
      `editor.isActive("link")` false (Knopf nicht hervorgehoben, erneutes
      Öffnen zeigt „Einfügen“). Optional: `openLinkPicker` behandelt eine
      leere Selektion direkt hinter einem Link als bestehenden Link (z. B.
      über `$from.nodeBefore?.marks`).
      (2) Bestand: Beim Öffnen des Popovers wird kein Feld fokussiert (kein
      `autoFocus`; Enter wirkt erst nach Klick ins Feld), Escape schließt es
      nicht; `fetchTitleForLink` (manueller Knopf) prüft nach dem `await`
      kein Abbruch-Signal; ein Klick in den Editorbereich
      (`onClick={() => picker && setPicker(null)}`) schließt das Popover
      ohne `cancelAutoFetch()`, und `runAutoFetch` ruft `setTitleFetching(false)`
      vor der Abort-Prüfung auf (folgenlos, nicht blockierend);
      `openLinkPicker` nutzt bei bestehendem Link weiter `chain().focus()`.
      (3) Android/Gboard: Enter während einer Wortkomposition (`isComposing`/
      `keyCode` 229) löst im Popover nichts aus (IME-Absicherung; der Knopf
      funktioniert).
      (4) Bekannte Mutanten-Überlebende in `removeLink` (v7.59 gemessen):
      ohne `setLinkForm(null)` und ohne `setTitleFetching(false)` bleiben alle
      48 Tests grün. Beides ist aus der UI nicht beobachtbar, weil
      `openLinkPicker` beide Werte beim nächsten Öffnen neu setzt und das
      Popover über `picker` ausgeblendet wird; bewusst kein erzwungener Test.
      `src/components/DocEditor.jsx`, `tests/docEditorLinkPopover.test.jsx`.
- [ ] **Tool-Markup-Bereinigung: Randfälle (🔵, Review, DECISIONS #136).**
      (1) Ein Rest in Blöcken mit CRLF im `reply`-String bleibt unverändert
      (`FENCE_OPEN_RE` greift bei „\r“ nicht; Modell-Antworten kommen mit LF).
      (2) Der frühe `max_tokens`-Zweig in `callClaude` läuft nicht durch die
      Bereinigung (unkritisch, dort werden nie Ops angewandt).
      `src/lib/anthropic.js`.

## Aus dem E2E-Lauf v7.57.2 / v7.57.3 (2026-09-29/30)

- [ ] **C26 – falsche Modellaussage „zwei Kapitel“.** Dokument war
      korrekt, das Modell behauptete ein Duplikat und stellte deshalb
      beim Aufräumschritt eine unnötige Rückfrage beim Löschen. Reiner Kommentartext, kein
      Datenfehler; beobachten, bei Häufung Prompt-Hinweis erwägen.
- [ ] **G1b – Versionszähler kurz veraltet.** 30 ms nach schnellem
      Notizbuch-Wechsel zeigte der Kopf den alten Zähler desselben
      Notizbuchs (10 statt 11). Einmalig, in 8 Zyklen nicht
      reproduzierbar. Nur bei Wiederauftreten untersuchen.
- [ ] **Schnellnotizen-Altlast im localStorage.** Im QA-Browser enthält
      `notizbuch:quicknotes` zwei verwaiste Schlüssel für Notizbücher,
      die es im verbundenen Repo nicht mehr gibt (eins mit
      Klartext-Post-it). Vermutlich Rest aus Repo-Wechseln
      (E2f-Klasse). Prüfen, ob verwaiste Schlüssel beim Laden der
      Notizbuchliste bereinigt werden sollten. `src/App.jsx`
      (QUICKNOTES_KEY) / `src/lib/quicknotes.js` (parseQuickNotesCache).
- [ ] **Codeblock in Listenpunkt 2. Ebene (4 Leerzeichen).** Wird in der
      Ansicht weiterhin als Text gerendert (CommonMark-Grenze von
      `FENCE_OPEN_RE` in `src/lib/code.jsx`). Beträfe
      `computeFenceLineMask`, `ops.js` und den Editor-Ladepfad. Siehe
      DECISIONS #133.

## Aus dem E2E-Lauf v7.58 (2026-09-30/10-01)

Lauf im QA-Chrome, verbunden mit `notizbuch-data-qa`: 80 bestanden, 0 rot,
0 gelb, 6 blau, 37 übersprungen. Die Punkte unten sind die
produktbezogenen Beobachtungen; Umgebungs-Eigenheiten des QA-Chrome
(verdecktes Fenster, Timing, Eingabe) stehen bewusst NICHT hier, sondern als
„Hinweise QA-Chrome (verdecktes Fenster)“ in `docs/TESTFAELLE.md`.

- [ ] **C2 – Entity „&gt;“ in Modellantworten (kein Datenverlust).**
      Beobachtung: Nach dem Speichern der Zeile „q ->“ über den Editor schrieb
      das Modell in zwei Chat-Antworten „q -&gt;“; die Dokument-Ansicht zeigt
      dieselbe Zeile korrekt als „q ->“. Ursache (durch den Code belegt, kein
      Prüfschritt nötig): Der Text-Node-Serializer von tiptap-markdown
      (`escapeHTML`) schreibt getipptes „>“ IMMER als „&gt;“ ins gespeicherte
      Markdown (Kopfkommentar in `src/lib/markdown.jsx` ab Z. 265,
      gepinnt in `tests/docEditorEntities.test.jsx`). Die Ansicht dekodiert
      per `decodeBasicEntities` (nur in Anzeige-Pfaden: `markdown.jsx`,
      Titel-Anzeige in `App.jsx`), der Prompt-Bau nicht:
      `buildSystemBlocks` in `src/lib/anthropic.js` reicht `nb.doc` roh
      durch – das Modell sieht „&gt;“ und übernimmt es in seine Antwort.
      Repro: im QA-Notizbuch eine Zeile „q ->“ über den Editor speichern
      (damit die AutoKorrektur „->“ nicht zu „→“ macht, vorher die
      Kategorie „Pfeile“ abwählen, siehe E4b; der im Lauf benutzte
      Eingabeweg ist nicht festgehalten; im Repo-Markdown steht dann
      „q -&gt;“), dann im Chat nach dem Inhalt der Zeile fragen.
      Ansatz: beim Prompt-Bau `decodeBasicEntities` auf die Nicht-Code-
      Segmente von `nb.doc` anwenden – Fenced-Blöcke per `splitFenceSegments`
      (`src/lib/code.jsx`) aussparen, Codespans wie im Inline-Pfad von
      `markdown.jsx` (ca. Z. 720–728: erst Token erkennen, nur den Rest
      dekodieren); ggf. eine segmentweise Dekodierfunktion aus `markdown.jsx`
      exportieren. Verworfen: „beim Speichern zurückwandeln“ – bricht die
      v7.24-Entscheidung (Entities bleiben bewusst im Speicherformat, Schutz
      davor, dass ein rohes „<“/„>“ beim nächsten Laden mit `html: true` als
      HTML gelesen wird; die Byte-Stabilität über Lade-/Speicherzyklen ist
      in `tests/docEditorEntities.test.jsx` gepinnt). Vorsicht beim
      Dekodieren im Prompt: Ops adressieren Einträge per Text
      (`findEntryLines` in `src/lib/ops.js` vergleicht `op.entry` mit dem
      GESPEICHERTEN Zeilentext); zitiert das Modell eine Zeile dekodiert
      („q ->“), träfe der Match gegen „q -&gt;“ nicht mehr – die Match-Seite
      müsste dann symmetrisch dekodiert werden (vor Umsetzung klären).
      Dateien: `src/lib/anthropic.js`, ggf. `src/lib/markdown.jsx` (Export
      einer segmentweisen Dekodierfunktion), `src/lib/ops.js` (Match).
- [ ] **Notizbuch anlegen – irreführende Fehlermeldung „SHA-Konflikt“.**
      Beobachtung: „Anlegen“ (Name „QA-Test Zweitbuch“) hing ca. 90 s in
      „Lege an …“, die Datei war aber bereits committet; zwei Wiederholungen
      endeten mit „SHA-Konflikt: Datei wurde zwischenzeitlich geändert“. Nach
      einem Reload stand das Notizbuch im Dropdown. Ursache der Meldung:
      `ghPutFile` ohne `sha` auf einen bereits existierenden Pfad liefert
      422 (Fehlertext mit „sha“) bzw. 409, und beides wird in
      `src/lib/github.js` als `ShaConflictError` gedeutet. Das hängende erste
      „Anlegen“ war wahrscheinlich Umgebung (hängende Antwort im verdeckten
      Tab), die Meldung bleibt für den Nutzer trotzdem falsch. Ansatz: bei 422/409
      auf dem „Anlegen“-Pfad „Notizbuch existiert bereits“ melden, oder vor
      dem Anlegen den Pfad per `ghGetFile` prüfen. Repro: der Hänger selbst
      ist nicht gezielt nachgestellt; die falsche Meldung ist aus dem Code
      ableitbar (nicht getestet): im Daten-Repo liegt `notizbuecher/<id>.md`
      schon, die App führt das Notizbuch aber nicht in ihrer Liste (z. B.
      Datei direkt im Repo angelegt oder Liste vor dem Neuladen veraltet),
      dann „Anlegen“ mit dem zugehörigen Namen. Dateien: `src/lib/github.js`
      (`ghPutFile`, 422/409-Zweig), `src/App.jsx` (Notizbuch anlegen,
      `ghPutFile` mit Slug-ID `notizbuecher/<id>.md`).
- [ ] **F2 – doppelte, fast identische Absätze in einer Chat-Antwort.**
      Datei-Anhang `.txt` mit „QA-Dateitest Gamma“, Frage „Was steht in der
      Datei?“: die Antwort enthielt zwei fast gleichlautende Absätze.
      Modellqualität, keine Datenwirkung; beobachten, bei Häufung
      Prompt-Hinweis erwägen.
- [ ] **C15 – falsche Modellaussage „Kapitel existiert schon im anderen
      Notizbuch“.** Das Modell behauptete, „QA-Kapitel-Test Theta“ gebe es
      bereits in einem anderen Notizbuch; das stimmte nicht, der Eintrag
      landete trotzdem korrekt im Ziel-Notizbuch. Halluzination ohne
      Wirkung; beobachten (gleiche Klasse wie C26 oben: falscher
      Kommentartext ohne Datenfolge).
- [ ] **G1d – Randverweis auf die frühere Löschung.** Die Antwort nannte das
      wiederhergestellte Kapitel korrekt und erwähnte zusätzlich dessen
      frühere Löschung; die Pille erschien sofort. Nur ein überflüssiger
      Randverweis, Fall bestanden; beobachten.

## Aus früheren DECISIONS-Einträgen (bewusst vertagt)

- [ ] **`raw`-Fallback in `buildFeedbackFacts()`** (DECISIONS #131). Der
      `d.l`-Zweig gilt als praktisch unerreichbar; Änderung wäre eine
      Verhaltensänderung, daher offen gelassen. `src/lib/feedback.js`.
- [ ] **Codeblock per Toolbar-Knopf innerhalb eines Listenpunkts**
      (DECISIONS #99, Testfall D6b-Hinweis). TipTaps ListItem verlangt
      einen Absatz als erstes Kind; der Knopf hebt den Block aus der
      Liste. Schema-Änderung bräuchte eine breite Testrunde gegen alle
      Listen-Interaktionen im Editor.

## Erledigt

- [x] **Wirkungslose Zusicherung im Diagnose-Test (`tests/androidSpeech.test.js`)** → v7.60-Nachbesserung: durch vier echte Zusicherungen ersetzt (u. a. `getItem` wird nie aufgerufen).
- [x] **🟡 Review-Entscheidung: `fin`-Flag in der Einzel-Sitzung** (Orchestrator,
      2026-10-17) → v7.60, DECISIONS #140, Restrisiko (4): das undokumentierte
      Google-Flag `final_result` zählt in `androidSpeech.js` nur noch bei
      `continuous === true` als Final; bei `continuous = false` (so fährt der
      Controller immer) ist ein `fin`-Partial ein normaler Zwischenstand, das
      Endergebnis kommt per `results` (kein Doppel „Einkauf hallo welt Hallo
      Welt.“). Tests in `tests/androidSpeech.test.js`, jeder per Mutant
      nachgewiesen.
- [x] **CI (🔵): Alias „notizbuch“ als Klartext statt als Secret** (Orchestrator,
      2026-10-17) → v7.60 / APK 2.0, DECISIONS #140: `NOTIZBUCH_KEY_ALIAS` ist
      eine Konstante in `.github/workflows/android.yml`; das Schlüsselskript
      setzt nur noch `NOTIZBUCH_KEYSTORE_BASE64` und
      `NOTIZBUCH_KEYSTORE_PASSWORD`; `ci-release-build.sh` prüft nur diese
      zwei (Alias-Standard „notizbuch“). GitHub maskiert „notizbuch“ im Log
      nicht mehr.
- [x] **Diktat: die Android-WebView-App (APK) hatte keinen Mikrofon-Knopf**
      → v7.60 / APK 2.0, DECISIONS #140: native Sprach-Brücke
      (`SpeechBridge.java`), WebView-Erkenner als Rückfall, fester
      Signierschlüssel (ersetzt die Signatur-Regel aus #30). Der Geräte-Test
      durch den Nutzer (I1–I14) steht noch aus, siehe „Aus der v7.60-Runde“.
- [x] **Nachzüge aus den v7.59-Reviews (🔵)** → v7.60, DECISIONS #140:
      (1) das aufgeschobene Senden löscht einen eben eingetroffenen
      Diktat-Hinweis nicht mehr (`keepDictHintRef` in `src/App.jsx`, E2E-Fall
      C37b); (2) `role="status"` an der Hinweiszeile entfernt (der
      `aria-live`-Wrapper bleibt, keine verschachtelten Live-Regionen);
      (3) `tests/docEditorLinkPopover.test.jsx` mit `vi.setConfig({
      testTimeout: 20000 })` gegen den 5000-ms-Timeout unter Coverage-Last.
- [x] **Mikrofon-Knopf am Chat-Eingabefeld (Spracheingabe über die Web
      Speech API, Nutzerwunsch)** → v7.59, DECISIONS #139.
- [x] **Testlücken AutoKorrektur im Post-it, Teile (1)–(3)** (Handler des
      LETZTEN Renders in `tryRevertRef`; Merker-Verfall durch fremde
      input-Events und Verbrauch in `tryRevert`; äußere `onChange` nach
      nativer Ersetzung/nativem Undo über stumme Stubs) → v7.59, nur Tests
      (`tests/quickNotesAutocorrect.test.jsx`, 91 → 98 Tests, jeder neue
      Test per Mutant nachgewiesen). Teil (4) bleibt offen (siehe oben).
- [x] **Link-Popover: Testlücken, Teile (1)–(2)** (Fokus SYNCHRON im Handler
      im Editor; `removeLink`: ein Klick öffnet das Popover wieder, ein
      wartender Auto-Fetch wird verworfen) → v7.59, nur Tests
      (`tests/docEditorLinkPopover.test.jsx`, 40 → 48 Tests, jeder neue Test
      per Mutant nachgewiesen). Die Teile (3)–(5) bleiben offen (siehe oben).
- [x] **AutoKorrektur in Schnellnotizen** (Nutzerbefund: im Post-it blieb
      „->“ roh) → v7.58, DECISIONS #134.
- [x] **Fokus nach Link-Einfügen; Enter im Link-Popover = Einfügen**
      (D7/D7b-Beobachtung) → v7.58, DECISIONS #135.
- [x] **C28 – Tool-Markup im Chattext** (Reste `</parameter>`/
      `<parameter name="ops">[]` am Blasenende) → v7.58, DECISIONS #136.
- [x] **Chat-Pfad strippt Zaun-Einrückung nicht** → v7.58, DECISIONS #137.
- [x] **MAX_FACTS-Deckel ohne Hinweis im Prompt** → v7.58, DECISIONS #138.
- [x] **Cursor-Kollaps nach „Entfernen“ im Link-Popover (Entscheidung des
      Orchestrators: beibehalten)** → v7.58, DECISIONS #135.
- [x] **Tool-Markup-Bereinigung: Teilkürzung präzisiert und per Pin-Test
      festgeschrieben, Tag-Rumpf auf echte Attribut-Syntax beschränkt** →
      v7.58, DECISIONS #136.
- [x] **MAX_FACTS-Hinweis: Wortlaut („keine Vorkommen ermittelt“) und
      Testtitel präzisiert** → v7.58, DECISIONS #138.
- [x] **Kosmetik: falsche DECISIONS-Verweise in Code-Kommentaren und
      Testtiteln angeglichen** (#136 Tool-Markup, #137 Zaun-Einrückung,
      #138 MAX_FACTS) → v7.58.
- [x] **D6b – eingerückter Codeblock in der Ansicht** → v7.57.3,
      DECISIONS #133.
- [x] **Chat-Eingabefeld sitzt zu weit oben** → v7.57.2, DECISIONS #132.
