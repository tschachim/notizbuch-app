import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { getHTMLFromFragment, Node, Extension } from "@tiptap/core";
import { Fragment } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
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
  Bold, Italic, Code, Code2, List, ListOrdered, ListChecks, Heading1, Heading2, Heading3,
  Minus, Undo2, Redo2, Strikethrough, Palette, Highlighter, Table as TableIcon,
  Sigma, SquareFunction, Link2 as LinkIcon, Sparkles, Loader2,
} from "lucide-react";
import {
  mathToPlaceholders, renderKatexHtml, MATH_SERIALIZED_RE, MATH_INLINE_TAG, MATH_BLOCK_TAG,
  ESCAPED_DOLLAR_SENTINEL,
} from "../lib/math.jsx";
import { splitFenceSegments } from "../lib/code.jsx";
import { LINK_URL_RE } from "../lib/markdown.jsx";
import {
  cleanupLinkTitle, providerFor, providerHasCredentials, fetchLinkTitle,
  getLinkProviders, buildProviderIconDom,
} from "../lib/linkProviders.jsx";

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

/* -------------------------------------------------------------------- */
/* Generische Links (v7.8, Nutzerwunsch): siehe markdown.jsx (Viewer) für */
/* die Gegenstelle. Quellen-Fußnoten ([n](url), Mark-Text = reine Zahl)   */
/* und generische Links (Mark-Text = sprechender Titel) laufen im Editor  */
/* über DENSELBEN Link-Mark (@tiptap/extension-link) – nur die ANZEIGE     */
/* soll sich unterscheiden, damit man beim Bearbeiten sieht, was beim     */
/* Speichern wie im Viewer landet. Ein ProseMirror-Plugin scannt dafür    */
/* bei jeder Dokumentänderung alle Link-Mark-Bereiche und vergibt eine    */
/* CSS-Klasse (siehe index.css, "cite-link"/"doc-link").                  */
/* -------------------------------------------------------------------- */

// Läuft über den kompletten Dokumentbaum und fasst zusammenhängende
// Text-Runs mit IDENTISCHEM href zu EINER Decoration zusammen – auch wenn
// ProseMirror den Text intern in mehrere Text-Nodes aufgeteilt hat (z. B.
// nach einer Bearbeitung mitten im Link). "run.to === from" ist die
// Zusammenhangs-Prüfung: nur direkt aneinandergrenzende Text-Nodes mit
// gleichem href gelten als EIN Link (ein neuer Node an anderer Position
// beendet den laufenden Run garantiert, egal was dazwischen liegt).
function computeLinkDecorations(doc) {
  const decos = [];
  let run = null; // { from, to, href, text }
  const flush = () => {
    if (run) {
      const isCite = /^\d+$/.test(run.text);
      decos.push(Decoration.inline(run.from, run.to, { class: isCite ? "cite-link" : "doc-link" }));
      // Provider-Icon (v7.9): NUR vor generischen Links, NIE vor einer
      // Quellen-Fußnote (Sicherheitsregel 2 im Auftrag – Icons rein aus dem
      // URL-Präfix, ohne jeden Netzzugriff, siehe providerFor/
      // lib/linkProviders.jsx). Läuft wie die Klassenvergabe oben NUR beim
      // Rebuild (docChanged, siehe apply() unten), nicht bei jedem
      // Selektionswechsel.
      if (!isCite) {
        const provider = providerFor(run.href, getLinkProviders());
        if (provider) {
          decos.push(
            Decoration.widget(run.from, () => buildProviderIconDom(provider), { side: -1 })
          );
        }
      }
    }
    run = null;
  };
  doc.descendants((node, pos) => {
    const linkMark = node.isText ? node.marks.find((m) => m.type.name === "link") : null;
    if (!linkMark) { flush(); return; }
    const from = pos;
    const to = pos + node.nodeSize;
    if (run && run.href === linkMark.attrs.href && run.to === from) {
      run.to = to;
      run.text += node.text;
    } else {
      flush();
      run = { from, to, href: linkMark.attrs.href, text: node.text };
    }
  });
  flush();
  return DecorationSet.create(doc, decos);
}

const linkDecorationsPluginKey = new PluginKey("linkDecorations");

