# Entscheidungen

Pragmatische Entscheidungen an Stellen, die AUFTRAG.md offen lässt.
Die Kernlogik (Ops, Diff, Renderer, System-Prompt, Tool-Schema) ist unverändert
aus `referenz-app.jsx` übernommen.

1. **Tailwind v4 mit `@tailwindcss/vite`** statt Tailwind v3 mit Config-Datei.
   Weniger Setup, identische Utility-Klassen – das optische Design der Referenz
   (Slate/Indigo, Serif/Mono) bleibt unverändert.

2. **Alle Schreibzugriffe client-seitig serialisiert** (Warteschlange in
   `lib/github.js`): Jeder Contents-API-PUT erzeugt einen Commit auf `main`;
   parallele PUTs auf denselben Branch kollidieren sonst.

3. **`state.json`-Konflikte: einmaliger Retry, dann Last-Writer-Wins.**
   Chat/Klappzustände sind Verlaufsdaten. Die Wissensbasis dagegen ist strikt
   SHA-geschützt: Bei Konflikt wird neu geladen, informiert und nichts
   überschrieben (Eingabe bleibt erhalten, steht wieder im Eingabefeld).

4. **Fokus-Refresh:** Beim Fensterfokus/Sichtbarwerden wird der Remote-Stand
   nachgezogen (Dokument immer; Chat nur, wenn lokal keine Speicherung
   aussteht), gedrosselt auf alle 15 s. Reduziert Konflikte zwischen PC und
   Handy erheblich, ohne echten Sync-Server.

5. **Backup-Export enthält `history: []`.** Die echte Historie sind die
   Git-Commits des Daten-Repos; sie lässt sich nicht sinnvoll ins alte
   Artifact-Format zurückverwandeln. Das exportierte JSON bleibt trotzdem
   import-kompatibel (Import behandelt fehlende Historie als leer).
   Die alte Artifact-Historie wird beim Import einmalig nach
   `data/alt-historie.json` archiviert.

6. **Bild-Ablage:** Dateiname `bilder/<id>.<ext>`, Endung aus dem MIME-Typ
   (jpeg→jpg, png, webp, gif). Zuordnung `img:<id>` → Datei über ein
   Verzeichnis-Listing von `bilder/` beim Verbinden. Gelesen wird über den
   raw-Medientyp der Contents API (funktioniert auch über 1 MB).

7. **Modellwahl liegt in `state.json`** (wandert also zwischen Geräten mit),
   Zugangsdaten (Owner, Repo, PAT, API-Key) liegen pro Gerät im localStorage.
   Zugangsdaten werden erst nach erfolgreichem Verbindungstest gespeichert.

8. **PWA ohne Service Worker:** Manifest + Icons reichen für „Zum
   Startbildschirm hinzufügen“; ohne Service Worker gibt es keine
   Cache-Invalidierungsprobleme bei Updates. Offline-Betrieb ist ohnehin nicht
   sinnvoll, da Daten und KI eine Verbindung brauchen.

9. **Leeres Daten-Repo wird selbst befüllt:** Fehlt `wissensbasis.md`, legt die
   App sie beim ersten Verbinden mit dem Startdokument an. `state.json`
   entsteht spätestens beim ersten Speichern.

10. **Historien-Ansicht lädt die letzten 30 Commits** (wie die Referenz max.
    30 Versionen zeigte). Ältere Stände bleiben im Git-Repo jederzeit über
    GitHub selbst erreichbar.

11. **„aktuell“-Markierung** in der Historie ist der jüngste Commit (die
    Referenz verglich Dokumenttexte; hier ist der jüngste Commit per
    Definition der gespeicherte Stand).

12. **Commit-Autor der App-Schreibzugriffe** ist der PAT-Inhaber (GitHub setzt
    ihn automatisch); die Commit-Message der Dokument-Commits ist die vom
    Modell gelieferte Message.

13. **Schriftbild der Wissensbasis** (v4.1, Nutzerwunsch): Das Dokument nutzt
    dieselbe Schriftart und -größe wie der Chat (sans, 14 px) statt des
    Serif-Designs der Referenz. Abgeleitete Formatierungen (Überschriften-
    Hierarchie, fett, kursiv, Code) bleiben erhalten, nur proportional
    verkleinert. Ersetzt Punkt 1, soweit er „Serif fürs Dokument“ betraf.

