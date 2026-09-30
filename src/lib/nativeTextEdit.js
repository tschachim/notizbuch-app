/* ------------------------------------------------------------------ */
/* Native Textänderung in einem <textarea>/<input> (execCommand)        */
/*                                                                     */
/* Winziger DOM-Helfer (Präzedenz für DOM-Code in lib: images.js mit    */
/* tests/images-dom.test.js). Warum überhaupt execCommand: ein          */
/* programmatischer value-Wechsel (von React geschrieben oder per       */
/* setRangeText) leert in Chrome/Firefox den nativen Undo-Verlauf des   */
/* Felds. document.execCommand("insertText") / ("undo") laufen dagegen  */
/* durch den Editiermechanismus des Browsers – Strg+Z nimmt genau diese */
/* Änderung zurück, alles davor bleibt einzeln rückgängig machbar (wie   */
/* in Word). MDN nennt genau das ("preserve the undo buffer") als        */
/* verbleibenden gültigen Anwendungsfall trotz "deprecated".            */
/*                                                                     */
/* Beide Funktionen sind fail-safe: liefern false, wenn der native Weg   */
/* nicht sicher zum erwarteten Ergebnis geführt hat (execCommand fehlt   */
/* wie in jsdom, liefert false, wirft, das Feld hat keinen Fokus, der   */
/* Wert weicht ab). Der Aufrufer nimmt dann einen anderen Weg (Zustands- */
/* weg über React). Sie kennen kein applyingRef o. Ä.: das von           */
/* execCommand synchron ausgelöste input-Event muss der Aufrufer selbst  */
/* als "eigen" erkennen.                                                 */
/* ------------------------------------------------------------------ */

// execCommand wirkt nur auf das fokussierte Feld (sonst greift es auf ein
// anderes Element bzw. nichts) – ohne Fokus oder ohne execCommand kein
// nativer Weg. ownerDocument statt globalem document: korrekt auch in
// fremden Dokumenten/iframes.
function usableDocument(el) {
  const doc = el && el.ownerDocument;
  if (!doc || typeof doc.execCommand !== "function") return null;
  if (doc.activeElement !== el) return null;
  return doc;
}

/**
 * Ersetzt [from, to) im Feld durch `insert` über execCommand("insertText").
 * Nur bei el.value === expectedText gilt der Versuch als gelungen; dann steht
 * der Cursor hinter dem Eingefügten (from + insert.length).
 *
 * @param {HTMLTextAreaElement|HTMLInputElement} el
 * @param {number} from
 * @param {number} to
 * @param {string} insert
 * @param {string} expectedText - erwarteter Feldinhalt nach der Änderung
 * @returns {boolean} true = gelungen; false = Aufrufer nimmt den Zustandsweg
 */
export function replaceRangeNative(el, from, to, insert, expectedText) {
  const doc = usableDocument(el);
  if (!doc) return false;
  if (!Number.isInteger(from) || !Number.isInteger(to) || typeof insert !== "string") return false;
  let before;
  let selStart;
  let selEnd;
  let selDir;
  try {
    before = el.value;
    selStart = el.selectionStart;
    selEnd = el.selectionEnd;
    selDir = el.selectionDirection;
    el.setSelectionRange(from, to);
    const ok = doc.execCommand("insertText", false, insert);
    if (ok && el.value === expectedText) {
      const caret = from + insert.length;
      el.setSelectionRange(caret, caret);
      return true;
    }
  } catch (err) {
    // fällt zum Aufräumen durch
  }
  // Fehlschlag: die vor dem Versuch gesetzte Auswahl [from, to) zurücknehmen,
  // solange der Wert unverändert ist (sonst hat der Browser etwas anderes
  // getan – dann entscheidet der Aufrufer, welchen Zustand er herstellt).
  try {
    if (el.value === before && selStart !== undefined) el.setSelectionRange(selStart, selEnd, selDir);
  } catch (err) {
    // Aufräumen ist best effort
  }
  return false;
}

/**
 * Nimmt die letzte native Änderung per execCommand("undo") zurück. Gelungen
 * nur bei el.value === expectedText. Die Auswahl fasst die Funktion NICHT an
 * (Chromium markiert nach dem Undo den wiederhergestellten Text – den
 * Kollaps zu einem Cursor macht der Aufrufer).
 *
 * @returns {boolean} true = el.value === expectedText
 */
export function undoNative(el, expectedText) {
  const doc = usableDocument(el);
  if (!doc) return false;
  try {
    const ok = doc.execCommand("undo");
    return !!ok && el.value === expectedText;
  } catch (err) {
    return false;
  }
}