export const LinkDecorations = Extension.create({
  name: "linkDecorations",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: linkDecorationsPluginKey,
        state: {
          init: (_, { doc }) => computeLinkDecorations(doc),
          // Neu berechnen NUR bei echten Doc-Änderungen (tr.docChanged) –
          // ein reiner Selektionswechsel (Cursor bewegen) soll bei langen
          // Dokumenten nicht bei jedem Tastendruck neu scannen. Ohne
          // Änderung wird die bestehende DecorationSet einfach gemappt
          // (Standardmuster für docChanged-abhängigen Plugin-State).
          apply: (tr, old) => (tr.docChanged ? computeLinkDecorations(tr.doc) : old.map(tr.mapping, tr.doc)),
        },
        props: {
          decorations: (state) => linkDecorationsPluginKey.getState(state),
        },
      }),
    ];
  },
});

// Titel-Validierung für den Link-Dialog (Toolbar-Knopf, siehe unten):
// (a) reine Ziffern sind für Quellen-Fußnoten reserviert – renumberCitations
// (markdown.jsx, CITE_LINK_RE) würde einen solchen Titel beim nächsten
// Speichern dokumentweit durch eine fortlaufende Nummer ERSETZEN, ein
// Nutzer, der versehentlich "2024" als Linktitel eintippt, würde also
// stillschweigend eine Fußnote statt eines Links bekommen – lieber vorher
// blockieren als das hinterher überraschend umzudeuten.
// (b) "[" / "]" im Titel werden STILL durch "(" / ")" ersetzt:
// prosemirror-markdown escaped sie beim Serialisieren zu "\[ \]"
// (state.esc()), unescapeMd (oben) macht dieses Escape beim Speichern
// unbedingt wieder rückgängig – ein roher "]" im Linktitel würde dann den
// Viewer-Link-Regex (INLINE_TOKEN_RE, markdown.jsx, Titel schließt "]"
// bewusst aus) mitten im Titel beenden und den Link zerschneiden. Beide
// Funktionen sind exportiert (wie unescapeMd/MdTable oben), damit Tests
// die ECHTEN Funktionen prüfen statt einer im Test nachgebauten Kopie.
//
// v7.9: Die eigentliche Regel steckt jetzt in cleanupLinkTitle
// (lib/linkProviders.jsx) – ein automatisch per "Titel ermitteln" (siehe
// unten) ermittelter Titel (z. B. von Azure DevOps) muss durch GENAU
// dieselbe Prüfung laufen wie ein manuell eingegebener, und
// linkProviders.jsx darf aus Zirkelbezug-Gründen nicht aus DocEditor.jsx
// importieren (siehe Kopfkommentar dort) – also läuft der Import in
// dieser Richtung: DocEditor.jsx nutzt cleanupLinkTitle, statt die Regel
// ein zweites Mal zu pflegen. validateLinkTitle bleibt als Name/Export
// erhalten (bestehende Tests/Aufrufer referenzieren ihn).
export function validateLinkTitle(raw) {
  return cleanupLinkTitle(raw);
}

