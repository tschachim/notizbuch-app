/* ------------------------------------------------------------------ */
/* Tab-Einrückung für einfache <textarea>-Editoren (Schnellnotiz)      */
/*                                                                     */
/* Reine Text-Funktion (kein DOM) – Semantik bewusst an VS Code        */
/* angelehnt, damit sich Tab/Umschalt+Tab in der Schnellnotiz so       */
/* verhält, wie Nutzer es aus Code-/Notiz-Editoren gewohnt sind:       */
/*  - leere Auswahl + Tab: unit an der Cursorposition einfügen.        */
/*  - Teilauswahl INNERHALB einer Zeile + Tab: Auswahl durch unit      */
/*    ersetzen (kollabiert).                                          */
/*  - Auswahl über mehrere Zeilen ODER genau eine ganze Zeile + Tab:   */
/*    JEDE berührte, NICHT-leere Zeile bekommt unit vorangestellt;     */
/*    die Auswahl deckt hinterher weiter alle betroffenen Zeilen ab,   */
/*    damit wiederholtes Tab weiter einrückt (klassisches VS-Code-     */
/*    Verhalten: der Cursor "bleibt" an einem Zeilenanfang stehen).    */
/*  - Umschalt+Tab: bei jeder berührten Zeile (leere Auswahl: die      */
/*    aktuelle Zeile) am Zeilenanfang EIN "\t" oder ansonsten bis zu   */
/*    4 führende Leerzeichen entfernen (so viele wie tatsächlich da    */
/*    sind) – unabhängig von "unit", das nur für das Einrücken gilt.  */
/* ------------------------------------------------------------------ */

// Anfang der Zeile, die "pos" enthält: die Position direkt nach dem
// letzten "\n" vor pos, oder 0 (erste Zeile). Bei "\r\n"-Text liegt diese
// Position NIE zwischen \r und \n – das \r ist stets Teil der VORHERIGEN
// Zeile, niemals der Zeilenanfang selbst.
function lineStartAt(text, pos) {
  // Guard für pos<=0 nötig: lastIndexOf mit negativem fromIndex würde bei
  // text[0]==="\n" fälschlich 1 statt 0 liefern (native Suche interpretiert
  // fromIndex<0 als "ab Anfang durchsuchen", nicht als "kein Treffer").
  return pos <= 0 ? 0 : text.lastIndexOf("\n", pos - 1) + 1;
}

// Ende des Zeileninhalts (Position des nächsten "\n" bzw. Textende) –
// bewusst OHNE das "\n" selbst, damit "Ende am Zeilenende" exakt geprüft
// werden kann. Bei "\r\n" gehört das "\r" zum Zeilenumbruch, NICHT zum
// Inhalt – der Index landet also VOR dem "\r", nicht auf dem "\n". Ohne
// diese Korrektur würde z. B. bei "abc\r\ndef" die komplett markierte
// erste Zeile (0..3, Inhalt "abc") fälschlich als Teilauswahl erkannt
// (le0 wäre 4 statt 3), weil das "\r" noch zum vermeintlichen Inhalt
// gezählt würde.
function lineEndAt(text, pos) {
  const idx = text.indexOf("\n", pos);
  if (idx === -1) return text.length;
  return idx > 0 && text[idx - 1] === "\r" ? idx - 1 : idx;
}

// Alle von [s, e) "berührten" Zeilenanfänge, in aufsteigender Reihenfolge.
// Regel (identisch für Ein-/Ausrücken über mehrere Zeilen): eine Zeile
// zählt, wenn ihr Anfang < e liegt. Endet die Auswahl exakt am Anfang
// einer Zeile (Zeichen davor ist "\n"), fällt diese letzte Zeile damit
// automatisch heraus – klassisches "ganze Zeile 1 markiert, Cursor am
// Anfang von Zeile 2" rückt NUR Zeile 1 ein.
function touchedLineStarts(text, s, e) {
  const starts = [];
  let ls = lineStartAt(text, s);
  while (ls < e) {
    starts.push(ls);
    const nl = text.indexOf("\n", ls);
    if (nl === -1) break;
    ls = nl + 1;
  }
  return starts;
}

// Zeile bei Zeilenanfang "ls" leer? Bei "\r\n"-Zeilenumbrüchen beginnt eine
// leere Zeile mit "\r", nicht mit "\n" – ohne den zweiten Vergleich würde
// z. B. bei "eins\r\n\r\nzwei" die leere Zwischenzeile fälschlich NICHT als
// leer erkannt und beim Einrücken (unerwünscht) mit unit befüllt.
// "ls >= text.length" ist über den einzigen Aufrufer (indentLines, mit
// Zeilenanfängen aus touchedLineStarts) NICHT erreichbar: dort gilt stets
// ls < e <= text.length. Reines Sicherheitsnetz für den Fall, dass diese
// Funktion künftig mit anderen Aufrufern (z. B. direkt mit text.length als
// ls) verwendet wird – bewusst NICHT entfernt.
function isEmptyLineAt(text, ls) {
  return ls >= text.length || text[ls] === "\n" || (text[ls] === "\r" && text[ls + 1] === "\n");
}