14. **Manuelles Bearbeiten als WYSIWYG** (v4.1, Nutzerwunsch): TipTap v2 mit
    `tiptap-markdown` statt Markdown-Quelltext-Textarea. Der Editor ist auf
    den Dialekt beschränkt, den der Renderer versteht (#/##/###, „- “-Listen,
    fett/kursiv/Code, ---, Bilder); Codeblöcke, Zitate, nummerierte Listen und
    Durchgestrichen sind deaktiviert. Bildreferenzen `img:<id>` werden beim
    Öffnen auf data-URLs aufgelöst und beim Speichern zurückübersetzt.
    Backslash-Escapes des Serializers werden entfernt (der zeilenbasierte
    Renderer interpretiert keine). Speichern ohne inhaltliche Änderung erzeugt
    keinen Commit (Vergleich gegen die Serialisierung direkt nach dem Laden).

15. **Erweiterte Formatierung** (v4.2, Nutzerwunsch): ~~durchgestrichen~~
    (GFM), Schriftfarbe und Textmarker. Farben haben keine
    Markdown-Entsprechung und liegen deshalb als Inline-HTML im Dokument
    (`<span style="color:…">`, `<mark data-color="…">`); der Renderer
    akzeptiert ausschließlich diese beiden Tags mit validierten Farbwerten
    (kein XSS-Weg). Der System-Prompt weist das Modell an, diese
    Auszeichnungen zu erhalten. Feste Paletten: 6 Schriftfarben, 5 Marker.
    Bekannte Einschränkung: Der Editor läuft dafür mit `html: true` – nur
    `<span>`/`<mark>` sind round-trip-sicher; sonstiger Text, der wie
    HTML-Tags aussieht (außerhalb von Backticks), kann beim manuellen
    Bearbeiten umgeformt oder entfernt werden. Die Ansicht zeigt ihn
    weiterhin als Literaltext.

16. **Checklisten & nummerierte Listen** (v4.2, Nutzerwunsch): GFM-Syntax
    `- [ ]` / `- [x]` bzw. `1.`. Kästchen sind direkt in der Ansicht
    klickbar; jeder Klick ändert genau die betroffene Markdown-Zeile und
    erzeugt einen Commit („Erledigt: …“ / „Wieder offen: …“). Schnelle
    Folge-Klicks werden client-seitig serialisiert. Der Parser merkt sich
    dafür zu jeder Zeile ihren Original-Index im Dokument.

17. **Abschnitts-Navigation** (v4.2, Nutzerwunsch): Tab-Leiste rechts neben
    der Wissensbasis mit allen ##-Überschriften (OneNote-Seitenleisten-Stil).
    Klick klappt den Abschnitt auf und springt hin (bewusst ohne
    Smooth-Scroll: Animation und requestAnimationFrame laufen in
    eingebetteten/Hintergrund-Browsern nicht zuverlässig); ein einfacher
    Scroll-Spy markiert beim Scrollen den aktiven Abschnitt.

18. **Verstellbare Spaltenbreiten** (v4.3, Nutzerwunsch): Splitter zwischen
    Chat/Dokument (Prozent) und Dokument/Abschnittsleiste (Pixel), nur am
    Desktop (mobil bleiben die umschaltbaren Vollbild-Ansichten). Ablage pro
    Gerät im localStorage (`notizbuch:layout`) – Bildschirmbreiten sind
    gerätespezifisch, ein Sync über state.json wäre kontraproduktiv.

19. **Schnellnotizen** (v4.3, Nutzerwunsch): frei schwebende Post-its
    (verschieb- und größenveränderbar, mehrere gleichzeitig), Ablage pro
    Gerät im localStorage (`notizbuch:quicknotes`) inkl. Position/Größe.
    Bewusst nicht ins Daten-Repo synchronisiert: Inhalte sind flüchtig und
    wandern per OK-Knopf als „Neue Schnellnotiz: …“ in den Chat-Prompt
    (nicht automatisch abgeschickt), die Notiz wird dabei gelöscht.

