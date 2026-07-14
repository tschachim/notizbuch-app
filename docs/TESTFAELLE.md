# End-to-End-Testfälle (User-Story-Tests)

Diese Testfälle prüft der Tester-Agent nach jedem Deploy gegen die
**live deployte App** (https://tschachim.github.io/notizbuch-app/) per
Browser-Bedienung. Regeln für den Tester stehen in seiner Agent-Definition;
die wichtigsten: **niemals Zugangsdaten eingeben**, im Konservativ-Modus
(siehe „Datentopf“ unten) **nur Notizbücher mit Präfix „QA-Test“
anlegen/ändern/löschen** und echte Nutzerdaten nur lesend ansehen,
am Ende aufräumen.

Markierungen:
- **[OFFEN]** – ohne Verbindung testbar (kein PAT/API-Key nötig).
- **[VERBUNDEN]** – braucht eine bestehende Verbindung zum Daten-Repo
  (Zugangsdaten müssen vom Nutzer bereits im Browser hinterlegt sein;
  sonst Testfall als ÜBERSPRUNGEN melden).
- **[API]** – löst zusätzlich bezahlte Modell-Aufrufe aus (sparsam nutzen:
  pro Lauf höchstens die angegebenen Prompts).

Datentopf: Der Tester stellt vor dem ersten schreibenden Fall fest,
welches Daten-Repo verbunden ist (Einstellungs-Dialog, nur Repo-Name
lesen). Endet der Name auf „-qa“ (dediziertes QA-Repo, z. B.
notizbuch-data-qa), gilt der **QA-Modus**: alle Inhalte dort sind
Testdaten, Chat und Notizbücher dürfen frei genutzt werden (das
„QA-Test“-Präfix bleibt trotzdem Pflicht, damit das Aufräumen greift),
und C7 darf den Archivieren-Pfad vollständig ausführen. In jedem
anderen Fall – auch wenn der Repo-Name nicht zweifelsfrei gelesen
werden kann – gilt der **Konservativ-Modus** (echte Nutzerdaten):
alle Einschränkungen unten strikt einhalten.

---

## A. Grundgerüst & Erststart

**A1 [OFFEN] Erststart-Zustand.** App laden. Erwartet: Header mit Logo,
Versionsnummer (v-Format), Modell-Dropdown, Historie- und
Einstellungs-Knopf; Einstellungs-Dialog offen oder Hinweisbanner
„Nicht verbunden“; Chat zeigt die Willkommensnachricht; keine
Konsolen-Fehler beim Laden.

**A2 [OFFEN] Einstellungs-Dialog.** Dialog öffnen (Zahnrad). Erwartet:
Felder für GitHub-Owner, Repo, PAT, Anthropic-API-Key; Verbinden-Knopf;
Dialog lässt sich schließen, ohne dass etwas kaputtgeht. KEINE Werte
eintragen.

**A3 [OFFEN] Responsive-Umschaltung.** Fenster schmal machen (< 768 px).
Erwartet: Umschalter Chat/Wissensbasis erscheint; Abschnitts-Leiste rechts
verschwindet; im Dokument-Modus öffnet der Gliederungs-Knopf den Drawer
von rechts; Abschnitts-Tipp springt und schließt den Drawer; kein
horizontales Scrollen der Seite.

## B. Notizbuch-Verwaltung

**B1 [VERBUNDEN] Notizbuch anlegen.** Dropdown → „⚙ Notizbücher
verwalten …“ → Name „QA-Test Automatisch“ anlegen. Erwartet: erscheint in
Liste und Dropdown, wird aktiv, Dokument zeigt „# QA-Test Automatisch“
mit Inbox-Abschnitt.

**B2 [VERBUNDEN] Umbenennen.** „QA-Test Automatisch“ im Admin-Dialog in
„QA-Test Umbenannt“ umbenennen. Erwartet: Name überall aktualisiert
(Dropdown, Dokumentkopf, H1); Inhalt unverändert.

**B3 [VERBUNDEN] Reihenfolge.** Das QA-Notizbuch mit den Pfeilen nach oben
schieben und Seite neu laden. Erwartet: Reihenfolge bleibt erhalten.

**B4 [VERBUNDEN] Icon.** Dem QA-Notizbuch ein Icon hochladen (beliebiges
kleines Bild, z. B. per Screenshot-Datei). Erwartet: Icon erscheint in der
Admin-Zeile und links oben im Header, solange das QA-Notizbuch aktiv ist;
„Icon entfernen“ stellt das Standard-Logo wieder her.

**B5 [VERBUNDEN] Löschen.** „QA-Test Umbenannt“ löschen (Bestätigung).
Erwartet: verschwindet aus Liste/Dropdown; aktives Notizbuch wechselt;
das letzte verbleibende Notizbuch ist nicht löschbar (Knopf gesperrt).

## C. Chat & Dokument

**C1 [VERBUNDEN][API] Notiz eintragen.** Im QA-Notizbuch per Chat:
„Notiere: QA-Testeintrag Alpha am 2026-01-01“. Erwartet:
Bestätigungsantwort im Chat, Commit-Zeile unter der Antwort, Eintrag
erscheint rechts im Dokument (Datum im Format JJJJ-MM-TT).

**C2 [VERBUNDEN][API] Frage ohne Speicherung.** „Was steht in diesem
Notizbuch?“ Erwartet: Antwort fasst Inhalt zusammen, KEIN neuer Commit,
Dokument unverändert.

**C3 [VERBUNDEN][API] Recherche mit Quellen.** „Wie hoch ist der
Eiffelturm? Recherchiere und trage es hier ein.“ Erwartet: Antwort mit
kleinen hochgestellten Fußnoten-Zahlen an den Aussagen (oder mindestens
Quellenliste unter der Antwort); im Dokument ein Eintrag mit
klickbarer Fußnoten-Zahl, die auf eine http(s)-Quelle verlinkt.

**C4 [OFFEN] Chat-Verlauf.** Nach C1–C3: Nachrichten haben Zeitstempel;
Fußnoten-Links öffnen in neuem Tab (target=_blank).

**C5 [VERBUNDEN][API] Cross-Notizbuch-Routing.** Zweites Notizbuch
„QA-Test Zweitbuch“ anlegen, dorthin wechseln, dann eintragen:
„Notiere: QA-Routing Delta – das gehört ins Notizbuch QA-Test
Umbenannt“. Erwartet: Eintrag landet im ANDEREN QA-Notizbuch, die
Antwort erwähnt die Einordnung, die Ansicht springt ggf. dorthin.

**C6 [VERBUNDEN][API] Umstrukturieren per Chat.** Im QA-Notizbuch:
„Räume dieses Notizbuch auf: fasse alle QA-Einträge unter einem
Abschnitt ‚QA-Ergebnisse‘ zusammen.“ Erwartet: Abschnitt existiert
danach, KEINE Einträge verloren (alle QA-Texte von vorher noch
auffindbar), Commit vorhanden.

**C7 [VERBUNDEN] Chat-Archivierung.** Archiv-Knopf (Kartonsymbol links
neben dem Anhang-Knopf) anklicken. Erwartet: Bestätigungsleiste
„Gesamten Chat als Markdown im Daten-Repo (chats/) ablegen und hier
leeren?“ mit „Archivieren“ und „Abbrechen“ erscheint über der
Eingabezeile. Dann „Abbrechen“ klicken: Leiste verschwindet,
Chat-Verlauf unverändert, kein Commit im Daten-Repo.
NUR wenn der verbundene Repo-Name auf „-qa“ endet (unmittelbar vorher
im Einstellungs-Dialog verifiziert!) zusätzlich der Erfolgs-Pfad:
Leiste erneut öffnen, „Archivieren“ klicken. Erwartet: Erfolgs-Banner
„Chat archiviert: N Nachrichten → chats/chat-….md“, Chat zeigt danach
nur noch die Begrüßung, Archiv-Knopf ist deaktiviert. Dann kurz warten,
bis das Leeren synchronisiert ist (das Speichern von state.json läuft
debounced, ca. 3–5 s; Status „Gespeichert“ abwarten), erst danach neu
laden – der Chat bleibt leer (kein Wiederauftauchen).
⚠️ IM KONSERVATIV-MODUS (echtes Daten-Repo): „Archivieren“ NIEMALS
anklicken – es leert den globalen Chat des Nutzers auf allen Geräten;
dann nur den Abbrechen-Pfad testen.

## D. Manuelles Bearbeiten (WYSIWYG)

**D1 [VERBUNDEN] Editor-Roundtrip.** Stift-Knopf → im QA-Notizbuch einen
Stichpunkt „QA-Edit Beta“ ergänzen, fett markieren, speichern. Erwartet:
Ansicht zeigt den fetten Eintrag; keine anderen Inhalte verändert;
neue Version in der Historie.

**D2 [VERBUNDEN] Tabelle.** Im Editor per Tabellen-Knopf eine 2×3-Tabelle
aufziehen, Kopf und eine Zelle füllen, speichern. Erwartet: gerenderte
Tabelle mit Kopfzeile; erneutes Öffnen des Editors zeigt die Tabelle
unverändert (Roundtrip).

**D3 [VERBUNDEN] Checkliste.** Im Editor eine Checkliste mit zwei
Einträgen anlegen, speichern, dann in der ANSICHT ein Kästchen anklicken.
Erwartet: Haken bleibt nach Reload erhalten (eigener Commit).

**D4 [OFFEN] Abbrechen ist folgenlos.** Editor öffnen, Text ändern,
Abbrechen. Erwartet: Ansicht unverändert, kein Commit.

## E. Schnellnotizen

**E1 [OFFEN] Post-it-Lebenszyklus.** „Schnellnotiz“-Knopf (Desktop:
Leiste rechts; mobil: im Drawer). Erwartet: gelbes Post-it erscheint,
Text eintippbar, verschieb-/größenveränderbar; X verwirft; OK übernimmt
den Text als „Neue Schnellnotiz:“ + Zeilenumbruch + Text ins Eingabefeld
(so spezifiziert) und löscht das Post-it (nicht automatisch gesendet).

**E2 [VERBUNDEN] Sync.** Schnellnotiz „QA-Sync-Test“ anlegen, Seite neu
laden. Erwartet: Post-it ist nach dem Reload wieder da (kommt aus dem
Daten-Repo). Danach Post-it wieder löschen.

## F. Anhänge & Wissen

**F1 [VERBUNDEN][API] Bild anhängen.** Kleines Bild anhängen + „Lege das
im QA-Notizbuch ab“. Erwartet: Bild erscheint im Dokument mit KURZER
kursiver Bildunterschrift (kein langer Beschreibungstext).

**F2 [VERBUNDEN][API] Textdatei anhängen.** Eine .txt-Datei mit Inhalt
„QA-Dateitest Gamma“ anhängen + „Was steht in der Datei?“. Erwartet:
Antwort nennt den Inhalt; Datei-Chip in der Nutzernachricht; KEIN
Datei-Eintrag im Dokument.

**F3 [VERBUNDEN] Hintergrundwissen.** Büroklammer im Dokumentkopf →
.txt-Datei hochladen. Erwartet: erscheint in der Liste mit Zähler-Badge;
Löschen entfernt sie wieder.

**F4 [VERBUNDEN][API] Wissen wird genutzt.** Vor dem Löschen aus F3:
Die .txt enthält einen erfundenen Fakt („Der QA-Kennwert Epsilon beträgt
7,3“). Frage im Chat: „Wie hoch ist der QA-Kennwert Epsilon?“ Erwartet:
Antwort nennt 7,3 (kommt nur aus der Wissensdatei).

**F5 [VERBUNDEN][API] Große Wissensdatei per Abruf.** Eine .txt mit
> 80.000 Zeichen hochladen (per JS generierbar: viele „## Seite N“-Blöcke,
ein erfundener Fakt auf „Seite 42“: „Der QA-Tiefenwert Zeta beträgt 9,81“).
Frage: „Wie hoch ist der QA-Tiefenwert Zeta laut der großen Datei?“
Erwartet: Antwort nennt 9,81 – das Modell muss ihn per lookup_wissen
geholt haben (die Datei steht nur als Index-Eintrag im Prompt). Datei
danach löschen.

## G. Historie & Export

**G1 [VERBUNDEN] Historie ansehen.** Historie-Knopf. Erwartet: Liste
echter Versionen mit Zeitstempel/Commit-Text, jüngste als „aktuell“
markiert. NICHT wiederherstellen (verändert Nutzerdaten), außer es
betrifft ausschließlich das QA-Notizbuch.

**G2 [OFFEN] Markdown kopieren/exportieren.** Kopier- und Download-Knopf
im Dokumentkopf. Erwartet: kein Fehler; Download liefert eine .md-Datei.

## H. Robustheit

**H1 [OFFEN] Modellwahl.** Modell-Dropdown umschalten. Erwartet: Auswahl
bleibt nach Reload erhalten (verbunden) bzw. mindestens ohne Fehler
(offen).

**H2 [OFFEN] Keine Konsolen-Fehler.** Während des gesamten Laufs:
Browser-Konsole am Ende auf Fehler prüfen und diese als Findings melden.

---

## Aufräumen (Pflicht am Ende jedes Laufs)

1. Alle im Lauf angelegten Notizbücher löschen (inkl. Icon/Wissen) –
   sie tragen in beiden Modi das Präfix „QA-Test“.
2. Angelegte Schnellnotizen löschen.
3. Offene Dialoge/Editor schließen.
4. Konservativ-Modus: Der QA-Chatverlauf (C1–C3, F1–F2) bleibt stehen –
   er ist die Nachvollziehbarkeit des Laufs; im Abschlussbericht
   erwähnen. QA-Modus: Den Test-Chat am Ende per Archiv-Knopf
   archivieren (räumt auf UND testet den Erfolgs-Pfad erneut).
