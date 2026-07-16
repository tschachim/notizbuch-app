import { useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { getHTMLFromFragment, Node } from "@tiptap/core";
import { Fragment } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import CodeBlockExtension from "@tiptap/extension-code-block";
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
  Bold, Italic, Code, Code2, List, ListOrdered, ListChecks, Heading2, Heading3,
  Minus, Undo2, Redo2, Strikethrough, Palette, Highlighter, Table as TableIcon,
  Sigma, SquareFunction,
} from "lucide-react";
import {
  mathToPlaceholders, renderKatexHtml, MATH_SERIALIZED_RE, MATH_INLINE_TAG, MATH_BLOCK_TAG,
  ESCAPED_DOLLAR_SENTINEL,
} from "../lib/math.jsx";
import { splitFenceSegments } from "../lib/code.jsx";

/* WYSIWYG-Editor für die manuelle Bearbeitung der Wissensbasis.
   TipTap mit Markdown-Round-Trip, beschränkt auf den Dialekt, den der
   Renderer der App versteht: # / ## / ###, "- "-Listen, nummerierte
   Listen, Checklisten (- [ ]), fett/kursiv/Code/durchgestrichen,
   Schriftfarbe und Textmarker (als Inline-HTML), ---, Bilder, LaTeX-
   Formeln ($…$/$$…$$, v7.3), monospaced Codeblöcke (```…```, v7.7 –
   StarterKits CodeBlock-Node mit einem EIGENEN Serializer, der den Zaun
   bei Backtick-Serien im Inhalt verlängert, siehe FencedCodeBlock unten
   und DECISIONS #54/Re-Review-Fix K1). Zitate (Blockquote) bleiben
   deaktiviert. */

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
// die vom Markdown-Serializer erzeugten daher entfernen. Formel-Segmente
// ($…$/$$…$$, von MathInline/MathBlock direkt – ohne state.esc() – ge-
// schrieben) dürfen dabei NICHT angefasst werden: TeX enthält legitime
// Backslash-Sequenzen wie \{ \} \_ \( \) (Mengen-/Intervall-Notation), die
// exakt wie Serializer-Escapes aussehen und sonst kaputt entfernt würden
// (z. B. "\{1,2\}" → "{1,2}"). Split auf MATH_SERIALIZED_RE (wie schon
// renumberCitations mit Codespans in markdown.jsx) hält Formeln unangetastet.
const MATH_SPLIT_RE = new RegExp("(" + MATH_SERIALIZED_RE.source + ")");
// Innerhalb eines Segments (bereits außerhalb jedes Fenced-Codeblocks,
// siehe unescapeMd unten) genau wie bisher: Formeln aussparen, sonst
// Serializer-Escapes entfernen und den \$-Sentinel zurückwandeln.
const unescapeMdSegment = (seg) =>
  seg
    .split(MATH_SPLIT_RE)
    .map((s, i) => (i % 2 ? s : s.replace(/\\([\\`*_{}[\]()#+\-.!>~=])/g, "$1")))
    .join("")
    // \$-Escapes aus mathToPlaceholders (Review-Finding 2) kommen als
    // Sentinel-Zeichen an (siehe ESCAPED_DOLLAR_SENTINEL in math.jsx) –
    // unbedingt zurückwandeln, ohne jede Fallunterscheidung: Der Sentinel
    // kann mit MATH_SPLIT_RE/dem Backslash-Escape-Muster oben nicht
    // kollidieren, weil er weder "$" noch "\" enthält.
    .split(ESCAPED_DOLLAR_SENTINEL).join("\\$");
// Exportiert (Review-Finding 6), damit Tests die ECHTE Funktion prüfen
// statt eine im Test nachgebaute Kopie, die bei einer Änderung hier
// unbemerkt aus dem Takt geraten könnte.
//
// v7.7: Fenced-Codeblöcke (```…```) werden VORAB per splitFenceSegments
// komplett ausgenommen – ihr Inhalt kommt vom CodeBlock-Serializer
// UNVERÄNDERT (ohne state.esc(), reiner Text-Node-Inhalt, siehe
// DECISIONS), jede nachträgliche Bereinigung hier würde absichtliche
// Backslashes/Formel-artige Zeichenfolgen im Code kaputt machen (z. B.
// eine Regex mit "\." oder "\-" im Snippet). Da Formel-Nodes laut Schema
// nicht INNERHALB eines codeBlock-Nodes vorkommen können (content:
// "text*"), ist die Trennung Fence-zuerst/Formel-danach überschneidungsfrei.
export const unescapeMd = (md) =>
  splitFenceSegments(md)
    .map((seg) => (seg.code ? seg.raw : unescapeMdSegment(seg.raw)))
    .join("\n");

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
// Eine Zelle, deren einziger Inhalt ein oder mehrere harte Zeilenumbrüche
// sind (Umschalt+Enter in einer sonst leeren Zelle), muss für die
// Pipe-Zeilen-Serialisierung ebenfalls als "leer" gelten: state.renderInline
// würde sonst einen echten Zeilenumbruch mitten in die Pipe-Zeile schreiben
// und die Tabelle beim nächsten Öffnen zerreißen (Review-Vorschlag 7,
// gefunden beim MdTable-Bugfix für Formel-Zellen).
function cellHasRenderableContent(cell) {
  const p = cell.firstChild;
  if (!p || p.childCount === 0) return false;
  let has = false;
  p.forEach((child) => {
    if (child.type.name !== "hardBreak") has = true;
  });
  return has;
}
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
// Exportiert (Re-Review-Finding R3), damit der Roundtrip-Test die ECHTE
// Erweiterung importiert statt cellHasRenderableContent/gfmSerializable im
// Test nachzubauen.
export const MdTable = Table.extend({
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
                // BUGFIX (v7.3, beim Einbau der Formel-Nodes gefunden): Die
                // ursprüngliche Prüfung "cell.firstChild.textContent.trim()"
                // ist für eine Zelle, deren einziger Inhalt ein Inline-ATOM
                // ohne Text ist (z. B. eine Formel – textContent liefert bei
                // Atomen immer ""), fälschlich falsy: state.renderInline
                // wurde nie aufgerufen und der Inhalt der Zelle fiel beim
                // Speichern stillschweigend weg. cellHasRenderableContent
                // erkennt "hat überhaupt sichtbaren Kind-Inhalt" korrekt für
                // Text UND Atome, eine wirklich leere ODER nur aus harten
                // Zeilenumbrüchen bestehende Zelle bleibt weiterhin leer.
                if (cellHasRenderableContent(cell)) {
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

// Codeblöcke mit LÄNGEN-VERLÄNGERTEM Zaun (v7.7-Fix nach Code-Review
// 2026-07-17, Finding K1). tiptap-markdown liefert für StarterKits
// eingebaute codeBlock-Node zwar bereits einen Fence-Serializer, der
// schreibt aber IMMER exakt drei Backticks – anders als der
// Upstream-Serializer von prosemirror-markdown verlängert er den Zaun
// NICHT, wenn der Code-Inhalt selbst eine Backtick-Serie enthält (z. B.
// ein Markdown-Beispiel MIT einem ```-Fence als Codetext – ein von der
// App aktiv beworbenes Szenario, siehe System-Prompt "Konfiguration/
// Logs/Code"). Ohne Verlängerung würde eine im Code enthaltene
// ```-Zeile beim Speichern selbst zum (verfrühten) Schluss-Zaun – das
// Dokument zerfiele bei jedem weiteren Öffnen+Speichern progressiv
// weiter (empirisch belegt im Review). Eigener Storage/Serializer-Pfad
// exakt wie bei BlockImage/MdTable oben: Zaunlänge = längste
// Backtick-Serie im Inhalt + 1 (mindestens 3) – GENAU die CommonMark-
// Regel, die auch matchFenceBlock (code.jsx) beim Lesen anwendet (dort
// muss der Schluss-Zaun mindestens so lang sein wie der öffnende), erst
// BEIDE Seiten zusammen halten den Roundtrip stabil (siehe
// tests/docEditorCode.test.jsx). state.text(...,false) bleibt roh (kein
// state.esc()) wie beim StarterKit-Original – nur die Zaunlänge ändert
// sich, der restliche Inhalt bleibt byte-genau.
export const FencedCodeBlock = CodeBlockExtension.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          const runs = node.textContent.match(/`{3,}/g) || [];
          const fenceLen = Math.max(3, ...runs.map((r) => r.length + 1));
          const fence = "`".repeat(fenceLen);
          state.write(fence + (node.attrs.language || "") + "\n");
          state.text(node.textContent, false);
          state.ensureNewLine();
          state.write(fence);
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

// LaTeX-Formeln als atomare Nodes (v7.3, Nutzerwunsch "volles Programm").
// GRÖSSTER FALLSTRICK (siehe DECISIONS #14): tiptap-markdown serialisiert
// normalen Fließtext mit Backslash-Escapes, und unescapeMd entfernt diese
// nachträglich wieder – TeX-Backslashes (\frac, \Delta) würden auf BEIDEN
// Wegen zerstört, liefe eine Formel als gewöhnlicher Text durch den
// Editor. Deshalb – exakt wie BlockImage/MdTable oben – ein eigener
// Storage/Serializer-Pfad: der TeX-Quelltext steckt als Node-Attribut,
// die Serialisierung schreibt ihn UNVERÄNDERT (ohne state.esc()) als
// $tex$ bzw. $$tex$$ zurück; unescapeMd wird über MATH_SERIALIZED_RE
// (math.jsx) angewiesen, diese Spans nicht anzufassen.
//
// Lade-Pfad: mathToPlaceholders() (math.jsx) wandelt $…$/$$…$$ VOR dem
// tiptap-markdown-Parsing in <math-inline>/<math-block>-Tags mit einem
// data-tex-Attribut um (gleiches Vorbild wie img:-Referenzen: Konvertieren
// vorm Laden, das Gegenstück serialisiert beim Speichern direkt zurück).
// html:true reicht diese unbekannten Tags roh durch markdown-it durch
// (gleiches Prinzip wie <span>/<mark> für Farben, DECISIONS #15); die
// parseHTML()-Regeln unten wandeln sie beim DOM→ProseMirror-Parsing in
// die atomaren Nodes um. Dass markdown-it das Tag dabei in ein <p>
// einbettet, ist irrelevant – ProseMirror ordnet einen Block-Node
// (mathBlock) automatisch außerhalb ein (exakt wie bei BlockImage, das
// ebenfalls block-level ist, aber aus Inline-Bild-Syntax stammt).
//
// Bearbeiten: Klick auf die gerenderte Formel öffnet ein einfaches
// <input> mit dem TeX-Quelltext (kein window.prompt). Enter bestätigt,
// Escape bricht ab (verwirft die Eingabe, die ORIGINAL-Formel bleibt
// erhalten), Blur bestätigt wie Enter (Klick auf "Speichern" während der
// Bearbeitung committet die Änderung noch vor dem eigentlichen Speichern).
// Leerer TeX beim Bestätigen löscht den Node (Spezifikation). Klick statt
// Doppelklick: bei einem atomaren Node hätte Doppelklick zusätzliche
// Timing-Fallstricke (ProseMirror selektiert bei Klick #1 zunächst den
// Node), Klick ist die direktere, leichter auffindbare Geste.
//
// Validierung (Review-Finding 3): $tex$/$$tex$$ wird UNGEPRÜFT geschrieben
// (kein state.esc()) – ein rohes $ im TeX würde die Formelgrenzen beim
// nächsten Laden verschieben oder die Formel ganz zu Klartext degradieren
// lassen ("a $ b" → "$a $ b$", von MATH_TOKEN_RE gar nicht mehr erkannt).
// Da $ als Formelgrenze reserviert ist, verweigert commit() bei einem
// rohen $ in MathInline bzw. $$ in MathBlock (einzelne $ sind dort
// unkritisch) statt den Node kaputt zu speichern, und lässt das Eingabe-
// feld mit Fehlerstil offen stehen.
function mathNodeView(displayMode) {
  return ({ node, editor, getPos }) => {
    let cur = node;
    // Frisch über den Toolbar-Knopf eingefügte Formeln haben leeren TeX –
    // die Prüfung "$…$"/"$$…$$" erfordert mindestens ein Zeichen Inhalt
    // (MATH_TOKEN_RE), ein geladenes Dokument kann also nie einen bereits
    // bestehenden Formel-Node mit leerem TeX enthalten. "leer" bedeutet
    // hier folglich zuverlässig "gerade erst eingefügt" → sofort Eingabe.
    let editing = !cur.attrs.tex.trim();
    const wrap = document.createElement(displayMode ? "div" : "span");
    wrap.className = "math-node " + (displayMode ? "math-node-block" : "math-node-inline");

    const rendered = document.createElement("span");
    rendered.className = "math-node-rendered";
    rendered.title = "Klicken zum Bearbeiten";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "math-node-input";
    input.placeholder = displayMode ? "LaTeX, z. B. a^2+b^2=c^2" : "LaTeX, z. B. x^2";

    const ERROR_HINT = "Dollarzeichen ($) ist als Formelgrenze reserviert – bitte entfernen.";
    const isValidTex = (val) => (displayMode ? !val.includes("$$") : !val.includes("$"));
    const setInvalid = (v) => {
      input.classList.toggle("math-node-input-error", v);
      input.title = v ? ERROR_HINT : "";
    };

    // Liest die AKTUELLE Position frisch (nicht beim Erzeugen der NodeView
    // eingefroren). Kann nach einer Zerstörung des Nodes undefined liefern
    // (Review-Finding 8) – dann nichts tun statt tr.delete(undefined, NaN)
    // aufzurufen, was werfen würde.
    const currentPos = () => (typeof getPos === "function" ? getPos() : undefined);

    const removeSelf = () => {
      const pos = currentPos();
      if (typeof pos !== "number") return;
      editor.chain().command(({ tr }) => {
        tr.delete(pos, pos + cur.nodeSize);
        return true;
      }).run();
    };

    const renderView = () => {
      wrap.innerHTML = "";
      if (editing) {
        input.value = cur.attrs.tex;
        wrap.appendChild(input);
      } else {
        rendered.innerHTML = renderKatexHtml(cur.attrs.tex, displayMode);
        wrap.appendChild(rendered);
      }
    };

    const openEdit = () => {
      editing = true;
      setInvalid(false);
      renderView();
      // Erst nach dem Einhängen ins DOM fokussieren (Layout muss stehen).
      setTimeout(() => { input.focus(); input.select(); }, 0);
    };

    const commit = () => {
      const next = input.value.trim();
      if (!next) { removeSelf(); return; } // leer bestätigt -> Node löschen
      if (!isValidTex(next)) { setInvalid(true); return; } // Commit verweigern, Feld bleibt offen
      setInvalid(false);
      const pos = currentPos();
      if (typeof pos === "number") {
        editor.chain().command(({ tr }) => {
          tr.setNodeMarkup(pos, undefined, { ...cur.attrs, tex: next });
          return true;
        }).run();
      }
      editing = false;
      // cur wird über update() mit dem neuen Attribut nachgezogen; falls
      // update() aus irgendeinem Grund nicht feuert, hier zusätzlich neu
      // rendern, sonst bliebe die alte Formel sichtbar.
      renderView();
    };

    const cancel = () => {
      if (!cur.attrs.tex.trim()) { removeSelf(); return; } // leer + verworfen -> löschen
      editing = false;
      setInvalid(false);
      renderView(); // zeigt wieder die unveränderte cur.attrs.tex
    };

    input.addEventListener("keydown", (e) => {
      // Tippen im Feld darf ProseMirror nie als Editor-Tastatureingabe
      // erreichen (sonst könnte z. B. Backspace den ganzen Node löschen).
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      else if (e.key === "Escape") { e.preventDefault(); cancel(); }
    });
    input.addEventListener("mousedown", (e) => e.stopPropagation());
    // Fehlerstil verschwindet, sobald weitergetippt wird (bessere UX als
    // bis zum nächsten Bestätigungsversuch rot zu bleiben).
    input.addEventListener("input", () => setInvalid(false));
    input.addEventListener("blur", commit);

    rendered.addEventListener("click", (e) => {
      e.preventDefault();
      openEdit();
    });

    renderView();
    if (editing) setTimeout(() => { input.focus(); }, 0);

    return {
      dom: wrap,
      // Die innerHTML-Swaps oben sind reine Anzeige, keine Dokument-Änderung.
      ignoreMutation: () => true,
      // Während der Bearbeitung soll ProseMirror Tastatur-/Maus-Events auf
      // dem Node NICHT selbst interpretieren (z. B. NodeSelection/Löschen).
      stopEvent: () => editing,
      update: (updated) => {
        if (updated.type.name !== cur.type.name) return false;
        cur = updated;
        if (!editing) renderView();
        return true;
      },
    };
  };
}

// Exportiert (Review-Finding 6) für einen echten TipTap-Roundtrip-Test
// (tests/docEditorMath.test.jsx) statt nur den String-Output von
// mathToPlaceholders zu prüfen.
export const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { tex: { default: "" } };
  },
  parseHTML() {
    return [{ tag: MATH_INLINE_TAG, getAttrs: (el) => ({ tex: el.getAttribute("data-tex") || "" }) }];
  },
  renderHTML({ node }) {
    return [MATH_INLINE_TAG, { "data-tex": node.attrs.tex }];
  },
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          state.write("$" + node.attrs.tex + "$");
        },
        parse: {},
      },
    };
  },
  addNodeView() {
    return mathNodeView(false);
  },
});

