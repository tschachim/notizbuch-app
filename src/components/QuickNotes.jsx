import { useRef } from "react";
import { X, Check, StickyNote } from "lucide-react";

/* Schnellnotizen: frei schwebende Post-its über der App.
   Verschieben am Kopfbalken, Größe ändern an der Ecke rechts unten,
   OK übernimmt den Inhalt in den Chat-Prompt und löscht die Notiz.
   Persistenz (localStorage, pro Gerät) übernimmt der Aufrufer. */

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function QuickNote({ note, onChange, onRemove, onOk }) {
  const gesture = useRef(null);

  // Position beim Rendern in den Viewport zwingen (z. B. anderes Fenster-/
  // Gerätemaß). Auch Basis für Gesten, damit ein Drag nicht von einer
  // unsichtbaren, ungeklemmten Alt-Position ausgeht.
  const x = clamp(note.x, 4, Math.max(4, window.innerWidth - 80));
  const y = clamp(note.y, 4, Math.max(4, window.innerHeight - 40));

  const startGesture = (e, mode) => {
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
        value={note.text}
        onChange={(e) => onChange(note.id, { text: e.target.value })}
        placeholder="Kurz notieren …"
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
