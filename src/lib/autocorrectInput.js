/* ------------------------------------------------------------------ */
/* AutoKorrektur für einfache Textfelder (Schnellnotiz-<textarea>)     */
/*                                                                     */
/* BLATT im Abhängigkeitsbaum (wie textIndent.js): importiert NICHTS,   */
/* kennt weder DOM noch React noch TipTap und wirft nie – kaputte       */
/* Argumente liefern null/false. Die Regeln kommen als Parameter aus    */
/* buildActiveRules() (lib/autocorrect.js); es gibt bewusst KEINE zweite */
/* Trigger-Liste. Die Semantik ist die der TipTap-InputRules im         */
/* Dokument-Editor (node_modules/@tiptap/core/src/InputRule.ts und      */
/* inputRules/textInputRule.ts), auf einen reinen Text + Cursor          */
/* übertragen:                                                          */
/*  - Fenster = Text vom ZEILENANFANG der Einfügestelle (Pendant zum    */
/*    Textblock im Editor) bis zum Cursor, davor höchstens 500 Zeichen  */
/*    (getTextContentFromNodes, maxMatch = 500). Trigger greifen nie     */
/*    über eine Zeilengrenze – v. a. wichtig für die multiply-Regel, deren*/
/*    \s* sonst über einen Umbruch hinweg "2⏎x3" verbinden würde.       */
/*  - Regeln in Array-Reihenfolge, die ERSTE passende gewinnt, genau      */
/*    EINE Regel pro Eingabe, keine Schleife (ein Ersatztext, der selbst */
/*    auf einen Trigger endet, wird nicht weiter ersetzt). Auch eine      */
/*    passende Regel, deren Ersatz dem Rohtext gleicht (Abschalt-Trick    */
/*    "-->" -> "-->"), beendet die Kette ohne Änderung.                   */
/*  - Ersetzt wird ab dem Trigger-Anfang bis zum Cursor; bei terminator/  */
/*    word/backslash bleibt das Abschlusszeichen stehen (match[1]-        */
/*    Mechanik von textInputRule). Text HINTER dem Cursor bleibt         */
/*    unberührt.                                                         */
/*  - Ein getipptes Enter ("\n") zählt wie im Editor als Abschlusszeichen */
/*    ("a --" + Enter -> "a –⏎"). Es gehört zum Fenster, der davor        */
/*    liegende Zeilenanfang bestimmt dessen Beginn.                       */
/* Abweichungen vom Editor (bewusst): kein Code-Kontext (ein Klartextfeld */
/* kennt keinen), Zeile statt Absatz, kein Feuern nach compositionend.    */
/* ------------------------------------------------------------------ */

// Wie getTextContentFromNodes(maxMatch = 500) im Editor: so viele Zeichen
// VOR der Einfügestelle gehören höchstens zum Fenster.
export const AUTOCORRECT_LOOKBACK = 500;

// Cross-Realm-fest (jsdom/iframes): `instanceof RegExp` scheitert an einem
// RegExp aus einem anderen Realm, exec() funktioniert dort trotzdem.
function isRegExp(v) {
  return Object.prototype.toString.call(v) === "[object RegExp]";
}

/**
 * Klassifiziert ein natives input-Event des Browsers: war es ECHTES Tippen,
 * und wenn ja, welcher Text wurde getippt? Positivliste, fail closed – alles
 * Unbekannte (Einfügen, Drop, Rechtschreib-/Bildschirmtastatur-Ersetzung,
 * Komposition, Löschen, Undo/Redo, ein Event ohne inputType wie
 * `new Event("input")`, Mehrzeichen-Einfügungen wie Diktat/Wortvorschlag)
 * liefert null, damit die AutoKorrektur nie auf Text wirkt, den der Nutzer
 * nicht Taste für Taste selbst getippt hat.
 *
 * @param {string} inputType - InputEvent.inputType
 * @param {string|null} data - InputEvent.data
 * @param {boolean} isComposing - InputEvent.isComposing
 * @returns {string|null} getippter Text ("\n" bei Enter) oder null
 */
