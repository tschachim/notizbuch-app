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
C1).

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
im Editor selbst einfügen; den Inhalt testweise um ein Dollarzeichen
und ein Pipe-Zeichen ergänzen (z. B. `Preis: $5 | Menge: 3`). Editor
öffnen. Erwartet: Der Codeblock erscheint monospaced (grauer/dezenter
Kasten, eigene Schriftart), NICHT als Roh-```-Text. OHNE etwas zu
ändern speichern: Erwartet KEIN Commit und keine neue Version in der
Historie (No-op). Dann den Code-Inhalt geringfügig ändern (z. B. einen
Kommentar ergänzen) und speichern. Erwartet: neue Version in der
Historie, Ansicht zeigt den geänderten Code korrekt monospaced,
Dollarzeichen UND Pipe-Zeichen im Code bleiben wörtlich erhalten (keine
Formel- oder Tabellen-Fehlinterpretation), alle anderen Inhalte
(inkl. eventueller Formeln aus D5) unverändert.

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
