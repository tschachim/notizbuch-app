import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { X, Check, StickyNote } from "lucide-react";
import { indentSelection } from "../lib/textIndent.js";
import { buildActiveRules } from "../lib/autocorrect.js";
import {
  typedTextFromInputEvent,
  autocorrectTypedText,
  revertAutocorrect,
  isAutocorrectTriggerRange,
} from "../lib/autocorrectInput.js";
import { replaceRangeNative, undoNative } from "../lib/nativeTextEdit.js";

/* Schnellnotizen: frei schwebende Post-its über der App.
   Verschieben am Kopfbalken, Größe ändern an der Ecke rechts unten,
   OK übernimmt den Inhalt in den Chat-Prompt und löscht die Notiz.
   Persistenz (localStorage, pro Gerät) übernimmt der Aufrufer.

   AutoKorrektur (v7.58): dieselbe Regelbibliothek und dieselbe Konfiguration
   wie im Dokument-Editor (lib/autocorrect.js#buildActiveRules, Prop
   "autocorrect"), das Matching liegt in lib/autocorrectInput.js. Nur ECHTES
   Tippen löst aus (Positivliste über inputType, siehe handleChange) – Einfügen,
   Drop, Komposition, Undo/Redo und programmatische Änderungen (Remote-Merge,
   Tab-Einzug) bleiben roh. Abweichungen vom Editor: Zeile statt Absatz als
   Fenster, kein Code-Kontext (Klartextfeld – "--force" wird "–force", Ausweg
   ist die Rücknahme unten oder das Abschalten der Kategorie) und kein Feuern
   nach einer IME-Komposition (compositionend).
   Anwenden, NATIVER Hauptpfad: setSelectionRange + document.execCommand
   ("insertText") – dadurch bleibt der native Undo-Verlauf erhalten, Strg+Z
   nimmt genau die Ersetzung zurück (wie in Word). Ein getipptes Enter als
   Abschlusszeichen gehört NICHT in den nativen Befehl (Chromiums Redo
   verlöre sonst Umbruch bzw. Symbol, siehe handleChange). FALLBACK (execCommand
   fehlt wie in jsdom, liefert false, Feld ohne Fokus, Wert weicht ab):
   Zustandsweg über onChange + pendingSelection – der programmatische value-
   Wechsel leert dort den nativen Undo-Stack, deshalb fängt der Fallback
   Strg+Z selbst ab.
   Rücknahme (Vorbild undoInputRule): direkt nach einer Ersetzung stellt
   Backspace den Rohtext samt Abschlusszeichen wieder her ("a→|" -> "a->|"),
   ein zweites Backspace löscht normal. Ein Merker pro Post-it (useRef, nichts
   davon in state.json), Verfall siehe recordRef. */

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

// Navigationstasten bewegen den Cursor: die Rücknahme verfällt (im Editor
// verfällt sie bei jeder Selektionsänderung). Bewusst NUR echte Navigation –
// Android-Bildschirmtastaturen melden Backspace oft als key "Unidentified",
// ein Verfall bei jedem fremden keydown würde dort den Ausweg zerstören.
const NAV_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