export function typedTextFromInputEvent(inputType, data, isComposing) {
  if (isComposing === true) return null;
  if (inputType === "insertText") {
    // Genau EIN Codepoint: ein Surrogatpaar (Emoji-Tastatur) zählt als eins,
    // "->" als ein einziges Ereignis (Diktat/Automation) nicht.
    return typeof data === "string" && [...data].length === 1 ? data : null;
  }
  // Enter: data ist dort null, der getippte Text ist ein Zeilenumbruch.
  if (inputType === "insertLineBreak" || inputType === "insertParagraph") return "\n";
  return null;
}

/**
 * Wendet die Regeln auf das eben getippte Zeichen an (Zustand NACH der
 * Eingabe). Reine Funktion, siehe Kopfkommentar für die Semantik.
 *
 * @param {string} text - kompletter Feldinhalt nach dem Tastendruck
 * @param {number} caret - Cursor direkt hinter dem getippten Text
 * @param {string} typed - der getippte Text (Ergebnis von typedTextFromInputEvent)
 * @param {Array} rules - Ergebnis von buildActiveRules(config)
 * @returns {null|{from:number,to:number,insert:string,raw:string,text:string,caret:number}}
 *   from/to: ersetzter Bereich im Eingangstext (to === caret); insert: Ersatz
 *   inkl. Abschlusszeichen; raw: der ersetzte Rohtext (text.slice(from, to));
 *   text/caret: Zustand NACH der Ersetzung (caret in UTF-16-Einheiten, wie
 *   setSelectionRange sie erwartet – "❤️" hat Länge 2).
 */
export function autocorrectTypedText(text, caret, typed, rules) {
  if (typeof text !== "string" || typeof typed !== "string" || typed.length === 0) return null;
  if (!Array.isArray(rules) || rules.length === 0) return null;
  if (!Number.isInteger(caret) || caret < typed.length || caret > text.length) return null;
  const insStart = caret - typed.length;
  // Gegenprobe: steht der gemeldete Text wirklich direkt vor dem Cursor?
  // Sonst hat der Browser etwas anderes getan als das Event behauptet.
  if (text.slice(insStart, caret) !== typed) return null;

  // Zeilenanfang der EINFÜGESTELLE (nicht des Cursors): bei Enter liegt das
  // getippte "\n" selbst im Fenster, die Zeile davor bestimmt den Beginn.
  const lineStart = insStart <= 0 ? 0 : text.lastIndexOf("\n", insStart - 1) + 1;
  const winStart = Math.max(lineStart, insStart - AUTOCORRECT_LOOKBACK);
  const win = text.slice(winStart, caret);

  for (const rule of rules) {
    if (!rule || !isRegExp(rule.find)) continue;
    try {
      const re = rule.find;
      // Alle Regeln aus autocorrect.js haben flags "", ein Fremd-Regex mit
      // g/y würde sonst ab einem alten lastIndex suchen.
      if (re.global || re.sticky) re.lastIndex = 0;
      const m = re.exec(win);
      // Nur Treffer, die am Fensterende (= Cursor) enden – wie das
      // "$"-verankerte find der Editor-Regeln.
      if (!m || m.index + m[0].length !== win.length) continue;

      let from = winStart + m.index;
      let insert;
      if (rule.kind === "multiply") {
        // Wie DocEditor.jsx (AutoCorrect, kind "multiply"): nur das "x"
        // wird zu "×", Ziffern und Leerraum bleiben erhalten. Zweite Kopie
        // der Zusammensetzung – per Test (tests/autocorrectInput.test.js)
        // gegen die Editor-Erwartungswerte gepinnt, damit sie nicht driftet.
        if (m[1] === undefined || m[4] === undefined) continue;
        insert = m[1] + (m[2] ?? "") + "×" + (m[3] ?? "") + m[4];
      } else {
        if (typeof rule.replacement !== "string") continue;
        insert = rule.replacement;
        if (m[1]) {
          // match[1]-Mechanik von textInputRule.ts: ersetzt wird ab dem
          // Trigger, das Abschlusszeichen dahinter bleibt stehen.
          const offset = m[0].lastIndexOf(m[1]);
          insert += m[0].slice(offset + m[1].length);
          from += offset;
        }
      }
      if (from < winStart || from > caret) continue;
      const raw = text.slice(from, caret);
      // Ergibt die Ersetzung denselben Text (z. B. Custom-Regel "-->" -> "-->"
      // als dokumentierter Abschalt-Trick für einen einzelnen Trigger, siehe
      // autocorrect.js), ist das KEIN Treffer – aber die Kette endet hier:
      // wie im Editor (textInputRule erzeugt immer einen Step, run() setzt
      // matched) beendet die erste passende Regel die Suche auch dann, wenn
      // sie nichts ändert. Ein "continue" ließe sonst den kürzeren Suffix-
      // Trigger greifen ("-->" bliebe nicht roh, sondern würde zu "-→").
      if (insert === raw) return null;
      return {
        from,
        to: caret,
        insert,
        raw,
        text: text.slice(0, from) + insert + text.slice(caret),
        caret: from + insert.length,
      };
    } catch (err) {
      // Defekte Fremd-Regel (z. B. exec wirft): überspringen, nie werfen.
      continue;
    }
  }
  return null;
}