20. **Feedback auch nach manuellem Bearbeiten** (v4.4, Nutzerwunsch): Nach
    jedem Editor-Speichern prüft das Modell die Änderung (bekommt den Diff
    plus das Gesamtdokument) und meldet Auffälligkeiten als Chat-Nachricht;
    antwortet es „OK“, bleibt der Chat unberührt. Die Prüfung ändert das
    Dokument nie (ops werden ignoriert). Checkbox-Klicks und Wiederherstellen
    lösen bewusst keine Prüfung aus (trivial bzw. gewollter Rollback).
    Zusätzlich wurde Aufgabe 3 des System-Prompts geschärft („sobald etwas
    auffällt, sofort melden – aber nichts erzwingen“) und das Antwortlimit
    für Hinweise von ~100 auf ~200 Wörter angehoben.

21. **Multi-Notizbuch** (v5.0, Nutzerwunsch): Mehrere Notizbücher als je eine
    Markdown-Datei. Kompatibilität: das bestehende `wissensbasis.md` bleibt
    das Root-Notizbuch, weitere liegen unter `notizbuecher/<slug>.md`.
    Der **Name ist die H1-Titelzeile der Datei** – die Registry wird beim
    Verbinden aus den Dateien abgeleitet (selbstheilend, auch wenn ein altes
    Gerät state.json im v1-Format überschreibt). `state.json` (v2) speichert
    nur noch aktives Notizbuch, Chat (global, ein Verlauf über alle
    Notizbücher), Modell und Klappzustände pro Notizbuch. Jeder KI-Aufruf
    bekommt ALLE Notizbücher als Kontext; ops tragen ein optionales
    `notebook`-Feld (Default: aktiv, unbekannte Namen fallen aufs aktive
    zurück). Landet Inhalt ausschließlich in einem anderen Notizbuch,
    wechselt die App automatisch dorthin; ändert sich (auch) das aktive,
    bleibt sie stehen. Pro geändertem Notizbuch entsteht ein eigener Commit;
    der Commit-Stempel im Chat nennt fremde Notizbücher beim Namen.
    Schnellnotizen und Klappzustände sind notizbuch-spezifisch; Bilder werden
    weiter geteilt in `bilder/` abgelegt. Umbenennen/Löschen von Notizbüchern
    ist bewusst noch nicht in der UI (Umweg: Datei im Daten-Repo umbenennen
    bzw. löschen – die App entdeckt es beim nächsten Verbinden).
    Backup-Export ist jetzt v2 (alle Notizbücher); der Import versteht v1
    (Artifact, ins aktive Notizbuch) und v2 (Abgleich über Namen).
    Der Fokus-Refresh lässt das aktive Notizbuch bewusst lokal (kein
    Überraschungs-Wechsel durch andere Geräte).

22. **Internet-Recherche in jedem KI-Aufruf** (v5.1, Nutzerwunsch): Server-
    seitige Anthropic-Websuche (`web_search_20260209`; Basis-Variante für
    Haiku) mit `max_uses: 8` und großzügiger „lieber zu oft suchen“-Anweisung.
    Konsequenz: `tool_choice` kann nicht mehr auf `update_notebook` erzwungen
    werden (erzwungene Tools verhindern Server-Tool-Aufrufe) → `auto` plus
    Prompt-Pflicht („am Ende genau ein update_notebook“) plus Fallback-Kette:
    liefert eine Antwort kein update_notebook, wird einmal OHNE Suche mit
    erzwungenem Tool nachgefasst; Text-JSON-Parsing bleibt als letzte Stufe.
    `pause_turn` (Server-Tool-Unterbrechung) wird mit bis zu 3 Fortsetzungen
    behandelt. Kosten: ~10 USD pro 1000 Suchen zusätzlich zu Tokens.

23. **Hintergrundwissen pro Notizbuch** (v5.1, Nutzerwunsch): Dateien
    (pdf, md, txt, csv, xlsx, docx) liegen unter `wissen/<nbId>/` im
    Daten-Repo. Der Text wird EINMALIG beim Upload client-seitig extrahiert
    (pdf.js, mammoth, SheetJS – lazy geladen, Hauptbundle unverändert) und
    als `<name>.extrakt.md` daneben abgelegt; Prompts verwenden nur den
    Extrakt. Bewusst kein PDF-Block pro Prompt (würde jede Nachricht um den
    vollen Dateiinhalt verteuern); gescannte PDFs ohne Textebene werden mit
    klarer Meldung abgelehnt. Ins Prompt geht das Wissen des AKTIVEN
    Notizbuchs (Deckel: 80k Zeichen/Datei, 200k gesamt, mit Kürzungsvermerk);
    von fremden Notizbüchern nur die Dateinamen. SheetJS kommt als 0.20.3
    vom offiziellen CDN (npm-Version hat eine bekannte ReDoS-Schwachstelle).
    Uploads anderer Geräte erscheinen nach dem nächsten Verbinden/Reload.

