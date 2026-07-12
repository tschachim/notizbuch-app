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
