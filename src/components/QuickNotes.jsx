import { useLayoutEffect, useRef } from "react";
import { X, Check, StickyNote } from "lucide-react";
import { indentSelection } from "../lib/textIndent.js";

/* Schnellnotizen: frei schwebende Post-its über der App.
   Verschieben am Kopfbalken, Größe ändern an der Ecke rechts unten,
   OK übernimmt den Inhalt in den Chat-Prompt und löscht die Notiz.
   Persistenz (localStorage, pro Gerät) übernimmt der Aufrufer. */

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function QuickNote({ note, onChange, onRemove, onOk }) {
  const gesture = useRef(null);
  const textareaRef = useRef(null);
  // Merkt eine Ziel-Selektion nach Tab/Umschalt+Tab, bis der neue Text
  // (note.text) im DOM angekommen ist: das <textarea> ist controlled
  // (value={note.text}) – ein setSelectionRange() DIREKT im
  // onKeyDown-Handler würde noch auf dem ALTEN DOM-Wert stehen und vom
  // Browser auf dessen Länge geklemmt. Der useLayoutEffect unten läuft
  // NACH dem Re-Render mit dem neuen Wert und kann die Selektion dann
  // korrekt setzen (vor dem nächsten Zeichnen, kein Flackern).
  const pendingSelection = useRef(null);

  useLayoutEffect(() => {
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
  }, [note.text]);

  // Tab rückt ein, Umschalt+Tab rückt aus (indentSelection, siehe
  // src/lib/textIndent.js) – dadurch verlässt Tab das Post-it nicht mehr
  // per Tastatur (Fokusfalle). Escape ist der Ausweg (siehe unten, WCAG
  // 2.1.2 "No Keyboard Trap"): Maus/Touch bleiben ohnehin unberührt (Klick
  // raus funktioniert weiterhin). Ebenfalls hingenommen: der programmatische
  // value-Wechsel des controlled <textarea> leert in Chrome/Firefox dessen
  // nativen Undo-Stack (Strg+Z wirkt nach einem Tab nicht mehr auf vorher
  // Getipptes) – für ein Post-it vertretbar.
  const handleKeyDown = (e) => {
    // Escape verlässt das Feld per Tastatur (blur), DANACH greift die
    // normale Tab-Reihenfolge wieder – muss VOR der Tab-Prüfung stehen,
    // sonst gäbe es keinen Tastatur-Ausweg aus der Fokusfalle oben.
    if (e.key === "Escape") { e.currentTarget.blur(); return; }
    // e.isComposing existiert auf Reacts SyntheticKeyboardEvent NICHT (wird
    // nicht aus dem nativen Event kopiert) – deshalb hier über nativeEvent
    // geprüft. Relevant v. a. bei IME-Komposition (z. B. Firefox): dort
    // bleibt "key" während der Komposition der reale Tastenname, Tab soll
    // die Komposition aber nicht unterbrechen.
    if (e.key !== "Tab" || e.ctrlKey || e.altKey || e.metaKey || (e.nativeEvent && e.nativeEvent.isComposing)) return;
    e.preventDefault();
    const el = e.currentTarget;
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
        onChange={(e) => onChange(note.id, { text: e.target.value })}
        onKeyDown={handleKeyDown}
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

export default function QuickNotes({ notes, onChange, onRemove, onSubmit }) {
  if (!notes.length) return null;
  return (
    <>
      {notes.map((n) => (
        <QuickNote
          key={n.id}
          note={n}
          onChange={onChange}
          onRemove={onRemove}
          onOk={onSubmit}
        />
      ))}
    </>
  );
}
