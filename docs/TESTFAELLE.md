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

**B6 [VERBUNDEN] Icons im Notizbuch-Dropdown.** Notizbuch-Dropdown links
oben öffnen (mind. zwei Notizbücher vorhanden). Erwartet: die
aufklappende Liste zeigt vor jedem Namen ein kleines Icon (eigenes
Icon, z. B. aus B4, sofern eines gesetzt ist – sonst das Standard-Logo);
das aktive Notizbuch ist optisch markiert (Haken/Fettschrift); die
Einträge „＋ Neues Notizbuch …“ und „⚙ Notizbücher verwalten …“ öffnen
weiterhin den jeweils passenden Dialog; Escape und Klick außerhalb
schließen die Liste ohne Auswahl.

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

**C4 [OFFEN] Chat-Verlauf.** Nach C1–C3: JEDE Chat-Nachricht (Nutzer und
Assistent) zeigt einen dezenten Zeitstempel (klein, grau) unter der
Bubble – rechtsbündig bei Nutzer-, linksbündig bei Assistenten-Nachrichten.
Ausnahme: die Begrüßung ganz oben (kein Zeitstempel), zentrierte
Info-Pillen (z. B. „… manuell bearbeitet“) und Antworten MIT
Dokument-Commit-Badge (die Zeit steht dort schon in der Badge „HH:MM ·
…“, keine doppelte Zeile). Fußnoten-Links öffnen in neuem Tab
(target=_blank).

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

**C8 [OFFEN] Eingabefeld vergrößern.** Kleinen Vergrößern-Knopf (oben
rechts im Eingabefeld) anklicken. Erwartet: Eingabefeld wird sichtbar
größer (mehrzeilig, bei sehr langem Text scrollbar statt den Bildschirm
zu sprengen), der Knopf wechselt auf ein Verkleinern-Symbol; erneuter
Klick stellt die kompakte Größe wieder her. Umschalt+Enter fügt in
beiden Größen weiterhin einen Zeilenumbruch ein; Enter (ohne Umschalt)
löst weiterhin denselben Sende-Versuch aus wie vorher (ohne Verbindung
öffnet es die Einstellungen statt zu senden).

**C9a [VERBUNDEN][API] Formel im Chat (reine Frage, kein Speicherauftrag).** Im
QA-Notizbuch per Chat: „Erkläre kurz den Satz des Pythagoras mit Formel –
nur erklären, nichts speichern.“ (genau 1 API-Aufruf). Erwartet: Die
Chat-Antwort zeigt eine ECHT gerenderte KaTeX-Formel (`.katex`-Elemente,
mathematische Symbole/Hochstellung, keine rohen `$`-Zeichen im Text);
KEIN Dokument-Commit (Regel „keine Nebenbei-Ops bei reinen Fragen“,
siehe DECISIONS.md Punkt 41).

**C9b [VERBUNDEN][API] Formel im Dokument (Speicherauftrag).** Im
QA-Notizbuch per Chat: „Notiere den Satz des Pythagoras mit gerenderter
Formel.“ (genau 1 API-Aufruf). Erwartet: Im Dokument erscheint der
Eintrag mit gerenderter Formel statt Roh-Markdown (`$a^2+b^2=c^2$` o. ä.
darf nirgends als Klartext sichtbar sein); die Chat-Antwort darf hier
NUR knapp bestätigen (keine ausformulierte Erklärung/Formel im Chat
erwarten – das ist die gewollte Bestätigungs-Regel aus v7.1, kein Bug).
⚠️ Währungs-Sicherheit: Enthält ein anderer Eintrag im selben Notizbuch
Beträge wie „$50“ oder „-38.000 vs. -50.000“, dürfen diese NICHT als
Formel interpretiert werden (weiterhin normaler Text mit sichtbarem
Dollarzeichen) – bei Auffälligkeiten hier explizit als Finding melden.

## D. Manuelles Bearbeiten (WYSIWYG)