// URL-Validierung/-Normalisierung für den Link-Dialog: fehlt ein Schema,
// wird https:// vorangestellt (Nutzerkomfort – die App-Konvention verlangt
// ohnehin nur http(s)); jedes ANDERE explizite Schema (javascript:, data:,
// ftp:, …) wird abgelehnt (dieselbe Beschränkung wie im Viewer, markdown.jsx,
// und im bestehenden Zitat-Fluss, citations.jsx).
//
// Zeichen-Encoding (Nachbesserung v7.8, Finding 1 des Re-Reviews): empirisch
// nachgestellt (siehe Testfälle unten), dass eine an sich "gültige" URL den
// Roundtrip Editor → Markdown → Viewer bricht, wenn sie eines der folgenden
// Zeichen roh enthält:
// - LEERZEICHEN: prosemirror-markdown escaped Leerzeichen im href NICHT
//   (anders als "()\""); die Viewer-Grammatik (LINK_URL_RE, markdown.jsx)
//   verlangt aber whitespace-freie URLs – die URL-Erkennung bricht am
//   Leerzeichen ab, der Rest der Zeile bleibt als Markdown-Trümmer stehen.
// - UNBALANCIERTE ODER VERSCHACHTELTE runde Klammern: prosemirror-markdown
//   escaped "(" / ")" im href zwar zu "\(" / "\)", aber unescapeMd (oben)
//   entfernt genau dieses Escape wieder BEDINGUNGSLOS (dieselbe Funktion
//   läuft über das gesamte Dokument, ohne URL-Kontext) – die rohen Klammern
//   landen also unverändert im gespeicherten Markdown. Die Viewer-Grammatik
//   (LINK_URL_RE) trägt aber nur GENAU EINE Ebene balancierter Klammern
//   (Wikipedia: `.../Steak_(Fleisch)`): eine unbalancierte schließende ")"
//   kürzt die erkannte URL beim nächsten Laden still (der Rest wird
//   literaler Text), eine verschachtelte Klammer lässt die GESAMTE
//   [Titel](url)-Form gar nicht mehr matchen (Klartext-Trümmer).
// - '"' (Anführungszeichen): wird von prosemirror-markdown zwar escaped,
//   aber von unescapeMd NIE entfernt (state.esc()-Zeichensatz oben enthält
//   bewusst kein '"' – Klammern/Sternchen/etc. gehören zur normalen
//   Markdown-Syntax des Renderers, Anführungszeichen nicht). Ein roher '"'
//   im href hinterlässt dadurch dauerhaft ein zusätzliches "\" im
//   gespeicherten Dokument (Idempotenz gebrochen – jeder weitere Load/Save-
//   Zyklus bleibt zwar STABIL bei dieser kaputten Form, aber sie weicht für
//   immer vom eingegebenen href ab).
// - '<' / '>': brechen die Viewer-Grammatik selbst zwar NICHT (kein
//   Sonderzeichen dort), werden von prosemirror-markdown beim Serialisieren
//   aber auch NICHT escaped – tiptap-markdown/markdown-it normalisiert eine
//   rohe "<"/">" im href beim NÄCHSTEN Laden jedoch still zu "%3C"/"%3E"
//   (eigene URL-Normalisierung der markdown-it/mdurl-Bibliothek, empirisch
//   geprüft). Ohne Vorab-Encoding würde sich die im Link-Dialog angezeigte
//   URL beim zweiten Öffnen des Dokuments also überraschend ändern.
// ENTSCHEIDUNG: Alle fünf Fälle werden statt abgelehnt automatisch
// PROZENT-ENCODIERT (%20/%22/%3C/%3E bzw. %28/%29 für Klammern) –
// nutzerfreundlicher als eine Fehlermeldung, und eine mit diesen Zeichen aus
// dem Browser kopierte URL (z. B. ein Dateipfad mit Leerzeichen) bleibt
// benutzbar. Klammern werden NUR encodiert, wenn die URL nicht bereits der
// Viewer-Grammatik entspricht (LINK_URL_FULL_RE-Test) – eine einzelne Ebene
// balancierter Klammern (Wikipedia) bleibt dadurch bewusst unverändert
// lesbar. Reihenfolge wichtig: Leerzeichen/"/<> zuerst encodieren, danach
// erst gegen die Grammatik prüfen (ein noch rohes Leerzeichen würde die
// Klammer-Prüfung sonst verfälschen).
const LINK_URL_FULL_RE = new RegExp("^" + LINK_URL_RE.source + "$");
export function normalizeLinkUrl(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { error: "Bitte eine URL angeben." };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : "https://" + trimmed;
  if (!/^https?:\/\//i.test(withScheme)) {
    return { error: "Nur http(s)-Links werden unterstützt." };
  }
  let url = withScheme
    .replace(/\s/g, "%20")
    .replace(/"/g, "%22")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E");
  if (!LINK_URL_FULL_RE.test(url)) {
    url = url.replace(/\(/g, "%28").replace(/\)/g, "%29");
  }
  return { url };
}

// Auto-Fetch im Link-Popover (v7.12, Nutzerwunsch "automatische Titel-
// Ermittlung überall"): löst DECISIONS #56 ("Fetch nur auf Klick") ab, der
// manuelle Knopf "Titel ermitteln" (fetchTitleForLink unten) bleibt als
// Retry erhalten. Debounce-Dauer bewusst als benannte Konstante (Auftrag:
// "~600 ms").
const AUTO_FETCH_DEBOUNCE_MS = 600;

// Reine Helfer, aus der Komponente herausgezogen, damit sie OHNE Editor-
// Instanz/DOM testbar sind (siehe tests/docEditorLinks.test.jsx). Beide
// werfen nie.