24. **Zitat-Fußnoten** (v5.2, Nutzerwunsch): Das Modell markiert recherchierte
    Aussagen in reply mit `<cite index="D-P">…</cite>`; die Quellen (URL +
    Titel) werden aus den web_search_tool_result-Blöcken der API-Antwort in
    Trefferreihenfolge gesammelt und an der Chat-Nachricht gespeichert –
    bewusst OHNE Dedup, damit die index-Nummern positionsstabil bleiben
    (dedupliziert wird erst bei der Fußnotenvergabe). Gerendert wird der
    Zitattext plus hochgestellter klickbarer Fußnote ([1], [2], …) mit
    Quellenliste am Nachrichtenende. Die D-Nummer wird 1-basiert (Fallback
    0-basiert) auf die Trefferliste abgebildet – best effort; der Prompt gibt
    dem Modell die 1-basierte Zählung über alle Treffer vor. Nicht
    auflösbare Zitate und Quellen ohne http(s)-URL zeigen nur den Text;
    fehlerhafte/verwaiste cite-Tags werden aus der Anzeige gestrippt statt
    als Rohmarkup zu erscheinen. In ops-Inhalte (Dokument) gelangen
    cite-Tags nie (werden gestrippt, Prompt verlangt dort Klartext-Quellen).
    Wichtig: Bei aktiver Websuche schreibt das Modell die inhaltliche
    Antwort meist als Textblöcke VOR dem Tool-Aufruf (nur dort hängt die
    API echte Zitate an); das reply-Feld enthält dann bloß die Bestätigung.
    Beide Teile werden deshalb zur Chat-Nachricht kombiniert, API-Zitate
    als cite-Marker hinter dem jeweiligen Block kodiert und alle Indizes
    auf eine kompakte Liste NUR der tatsächlich zitierten Quellen
    umnummeriert – nur diese wird an der Nachricht gespeichert (hält
    state.json klein und macht die Auflösung exakt statt best effort).

25. **Tabellen** (v5.2, Nutzerwunsch): GFM-Pipe-Tabellen im Renderer
    (Kopf-/Trennzeile optional, `\|` in Zellen als Literal, Datenzeilen
    werden wie bei GFM auf die Kopfbreite gekürzt/aufgefüllt, horizontales
    Scrollen bei Überbreite) und im Editor (TipTap-Table mit Einfüge-Grid
    „auf Größe ziehen“, Zeile/Spalte einfügen/löschen, Tabelle löschen).
    Bewusst ohne Zellen-Verbund und Spaltenbreiten: nur einfache Tabellen
    sind als GFM-Markdown serialisierbar – sonst fiele tiptap-markdown auf
    HTML zurück, das der Renderer nicht darstellt. Aus demselben Grund ist
    die Kopfzeile im Editor nicht löschbar. Eigener Table-Serializer
    (MdTable): tiptap-markdown verlässt sich beim Escapen von Pipes auf
    prosemirror-markdown, dessen installierte Version das nicht mehr tut –
    ohne eigenes `\|`-Escaping zerfielen Zellen mit Pipe im Text beim
    nächsten Öffnen. Der System-Prompt erlaubt dem Modell explizit
    GFM-Tabellen für strukturierte Daten.