**D1 [VERBUNDEN] Editor-Roundtrip.** Stift-Knopf → im QA-Notizbuch einen
Stichpunkt „QA-Edit Beta“ ergänzen, fett markieren, speichern. Erwartet:
Ansicht zeigt den fetten Eintrag; keine anderen Inhalte verändert;
neue Version in der Historie.

**D2 [VERBUNDEN] Tabelle.** Im Editor per Tabellen-Knopf eine 2×3-Tabelle
aufziehen, Kopf und eine Zelle füllen, speichern. Erwartet: gerenderte
Tabelle mit Kopfzeile; erneutes Öffnen des Editors zeigt die Tabelle
unverändert (Roundtrip). ⚠️ Bekannte, bewusst akzeptierte Grenze (KEIN
Bug, bitte nicht melden): Wird die Tabelle exakt am Zeilenende eines
Listenpunkts eingefügt, landet sie im Editor-DOM innerhalb des `<li>`
statt danach – die Ansicht rendert trotzdem korrekt und der Roundtrip
bleibt byte-stabil, siehe DECISIONS.md.

**D3 [VERBUNDEN] Checkliste.** Im Editor eine Checkliste mit zwei
Einträgen anlegen, speichern, dann in der ANSICHT ein Kästchen anklicken.
Erwartet: Haken bleibt nach Reload erhalten (eigener Commit).

**D4 [OFFEN] Abbrechen ist folgenlos.** Editor öffnen, Text ändern,
Abbrechen. Erwartet: Ansicht unverändert, kein Commit.

**D5 [VERBUNDEN] Formel-Roundtrip im Editor.** Voraussetzung: Ein
Dokument mit mindestens einer Inline-Formel (z. B. `$a^2+b^2=c^2$`) und
einer abgesetzten Formel (z. B. `$$E=mc^2$$` auf eigener Zeile) – bei
Bedarf vorher per Chat anlegen (siehe C9b) oder direkt über die
Toolbar-Knöpfe „Σ“ (Inline) bzw. „Formel abgesetzt“ im Editor selbst
einfügen. Editor öffnen. Erwartet: Beide Formeln erscheinen gerendert
(nicht als Roh-`$…$`-Text). OHNE etwas zu ändern speichern: Erwartet
KEIN Commit und keine neue Version in der Historie (No-op). Dann eine
der Formeln anklicken: Ein Eingabefeld mit dem TeX-Quelltext öffnet
sich; Text ändern und mit Enter bestätigen. Erwartet: Formel zeigt
danach den geänderten Inhalt gerendert. Speichern. Erwartet: neue
Version in der Historie, Ansicht zeigt die geänderte Formel korrekt
gerendert, alle anderen Inhalte unverändert.

⚠️ Bekannte, bewusste Anzeige-Divergenzen zwischen Editor und
Dokument-Ansicht (KEIN Bug, bitte nicht melden – Roundtrip bleibt in
beiden Fällen byte-identisch, nur die Live-Anzeige weicht ab):
(a) Ein einzeiliges `$$…$$`-Paar MITTEN in einer Zeile (nicht am
Zeilenanfang, z. B. „Vorher $$x^2$$ nachher“) bleibt im Editor als
Rohtext sichtbar, während die Ansicht es als eingebettete Formel
rendert. (b) Eine Zeile mit einem Codespan gefolgt von einem
`$$…$$`-Paar auf derselben Zeile (z. B. `` `x` $$y$$ ``) bleibt im
Editor ebenfalls komplett als Rohtext stehen, während die Ansicht
Codespan und Formel nebeneinander rendert. Ein einfaches `$…$`-Paar
nach einem Codespan (z. B. `` `code` und $x$ hier. ``) funktioniert
dagegen in BEIDEN Ansichten normal.

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
kursiver Bildunterschrift (kein langer Beschreibungstext); darüber steht
NUR diese eine kursive Zeile – kein zusätzlicher fett gedruckter Titel
direkt unter dem Bild (der Bildtitel steckt nur noch im alt-Attribut/
Tooltip des Bildes).

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