// Liefert den zur (noch rohen, ggf. schemalosen) URL passenden Provider,
// WENN er Zugangsdaten trägt – sonst null. Identische Regel wie
// linkTitleProvider (siehe openLinkPicker/fetchTitleForLink unten), nur ohne
// React-State-Abhängigkeit, damit der manuelle Knopf und der Auto-Fetch
// GENAU dieselbe Prüfung durchlaufen.
export function autoFetchProviderFor(rawUrl, configuredProviders) {
  const n = normalizeLinkUrl(rawUrl);
  if (n.error) return null;
  const p = providerFor(n.url, configuredProviders);
  return p && providerHasCredentials(p) ? p : null;
}

// Entscheidet nach einem (ggf. bereits veralteten) Auto-Fetch-Ergebnis, ob
// und wie linkForm aktualisiert wird: NUR solange das Titelfeld noch "frei"
// ist – leer ODER weiterhin der zuletzt AUTOMATISCH eingetragene Wert
// (lastAutoTitle). Ein manuell getippter Titel wird dadurch nie
// überschrieben UND nie nachträglich mit einem für den Nutzer ohnehin
// irrelevanten Fehlertext gestört. Liefert bei "nicht mehr frei" dieselbe
// linkForm-Referenz zurück (unverändert) – Aufrufer können daran erkennen,
// ob tatsächlich etwas angewendet wurde (siehe runAutoFetch unten).
export function applyAutoFetchResult(linkForm, lastAutoTitle, res) {
  if (!linkForm) return linkForm;
  const stillFree = linkForm.title.trim() === "" || linkForm.title === lastAutoTitle;
  if (!stillFree) return linkForm;
  if (res && res.ok) return { ...linkForm, title: res.title, error: null };
  return { ...linkForm, error: res ? res.reason : linkForm.error };
}

// Gliederungs-Leiste im Editor (v7.14, Nutzerwunsch "beim Editieren bleibt
// die Navigation durch lange Dokumente erhalten"): traversiert das ECHTE
// ProseMirror-Dokument (nicht den Markdown-String – der Editor bearbeitet
// laufend Nodes, ein String-Reparse wäre eine zweite, potenziell
// abweichende Quelle) und sammelt alle heading-Nodes der Level 1/2 mit
// Position, damit ein Klick per setTextSelection direkt dorthin springen
// kann. Reine, DOM-freie Funktion (kein editor/view nötig) – exportiert,
// damit Tests sie direkt gegen einen echten TipTap/ProseMirror-Doc-Baum
// prüfen können (siehe tests/docEditorOutline.test.jsx), statt die
// Traversierung im Test nachzubauen.
//
// Titel-Ausnahme (v7.14-Nachbesserung nach Code-Review, Parität zu
// markdown.jsx#parseTree): Ist der ALLERERSTE Block des Dokuments (Position
// 0 – das ProseMirror-Äquivalent zu "erste nicht-leere Zeile" in parseTree,
// da Leerzeilen im Editor-Dokument keine eigenen Knoten erzeugen) eine
// Level-1-Überschrift, ist das die Notizbuch-Titelzeile und taucht NICHT in
// der Gliederung auf – sonst würden Viewer (parseTree) und Editor
// widersprüchliche Kapitel-Listen zeigen (genau das vom Review gefundene
// Finding).
export function extractOutline(doc) {
  const items = [];
  if (!doc || typeof doc.descendants !== "function") return items;
  doc.descendants((node, pos) => {
    if (node.type.name !== "heading" || (node.attrs.level !== 1 && node.attrs.level !== 2)) return;
    if (pos === 0 && node.attrs.level === 1) return; // Titelzeile ausgenommen
    items.push({ level: node.attrs.level, text: node.textContent, pos });
  });
  return items;
}

