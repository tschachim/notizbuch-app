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
erscheint in der Liste mit Emoji-Icon, Name und Präfix. „Bearbeiten“ am
eben angelegten Eintrag klicken, Namen zu „QA-Test Provider geändert“
ändern, übernehmen. Erwartet: Name in der Liste aktualisiert. „Löschen“
klicken. Erwartet: Eintrag verschwindet wieder, KEINE neue Version/
Commit dadurch (Provider leben nur in `state.json`-fernem localStorage).
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
Version (No-op-Roundtrip, wie schon bei D5/D6 für Formeln/Codeblöcke).
⚠️ Bekannte, bewusste Normalisierung (KEIN Bug, bitte nicht melden): Eine
im Link-Dialog eingegebene URL mit Leerzeichen, unbalancierten/
verschachtelten runden Klammern, `"` oder `<`/`>` wird beim Einfügen
automatisch prozent-encodiert (z. B. `%20` für ein Leerzeichen) – eine
einzelne Ebene balancierter Klammern (z. B. ein Wikipedia-Link) bleibt
dagegen unverändert lesbar.

**D8 [VERBUNDEN][API] „Titel ermitteln“ im Link-Dialog.** NUR ausführen,
wenn unter Einstellungen (siehe A4) bereits ein Provider MIT
Zugangsdaten (PAT bzw. E-Mail+API-Token) hinterlegt ist – der Tester
trägt selbst NIEMALS Zugangsdaten ein; ist keiner konfiguriert, diesen
Fall als ÜBERSPRUNGEN melden (kein Finding). Editor öffnen, Link-Knopf
klicken, als URL ein passendes Ziel des konfigurierten Providers
eintragen (z. B. bei Azure DevOps eine
`https://dev.azure.com/<org>/<projekt>/_workitems/edit/<id>`-URL).
Erwartet: Ein zusätzlicher Knopf „Titel ermitteln“ (Funkeln-Icon)
erscheint im Popover – NUR bei diesem Provider, nicht bei einer
beliebigen anderen URL. Klicken. Erwartet: kurzer Ladezustand (Spinner
im Knopf), danach ENTWEDER das Titelfeld automatisch befüllt (Erfolg –
bei Azure DevOps im Format „{Typ} {ID}: {Titel}“) ODER eine
verständliche Fehlermeldung im Popover (z. B. bei einer
Confluence-CORS-Sperre des Atlassian-Tenants – KEIN Bug, dokumentierte
Grenze, siehe DECISIONS.md #56). Bei Erfolg: Titel vor dem Einfügen bei
Bedarf noch anpassen, „Einfügen“ klicken, speichern. Erwartet: Link
erscheint in der Ansicht wie in C11/C12 beschrieben (inkl. Icon).

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