// Tab bei Mehrzeilen-/Ganze-Zeile-Auswahl: vor jede berührte, NICHT-leere
// Zeile "unit" setzen. Leere Zeilen (Zeilenanfang == Zeilenende) bleiben
// unverändert übersprungen, damit z. B. eine leere Trennzeile zwischen
// zwei Absätzen nicht plötzlich nur aus Whitespace besteht.
function indentLines(text, s, e, unit) {
  const starts = touchedLineStarts(text, s, e);
  const firstStart = starts[0];
  let result = "";
  let cursor = 0;
  let insertedTotal = 0;
  let firstLineInserted = false;
  for (const ls of starts) {
    result += text.slice(cursor, ls);
    cursor = ls;
    if (!isEmptyLineAt(text, ls)) {
      result += unit;
      insertedTotal += unit.length;
      if (ls === firstStart) firstLineInserted = true;
    }
  }
  result += text.slice(cursor);

  // selStart "bleibt" (bewusst NICHT verschoben), wenn er schon am
  // Zeilenanfang stand – dadurch deckt die Auswahl das frisch eingefügte
  // unit gleich mit ab, und wiederholtes Tab rückt weiter ein. Stand er
  // mitten in der ersten Zeile, wurde vor ihm eingefügt -> +unit.length.
  const newS = s + (s > firstStart && firstLineInserted ? unit.length : 0);
  // selEnd liegt immer hinter allen Einfügungen (jede betroffene
  // Zeile beginnt vor e) -> einfach um die Summe verschieben.
  const newE = e + insertedTotal;
  return { text: result, selStart: newS, selEnd: newE };
}

// Wie viele der "removed" am Zeilenanfang "ls" entfernten Zeichen lagen
// vor "pos"? Ergebnis wird von pos abgezogen – dadurch kann eine Position,
// die INNERHALB der entfernten Einrückung lag, nie vor den (unveränderten)
// Zeilenanfang rutschen ("nie vor den Zeilenanfang der jeweiligen Zeile").
function adjustForRemovals(pos, removals) {
  let shift = 0;
  for (const { ls, removed } of removals) {
    if (ls > pos) break;
    shift += Math.min(removed, Math.max(0, pos - ls));
  }
  return pos - shift;
}

// Umschalt+Tab: bei jeder berührten Zeile (leere Auswahl -> nur die
// aktuelle Zeile, siehe Kommentar am Aufrufer) am Zeilenanfang EIN "\t"
// entfernen, sonst bis zu 4 führende Leerzeichen (so viele wie vorhanden).
// Zeilen ohne Einzug bleiben unverändert.
function outdentLines(text, s, e) {
  const starts = s === e ? [lineStartAt(text, s)] : touchedLineStarts(text, s, e);
  let result = "";
  let cursor = 0;
  const removals = [];
  for (const ls of starts) {
    result += text.slice(cursor, ls);
    let removed = 0;
    if (text[ls] === "\t") {
      removed = 1;
    } else {
      while (removed < 4 && text[ls + removed] === " ") removed++;
    }
    cursor = ls + removed;
    removals.push({ ls, removed });
  }
  result += text.slice(cursor);
  return {
    text: result,
    selStart: adjustForRemovals(s, removals),
    selEnd: adjustForRemovals(e, removals),
  };
}

