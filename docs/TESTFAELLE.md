# End-to-End-Testfälle (User-Story-Tests)

Diese Testfälle prüft der Tester-Agent nach jedem Deploy gegen die
**live deployte App** (https://tschachim.github.io/notizbuch-app/) per
Browser-Bedienung. Regeln für den Tester stehen in seiner Agent-Definition;
die wichtigsten: **niemals Zugangsdaten eingeben**, **nur Notizbücher mit
Präfix „QA-Test“ anlegen/ändern/löschen**, echte Nutzerdaten nur lesend
ansehen, am Ende aufräumen.

Markierungen:
- **[OFFEN]** – ohne Verbindung testbar (kein PAT/API-Key nötig).
- **[VERBUNDEN]** – braucht eine bestehende Verbindung zum Daten-Repo
  (Zugangsdaten müssen vom Nutzer bereits im Browser hinterlegt sein;
  sonst Testfall als ÜBERSPRUNGEN melden).
- **[API]** – löst zusätzlich bezahlte Modell-Aufrufe aus (sparsam nutzen:
  pro Lauf höchstens die angegebenen Prompts).

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
den Text als „Neue Schnellnotiz: …“ ins Eingabefeld und löscht das
Post-it (nicht automatisch gesendet).

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

1. Alle angelegten „QA-Test …“-Notizbücher löschen (inkl. Icon/Wissen).
2. Angelegte Schnellnotizen löschen.
3. Offene Dialoge/Editor schließen.
4. Der QA-Chatverlauf (C1–C3, F1–F2) bleibt stehen – er ist die
   Nachvollziehbarkeit des Laufs; im Abschlussbericht erwähnen.
