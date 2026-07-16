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

39. **Standard-Modell Sonnet 5** (v6.9, Nutzerhinweis): Die Modellliste
    stammte aus der v5.0-Zeit; claude-sonnet-4-6 ist durch
    claude-sonnet-5 als Standard ersetzt (gleiche Websuche-Variante
    20260209, aktuell Einführungspreis). Geräte mit gespeichertem
    Sonnet 4.6 in state.json fallen beim Laden automatisch auf den
    neuen Standard zurück (die Modell-Validierung kennt nur noch die
    aktuelle Liste). Fable 5, Opus 4.8 und Haiku 4.5 bleiben wählbar.

40. **Chat-Archivierung** (v7.0, Nutzerwunsch): Der Chat wird seit jeher
    auf die letzten 80 Nachrichten gekappt (state.json); Älteres ging
    stillschweigend verloren. Neuer Archiv-Knopf in der Eingabezeile
    (mit Bestätigungsleiste): legt den Verlauf als lesbares Markdown
    unter chats/chat-JJJJ-MM-TT-HHMM.md im Daten-Repo ab (Kollisionen
    bekommen Zähler-Suffix) und leert den Chat erst NACH erfolgreichem
    Schreiben (zurück auf die Begrüßung; der Save-Effect synct das auf
    alle Geräte). Format: Rollen-Label + Zeitstempel pro Nachricht,
    cite-Marker werden über citeTagsToDocLinks/renumberCitations zu
    archivweit durchnummerierten Fußnoten-Links, Bilder als relative
    Links auf bilder/ (../, GitHub-Ansicht), Dateianhänge und
    Dokument-Commits als Hinweiszeilen. Kein Auto-Archiv: Der Zeitpunkt
    bleibt bewusst beim Nutzer, die 80er-Kappung bleibt als Deckel.
    Vor dem Archivieren wird state.json frisch gelesen und per
    mergeChats mit dem lokalen Stand vereint (Dedupe über ts/Rolle/
    Text), damit Nachrichten anderer Geräte nicht verloren gehen.
    Bewusstes Restrisiko (Last-Writer-Wins von state.json): Ein Gerät,
    das den geleerten Chat noch nicht gepollt hat und danach selbst
    schreibt, kann den alten Verlauf wiederbeleben – dann existiert
    er doppelt (Archiv + Chat), es geht aber nichts verloren.

41. **Keine Nebenbei-Ops bei reinen Fragen** (v7.1, QA-Findings C2/F2
    aus dem ersten voll verbundenen E2E-Lauf): Das Modell nutzte
    Informationsfragen („Was steht in diesem Notizbuch/dieser Datei?“)
    als Anlass für ungefragte Dokumentpflege (Platzhalter entfernt,
    Dateiinhalt eingetragen). Der System-Prompt verbietet das jetzt
    dreifach: Strukturpflege nur im Zug inhaltlicher Änderungen, Fakten
    aus Dateianhängen nur auf erkennbaren Speicherwunsch, und ein
    eigener REINE-FRAGEN-Block (ops:[] Pflicht, kein Nebenbei-Aufräumen);
    zusätzlich geschärfte ops-Beschreibung im Tool-Schema. Dazu G2:
    Export-Dateiname folgt jetzt dem aktiven Notizbuch (slugify) statt
    fix „wissensbasis-…“. Prompt-Verhalten bleibt stochastisch – die
    Regeln senken die Rate, der E2E-Retest prüft den Effekt.

42. **max_tokens 16000 statt 4000** (v7.2, Nutzerwunsch): Bei inhaltlich
    langen Antworten (große Dokument-Umbauten) lief die App regelmäßig
    in die Abschneide-Warnung, obwohl Sonnet 5/Fable 5 deutlich mehr
    Output vertragen als das alte Limit. Die Grenze steht jetzt als
    benannte Konstante `MAX_TOKENS`; die bestehende Truncation-Behandlung
    (Ops verwerfen, ⚠-Hinweis) bleibt als Sicherheitsnetz unverändert –
    16000 senkt nur die Häufigkeit, schließt Abschneiden bei sehr langen
    Rewrites aber nicht grundsätzlich aus. Bewusster Kompromiss zwischen
    Abdeckung und Kosten/Latenz pro Aufruf.

43. **Bildtitel nicht mehr als fette Bildunterschrift** (v7.2,
    Nutzerwunsch): `![Titel](img:…)` zeigte den Titel bisher zusätzlich
    zur (per Konvention folgenden) kursiven Bildunterschrift als fette
    `<figcaption>` – wirkte wie ein Duplikat. Die figcaption entfällt in
    Ansicht und Editor-NodeView; der Titel bleibt unangetastet im
    Markdown und liegt jetzt nur noch als `alt`- und `title`-Attribut am
    `<img>` (Tooltip beim Hover). Roundtrip (Serialisierung
    `![Titel|wNNN](img:…)`, IMG_LINE_RE) ist davon nicht betroffen – es
    wird nur nicht mehr zusätzlich sichtbar gerendert.

