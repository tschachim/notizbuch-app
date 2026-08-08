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
- **[MANUELL]** – NICHT durch den Tester-Agenten ausführbar (braucht einen
  echten, vom Nutzer lokal auf seinem Windows-Rechner installierten
  Bestandteil außerhalb der Browser-Sandbox, z. B. einen registrierten
  URL-Protokoll-Handler, und/oder einen browsereigenen Erlaubnis-Prompt,
  der sich nicht per Browser-Fernsteuerung bestätigen lässt). Wird vom
  Tester immer als ÜBERSPRUNGEN gemeldet, nie als Fehlschlag – Verifikation
  bleibt dem Nutzer selbst überlassen.

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

**A2b [OFFEN] URL-Vorbelegung Owner/Repo (v7.30).** NUR relevant, solange
die App noch UNVERBUNDEN ist (kein bestehendes `localStorage` – bei Bedarf
vorher in den Entwicklertools `localStorage.clear()` oder ein privates
Fenster nutzen). App-URL mit angehängtem `?owner=<Test-Owner>&repo=<Test-Repo>`
öffnen (beliebige Platzhalter-Werte reichen, es wird nichts wirklich
verbunden). Erwartet: Der Einstellungs-Dialog öffnet sich automatisch
(wie bei A1) UND die Felder „GitHub-Owner“/„Repo“ sind bereits mit den
Werten aus der URL vorausgefüllt; die Felder „PAT“ und „Anthropic-API-Key“
bleiben LEER. Die Felder lassen sich normal überschreiben. KEINE Werte
eintragen/verbinden – Dialog wieder schließen. Negativ-Probe: dieselbe URL
zusätzlich mit einem offensichtlich sensiblen Parameter öffnen, z. B.
`&pat=irgendwas` – Erwartet: In der Browser-Konsole erscheint eine Warnung
„Zugangsdaten gehören nie in URLs …“, das PAT-Feld im Dialog bleibt LEER
(der Parameter wird nie gelesen), und die Adresszeile zeigt den
`pat`-Parameter nach dem Laden nicht mehr an.

**A2c [OFFEN] Formular-Semantik für Passwortmanager (v7.43).** Prüft NUR,
dass die Zugangsdaten-Felder für einen Passwortmanager erkennbar sind –
**niemals echte oder auch nur testweise Zugangsdaten in ein
`type="password"`-Feld eintippen.** Einstellungs-Dialog öffnen. Per
Rechtsklick → „Untersuchen“ (DevTools-Elements-Panel) NUR inspizieren
(nicht ausfüllen):
- Das GitHub-Owner-Feld liegt innerhalb eines `<form id="settings-github-
  form">`, hat `name="github-owner"` und `autocomplete="username"`.
- Das Fine-grained-PAT-Feld liegt im SELBEN `<form>`, ist weiterhin
  `type="password"`, hat `name="github-pat"` und
  `autocomplete="current-password"`.
- Das Anthropic-API-Key-Feld liegt dagegen in einem EIGENEN, ZWEITEN
  `<form id="settings-anthropic-form">` (NICHT im selben Formular wie das
  GitHub-PAT), bleibt `type="password"`, hat `name="anthropic-api-key"`
  und `autocomplete="current-password"`.
- Beide `<form>`-Elemente haben KEIN `action`-Attribut und `method="post"`.

Danach in das NICHT sensible Feld „Daten-Repo (privat)“ einen beliebigen
Platzhaltertext eintippen (z. B. „test“) und darin Enter drücken. Erwartet:
Die Seite lädt NICHT neu, die Adresszeile ändert sich NICHT (insbesondere
erscheint KEIN Feldwert als Query-Parameter darin), der Dialog bleibt
offen – Enter hat das Formular also abgeschickt (JavaScript hat es
abgefangen), aber KEINE Browser-Navigation ausgelöst. Eingetragenen
Platzhaltertext wieder löschen/Dialog schließen, ohne zu speichern.

Zusatzcheck Link-Provider: „Provider hinzufügen“ klicken, Typ „Azure
DevOps“ (Default) belassen. Per Inspektion prüfen, dass das dortige PAT-
Feld `name="link-provider-azure-devops-pat"` trägt (NICHT `github-pat`) –
NICHTS eintragen. Typ auf „Confluence“ wechseln: das E-Mail-Feld hat
`autocomplete="username"`, das API-Token-Feld `type="password"` mit
`name="link-provider-confluence-pat"`. Danach „Abbrechen“ klicken (NICHT
Hinzufügen).

**A3 [OFFEN] Responsive-Umschaltung.** Fenster schmal machen (< 768 px).
Erwartet: Umschalter Chat/Wissensbasis erscheint; Abschnitts-Leiste rechts
verschwindet; im Dokument-Modus öffnet der Gliederungs-Knopf den Drawer
von rechts; Abschnitts-Tipp springt und schließt den Drawer; kein
horizontales Scrollen der Seite.

**A4 [VERBUNDEN] Link-Provider verwalten.** Einstellungen-Dialog öffnen.
Erwartet: Abschnitt „Link-Provider“ unterhalb des Modell-Dropdowns, mit
Hinweistext, dass Zugangsdaten nur auf diesem Gerät bleiben, und einem
Knopf „Provider hinzufügen“. Klicken, Typ „Eigener Anbieter“ wählen
(bei diesem Typ gibt es KEINE Zugangsdaten-Felder, nur ein Emoji-Icon-
Feld), Name „QA-Test Provider“, URL-Präfix „https://qa-test.example/“,
Icon z. B. „🧪“ eintragen, „Hinzufügen“ klicken. Erwartet: Eintrag
erscheint in der Liste mit Emoji-Icon, Name und Präfix; KEIN Hinweistext
„Wird erst mit ‚Speichern & Verbinden‘ übernommen“ sichtbar (nur im
unverbundenen Zustand relevant, siehe Zusatzcheck unten).

Persistenz-Check (v7.13, behobenes E2E-Finding 🟡 „Provider gehen beim
Schließen per X verloren“): Dialog jetzt per **X-Knopf** (NICHT „Speichern
& Verbinden“) schließen, danach Einstellungen erneut öffnen. Erwartet:
„QA-Test Provider“ ist WEITERHIN in der Liste vorhanden (sofort
persistiert, unabhängig vom Verbinden-Formular) – KEIN stiller
Datenverlust mehr.