function QuickNote({ note, rules, onChange, onRemove, onOk }) {
  const gesture = useRef(null);
  const textareaRef = useRef(null);
  // Merkt eine Ziel-Selektion nach Tab/Umschalt+Tab (und nach einer
  // Fallback-Ersetzung bzw. -Rücknahme der AutoKorrektur), bis der neue Text
  // (note.text) im DOM angekommen ist: das <textarea> ist controlled
  // (value={note.text}) – ein setSelectionRange() DIREKT im
  // onKeyDown-Handler würde noch auf dem ALTEN DOM-Wert stehen und vom
  // Browser auf dessen Länge geklemmt. Der useLayoutEffect unten läuft
  // NACH dem Re-Render mit dem neuen Wert und kann die Selektion dann
  // korrekt setzen (vor dem nächsten Zeichnen, kein Flackern).
  const pendingSelection = useRef(null);
  // true, solange WIR selbst execCommand ausführen: das dabei synchron
  // ausgelöste, verschachtelte input-Event landet wieder in handleChange und
  // wird dort nur weitergereicht (kein Matching, kein Verfall des Merkers).
  const applyingRef = useRef(false);
  // Merker der zuletzt angewandten Ersetzung {from, to, insert, raw, text,
  // caret, native} – Grundlage der Rücknahme. Verfällt bei: jedem input-
  // Event, das nicht aus dem eigenen execCommand stammt; keydown, wenn
  // Text/Cursor nicht mehr exakt passen; Navigationstasten; Tab; blur;
  // pointerdown; von außen geändertem note.text (Layout-Effect); nach der
  // Rücknahme. Ein keydown mit key "Unidentified" allein lässt ihn bestehen.
  const recordRef = useRef(null);
  // Der native beforeinput-Listener (useEffect unten) läuft nur einmal
  // registriert – über dieses Ref ruft er immer die Closure des letzten
  // Renders auf (keine veralteten Props).
  const tryRevertRef = useRef(null);

  // Führt fn aus und markiert währenddessen "eigenes execCommand" (siehe
  // applyingRef); try/finally, damit ein Wurf das Flag nie hängen lässt.
  const withApplying = (fn) => {
    applyingRef.current = true;
    try { return fn(); } finally { applyingRef.current = false; }
  };

  // Rücknahme der letzten Ersetzung, gemeinsame Funktion für keydown
  // (Backspace, Strg/Cmd+Z im Fallback) und den nativen beforeinput-Listener
  // (Netz für Android-Bildschirmtastaturen). true = zurückgenommen, der
  // Aufrufer verhindert dann die Standardaktion. Der Merker ist danach in
  // JEDEM Fall verbraucht.
  const tryRevert = (el) => {
    const rec = recordRef.current;
    recordRef.current = null;
    if (!rec) return false;
    const rev = revertAutocorrect(rec, el.value, el.selectionStart, el.selectionEnd);
    if (!rev) return false;
    if (rec.native) {
      // Nativ: execCommand("undo") nimmt die Ersetzung zurück und lässt den
      // Redo-Verlauf (Strg+Y) intakt. Chromium markiert danach den Rohtext –
      // auf einen Cursor dahinter kollabieren, sonst überschriebe das nächste
      // Zeichen ihn.
      const ok = withApplying(() => undoNative(el, rev.text));
      if (ok) {
        el.setSelectionRange(rev.caret, rev.caret);
        onChange(note.id, { text: el.value });
        return true;
      }
    }
    // Fallback (und unerwartetes Ergebnis des nativen Undo): Zustandsweg –
    // rev.text ist der aus dem Merker berechnete, immer richtige Vorzustand.
    pendingSelection.current = { start: rev.caret, end: rev.caret, text: rev.text, direction: "none" };
    onChange(note.id, { text: rev.text });
    return true;
  };

  // BEWUSST ohne deps-Array (läuft nach JEDEM Render, kehrt ohne
  // pendingSelection sofort zurück): mit [note.text] lief der Effect nicht,
  // wenn der Ergebnistext einer AutoKorrektur-Ersetzung dem vorherigen
  // Prop-Wert gleicht (z. B. markiertes „ durch " überschrieben -> Regel
  // macht wieder „). React schreibt das DOM trotzdem auf den Prop-Wert
  // zurück, der Cursor spränge ans Textende und pendingSelection bliebe
  // liegen. Bei Tab konnte das nie auftreten (Abbruch bei unverändertem Text).
  useLayoutEffect(() => {
    tryRevertRef.current = tryRevert;
    // Von außen geänderter Text (Remote-Merge, Tab-Einzug …): der Merker
    // gehört zu einem Zustand, den es nicht mehr gibt.
    if (recordRef.current && recordRef.current.text !== note.text) recordRef.current = null;
    const sel = pendingSelection.current;
    if (!sel) return;
    pendingSelection.current = null;
    // Zieltext mitprüfen: übernimmt ein Aufrufer den von onChange gemeldeten
    // Text NICHT 1:1 (z. B. ein zwischenzeitlicher Remote-Merge überschreibt
    // note.text, bevor der Effect läuft), passt die gemerkte Selektion nicht
    // mehr zum tatsächlichen Inhalt – dann lieber gar nichts setzen als eine
    // falsche Cursor-Position.
    if (sel.text !== note.text) return;
    const el = textareaRef.current;
    // Dritter Parameter (Richtung) bewusst mitgeben: ohne ihn setzt
    // setSelectionRange() die Richtung auf "none" (Chrome/Firefox: Fokus
    // dann am Ende) – eine rückwärts aufgezogene Auswahl (Umschalt+Pfeil-
    // hoch, Anker unten) würde nach einem Tab ihre Richtung verlieren und
    // beim nächsten Umschalt+Pfeil-hoch am falschen Ende weiterwachsen.
    if (el) el.setSelectionRange(sel.start, sel.end, sel.direction);
  });

  // Native Rücknahme-Auslöser für Bildschirmtastaturen: Reacts onBeforeInput
  // ist nur ein Polyfill (keypress/textInput) und liefert keine Lösch-Events,
  // deshalb ein echter Listener. Android-Gboard meldet Backspace im keydown
  // oft als "Unidentified" – beforeinput/deleteContentBackward kommt dort
  // trotzdem. Bei Erfolg wird das Löschen verhindert (preventDefault).
  // Nicht abbrechbare Events (!cancelable) lassen wir unberührt: preventDefault
  // bliebe wirkungslos, der Browser löschte trotzdem – mit der Rücknahme liefe
  // also Rücknahme UND Browser-Löschung (ein Zeichen zu viel weg). Der Merker
  // wird dafür gar nicht erst angefasst (tryRevert verbraucht ihn), er bleibt
  // für ein späteres abbrechbares Ereignis bestehen.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return undefined;
    const onBeforeInput = (ev) => {
      if (ev.inputType !== "deleteContentBackward" || ev.isComposing || !ev.cancelable) return;
      const revert = tryRevertRef.current;
      if (revert && revert(el)) ev.preventDefault();
    };
    el.addEventListener("beforeinput", onBeforeInput);
    return () => el.removeEventListener("beforeinput", onBeforeInput);
  }, []);

  // onChange des controlled <textarea>. Ablauf:
  //  1. Verschachteltes Event aus dem eigenen execCommand: NUR weiterreichen.
  //     JEDES input-Event muss beim Aufrufer ankommen – sonst setzt React das
  //     DOM auf den alten Prop-Wert zurück und die Änderung wäre weg.
  //  2. Jedes andere Event verbraucht den Merker der Rücknahme.
  //  3. Natives Strg+Z (historyUndo): Chromium markiert den zurückgeholten
  //     Rohtext ("->" selektiert) – ist die Markierung genau eine Trigger-
  //     Spanne, zum Cursor kollabieren (zustandslos, hält auch Wochen später).
  //     Bei Enter als Abschlusszeichen steht der Umbruch hinter der Markierung
  //     (er war nicht Teil des nativen Befehls) – dann hinter ihn kollabieren.
  //  4. Echtes Tippen? Positivliste in typedTextFromInputEvent; zusätzlich
  //     kollabierte Auswahl (die Prüfung "getippter Text steht vor dem
  //     Cursor" macht autocorrectTypedText). KEIN Diff alt/neu: ein Diff
  //     könnte ein Ein-Zeichen-Paste/Undo nicht vom Tippen unterscheiden.
  //  5. Treffer: nativ anwenden; der rohe Zwischenstand ("a->") erreicht den
  //     App-State nie (vor dem Anwenden wird nichts gemeldet). Sonst
  //     Zustandsweg mit dem aus dem Zustand NACH dem Tastendruck berechneten,
  //     immer richtigen Zieltext.
  const handleChange = (e) => {
    const el = e.target;
    if (applyingRef.current) {
      onChange(note.id, { text: el.value });
      return;
    }
    const ne = e.nativeEvent || {};
    recordRef.current = null;
    if (ne.inputType === "historyUndo" && el.selectionStart !== el.selectionEnd) {
      const v = el.value;
      const s = el.selectionStart;
      const en = el.selectionEnd;
      if (isAutocorrectTriggerRange(v, s, en, rules)) {
        el.setSelectionRange(en, en);
      } else if (v[en] === "\n" && isAutocorrectTriggerRange(v, s, en + 1, rules)) {
        // Enter als Abschlusszeichen: der native Befehl umfasste den Umbruch
        // nicht (siehe unten), Chromium markiert nach dem Undo nur "--" – der
        // Umbruch steht dahinter, der Cursor gehört hinter ihn.
        el.setSelectionRange(en + 1, en + 1);
      }
    }
    const typed = typedTextFromInputEvent(ne.inputType, ne.data, ne.isComposing);
    const caret = el.selectionStart;
    const edit = typed !== null && caret === el.selectionEnd
      ? autocorrectTypedText(el.value, caret, typed, rules)
      : null;
    if (!edit) {
      onChange(note.id, { text: el.value });
      return;
    }
    // Ein GETIPPTES Enter (Abschlusszeichen "\n", der Ersatz behält es) bleibt
    // aus dem nativen Befehl HERAUS: Chromiums Redo wiederholt einen
    // insertText-Befehl mit eingebettetem Umbruch falsch (gemessen in Chromium
    // 154: "a --"+Enter -> Strg+Z -> Strg+Y liefert "a –" statt "a –⏎", bei
    // "\alpha"+Enter geht das Symbol verloren). Ohne den Umbruch im Befehl
    // stimmen Undo, Redo und Backspace-Rücknahme; der Umbruch selbst steht
    // schon im Feld (der Browser hat ihn beim Tippen eingefügt) und bleibt
    // unangetastet. Enthält der Ersatz selbst einen inneren Umbruch (nur über
    // eine Custom-Regel möglich), nie nativ: ein mehrzeiliger insertText ist
    // dasselbe Redo-Risiko, der Zustandsweg ist dort immer richtig.
    const nl = edit.raw.endsWith("\n") && edit.insert.endsWith("\n") ? 1 : 0;
    const nativeInsert = nl ? edit.insert.slice(0, -1) : edit.insert;
    if (
      !nativeInsert.includes("\n") &&
      withApplying(() => replaceRangeNative(el, edit.from, edit.to - nl, nativeInsert, edit.text))
    ) {
      // replaceRangeNative stellt den Cursor hinter den Ersatz, der Umbruch
      // steht noch dahinter – der Cursor gehört hinter ihn (= edit.caret).
      if (nl) el.setSelectionRange(edit.caret, edit.caret);
      recordRef.current = { ...edit, native: true };
      onChange(note.id, { text: el.value });
      return;
    }
    recordRef.current = { ...edit, native: false };
    pendingSelection.current = { start: edit.caret, end: edit.caret, text: edit.text, direction: "none" };
    onChange(note.id, { text: edit.text });
  };

  // Tab rückt ein, Umschalt+Tab rückt aus (indentSelection, siehe
  // src/lib/textIndent.js) – dadurch verlässt Tab das Post-it nicht mehr
  // per Tastatur (Fokusfalle). Escape ist der Ausweg (siehe unten, WCAG
  // 2.1.2 "No Keyboard Trap"): Maus/Touch bleiben ohnehin unberührt (Klick
  // raus funktioniert weiterhin). Ebenfalls hingenommen: der programmatische
  // value-Wechsel des controlled <textarea> leert in Chrome/Firefox dessen
  // nativen Undo-Stack (Strg+Z wirkt nach einem Tab nicht mehr auf vorher
  // Getipptes) – für ein Post-it vertretbar. Das gilt weiterhin für Tab (und
  // für den Zustandsweg der AutoKorrektur), NICHT für deren nativen Pfad
  // (execCommand, siehe Kopfkommentar).
  const handleKeyDown = (e) => {
    const el = e.currentTarget;
    // e.isComposing existiert auf Reacts SyntheticKeyboardEvent NICHT (wird
    // nicht aus dem nativen Event kopiert) – deshalb hier über nativeEvent
    // geprüft. Relevant v. a. bei IME-Komposition (z. B. Firefox): dort
    // bleibt "key" während der Komposition der reale Tastenname, Tab soll
    // die Komposition aber nicht unterbrechen.
    const composing = !!(e.nativeEvent && e.nativeEvent.isComposing);
    // Merker gegen den echten Zustand prüfen: passen Text oder Cursor nicht
    // mehr exakt (Cursor per Maus/Touch bewegt, Remote-Merge …), verfällt er.
    const rec = recordRef.current;
    if (rec && (el.value !== rec.text || el.selectionStart !== rec.caret || el.selectionEnd !== rec.caret)) {
      recordRef.current = null;
    }
    // Escape verlässt das Feld per Tastatur (blur), DANACH greift die
    // normale Tab-Reihenfolge wieder – muss VOR der Tab-Prüfung stehen,
    // sonst gäbe es keinen Tastatur-Ausweg aus der Fokusfalle oben.
    if (e.key === "Escape") { el.blur(); return; }
    // Backspace direkt nach einer Ersetzung nimmt sie zurück. Mit Umschalt/
    // Strg/Meta ebenfalls (wie im Editor), nur Alt nicht.
    if (e.key === "Backspace") {
      if (!e.altKey && !composing && tryRevert(el)) e.preventDefault();
      return;
    }
    // Strg/Cmd+Z: auf dem NATIVEN Pfad nie abfangen (der Browser nimmt genau
    // die Ersetzung zurück). Nur im Fallback (Undo-Stack ist dort leer,
    // Strg+Z wäre sonst wirkungslos) und nur bei gültigem Merker.
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && !composing && (e.key === "z" || e.key === "Z")) {
      const r = recordRef.current;
      if (r && !r.native && tryRevert(el)) e.preventDefault();
      return;
    }
    if (NAV_KEYS.has(e.key)) { recordRef.current = null; return; }
    if (e.key !== "Tab" || e.ctrlKey || e.altKey || e.metaKey || composing) return;
    e.preventDefault();
    // Tab kann den Text auf einen früheren Zustand zurückführen (Tab dann
    // Umschalt+Tab) – der Merker darf dann nicht wieder "gültig" werden.
    recordRef.current = null;
    const result = indentSelection(el.value, el.selectionStart, el.selectionEnd, { outdent: e.shiftKey });
    if (result.text === el.value) return; // z. B. Umschalt+Tab ohne Einzug: nichts zu tun
    // selectionDirection VOR dem Ersetzen sichern (siehe useLayoutEffect
    // oben) – nach onChange steht das DOM noch auf dem alten Wert, die
    // Richtung ist also hier noch die vom Nutzer gewählte.
    pendingSelection.current = { start: result.selStart, end: result.selEnd, text: result.text, direction: el.selectionDirection };
    onChange(note.id, { text: result.text });
  };

  // Position beim Rendern in den Viewport zwingen (z. B. anderes Fenster-/
  // Gerätemaß). Auch Basis für Gesten, damit ein Drag nicht von einer
  // unsichtbaren, ungeklemmten Alt-Position ausgeht.
  const x = clamp(note.x, 4, Math.max(4, window.innerWidth - 80));
  const y = clamp(note.y, 4, Math.max(4, window.innerHeight - 40));

  const startGesture = (e, mode) => {
    // Klicks auf Knöpfe im Kopfbalken (X) nicht als Drag-Start abfangen –
    // preventDefault + Pointer-Capture würden den Klick sonst verschlucken.
    if (e.target.closest("button")) return;
    e.preventDefault();
    const el = e.currentTarget;
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* ohne Capture weiter */ }
    gesture.current = {
      mode,
      px: e.clientX,
      py: e.clientY,
      x, y, w: note.w, h: note.h,
    };
  };

  const moveGesture = (e) => {
    const g = gesture.current;
    if (!g) return;
    if (e.buttons === 0) { gesture.current = null; return; } // Taste außerhalb losgelassen
    const dx = e.clientX - g.px;
    const dy = e.clientY - g.py;
    if (g.mode === "move") {
      onChange(note.id, {
        x: clamp(g.x + dx, 4, Math.max(4, window.innerWidth - 80)),
        y: clamp(g.y + dy, 4, Math.max(4, window.innerHeight - 40)),
      });
    } else {
      onChange(note.id, {
        w: clamp(g.w + dx, 170, 700),
        h: clamp(g.h + dy, 120, 700),
      });
    }
  };

  const endGesture = () => { gesture.current = null; };

  return (
    <div
      className="fixed z-40 flex flex-col rounded-lg border border-amber-300 bg-amber-50 shadow-xl"
      style={{ left: x, top: y, width: note.w, height: note.h }}
    >
      {/* Kopfbalken = Verschiebe-Griff */}
      <div
        onPointerDown={(e) => startGesture(e, "move")}
        onPointerMove={moveGesture}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        className="flex items-center gap-1.5 h-7 px-2 rounded-t-lg bg-amber-200/70 cursor-move select-none touch-none"
      >
        <StickyNote size={12} className="text-amber-700 shrink-0" />
        <span className="text-xs text-amber-800 font-medium">Schnellnotiz</span>
        <div className="flex-1" />
        <button
          onClick={() => onRemove(note.id)}
          className="p-0.5 rounded text-amber-700 hover:bg-amber-300/70"
          title="Verwerfen (ohne Übernahme löschen)"
        >
          <X size={12} />
        </button>
      </div>

      <textarea
        ref={textareaRef}
        value={note.text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => { recordRef.current = null; }}
        onPointerDown={() => { recordRef.current = null; }}
        placeholder="Kurz notieren …"
        style={{ tabSize: 4 }}
        className="flex-1 min-h-0 w-full resize-none bg-transparent px-2 py-1.5 text-sm text-slate-800 placeholder:text-amber-700/50 focus:outline-none"
      />

      {/* OK-Knopf klein rechts unten; daneben die Resize-Ecke */}
      <div className="flex items-center justify-end gap-1 px-1.5 pb-1">
        <button
          onClick={() => onOk(note.id)}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-300/80 hover:bg-amber-400 text-amber-900 text-[11px] font-medium"
          title="Inhalt als „Neue Schnellnotiz“ in den Chat-Prompt übernehmen und Notiz löschen"
        >
          <Check size={11} />
          OK
        </button>
        <div
          onPointerDown={(e) => startGesture(e, "size")}
          onPointerMove={moveGesture}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
          className="w-3.5 h-3.5 cursor-nwse-resize touch-none"
          title="Größe ändern"
          style={{
            backgroundImage:
              "linear-gradient(135deg, transparent 50%, rgba(180,120,20,0.45) 50%)",
            borderBottomRightRadius: "0.4rem",
          }}
        />
      </div>
    </div>
  );
}

export default function QuickNotes({ notes, autocorrect, onChange, onRemove, onSubmit }) {
  // Hook ZWINGEND vor dem frühen return: sonst wechselt die Hook-Anzahl
  // zwischen 0 und 1 Post-it und React wirft. Ohne Prop gelten die Defaults
  // (buildActiveRules sanitisiert defensiv); Einstellungs-Änderungen ändern
  // die Identität des Objekts und wirken dadurch sofort (anders als im
  // Editor, der die Regeln nur beim Öffnen baut).
  const rules = useMemo(() => buildActiveRules(autocorrect), [autocorrect]);
  if (!notes.length) return null;
  return (
    <>
      {notes.map((n) => (
        <QuickNote
          key={n.id}
          note={n}
          rules={rules}
          onChange={onChange}
          onRemove={onRemove}
          onOk={onSubmit}
        />
      ))}
    </>
  );
}