44. **Chat-Eingabefeld vergrößerbar** (v7.2, Nutzerwunsch): Kleiner
    Toggle-Knopf oben rechts im Eingabefeld (innerhalb eines relativ
    positionierten Wrappers, damit die Kopfzeile auf schmalen Screens
    nicht um ein weiteres Vollbreite-Element wächst) schaltet zwischen
    rows 2 (kompakt) und rows 10 (groß) um. Rein lokaler UI-Zustand
    (useState, kein Persistieren – Vorliebe ist sitzungsbezogen). Da das
    HTML-`rows`-Attribut nicht responsiv ist, deckelt im großen Modus
    zusätzlich `max-h-40 sm:max-h-64` mit `overflow-y-auto` die Höhe auf
    Mobilgeräten (~6 Zeilen sichtbar, Rest scrollt) und am Desktop
    (~10 Zeilen) – das eigentliche Sprengen des Bildschirms wird so über
    CSS statt über eine zweite Rows-Zahl verhindert. Enter-zum-Senden und
    Umschalt+Enter-Zeilenumbruch bleiben unverändert.

45. **Notizbuch-Icons im Dropdown** (v7.2, Nutzerwunsch): Das native
    `<select>` der Notizbuchauswahl kann keine Bilder in den Optionen
    zeigen. Ersetzt durch eine selbstgebaute `NotebookMenu`-Komponente
    (Trigger-Button + aufklappende `role="listbox"`-Liste, `z-[45]` wie
    der mobile Abschnitts-Drawer): jede Zeile zeigt `nbIcons[id]` bzw.
    das Standard-Logo, das aktive Notizbuch ist markiert, darunter die
    bisherigen Aktions-Einträge „＋ Neues Notizbuch …“ und „⚙
    Notizbücher verwalten …“ (rufen weiterhin dieselben Handler wie das
    alte `<select>`-onChange). Schließen über Escape, Klick außerhalb
    (mousedown-Listener) und Auswahl; Pfeiltasten + Enter/Leertaste für
    Tastaturbedienung – bewusst keine volle ARIA-Combobox
    (aria-activedescendant etc.), „Grund-Tastaturbedienung“ war die
    Vorgabe. Touch funktioniert über die normalen Klick-Handler ohne
    Sonderfall. Modell-Select und das Select im Einstellungs-Dialog
    bleiben native Selects (keine Icon-Anforderung dort).

46. **LaTeX-Formel-Helfer `src/lib/math.jsx`** (v7.3, Nutzerwunsch „volles
    Programm“; Version nach Code-Review, siehe Punkt 49 für die dabei
    gefundenen und behobenen Findings): Neue Dependency `katex`
    (ausdrücklich genehmigt). Ein Regex `MATH_TOKEN_RE` erkennt drei
    Alternativen mit fester Priorität: `\$` (literales Dollarzeichen,
    konsumiert den Backslash), `$$…$$` (Display, mehrzeilig, nicht-gierig)
    und `$…$` (Inline) – gedacht für Chat/Zitate (`renderMathText`/
    `expandMathInNodes`), die Fließtext OHNE zeilenbasierte Struktur
    rendern und bei denen `$$…$$` bewusst über Zeilenumbrüche hinweg
    matchen darf (kein Zeilenrenderer). Für den Editor-Ladepfad ist das
    NICHT sicher genug (siehe Punkt 49) – dort gilt eine eigene, strengere
    Regel. Die Währungs-Sicherheit folgt der Pandoc-Regel: öffnendes `$`
    muss direkt von Nicht-Leerzeichen gefolgt sein, schließendes `$`
    direkt auf Nicht-Leerzeichen folgen und darf nicht direkt vor einer
    Ziffer stehen – damit bleiben „$50“, „50 $ bis 60 $“ und „$5 and $10“
    immer Literaltext, unpaarige `$` matchen den Regex schlicht nicht.
    `DISPLAY_MATH_START_RE`/`DISPLAY_MATH_ONELINE_RE`/`DISPLAY_MATH_END_RE`
    und die Funktion `matchDisplayBlock(lines, startIdx)` sind die EINE
    gemeinsame Quelle der Wahrheit für zeilenverankerte Display-Blöcke,
    genutzt sowohl von der Dokument-Ansicht (Punkt 47) als auch vom
    Editor-Ladepfad (Punkt 49) – `null` bedeutet dabei ausdrücklich „kein
    Block“, nie „Fehler“: Aufrufer verarbeiten die Zeile dann normal
    weiter, statt den Rest des Dokuments zu verschlucken.
    `renderKatexHtml(tex, displayMode)` ruft `katex.renderToString` mit
    `{throwOnError:false, trust:false, displayMode}`: `throwOnError:false`
    verhindert, dass kaputtes TeX (Nutzer- oder Modell-Eingabe) die App
    abstürzen lässt (KaTeX liefert stattdessen ein `.katex-error`-Element
    mit der Fehlermeldung); `trust:false` unterbindet `\href`,
    `\includegraphics` & Co. – zusammen mit KaTeX' eigenem HTML-Escaping
    des kompletten Outputs (auch der `<annotation>` mit dem Original-TeX)
    gibt es über `dangerouslySetInnerHTML` keinen XSS-Weg für Formelinhalt
    (getestet u. a. mit `<script>`-artigem TeX-Text). Ein Modul-Cache
    (`Map`, Key aus `displayMode`+`tex`, geleert bei > 500 Einträgen)
    spart wiederholtes `katex.renderToString` – dieselbe Formel wird pro
    Chat-Tastendruck und Render-Durchlauf sonst mehrfach neu gerendert
    (Review-Finding 5). `renderMathText`/`expandMathInNodes` zerlegen
    beliebigen Text bzw. bereits gemischte String/React-Knoten-Arrays
    (Chat-Zitate) in Literaltext + KaTeX-Spans, mit einem GEMEINSAMEN
    Key-Zähler über das ganze Array (verhindert doppelte React-Keys, wenn
    mehrere Segmente je eine Formel enthalten). KaTeX-CSS
    (`katex/dist/katex.min.css`) wird bewusst NICHT hier, sondern in
    `src/index.css` importiert – ein CSS-Import in `src/lib` würde die
    Node-Unit-Tests brechen (kein CSS-Loader in Vitest,
    `environment: "node"`). Bewusste Lücke: Enthält der TeX-Quelltext
    selbst ein rohes, ungepaartes `$` (z. B. ein escaptes `\$` MITTEN in
    einer Formel), kann das die Grenzen-Erkennung beim nächsten Parsen
    verwirren – seltener Sonderfall (LaTeX bietet dafür `\text{...}`),
    nicht eigens abgefangen. Für den Editor-Ladepfad ist dieser Fall
    unschädlich abgesichert: Das Eingabefeld verweigert dort ein rohes `$`
    von vornherein (Punkt 49).