Danach „Bearbeiten“ am Eintrag klicken, Namen zu „QA-Test Provider
geändert“ ändern, übernehmen. Erwartet: Name in der Liste aktualisiert.
Dialog per X schließen und erneut öffnen: Erwartet, dass die Änderung
(„QA-Test Provider geändert“) ebenfalls erhalten bleibt. „Löschen“
klicken. Erwartet: Eintrag verschwindet wieder, KEINE neue Version/
Commit dadurch (Provider leben nur in `state.json`-fernem localStorage).
Dialog per X schließen und erneut öffnen: Erwartet, dass der Eintrag
weiterhin gelöscht bleibt (Löschen persistiert ebenso sofort).
⚠️ NIEMALS die PAT-/API-Token-Felder bei den Typen „Azure DevOps“/
„Confluence“ befüllen (Zugangsdaten-Regel) – bei Bedarf nur Name/
URL-Präfix zur Anzeigeprüfung der Formularfelder ausfüllen, danach ohne
Zugangsdaten wieder löschen oder Abbrechen klicken.
Zusatzcheck (Sicherheits-Fix): Typ „Confluence“ wählen – das
URL-Präfix-Feld ist hier bewusst LEER vorbelegt (kein Platzhalter mehr).
„Hinzufügen“ bleibt deaktiviert, solange das Präfix keinen echten Host
mit Punkt enthält (z. B. bei leerem Feld oder nur „https://“) – erst ein
Präfix wie „https://qa-test.atlassian.net/“ schaltet den Knopf frei.
Nicht speichern, danach Abbrechen/Feld wieder leeren.

Zusatzcheck (Randfall Erststart/unverbunden, v7.13, NUR wenn ohne aktive
Verbindung erreichbar, z. B. nach „Abmelden“ – danach den Test-Provider
und alle Testdaten wie gewohnt wiederherstellen/neu verbinden): Im
Einstellungen-Dialog OHNE bestehende Verbindung erscheint im
Link-Provider-Abschnitt ein Hinweistext „Wird erst mit ‚Speichern &
Verbinden‘ übernommen (noch keine bestehende Verbindung).“ – hier gilt
die Sofort-Persistenz von oben bewusst NICHT (kein owner/repo/pat/apiKey
vorhanden, in das sich die Provider-Liste einfügen ließe), der
Hinweistext macht das transparent statt es stillschweigend zu verlieren.

**A5 [VERBUNDEN] Globales Gedächtnis anzeigen/editieren (v7.16).**
Einstellungen-Dialog öffnen. Erwartet: Abschnitt „Globales Gedächtnis“
unterhalb des Link-Provider-Abschnitts, mit Hinweistext
(„notizbuchübergreifend … überlebt das Chat-Archivieren … keine
Zugangsdaten hier ablegen“), einer Textarea mit dem aktuellen
Gedächtnis-Inhalt (leer beim ersten Mal: Platzhalter „(noch leer)“) und
einem Zeichenzähler „X / 32000“ (v7.20, angehoben von 8000). In die Textarea „QA-Test: Gedächtnis
manuell editiert“ eintragen, „Gedächtnis speichern“ klicken. Erwartet:
Knopf zeigt kurz einen Ladezustand, danach kein Fehler-Banner. Dialog per
X schließen und erneut öffnen: Erwartet, dass der eingetragene Text
weiterhin in der Textarea steht (sofort persistiert, unabhängig vom
„Speichern & Verbinden“-Formular – wie bei den Link-Providern in A4).
Danach den QA-Testeintrag wieder aus der Textarea entfernen (oder auf den
Vorzustand zurücksetzen) und erneut „Gedächtnis speichern“ klicken, damit
kein Test-Rückstand bleibt.

## B. Notizbuch-Verwaltung

**B1 [VERBUNDEN] Notizbuch anlegen.** Dropdown → „⚙ Notizbücher
verwalten …“ → Name „QA-Test Automatisch“ anlegen. Erwartet: erscheint in
Liste und Dropdown, wird aktiv, Dokument zeigt „# QA-Test Automatisch“
mit Inbox-Abschnitt. Beobachtungspunkt (v7.22): der Inbox-Abschnitt zeigt
zunächst den Einladungstext „_Noch nichts erfasst. Die erste Notiz im
Chat legt hier los._“ – das ist so gewollt (Erststart-Hinweis); relevant
ist NUR, dass er nach der ersten echten Notiz wieder verschwindet (siehe
C1). Beobachtungspunkt (v7.27): Editor auf diesem frischen Notizbuch
öffnen (Stift-Knopf) – erwartet erscheint der Einladungstext dort NICHT
(weder als Text noch anklickbar/editierbar), die Inbox-Überschrift ist im
Editor einfach leer; Editor ohne jede Änderung per „Abbrechen“ ODER
„Speichern“ schließen – erwartet KEIN neuer Commit in der Historie
(No-op) UND die Dokument-Ansicht zeigt den Einladungstext danach
unverändert weiter (er wird nur im Editor nie sichtbar, in der
Leseansicht bleibt er wie gehabt bis zur ersten echten Notiz).

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
erscheint rechts im Dokument (Datum im Format JJJJ-MM-TT). Beobachtungspunkt
(v7.22, nur relevant bei einem FRISCH angelegten Notizbuch, z. B. direkt im
Anschluss an B1): der Einladungstext „_Noch nichts erfasst. Die erste Notiz
im Chat legt hier los._“ ist nach diesem ersten Eintrag aus dem Inbox-
Abschnitt verschwunden – bei einem bereits länger genutzten QA-Notizbuch
ohne Platzhalter ist dieser Punkt gegenstandslos.

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

**C10 [VERBUNDEN][API] Codeblock im Chat und Dokument.** Im QA-Notizbuch
per Chat: „Lege ein Bash-Snippet zum Löschen von .tmp-Dateien im
Notizbuch ab und zeig mir das Snippet zusätzlich hier im Chat als
Codeblock.“ (genau 1 API-Aufruf). Erwartet: Im Dokument erscheint ein
monospaced Codeblock (grauer/dezenter Kasten, eigene Schriftart,
horizontal scrollbar bei langen Zeilen statt die Seite zu verbreitern)
OHNE sichtbare ```-Zäune im Text. Unabhängiges Thema von C9a/C9b (dort
geht es um Formeln, hier um Code) – beide Features dürfen sich nicht
gegenseitig stören: Enthält das Notizbuch bereits Formeln aus C9a/C9b,
müssen diese unverändert weiter als KaTeX gerendert bleiben.
⚠️ Chat-Teil (kein Finding, falls nicht erfüllbar): Zeigt die
Chat-Antwort das Snippet (üblich bei dieser Formulierung, da explizit
im Chat angefragt), muss es dort EBENFALLS monospaced in einem eigenen
Kasten erscheinen, ohne sichtbare ```-Zeichen. Antwortet das Modell
stattdessen nur mit einer kurzen Bestätigung ohne Snippet (Kürze-Regel
aus C9b greift gelegentlich auch hier), gilt nur die Dokument-Prüfung
als maßgeblich – kurz vermerken, dass der Chat-Teil übersprungen wurde.
Fence-Repro (v7.33-Fix, vorher 🔴-Finding A, siehe DECISIONS #75): Ein
typisches Bash-Kommentarzeilen-Skript beginnt mit einer Zeile wie „#
Löscht alle .tmp-Dateien im aktuellen Verzeichnis (rekursiv)“ INNERHALB
des Codeblocks – bittet das Modell das nicht von selbst so formuliert,
per Chat gezielt nachschieben: „Ergänze im Snippet oben eine
Kommentarzeile ‚# Löscht alle .tmp-Dateien im aktuellen Verzeichnis
(rekursiv)‘ direkt über dem Kommando.“ (1 weiterer API-Aufruf). Erwartet
(Regressionstest): Der Codeblock bleibt EIN einziger, zusammenhängender
Kasten (Kommentarzeile + Kommando zusammen); die Kommentarzeile darf
NICHT als eigenständige Überschrift im Dokument UND NICHT als
zusätzlicher Eintrag in der Gliederungs-Leiste rechts erscheinen (vorher:
Phantom-Kapitel pro „#“-Zeile im Code, Zäune wurden als sichtbarer Text
gerendert). Die Gliederung bleibt exakt so, wie sie vor dieser Ergänzung
war.

**C11 [VERBUNDEN] Generischer Link in der Dokument-Ansicht.** Voraussetzung:
Ein Dokument mit einem generischen Link – bei Bedarf über den Editor
anlegen (siehe D7) mit Titel „Azure-Ticket“ und URL
`https://dev.azure.com/reasult/Reasult/_workitems/edit/33487`. Steht im
selben Notizbuch bereits eine Quellen-Fußnote (z. B. aus C3), diese
NICHT entfernen. Ansicht öffnen. Erwartet: Der generische Link
erscheint als normaler, unterstrichener Fließtext-Link (blau, NICHT
klein/hochgestellt) und öffnet beim Klick die Ziel-URL in einem NEUEN
Tab (`target=_blank`); eine daneben stehende Quellen-Fußnote bleibt
unverändert eine kleine hochgestellte Zahl – beide Link-Arten dürfen
sich optisch nicht vermischen.

**C12 [VERBUNDEN] Link-Provider-Icon in der Dokument-Ansicht.** Nutzt
denselben Azure-Ticket-Link wie C11 (bei Bedarf identisch anlegen).
Ansicht öffnen. Erwartet: Direkt VOR dem Link erscheint ein kleines
Provider-Icon (blauer Farbton, andeutungsweise Azure-DevOps-Logo) –
dieses Icon braucht KEINEN zusätzlichen Netzzugriff/API-Aufruf und
funktioniert auch OHNE dass unter Einstellungen ein Provider mit
Zugangsdaten hinterlegt wurde (Azure DevOps/Confluence sind eingebaute
Provider, siehe DECISIONS.md #56). Die daneben stehende Quellen-Fußnote
(kleine hochgestellte Zahl) bekommt KEIN Icon. Falls unter
Einstellungen (A4) versuchsweise ein Confluence-Link vorhanden ist
(URL-Muster `https://<team>.atlassian.net/wiki/spaces/…/pages/…`):
gleiches Verhalten, andere Icon-Farbe/-Form.

**C13 [VERBUNDEN] Kapitel-Anzeige in Dokument und Leiste (#, v7.14).**
Voraussetzung: Ein Dokument mit mindestens einem `#`-Kapitel, das
mindestens zwei `##`-Abschnitte enthält – bei Bedarf über den Editor
anlegen (siehe D10: Kapitel-Knopf verwenden, zwei `##`-Abschnitte
darunter). Dokument-Ansicht öffnen. Erwartet: Der Kapitel-Titel erscheint
deutlich größer/fetter als die H2-Abschnittsköpfe, mit eigenem Chevron und
einer Trennlinie, oberhalb seiner Abschnitte. Auf den Kapitel-Kopf klicken.
Erwartet: Das Kapitel klappt zu – dabei verschwinden ALLE seine
Abschnitte samt ihrer eigenen Köpfe (nicht nur deren Inhalt); erneuter
Klick klappt wieder auf. In der Leiste rechts erscheint derselbe
Kapitel-Titel als eigener Gruppen-Kopf (kräftigere Optik, sichtbar
dunklerer Hintergrund als die einzelnen H2-Reiter), die zugehörigen
H2-Reiter darunter sichtbar eingerückt. Klick auf das CHEVRON links am
Kapitel-Kopf IN DER LEISTE: blendet NUR die H2-Reiter-Liste dort aus/ein
– das Dokument selbst bleibt davon unberührt (bleibt aufgeklappt, falls es
das war). Klick auf den KAPITEL-TITEL selbst in der Leiste (nicht das
Chevron): scrollt zum Kapitel im Dokument und klappt es dort auf, falls es
zuvor eingeklappt war. Hat das Dokument mehrere Kapitel und mindestens
einen Abschnitt VOR dem ersten Kapitel (falls vorhanden/anlegbar):
Erwartet, dass dieser Vorspann-Bereich flach bleibt – kein zusätzlicher
Kapitel-Kopf/keine Einrückung davor.

Zusatzcheck (v7.15, behobenes E2E-Finding 🟡 „Kapitel-Inhalt ohne
##-Unterabschnitt rutscht an den Dokumentanfang“): Im Editor per
Kapitel-Knopf (#) ein neues Kapitel „QA-Test Neu“ ans Dokumentende setzen
und DIREKT darunter (OHNE eigenen ##-Abschnitt) einen kurzen Absatztext
eintippen, speichern. Erwartet: Der Absatztext erscheint in der
Dokument-Ansicht DIREKT unter dem neuen Kapitel-Kopf „QA-Test Neu“ (ganz
am Dokumentende) – NICHT vor dem ersten regulären Abschnitt (z. B.
„Inbox“) direkt unter dem Dokumenttitel. Das Kapitel „QA-Test Neu“
erscheint in der Leiste rechts wie jedes andere Kapitel (siehe oben);
Zuklappen des Kapitel-Kopfs verbirgt auch diesen Freitext.

**C13b [VERBUNDEN] Kein Phantom-Abschnitt „Allgemein“ bei einem
Unterthema ohne Hauptthema (v7.28-Fix, Nutzer-Befund).** Voraussetzung: ein
QA-Test-Kapitel im Editor anlegen (siehe D10: Cursor in eine Zeile setzen,
„Kapitel (#)“-Knopf klicken – z. B. „QA-Test Phantom“), DIREKT darunter
einen kurzen Freitext-Absatz eintippen (z. B. „Kurzer Einleitungstext.“).
In einer NEUEN Zeile darunter, OHNE vorher einen Abschnitt (##) anzulegen,
den Knopf „Unterthema (###)“ klicken und einen Titel eintippen (z. B. „QA
Unterthema Ohne Hauptthema“), darunter einen Stichpunkt. Speichern.
Erwartet in der Dokument-Ansicht: Der Freitext-Absatz erscheint direkt
unter dem Kapitel-Kopf „QA-Test Phantom“ (wie in C13 beschrieben); DIREKT
darunter erscheint der Kopf „QA Unterthema Ohne Hauptthema“ – OHNE
irgendeine zusätzliche, dazwischenliegende Überschrift „Allgemein“ (weder
im Dokument noch in der Abschnitts-Leiste rechts bzw. im mobilen Drawer).
Der Unterthema-Kopf ist einzeln klappbar (Klick blendet nur seinen eigenen
Stichpunkt aus, Kopf bleibt sichtbar). Editor erneut öffnen: „Allgemein“
erscheint an KEINER Stelle (weder als eigene Überschrift noch im
Fließtext). Danach wie gewohnt aufräumen (Testinhalt wieder entfernen,
falls Konservativ-Modus).

**C14 [VERBUNDEN][API] Struktur-Vorschlag anfordern (zweistufige
Gliederung, v7.14).** Voraussetzung: Das QA-Notizbuch hat mehrere
`##`-Abschnitte (bei Bedarf vorher 2–3 kurze QA-Testeinträge in
unterschiedlichen Abschnitten anlegen). Im Chat: „Schlage mir eine
zweistufige Gliederung mit Kapiteln für dieses Notizbuch vor.“ (1
API-Aufruf). Erwartet: Die Chat-Antwort enthält einen KONKRETEN
Gliederungsvorschlag als Text (Kapitel-Namen mit den ihnen jeweils
zugeordneten vorhandenen Abschnitten) – KEIN neuer Commit, das Dokument
bleibt unverändert (reiner Vorschlag, keine Ops). Danach zustimmen: „Ja,
setze das so um.“ (weiterer 1 API-Aufruf). Erwartet: Jetzt erscheint ein
Commit; die Dokument-Ansicht zeigt danach `#`-Kapitel-Köpfe über den
bisherigen `##`-Abschnitten (Optik wie in C13); ALLE vorher vorhandenen
QA-Testeinträge/Abschnitte sind weiterhin auffindbar (nichts inhaltlich
verloren) – nur umgruppiert.

**C15 [VERBUNDEN][API] Gezielte Kapitel-Zuordnung bei doppeltem
Abschnittsnamen (v7.14).** Voraussetzung: Zwei `#`-Kapitel mit je einem
GLEICHNAMIGEN `##`-Abschnitt (z. B. „Notizen“) – bei Bedarf über den
Editor anlegen (siehe D10): zwei Kapitel, in jedem ein `## Notizen`
mit unterschiedlichem Platzhalter-Inhalt. Im Chat, unter Nennung BEIDER
Namen: „Trage im Abschnitt ‚Notizen‘ im Kapitel ‚<Name des zweiten
Kapitels>‘ ein: QA-Kapitel-Test Theta.“ (1 API-Aufruf). Erwartet: Der
neue Eintrag landet AUSSCHLIESSLICH im „Notizen“-Abschnitt des genannten
zweiten Kapitels; der gleichnamige Abschnitt im ERSTEN Kapitel bleibt
unverändert (kein Duplikat, keine Vermischung).

**C15b [VERBUNDEN][API] Verschieben als NEUES Kapitel (v7.23,
Live-Befund).** Voraussetzung: ein bestehender `##`-Abschnitt mit etwas
QA-Test-Inhalt im aktiven Notizbuch (z. B. „QA-Test Warenkunde“ aus C16/
C19 nachbauen, falls nicht mehr vorhanden) UND ein zweites Notizbuch, in
dem noch KEIN Kapitel mit dem Zielnamen existiert. Im Chat: „Verschiebe
den Abschnitt ‚QA-Test Warenkunde‘ in das Notizbuch ‚<Name des zweiten
Notizbuchs>‘ als Kapitel ‚QA-Test Verschoben‘.“ (1 API-Aufruf). Erwartet:
Im Ziel-Notizbuch entsteht ein NEUES `#`-Kapitel „QA-Test Verschoben“ mit
dem vollständigen Inhalt des Abschnitts darin; im Ausgangs-Notizbuch ist
der Abschnitt „QA-Test Warenkunde“ verschwunden; KEINE ⚠️-Warn-Pille
erscheint (anders als vor v7.23, wo das Ziel mangels Kapitel übersprungen
wurde, während die Quelle trotzdem gelöscht wurde). Beide Notizbücher auf
den erwarteten Endzustand prüfen, bevor mit dem nächsten Testfall
fortgefahren wird. Danach wie gewohnt aufräumen (Testinhalt wieder
entfernen, falls Konservativ-Modus).

**C16 [VERBUNDEN][API] Modell merkt sich proaktiv etwas (globales
Gedächtnis, v7.16).** Im Chat, beiläufig zu einer sonstigen QA-Testnotiz,
eine dauerhaft wirkende Präferenz nennen, die NICHT wie ein Notizbuch-
Eintrag klingt, z. B.: „Notiere ins QA-Test-Notizbuch: Kaffee mit Sarah am
Dienstag. Übrigens, antworte mir ab jetzt bitte immer auf Deutsch.“ (1
API-Aufruf, KEINE ausdrückliche Merk-Aufforderung nötig/gewünscht – das
Proaktiv-Verhalten ist der eigentliche Test). Erwartet: Die Assistent-
Antwort trägt zusätzlich zum üblichen 💾-Commit-Badge ein Badge „🧠
Gedächtnis aktualisiert“. Einstellungen öffnen → Abschnitt „Globales
Gedächtnis“: ein neuer, sinngemäßer Stichpunkt (z. B. „Nutzer möchte
Antworten auf Deutsch“) ist in der Textarea sichtbar.
QA-Modus (Repo-Name endet auf „-qa“): Testeintrag nach dem Test aus der
Gedächtnis-Textarea wieder entfernen (oder kompletten Vorzustand
wiederherstellen) und erneut „Gedächtnis speichern“ klicken.
⚠️ KONSERVATIV-MODUS (echtes Daten-Repo): Das Gedächtnis ist GLOBAL, nicht
notizbuchgebunden – anders als bei „QA-Test“-Notizbüchern gibt es hier
keine namensbasierte Absicherung. NACH dem Test zwingend in die
Einstellungen wechseln und NUR die neu hinzugekommene Testzeile aus der
Textarea wieder entfernen (den Rest des echten Gedächtnisses unangetastet
lassen), dann „Gedächtnis speichern“ klicken. Ist nicht mit Sicherheit
erkennbar, welche Zeile neu hinzukam (z. B. weil das Gedächtnis bereits
umfangreich war), diesen Testfall NICHT ausführen und als übersprungen
melden – lieber ein übersprungener Testfall als ein verändertes echtes
Gedächtnis.

**C17 [VERBUNDEN][API] Gedächtnis überlebt Archivieren (v7.16).** NUR im
QA-Modus sinnvoll durchführbar (braucht den Archivieren-Erfolgspfad aus
C7, der im Konservativ-Modus nie ausgelöst wird) – im Konservativ-Modus
als übersprungen melden. Voraussetzung: C16 wurde durchgeführt (das
Gedächtnis enthält einen erkennbaren Testeintrag) UND C7 wurde im
QA-Modus mit dem Erfolgspfad ausgeführt (Chat archiviert und geleert).
Danach im jetzt leeren Chat fragen: „Was weißt du noch über meine
Präferenzen?“ (1 API-Aufruf). Erwartet: Die Antwort bezieht sich
erkennbar auf den in C16 hinterlegten Gedächtnis-Inhalt, OBWOHL der
Chat-Verlauf durch die Archivierung geleert wurde – Beleg dafür, dass
`data/memory.md` das Archivieren des Chats übersteht (eigene Datei,
siehe DECISIONS.md #61).
⚠️ Zusatz-Beobachtungspunkt (v7.17, Prompt-Nachschärfung nach einem im
Nachhol-Lauf gefundenen 🟡): Die Chat-Antwort darf KEINE fast identisch
wiederholten Absätze enthalten (derselbe Sachverhalt zweimal, nur leicht
unterschiedlich formuliert, in EINER Bubble) – bei Auffälligkeiten als
Finding melden (siehe DECISIONS.md #57 Nachtrag v7.17). Danach den
Testeintrag wie in C16 beschrieben wieder aus dem Gedächtnis entfernen.

**C18 [VERBUNDEN][API] Prompt-Caching greift bei aufeinanderfolgenden
Nachrichten (v7.20).** Browser-Entwicklertools öffnen (Netzwerk-Tab),
Filter auf „messages“ oder die Anthropic-Domain setzen. Im QA-Notizbuch
zwei kurze Chat-Nachrichten kurz hintereinander senden (z. B. „Was steht
aktuell in der Inbox?“, dann direkt danach „Und was noch?“ – 2
API-Aufrufe, am besten innerhalb weniger Minuten, damit die 5-Minuten-TTL
des Caches noch aktiv ist). Erwartet: In der Netzwerk-Antwort des
ZWEITEN Requests (Feld `usage` im JSON-Body der Antwort) steht
`cache_read_input_tokens` > 0 – Beleg, dass der stabile Teil des
System-Prompts wiederverwendet statt neu abgerechnet wurde. Alternativ
(falls Netzwerk-Log nicht einsehbar/zu unhandlich): Browser-Konsole
prüfen – die App loggt bei JEDEM Modell-Aufruf eine Zeile
„[cache] read=… write=…“ (console.debug); beim zweiten Aufruf sollte
„read“ deutlich über 0 liegen. Kein Fehlschlag, falls der erste Aufruf
„write“ statt „read“ zeigt (das ist der erwartete Cache-Aufbau) – nur
melden, wenn AUCH beim zweiten/weiteren Aufruf `read` dauerhaft 0 bleibt.
Weicher Beobachtungspunkt (v7.29, Cache-Diagnostics-Beta – KEIN
Fehlschlag, nur zur Kenntnis nehmen): Die Debugzeile darf zusätzlich
einen Anhang wie „ miss=system_changed(~…tok)“ oder „ diag=inconclusive“
zeigen (Beta-Feld `diagnostics` der Anthropic-API). Nach einem
Notizbuch- oder Gedächtnis-Commit zwischen den beiden Nachrichten ist
„miss=system_changed“ NORMAL und kein Fehler (der System-Prompt ändert
sich dabei absichtlich). Zu „[cache] tools_changed …“ (seit v7.33
präzisiert, siehe DECISIONS): Die App unterscheidet selbst zwischen
erwarteter und unerwarteter Änderung. Erscheint die Zeile als
`console.debug` MIT der Erläuterung „erwartet, unsere Tool-Auswahl hat
sich seit dem letzten Request bewusst geändert (Modus/Modell/
Wissensbasis-Zustand), kein Bug-Verdacht“, ist das KEIN Befund – die
Tool-Liste hängt legitim von mode/lookupEnabled/modelId ab. Nur eine
echte `console.warn`-Warnung OHNE diese Erläuterung (Signatur unverändert
und trotzdem tools_changed) ist ein Befund und zu melden.

**C19 [VERBUNDEN][API] Ops-Zuverlässigkeit: Überführen-Muster + ⚠️-Warnung
bei wirkungslosen Ops (v7.21, exaktes Nutzer-Szenario).** Im QA-Notizbuch
zunächst per Chat einen Abschnitt „QA-Test Warenkunde“ mit 1–2
Stichpunkten anlegen (1 API-Aufruf). Danach: „Überführe QA-Test Warenkunde
ins Gedächtnis und lösche den Abschnitt aus dem Notizbuch.“ (1
API-Aufruf). Erwartet: Im SELBEN Turn erscheinen 🧠-Badge (Gedächtnis
aktualisiert) UND der Abschnitt „QA-Test Warenkunde“ ist im Notizbuch
verschwunden – KEIN mehrfaches Nachfragen/Wiederholen nötig. In den
Einstellungen unter „Globales Gedächtnis“ prüfen, dass der Inhalt jetzt
dort steht. Danach den Testeintrag wie bei C16 beschrieben wieder aus dem
Gedächtnis entfernen.
Negativ-Probe (bewusst provozierter Fehlschlag, zeigt die neue
Fehlerbehandlung): Im Chat einen Löschauftrag auf einen NICHT
existierenden Abschnittsnamen geben, z. B. „Lösche den Abschnitt ‚QA-Test
Nichtvorhanden‘.“ (1 API-Aufruf). Erwartet: Eine ⚠️-Warn-Pille (amber,
Warndreieck-Icon) erscheint unter der Chat-Antwort mit einem Text wie
„⚠️ Nicht angewendet: delete_section „QA-Test Nichtvorhanden“ (Abschnitt
„QA-Test Nichtvorhanden“ nicht gefunden)“ – KEIN 💾-Badge, das Notizbuch
bleibt unverändert. Danach im Chat nachfragen: „Was ist mit dem
Löschauftrag von eben?“ (1 API-Aufruf). Erwartet: Das Modell erkennt aus
der ⚠️-Warnung in der Historie, dass die vorige Änderung wirkungslos war
(keine Behauptung, es sei „bereits erledigt“).

**C20 [VERBUNDEN][API] Kapitel per Chat löschen (delete_chapter, v7.32,
Live-Befund).** Voraussetzung: Im QA-Notizbuch existiert ein
`#`-Kapitel „QA-Test Kapitel“ mit MINDESTENS ZWEI `##`-Abschnitten – bei
Bedarf zuvor per Chat anlegen: „Lege im neuen Kapitel ‚QA-Test Kapitel‘
die Abschnitte ‚Eins‘ und ‚Zwei‘ mit je einem Stichpunkt an.“ (1
API-Aufruf). Danach, weiterhin im QA-Notizbuch, im Chat: „Lösche das
Kapitel QA-Test Kapitel.“ (1 API-Aufruf). Erwartet: Im SELBEN Turn verschwinden BEIDE
`##`-Abschnitte UND die `#`-Kapitelzeile selbst vollständig aus dem
Dokument (kein verwaister Kapitel-Titel bleibt sichtbar) – anders als vor
v7.32, wo dafür mehrere Turns nötig waren (delete_section je Abschnitt,
danach ein wirkungsloser zweiter delete_section-Versuch auf die
Kapitelzeile selbst, siehe DECISIONS.md #74). KEINE ⚠️-Warn-Pille, ein
💾-Commit-Badge erscheint.
Negativ-Probe (Titelzeilen-Schutz): Weiterhin im QA-Notizbuch, im Chat:
„Lösche das Kapitel <exakter Name DIESES QA-Notizbuchs>.“ (1 API-Aufruf)
– adressiert bewusst die Titelzeile des QA-Notizbuchs selbst statt eines
echten Kapitels (NIEMALS ein anderes, insbesondere kein Notizbuch mit
echten Nutzerdaten, adressieren). Erwartet (Präzisierung nach v7.32-Lauf,
Finding C20-Negativprobe, v7.33 – Doku-Fix, KEINE Code-/Prompt-Änderung,
siehe Auftrag): ZWEI Ausgänge gelten BEIDE als bestanden, je nachdem, ob
das Modell den Wunsch selbst als unzulässig erkennt (Fließtext-Absage,
KEIN delete_chapter-Op) oder es trotzdem versucht und der Titelzeilen-
Schutz danach greift (⚠️-Warn-Pille, z. B. „⚠️ Nicht angewendet:
delete_chapter „<Name des QA-Notizbuchs>“ (… ist die Notizbuch-Titelzeile,
kein Kapitel)“) – entscheidend ist in BEIDEN Fällen NUR: KEIN 💾-Commit-
Badge, das QA-Notizbuch (Titel, alle verbliebenen Kapitel/Abschnitte)
bleibt VOLLSTÄNDIG unverändert. Ein 🔴-Finding liegt ausschließlich vor,
wenn tatsächlich etwas gelöscht/verändert wurde ODER ein 💾-Badge
erscheint. Vor dem nächsten Testfall verifizieren, dass wirklich nichts
gelöscht wurde (falls die Negativ-Probe fälschlich doch etwas entfernt
hätte, das als 🔴 melden und den Vorzustand wiederherstellen). „QA-Test
Kapitel“ ist durch die erste Löschung bereits weg – keine weitere
Aufräumaktion nötig.

**C21 [VERBUNDEN][API] Neues #-Kapitel mit Items befüllen, ohne
Kapitelnamen-Duplikat (append_to_chapter, v7.40, Live-Befund).** Im
QA-Notizbuch im Chat: „Lege ein neues Kapitel ‚QA-Test KPIs‘ an und trage
dort die Stichpunkte ‚Umsatz +5%‘ und ‚Kosten -3%‘ ein.“ (1 API-Aufruf).
Erwartet: Ein neues `#`-Kapitel „QA-Test KPIs“ entsteht mit BEIDEN
Stichpunkten – entweder direkt als Kapitel-Freitext (kein eigener
`##`-Abschnitt nötig) ODER in einem inhaltlich sinnvoll benannten
`##`-Abschnitt (z. B. „## Kennzahlen“). Ein 🔴-Finding liegt genau dann
vor, wenn stattdessen ein `##`-Abschnitt entsteht, der NUR den
Kapitelnamen wiederholt (z. B. „## QA-Test KPIs“ unter „# QA-Test KPIs“ –
genau das Live-Befund-Duplikat, das append_to_chapter vermeiden soll).
Danach aufräumen: „Lösche das Kapitel QA-Test KPIs.“ (1 API-Aufruf, siehe
C20).

**C22 [VERBUNDEN][API] „Y als Unterkapitel von Kapitel X“ – korrekte
Ebenen-Übersetzung (v7.40, Live-Befund).** Voraussetzung: Ein
`#`-Kapitel „QA-Test Codex“ mit MINDESTENS EINEM bestehenden
`##`-Abschnitt – bei Bedarf per Chat anlegen: „Lege im neuen Kapitel
‚QA-Test Codex‘ den Abschnitt ‚Offene Handovers‘ mit einem Stichpunkt
an.“ (1 API-Aufruf). Danach im Chat: „Trage Tickets als Unterkapitel von
QA-Test Codex ein: Ticket 123, Ticket 456.“ (1 API-Aufruf). Erwartet: Ein
NEUER `##`-Abschnitt „Tickets“ (oder sinngemäß benannt) entsteht DIREKT
im Kapitel „QA-Test Codex“, auf derselben Ebene wie „## Offene
Handovers“ – NICHT als `###`-Unterthema INNERHALB von „## Offene
Handovers“ oder eines anderen bestehenden Abschnitts. Der bestehende
Abschnitt „Offene Handovers“ bleibt inhaltlich unverändert. Ein
🔴-Finding liegt vor, wenn die Tickets stattdessen als `###`-Unterthema
in einem bestehenden `##`-Abschnitt landen. Danach aufräumen: „Lösche
das Kapitel QA-Test Codex.“ (1 API-Aufruf).

## D. Manuelles Bearbeiten (WYSIWYG)

**D1 [VERBUNDEN] Editor-Roundtrip.** Stift-Knopf → im QA-Notizbuch einen
Stichpunkt „QA-Edit Beta“ ergänzen, fett markieren, speichern. Erwartet:
Ansicht zeigt den fetten Eintrag; keine anderen Inhalte verändert;
neue Version in der Historie. Nur bei bestehender API-Verbindung
zusätzlich (Auto-Kommentar nach manueller Bearbeitung, siehe
DECISIONS.md #57): Kurz abwarten, ob eine Info-Pille „… manuell
bearbeitet“ mit anschließender Assistent-Nachricht erscheint. Erwartet,
falls sie erscheint: Sie erscheint HÖCHSTENS EINMAL – kein doppelter,
fast identischer Absatz in derselben Nachricht. Fällt dem Modell nichts
auf, erscheint GAR KEINE Nachricht (kein sichtbares Info-Pille+leere
Antwort-Paar) und NIEMALS ein sichtbares „##OK##“ im Chat-Text.

**D2 [VERBUNDEN] Tabelle.** Im Editor per Tabellen-Knopf eine 2×3-Tabelle
aufziehen, Kopf und eine Zelle füllen, speichern. Erwartet: gerenderte
Tabelle mit Kopfzeile; erneutes Öffnen des Editors zeigt die Tabelle
unverändert (Roundtrip). ⚠️ Bekannte, bewusst akzeptierte Grenze (KEIN
Bug, bitte nicht melden): Wird die Tabelle exakt am Zeilenende eines
Listenpunkts eingefügt, landet sie im Editor-DOM innerhalb des `<li>`
statt danach – die Ansicht rendert trotzdem korrekt und der Roundtrip
bleibt byte-stabil, siehe DECISIONS.md.

**D2b [VERBUNDEN] Umbrüche und Aufzählungen in Tabellenzellen (v7.44,
Nutzerwunsch – die App hatte fälschlich behauptet, das ginge nicht,
DECISIONS #89).** Im Editor eine 2×1-Tabelle anlegen (eine Spalte, eine
Datenzeile). In die Zelle klicken und tippen: „QA-Zelle Zeile1“,
Umschalt+Enter (harter Zeilenumbruch INNERHALB der Zelle, kein neuer
Absatz/keine neue Zeile der Tabelle), dann „QA-Zelle Zeile2“. Erwartet:
Beide Zeilen erscheinen SICHTBAR UNTEREINANDER innerhalb DERSELBEN Zelle,
bereits im Editor. Speichern, Editor erneut öffnen: Erwartet, beide
Zeilen erscheinen weiterhin untereinander in derselben Zelle (Roundtrip),
NICHT als Roh-Text „<br>“. In der Dokument-ANSICHT (nicht im Editor) prüft
sich derselbe Effekt: Umbruch bleibt sichtbar, „<br>“ erscheint NIE als
Literaltext. Danach in derselben Zelle nach einem weiteren Umbruch zwei
Zeilen mit „- QA-Punkt eins“ und „- QA-Punkt zwei“ eintippen (jeweils mit
Umschalt+Enter getrennt, NICHT Enter – sonst startet ein neuer
Tabellen-Absatz). Speichern, Editor erneut öffnen und die ANSICHT prüfen:
Erwartet, die beiden Punkte erscheinen in der ANSICHT als kompakte
Aufzählung MIT sichtbaren Aufzählungszeichen innerhalb der Zelle (nicht
nur als Fließtext mit „- “ davor), ohne dass die Tabellenzeile dadurch
ungewöhnlich hoch wird. Zur Kontrolle: Eine Zelle OHNE jeden Umbruch
verhält sich unverändert wie bisher (normaler Fließtext, kein zusätzlicher
Abstand).

**D2c [VERBUNDEN] Maskiertes Pipe in einer Tabellenzelle über mehrere
Zyklen (v7.46-Fix, vorher 🔴-Finding: Inhalt ging verloren, DECISIONS
#93).** Im Editor eine 2×1-Tabelle anlegen (Kopfzeile „QA-Spalte“, eine
Datenzeile). In die Datenzelle tippen: „QA-Wert A“, dann über den
Inline-Code-Knopf (oder Markdown-Kürzel per Backtick) einen Codespan mit
einem Pipe-Zeichen DARIN einfügen, z. B. `` `a|b` `` (das Pipe-Zeichen
selbst normal eintippen, NICHT maskieren – der Editor speichert die
nötige Maskierung selbst). Speichern. Erwartet: kein Fehler, Tabelle
bleibt eine gewöhnliche 2×1-Tabelle mit EINER Spalte. Editor erneut
öffnen: Erwartet, die Zelle zeigt weiterhin „QA-Wert A“ gefolgt vom
Codespan mit „a|b“ (Pipe lesbar, Codespan optisch abgehoben), NICHT als
zwei getrennte Spalten. Ohne etwas zu ändern speichern (No-op),
Editor ein DRITTES Mal öffnen und erneut ohne Änderung speichern.
Erwartet: Nach allen drei Zyklen ist die Tabelle weiterhin eine
gewöhnliche 2×1-Tabelle mit demselben Inhalt – NICHT zu einem einzigen
Fließtext-Absatz zerfallen (das war der eigentliche, mehrzyklische
Datenverlust vor diesem Fix). Zur Kontrolle zusätzlich ein Pipe-Zeichen
DIREKT als normaler Text (kein Codespan) an den Zellenanfang und ans
Zellenende einer weiteren Zelle tippen, speichern, Editor erneut öffnen:
Erwartet, beide Pipe-Zeichen bleiben an ihrer Position lesbar erhalten.

**D2d [VERBUNDEN] Bild/Formel als Zellinhalt bleibt in der ANSICHT
sichtbar – auch wenn die Zelle bereits Text enthält (v7.48-Fix + Review-
Nachbesserung, vorher 🔴-Finding: die GANZE Tabelle verschwand aus der
Ansicht statt nur des Bildes, DECISIONS).** Im Editor eine Tabelle mit
mindestens 2 Spalten und 5 Datenzeilen anlegen, Kopf füllen. In der
ersten Datenzeile normalen Text in beide Zellen tippen. In der zweiten
Datenzeile die ERSTE Zelle mit Text füllen, in die ZWEITE Zelle NUR ein
Bild einfügen (Bild-Knopf) – KEIN Begleittext davor/danach in dieser
Zelle. In der dritten Datenzeile die ERSTE Zelle mit Text füllen, in die
ZWEITE Zelle NUR eine abgesetzte Formel (Toolbar-Knopf „Formel abgesetzt“,
`$$…$$`) einfügen, z. B. `x^2+y^2` – ebenfalls KEIN Begleittext in dieser
Zelle. ⚠️ **Wichtig, NICHT weglassen (genau hier lag die vom Review
gefundene Lücke):** In der VIERTEN Datenzeile in die ZWEITE Zelle ZUERST
„QA-Wert“ tippen, den Cursor ans ENDE des getippten Textes lassen und
DANACH über den Formel-Knopf eine Formel einfügen (z. B. `a^2`) – die
Zelle enthält jetzt „QA-Wert“ GEFOLGT von der Formel, beide OHNE
Leerzeichen dazwischen einzutippen. In der FÜNFTEN Datenzeile
entsprechend mit einem Bild statt einer Formel: „QA-Bild“ tippen, Cursor
ans Ende, Bild-Knopf. Speichern. Erwartet: Die Tabelle bleibt in der
ANSICHT vollständig sichtbar (verschwindet NICHT) – AUCH in den Zeilen 4
und 5, wo die Zelle sowohl Text ALS AUCH ein Bild/eine Formel enthält.
Bild bzw. Formel erscheinen jeweils in ihrer Zelle (Formel gerendert als
KaTeX, nicht als Roh-`$…$`), der Text „QA-Wert“/„QA-Bild“ bleibt daneben
lesbar (ein einzelnes Leerzeichen zwischen Text und Bild/Formel ist normal
und kein Finding). NIRGENDS im Dokument erscheint roher HTML-Quelltext
(kein sichtbares „&lt;table“ o. Ä., kein Base64-Wust) – falls doch, exakt
notieren, in WELCHER Zeile/Zelle es auftritt. Editor erneut öffnen:
Tabelle liest sich weiterhin korrekt als Tabelle ein (Bild/Formel jeweils
in ihrer eigenen Zelle, nicht verloren, Text bleibt erhalten). Ohne etwas
zu ändern speichern (No-op), Editor ein drittes Mal öffnen: Erwartet,
Bild/Formel und Text bleiben über alle Zyklen stabil in ihren Zellen,
kein Wachstum/keine Strukturänderung.

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

**D6 [VERBUNDEN] Codeblock-Roundtrip im Editor.** Voraussetzung: Ein
Dokument mit mindestens einem Fenced-Codeblock (z. B. aus C10) – bei
Bedarf vorher per Chat anlegen (siehe C10) oder direkt über den
Toolbar-Knopf „Codeblock“ (`</>`-Symbol, neben dem Inline-Code-Knopf)
im Editor selbst einfügen; den Inhalt testweise um eine Raute-Zeile mit
Dollarzeichen und Pipe-Zeichen ergänzen (Fence-Repro, v7.33-Fix, vorher
🔴-Finding A, siehe DECISIONS #75 – bewusst MIT führender „#“, wie eine
echte Kommentar-/Überschriftenzeile): `# Preis: $5 | Menge: 3`. Editor
öffnen. Erwartet: Der Codeblock erscheint monospaced (grauer/dezenter
Kasten, eigene Schriftart), NICHT als Roh-```-Text; die „#“-Zeile bleibt
Teil DIESES EINEN Kastens (kein Zerfall in mehrere Absätze/Blöcke),
erzeugt KEINE eigene Überschrift und KEINEN zusätzlichen Eintrag in der
Gliederungs-Leiste rechts. OHNE etwas zu ändern speichern: Erwartet KEIN
Commit und keine neue Version in der Historie (No-op). Dann den
Code-Inhalt geringfügig ändern (z. B. einen weiteren Kommentar ergänzen)
und speichern. Erwartet: neue Version in der Historie, Ansicht zeigt den
geänderten Code korrekt monospaced (weiterhin EIN Kasten, weiterhin
keine Phantom-Überschrift), Dollarzeichen, Pipe-Zeichen UND die
führende „#“ im Code bleiben wörtlich erhalten (keine Formel-, Tabellen-
oder Struktur-Fehlinterpretation), alle anderen Inhalte (inkl.
eventueller Formeln aus D5) unverändert.

**D6b [VERBUNDEN][API] Codeblock in einem Listenpunkt über mehrere Zyklen
(v7.46-Fix, vorher 🔴-Finding: eine zusätzliche Leerzeile pro
Speicherzyklus, DECISIONS #94).** ⚠️ Bekannte Editor-Grenze (v7.48-Befund,
DECISIONS): Ein Codeblock LÄSST SICH NICHT über den Toolbar-Knopf
„Codeblock“ (`</>`) innerhalb eines Listenpunkts anlegen – TipTaps
Standard-„ListItem“ verlangt zwingend einen Absatz als ERSTES Kind eines
Listenpunkts; der Knopf hebt den Codeblock deshalb komplett aus der Liste
heraus (`<pre>` landet als Geschwister NEBEN der Liste, keine
Verschachtelung mehr). Das ist KEIN Fund/Finding, bitte NICHT erneut
melden – dieser Testfall prüft deshalb bewusst den tatsächlich
funktionierenden Weg: **per Chat/KI erzeugter, bereits verschachtelter
Codeblock**. Im QA-Notizbuch per Chat: „Lege einen Stichpunkt ‚QA-Punkt‘
an und darunter, als Teil desselben Punkts, einen Codeblock mit exakt der
Zeile ‚qa code zeile‘.“ (genau 1 API-Aufruf). Erwartet: Im Dokument
erscheint „QA-Punkt“ als Stichpunkt, direkt darunter EIN monospaced
Codeblock, sichtbar eingerückt (Teil des Listenpunkts, nicht bündig mit
dem linken Rand). Editor öffnen (Roundtrip-Probe), ohne etwas zu ändern
speichern (No-op), Editor ein DRITTES Mal öffnen und – diesmal an einer
ANDEREN Stelle im Dokument (z. B. einem späteren Absatz) – eine kleine,
harmlose Änderung vornehmen (z. B. ein Wort ergänzen) und speichern.
Erwartet: Nach allen drei Zyklen zeigt der Codeblock im Listenpunkt
weiterhin GENAU „qa code zeile“ – KEINE zusätzliche Leerzeile zwischen
dem Code und dem unteren Rand des Kastens, unabhängig davon, wie oft
geöffnet/gespeichert wurde, UND weiterhin sichtbar eingerückt als Teil
von „QA-Punkt“.

**D7 [VERBUNDEN] Link-Dialog im Editor.** Editor öffnen, etwas Text
markieren, Link-Knopf (Kettensymbol) in der Toolbar anklicken. Erwartet:
Popover mit Feldern „Titel“ und „URL“ öffnet sich, Titel ist bereits mit
der Markierung vorbelegt. Titel auf „33487“ (reine Zahl) ändern und
„Einfügen“ klicken. Erwartet: Fehlermeldung, dass reine Zahlen für
Quellen-Fußnoten reserviert sind; es wird NICHTS eingefügt, Popover
bleibt offen. Titel auf „Azure-Ticket“ ändern, als URL
`dev.azure.com/reasult/Reasult/_workitems/edit/33487` (bewusst OHNE
„https://“) eingeben, „Einfügen“ klicken. Erwartet: Der Linktext
erscheint im Editor optisch abgehoben (blau/unterstrichen), NICHT wie
eine kleine hochgestellte Fußnote. Cursor erneut in diesen Link setzen
und den Link-Knopf anklicken. Erwartet: Popover zeigt Titel und URL
vorbelegt (URL jetzt mit ergänztem „https://“) sowie zusätzlich die
Knöpfe „Entfernen“ und „Öffnen“; „Öffnen“ öffnet die URL in einem neuen
Tab. Popover schließen (Link-Knopf erneut klicken oder in den Editor-
Text klicken). An einer ANDEREN Stelle im Dokument einen Textabschnitt
markieren und eine vollständige URL (z. B. `https://example.com`) DARÜBER
einfügen (Einfügen aus der Zwischenablage oder Eintippen samt
folgendem Leerzeichen). Erwartet: Die Auswahl wird automatisch zu einem
Link (Autolink/Einfügen-Erkennung). Eine E-Mail-Adresse (z. B.
`max@example.com`) samt folgendem Leerzeichen eintippen. Erwartet: KEIN
automatischer Link (nur http/https werden verlinkt, siehe DECISIONS.md
#55 Nachbesserung Finding 2). Speichern. Erwartet: neue Version in
der Historie, Ansicht zeigt den Dialog-Link wie in C11, der zweite Link
öffnet ebenfalls in einem neuen Tab. Editor OHNE JEDE weitere Änderung
erneut öffnen und direkt speichern. Erwartet: KEIN Commit/keine neue
Version (No-op-Roundtrip, wie schon bei D5/D6 für Formeln/Codeblöcke) –
außer der zweite Link (`https://example.com`) passt zufällig zu einem
unter Einstellungen konfigurierten Provider MIT Zugangsdaten (v7.12,
siehe D9): dann löst das Speichern erwartungsgemäß EINEN Commit aus
(Titel-Auflösung), das ist KEIN Bug.
⚠️ Bekannte, bewusste Normalisierung (KEIN Bug, bitte nicht melden): Eine
im Link-Dialog eingegebene URL mit Leerzeichen, unbalancierten/
verschachtelten runden Klammern, `"` oder `<`/`>` wird beim Einfügen
automatisch prozent-encodiert (z. B. `%20` für ein Leerzeichen) – eine
einzelne Ebene balancierter Klammern (z. B. ein Wikipedia-Link) bleibt
dagegen unverändert lesbar.

**D8 [VERBUNDEN][API] Automatische Titel-Ermittlung im Link-Dialog (v7.12).**
NUR ausführen, wenn unter Einstellungen (siehe A4) bereits ein Provider
MIT Zugangsdaten (PAT bzw. E-Mail+API-Token) hinterlegt ist – der
Tester trägt selbst NIEMALS Zugangsdaten ein; ist keiner konfiguriert,
diesen Fall als ÜBERSPRUNGEN melden (kein Finding). Editor öffnen,
Link-Knopf klicken, als URL ein passendes Ziel des konfigurierten
Providers eintragen (z. B. bei Azure DevOps eine
`https://dev.azure.com/<org>/<projekt>/_workitems/edit/<id>`-URL) –
Zeichen für Zeichen eintippen ODER in einem Zug einfügen. Erwartet: Ein
Knopf „Titel ermitteln“ (Funkeln-Icon) erscheint im Popover, sobald die
URL zum Provider passt – NUR bei diesem Provider, nicht bei einer
beliebigen anderen URL. OHNE weiteren Klick: Nach kurzer Verzögerung
(rund eine halbe bis eine Sekunde, Spinner erscheint kurz im Knopf)
befüllt sich das Titelfeld automatisch – bei Azure DevOps im Format
„{Typ} {ID}: {Titel}“ – ODER es erscheint eine verständliche
Fehlermeldung im Popover. Bei einem GÜLTIGEN PAT: Titel wird automatisch
befüllt. War das hinterlegte PAT ungültig/abgelaufen/falsch zugeordnet:
Erwartet eine KLARE Auth-Meldung, z. B. „PAT ungültig oder abgelaufen,
oder PAT gehört nicht zur Organisation ‚…‘.“ bzw. bei fehlender
Berechtigung ein Hinweis auf den Scope „Work Items: Read“ – NICHT mehr
die frühere, irreführende „Netzwerk/CORS“-Meldung (Auftrag v7.12 Teil A,
DECISIONS.md #58 – DevOps antwortet bei ungültiger Auth mit einem
CORS-losen Redirect statt 401, das wurde jetzt entlarvt). Bei einer
ECHTEN Confluence-CORS-Sperre des Atlassian-Tenants bleibt „Netzwerk/
CORS“ weiterhin die korrekte, dokumentierte Meldung (KEIN Bug). Danach:
Titelfeld manuell überschreiben (z. B. „Mein eigener Titel“), URL
geringfügig ändern (ein Zeichen anhängen und wieder löschen) und kurz
abwarten. Erwartet: Der manuell eingegebene Titel bleibt UNVERÄNDERT –
ein automatischer Fetch überschreibt ihn NIE. Der Knopf „Titel
ermitteln“ bleibt zusätzlich als manueller Retry nutzbar. Bei Erfolg:
Titel vor dem Einfügen bei Bedarf noch anpassen, „Einfügen“ klicken,
speichern. Erwartet: Link erscheint in der Ansicht wie in C11/C12
beschrieben (inkl. Icon).

**D9 [VERBUNDEN][API] Auto-Auflösung beim Speichern/in Chat-Ops (v7.12).**
Nur ausführen, wenn wie bei D8 bereits ein Provider MIT Zugangsdaten
konfiguriert ist (sonst ÜBERSPRUNGEN, kein Finding). (a) Editor-Pfad:
Ein Dokument mit einem noch UNAUFGELÖSTEN Link zum konfigurierten
Provider anlegen – z. B. per Copy-Paste eine nackte
`https://dev.azure.com/<org>/<projekt>/_workitems/edit/<id>`-URL (OHNE
den Link-Dialog zu benutzen) mitten in einen Absatz einfügen, Editor
öffnen falls nötig neu laden, dann OHNE JEDE weitere Änderung direkt
speichern. Erwartet: Anders als der sonstige No-op-Roundtrip (siehe
D5–D7) löst dieses Speichern JETZT einen Commit aus, die nackte URL im
Dokument wird zu einem sprechenden Linktitel aufgelöst. (b) Chat-Pfad:
Im Chat eine Notiz mit genau so einer nackten Provider-URL diktieren
(z. B. „Notiere: <URL> muss noch geprüft werden“). Erwartet: Nach der
Antwort zeigt das Dokument die URL ebenfalls als aufgelösten Link
(Titel statt roher URL) – die Auflösung passiert im Hintergrund, ohne
zusätzliche Nutzeraktion und ohne sichtbaren Fehlertext im Chat, selbst
wenn die Auflösung im Hintergrund scheitern sollte (dann bleibt die URL
schlicht unverändert stehen).

**D10 [VERBUNDEN] Kapitel im Editor (#-Knopf, Gliederungs-Leiste,
Roundtrip, v7.14).** Editor öffnen (Stift-Knopf). Erwartet: ein neuer
Toolbar-Knopf „Kapitel (#)“ (H1-Symbol) erscheint VOR dem
Abschnitts-Knopf (##). Rechts neben dem Editor-Bereich erscheint (NUR auf
Desktop-Breite; auf einem schmalen/mobilen Fenster fehlt sie bewusst –
kein Bug) eine schmale Gliederungs-Leiste in ähnlicher Breite wie die
Dokument-Leiste. Cursor in eine Zeile setzen (z. B. „QA-Kapitel Eins“
eintippen), „Kapitel (#)“ klicken. Erwartet: Die Zeile wird zu einer
großen Kapitel-Überschrift; in der Gliederungs-Leiste erscheint SOFORT ein
neuer, kräftig hervorgehobener Eintrag dafür. Darunter zwei `##`-Abschnitte
anlegen/vorhandene nutzen. Erwartet: Sie erscheinen in der Leiste
eingerückt unterhalb des Kapitel-Eintrags. Cursor an den Dokumentanfang
setzen, dann in der Leiste auf einen weiter unten stehenden Eintrag
klicken. Erwartet: Der Editor scrollt zur entsprechenden Überschrift, der
Cursor springt dorthin (direkt danach getippter Text erscheint an dieser
Stelle, nicht am alten Cursor-Ort). Speichern. Erwartet: neue Version in
der Historie, Dokument-Ansicht zeigt das neue Kapitel wie in C13
beschrieben. Editor OHNE JEDE weitere Änderung erneut öffnen und direkt
speichern. Erwartet: KEIN Commit/keine neue Version (No-op-Roundtrip, wie
bei D5–D7 für Formeln/Codeblöcke/Links) – die `#`-Kapitelzeile bleibt
byte-stabil erhalten.

**D11 [VERBUNDEN] Spitze Klammern und Et-Zeichen im Editor (v7.24
Bugfix).** Editor öffnen (Stift-Knopf), in einen NEUEN, eigenen
Stichpunkt tippen (Cursor zuerst ans Ende einer bestehenden Zeile setzen
und Enter drücken, NICHT mitten in eine bestehende Zeile klicken und dort
tippen – ein Klick mitten in fremden Text plus Tippen ist kein Testziel
dieses Falls): „a < b und Tom & Jerry sowie c > d“. Speichern. Erwartet:
Die Dokument-Ansicht zeigt GENAU diesen Text mit den echten Zeichen „<“,
„&“, „>“ – NICHT als „&lt;“/„&amp;“/„&gt;“. Editor erneut öffnen: Der
Text erscheint dort ebenfalls mit den echten Zeichen (Editor-interne
Anzeige war nie betroffen). Zusätzlich, falls im Dokument bereits ein
farbig markierter Textabschnitt existiert (z. B. aus einem früheren
Test): Prüfen, dass die Farbe weiterhin korrekt angezeigt wird (keine
Regression durch diesen Fix). Beobachtungspunkt (v7.27, Fix eines
inzidentellen 🟡-Fundes aus einem früheren Lauf dieses Falls, HEAD
e0102c9): Falls das bearbeitete Notizbuch frisch angelegt ist und seine
Inbox noch den Einladungstext „_Noch nichts erfasst. …_“ trägt – im
Editor erscheint dieser Platzhalter GAR NICHT mehr (weder les- noch
antippbar); ein versehentliches Tippen mitten in ihn (der ursprüngliche
Auslöser des Fundes) kann seitdem nicht mehr passieren.

**D12 [VERBUNDEN] AutoKorrektur beim Tippen im Editor (v7.25).** Editor
öffnen (Stift-Knopf), in einen neuen Stichpunkt tippen (Leerzeichen nach
jedem Trigger nicht vergessen, einige feuern erst danach): „Pfeil ->
Ziel, Gedanke -- weiter, Pfeil --> Ziel, (c) 2026, a <= b, 1/2 Becher,
Hi :) \alpha.“. Erwartet: Nach dem Tippen stehen dort die ECHTEN Symbole
„→“, „–“, „⟶“, „©“, „≤“, „½“, „😊“, „α“ (NICHT die roh getippten
Zeichenketten) – insbesondere „-->“ muss als „⟶“ erscheinen, NICHT als
„– >“ oder ein anderes kaputtes Zwischenergebnis (Ketten-Konflikt-Test).
Direkt nach einer Ersetzung (z. B. dem Pfeil) EINMAL Backspace drücken:
Erwartet, der getippte Originaltext („->“) erscheint wieder anstelle des
Symbols (Undo der Ersetzung, Word-Verhalten). Codeblock-Knopf, hinein
„->“ tippen: Erwartet bleibt buchstäblich „->“ stehen (keine Ersetzung
in Code). Speichern, Editor erneut öffnen: alle Symbole bleiben
unverändert stehen (Roundtrip). Danach in den Einstellungen (Zahnrad)
zum Abschnitt „AutoKorrektur (Editor)“ scrollen: Kategorie „Pfeile“
abwählen, Dialog schließen, Editor erneut öffnen, „->“ tippen – erwartet
KEINE Ersetzung mehr (Kategorie greift). Kategorie „Pfeile“ wieder
anhaken. Danach unter „Eigene Ersetzungen“ einen Trigger „qatest“ mit
Ersetzung „✅“ hinzufügen, Dialog schließen, Editor erneut öffnen, „Test
qatest Ende“ tippen – erwartet erscheint „✅“ anstelle von „qatest“
(eigene Ersetzung wirkt nach dem Neuöffnen). Eigene Ersetzung „qatest“
danach wieder löschen (Cleanup). Nicht speichern, Editor per „Abbrechen“
schließen (keine Test-Zeile im Dokument hinterlassen).

*Präzisierung nach v7.32-Lauf (Findings D12a/b/c, v7.33 Root-Cause-
Untersuchung, siehe DECISIONS #78):* Brüche und „<=“ feuern per Design erst
NACH einem zusätzlichen, direkt danach getippten Zeichen (Terminator –
Leerzeichen/Satzzeichen genügt), das ist KEIN Bug, sondern dieselbe
Terminator-Logik wie bei „--“/„<-“ (siehe AutoKorrektur-Kopfkommentar in
`src/lib/autocorrect.js`): „1/2 Becher“ bzw. „a <= b“ (jeweils MIT
Leerzeichen danach, wie oben in der Testzeile bereits vorgegeben) sind
gültige, vollständige Repros – „1/2“ bzw. „<=“ ALLEIN ohne folgendes Zeichen
zeigt erwartungsgemäß (noch) KEINE Ersetzung und ist kein Fehlschlag. Für
den Kategorie-Abwahl-Test (Pfeile) gilt zwingend die Reihenfolge „Dialog
schließen, Editor ERNEUT öffnen“ – ein bereits VOR der Abwahl geöffneter,
weiterhin offener Editor zieht die Änderung laut Hinweistext im Dialog
bewusst NICHT nach (kein Fehlschlag, wenn dort trotzdem weiter ersetzt
wird).

**D13 [VERBUNDEN] Kapitel/Abschnitte in der Gliederungs-Leiste per
Drag&Drop umsortieren (v7.26, NUR Editor/Desktop-Breite).** Editor öffnen
(Stift-Knopf), falls nötig zunächst wie in D10 zwei `#`-Kapitel mit je
mindestens einem `##`-Abschnitt anlegen (z. B. „QA-Kapitel Eins“ mit
„QA-Abschnitt A“, „QA-Kapitel Zwei“ mit „QA-Abschnitt B“) und einmal
speichern. Editor erneut öffnen. Erwartet: Jeder Eintrag in der
Gliederungs-Leiste zeigt links einen kleinen Ziehgriff (drei senkrechte
Punkte). Zuerst OHNE zu ziehen auf einen Eintrag klicken (neben dem
Griff): Erwartet wie bisher (D10) springt der Cursor zur Überschrift – der
Griff selbst löst KEINEN Sprung aus. Dann: Maustaste auf dem Griff von
„QA-Kapitel Zwei“ gedrückt halten und den Eintrag über „QA-Kapitel Eins“
ziehen. Erwartet: Der gezogene Eintrag wird während des Ziehens
halbtransparent, an gültigen Zwischenpositionen erscheint eine kurze
farbige Linie als Ablege-Anzeige; lässt man die Maustaste dort los, wo
die Linie VOR „QA-Kapitel Eins“ steht, tauschen die beiden Kapitel im
Dokument die Reihenfolge (Leiste zeigt sofort „QA-Kapitel Zwei“ oben).
Danach: Griff von „QA-Abschnitt A“ (jetzt im unteren Kapitel) gedrückt
halten und in das JEWEILS ANDERE Kapitel ziehen (kapitelübergreifend),
dort loslassen. Erwartet: Der Abschnitt erscheint in der Leiste
eingerückt unter dem NEUEN Kapitel. Speichern. Erwartet: neue Version in
der Historie, die Dokument-Ansicht zeigt exakt die per Ziehen erzeugte
Reihenfolge (Kapitel- und Abschnitts-Überschriften an der erwarteten
Stelle, Inhalte darunter vollständig und unverändert). Editor erneut
öffnen: Reihenfolge bleibt wie gespeichert. Danach eine WEITERE
Verschiebung durchführen, aber NICHT speichern, sondern „Abbrechen“
klicken: Editor erneut öffnen (oder Dokument-Ansicht ansehen) – erwartet
KEINE Änderung gegenüber dem letzten Speicherstand (Abbrechen verwirft
zuverlässig). Auf einem schmalen/mobilen Fenster: Gliederungs-Leiste
bleibt wie bisher (D10) ausgeblendet – kein Drag&Drop dort zu erwarten
(kein Bug).

**D14 [OFFEN] Absoluter Windows-Pfad wird automatisch zu einem
file:-Link (v7.31, Nutzer-Befund Live + Nutzerwunsch; Klick-Feedback
überarbeitet in v7.39).** Editor öffnen (Stift-Knopf, im QA-Notizbuch),
in einen Absatz eine Testzeile mit einem erfundenen absoluten
Windows-Pfad OHNE bestehenden Link tippen, z. B. „Beleg:
C:\Users\test\QA-Beleg.docx im Ordner.“ Speichern. Erwartet: In der
Dokument-Ansicht erscheint „QA-Beleg“ als unterstrichener, blauer Link
genau an der Stelle des Pfads (Linktext = Dateiname OHNE Endung), der
übrige Satz bleibt unverändert; KEIN hochgestelltes Fußnoten-Symbol.
Mit der Maus über den Link fahren: Tooltip zeigt den vollen Windows-Pfad
(Backslash-Form) an (der eigentliche Link-Href ist seit v7.36 NICHT mehr
menschenlesbar, siehe unten). Auf den Link klicken: erwartet erscheint
kurz ein Hinweis „wird geöffnet …“ direkt neben dem Link (verschwindet
nach ~1 s von selbst) – das gilt für einen Laufwerkspfad wie in diesem
Testfall IMMER, unabhängig vom Rest dieses Absatzes. **WICHTIG (v7.39):**
Es wird NICHTS mehr in die Zwischenablage kopiert – bis v7.38 kopierte
JEDER Klick zusätzlich den Windows-Pfad dorthin, das ist bewusst
ERSATZLOS entfernt (überschrieb sonst ungefragt den bisherigen
Zwischenablage-Inhalt des Nutzers), NICHT mehr prüfen/erwarten. Was der
Klick DARÜBER HINAUS auslöst, hängt seit v7.36 vom Testkanal ab:
- **Im eingebetteten Browser-Pane dieses Testlaufs:** Custom-Protocol-
  Navigation (`notizbuch-open:…`) löst dort grundsätzlich NICHTS aus,
  unabhängig vom Mechanismus – das ist KEIN Fehler und wird nicht als
  Finding gemeldet (siehe D14b für den Grund und den echten Testkanal).
- **Im echten Browser des Nutzers** (nicht Teil dieses automatisierten
  Laufs, siehe D14b): Der Klick navigiert direkt zur
  `notizbuch-open:v1?path=…`-Protokoll-URL – mit installiertem Handler
  öffnet sich die Datei im registrierten Programm, ohne installierten
  Handler zeigt der Browser eine eigene Fehlermeldung („keine App für
  dieses Protokoll“ o. Ä.); das „wird geöffnet …“-Feedback erscheint in
  BEIDEN Fällen (die App weiß clientseitig nicht, ob ein Handler
  installiert ist), es ist also KEIN verlässlicher Beleg für ein
  tatsächliches Öffnen.
Editor erneut öffnen: Der Link bleibt als echter, klickbarer Link
erhalten (kein Zerfall in eckige Klammern/Klartext) und lässt sich über
den Link-Knopf (Cursor hineinsetzen, Kettensymbol) als
„file:///C:/Users/test/QA-Beleg.docx“ im Popover ablesen (die im
Dokument gespeicherte Markdown-Syntax bleibt unverändert file:-basiert –
nur der beim Anzeigen gerenderte Link-Href wird zur Protokoll-URL
umgebaut, siehe D14b). Danach die Testzeile wieder entfernen und
speichern (Cleanup).

**D14c [OFFEN] Zitierter Windows-Pfad mit Leerzeichen wird ebenfalls
automatisch verlinkt (v7.37, Nutzer-Befund Live).** Windows liefert
einen Pfad bei „Als Pfad kopieren“ (Explorer, Umschalt+Rechtsklick) IN
doppelten Anführungszeichen – genau so fügt ein Nutzer ihn typischerweise
ein, und genau das erkannte D14 bisher NICHT (weder die Inline- noch die
Ganze-Zeile-Regel dort). Editor öffnen, eine Testzeile mit einem
erfundenen, IN ANFÜHRUNGSZEICHEN eingeschlossenen Pfad MIT Leerzeichen
tippen, z. B. `"C:\Users\test\QA Ordner\QA Beleg mit Leerzeichen.docx"`
(die Anführungszeichen gehören mit zur Testzeile). Speichern. Erwartet:
In der Dokument-Ansicht erscheint „QA Beleg mit Leerzeichen“ als
klickbarer Link – die Anführungszeichen sind dabei VERSCHWUNDEN (werden
beim Verlinken bewusst entfernt, siehe DECISIONS #79). Der übrige Test
(Tooltip, Klick-Verhalten, Editor-Roundtrip) läuft wie in D14. Danach
zusätzlich prüfen: derselbe Pfad OHNE Anführungszeichen, aber mit einem
kurzen (≤ 5 Wörter je Pfadsegment) Leerzeichen-Segment, allein auf einer
Zeile (z. B. „C:\Users\test\QA Ordner\QA Beleg.docx“), wird ebenfalls
verlinkt (bestehende Ganze-Zeile-Regel, D14 – kein neues Verhalten,
schadet aber nicht, das hier nochmal mitzuprüfen). Danach die Testzeile(n)
wieder entfernen und speichern (Cleanup).

**D14b [MANUELL] Protokoll-Klick öffnet die Datei im registrierten
Programm (v7.35, Mechanismus überarbeitet in v7.36, v7.37 UND v7.38).**
NICHT durch den Tester-Agenten ausführbar UND NICHT im eingebetteten
Browser-Pane dieses Testlaufs überprüfbar (siehe Markierungs-Legende
oben) – ein Klick auf eine `notizbuch-open:…`-Protokoll-URL löst dort
GRUNDSÄTZLICH nichts aus (Custom-Protocol-Navigation aus eingebetteten/
automatisierten Browser-Kontexten wird von Chromium unterbunden),
UNABHÄNGIG vom Mechanismus – ein Fehlschlag DORT ist also KEIN Hinweis
auf einen Fehler. Dieser Testfall gilt AUSSCHLIESSLICH im echten,
eigenständig geöffneten Browser des Nutzers (z. B. ein normales
Edge-/Chrome-Fenster, NICHT das Browser-Pane dieses Tools).
**DIAGNOSE-HINWEIS für künftige, ähnliche Fälle:** Ein Protokoll-Ziel,
dessen Registry-Befehl auf eine FRISCH SELBST KOMPILIERTE, dem Rechner
bis dahin unbekannte `.exe` zeigt, wurde auf einem Firmenrechner
nachweislich vom Endpoint-/Reputationsschutz still verworfen (kein
Dialog, kein Aufruf – selbst mit gültiger Signatur), obwohl ETABLIERTE
Binaries (`notepad.exe`, `node.exe`) als Ziel desselben Mechanismus
zuverlässig funktionierten – siehe DECISIONS #79 „Architektur-Wechsel
v7.38“ für die vollständigen Kontrollmessungen (inkl. der zwischenzeitlich
widerlegten Hypothese „Chrome blockiert Skript-Interpreter“). Seit v7.38
zeigt die Registry deshalb DIREKT auf `node.exe` (beim Nutzer bereits
vorhanden) mit `notizbuch-open.js` als Argument – KEIN eigens
kompilierter Launcher, KEIN PowerShell-Handler mehr.
Voraussetzung ist eine EINMALIGE, lokale Einrichtung durch den Nutzer
selbst: `notizbuch-app/tools/notizbuch-open-setup.ps1` einmal per
PowerShell auf dem Testrechner ausführen (Node.js muss dafür bereits
installiert sein – das Setup löst `node.exe` über PATH bzw. Standard-
Installationspfade auf und bricht mit einer klaren Meldung ab, falls
nichts gefunden wird, BEVOR irgendetwas geschrieben wird; registriert
`notizbuch-open:` NUR unter HKCU, keine Adminrechte nötig; `-Uninstall`
entfernt die Installation UND jeden Altbestand einer früheren v7.35-
v7.37-Installation wieder rückstandsfrei). **Wer bereits eine ÄLTERE
Version installiert hatte, MUSS das Setup erneut ausführen** – sonst
zeigt die Registry weiterhin auf den nicht mehr gepflegten alten
Launcher/Handler.
Danach wie in D14 einen file:-Link mit einem TATSÄCHLICH existierenden
Testpfad erzeugen (z. B. eine echte, harmlose Datei wie eine `.txt`) und
im echten Browser anklicken. Erwartet (Mechanismus seit v7.36: der
gerenderte Link-Href IST direkt die `notizbuch-open:v1?path=…`-Protokoll-
URL, ein normaler Linkklick navigiert also direkt dorthin; Windows ruft
dafür `node.exe notizbuch-open.js "<URL>"` auf, das Skript öffnet die
Datei anschließend selbst über `explorer.exe` – dieselbe Doppelklick-
Semantik wie zuvor `Invoke-Item`): Der Browser fragt beim ALLERERSTEN
Klick einmalig, ob „notizbuch-open“-Links geöffnet werden dürfen
(Bestätigen); danach öffnet sich die Datei im dafür unter Windows
registrierten Programm – genau wie ein Explorer-Doppelklick. **Seit
v7.39 GEÄNDERT:** Es wird NICHTS mehr in die Zwischenablage kopiert (das
frühere Clipboard-Copy-Verhalten war der Rückfallweg aus der Zeit, in
der der Protokollstart noch nicht funktionierte – ERSATZLOS entfernt,
siehe DECISIONS #79 „Zwischenablage-Kopie entfernt (v7.39)“); NICHT mehr
prüfen/erwarten.
**Ohne installierten Handler** (nicht Teil dieses Testfalls, aber gut zu
kennen): der Browser zeigt jetzt eine EIGENE Fehlermeldung („Für dieses
Protokoll ist keine Anwendung verknüpft“ o. Ä.) statt still nichts zu
tun – bewusst in Kauf genommen (siehe DECISIONS #79); seit v7.39 gibt es
in diesem Fall KEINEN Rückfallweg mehr in der App selbst (nur noch der
Tooltip mit dem vollen Pfad). Der Handler öffnet automatisch NUR
Dateitypen von einer festen Positivliste gängiger Dokument-/Medien-
formate (u. a. `.pdf`, `.txt`, `.docx`, `.png`, `.mp3` – siehe
`tools/notizbuch-open.js`, `ALLOWED_EXTENSIONS`, für die vollständige
Liste); der Test-Pfad oben sollte deshalb bewusst eine `.txt`-Datei sein.
Ein Link auf eine NICHT existierende Datei oder mit einer NICHT auf
dieser Liste stehenden Endung (z. B. `.exe`, aber auch harmlos wirkende,
nur noch nicht gelistete Formate) wird OHNE sichtbares Feedback
abgelehnt (seit v7.38 KEINE MessageBox mehr, nur ein Log-Eintrag in
`%LOCALAPPDATA%\NotizbuchOpen\notizbuch-open.log` – bewusste
Einschränkung, siehe DECISIONS #79; für den Testfall selbst bedeutet
das: „gar nichts passiert“ ist bei einer ABGELEHNTEN Datei jetzt das
ERWARTETE Verhalten, kein Fehlerbild – seit v7.39 KEIN Zwischenablage-
Trost mehr). Bekannte Grenze (KEIN Fehler, falls beobachtet): Ein sehr
langer Pfad (deutlich über der Windows-`MAX_PATH`-Grenze von 260
Zeichen, insbesondere mit vielen Leerzeichen/Umlauten) wird ab einer
bestimmten Länge NICHT mehr als file:-Link erkannt (Cap in
`FILE_URL_SRC`, `src/lib/filelinks.js`, Begründung dort) – für normale
Testpfade ohne extreme Länge irrelevant.
Danach `-Uninstall` ausführen, falls die Einrichtung nur für diesen
Testlauf vorgenommen wurde (Cleanup, sonst bleibt sie bestehen).

**D15 [VERBUNDEN] Einzug im Editor per Knopf und Tastatur (v7.41,
Nutzerwunsch „Icons wie in Excel“; Doku in v7.41.1 an das reale, bewusst
gewollte Verhalten angepasst, siehe DECISIONS #83).** Editor öffnen
(Stift-Knopf), im QA-Notizbuch einen neuen Stichpunkt „QA-Einzug A“
anlegen. Erwartet: zwei neue Toolbar-Knöpfe neben den Listen-Knöpfen
(Pfeil-Symbole „Einzug verkleinern“/„Einzug vergrößern“); der Knopf
„Einzug verkleinern“ ist ausgegraut/deaktiviert (der Absatz ist noch nicht
eingerückt). Cursor in „QA-Einzug A“ setzen, „Einzug vergrößern“ mehrfach
klicken. Erwartet: Der Absatz rückt bei jedem Klick sichtbar weiter nach
rechts; nach 6 Klicks ist der Knopf „Einzug vergrößern“ ausgegraut
(Obergrenze erreicht), ein 7. Klick tut nichts mehr. **Diese 6-Klicks-
Obergrenze gilt AUSDRÜCKLICH NUR für einen freistehenden Absatz/ein
Bild/eine Formel** (das `indent`-Attribut ist auf 0–6 geklemmt) – für
einen LISTENPUNKT (Stichpunkt/Nummerierung/Checkbox) gibt es KEINE
Tiefenbegrenzung, siehe unten. Danach mit „Einzug verkleinern“ (oder
Umschalt+Tab) wieder auf 0 zurückstellen – bei 0 ist „Einzug verkleinern“
wieder ausgegraut. Cursor erneut in den Absatz setzen und EINMAL `Tab`
drücken: Erwartet, der Absatz rückt genau wie beim Knopf-Klick eine Ebene
ein (gleiche Wirkung). `Umschalt+Tab` macht das rückgängig. Cursor in eine
Überschrift (`##`) setzen, `Tab` drücken: Erwartet KEINE inhaltliche
Änderung (Überschriften werden nie eingerückt) – **der Tastendruck wird
aber geschluckt** (v7.41.1-Nachbesserung, DECISIONS #83, Finding 5): Der
Tastaturfokus bleibt im Editor, statt (wie vor v7.41.1) über den
Browser-Standard aus dem Editor herauszuspringen. `Umschalt+Tab` verhält
sich in der Überschrift symmetrisch (ebenfalls geschluckt, kein
Fokusverlust). Speichern. Erwartet: neue Version in der Historie. Editor
OHNE JEDE weitere Änderung erneut öffnen und direkt speichern. Erwartet:
KEIN Commit/keine neue Version (No-op-Roundtrip, wie bei D5–D10).
Zusätzlich (Tastatur-Priorität, siehe DECISIONS #81): Cursor in eine
Zelle einer Tabelle setzen (bei Bedarf vorher wie in D2 eine kleine
Tabelle anlegen) und `Tab` drücken. Erwartet: Der Cursor springt wie
gewohnt zur nächsten Zelle (unverändertes Bestandsverhalten) – KEINE
Einrückung findet an der Tabelle statt. Danach denselben Zellen-Inhalt
per Überschrift-Knopf zu einer Überschrift machen (v7.41.2-Nachbesserung,
DECISIONS #84) und erneut `Tab` drücken: Erwartet weiterhin, der Cursor
springt zur nächsten Zelle (bzw. legt in der letzten Zelle eine neue
Zeile an) – NICHT wie vor diesem Fix ein wirkungsloses, geschlucktes
`Tab` (die Überschrift-Sonderbehandlung aus D15 gilt ausdrücklich nur für
eine Überschrift auf oberster Ebene, nicht innerhalb einer Tabellenzelle).

**D15c [VERBUNDEN] „Einzug verkleinern“ bei einem Listenpunkt auf
Ebene 0 hebt ihn aus der Liste – GEWOLLTES Verhalten, nicht ausgegraut
(v7.41.1, DECISIONS #83, Finding 3).** Editor öffnen, einen NICHT
eingerückten Stichpunkt anlegen, z. B. „QA-Einzug Liste“. Cursor
hineinsetzen. Erwartet: „Einzug verkleinern“ ist AKTIV (nicht ausgegraut)
– anders als bei einem freistehenden Absatz auf Ebene 0 (siehe D15).
Klicken (oder `Umschalt+Tab`). Erwartet: „QA-Einzug Liste“ wird zu einem
normalen Absatz, die Aufzählung geht verloren – exakt das aus Word
bekannte Verhalten „Listenpunkt aus der Liste heben“, kein Fehler.
Danach eine tiefe Verschachtelung anlegen (einen Stichpunkt per `Tab`
mehr als 6-mal hintereinander unter sich selbst verschachteln lassen,
z. B. durch wiederholtes Anlegen+Einrücken mehrerer Unterpunkte
untereinander): Erwartet, der Knopf „Einzug vergrößern“ graut dabei NIE
aus (im Gegensatz zur 6-Klicks-Grenze bei einem Absatz/Bild aus D15) –
die strukturelle Listen-Tiefe ist bewusst unbegrenzt.

**D15b [VERBUNDEN] Checklisten-Einzug per Tastatur (v7.41).** Editor
öffnen, eine Checkliste mit zwei Punkten anlegen: „QA-Check A“, „QA-Check
B“. Cursor in „QA-Check B“ setzen, `Tab` drücken. Erwartet: „QA-Check B“
rückt unter „QA-Check A“ ein (Checklisten sind jetzt verschachtelbar,
siehe D17). `Umschalt+Tab` macht das rückgängig. Hebt ein `Umschalt+Tab`
einen Unterpunkt aus einer GEMISCHT verschachtelten Checkliste heraus
(Checkbox-Elternpunkt mit einfachen Aufzählungs-Kindern oder umgekehrt):
Erwartet seit v7.41.1 (DECISIONS #83) KEINE Leerzeilen-Normalisierung
mehr beim nächsten Öffnen+Speichern – das in DECISIONS #81/Finding C
dokumentierte Restrisiko wurde als Nebeneffekt der Blocker-2-Korrektur
vollständig behoben, der Roundtrip bleibt ab dem ERSTEN Zyklus stabil.

**D16 [VERBUNDEN] Einzug über eine Mehrfachauswahl (v7.41, Wortlaut nach
Code-Review präzisiert – siehe DECISIONS #81 „bewusst akzeptierte
Grenze“).** Editor öffnen, drei aufeinanderfolgende Stichpunkte anlegen:
„QA-Mehrfach eins“, „QA-Mehrfach zwei“, „QA-Mehrfach drei“ (normale
Aufzählung, kein Checklisten-Punkt). Mit der Maus NUR die ZWEITE und
DRITTE Zeile markieren (Auswahl beginnt in „QA-Mehrfach zwei“, endet in
„QA-Mehrfach drei“ – bewusst NICHT die ganze Liste, siehe unten) und
„Einzug vergrößern“ klicken. Erwartet: BEIDE markierten Punkte rücken
gemeinsam eine Ebene ein (nicht nur der, in dem der Cursor zuletzt
stand), „QA-Mehrfach eins“ bleibt unverändert auf der obersten Ebene.
Einmal „Rückgängig“ (Undo-Knopf oder Strg+Z) drücken. Erwartet: Beide
Punkte springen in EINEM Schritt wieder auf ihre ursprüngliche Ebene
zurück (ein einziger Undo-Schritt für die ganze Auswahl, nicht zwei
einzelne). Danach die GESAMTE Liste markieren (alle drei Punkte,
Auswahl beginnt bereits im ERSTEN Punkt) und „Einzug vergrößern“
anschauen: Erwartet, der Knopf ist ausgegraut/deaktiviert, ein Klick
(falls dennoch möglich) ändert NICHTS. **Das ist kein Bug**: Eine
komplette Liste (bzw. jede Auswahl, die beim ERSTEN Punkt einer Liste
beginnt) lässt sich strukturell nicht weiter einrücken, es gibt keinen
„Vorgänger“, unter den der erste Punkt sinken könnte – exakt dieselbe
Grenze wie beim einzelnen ersten Listenpunkt (siehe D15). Danach eine
Auswahl aufziehen, die von einem normalen Absatz bis IN den ERSTEN
Punkt einer direkt folgenden Aufzählung hineinreicht (z. B. ein
Fließtext-Absatz direkt über „QA-Mehrfach eins“, Auswahl endet in
dessen Zeile). „Einzug vergrößern“ klicken. Erwartet: NUR der Absatz
rückt ein, die Liste bleibt unverändert (der erste Listenpunkt kann
nicht einrücken, siehe oben – nur der Absatz-Teil der Auswahl ist
betroffen). Speichern, Editor erneut öffnen und direkt speichern: KEIN
Commit (No-op-Roundtrip).

**D17 [VERBUNDEN] Checklisten-Verschachtelung, Listentyp eines
verschachtelten Kindpunkts wechseln, Bild+Bildunterschrift einrücken,
Anzeige in der Dokument-Ansicht (v7.41, der konkrete Nutzer-Fall; v7.41.1
korrigiert zwei dabei gefundene Blocker, siehe DECISIONS #83).** Editor
öffnen, eine Checkliste mit EINEM Punkt anlegen, z. B. „QA-Checkliste
Eltern“. Direkt danach (Enter, dann Tab) einen Unterpunkt „QA-Checkliste
Kind eins“ eintippen. Erwartet: Der Unterpunkt lässt sich per `Tab` UNTER
den Checkbox-Punkt einrücken (vorher, ohne diesen Auftrag, war eine
Checkliste im Editor gar nicht verschachtelbar). Noch einen zweiten
Unterpunkt „QA-Checkliste Kind zwei“ auf derselben Ebene ergänzen.
Danach den Listentyp DES ZWEITEN Unterpunkts („Kind zwei“) ändern
(Aufzähl-Knopf statt Checkliste). Erwartet (🔴 Blocker 2, v7.41.1 behoben):
„QA-Checkliste Eltern“ bleibt eine ECHTE Checkbox, „QA-Checkliste Kind
eins“ bleibt eine verschachtelte CHECKBOX, NUR „QA-Checkliste Kind zwei“
wird zu einem verschachtelten, einfachen Aufzählungspunkt OHNE eigene
Checkbox – NICHT (wie vor dem Fix beobachtet) drei getrennte,
unverschachtelte Top-Level-Einträge. Speichern. Erwartet in der
Dokument-Ansicht: Beide Unterpunkte erscheinen SICHTBAR eingerückt UNTER
dem Checkbox-Elternpunkt (nicht bündig auf derselben Ebene). Editor OHNE
weitere Änderung erneut öffnen und direkt speichern: KEIN Commit
(No-op-Roundtrip – insbesondere darf aus den eingerückten Unterpunkten
KEINE zusätzliche Leerzeile zwischen Elternpunkt und Unterpunkten
entstehen und die Ansicht darf sich dadurch nicht ändern). Danach ein
Bild einfügen (Chat: ein Bild anhängen und per Op ins Dokument einfügen
lassen, oder ein bereits vorhandenes Bild im QA-Notizbuch verwenden) und
direkt darunter eine kursive Bildunterschrift eintippen. Beide Zeilen
(Bild + Bildunterschrift) MIT DER MAUS markieren – **wichtig für den
Nachweis von Blocker 1: Klick an das ENDE der Zeile VOR dem Bild** (also
z. B. ans Ende von „QA-Checkliste Kind zwei“, NICHT auf das Bild selbst),
dann mit gehaltener Umschalt-Taste ans Ende der Bildunterschrift klicken
– und „Einzug vergrößern“ klicken. Erwartet (🔴 Blocker 1, v7.41.1
behoben): Bild UND Bildunterschrift erscheinen NACH dem Speichern in der
Ansicht GEMEINSAM eingerückt (gleicher Versatz nach rechts) – NICHT (wie
vor dem Fix beobachtet) nur die Bildunterschrift, während das Bild bündig
bleibt. „QA-Checkliste Kind zwei“ selbst bleibt dabei unverändert auf
seiner bisherigen Ebene (keine zusätzliche, ungewollte Verschachtelung
als Nebeneffekt). Editor erneut öffnen: Bild und Bildunterschrift zeigen
weiterhin denselben Einzug (Roundtrip-stabil), erneutes Speichern ohne
Änderung löst KEINEN Commit aus. Das in DECISIONS #81/Finding C
dokumentierte Restrisiko (Leerzeilen-Normalisierung nach einem
`Umschalt+Tab` aus einer gemischten Checkliste heraus) ist seit v7.41.1
vollständig behoben (siehe D15b) – hier also KEIN Restrisiko mehr zu
erwarten.

GEWOLLTE Über-Dehnung der Markierung (v7.41.1, KEIN Fehler – nicht als
Finding melden): Markiert man NUR die Bildunterschrift und rückt ein,
wird das direkt darüberstehende Bild MIT eingerückt; markiert man NUR
die Zeile ÜBER dem Bild, wird das Bild darunter mit eingerückt. Das ist
unvermeidbar: Der Browser normalisiert eine Mausauswahl, die an einer
Blockgrenze neben einem Bild beginnt oder endet, auf die nächste
Textposition – „Bild + Unterschrift“ und „nur Unterschrift“ ergeben
danach exakt dieselbe Auswahl, sie sind technisch nicht unterscheidbar.
Die Auflösung ist bewusst zugunsten des Nutzer-Falls (Bild wird mit
eingerückt) gewählt, siehe DECISIONS #83.

**D17b [VERBUNDEN] Grenzfall der Listentyp-Umwandlung: ERSTEN Kindpunkt
umwandeln funktioniert jetzt (v7.41.2 – bis v7.41.1 ein bewusster No-op,
seit der Geister-Checkbox-Korrektur ersatzlos behoben, siehe DECISIONS
#83/#84).** Direkt im Anschluss an D17 (oder erneut mit einer frischen
Checkliste „QA-Checkliste Eltern2“ + zwei Checklisten-Unterpunkten
„Kind A“/„Kind B“): Diesmal den Listentyp des ERSTEN Unterpunkts
(„Kind A“ bzw. „QA-Checkliste Kind eins“) ändern (Aufzähl-Knopf), während
der ZWEITE Unterpunkt eine Checkliste bleibt. Erwartet: „Kind A“ wird zu
einem verschachtelten, einfachen Aufzählungspunkt OHNE eigene Checkbox,
„Kind B“ bleibt eine verschachtelte CHECKBOX, der Elternpunkt bleibt
unverändert eine ECHTE Checkbox. Speichern. Erwartet in der Dokument-
Ansicht: Die Struktur zeigt genau diese drei Zeilen, INSBESONDERE OHNE
eine zusätzliche, leere Checkbox irgendwo im Dokument (die „Geister-
Checkbox“, siehe D19 – genau das war die zugrunde liegende Lücke, gegen
die der frühere No-op absicherte). Editor OHNE weitere Änderung erneut
öffnen und direkt speichern: KEIN Commit (No-op-Roundtrip).

Dieselbe Umwandlung funktioniert jetzt AUCH ohne jede Verschachtelung,
überall dort, wo der umgewandelte Punkt VOR einem Punkt steht, der
Checkliste bleibt (bzw. umgekehrt) – konkret geprüfte Fälle (Toolbar-Klick
konvertiert jetzt jeweils sichtbar, KEIN No-op mehr): in `- Eins` /
`- Zwei` den ZWEITEN Punkt zur Checkliste machen; dasselbe bei drei
Punkten mit dem mittleren; dasselbe in einer nummerierten Liste (Ziel
Checkliste); und in `- [ ] A` / `- [ ] B` den ERSTEN Punkt zur Aufzählung
machen. Erwartet in JEDEM dieser Fälle: die Umwandlung greift sofort
sichtbar, das Dokument bleibt nach dem Speichern UND nach erneutem
Öffnen+Speichern ohne weitere Änderung stabil (kein Commit, keine
zusätzliche leere Checkbox). Sollte einer dieser Fälle stattdessen
sichtbar NICHTS tun oder beim erneuten Öffnen eine leere Checkbox zeigen,
ist DAS jetzt als Finding zu melden (umgekehrt zur v7.41.1-Doku dieses
Falls).

**D18 [VERBUNDEN] Bild direkt in den Editor einfügen (v7.41 Teil B,
Nutzerwunsch „Ich würde gerne Bilder direkt in den Editor kopieren
können. Das geht auch, aber ich kann es nicht speichern.“).** Editor
öffnen (Stift-Knopf). Neuer Toolbar-Knopf „Bild einfügen“ (Bild-Symbol,
zwischen Trennlinie und Formel-Knöpfen). Klicken öffnet einen
Dateiauswahl-Dialog; ein kleines Testbild auswählen (JPG/PNG, notfalls
per Screenshot-Tool selbst erzeugen). Erwartet: kurz „Bild wird
hochgeladen …“ (Spinner) unter dem Editor, „Speichern“ ist währenddessen
ausgegraut/deaktiviert. Nach Abschluss steht das Bild sichtbar an der
Cursor-Position im Editor. Speichern klicken. Erwartet: KEINE rote
Fehlermeldung („Bild ohne Referenz“ o. ä.), neue Version in der Historie.
Editor erneut öffnen (oder Seite neu laden): Das Bild ist weiterhin da
(dauerhaft im Daten-Repo abgelegt, keine tote Referenz). Falls die
Testumgebung das Einfügen eines Bildes aus der Zwischenablage per
Strg+V unterstützt (z. B. ein zuvor per Screenshot-Tool kopiertes Bild):
gleiches Bild zusätzlich per Strg+V einfügen – gleiches erwartetes
Ergebnis. Zwei Bilder auf einmal auswählen (Mehrfachauswahl im
Dateidialog): Erwartet, beide erscheinen nacheinander im Dokument.

**D18b [OFFEN] Bild einfügen ohne Verbindung.** Ohne verbundene
Zugangsdaten ein Notizbuch öffnen (der Editor lässt sich auch ohne
Verbindung öffnen) und über den neuen „Bild einfügen“-Knopf ein Bild
auswählen. Erwartet: klare Fehlermeldung („Nicht verbunden – ein
eingefügtes Bild kann nicht dauerhaft gespeichert werden.“), KEIN Bild
erscheint im Dokument, der restliche Text bleibt unverändert
bearbeitbar. „Speichern“ funktioniert für bereits vorhandenen Text
weiterhin normal (die abgelehnte Bild-Aktion blockiert nichts anderes).

**D18c [VERBUNDEN] Normales Einfügen (Text/Link) bleibt unverändert.**
Editor öffnen. Einen Fließtext OHNE URL aus einer anderen Quelle
kopieren und per Strg+V einfügen. Erwartet: Text erscheint unverändert,
keine Bild-bezogene Meldung. Danach einen Text mit einer http(s)-URL
(z. B. „Siehe https://example.com“) einfügen. Erwartet: unverändertes
Verhalten wie vor diesem Auftrag – die URL wird automatisch verlinkt
(siehe D14), keine Bild-bezogene Meldung erscheint.

**D18d [OFFEN] Von einer Webseite kopiertes Bild wird sauber
abgelehnt, begleitender Text bleibt aber erhalten (bewusste Grenze für
das Bild selbst, siehe DECISIONS – der Text-Verlust war ein Bug, siehe
Code-Review-Fix Finding 4).** Best effort, je nach Browser/Kopierquelle
ggf. nicht zuverlässig reproduzierbar (als ÜBERSPRUNGEN melden, falls
nicht nachstellbar): In einem Browser-Tab eine Webseite mit einem
Absatz suchen, der neben Fließtext auch ein eingebettetes Bild/Icon
enthält (z. B. ein Logo mitten im Text), diesen GESAMTEN Absatz per
Rich-Text-Auswahl (Text + Bild gemeinsam markieren, NICHT „Bild
kopieren“ per Rechtsklick) kopieren und im Editor einfügen. Erwartet:
klare Fehlermeldung, dass von einer Webseite kopierte Bilder nicht
direkt übernommen werden können; KEIN kaputter `https://…`-Bildlink
landet im gespeicherten Dokument; der TEXT des Absatzes (vor UND nach
der Bild-Stelle) erscheint aber trotzdem im Editor – ein Paste darf
NIE den kompletten Ausschnitt verwerfen, nur weil irgendwo ein nicht
übernehmbares Bild darin vorkommt. Speichern, Editor erneut öffnen:
Text bleibt erhalten, kein Bildlink im Dokument.

**D19 [VERBUNDEN] Geister-Checkbox: Stichpunktliste gefolgt von einer
Checkliste (v7.41.2, ECHTER Bug, ÄLTER als v7.41, jetzt behoben – siehe
DECISIONS #84).** Editor öffnen, eine GEWÖHNLICHE Stichpunktliste mit
zwei Punkten anlegen („QA-Geister eins“, „QA-Geister zwei“), direkt
darunter (OHNE Leerzeile) eine Checkliste mit zwei Punkten anlegen
(„QA-Geister Aufgabe A“, „QA-Geister Aufgabe B“). Speichern. Erwartet in
der Dokument-Ansicht: GENAU die vier eingegebenen Zeilen – KEINE
zusätzliche, leere Checkbox VOR der Stichpunktliste (das war der Bug:
eine sichtbare leere Checkbox ohne jeden Text). Editor erneut öffnen:
ebenfalls keine leere Checkbox sichtbar, direkt wieder schließen löst
keinen Commit aus (No-op-Roundtrip). Jetzt eine Bearbeitung an GANZ
ANDERER Stelle im Dokument vornehmen (z. B. eine Überschrift umbenennen
oder in einem anderen Abschnitt einen Satz ergänzen – NICHT die beiden
Listen selbst anfassen) und speichern. Erwartet: weiterhin keine leere
Checkbox, „QA-Geister eins/zwei“ und „QA-Geister Aufgabe A/B“ unverändert.
Diesen Zyklus (Editor öffnen, Änderung an anderer Stelle, speichern) noch
DREI weitere Male wiederholen (insgesamt vier Zyklen). Erwartet: Nach
JEDEM der vier Zyklen ist die Stichpunkt-/Checklisten-Struktur
unverändert und zu KEINEM Zeitpunkt erscheint eine leere Checkbox (der
frühere Bug hätte hier nach dem 1./2./3./4. Zyklus ein/zwei/drei/vier
leere Kästchen erzeugt, die sich zusätzlich bei jedem weiteren Speichern
mitcommittet hätten). Falls die Testumgebung ein Notizbuch mit einem
Marker-Wechsel unterstützt: probeweise die Stichpunktliste mit `*` statt
`-` beginnen lassen (z. B. über die Markdown-Quelle, falls zugänglich) –
auch hier darf über mehrere Speicherzyklen hinweg keine leere Checkbox
entstehen.

**D19-Nachtrag [VERBUNDEN] Bewusst LEER angelegte Checkbox bleibt an JEDER
Position dauerhaft eine Checkbox (v7.45, ECHTER Bug, jetzt behoben – siehe
DECISIONS #91).** Anderer Bug als oben (dort: eine leere Checkbox ENTSTAND
ungewollt VOR einer Liste; hier: eine ABSICHTLICH leer gelassene Checkbox
degradierte beim erneuten Laden zu bedeutungslosem Literaltext). Editor
öffnen, eine Checkliste mit mehreren Text-Punkten anlegen
(„QA-Leer eins“, „QA-Leer zwei“, „QA-Leer drei“), dazwischen UND danach
gezielt drei bewusst leere Punkte einfügen (Enter drücken, aber NICHTS
eintippen):
- einen LEEREN Punkt MITTEN in der Liste (z. B. zwischen „QA-Leer eins“
  und „QA-Leer zwei“),
- einen LEEREN Punkt als VERSCHACHTELTEN Unterpunkt (Tab drücken, um ihn
  einzurücken, z. B. unter „QA-Leer zwei“),
- einen LEEREN Punkt als LETZTEN Punkt der gesamten Liste/des Dokuments
  (nichts folgt mehr danach).

Speichern, Seite neu laden. Erwartet in der Dokument-Ansicht: ALLE DREI
leeren Punkte erscheinen weiterhin als echte, leere Checkboxen – NICHT als
normaler Aufzählungspunkt mit dem sichtbaren Text „[ ]“ (das war das
gemeldete Symptom, besonders auffällig beim LETZTEN Punkt). Editor erneut
öffnen (OHNE jede Änderung): alle drei leeren Punkte erscheinen weiterhin
als Checkboxen im Editor selbst (nicht als literaler Text „[ ]“ in einem
normalen Aufzählungspunkt) – schließen löst keinen Commit aus
(No-op-Roundtrip). Jetzt eine Bearbeitung an GANZ ANDERER Stelle im
Dokument vornehmen (z. B. „QA-Leer eins“ in „QA-Leer eins geändert“
umbenennen) und speichern. Erwartet: alle drei leeren Checkboxen bleiben
weiterhin Checkboxen. Diesen Zyklus (Editor öffnen, Änderung an anderer
Stelle, speichern) noch ZWEI weitere Male wiederholen (insgesamt drei
Zyklen) – nach JEDEM Zyklus müssen alle drei leeren Punkte weiterhin
Checkboxen sein (der frühere Bug hätte hier bereits nach dem ERSTEN
erneuten Öffnen alle drei in Literaltext verwandelt, und ab dem nächsten
Speichern wäre das dauerhaft im Daten-Repo persistiert gewesen). Zusätzlich
eine bereits ERLEDIGTE, aber leere Checkbox anlegen (Häkchen setzen, ohne
je Text einzutippen) und denselben Zyklus einmal durchlaufen: bleibt
ebenfalls dauerhaft angehakt UND leer, statt zu einem angehakten Symbol
als Literaltext zu werden.

**D19-Nachtrag 2 [VERBUNDEN] Ein leerer ERSTER Punkt einer Checkliste
bleibt ebenfalls erhalten (v7.45.1, Review-Nachbesserung zu D19-Nachtrag –
siehe DECISIONS #92).** Editor öffnen, per Toolbar-Knopf „Checkliste“ eine
neue Checkliste beginnen, den ALLERERSTEN Punkt bewusst LEER lassen (Enter
drücken, ohne Text einzutippen), direkt danach einen zweiten Punkt mit
Text füllen („QA-LeerErst zwei“). Speichern, Seite neu laden. Erwartet:
Der erste Punkt bleibt eine leere Checkbox (nicht verschwunden, nicht
Literaltext). Editor erneut öffnen und OHNE Änderung schließen: kein
Commit (No-op-Roundtrip). Wiederholen für:
- den leeren ersten Punkt als EINZIGEN Punkt eines ganzen Abschnitts
  (Checkliste anlegen, sofort wieder verlassen, ohne einen zweiten Punkt
  anzulegen) – bleibt nach Speichern/Neuladen weiterhin eine leere
  Checkbox, verschwindet NICHT (auch nicht nach mehrfachem erneuten Öffnen
  ohne Änderung),
- einen leeren ersten Punkt einer VERSCHACHTELTEN Unterliste (Checkbox-
  Elternpunkt mit Text, darunter per Tab eingerückt ein neuer, leer
  gelassener erster Unterpunkt, danach ein zweiter, ausgefüllter
  Unterpunkt) – bleibt ebenfalls über mehrere Speicherzyklen hinweg
  erhalten.

GEWOLLTE Nebenwirkung (v7.41.2, KEIN Fehler – nicht als Finding melden):
Steht in einer Liste, die (an anderer Stelle) eine Checkliste enthält,
eine bewusste Leerzeile zwischen zwei NICHT-Checklisten-Punkten (z. B.
„QA-Geister eins“ / Leerzeile / „QA-Geister zwei“, danach erst die
Checkliste), verschwindet diese Leerzeile beim ERSTEN Speichern und die
beiden Punkte rücken sichtbar zusammen (DocView rendert eine lose Liste
als getrennte `<ul>`-Blöcke mit sichtbarem Abstand – der Nutzer sieht den
Wegfall also tatsächlich). Das ist der bewusst in Kauf genommene Kompromiss
der zugrunde liegenden Korrektur (siehe DECISIONS #84, „geerbte
Lockerheit“) und kein Bug. Eine reine Stichpunktliste OHNE jede Checkliste
im selben Dokument ist davon NICHT betroffen – dort bleibt eine bewusste
Leerzeile zwischen zwei Punkten unverändert erhalten.

**D20 [VERBUNDEN] Toolbar-Knopf klicken und SOFORT weitertippen landet an
der richtigen Stelle (v7.41.3, ECHTER Bug, Bestandsverhalten seit dem
Editor-Grundgerüst v4.1, jetzt behoben – siehe DECISIONS #85).** Für
JEDEN der folgenden Fälle gilt: Knopf anklicken OHNE vorher zurück in den
Editor-Text zu klicken, dann OHNE Pause weitertippen.
- **Liste/Checkliste (exaktes Tester-Repro):** Stichpunktliste anlegen
  („QA-Fokus eins“, Enter, „QA-Fokus zwei“), Enter → neuer leerer dritter
  Stichpunkt. Toolbar-Knopf „Checkliste“ anklicken, sofort
  „QA-Fokus Aufgabe A“ tippen, Enter, „QA-Fokus Aufgabe B“ tippen.
  Erwartet: „QA-Fokus eins“/„QA-Fokus zwei“ bleiben als Stichpunkte
  unverändert stehen, „QA-Fokus Aufgabe A“ und „QA-Fokus Aufgabe B“
  erscheinen darunter als ZWEI neue, LEERE Checklisten-Einträge (nicht an
  „QA-Fokus zwei“ angehängt, keine zusätzliche falsche Aufzählungszeile).
- **Formatierung:** Cursor ans Ende eines Absatzes setzen, „Fett“-Knopf
  anklicken, sofort weitertippen. Erwartet: Der neu getippte Text
  erscheint FETT direkt an der Cursorposition (nicht irgendwo anders im
  Dokument).
- **Überschrift:** Cursor in einen leeren Absatz am Dokumentende setzen,
  „Kapitel (#)“-Knopf anklicken, sofort einen Kapiteltitel tippen.
  Erwartet: Der getippte Text erscheint als NEUES Kapitel genau an dieser
  Stelle.
- **Einzug:** Einen zweiten, bereits eingerückten Listenpunkt anlegen,
  Cursor am Ende dieses Punkts belassen, „Einzug verkleinern“ anklicken,
  sofort weitertippen. Erwartet: Der getippte Text hängt an GENAU diesem
  (jetzt weniger eingerückten) Punkt, nicht an einem anderen.
- **Tabelle über das Größen-Raster:** Cursor in einen leeren Absatz am
  Dokumentende setzen, „Tabelle einfügen“ anklicken, im aufklappenden
  Raster eine 2×2-Tabelle wählen, sofort „QA-Fokus Zelle“ tippen.
  Erwartet: Der Text landet in der ERSTEN Zelle der neuen Tabelle – nicht
  in dem Absatz darüber und nicht an einer anderen Stelle im Dokument.
  (Dieser Weg lief über den Öffner-Knopf UND das Raster; beide waren
  zunächst als ungefährlich eingestuft und wurden erst im Review als
  betroffen erkannt – deshalb hier ausdrücklich mitgeprüft.)

Speichern, Editor erneut öffnen: alle oben genannten Ergänzungen
erscheinen unverändert an der erwarteten Stelle.

**D21 [VERBUNDEN] Einzug ist SOFORT im Editor sichtbar – Absatz, Bild,
Formel (v7.42, Nutzer-Befund „Einzug vergrößern hat keine sichtbare
Auswirkung im Editor, nur in der Anzeige nach dem Speichern“, DECISIONS
#86 Teil A).** Editor öffnen, einen Absatz „QA-Sichtbar Absatz“ anlegen,
Cursor hineinsetzen, „Einzug vergrößern“ zweimal klicken. Erwartet: Der
Absatz rückt BEREITS IM EDITOR (nicht erst nach dem Speichern) bei jedem
Klick sichtbar nach rechts. „Einzug verkleinern“ einmal klicken: Erwartet,
der Absatz rückt sofort wieder ein Stück zurück. Direkt darunter ein Bild
einfügen (Bild-Knopf), Cursor hineinsetzen, „Einzug vergrößern“ klicken:
Erwartet, das Bild rückt SOFORT sichtbar mit ein (nicht erst nach dem
Speichern) – das ist der eigentliche Kern dieses Fixes, vorher passierte
beim Bild optisch GAR NICHTS im Editor. Eine Formel einfügen (Sigma-Knopf,
abgesetzt), Cursor hineinsetzen, „Einzug vergrößern“ klicken: Erwartet,
die Formel rückt ebenfalls SOFORT sichtbar ein (vorher ebenfalls keine
Reaktion im Editor). Speichern, Editor erneut öffnen: alle drei zeigen
exakt denselben Versatz wie unmittelbar vor dem Speichern (kein
sichtbarer Sprung). Zusätzlich (Finding B3, DECISIONS #86 – rein
informativ, NICHT als Fehler melden): Verschachtelte Aufzählungen wirken
seit diesem Fix minimal (ca. 4 px pro Ebene) weiter eingerückt als vorher
– bewusste, leicht rückgängig zu machende Angleichung an den Einzug der
Dokument-Ansicht. Nur melden, falls der Abstand zwischen Aufzählungszeichen
und Text dadurch unangenehm groß wirkt.

**D22 [VERBUNDEN] Formel als Fortsetzung unter einem Listenpunkt bekommt
keinen doppelten Einzug mehr (v7.42, ECHTER Bug, DECISIONS #86 Finding
B4).** Editor öffnen, Stichpunkt „QA-Formel-Liste“ anlegen, Enter, direkt
danach eine abgesetzte Formel einfügen (Sigma-Knopf, z. B. `x^2`) OHNE
weitere manuelle Einrückung. Erwartet: Die Formel erscheint auf GLEICHER
Einzugstiefe wie der Text von „QA-Formel-Liste“ (kein zusätzlicher Versatz
nach rechts, obwohl sie technisch als Fortsetzung UNTER dem Listenpunkt
steht). Cursor in die Formel setzen: „Einzug verkleinern“ ist AKTIV (die
Formel verhält sich wie der gesamte Listenpunkt, analog zu einem Absatz an
derselben Stelle), „Einzug vergrößern“ ist AUSGEGRAUT. Speichern, Editor
erneut öffnen und OHNE weitere Änderung erneut speichern: KEIN Commit
(No-op-Roundtrip).

**D23 [VERBUNDEN] Einzug unter einem Listenpunkt bleibt über Speichern+
Neuladen KONSTANT (v7.44, Nutzer-Befund „verhält sich komisch, wenn ich
das in einem Block mache, der eine Checkbox oder Aufzählung hat“,
DECISIONS #90 – löst die vormalige Finding-B1-Dokumentation aus #86 ab).**
Editor öffnen, Stichpunkt „QA-Einzug-Punkt“ anlegen. Direkt danach einen
normalen, NICHT eingerückten Absatz „QA-Einzug-Fortsetzung“ anlegen
(z. B. Enter, dann Umschalt+Tab, um aus der Liste herauszuspringen).
Cursor in diesen Absatz setzen, „Einzug vergrößern“ klicken. Erwartet:
Der Absatz rückt sichtbar unter „QA-Einzug-Punkt“ ein (er wird beim
ERSTEN Klick strukturell Teil des Listenpunkts – kein bloßes optisches
Einrücken). **Berichtigt (v7.47, E2E-Befund gegen v7.45.1 – das
ursprünglich dokumentierte „graut SOFORT nach dem ersten Klick aus“ war
zu eng gefasst, das eigentliche Verhalten ist gewollt):** Ob „Einzug
vergrößern“ danach schon ausgegraut ist, hängt davon ab, ob VOR
„QA-Einzug-Punkt“ bereits (mindestens) ein weiterer Stichpunkt in
DERSELBEN Liste steht – im länger genutzten QA-Test-Notizbuch nach den
vorangehenden Testfällen der Normalfall. Ist das so, bleibt der Knopf
nach dem ersten Klick noch AKTIV: Ein zweiter Klick lässt „QA-Einzug-
Punkt“ samt seiner Fortsetzung eine Ebene TIEFER unter den vorherigen
Stichpunkt sinken (sichtbar an einer weiteren, spürbar größeren
Einrückung – strukturelle Listenverschachtelung kennt bewusst keine feste
Tiefenbegrenzung, siehe D15). Am Code nachgeprüft: Bei GENAU
einem vorangehenden Stichpunkt graut der Knopf GENAU nach diesem zweiten
Klick aus; steht „QA-Einzug-Punkt“ dagegen als ERSTER/EINZIGER Stichpunkt
seiner Liste da, graut er schon nach dem ersten Klick aus. Beide Fälle
sind korrekt – **so oft „Einzug vergrößern“ klicken, bis der Knopf
tatsächlich ausgraut**, und sich die Klickzahl (dafür „Einzug
verkleinern“ gleich oft) für den folgenden Reload-Vergleich merken.
Speichern, Editor erneut öffnen: Erwartet, GENAU derselbe Knopf-Zustand
(„Einzug vergrößern“ ausgegraut, „Einzug verkleinern“ aktiv) UND dieselbe
Optik – KEIN Wechsel zwischen den beiden Sitzungen. Jetzt „Einzug
verkleinern“ genau so oft klicken, wie zuvor „Einzug vergrößern“ nötig
war: Erwartet, jeder Klick macht GENAU eine Verschachtelungsebene
rückgängig (bei mehr als einem vorherigen Vergrößern-Klick sinkt „QA-
Einzug-Punkt“ zwischenzeitlich wieder eine Ebene nach oben, bleibt dabei
aber durchgehend ein Stichpunkt mit sichtbarem Aufzählungszeichen); erst
der LETZTE Klick löst „QA-Einzug-Fortsetzung“ tatsächlich aus dem
Listenpunkt heraus (erscheint danach als eigenständiger Absatz direkt
nach der Liste). Am Ende in jedem Fall: „QA-Einzug-Punkt“ bleibt
UNVERÄNDERT ein Stichpunkt an seiner ursprünglichen Stelle in der Liste
(NICHT der komplette Listenpunkt wird mit angehoben).
Zusätzlich: Ein Bild direkt unter „QA-Einzug-Punkt“ einfügen, gefolgt von
einer kursiven Bildunterschrift, BEIDE zusammen markieren (Mausauswahl
vom Bild bis ans Ende der Unterschrift) und EINMAL „Einzug vergrößern“
klicken – erwartet, BEIDE (Bild UND Unterschrift) rücken gemeinsam unter
den Listenpunkt (der ursprüngliche gemeldete Fall). **Nicht als Fehler
melden:** Eine NUMMERIERTE Liste (`1.`) verhält sich hier bewusst ANDERS
(unverändert wie zuvor, keine Sonderbehandlung) – ein direkt danach per
Knopf eingerückter Absatz bleibt dort ein eigener, unverschmolzener
Absatz, Knopf-Zustand und Optik ändern sich dort auch nach dem Neuladen
nicht. **Ebenfalls nicht als Fehler melden:** Hatte die Liste VOR dem
Einrücken MEHR ALS EINEN Punkt, stehen ihre Punkte nach dem nächsten
Laden mit einer Leerzeile dazwischen (die Liste wird „lose“). Das ist die
bekannte Loose/Tight-Normalisierung von markdown-it/prosemirror-markdown,
passiert EINMALIG, geht mit keinerlei Inhaltsverlust einher und ist ab
dem zweiten Zyklus stabil.

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
5. Wurde C16/C17 (globales Gedächtnis) ausgeführt: in den Einstellungen
   prüfen, dass KEIN QA-Testeintrag mehr im Abschnitt „Globales
   Gedächtnis“ steht (siehe Cleanup-Hinweis dort) – das Gedächtnis ist
   global und überlebt anders als QA-Notizbücher keinen Löschen-Knopf.
