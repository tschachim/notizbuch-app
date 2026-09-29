# TODO – offene Punkte für kommende Runden

Sammelstelle für 🔵-Findings aus E2E-/Review-Läufen und bewusst
vertagte Punkte aus DECISIONS.md. Erledigte Einträge werden mit
Versions- und DECISIONS-Verweis gestrichen, nicht gelöscht.

## Aus dem E2E-Lauf v7.57.2 / v7.57.3 (2026-09-29/30)

- [ ] **Fokus nach Link-Einfügen (Editor, beobachtet bei D7/D7b).** Nach
      „Einfügen“ im Link-Popover liegt der Fokus nicht mehr im Editor;
      Enter im URL-Feld löst nichts aus (Knopf ohne `type`, implizit
      submit, kein `<form>`). Erwartung: Fokus zurück in den Editor hinter den
      Link, Enter im URL-Feld = Einfügen. `src/components/DocEditor.jsx`.
- [ ] **C28 – Tool-Markup im Chattext.** Bei einer reinen Rückfrage stand
      am Ende der Antwortblase wörtlich `</parameter>` und
      `<parameter name="ops">[]`. Modellverhalten (Sonnet 5); prüfen,
      ob der Antworttext vor der Anzeige von Tool-Tag-Resten bereinigt
      werden sollte (nur Anzeige, keine Ops-Änderung). `src/lib/anthropic.js`
      (extractParsed, Reply-Extraktion) / Chat-Rendering in `src/App.jsx`.
- [ ] **C26 – falsche Modellaussage „zwei Kapitel“.** Dokument war
      korrekt, das Modell behauptete ein Duplikat und stellte deshalb
      beim Aufräumschritt eine unnötige Rückfrage beim Löschen. Reiner Kommentartext, kein
      Datenfehler; beobachten, bei Häufung Prompt-Hinweis erwägen.
- [ ] **G1b – Versionszähler kurz veraltet.** 30 ms nach schnellem
      Notizbuch-Wechsel zeigte der Kopf den alten Zähler desselben
      Notizbuchs (10 statt 11). Einmalig, in 8 Zyklen nicht
      reproduzierbar. Nur bei Wiederauftreten untersuchen.
- [ ] **Schnellnotizen-Altlast im localStorage.** Im QA-Browser enthält
      `notizbuch:quicknotes` zwei verwaiste Schlüssel für Notizbücher,
      die es im verbundenen Repo nicht mehr gibt (eins mit
      Klartext-Post-it). Vermutlich Rest aus Repo-Wechseln
      (E2f-Klasse). Prüfen, ob verwaiste Schlüssel beim Laden der
      Notizbuchliste bereinigt werden sollten. `src/App.jsx`
      (QUICKNOTES_KEY) / `src/lib/quicknotes.js` (parseQuickNotesCache).
- [ ] **Codeblock in Listenpunkt 2. Ebene (4 Leerzeichen).** Wird in der
      Ansicht weiterhin als Text gerendert (CommonMark-Grenze von
      `FENCE_OPEN_RE` in `src/lib/code.jsx`). Beträfe
      `computeFenceLineMask`, `ops.js` und den Editor-Ladepfad. Siehe
      DECISIONS #133.
- [ ] **Chat-Pfad strippt Zaun-Einrückung nicht.**
      `expandFencedCodeInNodes` (`src/lib/code.jsx`) nutzt `seg.text`
      unverändert; ein
      eingerückter Fence in einer Chat-Antwort behält führende
      Leerzeichen. Einzeiler mit `stripFenceIndent`, dafür müsste
      `splitFenceSegments` `indent` durchreichen. Siehe DECISIONS #133.

## Aus früheren DECISIONS-Einträgen (bewusst vertagt)

- [ ] **MAX_FACTS-Deckel ohne Hinweis im Prompt** (Feedback-Fakten,
      DECISIONS #130/#131). Beim Abschneiden auf 20 Fakten erfährt das
      Modell nichts davon. Kosten-/Latenz-Randfall.
- [ ] **`raw`-Fallback in `buildFeedbackFacts()`** (DECISIONS #131). Der
      `d.l`-Zweig gilt als praktisch unerreichbar; Änderung wäre eine
      Verhaltensänderung, daher offen gelassen. `src/lib/feedback.js`.
- [ ] **Codeblock per Toolbar-Knopf innerhalb eines Listenpunkts**
      (DECISIONS #99, Testfall D6b-Hinweis). TipTaps ListItem verlangt
      einen Absatz als erstes Kind; der Knopf hebt den Block aus der
      Liste. Schema-Änderung bräuchte eine breite Testrunde gegen alle
      Listen-Interaktionen im Editor.

## Erledigt

- [x] **D6b – eingerückter Codeblock in der Ansicht** → v7.57.3,
      DECISIONS #133.
- [x] **Chat-Eingabefeld sitzt zu weit oben** → v7.57.2, DECISIONS #132.
