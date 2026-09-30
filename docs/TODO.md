# TODO – offene Punkte für kommende Runden

Sammelstelle für 🔵-Findings aus E2E-/Review-Läufen und bewusst
vertagte Punkte aus DECISIONS.md. Erledigte Einträge werden mit
Versions- und DECISIONS-Verweis gestrichen, nicht gelöscht.

## Aus der v7.58-Runde (2026-09-30)

- [ ] **Editor: Enter direkt nach einem AutoKorrektur-Trigger verschluckt den
      Absatzwechsel (ENTSCHEIDUNG NÖTIG).** „a --“ + Enter, „1/2“ + Enter,
      „\alpha“ + Enter (terminator-/word-/backslash-Trigger) ergeben EINEN
      Absatz mit dem Text „a –\n“ (literales \n im Textknoten, kein neuer
      Absatz). Stand aus dem Review der AutoKorrektur-Aufgabe:
      BESTÄTIGT per Wegwerf-Test gegen den echten TipTap-Editor
      (`handleKeyDown` liefert true, `childCount` 1). Ursache: TipTap ruft
      die InputRules bei Enter mit dem Text „\n“ auf, die
      Abschlusszeichen-Klassen der Regeln (`[^->]$`, `[^0-9]$`, `[^A-Za-z]$`)
      passen darauf. Das Post-it verhält sich richtig („a –“ + Zeilenumbruch).
      Ansatz A: in der AutoCorrect-Extension Enter gesondert behandeln (Regel
      anwenden, das „\n“ aus dem Ersatz entfernen, danach den normalen
      Absatzwechsel auslösen). Ansatz B: Abschlussklassen in `compileEntry`
      um „\n“ erweitern, wenn der Editor bei Enter gar nicht ersetzen soll –
      das änderte auch das Post-it und bräuchte angepasste Enter-Tests.
      `src/components/DocEditor.jsx` (AutoCorrect-Extension,
      ca. Zeile 1794) / `src/lib/autocorrect.js`. Siehe DECISIONS #134.
- [ ] **AutoKorrektur im Chat-Eingabefeld ist nicht angebunden.** Die
      Funktionen in `src/lib/autocorrectInput.js` und `nativeTextEdit.js`
      sind feldunabhängig; das Cursor-Setzen nach einer Ersetzung braucht im
      Chat-`<textarea>` (`src/App.jsx`) einen eigenen Weg (kontrolliertes
      Feld, Selektion nach dem Re-Render nachziehen). Nur auf Nutzerwunsch.
- [ ] **AutoKorrektur im Post-it: Touch-Tastaturen und Firefox/Safari nur
      per Fallback abgesichert.** Der native Pfad (`execCommand`) ist nur in
      Chromium gemessen; Android/Gboard, iOS, Firefox und Safari laufen über
      den Zustands-Fallback bzw. die fail-closed-Positivliste, sind aber
      nicht am Gerät geprüft. Kein Feuern nach `compositionend` (bewusste
      Abweichung vom Editor). E2E-Fall E4/E4b prüft nur Chromium/Desktop.
      Bei Nutzerbefund am Gerät: `beforeinput`-Verhalten (Backspace als
      „Unidentified“) und Wortvorschläge gezielt untersuchen. DECISIONS #134.
- [ ] **Testlücken und Eigenheiten AutoKorrektur im Post-it (🔵,
      Review).** Mutationsprüfung des Reviews (35 Mutanten, 5 Testlücken in
      `QuickNotes.jsx`), das Verhalten ist heute korrekt und mehrfach
      abgesichert:
      (1) `tryRevertRef.current = tryRevert` (Layout-Effect) – Test mit
      umschaltbarem `onChange`-Handler (spyA, dann spyB; „ab->“ tippen,
      umschalten, `beforeInput(el, "deleteContentBackward")`: spyB erhält
      „ab->“, spyA nicht mehr). (2) Merker-Verfall durch fremde
      input-Events (`recordRef.current = null` in `handleChange`) und
      Verbrauch in `tryRevert` sind nicht diskriminierend getestet – Fall:
      nach „ab→“ „z“ tippen, Wert per Prototyp-Setter auf „ab→XYZ“
      zurücksetzen, Cursor 3, `deleteContentBackward`-InputEvent; danach darf
      `beforeInput(...).defaultPrevented` nicht true sein. (3) Die äußeren
      `onChange` nach nativer Ersetzung/nativem Undo sind durch das
      verschachtelte input-Event der Stubs redundant – stummen
      `insertText`-Stub (setRangeText ohne input-Event) und analog einen
      `undo`-Stub testen (Wert „ab→XYZ“, `lastText()` gleich, Cursor [3, 3]).
      (4) Bekannte Eigenheit (kosmetisch): Der historyUndo-Kollaps greift
      auch bei fremden Undo-Schritten, die zufällig eine Trigger-Spanne (ggf.
      plus Umbruch) markiert wiederherstellen – Cursor statt Markierung, ggf.
      am Anfang der Folgezeile.
      `tests/quickNotesAutocorrect.test.jsx`.