26. **Quellen-Fußnoten im Dokument** (v5.3, Nutzerwunsch): Das Modell
    markiert recherchierte Aussagen jetzt auch in ops-Inhalten mit
    cite-Tags; die App wandelt sie in Markdown-Links der Form
    `[n](https://…)` direkt hinter der belegten Aussage um. Die Nummer
    vergibt renumberCitations bei jedem Schreiben dokumentweit neu
    (gleiche URL = gleiche Nummer, Reihenfolge = erste Fundstelle im
    Dokument) – Einfügungen renummerieren automatisch. Der Renderer
    zeigt die Links als kleine hochgestellte Zahl (klickbar); der
    Editor erhält sie über die TipTap-Link-Extension (ohne Autolink).
    Bewusst ein normaler Markdown-Link statt eigener Syntax: er
    übersteht Editor-Roundtrip und markdown-it ohne Sonderbehandlung.
    Im Chat werden konsultierte Quellen zudem auch ohne Inline-Zitat
    unter der Nachricht gelistet (dedupliziert, max. 6), damit sichtbar
    ist, dass recherchiert wurde.

27. **Logo** (v6.0, Nutzerwunsch): Das vom Nutzer gelieferte Logo (blaue
    Spirale) ersetzt Favicon, PWA-Icons und das Icon im App-Header. Weißer
    Hintergrund wurde in Transparenz umgerechnet; für „maskable“ und die
    Android-Launcher-Icons liegt das Logo auf weißem Grund (Safe-Zone).
    Quelle der Icons ist public/icons/icon-512.png.

28. **Notizbuch-Verwaltung** (v6.0, Nutzerwunsch): Admin-Dialog über die
    Notizbuchauswahl links oben („⚙ Notizbücher verwalten …“): umbenennen,
    Reihenfolge, löschen, neu anlegen. Umbenennen ändert nur die
    H1-Titelzeile der Datei (Pfad/Slug bleiben stabil – die Datei bleibt
    die einzige Wahrheit für den Namen). Die Dropdown-Reihenfolge wandert
    als order-Array in state.json mit (unbekannte IDs hinten, stabile
    Sortierung – ältere Geräte ohne order bleiben kompatibel). Löschen
    entfernt Notizbuch-Datei und Hintergrundwissen (Bilder bleiben, sie
    sind repo-weit; alte Stände bleiben in der Git-Historie), das letzte
    Notizbuch ist nicht löschbar. Der Fokus-Refresh entfernt remote
    gelöschte Notizbücher auch lokal.

29. **Dateianhänge im Chat** (v6.0, Nutzerwunsch): Der Anhang-Knopf nimmt
    jede Datei. Bilder gehen unverändert den Bild-Weg – die Bildunterschrift
    ist jetzt aber nur noch EIN knapper kursiver Satz (keine lange
    Beschreibung). Andere Dateien: Text wird best effort client-seitig
    extrahiert (gleiche Extraktoren wie Hintergrundwissen) und nur für
    DIESEN API-Aufruf als <dateianhang>-Block mitgegeben (80k-Deckel,
    Escape gegen Block-Ausbruch); im Chatverlauf bleibt nur der Dateiname.
    Die Datei selbst wird nach erfolgreicher Antwort unter dateien/
    archiviert (Namenskonflikte bekommen -2/-3-Suffixe) – bewusst getrennt
    von bilder/ und OHNE Referenz im Dokument. Nicht extrahierbare Formate
    werden trotzdem archiviert, das Modell erfährt nur den Namen.
    Bewusstes Restrisiko: Der INHALT einer (evtl. fremd bezogenen) Datei
    ist ungefilterter Modell-Kontext und könnte Anweisungen enthalten
    (Prompt-Injection). Block-Ausbruch ist escaped, der System-Prompt
    grenzt die Verwendung ein; für eine Ein-Nutzer-App akzeptiert.

30. **Android-App** (v6.0, Nutzerwunsch): Minimale WebView-Hülle
    (android/), die nur die Live-Website rahmenlos lädt – Web-Updates
    kommen ohne App-Update an. localStorage bleibt App-privat (PAT/Key),
    Datei-Chooser für Anhänge, externe Links (z. B. Quellen-Fußnoten)
    öffnen im System-Browser, Zurück-Taste navigiert in der App. Gebaut
    per GitHub-Actions-Workflow als debug-signiertes APK mit festem
    Release-Link (Tag android-apk). Bewusst KEIN privater Signierschlüssel
    im öffentlichen Repo: jeder Build hat eine neue Debug-Signatur, vor
    Neuinstallation muss die alte App runter – akzeptiert, weil die App
    praktisch nie neu gebaut werden muss.

