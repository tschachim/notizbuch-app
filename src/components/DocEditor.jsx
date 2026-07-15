import { useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { getHTMLFromFragment } from "@tiptap/core";
import { Fragment } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import TextStyle from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { Markdown } from "tiptap-markdown";
import {
  Bold, Italic, Code, List, ListOrdered, ListChecks, Heading2, Heading3,
  Minus, Undo2, Redo2, Strikethrough, Palette, Highlighter, Table as TableIcon,
} from "lucide-react";

/* WYSIWYG-Editor für die manuelle Bearbeitung der Wissensbasis.
   TipTap mit Markdown-Round-Trip, beschränkt auf den Dialekt, den der
   Renderer der App versteht: # / ## / ###, "- "-Listen, nummerierte
   Listen, Checklisten (- [ ]), fett/kursiv/Code/durchgestrichen,
   Schriftfarbe und Textmarker (als Inline-HTML), ---, Bilder.
   Codeblöcke und Zitate bleiben deaktiviert. */

const TEXT_COLORS = [
  { label: "Standard", value: null, swatch: "#334155" },
  { label: "Rot", value: "#dc2626", swatch: "#dc2626" },
  { label: "Orange", value: "#ea580c", swatch: "#ea580c" },
  { label: "Grün", value: "#16a34a", swatch: "#16a34a" },
  { label: "Blau", value: "#2563eb", swatch: "#2563eb" },
  { label: "Violett", value: "#7c3aed", swatch: "#7c3aed" },
  { label: "Grau", value: "#64748b", swatch: "#64748b" },
];

const HIGHLIGHT_COLORS = [
  { label: "Keine", value: null, swatch: "#ffffff" },
  { label: "Gelb", value: "#fde047", swatch: "#fde047" },
  { label: "Rot", value: "#fca5a5", swatch: "#fca5a5" },
  { label: "Grün", value: "#86efac", swatch: "#86efac" },
  { label: "Blau", value: "#93c5fd", swatch: "#93c5fd" },
  { label: "Orange", value: "#fdba74", swatch: "#fdba74" },
];

// Bildreferenzen img:<id> für die Anzeige im Editor auf data-URLs auflösen …
const resolveImgs = (md, imgMap) =>
  md.replace(/\]\(img:([a-zA-Z0-9]+)\)/g, (m, id) =>
    imgMap[id] ? "](" + imgMap[id] + ")" : m);

// … und beim Speichern wieder zurückübersetzen (Base64 enthält keine Klammern).
function unresolveImgs(md, imgMap) {
  let out = md;
  for (const [id, url] of Object.entries(imgMap)) {
    out = out.split("](" + url + ")").join("](img:" + id + ")");
  }
  return out;
}

