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

53. **buildChatReply-Gate entschärft: Vorab-Text auch ohne Websuche
    kombiniert** (`src/lib/anthropic.js`, v7.6, QA-Finding C9a – Fortsetzung
    von Punkt 52/v7.5): Der v7.5-Retest zeigte den ECHTEN Grund für den
    weiterhin roten Testfall. Ursachen-Historie zur Nachvollziehbarkeit:
    - **v7.4:** Die generelle Reply-Kürze-Regel (Punkt 41/v7.1) ließ das
      Modell auf reine Fragen nur mit einem Verweis auf Bestehendes
      antworten statt zu erklären.
    - **v7.5 (Punkt 52):** Prompt differenziert Speicher-Auftrag vs. reine
      Frage – reicht laut Retest nicht: Das Modell schrieb die vollständige
      Erklärung (inkl. Formel) weiterhin als Textblock VOR dem
      abschließenden Tool-Aufruf und verwies in reply nur mit „Erklärung
      oben – …“ darauf. `buildChatReply` (die Funktion, die Vorab-Textblöcke
      mit reply kombiniert) wurde in `callClaude` aber nur bei
      `usedSearch===true` aufgerufen – ohne Websuche wurde der Textblock
      STILLSCHWEIGEND VERWORFEN. Ergebnis: reply verwies auf ein „oben“,
      das im Chat nie sichtbar war – kompletter Inhaltsverlust. Der v7.5-
      Prompt-Zusatz „Nach einer Websuche gilt weiterhin die
      INTERNET-RECHERCHE-Regel: vollständige Antwort als Text VOR dem
      Tool-Aufruf …“ hat das Modell dabei vermutlich zusätzlich ermutigt,
      auch ohne Suche Vorab-Text zu schreiben.
    - **v7.6 (dieser Punkt) – beides, defensiv:**
      1. **Prompt-Klarstellung:** ANTWORTFORMAT und INTERNET-RECHERCHE
         verbieten jetzt explizit, OHNE Websuche Text vor dem Tool-Aufruf
         zu schreiben oder in reply auf „oben“/einen vorherigen Abschnitt
         zu verweisen – die komplette Antwort gehört dann direkt und
         vollständig ins reply-Feld. Der Websuche-Fall bleibt unverändert.
      2. **Code-Sicherheitsnetz:** `callClaude` ruft `buildChatReply` jetzt
         IMMER auf (nicht mehr nur bei `usedSearch`) – Vorab-Textblöcke
         werden also auch ohne Websuche mit reply kombiniert statt
         verworfen. Bestehende Schutzmechanismen bleiben unverändert
         wirksam: die Payload-Heuristik überspringt JSON-/Codeblock-Leaks,
         der exakte String-Vergleich verhindert doppelte Bestätigungen.
         Quellen/cite-Marker bleiben strikt an echte Websuchen gebunden
         (hits-Argument bei `!usedSearch` explizit `[]`, zusätzlich zur
         ohnehin leeren `sources`-Liste ohne `web_search_tool_result`) –
         ohne Suche entsteht also nie eine erfundene Quellenliste.
         Nebenbefund beim Testen: `textBlocks` sammelte bislang auch Prosa
         aus VERWORFENEN Zwischenversuchen (z. B. eine Antwort ganz ohne
         Tool-Aufruf, die einen erzwungenen Nachfass-Versuch auslöst) –
         ohne Gegenmaßnahme wäre dieser Entwurfstext in die finale Antwort
         durchgesickert. Fix: `textBlocks` wird an den beiden echten
         Neustart-Stellen (Websuche-nicht-verfügbar-Fallback,
         letzte-Rettung-„none“-Fallback) sowie beim Nachfass-Versuch OHNE
         Websuche geleert. MIT Websuche bleibt `textBlocks` beim
         Nachfass-Versuch dagegen ERHALTEN (siehe Re-Review-Korrektur 🔴 1
         unten) – nur ein Textblock aus einem tatsächlich verworfenen
         Entwurf (kein Tool-Aufruf, keine Recherche) wird gelöscht.
      Begründung für die Code-Änderung: Inhaltsverlust (Antwort komplett
      weg) ist der schwerwiegendere Fehler als eine gelegentliche
      Preamble-Doppelung; der Prompt-Fix aus Schritt 1 minimiert
      Vorab-Text ohne Suche von vornherein, das Sicherheitsnetz fängt nur
      den Rest ab. Restrisiko: bei einer echten Websuche MIT
      pause_turn/lookup_wissen-Zwischenschritten UND zusätzlicher, nicht
      zitierfähiger Prosa in einem Zwischenschritt könnte diese Prosa
      (bisher schon, unverändert) in die finale Antwort einfließen – kein
      neues Risiko durch diese Änderung, aber nicht separat getestet.
    - **Re-Review (v7.6, vor Freigabe) – zwei Findings, beide behoben:**
      - 🔴 (Muss): Der erste Entwurf leerte `textBlocks` am
        Forced-Nachfass UNCONDITIONAL – das verwarf auch LEGITIME
        Recherche-Prosa (Websuche gelaufen, Modell schreibt die
        vollständige zitierte Antwort als Text, vergisst nur den
        Tool-Aufruf → Nachfass hätte die Prosa gelöscht, der Nutzer sähe
        nur noch die Kurz-Bestätigung plus bis zu 6 stale „konsultierte
        Quellen“ ohne zugehörigen Text). Fix: `if (!usedSearch)
        textBlocks.length = 0;` – der Reset greift nur noch für den
        echten Entwurf-ohne-Recherche-Fall, der Suche-Fall behält seine
        Prosa. Regressionstest: „Suche + fehlender Tool-Aufruf: Forced-
        Nachfass behält die bereits zitierte Recherche-Prosa“ in
        `tests/anthropic.test.js`.
      - 🟡: Durch den Gate-Wegfall wird auch Lookup-Zwischenprosa
        („Ich schaue in der Datei nach …“) sichtbar und bei mehreren
        `lookup_wissen`-Runden aneinandergehängt. Fix: Prompt-Satz im
        HINTERGRUNDWISSEN-/Lookup-Block ergänzt – keine Freitext-Sätze
        zwischen `lookup_wissen`-Aufrufen, alles Inhaltliche gehört ins
        reply-Feld. Regressionstest pinnt die neue Phrase.
      - 🟡 (Testlücke): Zwei ergänzende Tests: (i) Suche + Prosa +
        fehlender Tool-Aufruf → Forced-Nachfass → Prosa bleibt erhalten
        (fängt genau das 🔴-Finding); (ii) ohne Suche + Prosa-Entwurf ohne
        Tool-Aufruf → Nachfass → Entwurf erscheint NICHT in der finalen
        Antwort (Gegenprobe, damit der Fix nicht zu weit öffnet).
      Alle Tests aus `tests/anthropic.test.js` (bisherige UND neue, damit
      (a)–(d) aus der Erstversion sowie (i)/(ii) aus dem Re-Review) grün;
      der vorbestehende, bewusst nicht angefasste Punkt „stale
      usedSearch/sources an den Fallback-Stellen“ bleibt als bekannte,
      kleinere Ungenauigkeit außerhalb dieses Fixes.