47. **Formeln in der Dokument-Ansicht** (`src/lib/markdown.jsx`, v7.3):
    Display-Blöcke werden über `matchDisplayBlock` (math.jsx, Punkt 46)
    zeilenverankert erkannt (Zeile beginnt mit `$$`, bis zur Zeile, die
    mit `$$` endet – auch einzeilig `$$…$$` auf einer Zeile) und als
    eigener `<div>`-Block gerendert, NICHT in ein `<p>` verpackt. Liefert
    `matchDisplayBlock` `null` (kein sauberer Block – z. B. „$$x$$ mehr
    Text“ mit Inhalt NACH der schließenden `$$`, oder eine öffnende
    `$$`-Zeile ohne jede schließende Zeile im restlichen Dokument), fällt
    die Zeile bewusst durch zu den späteren Zweigen der Block-Erkennung
    und landet i. d. R. im normalen Absatz-Zweig, wo `renderInline` sie
    inline verarbeitet: „$$x$$ mehr Text“ wird dort korrekt als
    eingebetteter Display-Span erkannt, eine unterminierte `$$`-Zeile
    bleibt mangels Gegenstück literal stehen. Vorher wurde in beiden
    Fällen der komplette Rest des Abschnitts als TeX in einen
    (Fehler-)Block verschluckt – beim Code-Review gefunden (Finding 4) und
    mit Regressionstests in `tests/markdown.test.jsx` abgesichert.
    Inline-Formeln (`$…$`) laufen durch `renderInline`: Statt
    `MATH_TOKEN_RE` als weitere Alternative in den bestehenden
    `INLINE_TOKEN_RE`-Regex-String einzuweben (fragile Konkatenation von
    Regex-Quelltext, hätte die Formel-Regel aus `math.jsx` dupliziert),
    prüft `renderInline` beide Regexe PARALLEL pro Schleifendurchlauf und
    lässt bei Gleichstand die Formel gewinnen. Das garantiert, dass fett/
    kursiv/Links eine Formel nie mitten durchschneiden: Beginnt z. B.
    `**fett**` vor einer Formel, gewinnt fett zuerst und reicht seinen
    Inhalt rekursiv an `renderInline` zurück, das die Formel im nächsten
    Durchlauf normal erkennt; beginnt die Formel zuerst (z. B. `$x_i$`),
    kann die `_`-Emphase sie nicht anschneiden, weil deren Wortgrenzen-
    Regel einen Index-Unterstrich direkt hinter einem Buchstaben ohnehin
    nie erlaubt. Codespans (einfache Backticks) schützen ihren Inhalt
    automatisch, weil das Codespan-Token an seiner Startposition immer
    Vorrang hat und den kompletten Span als EIN Treffer konsumiert, bevor
    ein `$` darin separat geprüft wird – ebenso bleibt eine Zeile, die mit
    einem Codespan wie `` `$$x$$` `` beginnt, ein Codespan (die Zeile
    beginnt mit einem Backtick, nicht mit `$$`, der Display-Block-Regex
    matcht also gar nicht erst). `renumberCitations`/`CITE_LINK_RE`
    fassen TeX-Inhalte nicht an, weil deren Muster zwingend ein
    `[Zahl](https://…)` verlangt – eine Formel wie `$\left[1,2\right]$`
    erfüllt das nie (Regressionstest vorhanden). Ein ```-Codeblock-Fall
    ist im Renderer irrelevant: Die App unterstützt ohnehin keine
    ```-Codeblöcke (laut Editor-Konvention deaktiviert, siehe Punkt 14).