// Der zeilenbasierte Renderer der App interpretiert keine Backslash-Escapes –
// die vom Markdown-Serializer erzeugten daher entfernen.
const unescapeMd = (md) => md.replace(/\\([\\`*_{}[\]()#+\-.!>~=])/g, "$1");

// tiptap-markdown serialisiert Bilder mit dem Inline-Serializer von
// prosemirror-markdown – ohne closeBlock klebt die Folgezeile direkt an der
// Bildzeile und die App-Konvention „![…](img:…) allein auf einer Zeile“
// (IMG_LINE_RE) bricht. Eigener Block-Serializer behebt das; allowBase64 ist
// Pflicht, weil die Parse-Regel sonst keine data:-URLs übernimmt und die von
// resolveImgs aufgelösten Bilder beim Öffnen aus dem Inhalt fielen.
// Größenänderung per Maus: Die Breite wird als "|w<px>"-Suffix im Alt-Text
// persistiert (![Titel|w320](img:…)) – Markdown hat kein width-Attribut,
// und nur der Alt-Text übersteht Roundtrip UND den zeilenbasierten Renderer.
const BlockImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      alt: {
        default: null,
        parseHTML: (el) => (el.getAttribute("alt") || "").replace(/\|w\d+$/, "") || null,
      },
      width: {
        default: null,
        parseHTML: (el) => {
          const m = /\|w(\d+)$/.exec(el.getAttribute("alt") || "");
          if (m) return parseInt(m[1], 10);
          const w = el.getAttribute("width");
          return w ? parseInt(w, 10) : null;
        },
        renderHTML: (attrs) => (attrs.width ? { width: attrs.width } : {}),
      },
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          const suffix = node.attrs.width ? "|w" + node.attrs.width : "";
          state.write("![" + state.esc(node.attrs.alt || "") + suffix + "](" + node.attrs.src + ")");
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
  // Eigene NodeView mit Anfasser unten rechts (wie in gängigen Editoren).
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let cur = node;
      const wrap = document.createElement("span");
      wrap.className = "img-resize-wrap";
      const img = document.createElement("img");
      const apply = () => {
        if (img.src !== cur.attrs.src) img.src = cur.attrs.src;
        // Titel bleibt (wie in der Ansicht, v7.2) nur als alt/title-Tooltip –
        // keine sichtbare Bildunterschrift im Editor, der Editor hat ohnehin
        // nie eine gerendert.
        img.alt = cur.attrs.alt || "";
        img.title = cur.attrs.alt || "";
        img.style.width = cur.attrs.width ? cur.attrs.width + "px" : "";
        // Feste Breite + max-height würde das Seitenverhältnis verzerren
        img.style.maxHeight = cur.attrs.width ? "none" : "";
      };
      apply();
      wrap.appendChild(img);
      const handle = document.createElement("span");
      handle.className = "img-resize-handle";
      handle.title = "Größe ändern";
      wrap.appendChild(handle);

      let startX = 0, startW = 0, dragging = false;
      const widthFor = (e) =>
        Math.round(Math.min(
          Math.max(60, startW + (e.clientX - startX)),
          wrap.parentElement ? wrap.parentElement.clientWidth : 4000
        ));
      const onMove = (e) => { if (dragging) img.style.width = widthFor(e) + "px"; };
      const onUp = (e) => {
        if (!dragging) return;
        dragging = false;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        const w = widthFor(e);
        if (typeof getPos === "function") {
          editor.chain().command(({ tr }) => {
            tr.setNodeMarkup(getPos(), undefined, { ...cur.attrs, width: w });
            return true;
          }).run();
        }
      };
      handle.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
        startX = e.clientX;
        startW = img.getBoundingClientRect().width;
        // Höhenkappung sofort lösen, sonst verzerrt die Live-Vorschau
        img.style.maxHeight = "none";
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
      });

      return {
        dom: wrap,
        // Style-Mutationen der Live-Vorschau sind keine Dokument-Änderungen
        ignoreMutation: () => true,
        // Nur Events des Anfassers abfangen – Klicks aufs Bild sollen die
        // Node weiterhin selektieren.
        stopEvent: (e) => e.target === handle,
        update: (updated) => {
          if (updated.type.name !== cur.type.name) return false;
          cur = updated;
          apply();
          return true;
        },
        destroy: () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onUp);
        },
      };
    };
  },
}).configure({ allowBase64: true });

// tiptap-markdown setzt beim Serialisieren zwar state.inTable, aber die
// installierte prosemirror-markdown-Version escaped Pipes nicht mehr selbst –
// eine Zelle mit "|" im Text zerfiele beim nächsten Öffnen in zwei Spalten.
// Daher eigener Serializer (Kopie des Originals), der esc() um Pipe-Escaping
// ergänzt. Nicht als GFM darstellbare Tabellen (verbundene Zellen oder mehrere
// Absätze in einer Zelle – nur per Paste erreichbar) landen wie im Original
// als HTML, damit beim nächsten Öffnen nichts verloren geht.
const cellHasSpan = (cell) => cell.attrs.colspan > 1 || cell.attrs.rowspan > 1;
function gfmSerializable(table) {
  let ok = true;
  table.forEach((row, _o, i) => {
    row.forEach((cell) => {
      const headerOk = i === 0
        ? cell.type.name === "tableHeader"
        : cell.type.name !== "tableHeader";
      if (!headerOk || cellHasSpan(cell) || cell.childCount > 1) ok = false;
    });
  });
  return ok;
}
const MdTable = Table.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          if (!gfmSerializable(node)) {
            state.write(getHTMLFromFragment(Fragment.from(node), node.type.schema));
            state.closeBlock(node);
            return;
          }
          state.inTable = true; // lässt harte Umbrüche in Zellen als <br> serialisieren
          const esc = state.esc.bind(state);
          state.esc = (str, startOfLine) => esc(str, startOfLine).replace(/\|/g, "\\|");
          try {
            node.forEach((row, _o, i) => {
              state.write("| ");
              row.forEach((cell, _o2, j) => {
                if (j) state.write(" | ");
                if (cell.firstChild && cell.firstChild.textContent.trim()) {
                  state.renderInline(cell.firstChild);
                }
              });
              state.write(" |");
              state.ensureNewLine();
              if (!i) {
                state.write("| " + Array.from({ length: row.childCount }, () => "---").join(" | ") + " |");
                state.ensureNewLine();
              }
            });
          } finally {
            state.esc = esc;
            state.inTable = false;
          }
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

export default function DocEditor({ initialDoc, imgMap, onSave, onCancel, saving }) {
  const baseline = useRef(null);
  const [error, setError] = useState(null);
  const [picker, setPicker] = useState(null); // null | "color" | "highlight" | "table"
  const [tableHover, setTableHover] = useState({ r: 0, c: 0 });
  // TipTap feuert Transaktionen ohne React-Re-Render; kleiner Zähler,
  // damit die Aktiv-Zustände der Toolbar-Knöpfe mitziehen.
  const [, setTick] = useState(0);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
        blockquote: false,
      }),
      BlockImage,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TaskList,
      TaskItem.configure({ nested: false }),
      // Quellen-Fußnoten [n](url) müssen den Roundtrip überstehen; ohne
      // Link-Extension würde TipTap den Link beim Öffnen zu Klartext
      // reduzieren. Auto-Verlinken bleibt aus (Links entstehen nur über
      // die Recherche, nicht beim Tippen).
      Link.configure({ openOnClick: false, autolink: false, linkOnPaste: false }),
      // Keine Zellen-Verbünde anbieten: nur einfache Tabellen sind als
      // GFM-Markdown serialisierbar (sonst fiele der Serializer auf HTML
      // zurück, das der Renderer nicht darstellt).
      MdTable.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      // html:true ist nötig, damit Schriftfarbe/Textmarker (Marks ohne
      // Markdown-Entsprechung) als <span>/<mark> serialisiert und beim
      // Öffnen wieder eingelesen werden.
      Markdown.configure({ html: true, bulletListMarker: "-", tightLists: true }),
    ],
    content: resolveImgs(initialDoc, imgMap),
    autofocus: "start",
    editorProps: { attributes: { class: "tiptap-doc focus:outline-none" } },
    onCreate: ({ editor: ed }) => { baseline.current = ed.storage.markdown.getMarkdown(); },
    onTransaction: () => setTick((t) => t + 1),
  });

  const save = () => {
    if (!editor || saving) return;
    const md = editor.storage.markdown.getMarkdown();
    if (md === baseline.current) { onCancel(); return; } // nichts geändert
    let out = unescapeMd(unresolveImgs(md, imgMap));
    // tiptap-markdown lässt zwischen Checklisten-Einträgen Leerzeilen – zusammenziehen.
    // Multiline-Anker statt führendem \n, sonst überspringt der Overlap bei
    // 3+ Einträgen jede zweite Lücke.
    out = out.replace(/^([ \t]*- \[[ xX]\][^\n]*)\n\n(?=[ \t]*- \[)/gm, "$1\n");
    // Sicherheitsnetz: Es darf keine data:-URL im Dokument landen (z. B. ein
    // direkt in den Editor eingefügtes Bild ohne img:-Referenz).
    if (out.includes("](data:")) {
      setError(
        "Das Dokument enthält ein Bild ohne Referenz (direkt eingefügt?). " +
        "Bitte entferne es hier und füge Bilder über den Chat hinzu."
      );
      return;
    }
    setError(null);
    onSave(out);
  };

  const btn = (active) =>
    "p-2 rounded-lg border " +
    (active
      ? "bg-indigo-50 border-indigo-300 text-indigo-700"
      : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50");

  if (!editor) return null;

  const currentColor = editor.getAttributes("textStyle").color || null;
  const currentHighlight = editor.isActive("highlight")
    ? editor.getAttributes("highlight").color || "#fde047"
    : null;

  const applyColor = (value) => {
    const c = editor.chain().focus();
    (value ? c.setColor(value) : c.unsetColor()).run();
    setPicker(null);
  };
  const applyHighlight = (value) => {
    const c = editor.chain().focus();
    (value ? c.setHighlight({ color: value }) : c.unsetHighlight()).run();
    setPicker(null);
  };

  const swatchGrid = (colors, current, apply) => (
    <div className="absolute z-10 top-full left-0 mt-1 p-2 bg-white border border-slate-200 rounded-lg shadow-lg flex gap-1">
      {colors.map((c) => (
        <button
          key={c.label}
          onClick={() => apply(c.value)}
          title={c.label}
          className={"w-6 h-6 rounded border " +
            (current === c.value ? "border-indigo-600 ring-1 ring-indigo-400" : "border-slate-300")}
          style={{ backgroundColor: c.swatch }}
        >
          {c.value === null ? <span className="text-[10px] text-white leading-none">✕</span> : null}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col px-4 pb-4 gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <button onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={btn(editor.isActive("heading", { level: 2 }))} title="Abschnitt (##)">
          <Heading2 size={15} />
        </button>
        <button onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={btn(editor.isActive("heading", { level: 3 }))} title="Unterthema (###)">
          <Heading3 size={15} />
        </button>
        <button onClick={() => editor.chain().focus().toggleBold().run()}
          className={btn(editor.isActive("bold"))} title="Fett">
          <Bold size={15} />
        </button>
        <button onClick={() => editor.chain().focus().toggleItalic().run()}
          className={btn(editor.isActive("italic"))} title="Kursiv">
          <Italic size={15} />
        </button>
        <button onClick={() => editor.chain().focus().toggleStrike().run()}
          className={btn(editor.isActive("strike"))} title="Durchgestrichen">
          <Strikethrough size={15} />
        </button>
        <button onClick={() => editor.chain().focus().toggleCode().run()}
          className={btn(editor.isActive("code"))} title="Code">
          <Code size={15} />
        </button>

        <div className="relative">
          <button onClick={() => setPicker(picker === "color" ? null : "color")}
            className={btn(!!currentColor)} title="Schriftfarbe">
            <Palette size={15} style={currentColor ? { color: currentColor } : undefined} />
          </button>
          {picker === "color" && swatchGrid(TEXT_COLORS, currentColor, applyColor)}
        </div>
        <div className="relative">
          <button onClick={() => setPicker(picker === "highlight" ? null : "highlight")}
            className={btn(!!currentHighlight)} title="Textmarker">
            <Highlighter size={15} style={currentHighlight ? { color: currentHighlight } : undefined} />
          </button>
          {picker === "highlight" && swatchGrid(HIGHLIGHT_COLORS, currentHighlight, applyHighlight)}
        </div>

        <button onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={btn(editor.isActive("bulletList"))} title="Stichpunktliste">
          <List size={15} />
        </button>
        <button onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={btn(editor.isActive("orderedList"))} title="Nummerierte Liste">
          <ListOrdered size={15} />
        </button>
        <button onClick={() => editor.chain().focus().toggleTaskList().run()}
          className={btn(editor.isActive("taskList"))} title="Checkliste">
          <ListChecks size={15} />
        </button>
        <button onClick={() => editor.chain().focus().setHorizontalRule().run()}
          className={btn(false)} title="Trennlinie">
          <Minus size={15} />
        </button>

        <div className="relative">
          <button
            onClick={() => { setPicker(picker === "table" ? null : "table"); setTableHover({ r: 0, c: 0 }); }}
            className={btn(editor.isActive("table"))}
            title="Tabelle einfügen"
          >
            <TableIcon size={15} />
          </button>
          {picker === "table" && (
            <div className="absolute z-10 top-full left-0 mt-1 p-2 bg-white border border-slate-200 rounded-lg shadow-lg">
              <div className="grid grid-cols-6 gap-0.5">
                {Array.from({ length: 6 * 6 }, (_, i) => {
                  const r = Math.floor(i / 6) + 1;
                  const c = (i % 6) + 1;
                  const hot = r <= tableHover.r && c <= tableHover.c;
                  return (
                    <div
                      key={i}
                      onMouseEnter={() => setTableHover({ r, c })}
                      onClick={() => {
                        editor.chain().focus().insertTable({ rows: r + 1, cols: c, withHeaderRow: true }).run();
                        setPicker(null);
                      }}
                      className={"w-4 h-4 rounded-[2px] border cursor-pointer " +
                        (hot ? "bg-indigo-500 border-indigo-600" : "bg-slate-100 border-slate-200")}
                    />
                  );
                })}
              </div>
              <div className="mt-1 text-center text-[10px] text-slate-500 font-mono">
                {tableHover.r > 0 ? tableHover.c + " Spalten × " + tableHover.r + " Zeilen" : "Größe wählen"}
              </div>
            </div>
          )}
        </div>

        {editor.isActive("table") && (
          <>
            <span className="mx-1 w-px h-5 bg-slate-200" />
            <button onClick={() => editor.chain().focus().addRowAfter().run()}
              className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 text-xs"
              title="Zeile unterhalb einfügen">
              +Zeile
            </button>
            <button onClick={() => editor.chain().focus().addColumnAfter().run()}
              className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 text-xs"
              title="Spalte rechts einfügen">
              +Spalte
            </button>
            {/* Die Kopfzeile ist nicht löschbar: ohne sie wäre die Tabelle
                kein GFM mehr und fiele auf HTML-Serialisierung zurück, die
                die Leseansicht nicht darstellt. */}
            <button onClick={() => editor.chain().focus().deleteRow().run()}
              disabled={editor.isActive("tableHeader")}
              className={"px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-600 text-xs " +
                (editor.isActive("tableHeader") ? "opacity-40" : "hover:bg-slate-50")}
              title={editor.isActive("tableHeader") ? "Kopfzeile kann nicht gelöscht werden" : "Aktuelle Zeile löschen"}>
              −Zeile
            </button>
            <button onClick={() => editor.chain().focus().deleteColumn().run()}
              className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 text-xs"
              title="Aktuelle Spalte löschen">
              −Spalte
            </button>
            <button onClick={() => editor.chain().focus().deleteTable().run()}
              className="px-2 py-1.5 rounded-lg border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 text-xs"
              title="Ganze Tabelle löschen">
              ✕Tabelle
            </button>
          </>
        )}
        <div className="flex-1" />
        <button onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          className={btn(false) + (editor.can().undo() ? "" : " opacity-40")} title="Rückgängig">
          <Undo2 size={15} />
        </button>
        <button onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          className={btn(false) + (editor.can().redo() ? "" : " opacity-40")} title="Wiederholen">
          <Redo2 size={15} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-indigo-300 bg-white p-3"
        onClick={() => picker && setPicker(null)}>
        <EditorContent editor={editor} />
      </div>

      {error && (
        <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving}
          className={"px-3 py-1.5 rounded-lg bg-indigo-700 text-white text-sm font-medium " +
            (saving ? "opacity-40" : "hover:bg-indigo-800")}>
          {saving ? "Speichert …" : "Speichern"}
        </button>
        <button onClick={onCancel}
          className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 text-sm hover:bg-slate-50">
          Abbrechen
        </button>
        <span className="text-xs text-slate-400">Speichern legt eine neue Version an.</span>
      </div>
    </div>
  );
}