54. **Monospaced Codeblöcke (```-Fences) – voller Support in Dokument-
    Ansicht, WYSIWYG-Editor und Chat** (v7.7, Nutzerwunsch „sowohl für die
    Darstellung als auch beim Editieren“). Hebt die Codeblock-Deaktivierung
    aus Punkt 14 (v4.1) auf; Inline-Codespans (`` `x` ``) funktionierten
    bereits überall, fehlten nur noch mehrzeilige Fenced-Blöcke.
    - **Gemeinsame Fence-Erkennung (`src/lib/code.jsx`, neu):** eigene Datei
      statt in `markdown.jsx` oder `math.jsx`, weil BEIDE die Logik
      brauchen und `markdown.jsx` bereits von `math.jsx` importiert – ein
      Re-Import wäre ein Zirkelbezug (gleiches Muster wie
      `IMG_LINE_RE_FOR_MATH` in `math.jsx`). `matchFenceBlock(lines,
      startIdx)` sucht ab einer öffnenden Zaun-Zeile (DREI ODER MEHR
      Backticks, bis zu drei Leerzeichen Einrückung, KEIN Tab – siehe
      Re-Review-Fix unten) die schließende Zaun-Zeile, die MINDESTENS so
      lang sein muss wie der öffnende Zaun (CommonMark-Regel, identisch
      von markdown-it umgesetzt); `null` bedeutet „kein Block“
      (unterminiert), NICHT „Fehler“ – der Aufrufer lässt die Zeile dann
      unverändert/normal weiterlaufen statt den Rest zu verschlucken
      (gleiche konservative Philosophie wie `matchDisplayBlock` bei einem
      unterminierten `$$`). Das Info-String nach dem Zaun darf laut
      CommonMark Leerzeichen enthalten (nur Backticks sind verboten, sonst
      wäre der Zaun nicht von Inline-Code unterscheidbar) – nur das ERSTE
      Wort wird als Sprach-Label übernommen (identisch zu markdown-it, das
      ebenfalls nur das erste Wort für die `language-xxx`-Klasse nutzt).
      Anders als bei Formeln ist dabei KEINE Abbruchgrenze an Leerzeilen/
      Überschriften nötig: Der Zaun selbst ist ein eindeutiges Start/Ende-
      Paar, Leerzeilen und „#“-Zeilen INNERHALB eines Codeblocks sind
      legitimer Code-Inhalt (Kommentare, Markdown-Beispiele in einem
      Snippet). `splitFenceSegments(text)`
      zerlegt einen (ggf. mehrzeiligen) Text in Segmente außerhalb/
      innerhalb GESCHLOSSENER Fences, jedes Segment trägt `raw` für eine
      byte-genaue Rekonstruktion (`segments.map(s => s.raw).join("\n")`);
      unterminierte Zäune zählen NICHT als Code und bleiben Teil des
      umgebenden Text-Segments – das gilt konsistent für Dokument-Ansicht,
      Chat UND den `mathToPlaceholders`-STRING selbst (reines
      String-Verhalten dieser Datei). WICHTIGE EINSCHRÄNKUNG (siehe
      „Re-Review P10“ weiter unten): Der ECHTE Editor lädt nicht den
      String, sondern lässt markdown-it darüber laufen – und markdown-it
      behandelt einen unterminierten Zaun STRUKTURELL anders als unsere
      String-Helfer (es verschluckt alles bis Dokumentende in EINEN
      Codeblock, statt die Zeile wie ein literaler Absatz zu behandeln).
      Viewer/Chat und der echte Editor zeigen einen solchen GIGO-Fall
      (z. B. eine abgeschnittene Modellantwort) deshalb bewusst
      UNTERSCHIEDLICH an (Viewer/Chat: normale Absätze/Listen; Editor: EIN
      Codeblock bis Dokumentende) – beide bleiben aber inhaltlich
      verlustfrei (kein Text geht verloren), und der P10-Fix stellt
      zusätzlich sicher, dass dabei kein Formel-Platzhalter-Tag in den vom
      Editor gebildeten Codeblock hineinleakt. `CodeBlockView` ist die
      gemeinsame React-
      Darstellung (Dokument UND Chat): `pre`/`code`, `font-mono text-sm`,
      dezenter Hintergrund (`bg-slate-50`) + Rahmen + `rounded-lg`,
      `whitespace-pre` (Einrückung bleibt exakt), `overflow-x-auto` NUR im
      eigenen Container (Nutzerauftrag: die Seite/Bubble darf dadurch nie
      quer scrollen). Bewusst KEIN Syntax-Highlighting (keine neue
      Abhängigkeit) – das Sprach-Label wird gespeichert und klein
      angezeigt, aber nicht ausgewertet.
    - **Dokument-Ansicht (`src/lib/markdown.jsx`):** `renderBlocks` prüft
      pro Zeile zusätzlich `FENCE_OPEN_RE`/`matchFenceBlock` (zeilenanfang-
      verankert wie `mathBlock`, gleiche Priorität in der if/else-Kette)
      und rendert einen Treffer als `CodeBlockView`, wobei `li` auf
      `endIdx` vorspringt – GENAU EIN Renderer-Durchlauf verschluckt den
      kompletten Block, die inneren Zeilen werden vom zeilenweisen Loop nie
      einzeln erneut betrachtet (kein Risiko, dass ein `$$` oder eine
      Bildzeile INNERHALB des Codes fälschlich eigene Blöcke erzeugt). Im
      Block-Inhalt läuft NICHTS: kein `renderInline`, keine Math-/Bild-/
      Fußnoten-/Checklisten-Logik – der Inhalt bleibt byte-genau. Da
      `parseTree` abschnittsweise mit Original-Zeilenindizes arbeitet
      (Checklisten-Klicks) und Codeblöcke innerhalb EINER Section/Sub-
      Section bleiben (die Section-Grenzen stehen schon vor dem Fence-
      Scan fest), verrutscht kein Zeilenindex für nachfolgende
      Checklisten-Einträge.
    - **WYSIWYG-Editor (`src/components/DocEditor.jsx`):** StarterKits
      eingebaute `codeBlock`-Node bleibt über `StarterKit.configure({
      codeBlock: false })` deaktiviert; stattdessen `FencedCodeBlock`
      (`CodeBlockExtension.extend({...})`, gleicher Node-Name „codeBlock“,
      toggle-/Tastatur-Verhalten bleibt über `.extend()` erhalten) mit
      EIGENEM Serializer. Grund (Re-Review-Fix K1, siehe unten): der
      `tiptap-markdown`-Standard-Serializer für `codeBlock` schreibt IMMER
      exakt drei Backticks und verlängert den Zaun NICHT, wenn der
      Code-Inhalt selbst eine Backtick-Serie enthält – bei aktiviertem
      StarterKit-Standard-`codeBlock` hätte ein Codeblock mit einer
      ```-Zeile ALS INHALT (das von der App aktiv beworbene Szenario
      „Markdown-Beispiel im Snippet“) beim Speichern progressiv
      korrumpiert. `FencedCodeBlock` berechnet die Zaunlänge dynamisch
      (längste Backtick-Serie im Inhalt + 1, mindestens 3 – exakt die
      CommonMark-Regel, die `matchFenceBlock` beim Lesen umgekehrt
      anwendet) und schreibt `state.text(node.textContent, false)` weiter
      OHNE `state.esc()` roh durch. Ein Headless-TipTap-Roundtrip-Test
      (`tests/docEditorCode.test.jsx`, Vorbild `docEditorMath.test.jsx`)
      bestätigt das empirisch statt es nur anzunehmen: No-op-Baseline
      (laden + sofort speichern ändert nichts byte-genau, auch mit
      Sprach-Label, Leerzeilen im Code, Nachbarschaft zu Formeln), dass
      `$`, `$$`, `|`, Backticks und Serializer-escape-artige Backslashes
      (`\.`, `\-`, `\_`, `\*`) im Code-Inhalt weder von `unescapeMd` noch
      vom Formel-Ladepfad angefasst werden, UND dass ein Codeblock mit
      einer eigenen ```-Zeile über ZWEI Roundtrips stabil bleibt (kein
      progressiver Zerfall, K1-Regressionstest). Toolbar-Knopf
      „Codeblock“ (lucide `Code2`) neben dem bestehenden Inline-Code-Knopf,
      `editor.chain().focus().toggleCodeBlock().run()`.
      `unescapeMd` (`DocEditor.jsx`) wird dafür fence-bewusst: Vor der
      bisherigen Formel-Aussparung (`MATH_SPLIT_RE`) trennt
      `splitFenceSegments` zuerst Codeblöcke komplett ab (`seg.raw`
      unverändert durchgereicht) – ohne diese Trennung hätte die
      Backslash-Bereinigung `\.`/`\-`/`\_`/… mitten in echtem Code
      (Regexes, CLI-Escapes) kaputt entfernt. Da Formel-Nodes laut Schema
      nicht INNERHALB eines `codeBlock`-Nodes vorkommen können (`content:
      "text*"`), ist die Trennung Fence-zuerst/Formel-danach
      überschneidungsfrei.
    - **Editor-Ladepfad (`src/lib/math.jsx`, `mathToPlaceholders`):** vierte
      Schutzmaßnahme (neben Display-Block/Codespan/Bildzeile, siehe Punkt
      46ff): Eine erkannte, GESCHLOSSENE Fence wird als GANZER Block
      (Zaun-Zeilen + Inhalt) roh in die Ausgabe übernommen, BEVOR die
      Zeilen einzeln gegen Bild-/Formel-Regeln laufen – ein `$`/`$$`
      INNERHALB eines Snippets (Shell-Variablen, Beispiel-Preise in
      Logs) wird dadurch nie zu einem Formel-Node. Ein unterminierter
      Zaun fällt bewusst durch zu den bestehenden Zweigen (die Zaun-Zeile
      selbst enthält ohnehin kein `$`).
    - **Bekannte Fallstricke aktiv abgesichert (alle mit Tests):**
      (a) `renumberCitations` (`markdown.jsx`) splittete bisher nur an
      Inline-Codespans – ein `[1](https://…)` INNERHALB eines Fenced-
      Blocks (z. B. Beispiel-Markdown in einem Snippet) wäre umnummeriert
      worden. Fix: `splitFenceSegments` trennt Codeblöcke VOR der
      bisherigen Codespan-Logik ab, `numByUrl` bleibt eine gemeinsame Map
      über alle Segmente hinweg (dieselbe URL vor UND nach einem
      Codeblock bekommt weiterhin dieselbe Nummer). Betrifft auch
      `chatToMarkdown`/`archive.js` (ruft `renumberCitations` archivweit
      auf) – Regressionstest mit einem Bash-Snippet im Chat-Text bestätigt
      den durchgereichten Fix.
      (b) `mathToPlaceholders` (Editor-Ladepfad) arbeitete zeilenweise mit
      Codespan-Schutz PRO ZEILE – ein `$…$`/`$$…$$` INNERHALB eines
      mehrzeiligen Fenced-Blocks wäre fälschlich zu einem Formel-Node
      geworden. Siehe oben („Editor-Ladepfad“).
      (c) `chatToMarkdown` (`archive.js`) reicht Nachrichtentexte roh
      durch – verifiziert statt angenommen: ein Fenced-Block im
      Nachrichtentext bleibt byte-identisch (inkl. Backslash-Escapes wie
      `\;` in einem `find …-exec …\;`-Snippet), nur profitiert automatisch
      vom Fix in (a), weil `chatToMarkdown` `renumberCitations` auf den
      gesamten Archivtext anwendet.
      (d) `citeTagsToDocLinks` (`citations.jsx`) und die Dokument-Ansicht
      wurden EXPLIZIT verifiziert statt angenommen: `citeTagsToDocLinks`
      arbeitet über `<cite>`-Tags (die laut System-Prompt nie in Code
      stehen) und ist von Fences strukturell unberührt – ein Regressions-
      test bestätigt, dass ein Codeblock direkt neben einer echten
      `<cite>`-Stelle byte-identisch bleibt. Die Dokument-Ansicht
      (`markdown.jsx`) schützt Formeln/Bilder/Fußnoten in Codeblöcken über
      dieselbe Prioritäts-Weiche wie `mathBlock` (siehe oben) – mit Tests
      belegt, nicht nur angenommen.
    - **Chat (`src/App.jsx`):** neuer Segmentierer
      `expandFencedCodeInNodes(nodes, expandRest)` (`code.jsx`) für Nutzer-
      UND Assistenten-Bubbles: erst werden Fenced-Codeblöcke aus jedem
      String-Segment herausgezogen und als `CodeBlockView` gerendert, DANN
      läuft `expandRest` (Formel-Erkennung, `renderMathText`/
      `expandMathInNodes`) nur noch auf den verbleibenden Nicht-Code-
      Segmenten – exakt die geforderte Reihenfolge. Als Bonus (trivial über
      denselben Helfer) werden dabei auch Inline-Codespans (`` `x` ``)
      monospaced gerendert, die im Chat bisher als Rohtext mit sichtbaren
      Backticks erschienen UND deren Inhalt bisher fälschlich für Formeln
      durchsucht wurde (z. B. `` `$x$` `` hätte im Chat bislang eine
      Formel gerendert – ein beim Testschreiben gefundener Nebeneffekt,
      jetzt mit demselben Fence-zuerst-Mechanismus behoben). `nodes` kann
      bereits gerenderte Elemente enthalten (Quellen-Fußnoten aus
      `renderWithCites`) – die bleiben unangetastet durchgereicht.
      Key-Kollisionen: `expandRest` wird bei mehreren Text-Segmenten
      (Text vor UND nach einem Codeblock) MEHRFACH mit je eigenem Null-
      basiertem Key-Zähler aufgerufen; ohne Gegenmaßnahme kollidieren
      React-Keys zwischen den Segmenten (zwei Formeln, je die erste in
      ihrem Segment, beide Key "m0"). `expandFencedCodeInNodes` versieht
      deshalb ALLE von `expandRest` gelieferten Elemente mit einem intern
      geführten, über die GESAMTE Ausgabe eindeutigen Key (`cloneElement`)
      – mit Test abgesichert (zwei Formeln, getrennt durch einen
      Codeblock, eindeutige Keys).
    - **System-Prompt (`src/lib/anthropic.js`):** KONVENTIONEN-Block um
      einen Satz ergänzt: ```-Codeblöcke sind fürs Dokument erlaubt und für
      Code/Konfiguration/Logs erwünscht (mit Sprach-Label). Die bestehende
      FORMELN-Regel („Verwende für Formeln NIEMALS ```-Codeblöcke …“)
      bleibt WÖRTLICH unverändert – bewusst keine Umformulierung, um sie
      nicht zu verwässern; ein Regressionstest prüft beide Sätze
      gemeinsam (Codeblock-Erlaubnis UND unverändertes Formel-Verbot).
    - **Restrisiken:** `parseTree` (Section-Splitting bei `##`/`###`)
      arbeitet auf dem RAW-Text VOR jeder Fence-Erkennung – ein Codeblock,
      der eine Zeile wie `## Kommentar` enthält (z. B. ein Shell-Skript
      mit dem Konventions-Kommentarstil `## Abschnitt`), würde fälschlich
      als neue Dokument-Section interpretiert. Das ist dieselbe Klasse von
      bereits akzeptierter Einschränkung wie bei Formeln (`matchDisplay-
      Block` bricht deshalb an Überschriftenzeilen ab – dort GREIFT der
      Abbruch aber erst NACH dem Section-Split, kann eine echte Formel
      also nicht retten, wenn eine `##`-Zeile mittendrin steht). Nicht
      behoben (würde `parseTree` selbst fence-bewusst machen müssen –
      deutlich invasiver, Checklisten-Zeilenindex-Risiko), aber als
      bekannte Grenze hier dokumentiert; der beauftragte E2E-Testfall
      (Bash-Snippet zum Löschen von `.tmp`-Dateien) berührt sie nicht.
      Kein Syntax-Highlighting (Nutzerauftrag: bewusst schlicht, keine
      neue Abhängigkeit). Zwei weitere, bewusst akzeptierte Ausnahmen von
      der Byte-Genauigkeits-Zusage (Review-Vorschlag, 2026-07-17):
      (i) Die Sentinel-Neutralisierung für `\$`-Escapes
      (`ESCAPED_DOLLAR_SENTINEL` → `REPLACEMENT_CHAR`, Re-Review-Finding
      R4, siehe Punkt 46ff) läuft in `mathToPlaceholders` GLOBAL vor dem
      Fence-Schutz und trifft daher auch Codeblock-Inhalte – ein im Code
      bereits vorhandenes Sentinel-Zeichen (praktisch nie in echtem Code,
      privater Unicode-Bereich) würde durch das Ersatzzeichen U+FFFD
      ersetzt statt byte-genau erhalten zu bleiben; bewusst in Kauf
      genommen, weil das Sicherheitsnetz gegen eine STILLE
      Fremdzeichen-Umdeutung beim nächsten Speichern wichtiger ist als
      dieser Extremfall. (ii) `resolveImgs`/`unresolveImgs`
      (`DocEditor.jsx`) ersetzen `](img:id)` textuell auch INNERHALB eines
      Codeblocks (z. B. ein Snippet, das zufällig `](img:abc)` als Text
      enthält) – roundtrip-neutral (dieselbe Ersetzung läuft beim
      Speichern rückwärts), aber die Editor-ANZEIGE zeigt in diesem
      Sonderfall eine aufgelöste data-URL statt des Originaltexts. Beide
      Fälle sind Rand­fälle mit vernachlässigbarer Praxisrelevanz, nicht
      code-gefixt.
    - **Re-Review (2026-07-17, vor Freigabe) – vier Findings, K1 behoben,
      W1/W2 behoben, W3 nachgezogen:**
      - 🔴 **K1 (Muss, behoben):** Siehe „WYSIWYG-Editor“ oben –
        `FencedCodeBlock` ersetzt den `tiptap-markdown`-Standard-
        Serializer für `codeBlock` durch einen eigenen mit
        Zaun-Verlängerung; `matchFenceBlock` (`code.jsx`) verlangt
        spiegelbildlich einen Schluss-Zaun MINDESTENS so lang wie der
        öffnende (`FENCE_OPEN_RE` erkennt jetzt `` `{3,} `` statt fix drei
        Backticks). Ohne BEIDE Hälften hätte die eine Seite die andere
        nicht stabilisiert (ein von `FencedCodeBlock` erzeugter
        4-Backtick-Zaun wäre vom alten `FENCE_OPEN_RE` gar nicht als
        gültiger Zaun erkannt worden). Regressionstests: ein Codeblock mit
        eigener ```-Zeile im Inhalt bleibt über ZWEI Roundtrips stabil
        (`tests/docEditorCode.test.jsx`), plus Unit-Tests für
        `matchFenceBlock`/`splitFenceSegments` mit 4-Backtick-Außenzaun um
        3-Backtick-Inhalt (`tests/code.test.jsx`) und denselben Fall im
        Viewer (`tests/markdown.test.jsx`) und im Chat
        (`tests/code.test.jsx`, `expandFencedCodeInNodes`).
      - 🟡 **W1 (behoben, teilweise dokumentierte Grenze):** `code.jsx`
        behauptete fälschlich, CommonMark verbiete Leerzeichen im
        Info-String (`FENCE_OPEN_RE` verlangte `[^`\s]*` statt `[^`\r\n]*`)
        – tatsächlich sind nur Backticks verboten, ein Label wie
        „`python title=x`“ ist gültiges, von markdown-it geparstes
        Markdown. Fix: Info-String bis Zeilenende erlaubt, nur das erste
        Wort wird als Sprach-Label übernommen (identisch zu markdown-it).
        Damit korrekt geschützt: Fence-Label MIT Leerzeichen (P2) sowie –
        gemeinsam mit dem K1-Fix – ein 4-Backtick-Zaun (P5). NICHT
        behoben, sondern als Restriktion dokumentiert (Viewer rendert sie
        ohnehin nicht als Block, geringe Praxisrelevanz gegenüber dem
        Implementierungsaufwand): `~~~`-Zäune und eingerückter Code
        (4+ Spaces/Tab) werden von `code.jsx` grundsätzlich NICHT als
        Code erkannt – markdown-it parst sie beim tatsächlichen
        Editor-Laden aber sehr wohl als Code. Enthält ein solcher Block
        ein `$…$`, wandelt `mathToPlaceholders` es (mangels Fence-
        Erkennung) in einen `<math-inline>`-Platzhalter um, der dann
        INNERHALB des von markdown-it erkannten Code-Konstrukts als
        Literaltext landet, statt als Formel-Node interpretiert zu werden
        (kein Datenverlust, aber sichtbarer Tag-Text im Codeblock – ein
        seltener Rand­fall, der eine erneute Bearbeitung des betroffenen
        Blocks nahelegt).
      - 🟡 **W2 (behoben):** Die Einrückungstoleranz in `FENCE_OPEN_RE`/
        `FENCE_CLOSE_RE` (`[ \t]*`, beliebig viele Leerzeichen/Tabs) wich
        von markdown-it ab (CommonMark: max. drei Leerzeichen, kein Tab –
        danach gilt eine Zeile als eingerückter Codeblock). Die
        Diskrepanz hätte den Ladepfad Zeilen „schützen“ lassen, die
        markdown-it beim tatsächlichen Öffnen GAR NICHT als Zaun liest,
        und umgekehrt zu genau der K1-Klasse von Korruption führen können
        (Tab-eingerückter Zaunblock). Fix: `^ {0,3}` statt `[ \t]*` in
        beiden Regexen. Regressionstests in `code.jsx`/`math.jsx`/
        `markdown.jsx` bestätigen das definierte, jetzt konsistente
        Verhalten: ein 4-Spaces- oder Tab-eingerückter ```-Block wird
        NICHT mehr als Zaun erkannt (weder im Ladepfad noch im Viewer).
      - 🟡 **W3 (nachgezogen):** Die neuen Suiten deckten die eigentlichen
        Korruptions-Datenlagen noch nicht ab. Ergänzt: Roundtrip mit
        eigener ```-Zeile im Codeblock-Inhalt (byte-identisch + Idempotenz
        über zwei Roundtrips), Fence-Label mit Leerzeichen (`$` im Inhalt
        bleibt roh), Tab-/4-Spaces-eingerückter Zaun (kein
        Platzhalter-Leak, weil er gar nicht erst als Zaun erkannt wird),
        `matchFenceBlock` mit Schluss-Zaun kürzer als Öffnungs-Zaun (paart
        NICHT) und länger als Öffnungs-Zaun (paart trotzdem).
      - 🟢 (übernommen): Kommentar-Begründungen in `code.jsx`/`math.jsx`
        korrigiert (siehe oben); Sentinel-/`resolveImgs`-Ausnahmen von der
        Byte-Genauigkeits-Zusage oben dokumentiert.
    - **Re-Review 2/RE1 (2026-07-17, FREIGABE erteilt) – ein nicht
      blockierender Folgefund, behoben:**
      - 🟡 **P10 (behoben):** Enthält ein Dokument einen NICHT
        geschlossenen ```-Zaun (GIGO-Fall, z. B. eine abgeschnittene
        Modellantwort), verschluckt markdown-it beim ECHTEN Editor-Laden
        ALLES ab dieser Zeile bis Dokumentende in EINEN Codeblock – anders
        als `mathToPlaceholders` selbst (das seine eigene Zeile bis dahin
        nur „normal weiterlaufen“ ließ). Ein `$x$` irgendwo in diesem
        verschluckten Bereich wurde vorher trotzdem zu einem
        `<math-inline>`-Tag umgewandelt, das dann als LITERALTEXT
        innerhalb des von markdown-it gebildeten Codeblocks landete
        (Tag-Leak, empirisch belegt). Fix (`mathToPlaceholders`,
        `math.jsx`, ~5 Zeilen): Bei einer öffnenden Zaun-Zeile OHNE
        gefundenen Schluss-Zaun wird der GESAMTE REST des Dokuments roh
        übernommen und die Verarbeitungsschleife sofort beendet (`break`)
        – bildet markdown-its tatsächliches Verschlucken nach, Text VOR
        der unterminierten Zeile bleibt weiterhin ganz normal
        konvertierbar. Regressionstests auf zwei Ebenen: String-Ebene
        (`tests/math.test.jsx` – Formel vor dem Zaun wird konvertiert,
        `$x$` danach bleibt roh bis Dokumentende) UND ein echter
        Headless-TipTap-Test (`tests/docEditorCode.test.jsx` – lädt das
        GIGO-Dokument über die ECHTEN Extensions, prüft `mathInline`-
        Knotenzahl und dass der entstandene `codeBlock`-Node kein
        `<math-inline`-Tag als Textinhalt enthält). Dabei EMPIRISCH
        bestätigt (nicht nur angenommen) und bewusst nicht weiter
        „gefixt“: Speichert man ein so geladenes GIGO-Dokument (auch ganz
        ohne Änderung), hängt ProseMirror beim Serialisieren einen
        SCHLIESSENDEN Zaun an – ein Codeblock-KNOTEN kann strukturell gar
        nicht „unterminiert“ bleiben, sobald er einmal geparst wurde. Das
        Ergebnis ist dadurch NICHT byte-identisch zum rohen
        Eingabe-Markdown; im echten `DocEditor.jsx` ist das folgenlos, weil
        die No-op-Erkennung die frisch beim Laden serialisierte Baseline
        vergleicht (`onCreate`), nicht das ursprüngliche Roh-Markdown –
        ein erneutes Speichern DANACH ist wieder stabil (Test deckt beide
        Speichervorgänge ab). Die zugrundeliegende STRUKTURELLE
        Divergenz zwischen Viewer/Chat (zeigen den GIGO-Rest als normale
        Absätze/Listen) und dem echten Editor (zeigt ihn als EINEN
        Codeblock) ist markdown-it-inhärent und bleibt bestehen – siehe
        Restriktion oben bei „Gemeinsame Fence-Erkennung“; kein
        Datenverlust in beiden Fällen, daher kein Blocker.
      - 🟢 (übernommen): Drei Editor-Normalisierungen sind bewusst
        akzeptierte, empirisch stabil verprobte Nebeneffekte einer ECHTEN
        Bearbeitung (nicht des reinen No-op-Ladens) – ein gespeichertes
        Dokument kann dadurch geringfügig vom Original abweichen, ohne
        dass Inhalt verloren geht: (1) Zaun-Länge wird beim Speichern auf
        das Minimum normalisiert (mindestens 3, oder länger falls der
        Inhalt es braucht – enthält ein zuvor 4-Backtick-gezäunter Block
        nach der Bearbeitung keine 3er-Backtick-Serie mehr, schrumpft der
        Zaun beim nächsten Speichern korrekt auf 3). (2) Ein Info-String
        mit mehreren Wörtern wird auf das erste Wort gekürzt (nur das wird
        als `language`-Attribut geführt, siehe „Gemeinsame
        Fence-Erkennung“ oben – der Rest ist für die App ohnehin
        irrelevant, da kein Syntax-Highlighting). (3) Ein eingerückter
        Zaun (bis drei Leerzeichen) wird beim Speichern dedentet (die
        Einrückung ist für `codeBlock` kein Attribut, das ProseMirror
        kennt). Alle drei sind idempotent (ein zweites Speichern ändert
        nichts mehr) und wurden im Re-Review empirisch mit den echten
        Modulen verprobt.

55. **Generische Links – Dokument-Viewer und WYSIWYG-Editor** (v7.8,
    Nutzerwunsch: „Links funktionieren gar nicht"). Bisher rendert der
    Viewer AUSSCHLIESSLICH `[n](https://…)` (reine Ziffer als Titel) als
    hochgestellte Quellen-Fußnote; jeder andere Link (`[Titel](url)`,
    `<url>`-Autolink, nackte URL im Fließtext) fiel als Klartext durch.
    Harte Anforderung des Nutzers: Quellen-Fußnoten (Konvention aus Punkt
    26) und ihre dokumentweite Umnummerierung (`renumberCitations`)
    mussten UNVERÄNDERT weiterlaufen.
    - **Viewer (`src/lib/markdown.jsx`):** `INLINE_TOKEN_RE`s bisherige
      `[`-Alternative (`\[\d+\]\(https?://…\)`) wurde zu einer ECHTEN
      OBERMENGE (`\[[^\]\n]+\]\(https?://…\)` – Titel = beliebiger Text
      ohne `]`/Zeilenumbruch); WELCHE der beiden Darstellungen greift,
      entscheidet jetzt `renderInline` anhand des Titels (reine Ziffern
      → wie bisher `<sup>`-Fußnote, sonst normaler Link mit rekursiv
      gerendertem Titel, damit `**fett**` im Linktext funktioniert). Zwei
      neue Alternativen kamen dazu: `<https://…>`-Autolink (Anzeigetext =
      URL) und eine nackte URL im Fließtext (letzte Alternative, GREEDY
      bis Whitespace/`<`/`>`, danach per `trimBareUrl` um abschließende
      Satzzeichen (`.,;:!?`) UND eine unausgeglichene schließende `)`
      gekürzt – balancierte Klammern wie in Wikipedia-URLs
      (`.../Steak_(Fleisch)`) bleiben Teil der URL, siehe
      `trimBareUrl`-Kommentar). ALLE vier Formen verlangen ausnahmslos
      ein http(s)-Schema (Defense-in-Depth wie schon bei
      `renderWithCites`, `citations.jsx` – `javascript:`/`data:`/… bleiben
      Klartext). Welche Alternative bei mehreren im selben Text
      passenden Kandidaten gewinnt, entscheidet – wie bei Formeln/Fett/
      Kursiv seit jeher – die POSITION des frühesten Treffers, nicht die
      Reihenfolge in der Regex (ein Codespan oder `[Titel](url)`, der vor
      einer darin enthaltenen nackten URL beginnt, konsumiert sie
      automatisch mit; eine URL INNERHALB eines Codespans bleibt daher
      Code). `renumberCitations`/`CITE_LINK_RE` bleiben UNVERÄNDERT (nur
      `[\d+](url)`) – ein generischer Link wie `[2024-Bericht](url)` ist
      für sie kein Treffer und bleibt beim Umnummerieren byte-identisch
      (Regressionstest).
    - **Editor (`src/components/DocEditor.jsx`):** `Link.configure` von
      `{ autolink:false, linkOnPaste:false }` auf `{ autolink:true,
      linkOnPaste:true }` umgestellt (`openOnClick` bleibt `false` – ein
      Klick auf einen Link WÄHREND des Bearbeitens soll den Editor nicht
      verlassen, dafür gibt es jetzt den „Öffnen"-Knopf im Link-Popover).
      `isAllowedUri` schränkt Autolink/Paste/Commands zusätzlich auf
      http(s) ein (KORREKTUR nach Re-Review, siehe „Nachbesserung" unten –
      die ursprüngliche Annahme, die eingebaute Prüfung lasse das schon von
      sich aus zu, war FALSCH). Ein Link mit Text==href serialisiert über
      `prosemirror-markdown`s `isPlainURL`-Heuristik automatisch als
      `<url>`-Autolink – das kann der Viewer jetzt darstellen (siehe oben).
      Neuer Toolbar-Knopf „Link" (lucide `Link2`, als `LinkIcon` importiert
      – Namenskollision mit dem tiptap-`Link`-Import) öffnet ein Popover
      (Titel-/URL-Feld, Stil wie die bestehenden Farb-/Tabellen-Picker):
      Textauswahl vorbelegt den Titel; Cursor in einem bestehenden Link
      dehnt die Auswahl per `extendMarkRange("link")` auf die GESAMTE
      Mark-Spanne aus und belegt Titel+URL vor; „Einfügen"/„Übernehmen"
      ersetzt die Auswahl durch einen Textknoten mit Link-Mark (URL ohne
      Schema bekommt `https://` vorangestellt, jedes andere Schema wird
      abgelehnt); bei bestehendem Link zusätzlich „Entfernen" (`unsetLink`)
      und „Öffnen" (`window.open(url, "_blank", "noopener")`). Zwei
      EXPORTIERTE reine Funktionen kapseln die Validierung (Review-Muster
      wie `unescapeMd`/`MdTable`, damit Tests die ECHTEN Funktionen
      prüfen): `validateLinkTitle` blockiert einen Titel aus REINEN Ziffern
      („Reine Zahlen sind für Quellen-Fußnoten reserviert – bitte einen
      sprechenden Titel wählen.", sonst würde `renumberCitations` einen
      frei gewählten Titel wie „42" beim nächsten Speichern stillschweigend
      durch eine Fußnoten-Nummer ersetzen) und ersetzt `[`/`]` im Titel
      STILL durch `(`/`)` (`prosemirror-markdown` escaped sie beim
      Serialisieren zu `\[ \]`, `unescapeMd` macht das Escape beim
      Speichern bedingungslos rückgängig – ein rohes `]` im Titel würde
      dann den Viewer-Link-Regex mitten im Titel beenden und den Link
      zerschneiden); `normalizeLinkUrl` erzwingt http(s). BEKANNTE LÜCKE:
      diese Validierung greift NUR im Dialog-Pfad – ein per Autolink
      (Tippen) oder `linkOnPaste` (URL über eine Auswahl einfügen)
      entstandener Link durchläuft sie nicht. Für Autolink ist das
      unkritisch (Text==URL, enthält nie `[`/`]`, ist nie rein numerisch
      außer die URL selbst wäre nur Ziffern – dann bliebe ohnehin `<url>`-
      Form, keine `[n](url)`-Verwechslungsgefahr). Für `linkOnPaste` über
      eine VORHANDENE Auswahl mit `]` im Text bleibt ein Rest-Risiko
      (seltener Randfall, akzeptiert statt zusätzlicher Komplexität in der
      Paste-Rule).
    - **Optische Abgrenzung im Editor:** Fußnote und generischer Link
      laufen über denselben Link-Mark, sollen aber wie im Viewer
      unterschiedlich aussehen. Ein neues ProseMirror-Plugin
      (`LinkDecorations`, `addProseMirrorPlugins`) scannt bei jeder
      Dokumentänderung (`apply` reagiert NUR auf `tr.docChanged`, ein
      reiner Selektionswechsel scannt nicht neu) den kompletten Dokument-
      baum, fasst zusammenhängende Text-Runs mit IDENTISCHEM `href` zu
      EINER Decoration zusammen (robust gegenüber ProseMirrors interner
      Aufteilung eines Link-Texts in mehrere Text-Nodes) und vergibt
      `cite-link` (Text nur Ziffern, Optik wie die Viewer-Fußnote:
      hochgestellt, klein, indigo, ohne Unterstreichung) oder `doc-link`
      (alles andere: blau + unterstrichen) – Style-Regeln in `index.css`
      bei den übrigen `tiptap-doc`-Styles. Der `.tiptap-doc a`-Basisstil
      wurde dafür von einer festen Fußnoten-Optik (galt bisher für JEDEN
      Link) auf neutral (`color: inherit`) zurückgebaut; die Klassen-
      Selektoren sind bewusst OHNE `a`-Präfix (`.doc-link` statt
      `a.doc-link`), weil ProseMirror eine Inline-Decoration je nach
      Rendering auf einem inneren `<span>` statt direkt auf dem `<a>`
      platzieren kann.
    - **Tests:** `tests/markdown.test.jsx` (neuer Block „DocView:
      generische Links") deckt alle vier Link-Formen ab (inkl. Fußnote
      und generischer Link in EINER Zeile, `javascript:`/`data:` bleiben
      Klartext, Trailing-Punctuation, Wikipedia-Klammern, Klammer im
      Fließtext, Tabellenzelle/Listen-Item, `**fett**` im Titel, URL
      innerhalb eines Codespans bleibt Code) plus einen Regressionstest,
      dass `renumberCitations` generische Links unangetastet lässt. Neue
      Datei `tests/docEditorLinks.test.jsx` (echter TipTap-Roundtrip wie
      `docEditorCode.test.jsx`/`docEditorMath.test.jsx`, `jsdom`-Override):
      No-op-Stabilität für `[Titel](url)` (Fließtext, Tabellenzelle,
      Listen-Item, neben `$x$`-Formel, neben Codespan, Umlaute/`&`),
      Fußnote bleibt nach Roundtrip numerisch (keine Titel-Mutation),
      `<url>`-Autolink lädt korrekt und bleibt über ZWEI Roundtrips
      stabil, Autolink-beim-Tippen erzeugt tatsächlich einen Link-Mark,
      die Decoration-Klassen erscheinen im gerenderten `editor.view.dom`
      und werden nach einer Doc-Änderung neu berechnet, plus direkte
      Tests von `validateLinkTitle`/`normalizeLinkUrl` (Ziffern-Sperre
      inkl. „007", Klammer-Ersetzung, Schema-Zwang, Ablehnung von
      `javascript:`/`data:`/`ftp:`).
    - Restrisiko (siehe „bekannte Lücke" oben): `linkOnPaste` über eine
      vorhandene Auswahl mit `[`/`]`/reinem Ziffern-Text umgeht die
      Dialog-Validierung. Bewusst akzeptiert (seltener Fall, Nutzer sieht
      das Ergebnis sofort im Editor und kann es über den Link-Dialog
      nachträglich korrigieren).
    - **Nachbesserung (Re-Review 2026-07-17, drei 🟡-Findings vor dem
      Commit behoben, v7.8 bleibt v7.8 – reine Korrektur des noch
      uncommitteten Stands, kein neues Feature):**
      1. **`normalizeLinkUrl` trug nicht jede akzeptierte URL durch den
         Roundtrip.** Empirisch nachgestellt: `https://x.de/a b`
         (Leerzeichen) landete unverändert im Markdown und brach die
         Viewer-Grammatik (`LINK_URL_RE`, s. u.) mitten in der URL ab
         (Klartext-Trümmer); `https://x.de/a)b` (unbalancierte Klammer)
         wurde von `prosemirror-markdown` beim Serialisieren zwar zu `\)`
         escaped, aber von `unescapeMd` bedingungslos wieder zu `)`
         zurückverwandelt – der Viewer kürzte den href beim nächsten Laden
         still auf `https://x.de/a`; eine verschachtelte Klammer
         (`a(b(c)d)e`) ließ die GESAMTE `[Titel](url)`-Form nicht mehr
         matchen. Ergänzend geprüft: ein rohes `"` wird von
         `prosemirror-markdown` escaped, aber von `unescapeMd` NIE wieder
         entfernt (nicht im Escape-Zeichensatz) – bleibt dauerhaft als
         `\"` im Dokument hängen (Idempotenz gebrochen); ein rohes `<`/`>`
         bricht zwar weder Serialisierung noch Viewer, wird aber von
         `markdown-it` beim NÄCHSTEN Laden still zu `%3C`/`%3E`
         normalisiert (überraschende URL-Änderung beim zweiten Öffnen).
         **Entscheidung: prozent-encodieren statt ablehnen** (`%20` für
         Whitespace, `%22`/`%3C`/`%3E` für `"`/`</>`, `%28`/`%29` für
         Klammern NUR wenn die URL nicht schon vollständig der
         Viewer-Grammatik entspricht – eine einzelne Ebene balancierter
         Klammern bleibt dadurch bewusst roh, Wikipedia-Fall funktioniert
         weiter unencodiert). Encodieren ist nutzerfreundlicher als eine
         Fehlermeldung: eine aus dem Browser kopierte URL mit Leerzeichen
         (z. B. Dateipfad) bleibt benutzbar. Die Klammer-Grammatik
         (`(?:[^\s()]|\([^\s()]*\))+`) ist jetzt als `LINK_URL_RE` aus
         `src/lib/markdown.jsx` EXPORTIERT und wird sowohl von
         `INLINE_TOKEN_RE`/`CITE_LINK_RE` (Viewer) als auch von
         `normalizeLinkUrl` (Editor-Dialog, `DocEditor.jsx`) über
         `new RegExp(LINK_URL_RE.source)` wiederverwendet (analog
         `MATH_SERIALIZED_RE` aus `math.jsx`) – EINE Quelle der Wahrheit
         statt zweier Kopien, die unbemerkt hätten auseinanderlaufen
         können.
      2. **`isAllowedUri` von `@tiptap/extension-link` 2.27.2 lässt per
         Default mehr als http(s) zu** (u. a. `ftp`/`ftps`/`mailto`/`tel`/
         `callto`/`sms`/`cid`/`xmpp`, siehe `isAllowedUri()` in
         `node_modules/@tiptap/extension-link/dist/index.js`) – die
         ursprüngliche Behauptung im DECISIONS-Text oben („lässt ohnehin
         nur http/https zu") war FALSCH (im Code-Review nicht anhand der
         tatsächlichen Bibliotheksquelle verifiziert). Eine getippte oder
         eingefügte E-Mail-Adresse hätte klammheimlich einen
         `mailto:`-Link-Mark erzeugt, den der Viewer als Klartext zeigt
         (kein XSS, aber Editor/Viewer laufen auseinander). Fix:
         `Link.configure({ …, isAllowedUri: (url, ctx) =>
         ctx.defaultValidate(url) && /^https?:/i.test(url) })` – die
         `ctx.defaultValidate`/`ctx.protocols`-API existiert in 2.27.2
         exakt wie angenommen (verifiziert in `isAllowedUri`/
         `parseHTML`/`renderHTML`/`addCommands`/`addPasteRules`/
         `addProseMirrorPlugins` derselben Datei – ALLE Konsumenten rufen
         `this.options.isAllowedUri(url, { defaultValidate, protocols,
         defaultProtocol })` auf, die Einschränkung greift dadurch für
         Autolink-beim-Tippen, `linkOnPaste` UND `setLink`/`toggleLink`
         gleichermaßen).
      3. **Quadratisches Backtracking der `[Titel]`-Alternative in
         `INLINE_TOKEN_RE`** (`src/lib/markdown.jsx`): Ein ungecapptes
         `\[[^\]\n]+\]` lässt die Regex-Engine bei jedem `[`-Startindex
         ohne folgendes `]` den kompletten Rest der Zeile durchprobieren,
         bevor sie aufgibt. Gemessen: eine Zeile aus 20 000 `[` ohne `]`
         brauchte 356 ms, 50 000 `[` 2,3 s pro `INLINE_TOKEN_RE.exec`
         (vorher, mit der alten `\[\d+\]`-Fußnoten-Grammatik, war das
         irrelevant – `\d+` kann so gut wie nichts matchen und gibt sofort
         auf). Fix: `\[[^\]\n]{1,300}\]` – begrenzt den Backtracking-
         Aufwand pro Startposition auf eine Konstante (macht den
         Gesamtaufwand wieder linear in der Zeilenlänge, verifiziert:
         20 000 `[` jetzt 20 ms, 50 000 `[` 30 ms). Ein Titel über 300
         Zeichen ist ohnehin kein sinnvoller Linktitel und bleibt (wie
         jedes andere kaputte/unbekannte Muster) Klartext – die
         eingebettete bare-URL wird dabei trotzdem separat als eigener
         Link erkannt (dieselbe Fallback-Grammatik wie bei jeder anderen
         nicht matchenden `[…](url)`-Form, z. B. verschachtelten
         Klammern). Dieselbe Obermengen-Regex war ein zweites Mal im
         `renderInline`-Zweig für „["-Token dupliziert (dort ebenfalls
         ungecappt) – jetzt als modul-weites `GENERIC_LINK_TOKEN_RE` mit
         demselben Cap zusammengeführt, einmalig kompiliert statt bei
         jedem Aufruf neu gebaut.
      - **Tests:** `tests/docEditorLinks.test.jsx` – neue Blöcke für
        `normalizeLinkUrl`-Encoding (Leerzeichen, balancierte vs.
        unbalancierte/verschachtelte Klammern, `"`, `</>`, Kombination)
        UND für jeden transformierten Fall ein voller Editor-Roundtrip
        (Einfügen → Speichern → Markdown enthält die getragene Form →
        erneutes Laden+Speichern idempotent); Autolink-beim-Tippen einer
        E-Mail-Adresse erzeugt keinen Link-Mark mehr, `setLink` lehnt
        `mailto:` ab (derselbe Validierungspfad wie `linkOnPaste`).
        `tests/markdown.test.jsx` – eine vom Editor prozent-kodierte URL
        wird im Viewer vollständig erkannt (schließt den Kreis); Titel mit
        300 Zeichen wird noch als Link erkannt, 301 Zeichen bleibt
        Klartext (dokumentierte Grenze).
      - Restrisiko: die 300-Zeichen-Titelgrenze ist eine bewusste, aber
        willkürliche Konstante – ein legitimer (wenn auch unüblich langer)
        Linktitel über 300 Zeichen würde als Klartext gerendert statt als
        Link. Akzeptiert (Backtracking-Schutz wiegt schwerer, 300 Zeichen
        sind für einen Linktitel bereits weit jenseits jeder sinnvollen
        Länge).

56. **Link-Provider: DevOps/Confluence-Icons + Titel-Ermittlung**
    (`src/lib/linkProviders.jsx`, `src/lib/markdown.jsx`,
    `src/components/DocEditor.jsx`, `src/components/SettingsDialog.jsx`,
    `src/lib/settings.js`, v7.9, Nutzerwunsch: Links auf Azure-DevOps-
    Work-Items/Confluence-Seiten sollen im Viewer UND Editor ein
    Provider-Icon vor dem Link zeigen, und der Linktitel soll sich im
    Editor auf Knopfdruck aus dem Ziel ermitteln lassen).
    - **Neues Blatt-Modul `src/lib/linkProviders.jsx`:** importiert NICHTS
      aus `markdown.jsx`/`math.jsx`/`DocEditor.jsx` (Zirkelbezug-Regel wie
      `code.jsx`) – `markdown.jsx` UND `DocEditor.jsx` importieren
      umgekehrt AUS dieser Datei. Die Titel-Bereinigungsregel (bisher nur
      als `validateLinkTitle` in `DocEditor.jsx`, siehe Punkt 55) wurde
      dafür nach hier verschoben (`cleanupLinkTitle`) – `DocEditor.jsx`s
      `validateLinkTitle` ist jetzt ein dünner, weiterhin exportierter
      Wrapper darum, damit ein automatisch ermittelter Titel (z. B. von
      Azure DevOps) durch GENAU dieselbe Prüfung läuft wie ein manuell
      eingegebener, ohne die Regel doppelt zu pflegen oder einen
      Zirkelimport zu brauchen.
    - **Eingebaute vs. konfigurierte Provider:** Zwei Provider sind IMMER
      aktiv, ganz ohne Konfiguration – nur Icon, KEIN PAT, KEIN Fetch:
      Azure DevOps (fester Präfix `https://dev.azure.com/`, zentral
      gehostet) und Confluence (Host-MUSTER `*.atlassian.net`, weil
      Confluence Cloud pro Kunde unter einer eigenen Subdomain läuft – ein
      fester Präfix wäre hier unmöglich; die nackte Domain `atlassian.net`
      OHNE Team-Subdomain zählt bewusst NICHT als Treffer). Der
      Einstellungen-Dialog erlaubt zusätzlich, Provider mit Zugangsdaten zu
      KONFIGURIEREN (localStorage, siehe unten) – typischerweise MIT
      demselben Präfix wie ein eingebauter Provider, nur um ein PAT zu
      hinterlegen. **`providerFor(url, configured)`-Regel: ein
      konfigurierter Provider gewinnt IMMER gegen einen eingebauten,
      unabhängig von der Präfixlänge** (sonst bliebe der eingebaute,
      PAT-lose Provider – trotz Nutzer-Konfiguration – der Treffer, und die
      Titel-Ermittlung bliebe unerreichbar); NUR innerhalb einer Kategorie
      (konfiguriert bzw. eingebaut) entscheidet der LÄNGSTE Präfix.
      Matching ist eine reine String-/Host-Prüfung ohne jeden Netzzugriff.
    - **Sicherheitsregel 1 (Gerätelokalität): Provider-PAT/E-Mail leben
      AUSSCHLIESSLICH im localStorage-Settings-Objekt**, exakt wie der
      GitHub-PAT/Anthropic-API-Key (`src/lib/settings.js`,
      `notizbuch:settings`) – Konsequenz: Provider müssen PRO GERÄT neu
      konfiguriert werden (kein Sync über `state.json`). `serializeState`
      (`src/App.jsx`) nimmt strukturell gar kein `settings`-Objekt entgegen
      (nur Chat/Modell/Collapsed/aktives Notizbuch/Reihenfolge/
      Schnellnotizen) – ein Provider-PAT kann dadurch gar nicht erst in
      `state.json` landen, keine zusätzliche Filterung nötig. Test
      (`tests/linkProviders.test.jsx`) baut einen realitätsnahen Zustand
      (Chat, Schnellnotizen, konfigurierte Provider MIT PAT über
      `setLinkProviders`) und prüft, dass `serializeState`s Ausgabe weder
      den PAT-Wert noch den Schlüssel `linkProviders` enthält.
    - **Sicherheitsregel 2 (kein Netzzugriff beim Rendern): Icons kommen
      ausschließlich aus `providerFor()`**, einer reinen URL-Präfix-/
      Host-Prüfung. Der Titel-Fetch (`fetchLinkTitle`) läuft NUR auf
      explizite Nutzeraktion im Link-Popover (neuer Knopf „Titel
      ermitteln“, sichtbar/aktiv nur wenn die eingegebene URL zu einem
      KONFIGURIERTEN Provider MIT Zugangsdaten passt – `custom`-Provider
      unterstützen grundsätzlich keine Titel-Ermittlung, kein bekanntes
      REST-API) – niemals automatisch beim Tippen/Anzeigen.
    - **`fetchLinkTitle(url, provider, { fetchImpl, timeoutMs })` wirft
      NIE**, liefert `{ ok:true, title }` oder `{ ok:false, reason }`.
      Azure DevOps: `GET …/_apis/wit/workitems/{id}?fields=System.Title,
      System.WorkItemType&api-version=7.1` mit Basic-Auth (`":"+PAT`),
      Titel-Format `"{WorkItemType} {id}: {System.Title}"`. Confluence:
      Seiten-ID aus `/wiki/spaces/{space}/pages/{id}` geparst, `GET
      …/wiki/rest/api/content/{id}` mit Basic-Auth (`E-Mail+":"+API-Token`),
      Titel aus dem `title`-Feld. **Bekannte Grenze (dokumentiert, kein
      Bug):** Atlassian Cloud blockiert Browser-CORS für die Content-API
      häufig – ein `fetch`-Netzwerkfehler (`TypeError`, keine weiteren
      Details verfügbar) wird zu einer verständlichen
      `"Netzwerk/CORS-Fehler …"`-reason normalisiert; das Icon funktioniert
      in diesem Fall trotzdem weiter (kommt ja ohne Netzzugriff aus), nur
      die automatische Titel-Ermittlung scheitert – der Einstellungen-
      Dialog weist bei Confluence explizit darauf hin. Ein
      `AbortController`-Timeout (~6 s) verhindert ein hängendes Popover.
      Ein ermittelter Titel läuft durch `cleanupLinkTitle` – ist er rein
      numerisch (z. B. eine Confluence-Seite, die zufällig „2024“ heißt),
      wird er wie ein manuell eingegebener abgelehnt (Fußnoten-Kollision,
      siehe Punkt 55), der Nutzer trägt den Titel dann manuell ein.
    - **Icons:** zwei kleine, bewusst VEREINFACHTE Inline-SVGs (Azure
      DevOps/Confluence, ~13 px, Markenfarbe, `aria-hidden`) – KEIN
      pixelgenauer Marken-Logo-Nachbau (fragile Handarbeits-Pfade wären
      nicht Ziel dieses Features), Farbe+Form dienen nur als
      Wiedererkennungs-Hinweis. Die Form-Daten stecken je Provider in EINER
      Konstante, die ZWEI Renderer konsumieren: React-Komponenten
      (`AzureDevOpsIcon`/`ConfluenceIcon`/`ProviderIcon`, für den Viewer)
      UND `buildProviderIconDom` (rohes DOM-Element ohne React, für die
      ProseMirror-Widget-Decoration im Editor) – die Optik bleibt dadurch
      an genau einer Stelle definiert. `custom`-Provider zeigen statt eines
      SVGs das vom Nutzer hinterlegte Emoji (Fallback 🔗).
    - **Viewer (`src/lib/markdown.jsx`):** vor den drei generischen
      Link-Formen (`[Titel](url)` mit sprechendem Titel, `<url>`-Autolink,
      nackte URL im Fließtext – siehe Punkt 55) wird bei Provider-Match ein
      `<span aria-hidden>`-Icon davor gerendert; Quellen-Fußnoten
      (`[n](url)`, `<sup>`) bekommen NIE ein Icon (eigener Rendering-Zweig,
      der die Icon-Komponente gar nicht aufruft). Zugriff auf die
      Provider-Liste über `getLinkProviders()` (Modul-Registry, siehe
      unten) statt über ein neues Prop quer durch `DocView`.
    - **Editor (`src/components/DocEditor.jsx`):** `LinkDecorations`
      (Punkt 55) bekommt zusätzlich zur `cite-link`/`doc-link`-Klasse eine
      `Decoration.widget` mit dem Icon-DOM-Knoten VOR jedem `doc-link`-Run
      mit Provider-Match (`cite-link`-Runs nie) – läuft wie die
      Klassenvergabe NUR beim Dokument-Rebuild (`tr.docChanged`), keine
      zusätzliche Performance-Last bei reinem Cursor-Bewegen. Decorations
      sind reine View-Ebene und beeinflussen `editor.storage.markdown.
      getMarkdown()` strukturell nicht (Test: No-op-Roundtrip bleibt auch
      mit sichtbarem Icon-Widget byte-identisch). Neuer Knopf „Titel
      ermitteln“ (lucide `Sparkles`, Spinner via `Loader2` während des
      Fetches) im Link-Popover, sichtbar nur bei Provider-Match MIT
      Zugangsdaten (`providerHasCredentials`); Klick füllt bei Erfolg NUR
      das Titelfeld (Nutzer kann vor dem Einfügen noch anpassen), bei
      Fehler erscheint die `reason` in der bestehenden Fehleranzeige des
      Popovers. Kein Auto-Fetch beim Tippen (Sicherheitsregel 2).
    - **Einstellungen (`src/components/SettingsDialog.jsx`,
      `src/lib/settings.js`, `src/App.jsx`):** neues, optionales Feld
      `linkProviders` (Array) – betrifft NICHT die bestehende
      Pflichtfeld-Prüfung (owner/repo/pat/apiKey). `loadSettings` filtert
      kaputte Einträge defensiv über `sanitizeLinkProviders`
      (`linkProviders.jsx`, zirkelfrei importierbar aus `settings.js`,
      da `linkProviders.jsx` selbst ein Blatt ist); `setLinkProviders`
      wendet dieselbe Sanitisierung nochmal an (Defense-in-Depth). Neuer
      Abschnitt „Link-Provider“ im Dialog: Liste konfigurierter Provider
      (Icon/Name/Präfix, Bearbeiten/Löschen) + Formular „Provider
      hinzufügen“ (Typ-Select mit typspezifischen Default-Werten für
      Name/Präfix, PAT bzw. E-Mail+API-Token als `type="password"`
      `autoComplete="off"`, bei `custom` ein Emoji-Feld statt
      Zugangsdaten) mit Hinweistext zur Gerätelokalität und zur
      Confluence-CORS-Grenze. `App.jsx` ruft `setLinkProviders(...)` beim
      Settings-Load UND -Save auf; Abmelden (`clearSettings`) setzt die
      Registry zusätzlich explizit auf `[]` zurück (auch wenn der
      anschließende `window.location.reload()` das ohnehin täte – explizit
      für Testbarkeit/Klarheit).
    - **Modul-Registry-Muster:** `setLinkProviders(list)`/
      `getLinkProviders()` sind ein einfacher In-Modul-Zustand (kein neues
      Prop quer durch `DocView`/`DocEditor`, die an mehreren Stellen in
      `App.jsx` eingebunden werden) – `App.jsx` ist die EINZIGE Schreib-
      stelle, `markdown.jsx`/`DocEditor.jsx` lesen nur. Gleiches
      Grundmuster wie die bereits bestehenden zentralen Hilfsmodule
      (`math.jsx`/`code.jsx`), nur mit echtem veränderlichem Zustand statt
      reiner Funktionen.
    - **Tests:** `tests/linkProviders.test.jsx` (neu) – `providerFor`
      (längster Präfix je Kategorie, konfiguriert schlägt eingebaut auch
      bei kürzerem Präfix, kein Match, Confluence-Host-Muster inkl.
      „nackte Domain matcht nicht“, Groß/Klein); `parseWorkItemUrl`
      (gültig, Query/Hash, Trailing-Slash, URL-encodetes Projekt, fehlende
      ID, fremder Pfad/Host, zusätzliche Pfadsegmente); `fetchLinkTitle`
      mit gemocktem `fetchImpl` (DevOps-Erfolg inkl. Titel-Format,
      Klammer-Bereinigung im Titel, 401/404, Netzwerk-/CORS-`TypeError`,
      `AbortController`-Timeout, Confluence-Erfolg + rein-numerischer
      Titel wird abgelehnt + CORS-Fall, custom/ohne-PAT-Ablehnung OHNE
      `fetchImpl`-Aufruf); `providerHasCredentials`; `cleanupLinkTitle`;
      `sanitizeLinkProviders`/Registry; Icon-Komponenten
      (`renderToStaticMarkup`); die Sicherheits-Test aus Regel 1 (siehe
      oben). `tests/markdown.test.jsx` – neuer Block „Link-Provider-Icons“
      (DevOps-Icon vor Link/nackter URL, KEIN Icon vor Fußnote, custom-
      Emoji, kein Icon ohne Provider). `tests/docEditorLinks.test.jsx` –
      neuer Block „Provider-Icon-Decoration“ (Widget-Klasse vor DevOps-/
      Confluence-Link, custom-Emoji im Widget, kein Widget vor Fußnote/
      ohne Provider, No-op-Roundtrip bleibt mit sichtbarem Icon-Widget
      byte-identisch). `tests/misc.test.js` – `loadSettings` mit/ohne/
      kaputtem `linkProviders`; bestehender Roundtrip-Test angepasst
      (erwartet jetzt zusätzlich `linkProviders: []`).
    - Restrisiken: (a) Die beiden Icon-SVGs sind bewusst KEINE exakten
      Marken-Logos – rein visuelle Vereinfachung, kein funktionales Risiko.
      (b) Die Confluence-Titel-Ermittlung scheitert je nach Atlassian-
      CORS-Policy häufig aus dem Browser heraus – dokumentierte Grenze,
      Nutzer trägt den Titel dann manuell ein, im Dialog vermerkt. (c) ~~Ein
      Provider-PAT mit demselben Präfix wie ein eingebauter Provider
      gewinnt IMMER gegen diesen, selbst wenn der Nutzer versehentlich ein
      viel zu kurzes/allgemeines Präfix konfiguriert (z. B. nur
      `https://`) – … Akzeptiert …~~ **KORRIGIERT, siehe Nachbesserung
      unten** – dieses „akzeptierte" Restrisiko war tatsächlich als
      Credential-Exfiltration ausnutzbar und wurde im Sicherheits-Review vor
      dem Commit als 🔴-Finding gemeldet und behoben, nicht länger
      akzeptiert.
    - **Nachbesserung (Sicherheits-Review vor dem Commit, v7.9 bleibt v7.9 –
      reine Korrektur des noch uncommitteten Stands, kein neues Feature):**
      Der Code-Reviewer fand, dass ein Confluence-Link-Titel-Fetch
      Zugangsdaten an einen FREMDEN Host schicken konnte, wenn der
      Provider-Präfix keinen Trailing-Slash hatte oder (Nutzerfehler,
      Restrisiko c oben) keinen echten Host enthielt. Drei zusammenwirkende
      Ursachen, alle behoben:
      1. **Host-Verankerung in `fetchLinkTitle`** (`src/lib/linkProviders.jsx`,
         Confluence-Zweig, 🔴 primärer Fix): Die API-URL/der Basic-Auth-
         Header wurden aus dem Host der EINGEGEBENEN Link-URL gebaut
         (`cm[1]`, aus `CONFLUENCE_PAGE_URL_RE`), nicht aus dem Host des
         KONFIGURIERTEN Providers – jede beliebige
         `*/wiki/spaces/*/pages/*`-URL, unabhängig vom Host, hätte das PAT/
         die E-Mail dorthin geschickt. Fix: vor dem Senden wird
         `hostOf(cm[1])` gegen `hostOf(provider.prefix)` verglichen, bei
         Nichtübereinstimmung (oder wenn der Provider-Präfix gar keinen
         Host liefert) bricht `fetchLinkTitle` MIT
         `{ ok:false, reason:"URL-Host passt nicht zum konfigurierten
         Provider." }` ab, OHNE `fetchImpl` aufzurufen. Bewusst als
         eigenständige Prüfung IN `fetchLinkTitle` selbst (nicht nur in
         `providerFor`/`matchLength`) – Defense-in-Depth: die Stelle, die
         tatsächlich Zugangsdaten verschickt, darf sich nicht blind auf eine
         vorgelagerte Auswahl verlassen.
      2. **`matchLength`-Grenzhärtung** (`src/lib/linkProviders.jsx`, 🟡):
         ein reines `startsWith()` ist keine URL-Grenze – ein Präfix
         `https://acme.atlassian.net` (ohne `/`) matchte bisher auch
         `https://acme.atlassian.net.evil.example/…` (Suffix-Angriff: der
         Präfix-String ist zwar ein Zeichenketten-Präfix, aber eine ANDERE
         Autorität). Fix: ein Präfix ohne abschließenden `/` matcht nur noch,
         wenn das Zeichen der URL unmittelbar danach `/`, `?`, `#` oder das
         Stringende ist. Deckt zugleich das (nicht separat behobene, aber
         dadurch automatisch entschärfte) Icon-Spoofing-Risiko ab: ein
         fremder Host bekam vorher unter Umständen auch fälschlich ein
         Provider-Icon im Viewer/Editor angezeigt.
      3. **`sanitizeLinkProviders` verlangt einen echten Host im Präfix**
         (`src/lib/linkProviders.jsx`, 🟡 – die eigentliche
         Durchsetzungsstelle, da sie sowohl beim `loadSettings` als auch bei
         jedem `setLinkProviders`-Aufruf läuft): ein Präfix ohne Host (der
         alte Confluence-Formular-Default `https://` allein!) matchte über
         den `endsWith("/")`-Kurzschluss in `matchLength` JEDE http(s)-URL –
         ein Nutzer, der das Präfix-Feld beim Anlegen eines
         Confluence-Providers versehentlich unverändert ließ, hätte damit
         PAT+E-Mail an jeden beliebigen Host geschickt, sobald der
         „Titel ermitteln"-Knopf für IRGENDEINEN `*/wiki/spaces/*/pages/*`-
         Link erschien. Fix: `hasRealHostPrefix()` verlangt `new
         URL(prefix)`-Parsbarkeit UND einen Host mit mindestens einem Punkt
         – gilt für ALLE Provider-Typen (auch `custom`, ein Präfix ohne Host
         ist nie legitim). `PROVIDER_TYPE_INFO.confluence.defaultPrefix`
         wurde von `"https://"` auf `""` geändert (kein Platzhalter, der
         ohnehin ungültig wäre – der Nutzer muss aktiv den eigenen
         `*.atlassian.net`-Tenant eintragen); `SettingsDialog.jsx`s
         `providerFormValid` spiegelt dieselbe Host-Regel als
         UX-Vorprüfung (importiert das jetzt exportierte `hostOf` aus
         `linkProviders.jsx`, keine zweite Kopie der Logik).
      - **Tests:** `tests/linkProviders.test.jsx` – neuer Block
        „Sicherheit: Confluence-Credentials gehen NUR an den Host des
        konfigurierten Providers" (Suffix-Angriffs-URL wird abgelehnt OHNE
        `fetchImpl` je aufzurufen, per `vi.fn()`-Spy geprüft; ein per
        Direktkonstruktion hostloser Provider `https://` fetcht ebenfalls
        nie; Positiv-Kontrolle mit legitimer URL funktioniert weiter;
        `sanitizeLinkProviders` lässt ein hostloses Präfix nicht in die
        Registry, auch nicht bei `custom`); zwei neue `matchLength`-
        Grenzfälle in der `providerFor`-Suite (Präfix ohne `/` matcht den
        echten Host, nicht den Suffix-Angriffshost; URL exakt gleich dem
        Präfix matcht noch; ein direkt angehängtes Zeichen ohne Trenner
        matcht nicht). Empirisch am Review-Tag zusätzlich per Isolations-
        Probe verifiziert (alte vs. neue `matchLength`-Logik gegeneinander
        mit denselben Angriffs-Strings ausgeführt): S1 (Suffix-Angriff)
        matchte ALT, NEU nicht mehr; S2 (hostloses `https://`-Präfix) matcht
        auf reiner `matchLength`-Ebene weiterhin (das ist erwartet – Fix 2
        allein deckt S2 nicht ab, siehe oben), wird aber durch Fix 3
        (kann gar nicht erst gespeichert werden) UND Fix 1 (blockiert den
        Fetch selbst bei einem trotzdem direkt konstruierten hostlosen
        Provider-Objekt) zuverlässig verhindert.
      - Bewusst NICHT angefasst (vom Review als 🔵 Nice-to-have eingestuft,
        auf ausdrücklichen Wunsch für dieses Fix-Paket zurückgestellt):
        Widget-Decorations ohne explizite `key`-Spezifikation im
        ProseMirror-Plugin, sowie ein case-insensitiver Pfad-Vergleich in
        `matchLength` (Pfad-Segmente sind streng genommen case-sensitiv,
        die aktuelle Groß/Klein-unabhängige Prüfung gilt nur für
        Schema+Host, s. o. – ein rein pfad-bezogener Edge-Case ohne
        Sicherheitsrelevanz).

57. **Doppelter Auto-Kommentar nach manueller Bearbeitung – mehrschichtiger
    Fix, v7.10 + Nachtrag v7.11** (`src/lib/feedback.js` NEU,
    `src/lib/anthropic.js`, `src/App.jsx`, 2× bzw. (v7.11) 3× von
    E2E-Testern beobachtetes Alt-🔵 aus v7.7). Nach einer
    manuellen Editor-Bearbeitung schaut das Modell einmal über die Änderung
    (`requestFeedback`); die Rückmeldung erschien manchmal ZWEIMAL
    hintereinander im selben Chat-Eintrag, fast identisch formuliert. Zwei
    zusammenwirkende Ursachen im selben Pfad:
    - **Ursache 1 (Doppelung):** `buildChatReply` (siehe Punkt 53/v7.6)
      kombiniert Vorab-Textblöcke seit v7.6 IMMER mit dem toolReply
      (Sicherheitsnetz gegen Inhaltsverlust – bleibt bewusst bestehen). Der
      bisherige Dublettenschutz verglich aber EXAKT: Schrieb das Modell die
      Einschätzung als Vorab-Text UND (minimal anders formuliert – nur
      Groß/Klein, Whitespace oder abschließendes Satzzeichen abweichend)
      zusätzlich ins reply-Feld, erkannte der exakte Vergleich das nicht,
      die Einschätzung landete doppelt im Chat.
    - **Ursache 2 (sichtbares ##OK##):** Der `requestFeedback`-Trigger bittet
      das Modell, bei „nichts Nennenswertes“ in reply EXAKT `"##OK##"` zu
      antworten; der App-Code prüfte das bislang nur per exaktem
      Gesamttext-Vergleich (`norm === "ok"` u. ä.). Schrieb das Modell
      trotzdem Vorab-Text vor dem Tool-Aufruf UND `##OK##` ins reply-Feld,
      kombinierte `buildChatReply` beides zu `"<Vorab-Text>\n\n##OK##"` – der
      Vergleich griff nicht mehr, der Nutzer sah eine Chat-Nachricht mit
      sichtbarem `##OK##`.
    - **Fix, drei Schichten (alle umgesetzt, bewusst nicht nur eine):**
      1. **Prompt-Vertrag:** `buildFeedbackTrigger` (neu in
         `src/lib/feedback.js`) ergänzt im Trigger-Text die Klausel
         „Schreibe KEINEN Text vor dem Tool-Aufruf – die GESAMTE Rückmeldung
         gehört ausschließlich in das reply-Feld.“ – dieselbe Technik wie
         die bestehenden ANTWORTFORMAT-/INTERNET-RECHERCHE-Verträge im
         System-Prompt (Punkt 53). Bekämpft die Ursache an der Quelle, statt
         sich allein auf die Code-Sicherheitsnetze zu verlassen.
      2. **`isNoFeedback` robuster** (`src/lib/feedback.js`): liefert `true`
         bei leerem reply, bei normalisiertem Gesamttext „ok“/„okay“/
         „notiert“, bei den bestehenden Floskeln – NEU zusätzlich, wenn der
         String `"##OK##"` IRGENDWO enthalten ist (deckt Ursache 2 ab).
         Bewusst NUR eine literale Enthalten-Prüfung des Sentinels, KEINE
         Fuzzy-Erkennung auf Wortteile – „ok“ als Teilstring von „okkult“
         darf nicht als „nichts zu melden“ durchgehen (Regressionstest
         pinnt genau das).
      3. **`buildChatReply`-Dublettenschutz normalisiert**
         (`src/lib/anthropic.js`): statt exaktem String-Vergleich jetzt eine
         normalisierte Gleichheit (trim, Whitespace-Folgen zu einem
         Leerzeichen, Kleinschreibung, abschließende Satzzeichen
         `.`/`!`/`…` entfernt) zwischen Vorab-Block und toolReply. Bei
         normalisierter Gleichheit gewinnt toolReply, der Vorab-Block wird
         verworfen. BEWUSST KEINE Containment-/Fuzzy-Logik (zu riskant für
         echte Inhalte – ein kurzer, legitimer Vorab-Satz, der zufällig als
         Teilstring im reply vorkommt, darf nicht verschluckt werden):
         geprüft wird ausschließlich normalisierte GLEICHHEIT, nicht
         Ähnlichkeit. Deckt damit gezielt genau den v7.7-Fall ab (dieselbe
         Aussage, nur anders formatiert), lässt inhaltlich unterschiedliche
         Vorab-Blöcke aber unangetastet.
    - **`src/lib/feedback.js` (neu):** `buildFeedbackTrigger(nbName,
      diffText)` baut den kompletten Trigger-String; der 8000-Zeichen-Deckel
      für den Diff (Token-Schutz bei Großumbauten) wanderte aus `App.jsx`
      mit hierher, damit der Vertrag an EINER Stelle steht und per Test
      pinnbar ist. `App.jsx#requestFeedback` nutzt beide Helfer, keine
      Logik-Kopie bleibt zurück; Verhalten sonst unverändert (ops nie
      angewendet, best effort, kein Fehler-Spam bei Fehlern).
    - **Tests:** `tests/feedback.test.js` (neu) – `buildFeedbackTrigger`:
      alle Vertragsklauseln (MANUELL-Hinweis, Diff- und Kein-Diff-Variante,
      Deckel exakt bei 8000/8001 Zeichen, ops-leer/commit-null, ##OK##-Regel,
      Kein-Vorab-Text-Klausel); `isNoFeedback`: leer/whitespace, Sentinel
      pur und mit Satzzeichen/Groß-Klein-Varianten, Floskeln, ##OK## mitten
      im Text (→ true, deckt Ursache 2), echte Beobachtung (→ false), „ok“
      als Wortteil in „okkult“/„provokant“ (→ false, kein Fuzzy-Match).
      `tests/anthropic.test.js` ergänzt: `buildChatReply` verwirft den
      Vorab-Block bei rein formaler Abweichung (Case/Whitespace/
      Satzzeichen) vom toolReply, behält ihn bei echt unterschiedlichem
      Inhalt (inkl. Containment-Gegenprobe: ein kurzer Vorab-Satz, der
      Teilstring des reply ist, bleibt erhalten) – bestehende Tests zu
      JSON-Payload-Filter und usedSearch-Recherchepfad unverändert grün
      (keine Anpassung nötig, da sie entweder exakt gleich oder eindeutig
      verschieden formulierte Texte verwenden).
    - Restrisiko (bewusst akzeptiert): Schicht 3 fängt nur FORMALE
      Abweichungen ab; formuliert das Modell die Einschätzung trotz Schicht
      1 inhaltlich UNTERSCHIEDLICH als Vorab-Text und im reply-Feld (z. B.
      unterschiedliche Wortwahl, nicht nur Formatierung), bleibt eine
      Doppelung theoretisch möglich – dagegen hilft nur der Prompt-Vertrag
      aus Schicht 1, der beim Live-Finding laut Root-Cause-Analyse die
      eigentliche Ursache war.

    **Nachtrag v7.11 – dritte Ausprägung derselben Fehlerfamilie, genau das
    oben genannte Restrisiko trat ein.** Der E2E-Retest fand ein neues 🔴:
    Das Modell duplizierte die Einschätzung diesmal INNERHALB des
    reply-Felds selbst – EINE Chat-Nachricht, zwei aufeinanderfolgende,
    inhaltlich identische, aber komplett unterschiedlich formulierte
    Absätze (Beispiel: „Achtung: Meine vorherige Bestätigung … steht im
    Widerspruch zum Dokument …“ gefolgt von „Achtung: Meine vorherige
    Notiz … widerspricht dem aktuellen Dokumentstand …“ – gleiche Aussage,
    fast keine gemeinsame Wortwahl). Der v7.10-Fix (Vorab-Text vs.
    toolReply, zwei verschiedene FELDER) greift hier konstruktionsbedingt
    nicht – `buildChatReply` sieht nur ein einziges reply-Feld.
    - **Fix, zweischichtig:**
      1. **Prompt-Vertrag (Klausel 4 in `buildFeedbackTrigger`):** „Fasse
         deine Rückmeldung in EINEM kompakten Absatz zusammen; wiederhole
         dieselbe Aussage nicht in anderen Worten.“
      2. **`dedupeFeedbackParagraphs(reply)`** (neu, `src/lib/feedback.js`):
         Absatz-Dublettenschutz INNERHALB eines reply-Texts. Guard: enthält
         der Text einen ```-Fence, bleibt er komplett unangetastet (Absatz-
         Split über Codeblöcke wäre riskant). Sonst Split an `/\n{2,}/`,
         pro Absatz Normalform (lowercase, Interpunktion raus, Whitespace-
         Kollaps), dann alle Paare (nicht nur Nachbarn) verglichen: Dublette
         AUSSCHLIESSLICH bei normalisierter GLEICHHEIT. Bei Dublette bleibt
         der ERSTE Absatz stehen, die Reihenfolge der übrigen bleibt
         erhalten. Absätze unter 5 Tokens werden NIE als Dublette gewertet
         (Schutz vor Grußformeln/kurzen Überschriften, die legitim
         wortgleich wiederkehren können).
      - **Korrektur nach Review-Fund (wichtig, ursprünglicher Entwurf hatte
        zusätzlich einen Jaccard-Zweig – WURDE WIEDER ENTFERNT):** Die
        erste Implementierung ergänzte den Gleichheits-Check um „ODER
        Jaccard-Ähnlichkeit der Token-MENGEN ≥ 0,4“ (kalibriert, weil der
        im Auftrag vorgeschlagene Wert 0,8 den Pflicht-Testfall mit nur
        ~0,4237 gemessenem Overlap verfehlt hätte). Der Code-Review verwarf
        diesen Zweig mit einer Gegenmessung: **fünf realistische Paare aus
        je ZWEI EIGENSTÄNDIGEN Beobachtungen zum selben Abschnitt**
        (paralleler Mehr-Befund-Stil, gleiches Satzgerüst, z. B. „fehlt der
        Beleg“ vs. „fehlt das Datum“) lagen bei **Jaccard 0,55–0,87** –
        HÖHER als der echte Paraphrase-Beleg-Fall (0,4237). Die Metrik ist
        für dieses Problem strukturell INVERTIERT: „gleiche Aussage, andere
        Worte“ ergibt NIEDRIGEN Wort-Overlap (jedes Inhaltswort wird
        umformuliert), „andere Aussage, gleiches Satzgerüst“ (paralleler
        Aufzählungsstil, den das Modell für mehrere Befunde im selben
        Abschnitt typischerweise verwendet) ergibt HOHEN Overlap (nur ein,
        zwei Wörter unterscheiden sich). Es existiert also KEIN
        Schwellwert, der beide Fälle korrekt trennt – jede Wahl hätte
        entweder den Paraphrase-Fall verpasst oder echte Mehrfach-Befunde
        stillschweigend verschluckt. Da stilles Löschen einer echten
        Beobachtung schwerwiegender ist als eine gelegentliche, weiterhin
        sichtbare Doppelung, wurde der Jaccard-Zweig komplett entfernt
        (inkl. der zugehörigen Konstante und Hilfsfunktion). Der Schutz vor
        paraphrasierten Doppelungen liegt jetzt AUSSCHLIESSLICH bei
        Schicht 1 (Prompt-Klausel 4); `dedupeFeedbackParagraphs` fängt nur
        noch exakte (bis auf Formatierung identische) Wiederholungen.
      - **Bewusst NUR im Feedback-Pfad** (`App.jsx#requestFeedback`, auf
        `reply` NACH der `isNoFeedback`-Prüfung, VOR `setChat`) angewendet,
        NICHT in `buildChatReply`/dem globalen Chat-Pfad: Dort tragen
        Absätze echte, vom Nutzer angestoßene Chat-Inhalte – ein
        fälschlich entfernter, tatsächlich eigenständiger Absatz wäre dort
        ein Inhaltsverlust und nicht tolerierbar. Die automatische
        Feedback-Nachricht ist dagegen reine Zusatz-Information.
    - **Tests:** `tests/feedback.test.js` ergänzt um `dedupeFeedbackParagraphs`
      (8 Fälle) – der echte (leicht gekürzte) Beleg-Paraphrase-Fall aus dem
      E2E-Finding bleibt jetzt bewusst ZWEIABSÄTZIG (umgedreht gegenüber dem
      ersten Entwurf, mit Kommentar zum akzeptierten Restrisiko); der vom
      Review benannte Template-Fall (zwei eigenständige Befunde „Beleg“ vs.
      „Datum“ im selben Satzgerüst) als gepinnter Regressionstest, der
      NICHT gemerged werden darf; zwei inhaltlich verschiedene, ähnlich
      lange Beobachtungen (beide bleiben); exakte Wiederholung mit nur
      Whitespace-/Groß-Klein-/Interpunktions-Unterschied (wird gemergt);
      Einzelabsatz/Leerstring unverändert; Fence-Guard (auch bei exakter
      Wiederholung); Kurz-Absatz-Schutz; „erster Absatz bleibt, Reihenfolge
      der übrigen erhalten“ bei mehreren exakten Dubletten. Alle
      Jaccard-spezifischen Tests entfernt.
    - Restrisiko (ehrlich benannt, NICHT mehr Jaccard-abgesichert): Eine
      paraphrasierte Doppelung wie im v7.11-Live-Finding kann grundsätzlich
      wieder auftreten, wenn sich das Modell nicht an die Prompt-Klausel
      hält – der Code fängt sie nicht mehr ab. Der nächste sinnvolle
      Schritt bei einem erneuten Live-Finding dieser Art ist eine
      Prompt-Nachschärfung (Klausel 4 weiter präzisieren, ggf. mit
      Few-Shot-Beispiel), NICHT ein erneuter Versuch mit Fuzzy-Matching auf
      Wortebene – dessen strukturelle Untauglichkeit für dieses Problem ist
      jetzt empirisch belegt (siehe Messwerte oben).

58. **Azure-DevOps-302-Maskierung entlarvt + automatische Titel-Ermittlung
    „egal wo sie herkommt“, v7.12** (`src/lib/linkProviders.jsx`,
    `src/components/DocEditor.jsx`, `src/App.jsx`, Nutzer-Live-Befund +
    Nutzerwunsch). Zwei Teile.
    - **Teil A – DevOps-Fehlerdiagnose (empirisch verifiziert, curl gegen
      dev.azure.com/reasult):** Der Nutzer bekam trotz eingetragenem PAT
      „Netzwerk/CORS“-Fehler bei der Titel-Ermittlung eines DevOps-Links.
      Ursache: der CORS-Preflight der Azure-DevOps-REST-API ist unauffällig
      (`Access-Control-Allow-Origin: *`), aber OHNE gültige Auth antwortet
      die API NICHT mit 401, sondern mit einem **302-Redirect** zur
      Login-Seite (`spsprodweu3.vssps.visualstudio.com`) – die hat KEINE
      CORS-Header, der Browser-`fetch` wirft daran ein nichtssagendes
      `TypeError`, das `fetchLinkTitle` bisher unterschiedslos zu
      „Netzwerk/CORS-Fehler“ normalisierte. **Jeder** Auth-Fehler (PAT
      ungültig/abgelaufen, falsche Organisation, fehlender Scope) maskierte
      sich dadurch als Netzwerkproblem – der Nutzer konnte nie erkennen,
      dass sein PAT das eigentliche Problem war. Mit dem Header
      `X-TFS-FedAuthRedirect: Suppress` (vom Preflight nachweislich
      erlaubt) antwortet die API stattdessen sauber `401` als JSON. Fix in
      `fetchLinkTitle` (azure-devops-Zweig, Confluence-Zweig bewusst NICHT
      angefasst – dessen CORS-Grenze ist real und bleibt bestehen):
      1. Header `X-TFS-FedAuthRedirect: Suppress` immer mitsenden.
      2. Zusätzlich `redirect: "manual"` im fetch-Init (Gürtel+Hosenträger):
         sollte der Header dennoch ignoriert werden, liefert der Browser
         eine Response mit `type: "opaqueredirect"` (`status: 0`) statt dem
         Login-Ziel zu folgen und dort an CORS zu scheitern – wird unten
         wie 401 behandelt statt als generischer Netzwerkfehler.
      3. Klares, statuscode-spezifisches Fehler-Mapping
         (`azureDevOpsErrorReason`): 401 → „PAT ungültig oder abgelaufen,
         oder PAT gehört nicht zur Organisation ‚{org}‘.“; 403 → „PAT-
         Berechtigung fehlt (Scope ‚Work Items: Read‘) oder Organisations-
         Richtlinie blockiert PAT-Zugriff.“; 404 → „Work Item {id} nicht
         gefunden.“; `opaqueredirect` → wie 401. Reason enthält NIE das
         PAT/den Authorization-Header (org/id kommen aus `parseWorkItemUrl`,
         nicht aus der – bei einem Auth-Fehler ohnehin leeren – Antwort).
      - **Tests** (`tests/linkProviders.test.jsx`, neuer Block „Auth-Fehler-
        Mapping“): Suppress-Header + `redirect:"manual"` im Request
        nachgewiesen; 401/403/404/`opaqueredirect`-Mapping mit exaktem
        Text; PAT-Wert taucht nicht in der reason auf; ein Erfolgsfall und
        die Host-Verankerung aus Punkt 56 bleiben als Regressionstest grün.
    - **Teil B – automatische Titel-Ermittlung überall (Nutzerwunsch):**
      Punkt 56s Grundsatz „Fetch NUR auf explizite Nutzeraktion im
      Link-Popover, NIE beim Rendern“ wird abgelöst durch „Fetch bei
      Einfügen/Speichern, NIE beim Rendern“ – der Netzzugriff bleibt
      weiterhin an genau zwei Bedingungen geknüpft (konfigurierter Provider
      MIT Zugangsdaten deckt die URL ab; Host-Verankerung aus Punkt 56
      unverändert), nur die AUSLÖSER werden mehr:
      1. **Gemeinsamer Auflöser `resolveProviderLinkTitles(md, opts)`**
         (`src/lib/linkProviders.jsx`, neu) → `Promise<string>`, wirft nie.
         Scannt das Dokument AUSSERHALB von Fences (`splitFenceSegments`,
         `code.jsx` – GEFAHRLOS importierbar, da `code.jsx` selbst ein
         Blatt ist) und Codespans (Split wie `renumberCitations`,
         `markdown.jsx`) nach drei unaufgelösten Link-Formen: (a) nackte
         URL, (b) `<url>`-Autolink, (c) `[Titel](url)` NUR bei
         Titel===URL – EIN Scan-Regex (`PROVIDER_LINK_SCAN_RE`), das
         zugleich Bilder (`![…](…)`, IMMER übersprungen) und Quellen-
         Fußnoten/echte Titel (Titel≠URL, IMMER übersprungen) korrekt
         ausklammert, indem die frühere/größere Alternative die spätere
         URL-Teilmenge konsumiert (gleiches Muster wie `INLINE_TOKEN_RE`,
         `markdown.jsx`). **Zwei URL-Grammatiken dupliziert** (Zirkelbezug:
         `linkProviders.jsx` ist ein Blatt, `markdown.jsx` importiert
         umgekehrt daraus): `BRACKETED_URL_SRC` (= `LINK_URL_RE`, EINE
         Ebene balancierter Klammern) für (b)/Bild-Ziele, `NAKED_URL_SRC`
         (= `INLINE_TOKEN_RE`s lose Alternative `[^\s<>]+`) für die nackte
         URL – bewusst NICHT dieselbe Grammatik wie (b): eine nackte URL
         erlaubt (wie im Viewer) auch UNBALANCIERTE Klammern im rohen
         Match, die Grenze zieht erst `trimBareUrl` (ebenfalls aus
         `markdown.jsx` dupliziert) NACH dem Match – sonst hätte z. B. ein
         DevOps-Link in Prosa-Klammern `(siehe https://…/edit/9)` die
         schließende Klammer fälschlich in die URL übernommen. Pro
         Fundstelle (max. `maxLinks`, Default 5, dokumentweit gezählt –
         NICHT nur Kandidaten mit Provider-Match, siehe Restrisiko unten):
         `providerFor`+`providerHasCredentials` → bei Treffer
         `fetchLinkTitle` (parallel via `Promise.allSettled`); bei `ok`
         Ersetzung durch `[<Titel>](url)` (der Titel ist bereits durch
         `cleanupLinkTitle` bereinigt, `fetchLinkTitle` prüft das schon
         selbst); bei Fehler ODER fehlendem Provider bleibt die Fundstelle
         BYTE-GENAU unverändert (still, kein UI-Spam). Gleiche URL
         mehrfach im Dokument → nur EIN `fetchLinkTitle`-Aufruf (Cache über
         eine `Map`, pro Aufruf von `resolveProviderLinkTitles` neu), das
         Ergebnis wird auf ALLE ihre Fundstellen angewendet. Idempotent von
         selbst: ein aufgelöster Link hat Titel≠URL und wird bei einem
         zweiten Lauf nicht mehr als Kandidat erkannt. **Schneller No-op**
         (kein Scan, kein `fetchImpl`-Aufruf), wenn KEIN konfigurierter
         Provider überhaupt Zugangsdaten trägt – die häufigste Nutzer-
         Konstellation (kein Provider konfiguriert) bleibt dadurch praktisch
         kostenlos.
      2. **Link-Dialog** (`src/components/DocEditor.jsx`): Auto-Fetch beim
         URL-Eintippen/-Einfügen, debounced 600 ms
         (`AUTO_FETCH_DEBOUNCE_MS`) über `scheduleAutoFetch`/`runAutoFetch`
         – ein `AbortController` pro Debounce-Zyklus (`titleAutoRef`,
         `cancelAutoFetch`) verwirft bei jeder neuen Eingabe zuverlässig
         einen noch wartenden ODER bereits laufenden vorherigen Versuch
         (dessen Ergebnis wird nach Rückkehr verworfen, nicht mehr
         angewendet). Zwei reine, exportierte Helfer dafür aus der
         Komponente herausgezogen (ohne Editor-Instanz/DOM testbar):
         `autoFetchProviderFor(url, configured)` (identische Prüfung wie
         der manuelle Knopf, jetzt EINMAL für beide Auslöser) und
         `applyAutoFetchResult(linkForm, lastAutoTitle, res)` – füllt/
         korrigiert das Titelfeld NUR, solange es noch leer ist ODER
         weiterhin den zuletzt AUTOMATISCH eingetragenen Wert trägt
         (`lastAutoTitleRef`); ein manuell getippter Titel wird dadurch
         NIE überschrieben und NIE nachträglich mit einer für den Nutzer
         irrelevanten Fehlermeldung gestört (liefert bei „nicht mehr frei“
         dieselbe `linkForm`-Referenz zurück, Aufrufer erkennt daran, ob
         etwas angewendet wurde). Der bestehende „Titel ermitteln“-Knopf
         (Punkt 56) bleibt als manueller Retry UND verwirft seinerseits
         einen laufenden Auto-Fetch (Klick hat Vorrang); derselbe
         `titleFetching`-Zustand/Spinner wird für BEIDE Auslöser verwendet
         (kein zweiter Lade-Indikator nötig – der Knopf erscheint ohnehin
         erst, sobald die URL zu einem Provider passt, und zeigt dann den
         Spinner, sobald der Debounce feuert). Fehlertext läuft wie bisher
         in `linkForm.error` (jetzt mit den klaren Teil-A-Meldungen).
      3. **Editor-Speichern** (`src/App.jsx`, `saveEdit`): Das GANZE
         Dokument läuft VOR `renumberCitations`/der übrigen Bereinigung
         durch `resolveProviderLinkTitles` – deckt sowohl frisch
         eingefügte/eingetippte Links (Markdown-Paste) als auch ALTE, noch
         unaufgelöste Links ab (Titel===URL, z. B. vor v7.12 gespeichert) –
         Letzteres bewusst gewollt (siehe Restrisiko unten). `saveEdit`
         musste dafür umgebaut werden (Await jetzt VOR dem „hat sich was
         geändert“-Vergleich, da die Auflösung selbst die einzige Änderung
         sein kann): `setSavingEdit(true)` umschließt jetzt Auflösung +
         Bereinigung + Commit gemeinsam in einem `try/finally`, ein
         `conflict`-Flag ersetzt das frühere `return` mitten im `try`
         (Editor bleibt bei einem SHA-Konflikt weiterhin offen, Inhalt
         bleibt erhalten – unverändertes Verhalten, nur ohne toten Code
         nach einem `return` in `try`). `resolveProviderLinkTitles` wirft
         nie – ein Fetch-Fehler lässt den Text unaufgelöst, das Speichern
         läuft ungehindert weiter.
      4. **Chat-Ops** (`src/App.jsx`, `send()`): Vor der Gruppierung nach
         Ziel-Notizbuch läuft JEDES `op.content` (sofern String) einzeln
         durch `resolveProviderLinkTitles` – NIE das Bestandsdokument
         (`applyOps` wendet das Fragment ohnehin gezielt auf einen
         Abschnitt an; Chat-Änderungen bleiben dadurch minimal-invasiv wie
         bisher). `Promise.all` über alle ops, danach unverändert weiter
         mit den (jetzt aufgelösten) ops.
      - **Tests:** `tests/linkProviders.test.jsx` erweitert (Teil A, siehe
        oben); NEUE Datei `tests/resolveProviderLinkTitles.test.jsx` (Teil
        B, 24 Fälle: alle drei Ersetzungsformen; Fußnote/echter Titel/Bild/
        `img:`-Referenz bleiben unangetastet; Fence UND Codespan bleiben
        unangetastet, auch wenn dieselbe URL AUSSERHALB aufgelöst wird;
        Fetch-Fehler (404, TypeError) lassen die Fundstelle unverändert;
        URL-Dedupe (ein Fetch für zwei Fundstellen derselben URL, BEIDE
        werden ersetzt); `maxLinks`-Deckel Default UND explizit gesetzt;
        Idempotenz (zweiter Lauf: 0 weitere Fetches, Ergebnis identisch);
        gemischtes Dokument mit mehreren Providern (nur passende Treffer
        werden aufgelöst); trailing Satzzeichen/Prosa-Klammern um eine
        nackte URL werden korrekt abgetrennt, inkl. einer zur URL
        gehörenden balancierten Klammer, die dabei erhalten bleibt (echte
        Auflösung als Nachweis, kein Original-bleibt-gleich-Vakuumtest);
        schneller No-op ohne/mit-credentiallosem Provider, `fetchImpl`
        NIE gerufen; leerer/`null`/`undefined`-Input; **beim Schreiben
        gefundener Test-Fallstrick, kein Produktivbug:** ein Test ohne
        explizites `fetchImpl` hätte in der Node-Testumgebung (Node ≥18
        hat ein GLOBALES `fetch`) einen ECHTEN Netzwerk-Request an
        `dev.azure.com` ausgelöst und nur zufällig „bestanden“, weil der
        Request in der Sandbox fehlschlug – kein deterministischer Test;
        behoben mit `vi.stubGlobal("fetch", undefined)`). `tests/
        docEditorLinks.test.jsx` – neuer Block für `autoFetchProviderFor`/
        `applyAutoFetchResult` (Provider-mit/ohne-Credentials, kein Match,
        ungültige URL; Titelfeld leer/zuletzt-automatisch wird gefüllt,
        manuell getippter Titel wird NIE überschrieben – weder bei Erfolg
        noch bei Fehler, geprüft über Referenzgleichheit; `linkForm===null`
        bleibt `null`).
      - Restrisiken: (a) ~~Der `maxLinks`-Deckel zählt JEDE unaufgelöste
        Fundstelle (auch ohne passenden Provider) gegen das Kontingent,
        nicht nur tatsächlich auflösbare – ein Dokument mit vielen
        provider-fremden nackten URLs VOR einem einzelnen echten
        Provider-Link könnte dessen Auflösung verdrängen. Akzeptiert…~~
        **KORRIGIERT, siehe Nachbesserung unten** – dieses „akzeptierte"
        Restrisiko war tatsächlich real reproduzierbar (empirisch belegt:
        fünf `example.org`-URLs vor einem DevOps-Link verhinderten dessen
        Auflösung vollständig) und wurde im Code-Review vor dem Commit als
        🟡-Finding gemeldet und behoben, nicht länger akzeptiert. (b) Ein
        Speichern OHNE jede sonstige inhaltliche Änderung kann jetzt einen
        Commit auslösen, wenn das Dokument einen alten `Titel===URL`-Link
        enthält – bewusst gewollt (Auftrag), aber ein Nutzer, der den
        Editor nur öffnet und ohne jede Absicht sofort wieder speichert,
        bekommt dadurch überraschend einen neuen Commit. (c) Die
        DevOps-302-Erkenntnis stammt aus curl-Proben gegen EINE
        Organisation (`dev.azure.com/reasult`) – sollte eine andere
        Azure-DevOps-Organisation/ein Sovereign-Cloud-Tenant abweichendes
        Verhalten zeigen, greift der Fix ggf. nicht vollständig; der
        `redirect:"manual"`-Fallback deckt zumindest den Fall ab, dass der
        Suppress-Header selbst ignoriert wird. Bewusst NICHT angefasst (vom
        Review als 🔵 eingestuft, dokumentiert statt behoben): Ein
        `redirect:"manual"`-Restrisiko (die opaqueredirect-Erkennung deckt
        nur den einen empirisch geprüften Fall ab) sowie kosmetische
        Zwischenstände während des Auto-Fetch-Debounce im Link-Popover.
      - **Nachbesserung (Code-Review vor dem Commit, v7.12 bleibt v7.12 –
        reine Korrektur des noch uncommitteten Stands, kein neues Feature):**
        Drei Findings, alle behoben:
        1. **`maxLinks`-Aushungerung** (`src/lib/linkProviders.jsx`,
           `scanChunkForProviderLinks`, 🟡): der Provider-Match
           (`providerFor`+`providerHasCredentials`, beides synchron) wird
           jetzt SCHON IM SCAN geprüft – nur eine Fundstelle MIT echtem
           Match+Zugangsdaten verbraucht den `maxLinks`-Deckel und wird zum
           Kandidaten (der Kandidat trägt jetzt zusätzlich `provider`,
           `resolveProviderLinkTitles` muss `providerFor` in der
           Fetch-Phase dadurch nicht mehr redundant nochmal aufrufen).
           `maxLinks` bedeutet seither „maximal so viele Provider-Links MIT
           Match pro Lauf auflösen", nicht mehr „maximal so viele
           unaufgelöste Fundstellen überhaupt anfassen" – vorher hätten
           mehrere provider-fremde URLs (z. B. externe Wissensbasis-Links)
           VOR einem einzelnen echten Provider-Link dessen Auflösung
           verlässlich verhindert (empirisch mit fünf `example.org`-URLs +
           einem DevOps-Link nachgestellt). **Tests:** zwei neue Fälle im
           Block „maxLinks-Deckel" (`tests/resolveProviderLinkTitles.test.jsx`)
           – genau das Review-Szenario (5 Fremd-URLs + 1 DevOps-Link → der
           DevOps-Link WIRD aufgelöst, die Fremd-URLs bleiben unangetastet)
           sowie die Kehrseite (mehr als `maxLinks` ECHTE Provider-Links →
           der Deckel greift weiterhin, sonst wäre der Fix selbst eine
           Regression).
        2. **Grammatik-Drift ohne Schutz** (`src/lib/linkProviders.jsx`,
           `src/lib/markdown.jsx`, 🟡): `BRACKETED_URL_SRC`/`NAKED_URL_SRC`
           sind jetzt EXPORTIERT; `trimBareUrl` wurde NICHT länger als
           Duplikat gepflegt, sondern nach `linkProviders.jsx` verschoben,
           dort exportiert und von `markdown.jsx` importiert (zirkelfrei,
           da `markdown.jsx` bereits `providerFor`/`getLinkProviders` von
           dort importiert – linkProviders.jsx importiert umgekehrt nichts
           aus `markdown.jsx`) – EINE Quelle statt eines reinen Pin-Tests,
           wo technisch möglich. Für die beiden verbleibenden, weiterhin
           zwingend duplizierten Grammatik-Konstanten (Zirkelbezug
           verhindert einen direkten Import in DIESE Richtung) wurde die
           lose Bare-URL-Alternative aus `markdown.jsx`s `INLINE_TOKEN_RE`
           als eigener exportierter Name `BARE_URL_INLINE_SRC` herausgezogen
           (`LINK_URL_RE` war schon exportiert). **Test:** neuer Block
           „Grammatik-Drift-Pin" importiert BEIDE Module direkt (ein
           Testfile darf das, ohne selbst Teil eines Laufzeit-Zirkels zu
           werden – zirkelgefährdet wäre nur ein Import zwischen
           `linkProviders.jsx` und `markdown.jsx` selbst) und pinnt
           `BRACKETED_URL_SRC === LINK_URL_RE.source` sowie
           `NAKED_URL_SRC === BARE_URL_INLINE_SRC`.
        3. **Stiller Datenverlust bei gebrochenem "wirft nie"-Vertrag**
           (`src/App.jsx`, `saveEdit`, 🔵): `resolveProviderLinkTitles`
           bekommt jetzt ein `.catch(() => md)` – bräche der Vertrag doch
           einmal, wäre `cleaned` sonst nie zugewiesen und die manuelle
           Bearbeitung ginge beim Schließen des Editors STILL verloren
           (kein Commit, kein Fehler-Banner). Der Fallback stellt sicher,
           dass mindestens der unaufgelöste Text gespeichert wird.
        - **Tests:** 4 neue Fälle (2 maxLinks-Regression + 2
          Grammatik-Drift-Pin), Gesamtstand 546/546 grün,
          `linkProviders.jsx` 98.61 % Statements/89.65 % Branches/99.57 %
          Lines.