48. **Formeln im Chat & System-Prompt** (`src/App.jsx`,
    `src/lib/anthropic.js`, v7.3): Die String-Segmente aus
    `renderWithCites` (Quellen-Fußnoten-Rendering) laufen zusätzlich durch
    `expandMathInNodes`, sodass `$…$`/`$$…$$` in Assistenten-Antworten
    gerendert werden, OHNE die bestehenden hochgestellten Fußnoten-Links
    zu verändern (die sind bereits React-Elemente und werden von
    `expandMathInNodes` unangetastet durchgereicht). Nutzer-Nachrichten
    bekommen ebenfalls Formel-Rendering (Nutzerwunsch „ruhig auch“),
    reine Fehlermeldungen der App NICHT (technischer Text, kein
    Modell-/Nutzerinhalt). Der System-Prompt bekommt einen neuen
    Abschnitt „FORMELN“: Das Modell darf nach eigenem Ermessen `$…$`/
    `$$…$$` setzen, sowohl in `reply` als auch in `ops`-Inhalten, mit der
    ausdrücklichen Weisung, dafür NIE ```-Codeblöcke oder Unicode-„Kunst“
    zu verwenden und Währungsbeträge normal zu schreiben (kein
    $-Missbrauch). Regressionstest in `tests/anthropic.test.js` prüft die
    Kernphrasen wie bei den bestehenden Prompt-Verträgen.

49. **Formeln im WYSIWYG-Editor** (`src/components/DocEditor.jsx`, v7.3,
    kritischster Teil – Version nach Code-Review, ursprüngliche Fassung
    hatte drei vor dem Commit behobene Findings, siehe unten): TeX-
    Backslashes (`\frac`, `\Delta`) würden sowohl den serializer-eigenen
    Backslash-Escape-Mechanismus als auch die anschließende
    `unescapeMd`-Bereinigung (Punkt 14) nicht überstehen, liefe eine
    Formel als gewöhnlicher Fließtext durch den Editor. Deshalb – exakt
    wie `BlockImage`/`MdTable` – zwei eigene atomare Node-Erweiterungen
    `MathInline` (`group:"inline"`) und `MathBlock` (`group:"block"`) mit
    eigenem Storage/Serializer-Pfad: der TeX-Text steckt als Node-
    Attribut, die Serialisierung schreibt ihn UNVERÄNDERT (ohne
    `state.esc()`) als `$tex$` bzw. `$$tex$$` zurück. Beide Node-
    Erweiterungen sind aus `DocEditor.jsx` exportiert, ebenso `unescapeMd`
    – für einen echten TipTap-Roundtrip-Test (`tests/docEditorMath.test.jsx`,
    `@vitest-environment jsdom` NUR für diese eine Datei, der Rest der
    Suite bleibt bei `environment:"node"`), der die riskantesten Pfade
    gegen einen echten `@tiptap/core`-Lauf statt nur gegen den String-
    Output von `mathToPlaceholders` prüft (Review-Finding 6).
    - **Lade-Pfad (kontextbewusst, Review-Finding 1):** `mathToPlaceholders()`
      (math.jsx) wandelt `$…$`/`$$…$$` VOR dem tiptap-markdown-Parsing in
      `<math-inline>`/`<math-block>`-Tags mit einem `data-tex`-HTML-
      Attribut um (gleiches Vorbild wie `resolveImgs` für `img:`-
      Referenzen). Anders als `MATH_TOKEN_RE` (Chat/Zitate, Punkt 46) darf
      dieser Pfad NICHT blind übers gesamte Roh-Markdown laufen – die
      Dokument-Ansicht schützt Codespans und verankert `$$…$$` zeilenweise,
      der Editor muss exakt dieselbe Regel anwenden, sonst schreibt das
      bloße ÖFFNEN eines Dokuments (nach der nächsten echten Bearbeitung)
      Codespan-Inhalte oder über Absätze hinweg gepaarte `$$` still um.
      Deshalb: (1) Codespan-Split wie `renumberCitations`
      (markdown.jsx) – nur die geraden Segmente werden verarbeitet,
      Codespan-Inhalt bleibt Byte-für-Byte unangetastet. (2) `$$…$$` wird
      AUSSCHLIESSLICH über `matchDisplayBlock` (zeilenverankert, Punkt 46)
      erkannt, niemals über den gesamten Text hinweg; ein `$$`-Paar MITTEN
      in einer normalen Zeile bleibt bewusst unangetastet (eine „Bare-$$-
      Wache“ in der Inline-Regel verhindert, dass die Einzel-Dollar-
      Alternative opportunistisch hineinbeißt) – ein eingebetteter Block-
      Node mitten in einem Absatz würde von ProseMirror aus dem Absatz
      herausgelöst und diesen beim Speichern in mehrere Zeilen zerlegen
      (Struktur-Korruption). (3) Bildzeilen (`![Titel](img:id)`) werden
      komplett ausgenommen, damit ein `$` im Bildtitel nicht mitten in die
      Markdown-Bildsyntax hineingeschrieben wird, bevor sie geparst ist.
      Der TeX-Text landet dabei NICHT base64- oder sonst wie kodiert,
      sondern nur HTML-Attribut-escaped (`&`, `<`, `>`, `"`) – der
      Browser/jsdom decodiert das beim Auslesen über `el.getAttribute()`
      automatisch zurück, verifiziert mit Tests für Klammern,
      Anführungszeichen und mehrzeilige `$$…$$`-Blöcke (Zeilenumbrüche
      bleiben im Attribut erhalten). `html:true` reicht diese unbekannten
      Tags roh durch markdown-it durch (Punkt 15), die `parseHTML()`-
      Regeln der beiden Node-Erweiterungen fangen sie beim
      DOM→ProseMirror-Parsing ab. Dass markdown-it das Tag dabei stur in
      ein `<p>` einbettet (Inline-HTML landet immer in einem umgebenden
      Absatz), ist irrelevant – ProseMirror ordnet einen `group:"block"`-
      Node beim Parsen automatisch außerhalb ein, exakt das Verhalten,
      das `BlockImage` (ebenfalls block-level, aber aus Inline-Bild-
      Syntax) schon nutzt. Ausführlich mit einem Headless-Prototyp
      (`@tiptap/core` + jsdom, ohne React) gegen echte TipTap-Parser-/
      Serializer-Läufe verifiziert, bevor der Code in die Komponente
      übernommen wurde – daraus wurde `tests/docEditorMath.test.jsx`.
    - **`\$`-Escape via Sentinel-Zeichen (Review-Finding 2):** Ein
      escaptes Dollarzeichen darf beim Laden NICHT einfach zu einem
      nackten `$` aufgelöst werden – eine spätere echte Bearbeitung würde
      diese Normalisierung mitspeichern und (bei einem zweiten, weiter
      hinten stehenden `$`) still zu einer ungewollten Formel werden
      lassen. Erster Anlauf: `\$` als HTML-Entity (`&#92;$`) durchreichen,
      damit markdown-it sie beim Parsen zu einem echten Backslash-
      TEXTzeichen dekodiert, das der Standard-Serializer beim Speichern
      wieder verdoppelt und `unescapeMd` wieder auf einen Backslash
      reduziert. Das brach beim Testschreiben mit ZWEI `\$`-Escapes ohne
      Formel dazwischen (z. B. `"\$a\$"`): Die Formel-Schutz-Erkennung in
      `unescapeMd` (`MATH_SERIALIZED_RE`, die $…$-Muster im bereits
      serialisierten Text vor der Backslash-Bereinigung schützt) las
      `"$a\\$"` dabei fälschlich als EINE zusammenhängende, zu
      schützende Formel und ließ das zweite Escape unaufgelöst als
      Doppel-Backslash stehen – kein sauberer Roundtrip, nicht einmal
      idempotent. Endgültige Lösung: `ESCAPED_DOLLAR_SENTINEL`, ein
      Zeichen aus dem privaten Unicode-Bereich (U+E000, kommt in echten
      Notizen praktisch nie vor) ersetzt `\$` komplett. Der Sentinel ist
      für jede andere Regel in `math.jsx` unsichtbar (kein `$`, kein
      Backslash, keine Markdown-Bedeutung), fließt unangetastet durch
      markdown-it und den Standard-Serializer und wird erst ganz am Ende,
      in `unescapeMd`, UNBEDINGT (ohne jede Fallunterscheidung) zurück in
      `\$` verwandelt – dort kann er mit nichts kollidieren. Verifiziert
      inklusive Idempotenz-Test (zweifaches Laden+Speichern ohne Änderung
      liefert dasselbe Ergebnis) in `tests/docEditorMath.test.jsx`.
    - **TeX-Validierung im Eingabefeld (Review-Finding 3):** Der
      Serializer schreibt `$tex$`/`$$tex$$` ungeprüft. Ein rohes `$` im
      TeX würde die Formelgrenzen beim nächsten Laden verschieben oder
      die Formel ganz zu Klartext degradieren lassen (z. B. würde die
      Eingabe `"a $ b"` zu `"$a $ b$"` serialisiert, was `MATH_TOKEN_RE`
      gar nicht mehr als Formel erkennt). Da `$` als Formelgrenze
      reserviert ist, verweigert `commit()` bei einem rohen `$` in
      `MathInline` bzw. `$$` in `MathBlock` (einzelne `$` sind dort
      unkritisch – nur ein VERDOPPELTES `$$` kann die Blockgrenze
      verschieben) den Commit, statt den Node kaputt zu speichern, und
      lässt das Eingabefeld mit Fehlerstil (rote Kontur, Titel-Tooltip)
      offen stehen; der Stil verschwindet automatisch, sobald weiter-
      getippt wird. Getestet über echte DOM-Interaktion (Klick öffnet das
      Feld, `keydown`/`input`-Events) statt nur die Funktion isoliert
      aufzurufen.
    - **Bearbeiten:** Klick (nicht Doppelklick – bei einem atomaren Node
      hätte Doppelklick zusätzliche Selektions-Timing-Fallstricke, Klick
      ist direkter) auf die gerenderte Formel öffnet ein einfaches
      `<input>` mit dem TeX-Quelltext (kein `window.prompt`). Enter und
      Blur bestätigen (Klick auf „Speichern“ während der Bearbeitung
      committet die Änderung also VOR dem eigentlichen Speichern), Escape
      bricht ab und stellt den unveränderten Original-Text wieder her.
      Leerer TeX beim Bestätigen löscht den Node gezielt (`tr.delete`),
      dieselbe gezielte Löschung greift, wenn eine frisch über den
      Toolbar-Knopf eingefügte, noch nie bestätigte Formel per Escape
      verworfen wird (erkennbar daran, dass ihr TeX-Attribut leer ist –
      ein bereits gespeichertes Dokument kann laut `MATH_TOKEN_RE` nie
      einen Formel-Node mit leerem TeX enthalten, die Inline-Alternative
      verlangt mindestens ein Zeichen Inhalt). `getPos()` wird dafür
      IMMER frisch zum Zeitpunkt der Aktion gelesen und auf `"number"`
      geprüft, statt nur auf `typeof getPos === "function"` (Review-
      Vorschlag 8): Nach einer Zerstörung des Nodes kann `getPos()`
      `undefined` liefern, ein ungeprüfter `tr.delete(undefined, NaN)`
      würde werfen. Bewusst KEIN `editor.commands.undo()` für den
      Verwerfen-Fall: Ein `undo()`-Ansatz wäre zwar „perfekter“ (stellt
      den Dokumentstand exakt vor dem Einfügen wieder her), birgt aber
      ein echtes Risiko – passierten zwischen Einfügen und Abbrechen
      ANDERE, unabhängige Bearbeitungen, würde `undo()` den zuletzt
      gemachten Schritt zurücknehmen, der nicht zwangsläufig die Formel-
      Einfügung ist, und könnte so unbemerkt fremde Nutzeränderungen
      verwerfen. Der gezielte `tr.delete` ist dafür in einem sehr
      seltenen Randfall (Block-Formel MITTEN in einem bestehenden Absatz
      eingefügt und sofort wieder verworfen) nicht ganz byte-identisch
      mit dem Vorzustand (der Absatz kann in zwei Absätze gesplittet
      bleiben) – ein bewusst in Kauf genommener, rein kosmetischer Rest.
    - **Toolbar:** Zwei Knöpfe (`Sigma`-Icon für Inline, `SquareFunction`-
      Icon für Display/abgesetzt aus lucide) statt eines Knopfs mit
      Shift-Modifikator – zwei separate, selbsterklärende Knöpfe sind
      auf Touch-Geräten (kein Shift-Klick) zuverlässiger bedienbar.
    - **BUGFIX in `MdTable`** (beim Testen der neuen Formel-Nodes
      gefunden): Der bestehende Zellen-Serializer prüfte
      `cell.firstChild.textContent.trim()`, um leere Zellen zu
      überspringen. Für eine Zelle, deren einziger Inhalt ein Inline-
      ATOM ohne Text ist (z. B. jetzt eine Formel – `textContent`
      liefert bei Atomen immer `""`), war diese Prüfung fälschlich
      falsy: `state.renderInline` wurde nie aufgerufen, der Inhalt fiel
      beim Speichern lautlos weg. Fix: eine Zelle gilt als „hat
      renderbaren Inhalt“, wenn ihr erster Absatz mindestens ein Kind hat,
      das KEIN reiner harter Zeilenumbruch ist (`cellHasRenderableContent`)
      – erkennt Text UND Atome korrekt, eine wirklich leere Zelle ODER
      eine Zelle, deren einziger Inhalt ein/mehrere `hardBreak` sind
      (Umschalt+Enter in einer sonst leeren Zelle – sonst würde ein
      echter Zeilenumbruch mitten in die Pipe-Zeile geschrieben und die
      Tabelle beim nächsten Öffnen zerreißen, Review-Vorschlag 7), bleibt
      weiterhin leer. Der ursprüngliche Bug betraf vor v7.3 praktisch nie
      etwas Sichtbares, weil es bis dahin keine Inline-Atom-Nodes im
      Schema gab (Bilder sind block-level und lassen sich – geprüft –
      ohnehin nicht in eine Tabellenzelle einfügen, weder im Editor noch
      im zeilenbasierten Renderer, der `![…]` innerhalb von
      Tabellenzellen gar nicht als Bild erkennt).
    - **`unescapeMd` ist formel-bewusst UND exportiert (Review-Finding 6):**
      TeX enthält legitime Backslash-Sequenzen wie `\{ \} \_ \( \)`
      (Mengen-/Intervall-Notation), die exakt wie Serializer-Escapes
      aussehen und sonst kaputt entfernt würden (`\{1,2\}` → `{1,2}`).
      Split über `MATH_SERIALIZED_RE` (math.jsx) – bewusst OHNE die
      `\$`-Escape-Alternative von `MATH_TOKEN_RE`: An dieser Stelle im
      Ablauf (nach dem Serializer) gibt es kein `\$` mehr zu schützen
      (siehe Sentinel-Ansatz oben), die Node-Serializer erzeugen niemals
      eins; MIT der `\$`-Alternative würde ein wörtlich getippter
      `\$`-Text (vom Standard-Serializer zu `\\$`, drei Zeichen,
      escaped) fälschlich als Formel-Segment erkannt und die nötige
      Entfernung des führenden Backslashs übersprungen. `unescapeMd`
      selbst ist jetzt aus `DocEditor.jsx` exportiert, damit Tests die
      ECHTE Funktion prüfen statt eine im Test nachgebaute Kopie.
    - **No-op-Vergleich bleibt intakt:** `baseline.current` wird NACH
      `mathToPlaceholders()` erfasst, Speichern-ohne-Änderung vergleicht
      also verarbeitet-gegen-verarbeitet und bleibt ein No-op – verifiziert
      mit echtem TipTap-Lauf inklusive Codespan- und Absatz-Randfällen
      in `tests/docEditorMath.test.jsx`.
    - **Bundle-Zuwachs:** `katex` vergrößert den Haupt-JS-Bundle um rund
      +268 KB roh / +79 KB gzip sowie `index.css` um rund +32 KB roh /
      +9 KB gzip (KaTeX-CSS inkl. Basis-Icon-/Layout-Regeln). Dazu kommen
      ca. 60 KaTeX-Webfont-Dateien (WOFF/WOFF2/TTF, mehrere Schnitte) im
      `dist/assets`-Verzeichnis – der Browser lädt davon nur die
      tatsächlich für gerenderte Glyphen benötigten Dateien nach, nicht
      alle auf einmal.