export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return { tex: { default: "" } };
  },
  parseHTML() {
    return [{ tag: MATH_BLOCK_TAG, getAttrs: (el) => ({ tex: el.getAttribute("data-tex") || "" }) }];
  },
  renderHTML({ node }) {
    return [MATH_BLOCK_TAG, { "data-tex": node.attrs.tex }];
  },
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          state.write("$$" + node.attrs.tex + "$$");
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
  addNodeView() {
    return mathNodeView(true);
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
        // codeBlock (v7.7, Nutzerwunsch "voller Support"): StarterKits
        // eingebaute Node bleibt hier deaktiviert – FencedCodeBlock oben
        // ersetzt sie mit demselben Node-Typnamen ("codeBlock", toggle-/
        // Tastatur-Verhalten bleibt über .extend() erhalten), aber einem
        // eigenen Serializer mit Zaun-Verlängerung (Re-Review-Fix K1,
        // siehe dort und DECISIONS #54).
        codeBlock: false,
        blockquote: false,
      }),
      FencedCodeBlock,
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
      MathInline,
      MathBlock,
      // html:true ist nötig, damit Schriftfarbe/Textmarker (Marks ohne
      // Markdown-Entsprechung) als <span>/<mark> UND die Formel-Tags
      // (<math-inline>/<math-block>) serialisiert und beim Öffnen wieder
      // eingelesen werden.
      Markdown.configure({ html: true, bulletListMarker: "-", tightLists: true }),
    ],
    content: resolveImgs(mathToPlaceholders(initialDoc), imgMap),
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

  // Fügt eine leere Formel ein; die NodeView öffnet für einen leeren TeX-
  // Wert automatisch sofort das Eingabefeld (siehe mathNodeView oben).
  const insertMath = (displayMode) => {
    editor.chain().focus().insertContent({ type: displayMode ? "mathBlock" : "mathInline", attrs: { tex: "" } }).run();
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
        <button onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          className={btn(editor.isActive("codeBlock"))} title="Codeblock">
          <Code2 size={15} />
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

        <button onClick={() => insertMath(false)} className={btn(false)} title="Formel einfügen (inline, $…$)">
          <Sigma size={15} />
        </button>
        <button onClick={() => insertMath(true)} className={btn(false)} title="Formel einfügen (abgesetzt, $$…$$)">
          <SquareFunction size={15} />
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