31. **Bildgröße im Editor** (v6.2, Nutzerwunsch): Bilder lassen sich im
    WYSIWYG-Editor per Anfasser unten rechts skalieren (eigene NodeView).
    Die Breite wird als "|w<px>"-Suffix im Alt-Text persistiert
    (`![Titel|w320](img:…)`) – Markdown kennt kein width-Attribut, und nur
    der Alt-Text übersteht sowohl den tiptap-Roundtrip als auch den
    zeilenbasierten Renderer (IMG_LINE_RE bleibt unverändert gültig).
    Skalierte Bilder verlieren die 16-rem-Höhenkappung (sonst Verzerrung).
    Der System-Prompt weist das Modell an, den Suffix zu erhalten und nie
    selbst zu setzen. Akzeptiertes Restrisiko: Endet eine echte
    Bildunterschrift zufällig auf "|w<Zahlen>", wird sie als Breite
    gedeutet (bei Prosa-Captions praktisch ausgeschlossen).

32. **Notizbuch-Icons „Smart Icons“** (v6.2, Nutzerwunsch): Pro Notizbuch
    kann im Admin-Dialog ein eigenes Icon hochgeladen werden. Aufbereitung
    client-seitig: fast-quadratische Bilder werden mittig quadratisch
    beschnitten (möglichst unverändert), stark längliche (Seitenverhältnis
    > 2) transparent eingepasst; Ergebnis 128-px-PNG unter icons/<nbId>.png
    im Daten-Repo (SHA-geführt für Ersetzen/Löschen). Links oben erscheint
    das Icon des aktiven Notizbuchs, ohne eigenes Icon das Standard-Logo.
    Beim Löschen eines Notizbuchs wird sein Icon mit entfernt. Icons
    anderer Geräte erscheinen nach dem nächsten Verbinden/Reload.

33. **Schnellnotizen wandern mit** (v6.3, Nutzerwunsch; ersetzt die
    Ablage-Entscheidung aus Punkt 19): Schnellnotizen liegen jetzt als
    quicknotes-Feld in state.json im Daten-Repo und erscheinen damit auf
    allen Geräten (inkl. Position/Größe; Last-Writer-Wins wie der übrige
    State, Übernahme auch im Fokus-Refresh). Beim Übernehmen wird pro
    Notizbuch gemergt: Remote gewinnt, lokale Notizbücher ohne
    Remote-Eintrag behalten ihre Notizen – so verliert bei der Migration
    auch das zweite Gerät nichts. localStorage bleibt als Offline-Fallback
    und für die Migration: Hat state.json noch kein quicknotes-Feld,
    werden die lokalen Notizen beim nächsten Speichern übernommen statt
    verworfen.

34. **Kein Horizontal-Scroll auf Mobilgeräten** (v6.3, Nutzerwunsch): Die
    Android-WebView erlaubt keinen Pinch-/Doppeltipp-Zoom mehr (gezoomter
    Inhalt ließ sich seitlich verschieben – die App soll sich wie eine
    native App an die Gerätebreite schmiegen). Web-seitig zusätzlich
    overflow-x:hidden auf html/body und Zeilenumbruch für lange
    Code-Tokens/URLs im Dokument; breite Inhalte (Tabellen) scrollen
    weiterhin in ihren eigenen Containern.

35. **Mobiler Abschnitts-Drawer** (v6.4, Nutzerwunsch): Auf schmalen
    Bildschirmen (< md) ist die Abschnitts-Leiste ausgeblendet – das
    Dokument bekommt die volle Breite. Die Gliederung öffnet als
    Off-Canvas-Drawer von rechts (marktübliches Muster, vgl.
    OneNote-Mobil/Google-Docs-Gliederung): über den Gliederungs-Knopf im
    Dokumentkopf oder per Wischgeste vom rechten Rand; Abschnitts-Tipp
    springt hin und schließt, ebenso Tipp auf den Hintergrund oder
    Zurückwischen. Der Schnellnotiz-Knopf wandert mit in den Drawer.
    Desktop (≥ md) bleibt unverändert mit fester Leiste und Splitter.