50. **Formeln im WYSIWYG-Editor, Re-Review-Nacharbeit** (`src/lib/math.jsx`,
    `src/components/DocEditor.jsx`, v7.3, Nachtrag zu Punkt 46/49): Ein
    zweiter Review-Durchgang fand einen weiteren kritischen Restfall in
    `mathToPlaceholders` sowie zwei Warnungen; alle behoben, mit echten
    Tests belegt (`tests/math.test.jsx`, `tests/docEditorMath.test.jsx`).
    - **R1 (kritisch): `matchDisplayBlock` suchte unbegrenzt weiter.**
      Der Editor-Ladepfad sieht (anders als der Viewer, der über
      `parseTree` schon vorher in Abschnitte zerlegt) ein ganzes Dokument
      bzw. -Segment am Stück. Eine öffnende `$$`-Zeile OHNE echte Formel
      dahinter (z. B. Dollar-Slang wie „$$$ teuer“, in finanzlastigen
      Notizbüchern realistisch) paarte sich über Leerzeilen UND
      Überschriften hinweg mit einer beliebigen späteren `$$`-Zeile zu
      EINEM `<math-block>`-Tag, dessen `data-tex`-Attribut Leerzeilen und
      ggf. eine echte Überschrift enthielt – markdown-it (html:true)
      zerreißt so ein Tag nachweislich in Fragmente (empirisch vom
      Reviewer mit den echten Modulen belegt). Fix: `matchDisplayBlock`
      bricht die Suche nach der Schlusszeile jetzt an einer harten Grenze
      ab (`DISPLAY_MATH_BOUNDARY_RE` – Leerzeile ODER Überschriftenzeile
      `#`/`##`/`###`) und liefert dann `null` statt weiterzusuchen. Eine
      Leerzeile mitten in echtem Display-TeX ist ohnehin ungültiges
      LaTeX, der Abbruch kostet also nichts; der Überschriften-Abbruch
      verhindert zusätzlich das Paaren über Abschnittsgrenzen hinweg,
      selbst ohne dazwischenliegende Leerzeile. Da `matchDisplayBlock`
      die EINE gemeinsame Quelle der Wahrheit für Viewer UND Editor ist
      (Punkt 46), profitiert auch der Viewer automatisch vom selben,
      strengeren Abbruch. Regressionstest mit exakt dem vom Reviewer
      beschriebenen Dokument (öffnende `$$`-Zeile, Überschrift, spätere
      `$$`-Zeile) über einen echten TipTap-Lauf.
    - **R2 (Warnung): globaler Codespan-Split vor dem Zeilen-Split.**
      `mathToPlaceholders` teilte ursprünglich das GESAMTE Dokument am
      Codespan-Muster, BEVOR es zeilenweise verarbeitet wurde. Eine
      Zeile, die mit einem Codespan beginnt und mit einem einzeiligen
      `$$…$$`-Paar endet (z. B. „`x` $$y$$“), wurde dadurch zu einem
      Zeilen-FRAGMENT nach dem Codespan-Ende, das fälschlich wie der
      Anfang einer eigenen Zeile aussah und daher selbst als
      Display-Block-Start erkannt wurde – ein Block-Node MITTEN in der
      ursprünglichen Zeile hätte ProseMirror dazu gebracht, den Absatz
      beim nächsten Speichern in zwei Blöcke zu zerlegen (stille
      Struktur-Umschreibung). Fix: Reihenfolge gedreht – `mathToPlace-
      holders` arbeitet jetzt zeilenweise auf dem UNGETEILTEN Dokument
      (die Blockprüfung über `matchDisplayBlock` sieht so immer die
      echte Zeile), der Codespan-Split (`CODESPAN_SPLIT_RE`) wird erst
      PRO ZEILE für den Inline-Durchlauf angewendet – Codespans können
      ohnehin keine Zeilenumbrüche enthalten, ein Split pro Zeile ist
      dafür ausreichend und sicherer als ein globaler Split davor.
    - **R3 (Testqualität): `MdTable` erneut als Kopie im Roundtrip-Test.**
      Exakt das Muster aus Finding 6, nur auf die Tabellen-Erweiterung
      verschoben. `MdTable` ist jetzt ebenfalls aus `DocEditor.jsx`
      exportiert und wird im Test importiert statt nachgebaut; ein neuer
      Test deckt den Randfall aus Vorschlag 7 direkt ab (Zelle, deren
      einziger Inhalt ein harter Zeilenumbruch ist, wird leer
      serialisiert statt einen Zeilenumbruch mitten in die Pipe-Zeile zu
      schreiben).
    - **R4 (Vorschlag): Sentinel-Kollision.** Stünde
      `ESCAPED_DOLLAR_SENTINEL` bereits VOR der Verarbeitung im Dokument
      (extrem selten – z. B. aus eingefügtem Text mit privaten
      Icon-Fonts), hätte `unescapeMd` es beim nächsten Speichern
      bedingungslos zu einem `\$`-Escape gemacht. Fix:
      `mathToPlaceholders` neutralisiert ein bereits vorhandenes
      Sentinel-Zeichen als ALLERERSTEN Schritt (Ersetzung durch das
      Unicode-Replacement-Character U+FFFD), bevor irgendetwas sonst
      verarbeitet wird.
    - **R5 (Vorschlag): `data-tex` escapte das Pipe-Zeichen nicht.** Ein
      rohes `|` im Attributwert wäre innerhalb einer GFM-Tabellenzeile
      ununterscheidbar von einem Zellentrenner gewesen – markdown-it
      zerteilt Pipe-Tabellenzeilen textbasiert VOR jeder
      HTML-Interpretation und hätte das Tag in Zell-Fragmente zerrissen.
      Fix: `escapeHtmlAttr` codiert `|` zusätzlich als numerische Entity
      (`&#124;`), `getAttribute()` decodiert sie beim Parsen zuverlässig
      zurück. Bekannte Restgrenze: Der Node-Serializer schreibt das Pipe
      beim SPEICHERN roh in `$tex$` zurück (kein `state.esc()`) – eine
      Formel mit Pipe in einer Tabellenzelle bleibt nach dem nächsten
      Speichern verwundbar, exakt wie unescapte Pipes in normalem
      Zellentext schon vorher (vorbestehende Grenze, kein neues Problem).
    - **R6: bekannte, verlustfreie Anzeige-Divergenzen Editor/Viewer**
      (Roundtrip bleibt in beiden Fällen byte-identisch, nur die
      Live-Anzeige beim Bearbeiten weicht ab – dokumentiert, damit der
      E2E-Tester sie nicht als Bug meldet, siehe auch
      `docs/TESTFAELLE.md`): (a) ein einzeiliges `$$…$$`-Paar MITTEN in
      einer Zeile (nicht am Zeilenanfang) bleibt im Editor bewusst
      literal (siehe Punkt 46/49 – Struktur-Korruption-Vermeidung), der
      Viewer rendert es dagegen als eingebetteten Display-Span mitten im
      Absatz. (b) Eine Zeile mit einem Codespan gefolgt von `$$…$$` auf
      derselben Zeile bleibt im Editor ebenfalls komplett literal (siehe
      R2), der Viewer rendert Codespan und Formel nebeneinander. Ein
      einzeiliges `$…$`-Paar (einfaches Dollar) nach einem Codespan wird
      dagegen in BEIDEN Pfaden korrekt als Formel erkannt – nur `$$…$$`
      außerhalb des Zeilenanfangs ist von der Divergenz betroffen.