/**
 * Rücknahme der zuletzt angewandten Ersetzung (Vorbild undoInputRule im
 * Editor): stellt den ROH getippten Text samt Abschlusszeichen wieder her,
 * Cursor dahinter ("a→|" -> "a->|", "a – |" -> "a -- |"). Nur gültig, wenn
 * Text UND kollabierter Cursor exakt dem Zustand direkt nach der Ersetzung
 * entsprechen – jede Abweichung (weitergetippt, Cursor bewegt, fremder
 * Merge) macht die Rücknahme ungültig, der Aufrufer löscht dann normal.
 *
 * @param {object} record - Ergebnis von autocorrectTypedText (evtl. mit Zusatzfeldern)
 * @param {string} text - aktueller Feldinhalt
 * @param {number} selStart
 * @param {number} selEnd
 * @returns {null|{from:number,to:number,insert:string,text:string,caret:number}}
 *   from/to: zurückzunehmender Bereich im aktuellen Text (der Ersatz),
 *   insert: der Rohtext; text/caret: Zustand VOR der Ersetzung.
 */
export function revertAutocorrect(record, text, selStart, selEnd) {
  if (!record || typeof record !== "object") return null;
  const { from, insert, raw, text: recText, caret: recCaret } = record;
  if (typeof text !== "string" || typeof recText !== "string") return null;
  if (typeof insert !== "string" || typeof raw !== "string") return null;
  if (!Number.isInteger(from) || !Number.isInteger(recCaret)) return null;
  if (text !== recText || selStart !== recCaret || selEnd !== recCaret) return null;
  // Ein in sich unstimmiger Datensatz (Ersatz steht nicht dort, wo er
  // stehen müsste) darf nie zu einem Schreibvorgang führen.
  if (from < 0 || from > recCaret || recCaret > text.length) return null;
  if (text.slice(from, recCaret) !== insert) return null;
  return {
    from,
    to: recCaret,
    insert: raw,
    text: text.slice(0, from) + raw + text.slice(recCaret),
    caret: from + raw.length,
  };
}

/**
 * Ist [selStart, selEnd) genau die Spanne, die autocorrectTypedText beim
 * Tippen ihres letzten Codepoints ersetzen würde? Zustandslos – gebraucht
 * nach einem nativen Strg+Z: Chromium markiert dort den wiederhergestellten
 * Rohtext ("->" ist selektiert), das nächste getippte Zeichen würde ihn
 * überschreiben; erkennt man die Spanne als Trigger, kann der Aufrufer die
 * Markierung zu einem Cursor kollabieren.
 *
 * @returns {boolean}
 */
export function isAutocorrectTriggerRange(text, selStart, selEnd, rules) {
  if (typeof text !== "string") return false;
  if (!Number.isInteger(selStart) || !Number.isInteger(selEnd)) return false;
  if (selStart < 0 || selStart >= selEnd || selEnd > text.length) return false;
  const chars = [...text.slice(selStart, selEnd)];
  const last = chars[chars.length - 1];
  const edit = autocorrectTypedText(text, selEnd, last, rules);
  return edit !== null && edit.from === selStart && edit.to === selEnd;
}