36. **Qualitätssicherung** (v6.5, Nutzerwunsch): (a) Unit-Tests mit Vitest
    für die Logik-Schicht src/lib (Ops, Diff, Renderer, Zitate,
    API-Aufbereitung mit gemocktem fetch, GitHub-Schicht inkl.
    Warteschlangen-/Konflikt-Verhalten, Helfer). Coverage-Gate 60 %
    (vitest.config.js), als Pflicht-Schritt im Deploy-Workflow – ohne
    grüne Tests wird nicht deployt. Die UI-Schicht (App.jsx) wird bewusst
    nicht per Unit-Test, sondern über die End-to-End-Testfälle geprüft.
    Der code-reviewer Subagent prüft bei jedem Review Coverage UND
    Testqualität (relevante Datenlagen statt Pro-forma-Assertions).
    (b) End-to-End: docs/TESTFAELLE.md definiert User-Story-Testfälle für
    alle Anwendungsfälle; ein eigener tester-Subagent (Sonnet) bedient
    nach jedem Deploy die live App im Browser, meldet Findings
    (Blocker/Fehler/Kosmetik) und räumt QA-Artefakte auf. Sicherheits-
    regeln: niemals Zugangsdaten eingeben, nur „QA-Test“-Notizbücher
    anfassen, bezahlte [API]-Fälle höchstens einmal pro Lauf.
    Beim Testschreiben gefundener echter Bug: safeFileName konnte für
    Dateinamen aus lauter Punkten das Pfadsegment „..“ erzeugen – behoben.

37. **Geräte-Sync per Polling statt WebSocket** (v6.7, Nutzerwunsch):
    Alle Änderungen gehen sofort ins Daten-Repo (Dokument: ein Commit pro
    Änderung; Chat/Schnellnotizen/State: 2,5 s entprellt). Für die
    Gegenrichtung gibt es ohne eigenen Server keinen Push – GitHub bietet
    Browsern kein WebSocket/SSE für Repo-Änderungen. Deshalb pollt jeder
    Client zusätzlich zum Fokus-Refresh alle 25 s (nur bei sichtbarer
    Seite; 15-s-Drossel und busy/editing-Guards bleiben). Änderungen vom
    Handy erscheinen am PC damit ohne Reload nach spätestens ~25 s.
    Die Root-Dokument-SHA kommt jetzt aus dem Wurzel-Listing, damit der
    Poll nur bei echten Änderungen Inhalte lädt (~4 leichte Requests/
    Minute – weit unter dem GitHub-Limit von 5000/h). Außerdem Chat
    gegen Querscrollen gehärtet (overflow-x-hidden, Bilder max-w-full).

38. **Wissens-Abruf auf Anfrage** (v6.8, Nutzerwunsch; Anlass: bison.box-
    Handbuch mit 819 Seiten ≙ ~970k Zeichen Extrakt): Wissensdateien über
    80k Zeichen werden nicht mehr abgeschnitten in den Prompt gelegt,
    sondern als Index-Eintrag geführt (volltext="nein", Umfang, die ersten
    2k Zeichen zur Orientierung). Das Modell holt benötigte Inhalte über
    das neue client-seitige Tool lookup_wissen (Datei + Suchbegriffe oder
    Seitenbereich): Die App sucht im lokal gecachten Extrakt (Seitenblöcke
    des PDF-Extrakts, Treffer mit ±1 Seite Kontext, 30k-Deckel pro
    Antwort) und setzt die Konversation mit dem tool_result fort – max.
    4 Runden, ein update_notebook-Aufruf beendet den Turn. Keine Server-
    komponente, kein Embedding-Index: Volltextsuche im Extrakt reicht für
    Handbuch-Fragen und bleibt wartungsfrei. Kosten: normale Nachrichten
    tragen nur den 2k-Kopf; Handbuch-Fragen einen zweiten, gezielten Call.
    Upload: Dateien bis 80 MB erlaubt; über 25 MB wird NUR der Extrakt
    gespeichert (ein Base64-PUT des Originals wäre browserseitig fragil,
    und Prompts nutzen ohnehin nur Extrakte) – die Discovery erkennt
    solche Einträge am Extrakt ohne Original. Bewusstes Restrisiko wie
    beim Wissensblock: tool_result-Inhalte aus Extrakten gehen ungefiltert
    an das Modell (nutzereigene Dateien; Prompt-Injection-Risiko wie in
    Punkt 29 akzeptiert).