51. **Fix-Paket v7.4** (`src/App.jsx`, `docs/TESTFAELLE.md`, QA-Findings
    C4/C9/D2 aus dem v7.3-Tester-Lauf):
    - **C4 – Zeitstempel an allen Chat-Nachrichten:** Bisher zeigte nur
      eine Antwort MIT Dokument-Commit eine Uhrzeit (in der
      Commit-Badge). Jetzt bekommt jede Nachricht mit `ts` (`WELCOME`
      hat bewusst `ts:0`, bleibt also ohne) eine dezente Zeile
      `text-[10px] text-slate-400` unter der Bubble – rechtsbündig bei
      Nutzer-, linksbündig bei Assistenten-Nachrichten (folgt einfach
      dem `items-end`/`items-start` des umgebenden `flex-col`, keine
      eigene Ausrichtungslogik nötig). Bei Nachrichten MIT Commit-Badge
      bleibt es bei der Zeit in der Badge – keine doppelte Zeitangabe.
      Reiner UI-Fix ohne `src/lib`-Berührung, daher kein neuer
      Unit-Test; abgedeckt durch den E2E-Testfall C4.
    - **C9 – Testfall-Erwartung korrigiert (kein Code-Fix):** Der
      Speicher-Prompt „Notiere den Satz des Pythagoras mit gerenderter
      Formel“ schrieb die Formel korrekt ins Dokument und bestätigte im
      Chat nur kurz – exakt die REINE-FRAGEN/Bestätigungs-Regel aus
      Punkt 41 (v7.1), kein Bug. C9 wurde in C9a (reine Frage ohne
      Speicherauftrag → Formel MUSS im Chat gerendert erscheinen) und
      C9b (Speicherauftrag → Formel MUSS im Dokument gerendert
      erscheinen, Chat darf nur bestätigen) aufgeteilt, damit die
      Erwartung zur gewollten Modell-Regel passt.
    - **D2 – bekannte Grenze dokumentiert (kein Code-Fix):** Eine
      Tabelle, die exakt am Zeilenende eines Listenpunkts eingefügt
      wird, landet im Editor-DOM innerhalb des `<li>` statt danach. Die
      Ansicht rendert trotzdem korrekt und der Roundtrip bleibt
      byte-stabil (ProseMirror/ProseMirror-Serializer geben denselben
      Markdown-Text zurück) – bewusst akzeptierte Grenze, nicht
      behoben, da eine Sonderbehandlung „Tabelle direkt nach Cursor am
      Listenende“ deutlich mehr Editor-Komplexität kosten würde, als
      der seltene Randfall rechtfertigt. In `docs/TESTFAELLE.md` bei D2
      als bekannte Divergenz vermerkt, damit der Tester sie nicht als
      Finding meldet.