function toFinitePos(v) {
  // "nicht-numerische Positionen -> 0": alles außer echten, nicht-NaN
  // Zahlen (z. B. undefined, Strings, NaN) wird als 0 behandelt statt
  // eine Exception zu riskieren.
  return typeof v === "number" && !Number.isNaN(v) ? v : 0;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/**
 * Berechnet Text + Selektion nach einem Tab (einrücken) oder Umschalt+Tab
 * (ausrücken), VS-Code-artige Semantik. Reine Funktion ohne DOM-Zugriff.
 *
 * @param {string} text - kompletter Textarea-Inhalt.
 * @param {number} selStart - Auswahlanfang.
 * @param {number} selEnd - Auswahlende.
 * @param {{ outdent?: boolean, unit?: string }} [opts]
 * @returns {{ text: string, selStart: number, selEnd: number }}
 */
export function indentSelection(text, selStart, selEnd, opts = {}) {
  if (typeof text !== "string") {
    // Kaputte Eingabe: null/undefined kann ein <textarea>.value nie liefern,
    // wird hier defensiv als leerer Text behandelt. Andere Nicht-Strings
    // (z. B. versehentlich eine Zahl) werden UNVERÄNDERT durchgereicht,
    // statt zu crashen – ein Editor-Feld darf nie eine Exception werfen.
    // Bewusst OHNE Klemmen/Coercion von selStart/selEnd in diesem Zweig:
    // "unverändert" im Wortsinn, und ein <textarea>.value ist ohnehin immer
    // ein String – dieser Pfad ist nur ein Sicherheitsnetz für Fremdaufrufer,
    // kein regulärer Nutzungsfall, der eine konsistente Selektion bräuchte.
    if (text === null || text === undefined) return { text: "", selStart: 0, selEnd: 0 };
    return { text, selStart, selEnd };
  }

  const outdent = !!(opts && opts.outdent);
  const unit = opts && typeof opts.unit === "string" && opts.unit.length > 0 ? opts.unit : "\t";

  let s = clamp(toFinitePos(selStart), 0, text.length);
  let e = clamp(toFinitePos(selEnd), 0, text.length);
  if (s > e) { const tmp = s; s = e; e = tmp; }

  // Nie zwischen "\r" und "\n" landen: eine Position dort (z. B. Cursor per
  // Tastatur-Navigation oder Fremd-Aufrufer dort abgelegt) wird auf die
  // Position VOR dem "\r" zurückgezogen. Sonst würde ein Einfügen/Ersetzen
  // an genau dieser Stelle einen "\r\n"-Zeilenumbruch auseinanderreißen.
  if (s > 0 && text[s - 1] === "\r" && text[s] === "\n") s -= 1;
  if (e > 0 && text[e - 1] === "\r" && text[e] === "\n") e -= 1;

  if (outdent) return outdentLines(text, s, e);

  if (s === e) {
    // Tab an leerer Auswahl: unit einfügen, Cursor dahinter.
    const newText = text.slice(0, s) + unit + text.slice(s);
    const pos = s + unit.length;
    return { text: newText, selStart: pos, selEnd: pos };
  }

  const singleLine = !text.slice(s, e).includes("\n");
  const ls0 = lineStartAt(text, s);
  const le0 = lineEndAt(text, s);
  const wholeSingleLine = singleLine && s === ls0 && e === le0;

  if (singleLine && !wholeSingleLine) {
    // Teilauswahl innerhalb EINER Zeile, nicht die ganze Zeile: ersetzen.
    const newText = text.slice(0, s) + unit + text.slice(e);
    const pos = s + unit.length;
    return { text: newText, selStart: pos, selEnd: pos };
  }

  return indentLines(text, s, e, unit);
}

/**
 * Bereinigt einen Notizblock vor der Übernahme in den Chat-Prompt (siehe
 * App.jsx#submitQuickNote): entfernt NUR führende LEERZEILEN (Zeilen, die
 * ausschließlich aus Leerzeichen/Tabs bestehen, inkl. ihres Zeilenumbruchs,
 * "\r\n"-tolerant) sowie Whitespace am ENDE. Der Einzug der ERSTEN
 * inhaltstragenden Zeile (führende Tabs/Leerzeichen) bleibt bewusst
 * erhalten – anders als ein simples `text.trim()`, das diesen Einzug mit
 * auffrisst und damit inkonsistent zur Mehrzeilen-Tab-Einrückung wäre
 * (`indentSelection` oben rückt bei einer Mehrzeilen-Auswahl auch die
 * ERSTE Zeile ein, siehe DECISIONS #114).
 *
 * @param {string} text
 * @returns {string}
 */
export function trimNoteBlock(text) {
  if (typeof text !== "string") return ""; // kein <textarea>.value (z. B. undefined) -> leer statt crashen
  // 1. Durchgang: führende Leerzeilen samt ihres Zeilenumbruchs entfernen.
  // Jede Wiederholung verlangt einen ABSCHLIESSENDEN "\r?\n" – eine letzte,
  // NICHT durch einen Zeilenumbruch abgeschlossene Nur-Whitespace-"Zeile"
  // (der Text besteht insgesamt nur aus Leerzeichen/Tabs, kein Umbruch am
  // Ende) bleibt hier bewusst stehen und wird erst vom 2. Durchgang erfasst.
  // "[^\S\r\n]" statt "[ \t]" (Review-Fix 🟢 Finding 6): jedes Whitespace-
  // Zeichen AUSSER Zeilenumbrüchen, nicht nur Space/Tab – sonst überlebt
  // z. B. eine per Copy&Paste (Word/HTML) eingeschleppte führende NBSP-
  // Zeile ("\u00A0\n…") diesen Durchgang, obwohl \s (2. Durchgang) NBSP
  // durchaus als Whitespace behandelt und ein früheres simples text.trim()
  // sie ebenfalls entfernt hätte – Symmetrie zwischen beiden Durchgängen.
  const withoutLeadingBlankLines = text.replace(/^(?:[^\S\r\n]*\r?\n)*/, "");
  // 2. Durchgang: Whitespace jeder Art am Ende (inkl. der oben genannten
  // Restzeile aus nur Leerzeichen/Tabs ohne abschließenden Zeilenumbruch).
  return withoutLeadingBlankLines.replace(/\s+$/, "");
}