export default function DocEditor({ initialDoc, imgMap, onSave, onCancel, saving, navWidth }) {
  const baseline = useRef(null);
  const [error, setError] = useState(null);
  const [picker, setPicker] = useState(null); // null | "color" | "highlight" | "table" | "link"
  const [tableHover, setTableHover] = useState({ r: 0, c: 0 });
  // Formularzustand des Link-Popovers (siehe openLinkPicker/applyLink
  // unten); null solange das Popover geschlossen ist.
  const [linkForm, setLinkForm] = useState(null); // { title, url, error, existing }
  // "Titel ermitteln" (v7.9): true während fetchLinkTitle läuft (Spinner im
  // Knopf, siehe fetchTitleForLink unten) – v7.12: derselbe Zustand/Spinner
  // wird auch vom automatischen Debounce-Fetch (scheduleAutoFetch/
  // runAutoFetch unten) verwendet, kein separater Lade-Indikator nötig.
  const [titleFetching, setTitleFetching] = useState(false);
  // Debounce-Zustand des Auto-Fetches (v7.12): { timer, controller } oder
  // null. Ref statt State, weil er nie gerendert wird und synchron in
  // Event-Handlern gelesen/verworfen werden muss (siehe scheduleAutoFetch).
  const titleAutoRef = useRef(null);
  // Der zuletzt AUTOMATISCH eingetragene Titel (siehe applyAutoFetchResult
  // oben) – null, solange noch keiner gesetzt wurde bzw. nach dem Öffnen/
  // Schließen des Popovers zurückgesetzt.
  const lastAutoTitleRef = useRef(null);
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
      // Generische Links (v7.8, Nutzerwunsch): autolink/linkOnPaste an – eine
      // getippte oder über eine Auswahl eingefügte http(s)-URL wird
      // automatisch verlinkt. isAllowedUri (Nachbesserung, Finding 2 des
      // Re-Reviews): die eingebaute Prüfung von @tiptap/extension-link
      // 2.27.2 lässt PER DEFAULT weit mehr als http/https zu (ftp/ftps/
      // mailto/tel/callto/sms/cid/xmpp, siehe isAllowedUri() in
      // node_modules/@tiptap/extension-link/dist/index.js) – eine getippte
      // oder eingefügte E-Mail-Adresse würde also klammheimlich einen
      // mailto:-Link erzeugen, den der Viewer (markdown.jsx, LINK_URL_RE –
      // ausdrücklich nur http(s)) danach als Klartext zeigt (kein XSS, aber
      // Editor/Viewer laufen auseinander). ctx.defaultValidate(url) ruft die
      // eingebaute Prüfung (inkl. der über "protocols" registrierten
      // Zusatz-Schemas, hier keine) unverändert auf und schränkt zusätzlich
      // auf http(s) ein; das gilt für ALLE Konsumenten von isAllowedUri
      // gleichermaßen (Autolink-Plugin, linkOnPaste-Regel, setLink/
      // toggleLink-Commands, parseHTML/renderHTML – siehe dieselbe Datei),
      // Autolink/linkOnPaste für https-URLs funktionieren dadurch
      // unverändert weiter (bestehende Tests), mailto/tel/… erzeugen jetzt
      // KEINEN Link-Mark mehr (neuer Test). openOnClick bleibt AUS: ein
      // Klick auf einen Link WÄHREND des Bearbeitens soll nicht aus dem
      // Editor navigieren – dafür gibt es den "Öffnen"-Knopf im
      // Link-Popover (Toolbar unten). Quellen-Fußnoten ([n](url)) laufen
      // über denselben Mark-Typ und müssen den Roundtrip weiterhin
      // unverändert überstehen (renumberCitations, markdown.jsx – NICHT
      // angefasst).
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        isAllowedUri: (url, ctx) => ctx.defaultValidate(url) && /^https?:/i.test(url),
      }),
      // Optische Unterscheidung Fußnote/generischer Link direkt im Editor
      // (siehe LinkDecorations oben).
      LinkDecorations,
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

  // Gliederungs-Leiste (v7.14): "editor.state.doc" als useMemo-Abhängigkeit
  // ist bereits die geforderte leichte Drosselung, ganz ohne Timer – ein
  // reiner Selektions-/Cursor-Wechsel erzeugt bei ProseMirror KEIN neues
  // doc-Objekt (nur bei tr.docChanged ändert sich die Referenz), extractOutline
  // läuft also nur bei echten Bearbeitungen erneut, nicht bei jedem Tick aus
  // onTransaction (der u. a. auch für die Toolbar-Aktivzustände feuert).
  const outline = useMemo(
    () => extractOutline(editor ? editor.state.doc : null),
    [editor && editor.state.doc] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Klick in der Gliederungs-Leiste: Cursor an den Anfang der Überschrift
  // setzen, in den sichtbaren Bereich scrollen, Fokus zurück in den Editor
  // (läuft über die TipTap-Chain-API, die intern denselben view.dispatch
  // nutzt wie ein manueller Aufruf).
  const gotoHeading = (pos) => {
    if (!editor) return;
    editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
  };

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

  // Verwirft einen wartenden (setTimeout) oder laufenden Auto-Fetch-Versuch
  // (v7.12): AbortController-Signal wird von runAutoFetch nach jedem await
  // geprüft, ein bereits verschickter fetchImpl-Request läuft zwar im
  // Hintergrund weiter, sein Ergebnis wird aber verworfen statt angewendet.
  const cancelAutoFetch = () => {
    if (titleAutoRef.current) {
      clearTimeout(titleAutoRef.current.timer);
      titleAutoRef.current.controller.abort();
      titleAutoRef.current = null;
    }
  };

  // Beim Unmount (Editor geschlossen/Notizbuch gewechselt) einen evtl. noch
  // wartenden Timer aufräumen, sonst könnte er nach dem Unmount versuchen,
  // setState auf einer nicht mehr gemounteten Komponente aufzurufen.
  useEffect(() => cancelAutoFetch, []); // eslint-disable-line react-hooks/exhaustive-deps

  const closeLinkPicker = () => {
    cancelAutoFetch();
    setPicker(null);
  };

  // Öffnet das Link-Popover und belegt Titel/URL vor: Steht der Cursor in
  // einem bestehenden Link, wird die Selektion per extendMarkRange auf die
  // GESAMTE Mark-Spanne ausgedehnt (Titel+URL kommen dann von dort, und
  // "Übernehmen" ersetzt später den kompletten alten Link statt nur einen
  // Teil davon); ist nur Text markiert (kein Link), bleibt die Auswahl wie
  // sie ist und liefert den vorbelegten Titel; ohne Auswahl bleiben beide
  // Felder leer (neuer Link wird an der Cursor-Position eingefügt).
  const openLinkPicker = () => {
    cancelAutoFetch();
    lastAutoTitleRef.current = null;
    const hadLink = editor.isActive("link");
    if (hadLink) editor.chain().focus().extendMarkRange("link").run();
    const { from, to } = editor.state.selection;
    const title = editor.state.doc.textBetween(from, to, " ");
    const url = hadLink ? editor.getAttributes("link").href || "" : "";
    setLinkForm({ title, url, error: null, existing: hadLink });
    setTitleFetching(false);
    setPicker("link");
  };

  // "Titel ermitteln" (v7.9): NUR aktiv, wenn die aktuell eingegebene URL zu
  // einem KONFIGURIERTEN Provider MIT Zugangsdaten passt (providerFor +
  // providerHasCredentials, lib/linkProviders.jsx) – ein eingebauter
  // Provider (nur Icon, kein PAT) oder ein custom-Provider (kein bekanntes
  // API) liefert hier bewusst null, der Knopf bleibt dann unsichtbar. Die
  // URL wird vorher durch normalizeLinkUrl geschickt (gleiche Normalisierung
  // wie beim Einfügen), damit z. B. eine noch ohne "https://" eingegebene
  // URL trotzdem erkannt wird; ein aktueller Normalisierungsfehler (leere
  // URL, falsches Schema) liefert schlicht keinen Provider. autoFetchProviderFor
  // (oben) kapselt GENAU dieselbe Prüfung für den Auto-Fetch (scheduleAutoFetch
  // unten) – EIN Regelwerk für beide Auslöser.
  const linkTitleProvider = linkForm ? autoFetchProviderFor(linkForm.url, getLinkProviders()) : null;

  // Fetch auf Knopfdruck (v7.9-Verhalten, bleibt als manueller Retry
  // erhalten – v7.12 löst NUR die Beschränkung "ausschließlich auf Klick"
  // ab, siehe scheduleAutoFetch unten). Ein Fehler wird in linkForm.error
  // angezeigt (bestehende Fehleranzeige im Popover), ein Erfolg füllt NUR
  // das Titelfeld – der Nutzer kann das Ergebnis vor dem Einfügen noch
  // anpassen. Ein laufender/wartender Auto-Fetch wird verworfen (der
  // manuelle Klick hat Vorrang, kein doppelter Request für dieselbe URL).
  const fetchTitleForLink = async () => {
    if (!linkTitleProvider || titleFetching) return;
    cancelAutoFetch();
    const n = normalizeLinkUrl(linkForm.url);
    if (n.error) return;
    setTitleFetching(true);
    const res = await fetchLinkTitle(n.url, linkTitleProvider);
    setTitleFetching(false);
    if (res.ok) lastAutoTitleRef.current = res.title; // ein weiterer Auto-Fetch darf ihn noch verfeinern
    setLinkForm((f) =>
      f ? (res.ok ? { ...f, title: res.title, error: null } : { ...f, error: res.reason }) : f
    );
  };

  // Auto-Fetch beim URL-Eintippen/-Einfügen (v7.12, Nutzerwunsch "egal wo
  // sie herkommt"): debounced ~600 ms (AUTO_FETCH_DEBOUNCE_MS), damit nicht
  // bei JEDEM Tastendruck ein Request rausgeht. Eine neue Eingabe verwirft
  // über cancelAutoFetch() zuverlässig einen noch wartenden/laufenden
  // vorherigen Versuch (AbortController), bevor ein neuer Timer startet.
  // Kein Timer, wenn die (normalisierte) URL zu keinem konfigurierten
  // Provider MIT Zugangsdaten passt – dann gibt es nichts zu fetchen.
  const scheduleAutoFetch = (rawUrl) => {
    cancelAutoFetch();
    const provider = autoFetchProviderFor(rawUrl, getLinkProviders());
    if (!provider) return;
    const controller = new AbortController();
    const timer = setTimeout(() => runAutoFetch(rawUrl, provider, controller), AUTO_FETCH_DEBOUNCE_MS);
    titleAutoRef.current = { timer, controller };
  };

  const runAutoFetch = async (rawUrl, provider, controller) => {
    const n = normalizeLinkUrl(rawUrl);
    if (n.error || controller.signal.aborted) return;
    setTitleFetching(true);
    const res = await fetchLinkTitle(n.url, provider);
    setTitleFetching(false);
    if (controller.signal.aborted) return; // von einer neueren Eingabe überholt
    setLinkForm((f) => {
      const next = applyAutoFetchResult(f, lastAutoTitleRef.current, res);
      if (next !== f && res.ok) lastAutoTitleRef.current = res.title;
      return next;
    });
  };

  // Ersetzt die aktuelle Selektion (bzw. fügt an der Cursor-Position ein)
  // durch einen Textknoten mit Link-Mark. extendMarkRange ist hier NOCHMAL
  // nötig (nicht nur beim Öffnen): Zwischen Öffnen und Bestätigen hat sich
  // am Dokument nichts geändert (nur Popover-Zustand), der Aufruf ist bei
  // einer reinen Text-Selektion oder ohne aktiven Link ein No-op und daher
  // gefahrlos redundant – schützt aber vor Fokus-/Selektions-Drift durch
  // Klicks in die Eingabefelder.
  const applyLink = () => {
    if (!editor || !linkForm) return;
    const t = validateLinkTitle(linkForm.title);
    if (t.error) { setLinkForm((f) => ({ ...f, error: t.error })); return; }
    const u = normalizeLinkUrl(linkForm.url);
    if (u.error) { setLinkForm((f) => ({ ...f, error: u.error })); return; }
    editor.chain().focus().extendMarkRange("link").insertContent({
      type: "text",
      text: t.title,
      marks: [{ type: "link", attrs: { href: u.url } }],
    }).run();
    cancelAutoFetch();
    setPicker(null);
    setLinkForm(null);
    setTitleFetching(false);
  };

  const removeLink = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    cancelAutoFetch();
    setPicker(null);
    setLinkForm(null);
    setTitleFetching(false);
  };

  const openLinkUrl = () => {
    const url = (linkForm?.url || "").trim();
    if (/^https?:\/\//i.test(url)) window.open(url, "_blank", "noopener");
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
        <button onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={btn(editor.isActive("heading", { level: 1 }))} title="Kapitel (#)">
          <Heading1 size={15} />
        </button>
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
            onClick={() => (picker === "link" ? closeLinkPicker() : openLinkPicker())}
            className={btn(editor.isActive("link"))}
            title="Link einfügen/bearbeiten"
          >
            <LinkIcon size={15} />
          </button>
          {picker === "link" && linkForm && (
            <div className="absolute z-10 top-full left-0 mt-1 p-3 w-72 bg-white border border-slate-200 rounded-lg shadow-lg">
              <label className="block text-xs font-medium text-slate-600 mb-0.5">Titel</label>
              <input
                type="text"
                value={linkForm.title}
                onChange={(e) => setLinkForm((f) => ({ ...f, title: e.target.value, error: null }))}
                placeholder="Sprechender Titel"
                className="w-full mb-2 px-2 py-1 text-sm border border-slate-300 rounded"
              />
              <label className="block text-xs font-medium text-slate-600 mb-0.5">URL</label>
              <input
                type="text"
                value={linkForm.url}
                onChange={(e) => {
                  const url = e.target.value;
                  setLinkForm((f) => ({ ...f, url, error: null }));
                  // Auto-Fetch beim Tippen/Einfügen (v7.12) – debounced, siehe
                  // scheduleAutoFetch oben.
                  scheduleAutoFetch(url);
                }}
                placeholder="https://…"
                className="w-full mb-2 px-2 py-1 text-sm border border-slate-300 rounded"
              />
              {linkTitleProvider && (
                <button
                  type="button"
                  onClick={fetchTitleForLink}
                  disabled={titleFetching}
                  title={"Titel automatisch von " + linkTitleProvider.name + " ermitteln"}
                  className={"mb-2 inline-flex items-center gap-1 px-2 py-1 rounded border border-indigo-200 text-indigo-700 text-xs " +
                    (titleFetching ? "opacity-50" : "hover:bg-indigo-50")}
                >
                  {titleFetching ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  Titel ermitteln
                </button>
              )}
              {linkForm.error && <div className="mb-2 text-xs text-rose-700">{linkForm.error}</div>}
              <div className="flex items-center gap-1.5">
                <button onClick={applyLink}
                  className="px-2 py-1 rounded bg-indigo-700 text-white text-xs hover:bg-indigo-800">
                  {linkForm.existing ? "Übernehmen" : "Einfügen"}
                </button>
                {linkForm.existing && (
                  <>
                    <button onClick={removeLink}
                      className="px-2 py-1 rounded border border-rose-200 text-rose-700 text-xs hover:bg-rose-50">
                      Entfernen
                    </button>
                    <button onClick={openLinkUrl}
                      className="px-2 py-1 rounded border border-slate-300 text-slate-600 text-xs hover:bg-slate-50">
                      Öffnen
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

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

      <div className="flex-1 min-h-0 flex gap-2">
        <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-indigo-300 bg-white p-3"
          onClick={() => picker && setPicker(null)}>
          <EditorContent editor={editor} />
        </div>

        {/* Gliederungs-Leiste (v7.14, Nutzerwunsch "beim Editieren bleibt
            die Navigation durch lange Dokumente erhalten"): NUR Desktop
            (md:) – mobil ist neben dem ohnehin schmalen Editor-Bereich kein
            Platz dafür, dort bleibt es wie bisher bei Toolbar+Editor ohne
            Leiste (bewusste Entscheidung, siehe DECISIONS). Gleiche
            Zweistufen-Optik wie die Dokument-Leiste (App.jsx
            sectionNavContent): Kapitel (Level 1) kräftiger, Abschnitte
            (Level 2) darunter eingerückt. Eigenständig in DocEditor
            integriert statt eine Outline-API nach App.jsx zu exponieren
            (siehe DECISIONS – hält editor/view als Implementierungsdetail
            dieser Komponente, kein neues Interface zum Elternteil nötig
            außer der reinen Breitenangabe). */}
        <nav
          style={{ "--nav-w": (navWidth || 148) + "px" }}
          className="hidden md:block md:w-[var(--nav-w)] shrink-0 overflow-y-auto py-1 pr-1"
        >
          {outline.map((item, i) => (
            // Einrückung über einen Wrapper mit Innenabstand (pl-3) statt
            // ml-3 direkt am Knopf: "w-full" bezöge sich sonst weiter auf
            // die volle Leistenbreite und würde nach rechts überstehen.
            <div key={i + item.pos} className={item.level === 2 ? "pl-3" : undefined}>
              <button
                onClick={() => gotoHeading(item.pos)}
                title={item.text || (item.level === 1 ? "Kapitel" : "Abschnitt")}
                className={"block w-full text-left truncate rounded-r-xl border border-l-0 shadow-sm mb-1.5 " +
                  (item.level === 1
                    ? "text-xs font-bold py-1.5 pl-2 pr-2 border-slate-300 bg-gradient-to-r from-slate-100 to-slate-200 text-slate-900"
                    : "text-xs py-1 pl-2 pr-2 border-slate-200 bg-gradient-to-r from-slate-50 to-slate-100 text-slate-600")}
              >
                {item.text || "(ohne Titel)"}
              </button>
            </div>
          ))}
        </nav>
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