52. **Reply-Kürze-Regel auf Speicher-Aufträge begrenzt** (`src/lib/anthropic.js`,
    v7.5, QA-Finding C9a aus dem v7.4-Retest): Der Prompt aus Punkt 41
    (v7.1) drückte reply generell auf „ohne Auffälligkeiten nur kurze
    Bestätigung (1–2 Sätze)“ – gedacht für Bestätigungen NACH
    Speicher-Aufträgen, wurde vom Modell aber auch auf reine Fragen/
    Erklär-Bitten angewendet. Live-Symptom: „Erkläre kurz den Satz des
    Pythagoras mit Formel – nur erklären, nichts speichern“ bekam nur
    einen Verweis „steht schon im Notizbuch X“ statt einer Erklärung.
    Fix: ANTWORTFORMAT-Regel, `reply`-Beschreibung im
    `NOTEBOOK_TOOL`-Schema und der REINE-FRAGEN-Block differenzieren
    jetzt explizit: bei Speicher-Aufträgen bleibt reply die kurze
    Bestätigung (mit Auffälligkeiten bis ca. 200 Wörter), bei reinen
    Fragen/Erklär-Bitten OHNE Speicherauftrag ist reply die
    VOLLSTÄNDIGE inhaltliche Antwort inklusive Formeln – ein Verweis
    auf bereits Gespeichertes ist dabei nur als Ergänzung erlaubt und
    ersetzt die Antwort nie. Regressionstest in
    `tests/anthropic.test.js` prüft die Kernphrasen in System-Prompt
    UND Tool-Schema. Restrisiko: reine Prompt-Schärfung, keine
    strukturelle Erzwingung – ein Modell könnte die Differenzierung im
    Einzelfall weiterhin verfehlen; das nächste E2E-Retest von C9a
    deckt das ab.