- [ ] **Link-Popover: Testlücken und Entscheidungen (🔵, Review).**
      (1) Die Tests pinnen „ohne rAF“, aber nicht „synchron im Handler“:
      der Mutant `returnFocusToEditor = () => setTimeout(() =>
      editor.view.focus(), 0)` besteht alle 40 Tests – Test, der
      `activeElement` im selben Tick nach dem Klick/Enter liest.
      (2) `removeLink`: Mutanten ohne `cancelAutoFetch()` und ohne
      `setPicker(null)` überleben – Test „nach Entfernen öffnet ein Klick
      das Popover wieder“ und Fake-Timer-Fall (URL ändern, Entfernen,
      `advanceTimersByTime(10_000)`, kein Fetch).
      (3) Nebenwirkung von `unsetMark`: direkt nach dem Einfügen ist
      `editor.isActive("link")` false (Knopf nicht hervorgehoben, erneutes
      Öffnen zeigt „Einfügen“). Optional: `openLinkPicker` behandelt eine
      leere Selektion direkt hinter einem Link als bestehenden Link (z. B.
      über `$from.nodeBefore?.marks`).
      (4) Bestand: Beim Öffnen des Popovers wird kein Feld fokussiert (kein
      `autoFocus`; Enter wirkt erst nach Klick ins Feld), Escape schließt es
      nicht; `fetchTitleForLink` (manueller Knopf) prüft nach dem `await`
      kein Abbruch-Signal; ein Klick in den Editorbereich
      (`onClick={() => picker && setPicker(null)}`) schließt das Popover
      ohne `cancelAutoFetch()`, und `runAutoFetch` ruft `setTitleFetching(false)`
      vor der Abort-Prüfung auf (folgenlos, nicht blockierend);
      `openLinkPicker` nutzt bei bestehendem Link weiter `chain().focus()`.
      (5) Android/Gboard: Enter während einer Wortkomposition (`isComposing`/
      `keyCode` 229) löst im Popover nichts aus (IME-Absicherung; der Knopf
      funktioniert).
      `src/components/DocEditor.jsx`, `tests/docEditorLinkPopover.test.jsx`.
- [ ] **Tool-Markup-Bereinigung: Randfälle (🔵, Review, DECISIONS #136).**
      (1) Ein Rest in Blöcken mit CRLF im `reply`-String bleibt unverändert
      (`FENCE_OPEN_RE` greift bei „\r“ nicht; Modell-Antworten kommen mit LF).
      (2) Der frühe `max_tokens`-Zweig in `callClaude` läuft nicht durch die
      Bereinigung (unkritisch, dort werden nie Ops angewandt).
      `src/lib/anthropic.js`.

## Aus dem E2E-Lauf v7.57.2 / v7.57.3 (2026-09-29/30)

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

## Aus früheren DECISIONS-Einträgen (bewusst vertagt)

- [ ] **`raw`-Fallback in `buildFeedbackFacts()`** (DECISIONS #131). Der
      `d.l`-Zweig gilt als praktisch unerreichbar; Änderung wäre eine
      Verhaltensänderung, daher offen gelassen. `src/lib/feedback.js`.
- [ ] **Codeblock per Toolbar-Knopf innerhalb eines Listenpunkts**
      (DECISIONS #99, Testfall D6b-Hinweis). TipTaps ListItem verlangt
      einen Absatz als erstes Kind; der Knopf hebt den Block aus der
      Liste. Schema-Änderung bräuchte eine breite Testrunde gegen alle
      Listen-Interaktionen im Editor.

## Erledigt

- [x] **AutoKorrektur in Schnellnotizen** (Nutzerbefund: im Post-it blieb
      „->“ roh) → v7.58, DECISIONS #134.
- [x] **Fokus nach Link-Einfügen; Enter im Link-Popover = Einfügen**
      (D7/D7b-Beobachtung) → v7.58, DECISIONS #135.
- [x] **C28 – Tool-Markup im Chattext** (Reste `</parameter>`/
      `<parameter name="ops">[]` am Blasenende) → v7.58, DECISIONS #136.
- [x] **Chat-Pfad strippt Zaun-Einrückung nicht** → v7.58, DECISIONS #137.
- [x] **MAX_FACTS-Deckel ohne Hinweis im Prompt** → v7.58, DECISIONS #138.
- [x] **Cursor-Kollaps nach „Entfernen“ im Link-Popover (Entscheidung des
      Orchestrators: beibehalten)** → v7.58, DECISIONS #135.
- [x] **Tool-Markup-Bereinigung: Teilkürzung präzisiert und per Pin-Test
      festgeschrieben, Tag-Rumpf auf echte Attribut-Syntax beschränkt** →
      v7.58, DECISIONS #136.
- [x] **MAX_FACTS-Hinweis: Wortlaut („keine Vorkommen ermittelt“) und
      Testtitel präzisiert** → v7.58, DECISIONS #138.
- [x] **Kosmetik: falsche DECISIONS-Verweise in Code-Kommentaren und
      Testtiteln angeglichen** (#136 Tool-Markup, #137 Zaun-Einrückung,
      #138 MAX_FACTS) → v7.58.
- [x] **D6b – eingerückter Codeblock in der Ansicht** → v7.57.3,
      DECISIONS #133.
- [x] **Chat-Eingabefeld sitzt zu weit oben** → v7.57.2, DECISIONS #132.
