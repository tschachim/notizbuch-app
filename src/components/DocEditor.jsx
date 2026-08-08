import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { getHTMLFromFragment, Node, Extension, InputRule, textInputRule } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import { EditorState, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { sinkListItem, liftListItem } from "@tiptap/pm/schema-list";
import StarterKit from "@tiptap/starter-kit";
import CodeBlockExtension from "@tiptap/extension-code-block";
import Paragraph from "@tiptap/extension-paragraph";
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
  Sigma, SquareFunction, Link2 as LinkIcon, Sparkles, Loader2, GripVertical,
  IndentIncrease, IndentDecrease, ImagePlus,
} from "lucide-react";
import {
  mathToPlaceholders, renderKatexHtml, MATH_SERIALIZED_RE, MATH_INLINE_TAG, MATH_BLOCK_TAG,
  ESCAPED_DOLLAR_SENTINEL,
} from "../lib/math.jsx";
import { splitFenceSegments } from "../lib/code.jsx";
import { LINK_URL_RE, indentLevel } from "../lib/markdown.jsx";
import { FILE_URL_RE, pathToFileUrl } from "../lib/filelinks.js";
import {
  cleanupLinkTitle, providerFor, providerHasCredentials, fetchLinkTitle,
  getLinkProviders, buildProviderIconDom,
} from "../lib/linkProviders.jsx";
import { buildActiveRules } from "../lib/autocorrect.js";
import { stripInboxPlaceholder } from "../lib/ops.js";
import { ACCEPTED_IMAGE_MIME, isAcceptedImageType } from "../lib/images.js";

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
// Exportiert (v7.41 Teil B, wie unescapeMd/MdTable/… unten), damit
// tests/docEditorImages.test.jsx den kompletten save()-Pfad (inkl. der
// img:-Rückübersetzung EINGEFÜGTER Bilder) gegen die ECHTE Funktion prüfen
// kann statt eine Kopie im Test nachzubauen.
export function unresolveImgs(md, imgMap) {
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

// tiptap-markdown lässt zwischen Checklisten-Einträgen Leerzeilen – hier
// zusammengezogen. Multiline-Anker statt führendem "\n", sonst überspringt
// der Overlap bei 3+ Einträgen jede zweite Lücke.
//
// v7.41-Erweiterung (ECHTER Bug, beim Testschreiben für "Einrückungen"
// gefunden, siehe DECISIONS): Die Lookahead-Bedingung deckte bisher NUR
// "Checkliste gefolgt von Checkliste" ab. Seit TaskItem.configure({nested:
// true}) (siehe unten) sind Checklisten mit einer VERSCHACHTELTEN
// Aufzählung/Nummerierung als Kind ÜBERHAUPT ERST MÖGLICH – genau der
// Nutzer-Fall (Checkbox-Elternpunkt mit eingerückten "- "-Unterpunkten) –
// und GENAU DORT setzte tiptap-markdown/prosemirror-markdown BISHER IMMER
// eine Leerzeile: "taskList" bekommt (anders als "bulletList"/
// "orderedList", siehe tiptap-markdown/MarkdownTightLists) NIE ein
// "tight"-Attribut, der Serializer fällt beim Betreten der verschachtelten
// Liste dadurch auf seinen INTERNEN Default "tightLists:false" zurück
// (tiptap-markdown übergibt tightLists nie an den MarkdownSerializerState)
// – EGAL wie die verschachtelte Liste selbst aussieht. Ohne diese
// Erweiterung würde die Ansicht (renderBlocks, lib/markdown.jsx) die
// eingerückten Unterpunkte durch die überlebende Leerzeile als eigenen,
// ABGETRENNTEN Block zeigen statt als zusammenhängende Einrückung UNTER
// dem Checkbox-Elternpunkt. Lookahead deshalb auf JEDE Art Listenzeile
// erweitert (Aufzählung "-"/"*", Nummerierung "1.", UND weiterhin
// Checkliste "- [") – der linke Teil bleibt bewusst auf Checklisten-Zeilen
// beschränkt, da NUR taskList von diesem Tight-Defekt betroffen ist.
// Exportiert (wie unescapeMd oben), damit Tests die ECHTE Funktion prüfen.
//
// v7.41.1-Erweiterung (Blocker 2, "Listentyp eines verschachtelten Kindpunkts
// umwandeln"): convertListItemType (siehe unten) kann jetzt zwei
// aufeinanderfolgende GESCHWISTER-Unterlisten unterschiedlichen Typs
// erzeugen (z. B. eine per Umwandlung entstandene Aufzählung, gefolgt von
// der unveränderten restlichen Checkliste). Der oben beschriebene
// Tight-Defekt trifft NUR den Fall "eine Checkliste WIRD BEGONNEN" – bisher
// deckte die erste Ersetzung ausschließlich "Checkliste GEFOLGT VON X" ab
// (X beginnt NACH der Checkliste). Jetzt kann eine Checkliste auch NACH
// einer normalen Liste beginnen ("X GEFOLGT VON Checkliste") – dieselbe
// Ursache, nur mit vertauschten Rollen. Bewusst NICHT auf "beliebige Liste
// gefolgt von beliebiger Liste" verallgemeinert: Eine Aufzählung gefolgt von
// einer Nummerierung (oder umgekehrt) bleibt nachweislich tight (siehe
// Testschreiben, keine erzwungene Leerzeile dort) – eine dort vorhandene
// Leerzeile wäre echte, gewollte Nutzerformatierung und darf nicht
// verschluckt werden.
export const collapseChecklistGaps = (md) =>
  md
    .replace(/^([ \t]*- \[[ xX]\][^\n]*)\n\n(?=[ \t]*(?:[-*]\s|\d+[.)]\s))/gm, "$1\n")
    .replace(/^([ \t]*(?:[-*]\s|\d+[.)]\s)[^\n]*)\n\n(?=[ \t]*- \[[ xX]\])/gm, "$1\n");

// v7.45-Fix (Datenkorruption, E2E-Finding 🔴, siehe DECISIONS #91): Der
// Markdown-Serializer (prosemirror-markdown, "taskItem"-Node) schreibt für
// eine INHALTSLEERE Checkbox zuverlässig "[ ] " MIT einem abschließenden
// Leerzeichen (state.write("[ ] ") + renderContent() eines leeren
// Absatzes). Dieses Leerzeichen ist reiner Serializer-ZUFALL, kein
// verlässliches Signal – EmptyTaskMarkdownIt (siehe oben) macht Editor UND
// TASK_RE (lib/markdown.jsx) beim Laden bzw. Rendern bewusst UNABHÄNGIG
// davon, ob es vorhanden ist. Ohne diese Normalisierung würde ein
// bestehendes "trim()" auf das GESAMTE Dokument (App.jsx#saveEdit) das
// Leerzeichen NUR dann fressen, wenn die leere Checkbox zufällig die
// LETZTE Zeile des gesamten Dokuments ist (trim() wirkt nur an den beiden
// Enden des Gesamtstrings) – eine leere Checkbox in der Mitte behielte ihr
// Leerzeichen dagegen unverändert. Diese POSITIONSABHÄNGIGE Asymmetrie
// (Leerzeichen mal da, mal nicht, ohne fachlichen Grund) wäre unnötig
// fragil und in Diffs/Git schwer nachvollziehbar – deshalb wird das
// Leerzeichen HIER, für JEDE Position gleichermaßen, bewusst entfernt statt
// dem Zufall (bzw. App.jsx' trim()) überlassen. Nur "-" als Marker nötig
// (wie bei dropEmptyCheckboxLines unten): Der Serializer normalisiert den
// Marker ohnehin auf "-" (Markdown.configure({bulletListMarker:"-"})),
// "*" kann aus DIESEM Pfad nie kommen.
export const stripEmptyCheckboxTrailingSpace = (md) =>
  md.replace(/^([ \t]*- \[[ xX]\])[ \t]+$/gm, "$1");

// v7.41.2, Geister-Checkbox (siehe SplitMixedTaskLists oben und DECISIONS):
// zusätzliches Sicherheitsnetz in save() (siehe dort), NACH
// collapseChecklistGaps angewendet. SplitMixedTaskLists verhindert nur
// NEUE Phantome beim Laden – ein BEREITS gespeichertes Phantom (aus einem
// Dokument, das schon vor diesem Fix beschädigt wurde) bleibt davon
// unberührt: Das Phantom selbst ist ein leerer taskItem und steht als
// ERSTES Element seiner Liste – ein <ul>, dessen erstes <li> eine Checkbox
// ist, hat keinen Schema-Konflikt mehr und wird von SplitMixedTaskLists
// bewusst nicht angefasst (siehe dort). Dieser Helfer räumt solche
// Bestandsfälle beim NÄCHSTEN Speichern textuell auf: eine komplett
// INHALTSLEERE "- [ ]"/"- [x]"-Zeile ohne jeden Folgetext ist in dieser
// App nie sinnvoll UND wird verworfen.
//
// Läuft ausschließlich HIER (save()), NIEMALS während der laufenden
// Bearbeitung: eine vom Nutzer bewusst angelegte, noch leere Checkbox
// bleibt deshalb sichtbar, SOLANGE er im Editor ist (der Editor selbst,
// "editor.state.doc", wird von diesem Helfer nie berührt) – erst der
// nächste tatsächliche Speichervorgang (der ohnehin nur bei einer ECHTEN
// Änderung überhaupt läuft, siehe "md === baseline.current" in save())
// entfernt sie endgültig aus dem persistierten Text.
//
// Ausnahme 1 (WICHTIG, sonst Datenverlust): eine leere Checkbox mit
// FOLGEINHALT auf tieferer Einzugsebene ("- [ ] " als absichtlicher, nur
// noch unbeschrifteter Elternpunkt über echten Unterpunkten ODER eine
// eingerückte Fortsetzung als Absatz) bleibt stehen. Die Suche nach diesem
// Folgeinhalt überspringt dabei GENAU EINE Leerzeile (ein loses Eltern-
// Kind-Paar): Im echten save()-Pfad hat collapseChecklistGaps eine solche
// Lücke zwar bereits verdichtet (siehe oben), dieser Helfer soll aber auch
// STANDALONE korrekt bleiben (Tests, künftige Aufrufer) – ohne diesen
// Blanko-Überschlag würde "- [ ] \n\n  - Kind" das Kind verwaisen lassen
// (Review-Finding, v7.41.2 Nachbesserung).
//
// Ausnahme 2 (Review-Finding, v7.41.2 Nachbesserung, v7.45.1 WEITER
// VERENGT – siehe DECISIONS #92): NUR eine Checkbox AM ANFANG eines
// Listenblocks gilt überhaupt als Phantom-KANDIDAT. Gemessen (v7.41.1 wie
// v7.41.2): Phantome entstehen AUSSCHLIESSLICH als ERSTES Element ihres
// (ggf. bereits mehrfach akkumulierten) Listenblocks – nie als zweiter/
// mittlerer/letzter Punkt. "Zeile anlegen und später ausfüllen" ist
// dagegen ein Alltagsfall (Enter am Ende eines Checklistenpunkts legt
// GENAU so einen neuen, noch leeren Punkt an) – OHNE diese Bedingung würde
// die Funktion genau das lautlos wieder löschen. "Blockanfang" heißt
// konkret: die zuvor bereits entschiedene (in "out" landende) Zeile davor
// ist entweder leer/nicht vorhanden ODER selbst KEINE Listenzeile – "out"
// statt der rohen "lines" als Bezugspunkt, damit mehrere KASKADIERENDE
// Phantome (das erste bereits entfernt) den Status des nächsten nicht
// verfälschen. Bewusst NICHT zusätzlich auf die Einrückung des Vorgängers
// geprüft (ein Vorgänger auf JEDER Einrückungstiefe zählt als
// "Geschwister vorhanden") – siehe DECISIONS für die Abwägung: eine
// striktere, einrückungssensitive Variante würde zusätzlich einen
// verschachtelten ERSTEN, absichtlich leeren Kindpunkt (z. B. "- Eltern\n
// - [ ] ", noch nichts eingetippt) fälschlich löschen – genau die stille
// Inhalts-Löschung, die diese Nachbesserung verhindern soll. Bewusst
// akzeptierte Grenze: Ein BEREITS bestehendes Phantom, das GENAU an dieser
// Stelle (verschachtelter erster Kindpunkt, direkt nach seinem Elternpunkt)
// in einem Bestandsdokument steht, heilt dieses Sicherheitsnetz NICHT
// automatisch – von SplitMixedTaskLists (verhindert NEUE Fälle beim Laden)
// abgesehen bräuchte das eine Positionsinformation, die aus reinem Text
// nicht mehr zuverlässig von echtem Nutzerinhalt zu unterscheiden ist.
//
// Ausnahme 3 (v7.45.1 NEU, siehe DECISIONS #92): "Blockanfang" (Ausnahme 2)
// allein reicht seit v7.45 NICHT MEHR als Phantom-Signal – seit
// EmptyTaskMarkdownIt (siehe dort) ist eine bewusst leer gelassene Checkbox
// AUSDRÜCKLICHER, legitimer Nutzerinhalt, auch als ERSTER Punkt einer
// Liste ("Checklisten-Knopf drücken, ersten Punkt noch leer lassen,
// speichern" – GENAU der vom Nutzer gemeldete Fall). Ein TATSÄCHLICHES
// Bestands-Phantom hat aber eine ZUSÄTZLICHE, eindeutige Signatur: Es
// entstand IMMER aus "gewöhnliche Stichpunktliste GEFOLGT von einer
// Checkliste MIT DEMSELBEN Marker" (siehe SplitMixedTaskLists oben) – der/
// die Phantom-Punkt(e) steht/stehen deshalb IMMER unmittelbar VOR einer
// ECHTEN Nicht-Checkbox-Listenzeile (nie vor einer weiteren Checkbox MIT
// Text, nie am Ende eines Abschnitts/Dokuments ohne jede Folgezeile – die
// Geister-Checkbox-Lücke griff laut Ursachenanalyse nur, wenn die
// zusammengeführte Liste tatsächlich gemischten Inhalt hatte). Ein Lauf
// aus einer oder mehreren leeren Checkbox-Zeilen am Blockanfang gilt
// deshalb NUR NOCH dann als Phantom, wenn nach dem Überspringen ALLER
// direkt aufeinanderfolgenden leeren Checkbox-/Leerzeilen tatsächlich eine
// ECHTE Nicht-Checkbox-Listenzeile folgt (`isPhantomWitness` unten) – fehlt
// diese Folgezeile (Abschnitts-/Dokumentende) oder folgt stattdessen eine
// WEITERE Checkbox (mit oder ohne Text), bleibt die Zeile stehen. Aktiv
// geprüft (siehe DECISIONS #92 und Tests): Die historische Phantom-
// Erzeugung kann strukturell NIE "Phantom, gefolgt von einer weiteren
// echten Checkbox" erzeugen ("Checkliste zuerst" ist laut
// SplitMixedTaskLists-Ursachenanalyse nie betroffen) – die Verengung
// verliert dadurch KEINEN realen Bestandsfall. Im Review zu v7.45.1
// zusätzlich empirisch belegt: 13 über den HISTORISCHEN Erzeugungspfad
// konstruierte Phantom-Konstellationen (inkl. "*"-Marker, leerer Bullet
// als Nachbar, verschachtelt, über Abschnittsgrenzen, dreifach
// akkumuliert) – in KEINER folgte auf ein Phantom eine Checkbox-Zeile.
//
// Zwei Randbedingungen, die diese Begründung NICHT abdeckt (Review-🔵,
// damit die nächste Änderung hier nicht von einer Garantie ausgeht, die
// es nicht gibt):
//  (a) Die Signatur setzt voraus, dass der ZEUGE noch da ist. Wird ein
//      Altdokument von Hand so bearbeitet, dass die Nicht-Checkbox-Zeile
//      verschwindet, bleibt das Phantom dauerhaft stehen. Folgenlos, weil
//      es dann von einer seit v7.45 legitimen leeren Checkbox nicht mehr
//      unterscheidbar IST – aber die Heilung greift dort nicht mehr.
//  (b) Diese Ausnahme greift ohnehin erst NACH Ausnahme 2: Das bekannte,
//      seit v7.41.2 dokumentierte verschachtelte Bestands-Phantom
//      ("- Eltern" / "  - [ ]" / "  - Kind") scheitert bereits an
//      "startsBlock", NICHT am fehlenden Zeugen – der wäre dort sogar
//      vorhanden.
const BARE_EMPTY_CHECKBOX_RE = /^([ \t]*)- \[[ xX]\][ \t]*$/;
const CHECKBOX_LINE_RE = /^[ \t]*[-*]\s+\[[ xX]\]/;
export const dropEmptyCheckboxLines = (md) => {
  const lines = md.split("\n");
  const isListLine = (l) => /^[ \t]*(?:[-*]\s|\d+[.)]\s)/.test(l);
  // Siehe "Ausnahme 3" oben: Phantom-Signatur ist "… gefolgt von einer
  // ECHTEN Nicht-Checkbox-Listenzeile", NICHT irgendeine Folgezeile.
  const isPhantomWitness = (l) => l !== undefined && isListLine(l) && !CHECKBOX_LINE_RE.test(l);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = BARE_EMPTY_CHECKBOX_RE.exec(line);
    if (m) {
      const indent = m[1].length;
      // Folgeinhalt: direkt nächste Zeile, oder (loses Paar) eine Zeile
      // NACH übersprungenen Leerzeilen – siehe "Ausnahme 1". BELIEBIG viele
      // Leerzeilen statt genau einer (🔵 des Delta-Reviews): im echten
      // save()-Pfad ein No-op (tiptap-markdown setzt zwischen Blöcke
      // höchstens EINE Leerzeile, collapseChecklistGaps verdichtet
      // zusätzlich), macht die exportierte Funktion aber auch bei roher,
      // nicht vorbereinigter Eingabe eingabetolerant – sonst verwaiste
      // "- [ ] \n\n\n  - Kind" das Kind.
      let childIdx = i + 1;
      while (lines[childIdx] === "") childIdx++;
      const child = lines[childIdx];
      const childIndent = child !== undefined ? /^[ \t]*/.exec(child)[0].length : -1;
      const hasChild = child !== undefined && child.trim() !== "" && childIndent > indent;
      // Blockanfang: siehe "Ausnahme 2".
      const prev = out.length ? out[out.length - 1] : "";
      const startsBlock = prev.trim() === "" || !isListLine(prev);
      if (!hasChild && startsBlock) {
        // Phantom-Zeuge (siehe "Ausnahme 3"): über die GESAMTE Serie
        // direkt aufeinanderfolgender Leerzeilen UND weiterer, ebenfalls
        // leerer Checkbox-Zeilen hinweg nach vorn schauen (nicht nur die
        // unmittelbar nächste Zeile) – sonst würde bei mehreren
        // KASKADIERENDEN Phantomen ("- [ ]\n- [ ]\n- [ ]\n- Notiz") schon
        // der zweite Phantom (seine direkt nächste Zeile ist ja noch ein
        // weiterer Phantom, keine "echte" Zeile) fälschlich als
        // NICHT-Phantom gewertet.
        let w = i + 1;
        while (lines[w] === "" || BARE_EMPTY_CHECKBOX_RE.test(lines[w])) w++;
        if (isPhantomWitness(lines[w])) {
          // Die Zeile selbst UND eine EINZELNE direkt folgende Leerzeile
          // überspringen (sonst bliebe eine doppelte Leerzeile zurück,
          // falls das Phantom vom nächsten Block per Leerzeile abgesetzt
          // war).
          if (lines[i + 1] === "") i++;
          continue;
        }
      }
    }
    out.push(line);
  }
  return out.join("\n");
};

// Einzug für Nicht-Listen-Blöcke (v7.41, Auftrag "Einrückungen"): Markdown/
// ProseMirror kennen dafür keine Struktur (anders als Listen, deren Einzug
// über Verschachtelung/sinkListItem läuft, siehe changeIndent unten) – ein
// frei stehender Absatz/ein Bild braucht deshalb ein eigenes "indent"-
// Attribut (0-6, dieselbe Konvention wie indentLevel in lib/markdown.jsx).
// Gemeinsamer Helfer für Paragraph UND BlockImage, damit beide exakt
// dieselbe Klemmung/dasselbe HTML-Attribut verwenden.
function parseIndentAttr(el) {
  const n = parseInt(el.getAttribute("data-indent") || "0", 10);
  return Number.isFinite(n) ? Math.min(6, Math.max(0, n)) : 0;
}
const indentAttrSpec = {
  default: 0,
  parseHTML: parseIndentAttr,
  renderHTML: (attrs) => (attrs.indent ? { "data-indent": attrs.indent } : {}),
};

// StarterKits eingebauter paragraph-Node bleibt deaktiviert (siehe
// StarterKit.configure() unten, analog codeBlock/FencedCodeBlock) –
// IndentParagraph ersetzt ihn unter demselben Node-Namen ("paragraph") nur
// um "indent" ergänzt. NUR TOP-LEVEL-Absätze tragen ein sinnvolles
// indent-Attribut: ein Absatz INNERHALB eines Listenpunkts bekommt seinen
// Einzug bereits durch die Listen-Verschachtelung selbst (siehe
// IndentMarkdownIt weiter unten, Tiefenprüfung beim Laden) – "kein
// doppelter Einzug" (Auftrag).
export const IndentParagraph = Paragraph.extend({
  addAttributes() {
    return { ...this.parent?.(), indent: indentAttrSpec };
  },
  addStorage() {
    return {
      markdown: {
        // Wie der prosemirror-markdown-Standardserializer für Absätze
        // (state.renderInline + state.closeBlock), nur mit vorangestelltem
        // Einzug – state.write() vor renderInline schreibt die Leerzeichen
        // an den Anfang der Zeile, OHNE die Escape-Logik von renderInline
        // zu berühren.
        serialize(state, node) {
          state.write("  ".repeat(node.attrs.indent || 0));
          state.renderInline(node);
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

// tiptap-markdown serialisiert Bilder mit dem Inline-Serializer von
// prosemirror-markdown – ohne closeBlock klebt die Folgezeile direkt an der
// Bildzeile und die App-Konvention „![…](img:…) allein auf einer Zeile“
// (IMG_LINE_RE) bricht. Eigener Block-Serializer behebt das; allowBase64 ist
// Pflicht, weil die Parse-Regel sonst keine data:-URLs übernimmt und die von
// resolveImgs aufgelösten Bilder beim Öffnen aus dem Inhalt fielen.
// Größenänderung per Maus: Die Breite wird als "|w<px>"-Suffix im Alt-Text
// persistiert (![Titel|w320](img:…)) – Markdown hat kein width-Attribut,
// und nur der Alt-Text übersteht Roundtrip UND den zeilenbasierten Renderer.
export const BlockImage = Image.extend({
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
      // Einzug (v7.41): landet HIER auf dem Bild-NODE, weil ProseMirror den
      // block-level Bild-Node beim Laden aus seinem umschließenden <p>
      // heraushebt (siehe IndentMarkdownIt weiter unten) – ein Attribut am
      // <p> selbst ginge für einen reinen Bild-Absatz verloren.
      indent: indentAttrSpec,
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          const suffix = node.attrs.width ? "|w" + node.attrs.width : "";
          const prefix = "  ".repeat(node.attrs.indent || 0);
          state.write(prefix + "![" + state.esc(node.attrs.alt || "") + suffix + "](" + node.attrs.src + ")");
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
        // Einzug SOFORT sichtbar (v7.42, Auftrag "Einzug im Editor sichtbar
        // machen"): Diese NodeView baut ihr DOM selbst und ruft renderHTML()
        // NIE auf – "data-indent" (indentAttrSpec.renderHTML) käme dadurch
        // NIE im echten Editor-DOM an, ProseMirror nutzt bei einer NodeView
        // ausschließlich deren eigenes "dom" statt des Schema-toDOM. Das
        // Attribut wird deshalb explizit auf den Wrapper gespiegelt – die
        // generische "[data-indent]"-Regel in index.css greift dadurch auch
        // hier, und weil apply() sowohl beim Erzeugen ALS AUCH aus update()
        // (siehe unten) läuft, wirkt eine Änderung sofort, ohne Neuaufbau.
        if (cur.attrs.indent) wrap.setAttribute("data-indent", String(cur.attrs.indent));
        else wrap.removeAttribute("data-indent");
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
//
// v7.46-Fix (Datenkorruption, ECHTER Bug, "Escaptes Pipe in einer
// Tabellenzelle: Inhalt geht verloren", mehrzyklisch bis zum Totalzerfall
// der Tabelle in EINEN einzigen Absatz): Ursache GENAU eingegrenzt (Auftrag:
// "markdown-it-Tabellenregel vs. gerendertes HTML vs. MdTable-Parse-Pfad")
// – keiner der drei, sondern eine Lücke GENAU HIER im SERIALIZER, in der
// "state.esc"-Ergänzung oben. markdown-its GFM-Tabellenregel selbst löst
// "\|" schon IMMER korrekt auf (rules_block/table.mjs#escapedSplit) UND
// GENAU wie GFM es verlangt sogar innerhalb eines Codespans (offizielles
// GFM-Spec-Beispiel: "`\|`" in einer Zelle rendert zu "<code>|</code>" –
// bewusst OHNE Backslash, siehe Test) – das LADEN war nie das Problem.
// Die Lücke liegt beim erneuten SPEICHERN GENAU eines solchen Codespans:
// prosemirror-markdown behandelt den "code"-Mark mit "escape:false"
// (node_modules/prosemirror-markdown/src/to_markdown.ts, MarkSerializerSpec)
// – für Text INNERHALB eines Codespans ruft "state.renderInline()" NIE
// "state.esc()" auf (dort Zeile ~388: der komplette String aus öffnenden/
// schließenden Backticks + Roh-Text wird direkt über "state.text(str,
// false)" geschrieben) – der obige "state.esc"-Patch, der "|" sonst in
// JEDER Zelle zuverlässig maskiert, greift für einen Codespan-Inhalt
// deshalb NIE. Ein im Editor getippter ODER – wie hier – beim GFM-
// spec-konformen Laden aus "`\|`" entstandener roher Pipe INNERHALB eines
// Codespans landet dadurch beim Speichern UNMASKIERT in der Tabellenzeile.
// Bis zum NÄCHSTEN Laden ist optisch nichts falsch (der Codespan zeigt
// weiterhin "|") – aber genau dieses ungemaskierte "|" trennt beim
// erneuten Öffnen (markdown-its Tabellenregel kennt beim Zeilen-Split noch
// KEINE Codespans, das läuft strukturell VOR der Inline-Erkennung) die
// Zelle in eine zusätzliche Spalte auf; über weitere Speicher-Zyklen
// wächst die Spaltenzahl gegen die Kopfzeile, bis markdown-it die Zeile(n)
// gar nicht mehr als gültige GFM-Tabelle erkennt und der gesamte Block zu
// einem einzigen, nicht mehr tabellarischen Absatz zusammenfällt (siehe
// Test "mehrzyklischer Nachweis").
//
// Fix: zusätzlich zu "state.esc" auch "state.text" patchen (state.text ist
// die Stelle, über die JEDE Textausgabe läuft – ESCAPE:TRUE ODER FALSE),
// aber NUR für den escape===false-Fall (escape:true bleibt unverändert:
// der bereits gepatchte state.esc greift dort weiterhin wie bisher, ein
// zusätzlicher Pipe-Ersatz HIER würde sonst doppelt maskieren, "a\|b" also
// fälschlich zu "a\\|b"). Bewusst NICHT auf den "code"-Mark beschränkt
// (state.text kennt beim Schreiben keinen Mark-Kontext mehr) – JEDES
// "|" in JEDEM mit escape:false geschriebenen Text INNERHALB einer
// Tabellenzeile (state.inTable) wird maskiert. Trifft aktuell praktisch nur
// Codespans (der einzige Mark mit escape:false, siehe oben) und die
// öffnenden/schließenden Markdown-Sequenzen anderer Marks (**, *, [...](),
// die selbst nie ein "|" enthalten, also folgenlos) – ein Pipe in einer
// LINK-URL/einem -Titel INNERHALB einer Tabellenzelle wird als Nebeneffekt
// gleich mit abgesichert (vorher ebenfalls unmaskiert, aber außerhalb des
// hier verlangten Testumfangs).
const cellHasSpan = (cell) => cell.attrs.colspan > 1 || cell.attrs.rowspan > 1;
// Ein Absatz OHNE jeden sichtbaren Inhalt (auch ein reiner harter
// Zeilenumbruch zählt NICHT als Inhalt, siehe unten) ist beim Aufspalten
// eines Absatzes rund um ein eingefügtes Block-Atom (Bild/Formel, siehe
// INLINE_ATOM_TYPES) ein reines EINFÜGE-ARTEFAKT – ProseMirror lässt links
// bzw. rechts vom neu eingefügten Atom einen leeren Rest-Absatz stehen,
// wenn dort vorher kein bzw. kein weiterer Text stand. Für die
// Pipe-Zeilen-Serialisierung MUSS ein solcher Absatz wie "nicht vorhanden"
// behandelt werden – sonst würde state.renderInline() bei einem reinen
// Zeilenumbruch (Umschalt+Enter in einer sonst leeren Zelle) einen echten
// Zeilenumbruch MITTEN in die Pipe-Zeile schreiben und die Tabelle beim
// nächsten Öffnen zerreißen (Review-Vorschlag 7, gefunden beim
// MdTable-Bugfix für Formel-Zellen). Ehemals "cellHasRenderableContent"
// (prüfte nur "cell.firstChild") – v7.48-Nachbesserung verallgemeinert auf
// EINEN BELIEBIGEN Absatz-Node, weil eine Zelle jetzt MEHRERE Absätze rund
// um ein Atom haben kann (siehe cellChildrenInlineable/gfmSerializable
// unten), nicht mehr nur "cell.firstChild".
function paragraphHasRenderableContent(p) {
  if (!p || p.childCount === 0) return false;
  let has = false;
  p.forEach((child) => {
    if (child.type.name !== "hardBreak") has = true;
  });
  return has;
}
// v7.47-Fix (Datenkorruption, ECHTER Bug, "Bild/Formel als EINZIGER Inhalt
// einer Tabellenzelle geht beim Speichern verloren"): BlockImage UND
// MathBlock sind beide group:"block" (siehe Kommentare dort) – eine Zelle,
// deren kompletter Inhalt NUR aus einem solchen Block-Atom besteht, hat
// dadurch GAR KEINEN umschließenden Absatz mehr: Entweder weil markdown-it
// Zelleninhalt ohnehin nie in ein <p> wrapt (Bild direkt beim Laden aus
// rohem "| ![…](img:x) |") oder weil tiptap-markdowns normalizeBlocks
// (MarkdownParser.js#extractElement) den nach dem Herausheben leeren <p>
// komplett entfernt (Text+Bild-Fall, siehe unten). "cell.childCount > 1"
// (Fall: Bild MIT Text davor/danach) griff bereits vorher richtig – die
// Lücke war GENAU der Fall "childCount === 1, aber dieses eine Kind ist
// kein Absatz, sondern das Bild-/Formel-Atom selbst" – der Inhalt fiel beim
// Speichern lautlos weg (siehe tests/docEditorTableBlockCells.test.jsx,
// aktiv als rot verifiziert).
// v7.47 hat das über den HTML-Fallback (getHTMLFromFragment) gelöst – DAS
// war zwar am SPEICHER-Pfad korrekt (kein Datenverlust mehr), aber eine
// SACKGASSE für die Dokument-ANSICHT: renderTable/renderBlocks (markdown.jsx)
// verstehen ausschließlich das GFM-Pipe-Format, rohes Block-HTML fällt dort
// in den normalen Absatz-Zweig und erscheint als sichtbarer HTML-Text –
// STATT eines verlorenen Bildes verschwand plötzlich die GANZE TABELLE aus
// der Ansicht (E2E-Finding 🔴, v7.48-Auftrag). Geprüft: die Ansicht konnte
// diesen HTML-Fallback zu KEINEM Zeitpunkt rendern (auch nicht vor v7.47) –
// er kam vor v7.47 nur extrem selten zum Zug (Merge-Zellen/mehrere Absätze,
// praktisch nur per Copy&Paste erreichbar), v7.47 hat ihn für den ALLTÄGLICHEN
// Fall "Bild/Formel per Toolbar-Knopf in eine Zelle" erreichbar gemacht und
// damit den Sichtbarkeitsbruch zum ersten Mal in der Praxis ausgelöst (siehe
// DECISIONS für den vollständigen Vergleich, dieser Eintrag ersetzt den
// v7.47-Eintrag).
//
// v7.48-Fix, Review-Nachbesserung: Der ERSTE v7.48-Fix deckte NUR eine
// Zelle ab, deren EINZIGER Inhalt ein Bild-/Formel-Atom war
// (childCount === 1) – fügt der Nutzer ein Bild/eine Formel dagegen in eine
// Zelle ein, die BEREITS Text enthält (z. B. Cursor hinter "b", dann
// Formel-Knopf), spaltet ProseMirror den umschließenden Absatz auf (das
// Atom ist group:"block") – die Zelle hat danach MEHRERE Kinder (ein oder
// zwei Absatz-FRAGMENTE plus das Atom, je nach Cursor-Position auch mit
// leeren Fragmenten als Einfüge-Artefakt, siehe paragraphHasRenderableContent
// oben). "cell.childCount > 1" schickte JEDE dieser Varianten unverändert in
// den HTML-Fallback – für den Nutzer optisch derselbe Effekt wie der
// ursprünglich gemeldete Blocker (Tabelle zeigt weder Bild noch Formel).
//
// Fix: eine Zelle bleibt GFM-Pipe-darstellbar, wenn (a) JEDES Kind entweder
// ein Absatz ODER ein unterstütztes Atom ist (cellChildrenInlineable) UND
// (b) entweder MINDESTENS EIN Atom enthalten ist (dann dürfen beliebig viele
// Absatz-FRAGMENTE drumherum stehen – sie sind Bruchstücke EINER
// ursprünglich zusammenhängenden Zeile, die durchs Einfügen des Block-Atoms
// auseinandergerissen wurde) ODER (c) es höchstens einen EINZIGEN
// nicht-leeren Absatz gibt (der unveränderte Normalfall bzw. die triviale
// leere Zelle). Diese Unterscheidung bleibt bewusst SCHARF gegen "echte"
// mehrere Absätze OHNE jedes Atom (nur per Paste erreichbar, siehe Test
// "zwei Absätze in derselben Zelle") – dort bleibt der HTML-Fallback
// bestehen: zwei komplett eigenständige Absätze (kein Atom hat sie je
// auseinandergerissen) sind keine Bruchstücke EINER Zeile, sondern echte,
// eigene Zeilen – eine GFM-Pipe-Zelle ist aber strukturell IMMER genau eine
// Zeile.
const INLINE_ATOM_TYPES = new Set(["image", "mathBlock"]);
function cellChildrenInlineable(cell) {
  let ok = true;
  cell.forEach((child) => {
    if (child.type.name !== "paragraph" && !INLINE_ATOM_TYPES.has(child.type.name)) ok = false;
  });
  return ok;
}
function gfmSerializable(table) {
  let ok = true;
  table.forEach((row, _o, i) => {
    row.forEach((cell) => {
      const headerOk = i === 0
        ? cell.type.name === "tableHeader"
        : cell.type.name !== "tableHeader";
      let hasAtom = false;
      let nonEmptyParagraphs = 0;
      cell.forEach((child) => {
        if (INLINE_ATOM_TYPES.has(child.type.name)) hasAtom = true;
        else if (child.type.name === "paragraph" && paragraphHasRenderableContent(child)) nonEmptyParagraphs++;
      });
      const cellOk = cellChildrenInlineable(cell) && (hasAtom || nonEmptyParagraphs <= 1);
      if (!headerOk || cellHasSpan(cell) || !cellOk) ok = false;
    });
  });
  return ok;
}
// v7.48 (Review-Nachbesserung): Ein rohes "|" IM TeX einer Formel würde die
// Pipe-Tabellenzeile in eine zusätzliche Spalte auftrennen. Ein generisches
// "\|"-Escaping (wie bei normalem Zelltext) ist HIER aber NICHT sicher: "\|"
// ist in LaTeX selbst ein bedeutungstragender Befehl (Parallelstriche-
// Notation "‖") – ein automatisches Escaping würde eine informell getippte
// Betrags-Formel wie "|x|" beim nächsten Laden STILL in eine andere Formel
// verwandeln (schlimmer als das seltene, bereits dokumentierte Rand-Risiko).
// Stattdessen "\vert" – mit KaTeX empirisch geprüft (siehe DECISIONS):
// "\vert" rendert VISUELL IDENTISCH zu "|", auch bei mehreren/
// verschachtelten Vorkommen ("||x||" → "\vert\vert x\vert\vert"), enthält
// aber kein rohes Pipe-Zeichen mehr. Nur INNERHALB einer Tabellenzelle
// angewendet (state.inTable) – außerhalb bleibt "|" im TeX unangetastet
// (kein Grund, dort von der 1:1-Formel-Notation abzuweichen).
//
// Trennzeichen NUR vor einem direkt folgenden BUCHSTABEN (TeX-Control-Words
// wie "\vert" verschlucken jeden unmittelbar folgenden Buchstaben als Teil
// DESSELBEN Befehlsnamens – "\vertx" würde als (undefiniertes) Makro
// "\vertx" interpretiert, siehe TeX-Tokenisierung). Vor allem anderen
// (Ziffer, Symbol, Backslash, Zeilenende) KEIN Trennzeichen – wichtig am
// ZEILENENDE: Der eigene Formel-Viewer (MATH_TOKEN_RE, math.jsx) erkennt
// "$…$" nur, wenn das Zeichen UNMITTELBAR vor dem schließenden "$" KEIN
// Leerzeichen ist – ein "\vert " (mit Leerzeichen) direkt vor dem
// schließenden "$" hätte die Formel für die eigene Ansicht unsichtbar
// gemacht (Review-Nachbesserung: aktiv als rot verifiziert, siehe Bericht).
function texSafeForTableCell(tex) {
  return String(tex ?? "").replace(/\|/g, (m, offset, str) =>
    /[a-zA-Z]/.test(str[offset + 1] || "") ? "\\vert " : "\\vert"
  );
}
// Schreibt ein Bild-/Formel-Atom als eigenständiges Kind einer Zelle inline
// in die laufende Pipe-Zeile (siehe Kopfkommentar oben). Wird NUR für die
// beiden in INLINE_ATOM_TYPES gelisteten Typen aufgerufen – gfmSerializable
// hat jeden anderen Atomtyp bereits vorher in den HTML-Fallback geschickt,
// ein "sonst"-Zweig ist hier deshalb nicht erreichbar.
// "state.esc" ist zum Aufrufzeitpunkt bereits die pipe-maskierende Variante
// (siehe MdTable-Serializer, try-Block) – ein "|" im Alt-Text ODER im
// "|wNNN"-Breitensuffix wird dadurch GENAUSO maskiert wie ein "|" in
// normalem Zelltext (splitRow, markdown.jsx, löst "\|" beim Lesen wieder
// korrekt auf).
function writeInlineAtom(state, atom) {
  if (atom.type.name === "image") {
    const suffix = atom.attrs.width ? "|w" + atom.attrs.width : "";
    state.write("![" + state.esc((atom.attrs.alt || "") + suffix) + "](" + atom.attrs.src + ")");
  } else {
    // mathBlock: siehe Kopfkommentar - bewusst als INLINE-Formel ($…$),
    // NICHT als abgesetzter Block ($$…$$). texSafeForTableCell schützt vor
    // einem rohen "|" im TeX (siehe dort).
    state.write("$" + texSafeForTableCell(atom.attrs.tex) + "$");
  }
}
// Rendert EIN Kind der Zelle (Absatz oder Atom) in einen ISOLIERTEN Puffer
// und liefert dessen Text zurück, statt ihn direkt in state.out zu
// schreiben. Nötig, weil renderCellChildrenInline (unten) mehrere Kinder zu
// EINER Pipe-Zeile zusammenfügen und dabei selbst über Trennzeichen
// entscheiden muss – state.out/state.delim werden dafür temporär
// getauscht: OHNE das Leeren von state.delim würde state.write() bei einer
// Zelle INNERHALB eines eingerückten Listenpunkts (state.delim ist dort der
// Einzug-Präfix) den Einzug-Präfix fälschlich in die Mitte der Pipe-Zeile
// schreiben, weil ein frisch geleerter Puffer für state.atBlank() wie ein
// echter Zeilenanfang aussieht.
function captureCellFragment(state, fn) {
  const prevOut = state.out;
  const prevDelim = state.delim;
  state.out = "";
  state.delim = "";
  fn();
  const result = state.out;
  state.out = prevOut;
  state.delim = prevDelim;
  return result;
}
// Baut den GFM-Pipe-Text einer als inline-darstellbar erkannten Zelle
// (siehe gfmSerializable) aus IHREN EINZELNEN Kindern zusammen: jeder
// nicht-leere Absatz liefert seinen renderInline-Text, jedes Bild-/
// Formel-Atom seine writeInlineAtom-Form – komplett LEERE Absätze (reine
// Einfüge-Artefakte, siehe paragraphHasRenderableContent) tragen NICHTS
// bei, auch keinen Trenner. BUGFIX (v7.3, beim Einbau der Formel-Nodes
// gefunden, unverändert relevant): Die ursprüngliche Prüfung
// "cell.firstChild.textContent.trim()" ist für ein Inline-ATOM ohne Text
// (textContent liefert bei Atomen immer "") fälschlich falsy –
// paragraphHasRenderableContent/INLINE_ATOM_TYPES erkennen "hat überhaupt
// sichtbaren Inhalt" korrekt für Text UND Atome.
//
// Zwischen zwei entstandenen Fragmenten wird GENAU DANN ein zusätzliches
// Leerzeichen eingefügt, wenn WEDER das Ende des vorigen NOCH der Anfang
// des nächsten Fragments bereits Whitespace ist – ohne das würde ein direkt
// hinter den Cursor eingefügtes Bild/eine Formel ohne jeden Trenner am Text
// kleben (z. B. "b![…]" statt "b ![…]"), WEIL ProseMirror beim Aufspalten
// des Absatzes von sich aus KEIN Leerzeichen einfügt (empirisch verifiziert:
// Cursor direkt hinter "b", Formel eingefügt → Absatz-Rest bleibt
// wortwörtlich "b", ohne Leerzeichen). Bereits vorhandener Whitespace (der
// Nutzer hat z. B. "vor " mit Leerzeichen getippt, bevor das Bild
// eingefügt wurde) bleibt dagegen unangetastet – kein unnötiges
// Doppel-Leerzeichen im Normalfall.
function renderCellChildrenInline(state, cell) {
  const fragments = [];
  cell.forEach((child) => {
    let text = null;
    if (child.type.name === "paragraph") {
      if (paragraphHasRenderableContent(child)) {
        text = captureCellFragment(state, () => state.renderInline(child));
      }
    } else if (INLINE_ATOM_TYPES.has(child.type.name)) {
      text = captureCellFragment(state, () => writeInlineAtom(state, child));
    }
    if (text !== null) fragments.push(text);
  });
  let joined = "";
  for (const frag of fragments) {
    if (joined && !/\s$/.test(joined) && !/^\s/.test(frag)) joined += " ";
    joined += frag;
  }
  state.write(joined);
}
// Exportiert (Re-Review-Finding R3), damit der Roundtrip-Test die ECHTE
// Erweiterung importiert statt gfmSerializable/renderCellChildrenInline im
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
          // v7.46-Fix (siehe Kopfkommentar oben): state.text() zusätzlich
          // patchen, aber NUR für escape===false – dieser Pfad umgeht
          // state.esc() komplett (Codespans, escape:false) und blieb ohne
          // diesen Patch ungeschützt.
          const text = state.text.bind(state);
          state.text = (str, escapeArg) =>
            text(escapeArg === false ? String(str).replace(/\|/g, "\\|") : str, escapeArg);
          try {
            node.forEach((row, _o, i) => {
              state.write("| ");
              row.forEach((cell, _o2, j) => {
                if (j) state.write(" | ");
                // v7.48: JEDES Kind der Zelle einzeln behandeln (Absatz-
                // Fragmente UND Bild-/Formel-Atome in beliebiger Mischung,
                // siehe gfmSerializable/renderCellChildrenInline oben) statt
                // nur "cell.firstChild" – ersetzt sowohl den einfachen
                // Ein-Absatz-Fall als auch den bare-Atom-Fall einheitlich.
                renderCellChildrenInline(state, cell);
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
            state.text = text;
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
//
// v7.46-Fix (Datenkorruption, ECHTER Bug, "Codeblock in einem Listenpunkt
// wächst bei jedem Speichern"): "parse: {}" (bis v7.45.1) übernahm KEINEN
// der beiden "parse"-Hooks, die tiptap-markdowns EIGENE codeBlock-Node
// (node_modules/tiptap-markdown/src/extensions/nodes/code-block.js)
// mitbringt – FencedCodeBlock ERSETZT diese Node komplett (gleicher
// Node-Name "codeBlock", siehe StarterKit.configure({codeBlock:false}) im
// useEditor()-Aufbau unten), das ORIGINAL wird dadurch nie mehr in die
// Extensions-Liste aufgenommen und sein "updateDOM"-Hook lief nie mehr mit.
// Ursache, GENAU eingegrenzt (Auftrag: "Zusammenspiel Listen-Serializer +
// FencedCodeBlock-Serializer und/oder Fence-Erkennung beim Wiedereinlesen"
// – es ist KEINS von beiden, sondern der HTML->ProseMirror-PARSE-Schritt
// dazwischen): markdown-it rendert einen Zaun laut CommonMark IMMER als
// "<pre><code>Inhalt\n</code></pre>" – das eine "\n" direkt vor "</code>"
// ist ein STRUKTURELLES Artefakt des Zeilen-Zusammenbaus (state.getLines
// mit keepLastLF:true, node_modules/markdown-it/lib/rules_block/fence.mjs)
// und steht dort IMMER, unabhängig davon, ob die Quelle vor dem Schluss-
// Zaun eine echte Leerzeile hatte oder nicht (siehe DECISIONS für die
// Herleitung: 0 Leerzeilen -> "Inhalt\n", 1 Leerzeile -> "Inhalt\n\n", …).
// Der StarterKit-codeBlock (preserveWhitespace:"full" in
// @tiptap/extension-code-block) übernimmt diesen Text UNVERÄNDERT in den
// ProseMirror-Knoten – "node.textContent" trug dadurch IMMER ein
// zusätzliches, in der Quelle nie vorhandenes Zeilenende. Am DOKUMENTANFANG
// (state.delim === "", top-level) verschluckt MarkdownSerializerState#write
// diese "leere Zusatzzeile" beim Speichern folgenlos (ein leerer String ohne
// Einzug-Präfix hinterlässt keine Spur, siehe DECISIONS) – GENAU DESHALB
// bestand tests/docEditorCode.test.jsx trotz dieses Bugs schon immer:
// dort steht kein Codeblock in einer Liste. INNERHALB eines Listenpunkts
// ist "state.delim" dagegen der Einzug-Präfix (z. B. "  ") – WriteState#write
// schreibt diesen Präfix vor JEDE Zeile, die per state.text() geschrieben
// wird, AUCH vor die überzählige leere Zeile, UND state.ensureNewLine()
// direkt danach schließt sie mit einem echten Zeilenumbruch ab: aus der
// einen überzähligen Leerzeile wird dadurch eine SICHTBARE Leerzeile
// zwischen Code-Inhalt und Schluss-Zaun. Da diese Zeile beim nächsten Laden
// selbst wieder als LEGITIMER Code-Inhalt gilt (matchFenceBlock/code.jsx
// kennt keine "künstliche" vs. "echte" Leerzeile), UND markdown-it beim
// erneuten Rendern erneut ihr eigenes strukturelles "\n" aufsattelt, wächst
// die Lücke mit jedem Zyklus um eine weitere Zeile.
//
// FIX an der vom Auftrag selbst nahegelegten "richtigen Stelle" (Vermutung
// bestätigt, nur eine Ebene früher als Listen-Serializer/Fence-Erkennung):
// GENAU der "updateDOM"-Hook, den tiptap-markdowns EIGENE codeBlock-Node für
// exakt dieses Problem mitbringt (s.o.), hier 1:1 nachgezogen – entfernt
// EIN "\n" unmittelbar vor "</code></pre>" aus dem GESAMTEN gerenderten
// Dokument-HTML, bevor ProseMirror es parst. "Inhalt\n" -> "Inhalt" (0
// Leerzeilen, der Normalfall) und "Inhalt\n\n" -> "Inhalt\n" (1 ECHTE
// Leerzeile bleibt erhalten, siehe Test) – die Regel trifft "</code></pre>"
// als LITERALES HTML-Tag-Paar; ein im Code-Inhalt selbst vorkommendes
// "</code></pre>" wäre durch escapeHtml() bereits zu "&lt;/code&gt;…"
// entschärft und kann diese Regel nie versehentlich matchen (identische
// Sicherheits-Überlegung wie beim tiptap-markdown-Original). "g"-Flag: ein
// Dokument mit MEHREREN Codeblöcken bekommt jeden einzeln bereinigt (ein
// einzelner MarkdownParser#parse()-Lauf ruft "updateDOM" genau einmal mit
// dem KOMPLETTEN Dokument-Element auf, siehe MarkdownParser.js).
//
// ZWEITE, beim Testschreiben für DIESEN Fix gefundene Hälfte (ohne die der
// obige Lade-Fix eine neue, schmalere Regression eingeführt hätte): Der
// SERIALIZER nutzte bisher "state.text(node.textContent, false)" gefolgt
// von "state.ensureNewLine()" – das funktionierte VOR diesem Fix nur, weil
// sich die Lade-seitige Extra-Zeile und diese Serializer-Lücke GEGENSEITIG
// zufällig aufhoben (siehe DECISIONS): "state.text()" hängt hinter der
// LETZTEN Zeile eines Strings NIE selbst einen Zeilenumbruch an (sie werden
// wie bei Array#join NUR ZWISCHEN den Zeilen eingefügt) – eine ECHTE
// Leerzeile am Ende des Codes (node.textContent endet auf "\n", z. B. ein
// vom Nutzer bewusst vor dem Schluss-Zaun freigelassener Absatz) erzeugt
// dadurch KEINEN zusätzlichen Zeilenumbruch, und "state.ensureNewLine()"
// hält den bereits vorhandenen letzten Umbruch (vom vorletzten Segment) für
// bereits ausreichend – die letzte, WIRKLICH leere Zeile geht verloren.
// Nach dem Lade-Fix oben (kein "geschenkter" Extra-Umbruch mehr, der das
// vorher zufällig kompensierte) wäre das jetzt IMMER sichtbar, nicht nur in
// Listen. Fix: JEDE Zeile aus "node.textContent.split(\"\\n\")" (auch eine
// leere Schlusszeile) bekommt ÜBER "state.write()" explizit ihr eigenes
// Einzug-Präfix (in einer Liste "state.delim", sonst "") UND einen eigenen,
// selbst geschriebenen "\n" – dadurch verschwindet die Abhängigkeit von
// "ensureNewLine()"s Heuristik komplett. Nur der ECHT LEERE Codeblock
// (node.textContent === "", z. B. "```\n```" ohne jeden Inhalt) bleibt
// Sonderfall: "".split("\n")" läge fälschlich bei EINEM Element (""), nicht
// bei null Zeilen – ein Leerstring UND "eine einzelne, komplett leere Zeile"
// sind über join/split strukturell nicht unterscheidbar (dieselbe Lücke wie
// beim LESEN, siehe matchFenceBlock/code.jsx: "".join("\n")" ergibt für
// BEIDE Fälle ""). Der leere Sonderfall bleibt deshalb bewusst bei der
// ORIGINAL-Logik (state.ensureNewLine() statt der neuen Schleife) – exakt
// wie zuvor, kein Verhaltenswechsel für einen inhaltslosen Codeblock.
export const FencedCodeBlock = CodeBlockExtension.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          const runs = node.textContent.match(/`{3,}/g) || [];
          const fenceLen = Math.max(3, ...runs.map((r) => r.length + 1));
          const fence = "`".repeat(fenceLen);
          state.write(fence + (node.attrs.language || "") + "\n");
          if (node.textContent) {
            // Review-Nachbesserung zu v7.46: NICHT state.write() vor jeder
            // Zeile – das schriebe den Listen-Einzug AUCH vor eine leere
            // Zeile und hinterließe eine Zeile aus reinem Whitespace im
            // committeten Markdown. prosemirror-markdown selbst macht das
            // nicht: flushClose() trimmt das Delimiter für Leerzeilen
            // ausdrücklich (delimMin), gewöhnliche Fortsetzungs-Leerzeilen
            // in einer Liste sind deshalb WIRKLICH leer. Hier dieselbe
            // Logik, sonst entstünde Diff-Rauschen und – weil viele
            // Editoren trailing whitespace beim Öffnen strippen – beim
            // nächsten Speichern erneut eine Änderung.
            const delim = state.delim;
            node.textContent.split("\n").forEach((line) => {
              state.flushClose();
              // roh, kein state.esc() – wie bisher escape:false
              state.out += (line ? delim : delim.replace(/\s+$/, "")) + line + "\n";
            });
          } else {
            state.ensureNewLine();
          }
          state.write(fence);
          state.closeBlock(node);
        },
        parse: {
          updateDOM(element) {
            element.innerHTML = element.innerHTML.replace(/\n<\/code><\/pre>/g, "</code></pre>");
          },
        },
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

    // Einzug SOFORT sichtbar (v7.42, wie bei BlockImage oben): Diese
    // NodeView baut ihr DOM ebenfalls selbst, "data-indent" (nur MathBlock
    // hat dieses Attribut, siehe dort – bei MathInline ist cur.attrs.indent
    // stets undefined/falsy) käme über renderHTML() NIE im echten Editor-DOM
    // an. Auf den Wrapper gespiegelt, damit dieselbe generische
    // "[data-indent]"-Regel (index.css) greift; läuft sowohl beim Erzeugen
    // als auch in update() unten, damit eine Änderung sofort sichtbar ist.
    const applyIndentAttr = () => {
      if (cur.attrs.indent) wrap.setAttribute("data-indent", String(cur.attrs.indent));
      else wrap.removeAttribute("data-indent");
    };
    applyIndentAttr();

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
        // Unabhängig vom Bearbeitungsmodus (auch WÄHREND der Eingabe soll
        // ein per Knopf/Tab geänderter Einzug sofort sichtbar sein).
        applyIndentAttr();
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
          // v7.48 (Review-Nachbesserung, siehe texSafeForTableCell/MdTable
          // oben): INNERHALB einer Tabellenzelle (state.inTable) würde ein
          // rohes "|" im TeX die Pipe-Zeile auftrennen – "\vert " ersetzt es
          // dort visuell IDENTISCH, ohne ein neues Pipe-Zeichen zu erzeugen.
          // Außerhalb einer Tabelle bleibt "|" unangetastet (unverändertes
          // Verhalten).
          const tex = state.inTable ? texSafeForTableCell(node.attrs.tex) : node.attrs.tex;
          state.write("$" + tex + "$");
        },
        parse: {},
      },
    };
  },
  addNodeView() {
    return mathNodeView(false);
  },
});

// indent (v7.41, Code-Review vor v7.41-Commit, 🔵 Finding 6): analog zu
// BlockImage – mathToPlaceholders (math.jsx) schreibt "data-indent" bereits
// direkt in den generierten Tag (siehe dort), addAttributes() reicht daher,
// tiptap injiziert das Auslesen automatisch in die BESTEHENDE, eigene
// parseHTML()-Regel (injectExtensionAttributesToParseRule in @tiptap/core –
// merged NEBEN dem dort schon vorhandenen "tex", kein Konflikt). renderHTML
// MUSS dafür aber explizit "HTMLAttributes" übernehmen (bisher ignoriert,
// nur "data-tex" hartkodiert) – tiptap berechnet "data-indent" zwar über
// indentAttrSpec.renderHTML, das Ergebnis landet aber nur im HTMLAttributes-
// Parameter, den die Node-eigene renderHTML-Funktion aktiv verwenden muss.
export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  addAttributes() {
    // "rendered: false" (Re-Review vor v7.41-Commit, 🔵 Finding E): ohne
    // dieses Flag würde "tex" ZUSÄTZLICH in "HTMLAttributes" auftauchen
    // (tiptap berechnet HTMLAttributes automatisch aus ALLEN Attributen
    // mit rendered!==false, siehe getRenderedAttributes/@tiptap/core) –
    // renderHTML unten schreibt "tex" aber bereits EXPLIZIT als
    // "data-tex", ein zusätzliches, rohes "tex"-Attribut wäre reine
    // Dopplung (gemessen: "<math-block tex="…" data-indent="…"
    // data-tex="…">"). Betrifft NUR die Render-Seite – parseHTML() unten
    // liest "tex" weiterhin selbst aus "data-tex" (eigener, custom
    // getAttrs, unabhängig vom automatischen Attribut-Mechanismus).
    return { tex: { default: "", rendered: false }, indent: indentAttrSpec };
  },
  parseHTML() {
    return [{ tag: MATH_BLOCK_TAG, getAttrs: (el) => ({ tex: el.getAttribute("data-tex") || "" }) }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [MATH_BLOCK_TAG, { ...HTMLAttributes, "data-tex": node.attrs.tex }];
  },
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          state.write("  ".repeat(node.attrs.indent || 0));
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
      // v7.31: dieselbe Bedingung wie in markdown.jsx (renderInline) – reine
      // Ziffern zählen NUR bei einem http(s)-Ziel als Fußnote, ein file:-Link
      // ist IMMER "doc-link" (auch bei zufällig rein numerischem Titel), sonst
      // würden Editor-Optik und Viewer-Rendering für denselben Link
      // auseinanderlaufen.
      const isCite = /^\d+$/.test(run.text) && /^https?:\/\//i.test(run.href);
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

// Anker-Variante von FILE_URL_RE (filelinks.js) – wie LINK_URL_FULL_RE unten
// für http(s), NUR intern hier für die file:-Akzeptanzprüfungen gebraucht
// (FileLinkMarkdownIt, isAllowedUri, normalizeLinkUrl).
const FILE_URL_FULL_RE = new RegExp("^" + FILE_URL_RE.source + "$");

/* -------------------------------------------------------------------- */
/* file:-Links (v7.31, Nutzer-Befund Live + Nutzerwunsch): markdown-it     */
/* (unter tiptap-markdown) blockt "file:" per validateLink standardmäßig   */
/* (node_modules/markdown-it/lib/index.mjs, BAD_PROTO_RE – Schutz gegen    */
/* file:/data:/javascript:-Injection) – ein "[Titel](file:///…)" würde     */
/* beim Laden sonst NICHT als <a>-Tag erkannt: markdown-it's Link-Regel    */
/* setzt href bei einem validateLink-Fehlschlag zwar zurück, kann die      */
/* Klammer-Syntax dadurch aber nicht mehr schließen (siehe                 */
/* rules_inline/link.mjs) und lässt die GESAMTE "[…](…)"-Syntax auf        */
/* Klartext zurückfallen. tiptap-markdown ruft für jede registrierte       */
/* Extension optional storage.markdown.parse.setup(md) VOR jedem Rendern   */
/* auf (MarkdownParser.js) – hier genutzt, um GENAU unsere strikte         */
/* file:-Grammatik (FILE_URL_RE, filelinks.js) zusätzlich zu erlauben,     */
/* ohne validateLink komplett zu öffnen (javascript:/data:/vbscript:       */
/* bleiben über den ORIGINALEN Validator weiterhin blockiert).             */
/*                                                                         */
/* __fileLinkPatched-Flag verhindert mehrfaches Verschachteln des          */
/* Wrappers: setup() läuft bei JEDEM parse()-Aufruf erneut auf DERSELBEN   */
/* md-Instanz (die lebt für die gesamte Editor-Lebenszeit, siehe           */
/* MarkdownParser-Konstruktor) – ohne das Flag würde jeder weitere         */
/* Ladevorgang (z. B. insertContentAt) den Validator um eine weitere,      */
/* unnötige Wrapper-Schicht verlängern.                                    */
/*                                                                         */
/* Reicht ALLEIN NICHT: ProseMirrors eigenes HTML->Doc-Parsing (das        */
/* renderte innerHTML von MarkdownParser.parse landet als "content"-String */
/* im Editor) prüft den Link-Mark ZUSÄTZLICH über isAllowedUri             */
/* (@tiptap/extension-link, parseHTML/getAttrs) – dafür siehe die           */
/* erweiterte isAllowedUri in der Link.configure()-Aufrufstelle unten.     */
export const FileLinkMarkdownIt = Extension.create({
  name: "fileLinkMarkdownIt",
  addStorage() {
    return {
      markdown: {
        parse: {
          setup(md) {
            if (md.__fileLinkPatched) return;
            md.__fileLinkPatched = true;
            const orig = md.validateLink.bind(md);
            md.validateLink = (url) => FILE_URL_FULL_RE.test(String(url)) || orig(url);
          },
        },
      },
    };
  },
});

/* -------------------------------------------------------------------- */
/* Einzug – Editor-Ladepfad (v7.41, Auftrag "Einrückungen"). markdown-it   */
/* wirft führende Leerzeichen von Absätzen normalerweise weg – ohne diesen */
/* Hook käme ein gespeicherter Einzug beim erneuten Öffnen des Editors nie  */
/* wieder an. Zwei Teile, beide über denselben setup(md)-Hook wie          */
/* FileLinkMarkdownIt oben (inkl. __indentPatched-Guard aus demselben       */
/* Grund: setup() läuft bei JEDEM parse()-Aufruf erneut auf DERSELBEN       */
/* md-Instanz):                                                            */
/*                                                                          */
/* 1) md.disable("code"): markdown-its Regel für EINGERÜCKTE Codeblöcke     */
/*    (4+ Leerzeichen/ein Tab, CommonMark) MUSS weg, sonst würde bereits    */
/*    Einzugsebene 2 (4 Leerzeichen) beim Laden zu einem Codeblock statt zu */
/*    einem eingerückten Absatz. Konsistent zur restlichen App, die         */
/*    ohnehin nur GEZÄUNTE Codeblöcke kennt (siehe Kopfkommentar in         */
/*    lib/code.jsx und DECISIONS "Gemeinsame Fence-Erkennung").             */
/*                                                                          */
/* 2) Eine core-Regel NACH "inline" (die Kinder eines "inline"-Tokens sind  */
/*    erst danach geparst, siehe Punkt "Bild-Sonderfall" unten) setzt für   */
/*    jeden "paragraph_open" AUF OBERSTER EBENE "data-indent" anhand der    */
/*    Einrückung seiner Quellzeile (token.map[0] -> state.src). "oberste    */
/*    Ebene" heißt: NICHT innerhalb eines list_item_open/blockquote_open/   */
/*    table_open – ein Tiefenzähler läuft über das FLACHE Token-Array (die  */
/*    Blockstruktur ist dort über nesting +1/-1 kodiert). "Kein doppelter   */
/*    Einzug" (Auftrag): Inhalt INNERHALB eines Listenpunkts bekommt        */
/*    dadurch bewusst KEIN indent-Attribut – der Listen-Serializer erzeugt  */
/*    seinen Einzug bereits selbst (2 Leerzeichen blieben sonst beim        */
/*    Speichern 4).                                                        */
/*                                                                          */
/*    Bild-Sonderfall: Besteht der Absatz NUR aus einem Bild (App-          */
/*    Konvention "![…](img:…) allein auf einer Zeile", IMG_LINE_RE), hebt   */
/*    ProseMirror den block-level BlockImage-Node aus seinem <p> heraus     */
/*    (BlockImage ist group:"block", tiptap-markdowns normalizeBlocks       */
/*    extrahiert es aus dem <p>) – das Attribut am <p> selbst ginge dabei   */
/*    verloren. Deshalb wird "data-indent" IMMER ZUSÄTZLICH auf dem         */
/*    "image"-Inline-Kind gesetzt (das companion "inline"-Token folgt im    */
/*    flachen Token-Array laut markdown-it immer direkt auf                */
/*    "paragraph_open", siehe rules_block/paragraph.mjs).                   */
/*                                                                          */
/*    Formel-Sonderfall (v7.42, ECHTER Bug, beim Testschreiben für Auftrag  */
/*    "Einzug im Editor sichtbar machen" Teil B gefunden – siehe DECISIONS  */
/*    Finding B4): mathToPlaceholders (math.jsx) schreibt "data-indent" auf */
/*    den generierten <math-block>-Tag als reine TEXT-Vorverarbeitung VOR   */
/*    jedem markdown-it-Lauf – zu diesem Zeitpunkt ist noch NICHTS über     */
/*    Listen-/Blockquote-/Tabellen-Verschachtelung bekannt (anders als beim */
/*    Bild-Sonderfall oben, wo das Attribut erst HIER, NACH der Tiefen-     */
/*    prüfung, gesetzt wird). Eine Formel INNERHALB eines Listenpunkts      */
/*    (z. B. als Fortsetzung unter "- Parent", genau wie ein Absatz/Bild)   */
/*    behielt dadurch ihr rohes indent-Attribut UNGEPRÜFT – "kein doppelter */
/*    Einzug" galt bisher nur für Absatz/Bild, nicht für die Formel. Ein    */
/*    <math-block>-Tag allein auf einer Zeile landet bei markdown-it (siehe */
/*    Test) als "html_inline"-Kinderpaar (Öffnungs-/Schluss-Tag) INNERHALB  */
/*    desselben "paragraph_open"/"inline"-Paars wie ein normaler Absatz –   */
/*    bei depth!==0 wird das bereits vorhandene "data-indent" deshalb HIER  */
/*    direkt aus dem rohen Tag-Text entfernt (parseHTML liest es dann als   */
/*    "0", identisch zum Absatz-Verhalten).                                */
const NESTED_MATH_INDENT_RE = new RegExp("^<" + MATH_BLOCK_TAG + "\\b");
export const IndentMarkdownIt = Extension.create({
  name: "indentMarkdownIt",
  addStorage() {
    return {
      markdown: {
        parse: {
          setup(md) {
            if (md.__indentPatched) return;
            md.__indentPatched = true;
            md.disable("code");
            md.core.ruler.after("inline", "docIndentAttrs", (state) => {
              const lines = state.src.split("\n");
              const tokens = state.tokens;
              let depth = 0;
              for (let i = 0; i < tokens.length; i++) {
                const token = tokens[i];
                if (token.type === "list_item_open" || token.type === "blockquote_open" || token.type === "table_open") {
                  depth++;
                  continue;
                }
                if (token.type === "list_item_close" || token.type === "blockquote_close" || token.type === "table_close") {
                  depth--;
                  continue;
                }
                if (token.type !== "paragraph_open" || !token.map) continue;
                const inlineToken = tokens[i + 1];
                if (depth !== 0) {
                  // Formel-Sonderfall (siehe Kopfkommentar) – NUR hier
                  // relevant, auf oberster Ebene bleibt ein bereits von
                  // mathToPlaceholders gesetztes Attribut unangetastet.
                  // Schleife statt fester Kinder-Anzahl (BUGFIX beim
                  // Testschreiben gefunden): Steht die Formel TIGHT direkt
                  // unter einem Listenpunkt OHNE Leerzeile ("- Parent\n
                  // $$x^2$$"), verschmilzt markdown-it sie über einen
                  // "softbreak" MIT dem Text davor zu EINEM gemeinsamen
                  // "inline"-Token (Kinder: text("Parent"), softbreak,
                  // html_inline(Öffnung), html_inline(Schluss)) – das
                  // öffnende/schließende Tag-Paar steht dann NICHT mehr an
                  // Index 0/1.
                  if (inlineToken && inlineToken.type === "inline" && inlineToken.children) {
                    const children = inlineToken.children;
                    for (let ci = 0; ci < children.length - 1; ci++) {
                      const openTag = children[ci], closeTag = children[ci + 1];
                      if (
                        openTag.type === "html_inline" && closeTag.type === "html_inline" &&
                        NESTED_MATH_INDENT_RE.test(openTag.content) &&
                        closeTag.content === "</" + MATH_BLOCK_TAG + ">"
                      ) {
                        openTag.content = openTag.content.replace(/ data-indent="\d+"/, "");
                      }
                    }
                  }
                  continue;
                }
                const level = indentLevel(lines[token.map[0]] || "");
                if (level <= 0) continue;
                token.attrSet("data-indent", String(level));
                if (
                  inlineToken && inlineToken.type === "inline" &&
                  inlineToken.children && inlineToken.children.length === 1 &&
                  inlineToken.children[0].type === "image"
                ) {
                  inlineToken.children[0].attrSet("data-indent", String(level));
                }
              }
            });
          },
        },
      },
    };
  },
});

/* -------------------------------------------------------------------- */
/* Geister-Checkbox (v7.41.2, ECHTER Bug, ÄLTER als v7.41 – trifft ganz     */
/* gewöhnliche Notizbuch-Inhalte, siehe DECISIONS für die vollständige       */
/* Ursachenanalyse und den mehrzyklischen Nachweis): eine gewöhnliche        */
/* Stichpunktliste, gefolgt (MIT ODER OHNE Leerzeile) von einer Checkliste   */
/* MIT DEMSELBEN Marker ("-"), ist in CommonMark KEINE zwei getrennten       */
/* Listen, sondern EINE einzige – Markdown kennt kein "-"-Listenende außer   */
/* über einen Marker-/Ebenenwechsel. markdown-it-task-lists setzt die        */
/* Klasse "contains-task-list" auf das <ul>, SOBALD IRGENDEIN Kind-<li>      */
/* eine Checkbox hat; ist das ERSTE <li> dieses <ul>s KEINE Checkbox,        */
/* verlangt TaskLists starres Content-Schema ("taskItem+") trotzdem ab dem   */
/* ERSTEN Kind einen taskItem – ProseMirrors HTML-Parser füllt die           */
/* Schema-Lücke MIT EINEM GESPENSTISCHEN LEEREN taskItem AUF (verifiziert    */
/* mit purem markdown-it-task-lists, UNABHÄNGIG von tiptap/dieser App –      */
/* dieselbe Lücke, die convertListItemTypeCommand oben für einen ANDEREN     */
/* Auslöser bereits dokumentiert und dort per No-op umschifft – siehe dort   */
/* für den Verweis, ob dieser Guard nach diesem Fix noch gebraucht wird).    */
/* Der Phantom-Punkt landet in der Ansicht als sichtbares leeres Kästchen    */
/* UND wird beim nächsten Speichern committet – UND vermehrt sich mit        */
/* jedem weiteren Bearbeitungszyklus um ein WEITERES (jede erneute Ladung    */
/* trifft dieselbe Parser-Lücke erneut, diesmal mit dem vorherigen           */
/* Phantom als zusätzlichem "-"-Element ganz am Anfang der Liste).           */
/*                                                                          */
/* Fix: die Mehrdeutigkeit im DOM auflösen, BEVOR ProseMirror parst –        */
/* dasselbe Hook-Muster wie FileLinkMarkdownIt/IndentMarkdownIt oben, nur    */
/* über parse.updateDOM(element) statt parse.setup(md). tiptap-markdown      */
/* ruft BEIDE Hooks bei JEDEM parse()-Aufruf auf (MarkdownParser.js#parse:   */
/* setup() vor dem Rendern, updateDOM() NACH dem Rendern, aber VOR dem        */
/* eigentlichen ProseMirror-HTML-Parsing) – das gilt für JEDEN Ladeweg,       */
/* also auch editor.commands.setContent()/insertContentAt() (siehe           */
/* node_modules/tiptap-markdown/src/Markdown.js#addCommands: beide rufen     */
/* intern parser.parse() auf), NICHT nur den initialen Editor-Aufbau.        */
/* Jedes <ul class="contains-task-list">, dessen ERSTES <li> KEIN            */
/* Checklisten-Punkt ist, wird an JEDER Task/Nicht-Task-Grenze in            */
/* eigenständige Geschwister-<ul> aufgeteilt (mehrfache Wechsel INNERHALB    */
/* einer Liste zerfallen entsprechend in mehr als zwei Teil-Listen) – exakt  */
/* die Struktur, die die Serialisierung für "bulletList gefolgt von          */
/* taskList" ohnehin schon schreibt (siehe BulletList/TaskList-Node), und    */
/* die beim ERNEUTEN Laden NICHT mehr zusammengefasst geparst wird, WEIL     */
/* kein <ul> mehr existiert, dessen erstes Kind keine Checkbox ist.          */
/*                                                                          */
/* Reihenfolge-Anforderung (WICHTIG, siehe "priority" unten): Muss VOR        */
/* TaskLists eigenem updateDOM-Hook laufen. tiptap-markdown ruft ALLE         */
/* updateDOM-Hooks in der Reihenfolge von "extensionManager.extensions" auf   */
/* (nach Priorität sortiert, siehe ExtensionManager.sort in @tiptap/core).    */
/* Liefe TaskLists eigener Hook ZUERST, würde er "data-type=taskList" NUR auf */
/* das ORIGINALE (gemischte) <ul> setzen – die hier NEU erzeugten             */
/* Geschwister-<ul> blieben ohne dieses Attribut zurück (TaskLists parseDOM   */
/* verlangt zwingend ul[data-type="taskList"], siehe node_modules/@tiptap/    */
/* extension-task-list) und würden beim ANSCHLIESSENDEN ProseMirror-Parsing   */
/* als GENERISCHE bulletList misinterpretiert. "priority: 101" (v7.41.2       */
/* Nachbesserung, Review-Finding) statt sich – wie ursprünglich – auf die     */
/* Position in der useEditor()-Extensions-Liste zu verlassen: GENAU dieselbe  */
/* Zerbrechlichkeit, die IndentKeymap ("priority: 1001") und NestedListToggle */
/* ("priority: 50") bereits vermeiden – TaskList/TaskItem haben KEINEN        */
/* eigenen Extension-Level-priority-Wert (Default 100, siehe node_modules/    */
/* @tiptap/extension-task-list|task-item/src – der "priority: 51" DORT        */
/* gehört zu einer parseDOM-Regel, nicht zur Extension), "101" sortiert       */
/* SplitMixedTaskLists in ExtensionManager.sort() GARANTIERT vor sie,         */
/* unabhängig von ihrer tatsächlichen Position in useEditor() unten.          */
/* Gefahrlos: die Extension steuert weder Nodes/Marks noch ProseMirror-       */
/* Plugins/Commands bei, eine höhere Priorität kann deshalb an KEINER         */
/* anderen Stelle etwas verschieben. Die Position VOR TaskList in der Liste   */
/* unten bleibt trotzdem stehen – rein als Lese-Konvention, nicht mehr als    */
/* funktionale Notwendigkeit.                                                */
/*                                                                          */
/* Verschachtelte gemischte Listen (ein <ul class="contains-task-list">      */
/* INNERHALB eines <li>, z. B. ein Checkbox-Elternpunkt mit einer             */
/* eingerückten gemischten Liste als Kind): querySelectorAll trifft JEDES     */
/* passende <ul> im gesamten Baum, unabhängig von der Verschachtelungs-       */
/* tiefe – die Aufteilung läuft pro <ul> unabhängig und respektiert dadurch    */
/* automatisch jede Ebene für sich. <ul> ohne Kinder: "firstElementChild"      */
/* ist dann null, die Funktion bricht für dieses <ul> sofort ab – kommt in     */
/* der Praxis nie vor (markdown-it erzeugt kein leeres <ul>), rein defensiv.   */
/*                                                                          */
/* Geerbte Lockerheit (beim Testschreiben gefunden, siehe DECISIONS):         */
/* CommonMark entscheidet "tight"/"loose" für die GESAMTE ursprüngliche,       */
/* noch ungetrennte Liste EINHEITLICH (irgendeine Leerzeile IRGENDWO in der    */
/* Liste macht ALLE ihre <li> "loose", also mit <p>-umschlossenem Inhalt).     */
/* Nach der Aufteilung erbt ein neu entstandenes NICHT-Task-<ul> diese          */
/* <p>-Umschließung auch dann, wenn innerhalb GENAU DIESER Teilgruppe gar       */
/* keine Leerzeile stand (die Leerzeile, die die Gesamtliste "loose" gemacht    */
/* hat, kann irgendwo ANDERS – insbesondere GENAU an der jetzt neu               */
/* geschaffenen Gruppengrenze – gestanden haben). MarkdownTightLists             */
/* (tiptap-markdown) liest "tight" beim Parsen direkt von                        */
/* "!element.querySelector('p')" ab (node_modules/tiptap-markdown/src/            */
/* extensions/tiptap/tight-lists.js) – eine geerbte <p>-Hülle hätte dadurch        */
/* eine UNGEWOLLTE Leerzeile ZWISCHEN zwei eigentlich tight gemeinten              */
/* Geschwister-Punkten INNERHALB derselben neuen Teilliste zur Folge               */
/* (empirisch mit genau dem Auftragsbeispiel "Notiz eins"/"Notiz zwei" +           */
/* Leerzeile + Checkliste nachgestellt). taskList ist davon NICHT betroffen        */
/* (kein "tight"-Attribut auf diesem Node-Typ überhaupt, siehe                     */
/* MarkdownTightLists' "listTypes": ["bulletList","orderedList"] – der             */
/* Serializer fällt für taskList IMMER auf den konfigurierten                      */
/* "tightLists"-Default zurück, siehe node_modules/prosemirror-markdown/src/       */
/* to_markdown.ts#renderList). Für bulletList/orderedList wird die geerbte         */
/* <p>-Hülle deshalb HIER GEZIELT entfernt: NUR bei einem <li>, dessen              */
/* EINZIGES Kind ein <p> ist (kein weiterer Geschwister-Block wie eine              */
/* eingebettete Unterliste – DIE bräuchte ihre <p>-Hülle unverändert), wird          */
/* der Absatz "unwrapped" (Kinder direkt ins <li> gehoben). Bewusster               */
/* Kompromiss (siehe DECISIONS): Eine ECHTE, vom Nutzer INNERHALB genau              */
/* dieser Teilgruppe gewollte Leerzeile lässt sich aus dem bereits                   */
/* gerenderten DOM nicht mehr von einer bloß GEERBTEN unterscheiden                  */
/* (CommonMark trifft die Loose/Tight-Entscheidung, bevor diese Erweiterung           */
/* überhaupt laufen kann) – "immer tight nach der Aufteilung" passt zum               */
/* ohnehin konfigurierten App-Standard (Markdown.configure({tightLists:true}))         */
/* und betrifft nur den seltenen Fall "Stichpunktliste + Checkliste,                   */
/* mindestens eine Seite mit 2+ Punkten, irgendwo eine Leerzeile im                     */
/* ursprünglichen Gesamtblock".                                                          */
export const SplitMixedTaskLists = Extension.create({
  name: "splitMixedTaskLists",
  priority: 101,
  addStorage() {
    return {
      markdown: {
        parse: {
          updateDOM(element) {
            [...element.querySelectorAll("ul.contains-task-list")].forEach((ul) => {
              const isTask = (li) => li.classList.contains("task-list-item");
              if (!ul.firstElementChild || isTask(ul.firstElementChild)) return;
              let current = null;
              const groups = [];
              [...ul.children].forEach((li) => {
                if (!current || isTask(li) !== isTask(current.firstElementChild)) {
                  current = document.createElement("ul");
                  if (isTask(li)) current.className = "contains-task-list";
                  groups.push(current);
                  ul.parentNode.insertBefore(current, ul);
                }
                current.appendChild(li);
              });
              // Geerbte Lockerheit korrigieren (siehe Kopfkommentar) – NUR
              // für die neu entstandenen NICHT-Task-Gruppen, NUR bei einem
              // <li> mit ausschließlich einem <p>-Kind (eine eingebettete
              // Unterliste als weiteres Geschwister-Element bleibt unangetastet).
              groups.forEach((g) => {
                if (g.className === "contains-task-list") return;
                [...g.children].forEach((li) => {
                  if (li.children.length === 1 && li.firstElementChild.tagName === "P") {
                    li.replaceChildren(...li.firstElementChild.childNodes);
                  }
                });
              });
              ul.remove();
            });
          },
        },
      },
    };
  },
});

/* -------------------------------------------------------------------- */
/* Leere Checkbox geht beim erneuten Laden verloren (v7.45, ECHTER Bug,   */
/* E2E-Finding 🔴 – siehe DECISIONS #91 für die vollständige Analyse).    */
/* Ein bewusst leer angelegter Checkbox-Punkt ("- [ ]" ohne jeden          */
/* Folgetext, z. B. per Enter im Editor erzeugt) wird von markdown-it     */
/* NIE als Task-Item erkannt – UNABHÄNGIG davon, ob die Quellzeile ein     */
/* abschließendes Leerzeichen trägt oder nicht: markdown-its EIGENE        */
/* Absatz-Regel (rules_block/paragraph.mjs) fasst alle Zeilen eines        */
/* Absatzes zusammen und wendet darauf EINMAL asciiTrim() an – ein         */
/* einzelnes Leerzeichen am Ende (kein "harter Umbruch", der bräuchte      */
/* zwei) fällt dabei IMMER weg, bevor markdown-it-task-lists (das          */
/* separate "core.ruler.after('inline', …)"-Plugin, das TaskList lädt)     */
/* den resultierenden Absatztext überhaupt zu sehen bekommt. Dessen        */
/* eigene Erkennung (startsWithTodoMarkdown in node_modules/               */
/* markdown-it-task-lists/index.js) verlangt zwingend die vier Zeichen     */
/* "[ ] "/"[x] "/"[X] " (MIT Leerzeichen) am Anfang des Absatztexts – bei   */
/* einem leeren Punkt bleibt nach dem Trimmen aber IMMER nur "[ ]" (drei    */
/* Zeichen) übrig, egal was im Markdown stand. Jedes "Leerzeichen am        */
/* Zeilenende erhalten"-Rezept (z. B. eine reine Textvorverarbeitung VOR    */
/* dem Laden, wie es andere Hooks in dieser Datei für Einzug/Formeln        */
/* nutzen) würde deshalb NICHTS bewirken – markdown-it nimmt es beim        */
/* eigenen Parsen sofort wieder weg (empirisch verifiziert, siehe           */
/* Abschlussbericht/DECISIONS: "- [ ]" UND "- [ ] " liefern nach dem        */
/* Laden IDENTISCH eine normale Aufzählung mit Literaltext "[ ]").          */
/*                                                                          */
/* Fix: eine EIGENE core-Regel, GENAU wie IndentMarkdownIt oben über         */
/* denselben "parse.setup(md)"-Hook registriert, korrigiert den bereits      */
/* getrimmten Absatztext, BEVOR die "inline"-Kernregel ihn tokenisiert       */
/* ("core.ruler.before('inline', …)", nicht "after") – markdown-it-task-     */
/* lists selbst hängt sich erst NACH "inline" ein (siehe oben) und sieht     */
/* dadurch immer schon den korrigierten String. Erkennungsbedingung          */
/* bewusst IDENTISCH zu "isTodoItem" in markdown-it-task-lists selbst        */
/* nachgebaut (inline-Token, davor paragraph_open, davor list_item_open) –   */
/* eine Fehlzündung auf einen normalen Absatz mit dem reinen Text "[ ]"      */
/* (kein Listenpunkt) ist dadurch strukturell ausgeschlossen.                */
/*                                                                          */
/* Leerzeichen-Artefakt bewusst vermieden: Die Regel hängt NUR an           */
/* "token.content" (der internen, rein für die spätere Mustererkennung       */
/* gebrauchten STRING-Repräsentation) ein Leerzeichen an – die "inline"-      */
/* Regel tokenisiert danach zwar aus dem gepolsterten String, aber           */
/* markdown-it-task-lists' eigenes "todoify()" schneidet die ersten drei     */
/* Zeichen ("[ ]") wieder vom (einzigen) Text-Kind ab; übrig bleibt ein       */
/* Text-Kind mit GENAU einem Leerzeichen. Empirisch geprüft (siehe           */
/* DECISIONS/Testdatei): ProseMirrors HTML-Parser verwirft dieses             */
/* Leerzeichen-Textkind beim Aufbau des Dokuments vollständig – der           */
/* entstehende taskItem ist danach ein ECHTES leeres Element (kein            */
/* unsichtbares Leerzeichen im Dokumentmodell), identisch zu einem im         */
/* Editor per Enter frisch angelegten leeren Checkbox-Punkt.                  */
const EMPTY_TASK_MARKER_RE = /^\[( |x|X)\]$/;
export const EmptyTaskMarkdownIt = Extension.create({
  name: "emptyTaskMarkdownIt",
  addStorage() {
    return {
      markdown: {
        parse: {
          setup(md) {
            if (md.__emptyTaskPatched) return;
            md.__emptyTaskPatched = true;
            md.core.ruler.before("inline", "docEmptyTaskMarker", (state) => {
              const tokens = state.tokens;
              for (let i = 2; i < tokens.length; i++) {
                if (
                  tokens[i].type === "inline" &&
                  tokens[i - 1].type === "paragraph_open" &&
                  tokens[i - 2].type === "list_item_open" &&
                  EMPTY_TASK_MARKER_RE.test(tokens[i].content)
                ) {
                  tokens[i].content += " ";
                }
              }
            });
          },
        },
      },
    };
  },
});

/* -------------------------------------------------------------------- */
/* AutoKorrektur (v7.25, Nutzerwunsch: "Word-artige Zeichenersetzung     */
/* beim Tippen, mit umfangreicher eingebauter Bibliothek, konfigurier-   */
/* bar"). Die eigentliche Bibliothek + die gesamte Konflikt-Auflösung    */
/* (welcher Trigger feuert wann, siehe "-->"-vs-"--" & Co.) lebt in      */
/* lib/autocorrect.js (BLATT, DOM-/TipTap-frei, siehe Kopfkommentar      */
/* dort) – diese Extension übersetzt die dort kompilierten Regeln NUR    */
/* noch in TipTap-InputRules:                                           */
/*  - kind:"text"  -> textInputRule({find, replace}) (Standard-Helfer,   */
/*    hängt bei "terminator"/"word"/"backslash"-Regeln automatisch das   */
/*    Abschlusszeichen wieder an, siehe match[1]-Mechanik dort).         */
/*  - kind:"multiply" -> eigene InputRule: die Regex liefert VIER        */
/*    Gruppen (Ziffer, Leerraum, Leerraum, Ziffer), der Handler baut den */
/*    Ersatztext daraus zusammen (nur "x" wird zu "×", Ziffern/Leerraum  */
/*    bleiben exakt erhalten).                                          */
/*                                                                       */
/* Codeblock/Codespan-Guard: BEWUSST NICHT hier implementiert – TipTaps  */
/* eingebauter InputRules-Handler (run$1 in @tiptap/core) prüft VOR      */
/* jeder Regel bereits selbst `$from.parent.type.spec.code` (Codeblock)  */
/* bzw. eine aktive code-Mark am Cursor (Codespan) und bricht dann ab,   */
/* BEVOR überhaupt eine Regel getestet wird – siehe Test "feuert NICHT   */
/* in Codeblock/Codespan" in tests/docEditorAutocorrect.test.jsx, der    */
/* nur dieses bestehende Verhalten absichert (kein eigener Code nötig).  */
/* Undo: ebenfalls TipTap-Standard (editor.commands.undoInputRule()) –    */
/* jede über textInputRule()/InputRule ausgelöste Transaktion trägt      */
/* automatisch die dafür nötigen Metadaten, siehe Test "Undo".           */
export const AutoCorrect = Extension.create({
  name: "autoCorrect",
  addOptions() {
    return { rules: [] };
  },
  addInputRules() {
    return this.options.rules.map((rule) =>
      rule.kind === "multiply"
        ? new InputRule({
            find: rule.find,
            handler: ({ state, range, match }) => {
              // v7.33 Review-Nachbesserung (Finding 1, siehe DECISIONS #78):
              // "range" wird von prosemirror-inputrules VORBERECHNET unter
              // der Annahme, der GESAMTE neu eingefügte Text sei Teil des
              // Treffers (dieselbe Prämisse wie bei textInputRule, siehe
              // Kommentar in lib/autocorrect.js#compileEntry) – bei einer
              // MEHRZEICHEN-Einfügung in EINEM handleTextInput-Aufruf (Diktat/
              // prädiktive Tastatur/Automatisierung), die LÄNGER ist als der
              // eigentliche Treffer, kann "range.from" dadurch NACH
              // "range.to" liegen (range.from > range.to) – ein direkter
              // insertText()-Aufruf mit einer solchen Range wirft eine
              // RangeError, GENAU wie beim instant-kind-Absturz, den dieser
              // Handler (anders als textInputRule) NICHT automatisch
              // korrigiert bekommt (kein match[1]-Ausgleich hier, siehe
              // textInputRule.ts). Guard: bei einer ungültigen Range einfach
              // NICHT ersetzen (keine Transaktion, siehe InputRule.ts:
              // "!tr.steps.length" -> No-op) statt abzustürzen – normales
              // Zeichen-für-Zeichen-Tippen ist davon nie betroffen
              // (range.from <= range.to gilt dort immer).
              if (range.from > range.to) return;
              const [, digit1, spaceBefore, spaceAfter, digit2] = match;
              state.tr.insertText(digit1 + spaceBefore + "×" + spaceAfter + digit2, range.from, range.to);
            },
          })
        : textInputRule({ find: rule.find, replace: rule.replacement })
    );
  },
});

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
// v7.31 (Nutzerwunsch file:-Links, siehe FileLinkMarkdownIt oben): der
// Link-Dialog akzeptiert zusätzlich zu http(s) ENTWEDER eine bereits
// fertige file:///-URL ODER einen absoluten Windows-Pfad ("C:\…", per
// pathToFileUrl aus filelinks.js umgewandelt) – VOR der http(s)-
// Schema-Ergänzung geprüft, damit "C:\…" nicht versehentlich als
// schemalose Domain behandelt und fälschlich "https://" vorangestellt
// wird. Ein file:-Eintrag mit rohem, unkodiertem Whitespace (z. B. direkt
// als "file:///C:/a b.txt" eingetippt statt über einen Pfad) wird bewusst
// NICHT automatisch nachkodiert (anders als http(s) unten) – das ist
// der dokumentierte MINIMAL-Fall des Auftrags (fertige file:///-URL ODER
// Windows-Pfad), keine Encoding-Heilung für jede denkbare Mischform.
export function normalizeLinkUrl(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { error: "Bitte eine URL angeben." };
  if (FILE_URL_FULL_RE.test(trimmed)) return { url: trimmed };
  const asFileUrl = pathToFileUrl(trimmed);
  if (asFileUrl) return { url: asFileUrl };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : "https://" + trimmed;
  if (!/^https?:\/\//i.test(withScheme)) {
    return { error: "Nur http(s)- oder file:-Links werden unterstützt." };
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

// Klick in der Gliederungs-Leiste (v7.15-Fix, E2E-Finding 🟡 "Klick setzt
// den Cursor nicht um"): Bei ECHTEN Maus-Klicks (anders als synthetischen
// .click()-Aufrufen in Tests) verschiebt der Browser den Fokus per Default
// schon beim mousedown auf den Button, BEVOR der onClick-Handler überhaupt
// läuft – die anschließende Selection-Transaktion setzte zwar den
// ProseMirror-State korrekt, das sichtbare Tippen landete aber weiterhin an
// der ALTEN DOM-Cursor-Position (Editor/DOM-Selection liefen auseinander).
// Fix zweigeteilt: (a) der Button (siehe unten) verhindert den
// Fokus-Diebstahl von vornherein über onMouseDown+preventDefault, (b) diese
// Funktion ist jetzt eine eigenständige, EXPORTIERTE reine Editor-Operation
// (kein Inline-Closure im Button mehr) – testbar ohne echten Maus-Klick.
// "pos" ist die Position DES heading-Nodes selbst (vor seinem Inhalt);
// "pos+1" ist der Anfang des Inhalts – nur dort landet eine TextSelection
// wirklich INNERHALB der Überschrift (bei "pos" normalisiert ProseMirror auf
// die nächstgelegene gültige Text-Position davor). Stale-Position-Guard:
// eine seit der letzten Outline-Berechnung veraltete Position (Dokument
// inzwischen kürzer, z. B. nach einem Undo) wird verworfen statt eine
// ungültige Selection zu erzeugen bzw. zu werfen. Gibt true zurück, wenn
// gesprungen wurde (Tests prüfen so ohne DOM, ob der Guard gegriffen hat).
export function jumpToHeading(editor, pos) {
  if (!editor) return false;
  const target = pos + 1;
  if (target < 0 || target > editor.state.doc.content.size) return false;
  editor.chain().focus().setTextSelection(target).scrollIntoView().run();
  return true;
}

/* ---------------------------------------------------------------------- */
/* Gliederungs-Leiste: Drag&Drop-Umsortierung (v7.26, Nutzerwunsch: Kapitel */
/* und Abschnitte in der EDITOR-Leiste per Ziehen umsortieren – NUR im     */
/* Edit-Modus, mit dem Nutzer abgestimmt: ein Struktureingriff mit         */
/* Abbrechen/Undo-Semantik gehört an denselben Ort wie andere Editor-      */
/* Bearbeitungen; die Leseansicht-Leiste (App.jsx sectionNavContent) bleibt */
/* reine Navigation und wird hier NICHT angefasst.                        */
/*                                                                          */
/* Bereichs-Modell (computeOutlineRanges) UND das eigentliche Verschieben   */
/* (moveOutlineRange) sind bewusst reine, DOM-freie Funktionen (wie         */
/* extractOutline/jumpToHeading oben) – testbar ohne echten Drag, die UI    */
/* unten (Pointer-Events auf dem Grip-Handle) ruft sie nur noch auf.        */
/* ---------------------------------------------------------------------- */

// Erweitert extractOutline um den VOLLSTÄNDIGEN ProseMirror-Bereich
// [from, to) je Leisten-Eintrag: "from" ist die Position des heading-Nodes
// selbst (wie extractOutlines "pos"), "to" das Ende seines gesamten Inhalts:
//  - H1 (Kapitel) zieht ALLES bis zum NÄCHSTEN H1 – ein dazwischenliegendes
//    H2 ist KEINE Grenze für ein Kapitel, das nimmt seine Abschnitte immer
//    mit (anders als bei H2 unten).
//  - H2 (Abschnitt) endet an der nächsten Überschrift GLEICH WELCHEN Levels
//    (H1 oder H2 – H3 zählt nicht, siehe extractOutline, das H3 gar nicht
//    erst liefert).
// Beide ohne einen passenden nachfolgenden Eintrag: Dokumentende
// (doc.content.size). Reine Funktion AUF extractOutline aufgesetzt statt
// einer zweiten eigenen Traversierung – ein zweiter, potenziell
// abweichender Scan desselben Baums wäre eine unnötige Fehlerquelle. Die
// Titelzeile (Position 0, siehe extractOutline-Kopfkommentar) ist darüber
// bereits ausgenommen: sie taucht hier folglich weder als ziehbarer
// Eintrag noch als Ziel auf (siehe DECISIONS).
export function computeOutlineRanges(doc) {
  const items = extractOutline(doc);
  const docEnd = doc && doc.content ? doc.content.size : 0;
  return items.map((item, i) => {
    let to;
    if (item.level === 1) {
      const nextChapter = items.slice(i + 1).find((o) => o.level === 1);
      to = nextChapter ? nextChapter.pos : docEnd;
    } else {
      to = i + 1 < items.length ? items[i + 1].pos : docEnd;
    }
    return { level: item.level, title: item.text, from: item.pos, to };
  });
}

// Liefert die Indizes ALLER gültigen Ziel-"Grenzen" für einen Drag von
// entries[draggedIndex] – ein Index i bedeutet "einfügen VOR entries[i]",
// der Index entries.length bedeutet "ans Dokumentende einfügen" (nach dem
// letzten Eintrag). Regeln (siehe Auftrag):
//  - H1 (Kapitel) darf NUR vor ein anderes H1 oder ans Dokumentende – NIE
//    mitten in ein Kapitel hinein (eine H2-Grenze ist für H1 kein gültiges
//    Ziel).
//  - H2 (Abschnitt) darf an JEDER Grenze landen: vor einen anderen
//    Abschnitt, ODER vor ein H1 – Letzteres ist NICHT nur "vor das nächste
//    Kapitel" gedacht, sondern GENAU DIESELBE Position wie "ans Ende des
//    VORHERGEHENDEN Kapitels" (die Grenze zwischen zwei Kapiteln ist ein
//    einziger Punkt im Dokument) – das deckt kapitelübergreifendes
//    Verschieben UND das Einsortieren in ein bislang abschnittsloses
//    Kapitel (dessen einzige Grenze zum nächsten Kapitel bzw. Dokumentende
//    ist "direkt hinter seinen eigenen Kapitel-Zeilen") automatisch mit ab,
//    ohne einen dritten Sonderfall zu brauchen.
// No-op-Filter: Jedes Ziel, dessen Position mit dem eigenen "from" ODER
// eigenen "to" übereinstimmt, wird ausgeschlossen (Drop auf sich selbst
// bzw. direkt vor die eigene aktuelle Position – das Dokument bliebe
// byte-identisch, siehe moveOutlineRange). Da die aus computeOutlineRanges
// abgeleiteten Positionen (inklusive Dokumentende) im Dokument STRENG
// aufsteigend sind, ist dieser reine Positionsvergleich ausreichend – zwei
// unterschiedliche Zielindizes können nie dieselbe Position liefern.
export function validDropTargets(entries, draggedIndex) {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  const dragged = entries[draggedIndex];
  if (!dragged) return [];
  const n = entries.length;
  const docEnd = entries[n - 1].to;
  const result = [];
  for (let i = 0; i <= n; i++) {
    const level = i < n ? entries[i].level : null; // null = Dokumentende
    if (dragged.level === 1 && level === 2) continue; // H1 nie mitten ins Kapitel
    const pos = i < n ? entries[i].from : docEnd;
    if (pos === dragged.from || pos === dragged.to) continue; // No-op-Drop
    result.push(i);
  }
  return result;
}

// Verschiebt entries[draggedIndex] atomar (EINE Transaktion, siehe Auftrag
// "ein Undo-Schritt") an die durch targetIndex bezeichnete Grenze (gleiche
// Index-Bedeutung wie bei validDropTargets). Ablauf wie im Auftrag
// vorgegeben: Slice kopieren, Quellbereich löschen, Zielposition durchs
// Mapping der bereits erfolgten Löschung schieben, erst DANACH einfügen –
// sonst würde eine Zielposition HINTER dem gelöschten Bereich auf die
// Löschung selbst zeigen (um die Länge des gelöschten Bereichs verschoben).
// "from"/"to" sind laut computeOutlineRanges immer exakte Node-Grenzen auf
// oberster Ebene (Position direkt vor einem heading-Node bzw. vor dem
// nächsten/Dokumentende) – der Slice ist dadurch garantiert "offen"-frei
// (openStart/openEnd 0, vollständige Top-Level-Nodes), tr.insert(pos,
// slice.content) funktioniert deshalb ohne jede Sonderbehandlung
// angebrochener Nodes.
// Validiert das Ziel SELBST nochmal über validDropTargets (Verteidigung in
// der Tiefe: diese Funktion ist auch direkt aus Tests/potenziell künftigem
// Code aufrufbar, nicht nur aus der bereits filternden UI) – ein
// ungültiger Index (falsches Level, No-op, außerhalb des Bereichs) wird
// OHNE jede Dokumentänderung abgelehnt. Gibt true zurück, wenn tatsächlich
// verschoben wurde (analog jumpToHeading).
export function moveOutlineRange(editor, entries, draggedIndex, targetIndex) {
  if (!editor || !Array.isArray(entries)) return false;
  const dragged = entries[draggedIndex];
  if (!dragged || typeof targetIndex !== "number") return false;
  if (!validDropTargets(entries, draggedIndex).includes(targetIndex)) return false;

  const docEnd = entries[entries.length - 1].to;
  const targetPos = targetIndex < entries.length ? entries[targetIndex].from : docEnd;

  const { state } = editor;
  const slice = state.doc.slice(dragged.from, dragged.to);
  const tr = state.tr;
  tr.delete(dragged.from, dragged.to);
  const mapped = tr.mapping.map(targetPos);
  tr.insert(mapped, slice.content);
  // Cursor in die verschobene Überschrift setzen (wie jumpToHeading):
  // "mapped" ist die neue Position DES verschobenen heading-Nodes selbst
  // (slice.content beginnt immer mit ihm), "+1" der Anfang seines Inhalts.
  // Math.min gegen das neue Dokumentende ist reine Vorsicht (kann hier
  // eigentlich nie greifen, da mapped+1 stets innerhalb des gerade
  // eingefügten Inhalts liegt) – konsistent mit dem Stale-Position-Guard
  // in jumpToHeading.
  const selPos = Math.min(mapped + 1, tr.doc.content.size);
  tr.setSelection(TextSelection.near(tr.doc.resolve(selPos)));
  editor.view.dispatch(tr);
  return true;
}

/* ---------------------------------------------------------------------- */
/* Einzugs-Knöpfe/-Tastenkürzel (v7.41, Auftrag "Einrückungen", Nutzer-     */
/* wunsch "Einzug vergrößern/verkleinern wie in Excel"). Excel/Word-        */
/* Semantik: wirkt auf den Block der aktuellen Cursorposition, bei einer    */
/* Auswahl über mehrere Blöcke auf ALLE berührten Blöcke – jeweils EINE     */
/* Transaktion (ein Undo-Schritt für die GESAMTE Auswahl).                  */
/*                                                                          */
/* Pro berührtem Top-Level-Block (doc.forEach, siehe runIndentChange):      */
/*  - Überschrift -> No-op (Auftrag: Überschriften werden NIE eingerückt,   */
/*    siehe DECISIONS/lib/markdown.jsx#parseTree – sie sind zeilenanfangs-  */
/*    verankert, eine eingerückte Überschrift würde die gesamte Gliederung  */
/*    zerlegen).                                                           */
/*  - Absatz/Bild -> "indent"-Attribut ±1, geklemmt auf 0..6.               */
/*  - Aufzählung/Nummerierung/Checkliste -> sinkListItem/liftListItem des   */
/*    Item-Typs, der am INNERSTEN Listenpunkt-Vorfahren der SELEKTION       */
/*    (nicht des Top-Level-Blocks!) hängt – bei einer Bullet-Liste          */
/*    INNERHALB eines taskItem ("- [ ] Eltern" mit eingerückter Aufzählung  */
/*    als Kind) ist der Top-Level-Node "taskList", aber der relevante Item- */
/*    Typ "listItem" (siehe Blocker-1-Fix, Code-Review vor v7.41-Commit –   */
/*    der Top-Level-Typ hätte hier fälschlich den ganzen Checkbox-          */
/*    Elternpunkt aus der Liste gehoben). sinkListItem/liftListItems eigene */
/*    $from.blockRange-Logik deckt eine Mehrfachauswahl INNERHALB EINER     */
/*    Liste bereits selbst ab, auch über verschiedene Ebenen hinweg.        */
/*  - alles andere (Tabelle/Trennlinie/Codeblock/Formel-Block) -> No-op,    */
/*    nicht Teil dieses Auftrags (siehe DECISIONS, bewusste Grenze).        */
/*                                                                          */
/* NACHBESSERUNG v7.44 (Finding B1 aus v7.42, DECISIONS #86, Nutzer-        */
/* Befund "verhält sich komisch, wenn ich das in einem Block mache, der     */
/* eine Checkbox oder Aufzählung hat"): Ein Top-Level-Absatz/-Bild/         */
/* -Formel, der/die per "indent"-Attribut auf Ebene 1 gebracht wird (2      */
/* Leerzeichen) UND unmittelbar (nur Leerzeile dazwischen) einer Liste mit  */
/* 2-Zeichen-Marker ("-"/"* "/"- [ ] ") folgt, ergab beim SPEICHERN exakt   */
/* denselben Rohtext wie eine STRUKTURELLE Fortsetzung desselben            */
/* Listenpunkts (CommonMark "lazy continuation" entscheidet rein über die   */
/* Spalten-Tiefe) – der nächste Ladevorgang deutete das Attribut deshalb    */
/* IMMER in Struktur um, und Knopf-/Tab-Verhalten wechselten dadurch        */
/* unbemerkt zwischen zwei Sitzungen. v7.42 hat das nur DOKUMENTIERT (siehe */
/* DECISIONS #86, Finding B1) – dieser Auftrag löst es stattdessen auf:     */
/* runIndentChange wählt in GENAU dieser Position SOFORT die strukturelle   */
/* Variante (Block wird realer, zusätzlicher Kind-Knoten des LETZTEN        */
/* Listenpunkts der unmittelbar VORANGEHENDEN Top-Level-Liste), statt das   */
/* Attribut zu setzen – der Nutzer sieht dadurch sofort das Endergebnis,    */
/* und ein Reload ändert weder Knopf-Zustand noch Tab-Wirkung mehr. Der     */
/* Rückweg (Einzug verkleinern auf einem SO entstandenen – oder aus einem   */
/* alten Dokument SO geladenen – Block) löst NUR diesen Block wieder aus    */
/* dem Listenpunkt heraus (als neuer Top-Level-Nachbar direkt NACH der      */
/* Liste), statt wie bisher den GANZEN Listenpunkt zu heben (das war das    */
/* eigentliche "komisch": der Knopf "Einzug verkleinern" traf den falschen  */
/* Umfang). Beide Richtungen sind AUSSCHLIESSLICH auf bulletList/taskList   */
/* beschränkt (siehe trailingContinuationRun/chainList unten) – eine        */
/* nummerierte Liste mit "1. " (Content-Spalte 3) kennt diese Ambiguität    */
/* nicht (2 Leerzeichen reichen dort nicht zum Verschlucken, siehe DECISIONS*/
/* #86) und bleibt bewusst UNANGETASTET, sonst entstünde dort eine          */
/* Inkonsistenz, die es vorher nicht gab. "chainList" (siehe runIndentChange*/
/* unten) verkettet mehrere aufeinanderfolgende, gemeinsam ausgewählte      */
/* Top-Level-Blöcke (Nutzerfall "Bild UND Bildunterschrift in einem Rutsch  */
/* einrücken") in denselben Listenpunkt UND bricht bewusst ab, sobald die   */
/* anfangende Liste selbst TEIL derselben Selektion ist (Finding B2, siehe  */
/* DECISIONS #86) – eine gleichzeitig sinkende/hebende Liste UND ein        */
/* strukturell aufzunehmender Nachbar in EINER Aktion bleibt unverändert    */
/* beim bisherigen (bereits getesteten, nicht-destruktiven) Attribut-Weg,   */
/* um dieses seltene, bereits als unkritisch dokumentierte Zusammenspiel    */
/* nicht zusätzlich zu verändern (empirisch geprüft: für das konkrete       */
/* Finding-B2-Beispiel wäre das TEXTUELLE Endergebnis sogar identisch, egal */
/* ob die Kette hier bricht oder nicht – die Grenze ist trotzdem bewusst    */
/* gezogen, um den Diff auf den GEMELDETEN Fall/Finding B1 zu beschränken,  */
/* statt implizit auch Finding B2 anzufassen, das NICHT Teil dieses         */
/* Auftrags ist).                                                          */
/*                                                                          */
/* EIN gemeinsames "tr" für die GESAMTE Auswahl (Auftrag: ein Undo-Schritt) */
/* – aber sinkListItem/liftListItem (prosemirror-schema-list) sind fertige  */
/* Commands, die IMMER an einen frischen "state.tr" gebunden sind, nicht an */
/* unser gemeinsames "tr". Lösung: pro Listen-Block einen TEMPORÄREN State  */
/* mit doc=tr.doc (dem bereits akkumulierten Zwischenstand der VORHERIGEN   */
/* Blöcke dieser Auswahl) aufbauen, das Kommando NUR DORT ausführen und     */
/* seine Schritte auf "tr" replizieren (tr.step(step)) – da beide Dokumente */
/* zum Aufrufzeitpunkt identisch sind, passen die Positionen ohne weiteres  */
/* Mapping. "dryRun" (siehe canChangeIndent) durchläuft dieselbe Logik ohne */
/* zu dispatchen – für die Deaktivierung der Toolbar-Knöpfe.                */
// BUGFIX (v7.41.1, 🔴 Blocker 1 aus dem E2E-Lauf von v7.41): "Bild wird bei
// Mehrfachauswahl NICHT mit eingerückt, nur die Bildunterschrift". Ursache
// liegt NICHT in runIndentChange selbst (die "touches"-Prüfung unten
// arbeitet korrekt mit dem, was sie an Selektion bekommt), sondern EINE
// EBENE VORHER: ProseMirror übersetzt eine ECHTE Browser-Mausselektion über
// TextSelection.between() in ein Selection-Objekt (siehe prosemirror-view#
// selectionBetween – GENAU der Weg, den JEDE Mausselektion im Editor nimmt,
// reproduziert und verifiziert per Unit-Test mit echtem TextSelection.between
// statt nur editor.commands.setTextSelection(), das diesen Effekt NICHT
// auslöst). Landet ein Selektionsende exakt auf einer Blockgrenze vor einem
// BLATT-Knoten ohne Inline-Inhalt (Bild/Formel – kein Text, kein eigener
// Inhalt), sucht TextSelection.between automatisch vorwärts die nächste
// gültige TEXT-Position (Selection.findFrom mit textOnly=true, siehe
// prosemirror-state#findSelectionIn) – ein Blatt-Knoten wird dabei NIE als
// Zwischenziel akzeptiert und einfach übersprungen. Der Kernfall des
// Nutzers (Zeilenende VOR einem Bild anklicken, bis ans Ende der direkt
// folgenden kursiven Bildunterschrift aufziehen) landet dadurch mit "from"
// bereits INNERHALB der Bildunterschrift – das Bild liegt in der
// resultierenden Selektion vollständig VOR "from" und gilt für
// runIndentChange als "nicht berührt", obwohl der Klick es erkennbar
// einschließen sollte.
//
// Fix: Steht "from" (bzw. "to") GENAU an der jeweils äußersten (ersten/
// letzten) erreichbaren Position eines Top-Level-Blocks – also exakt dort,
// wo Selection.findFrom bei seiner rekursiven "immer den ersten/letzten
// Kind-Knoten nehmen"-Suche landen würde –, wird die Grenze so lange auf
// den vorherigen/nächsten Top-Level-Nachbarn ausgedehnt, wie DER inhaltslos
// UND nicht inline-fähig ist (exakt das Kriterium, unter dem
// findSelectionIn einen Knoten überspringt statt hineinzusteigen). Das
// deckt Bild UND Formel ab, ohne die Typen hart zu verdrahten. Ein reiner
// Cursor (from===to) bleibt unangetastet – Blocker 1 betrifft ausschließlich
// echte Mehrfachauswahlen. Symmetrisch für "to" ergänzt (Spiegelfall: von
// unten nach oben über ein Bild hinweg aufziehen), auch wenn der gemeldete
// Fall nur die Vorwärts-Richtung betraf.
function isLeafmostBoundary(doc, pos, forward) {
  const $pos = doc.resolve(pos);
  if ($pos.depth === 0) return false; // Rand des gesamten Dokuments
  const offset = forward ? $pos.parentOffset : $pos.parent.content.size - $pos.parentOffset;
  if (offset !== 0) return false;
  for (let d = $pos.depth; d > 1; d--) {
    const idx = $pos.index(d - 1);
    const siblingCount = $pos.node(d - 1).childCount;
    if (forward ? idx !== 0 : idx !== siblingCount - 1) return false;
  }
  return true;
}
function isSkippableLeaf(node) {
  return !node.inlineContent && node.content.size === 0;
}
function extendPastSkippedLeaves(doc, from, to) {
  if (from >= to) return { from, to }; // nur echte Range betroffen (Blocker 1)
  let f = from, t = to;
  if (isLeafmostBoundary(doc, f, true)) {
    let boundary = doc.resolve(f).before(1);
    for (;;) {
      const prev = boundary > 0 ? doc.resolve(boundary).nodeBefore : null;
      if (!prev || !isSkippableLeaf(prev)) break;
      boundary -= prev.nodeSize;
      f = boundary;
    }
  }
  if (isLeafmostBoundary(doc, t, false)) {
    let boundary = doc.resolve(t).after(1);
    for (;;) {
      const next = boundary < doc.content.size ? doc.resolve(boundary).nodeAfter : null;
      if (!next || !isSkippableLeaf(next)) break;
      boundary += next.nodeSize;
      t = boundary;
    }
  }
  return { from: f, to: t };
}

// Liefert den zusammenhängenden "Suffix" an Continuation-Kindern (Absatz/
// Bild/Formel – KEINE Unterliste) am ENDE des LETZTEN Listenpunkts von
// "listNode" (v7.44, siehe Kopfkommentar oben) – z. B. Bild+Bildunterschrift,
// die gemeinsam als Fortsetzung angehängt wurden. Index 0 (der PRIMÄRE
// Inhalt des Punkts, z. B. der Bullet-/Checkbox-Text selbst) wird NIE
// eingeschlossen (Schleife läuft nur bis Index 1). null, wenn der letzte
// Punkt gar kein solches Suffix hat (z. B. nur ein einzelnes Kind, oder das
// letzte Kind ist selbst eine verschachtelte Liste – siehe "Bullet unter
// Checkbox"-Fall, DECISIONS #86, der bewusst UNVERÄNDERT bleibt).
// "items" listet JEDES Continuation-Kind EINZELN mit seinem eigenen
// {from,to} (Reihenfolge wie im Dokument) – runIndentChange nutzt das, um
// GENAU ab dem Kind zu extrahieren, das die Selektion zuerst berührt
// (Cursor NUR in der Bildunterschrift löst NUR sie heraus; eine Auswahl,
// die schon beim Bild beginnt, zieht die Unterschrift automatisch mit,
// weil beides bis "to" zusammenhängt – "Bild UND Bildunterschrift … müssen
// weiterhin gemeinsam funktionieren", Auftrag).
function trailingContinuationRun(listNode, listPos) {
  if (listNode.childCount === 0) return null;
  const lastItem = listNode.lastChild;
  const isContinuation = (n) =>
    n.type.name === "paragraph" || n.type.name === "image" || n.type.name === "mathBlock";
  let count = 0;
  for (let i = lastItem.childCount - 1; i >= 1; i--) {
    if (!isContinuation(lastItem.child(i))) break;
    count++;
  }
  if (count === 0) return null;
  // itemEnd = Ende des LETZTEN Listenpunkts = Ende des Listeninhalts
  // (listPos + nodeSize der Liste - 1, siehe Positions-Arithmetik oben bei
  // extendPastSkippedLeaves/isLeafmostBoundary: ein Knoten mit Startposition
  // p und Größe s belegt [p, p+s), sein Inhalt [p+1, p+s-1)).
  const itemEnd = listPos + listNode.nodeSize - 1;
  const itemStart = itemEnd - lastItem.nodeSize;
  let cursor = itemStart + 1;
  for (let i = 0; i < lastItem.childCount - count; i++) cursor += lastItem.child(i).nodeSize;
  const runStart = cursor;
  const items = [];
  for (let i = lastItem.childCount - count; i < lastItem.childCount; i++) {
    const child = lastItem.child(i);
    items.push({ from: cursor, to: cursor + child.nodeSize });
    cursor += child.nodeSize;
  }
  return { from: runStart, to: itemEnd - 1, items };
}

function runIndentChange(editor, delta, dryRun) {
  if (!editor) return false;
  const { state } = editor;
  const { doc, schema } = state;
  const { from, to } = extendPastSkippedLeaves(doc, state.selection.from, state.selection.to);
  const tr = state.tr;
  let applied = false;

  // "chainList" (v7.44, siehe Kopfkommentar): {pos,end,touched} der
  // ZULETZT durchlaufenen Top-Level-Liste mit 2-Zeichen-Marker, SOLANGE der
  // seitdem durchlaufene Weg NUR aus genau dieser Liste selbst und/oder
  // durch SIE selbst strukturell aufgenommenen Blöcken besteht – jeder
  // ANDERE Blocktyp (Überschrift, leerer Absatz, ein nicht aufgenommener
  // Absatz/Bild z. B. weil er schon indent>0 trägt, Tabelle, orderedList
  // …) setzt sie unten explizit auf null zurück und bricht die Kette damit
  // für alles Nachfolgende. "touched" hält fest, ob DIESE Liste selbst Teil
  // der aktuellen Selektion war (Finding B2, DECISIONS #86) – nur dann,
  // wenn sie es NICHT war, darf ein direkt folgender Block strukturell
  // aufgenommen werden (siehe Kopfkommentar, "Nachbesserung v7.44").
  let chainList = null;

  doc.forEach((node, pos) => {
    const end = pos + node.nodeSize;
    // "Berührt" die Auswahl? Bei einer echten Range (from<to) ZÄHLT reines
    // Aneinandergrenzen NICHT (sonst würde ein direkt VOR/NACH der Auswahl
    // liegender Block fälschlich mit einbezogen). Bei einem reinen Cursor
    // (from===to, der Normalfall bei Tab/Klick ohne Auswahl) zählt auch das
    // exakte Antreffen einer Blockgrenze (seltener Randfall, z. B. Cursor
    // exakt zwischen zwei Blöcken) – lieber einmal zu viel als gar nicht.
    const touches = from === to ? pos <= from && from <= end : pos < to && end > from;

    // Chain-Fortschreibung PASSIERT UNABHÄNGIG von "touches"/frühen Returns
    // unten (die strukturelle Nachbarschaft im Dokument existiert unabhängig
    // von der aktuellen Selektion) – siehe Kommentar bei "chainList" oben.
    const priorChain = chainList;
    chainList =
      node.type.name === "bulletList" || node.type.name === "taskList"
        ? { pos, end, touched: touches }
        : null;

    if (!touches) return;

    if (node.type.name === "heading") return; // No-op, siehe Kopfkommentar

    // BUGFIX (Re-Review vor v7.41-Commit, 🔵 Finding H): Ein LEERER Absatz
    // (z. B. ein frisches Dokument oder eine Leerzeile, auf der der Cursor
    // steht) ließ sich bisher trotzdem einrücken – IndentParagraph schreibt
    // den Einzug beim Speichern IMMER vor den (hier leeren) Inhalt, das
    // Ergebnis war eine Zeile aus REINEN Leerzeichen im committeten
    // Markdown (in der Ansicht unsichtbar, aber eine Whitespace-only-Zeile
    // im Dokument). No-op für einen leeren Absatz macht zugleich den
    // Knopf-Zustand (canChangeIndent) korrekt ausgegraut.
    if (node.type.name === "paragraph" && node.content.size === 0) return;

    // "mathBlock" (Re-Review vor v7.41-Commit, 🔵 Finding F) ergänzt:
    // MathBlock trägt seit Finding 6 (Formel-Einzug-Roundtrip) ebenfalls
    // ein "indent"-Attribut (0..6, dieselbe Klemmung wie bei Absatz/Bild
    // über indentAttrSpec) – ohne diese Ergänzung ließe sich eine z. B.
    // per Chat/API bereits eingerückt angelegte Formel im Editor weder
    // weiter einrücken noch zurücknehmen (canChangeIndent immer false).
    if (node.type.name === "paragraph" || node.type.name === "image" || node.type.name === "mathBlock") {
      const mappedPos = tr.mapping.map(pos);
      const cur = tr.doc.nodeAt(mappedPos);
      if (!cur) return;
      const curIndent = cur.attrs.indent || 0;

      // NACHBESSERUNG v7.44 (Finding B1, siehe Kopfkommentar): Ebene 0 -> 1
      // GENAU dann NICHT über das Attribut lösen, sondern SOFORT strukturell
      // in den letzten Punkt der unmittelbar vorangehenden Liste aufnehmen,
      // wenn diese Liste NICHT selbst Teil der aktuellen Selektion ist
      // (sonst bleibt es beim bisherigen Attribut-Weg, siehe "touched" oben
      // und Finding B2/DECISIONS #86).
      if (delta > 0 && curIndent === 0 && priorChain && !priorChain.touched) {
        applied = true;
        if (!dryRun) {
          const mFrom = tr.mapping.map(pos);
          const mTo = tr.mapping.map(end);
          const movedNode = tr.doc.nodeAt(mFrom);
          if (movedNode) {
            tr.delete(mFrom, mTo);
            // "mFrom" ist ZU DIESEM ZEITPUNKT (nach dem Löschen des
            // aufzunehmenden Blocks, aber ohne jede weitere Änderung) exakt
            // die Position DIREKT NACH der vorangehenden Liste – bei EINEM
            // einzelnen aufgenommenen Block, weil er als echtes Top-Level-
            // Geschwister direkt an deren Ende grenzte (Löschen selbst
            // verschiebt "mFrom" nicht, es trifft nur Positionen >= mFrom).
            // Bei einer VERKETTETEN Aufnahme (chainList bleibt bestehen,
            // z. B. Bild GEFOLGT von Bildunterschrift in derselben Auswahl)
            // gilt dieselbe Invariante induktiv weiter: der bereits
            // aufgenommene Vorgänger (hier das Bild) wurde exakt an dieser
            // Stelle in die Liste eingefügt, wodurch ihr Ende wieder GENAU
            // an die (unveränderte) Position des NÄCHSTEN Blocks (hier die
            // Bildunterschrift) heranrückt – Löschen und erneutes Einfügen
            // gleicher Länge heben sich für alles DANACH liegende exakt auf.
            // "-2" führt von dort GENAU einen Schritt VOR das schließende
            // Tag der Liste UND das des letzten Listenpunkts hinein
            // (Herleitung siehe trailingContinuationRun oben, hier
            // spiegelbildlich) – der Block wird dadurch neues, LETZTES Kind
            // des letzten Listenpunkts, kein neuer Listenpunkt.
            const insertAt = mFrom - 2;
            tr.insert(insertAt, movedNode);
            tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(insertAt + 1, tr.doc.content.size))));
          }
        }
        chainList = priorChain; // Kette bleibt bestehen (z. B. Bild UND Bildunterschrift in einem Rutsch).
        return;
      }

      const next = Math.max(0, Math.min(6, curIndent + delta));
      if (next === curIndent) return;
      applied = true;
      if (!dryRun) tr.setNodeMarkup(mappedPos, undefined, { ...cur.attrs, indent: next });
      return;
    }

    if (node.type.name === "bulletList" || node.type.name === "orderedList" || node.type.name === "taskList") {
      // NACHBESSERUNG v7.44 (Rückweg des obigen Struktur-Wechsels, siehe
      // Kopfkommentar): Liegt die GESAMTE Selektion innerhalb des
      // Continuation-Suffix des LETZTEN Listenpunkts (Absatz/Bild/Formel,
      // KEINE Unterliste – trailingContinuationRun), wird NUR dieses Suffix
      // wieder herausgelöst, statt (wie die generische sink/lift-Logik
      // unten es täte) den GANZEN Listenpunkt aus der Liste zu heben.
      // orderedList bleibt bewusst ausgenommen (siehe Kopfkommentar).
      if (delta < 0 && node.type.name !== "orderedList") {
        const run = trailingContinuationRun(node, pos);
        if (run && from >= run.from && to <= run.to) {
          applied = true;
          if (!dryRun) {
            // Extraktion beginnt NICHT zwingend am Suffix-Anfang, sondern am
            // Anfang des Kindes, das "from" tatsächlich enthält – ein Cursor
            // NUR in der Bildunterschrift (dem letzten Kind) löst dadurch NUR
            // sie heraus, während eine Selektion, die schon beim Bild
            // beginnt, beide gemeinsam extrahiert (siehe Kommentar bei
            // trailingContinuationRun). Fallback (letztes Element) deckt den
            // Randfall "from === run.to" ab (Cursor exakt an der äußersten
            // Grenze).
            let start = run.items[run.items.length - 1].from;
            for (const it of run.items) {
              if (from < it.to) { start = it.from; break; }
            }
            const mFrom = tr.mapping.map(start);
            const mTo = tr.mapping.map(run.to);
            const slice = tr.doc.slice(mFrom, mTo);
            tr.delete(mFrom, mTo);
            // "end" (ORIGINAL-Position direkt NACH der GESAMTEN Liste) jetzt
            // (nach dem Löschen) mappen – ergibt die aktuelle Position direkt
            // nach der (durch das Löschen geschrumpften) Liste, exakt dort
            // soll das Suffix als neuer Top-Level-Nachbar wieder auftauchen.
            const insertAt = tr.mapping.map(end);
            tr.insert(insertAt, slice.content);
            tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(insertAt + 1, tr.doc.content.size))));
          }
          return;
        }
      }

      const innerFrom = tr.mapping.map(Math.max(from, pos + 1));
      const innerTo = tr.mapping.map(Math.min(to, end - 1));
      if (innerFrom > innerTo) return;
      // BUGFIX (Code-Review vor v7.41-Commit, 🔴 Blocker 1): der Item-Typ
      // darf NICHT aus dem TOP-LEVEL-Node abgeleitet werden – bei
      // "- [ ] Eltern" mit einer eingerückten PLAIN-Aufzählung als Kind
      // (siehe A2, TaskItem.configure({nested:true})) ist der Top-Level-Node
      // "taskList", die Selektion steckt aber in einem "listItem" (der
      // Bullet-Liste INNERHALB des taskItem). liftListItem(taskItem) hätte
      // dann den GESAMTEN Checkbox-Elternpunkt aus der Liste gehoben (Text
      // statt Checkbox, stiller Inhaltsverlust) statt nur den inneren
      // Listenpunkt. Stattdessen den INNERSTEN Listenpunkt-Vorfahren der
      // tatsächlichen Selektion auflösen ("listItem" ODER "taskItem", je
      // nachdem was näher an der Selektion liegt).
      const $inner = tr.doc.resolve(innerFrom);
      let itemType = null;
      for (let d = $inner.depth; d > 0 && !itemType; d--) {
        const n = $inner.node(d);
        if (n.type.name === "listItem" || n.type.name === "taskItem") itemType = n.type;
      }
      if (!itemType) return;
      const sel = TextSelection.between(tr.doc.resolve(innerFrom), tr.doc.resolve(innerTo));
      const tempState = EditorState.create({ doc: tr.doc, selection: sel, schema });
      const cmd = delta > 0 ? sinkListItem(itemType) : liftListItem(itemType);
      if (dryRun) {
        if (cmd(tempState)) applied = true;
        return;
      }
      let captured = null;
      if (cmd(tempState, (trx) => { captured = trx; }) && captured) {
        captured.steps.forEach((step) => tr.step(step));
        applied = true;
      }
      return;
    }
    // Tabelle/Trennlinie/Codeblock: bewusst kein Einzugsziel (siehe
    // Kopfkommentar) – No-op. Der Formel-Block ist seit Finding F oben
    // ausdrücklich AUSGENOMMEN, er wird dort behandelt.
  });

  if (!applied) return false;
  if (!dryRun) editor.view.dispatch(tr);
  return true;
}

// Löst den Einzug für die aktuelle Auswahl aus (Toolbar-Klick/Tab). Gibt
// zurück, ob tatsächlich etwas geändert wurde (analog jumpToHeading/
// moveOutlineRange oben) – Tab/Shift-Tab (siehe IndentKeymap unten) nutzen
// das, um bei "false" die bestehenden Bindungen (Tabelle: goToNextCell) bzw.
// den Browser-Default NICHT zu blockieren. AUSNAHME seit dem Re-Review vor
// dem v7.41-Commit (🟡 Finding A): steht die Auswahl in einer Top-Level-
// Liste, schluckt IndentKeymap den Tastendruck auch bei "false" bewusst –
// sonst rückten die eingebauten ListItem-/TaskItem-Bindungen einen ÄUSSEREN
// Listenpunkt ein, während der Toolbar-Knopf ausgegraut war (siehe
// inTopLevelList unten).
export function changeIndent(editor, delta) {
  return runIndentChange(editor, delta, false);
}

// Reine Machbarkeits-Prüfung OHNE jede Dokumentänderung – für das
// Ausgrauen der Toolbar-Knöpfe (z. B. der erste Listenpunkt einer Liste
// lässt sich nicht weiter einrücken, Einzug 0 nicht verkleinern).
export function canChangeIndent(editor, delta) {
  return runIndentChange(editor, delta, true);
}

// Tab/Shift-Tab (Auftrag). "priority: 1001" (Code-Review vor v7.41-Commit,
// Nachbesserung zu Blocker 1) statt sich auf die Position in der
// useEditor()-Extensions-Liste zu verlassen: TipTap sortiert Extensions vor
// dem Bau der ProseMirror-Plugins nach "priority" (höher zuerst, Default
// 100, siehe ExtensionManager.sort in @tiptap/core) – VOR v7.41 stand
// IndentKeymap deshalb bewusst als ERSTES Element der Liste, weil die
// Plugin-Reihenfolge für gleiche Priorität durch ein Reverse+Stable-Sort
// entsteht ("zuerst gelistet" -> "zuletzt versucht"). Diese Reihenfolge-
// Argumentation war KORREKT, aber zerbrechlich (jede spätere Umsortierung
// der Liste hätte sie lautlos gebrochen) UND sie machte unser eigenes
// Kommando zum reinen FALLBACK – TaskItem ist in derselben Liste NACH
// StarterKit gelistet und hatte dadurch (vor diesem Fix) höhere Priorität
// als ListItem, wodurch "Shift-Tab: liftListItem('taskItem')" bei einer
// Bullet-Liste INNERHALB eines taskItem gewann, statt an das korrigierte
// runIndentChange durchzureichen (siehe Blocker 1). Ein expliziter
// priority-Wert weit über dem Default macht IndentKeymap jetzt bewusst zum
// PRIMÄREN Handler für Tab/Shift-Tab – gefahrlos, weil runIndentChange für
// Tabellen-Auswahlen strukturell "false" liefert (kein "table"-Zweig, siehe
// dort) und die ProseMirror-Keymap-Kette dann wie bisher an die nächste
// Bindung (goToNextCell der Table-Extension) durchreicht; ebenso bei einer
// Überschrift/einem bereits maximal eingerückten Block (siehe unten).
//
// BUGFIX (Re-Review vor v7.41-Commit, 🟡 Finding A): "priority: 1001" allein
// löst NICHT das gesamte Problem – liefert changeIndent() "false" (z. B.
// weil sinkListItem/liftListItem für den INNERSTEN Listenpunkt der
// Selektion nicht greift), reicht die ProseMirror-Keymap-Kette den
// Tastendruck an die NÄCHSTE Bindung durch – und das sind TaskItems/
// ListItems EIGENE Tab/Shift-Tab-Bindungen (this.editor.commands.
// sinkListItem/liftListItem(this.name), siehe node_modules/@tiptap/
// extension-task-item, node_modules/@tiptap/extension-list-item). Die
// arbeiten NICHT auf dem innersten Listenpunkt, sondern auf dem, den
// $from.blockRange($to, node => node.firstChild.type == itemType) für
// GENAU IHREN EIGENEN Item-Typ zuerst findet – bei gemischter
// Verschachtelung (Checkliste mit eingerückter Aufzählung als Kind oder
// umgekehrt) ist das ein ANDERER, meist ÄUSSERER Listenpunkt als der, auf
// dem der Cursor tatsächlich steht (gemessen: Cursor auf dem innersten
// Punkt, Tab sinkt einen ÄUSSEREN Geschwister-Punkt samt seiner Kinder).
// Kein Datenverlust (roundtrip-stabil, Strg+Z stellt das Original wieder
// her), aber Knopf-Zustand (ausgegraut) und tatsächliches Tab-Verhalten
// widersprechen sich, UND Tab rückt sichtbar den falschen Block ein.
// Fix: Tab/Shift-Tab INNERHALB einer Top-Level-Liste (bulletList/
// orderedList/taskList als direktes Kind von doc, also GENAU der Bereich,
// den runIndentChange über doc.forEach() überhaupt betrachtet) schlucken
// (true zurückgeben), SOBALD changeIndent() nichts geändert hat – die
// Tastenkombination bleibt dadurch bewusst wirkungslos, statt an eine
// Bindung durchzureichen, die den falschen Block träfe. Tabellen bleiben
// unberührt: dort ist $from.node(1) eine "table", nicht eine Liste, die
// Kette reicht an goToNextCell durch wie bisher.
function inTopLevelList(state) {
  const { $from } = state.selection;
  return $from.depth > 0 &&
    ["bulletList", "orderedList", "taskList"].includes($from.node(1).type.name);
}

// BUGFIX (v7.41.1, 🔵 Finding 5 aus dem E2E-Lauf von v7.41): Tab in einer
// Überschrift ist für runIndentChange ein inhaltliches No-op (Überschriften
// werden nie eingerückt, siehe Kopfkommentar dort) – changeIndent() liefert
// dafür "false", UND inTopLevelList() greift hier nicht (eine Überschrift
// ist keine Liste), wodurch die ProseMirror-Keymap-Kette an den
// Browser-Standard durchreicht: Tab verlässt den Editor-Fokus komplett.
// Entscheidung (siehe DECISIONS): SCHLUCKEN, konsistent zum bereits
// etablierten Verhalten in Top-Level-Listen (siehe inTopLevelList/Finding A
// oben) – ein rein visuelles No-op soll den Tastaturfokus nicht aus dem
// Editor werfen, das wäre für Tastatur-Nutzer überraschender als ein
// wirkungsloser Tastendruck. Der Editor bleibt über andere Wege verlassbar
// (Klick außerhalb, Speichern/Abbrechen-Knöpfe), Tab war dafür nie die
// dokumentierte Route.
//
// BUGFIX (v7.41.2, 🔵 Restrisiko aus dem Review vor dem v7.41.1-Commit,
// gemessen statt nur vermutet): "state.selection.$from.parent" ist der
// INNERSTE umschließende Block, unabhängig von dessen Verschachtelungs-
// tiefe – steht der Cursor in einer Tabellenzelle, deren Block per
// Toolbar-Knopf zu einer Überschrift gemacht wurde (Zelleninhalt ist
// laut Schema ein Block, "heading" ist als solcher zulässig), lieferte
// diese Prüfung fälschlich "true" und ließ IndentKeymap Tab/Shift-Tab
// SCHLUCKEN, obwohl gar keine Top-Level-Überschrift vorliegt – Tables
// eigene goToNextCell/addRowAfter-Bindungen (siehe inTopLevelList direkt
// oberhalb, "Kette reicht an goToNextCell durch wie bisher") kamen dadurch
// innerhalb einer solchen Zelle nie mehr zum Zug. Fix analog
// inTopLevelList: NUR die oberste Ebene (direktes Kind von doc) zählt als
// "Überschrift" im Sinne dieser Regel – eine Überschrift, die ihrerseits
// in einer Tabellenzelle steckt, hat dort $from.node(1).type.name ===
// "table", nicht "heading".
function inHeading(state) {
  const { $from } = state.selection;
  return $from.depth > 0 && $from.node(1).type.name === "heading";
}

export const IndentKeymap = Extension.create({
  name: "indentKeymap",
  priority: 1001,
  addKeyboardShortcuts() {
    const run = (delta) => () =>
      changeIndent(this.editor, delta) || inTopLevelList(this.editor.state) || inHeading(this.editor.state);
    return {
      Tab: run(1),
      "Shift-Tab": run(-1),
    };
  },
});

/* ---------------------------------------------------------------------- */
/* Listentyp eines (ggf. verschachtelten) Listenpunkts umwandeln (v7.41.1, */
/* 🔴 Blocker 2 aus dem E2E-Lauf von v7.41): "Stichpunktliste"/"Nummerierte */
/* Liste"/"Checkliste" (Toolbar-Knöpfe UND deren Tastenkürzel, siehe        */
/* NestedListToggle-Extension unten) riefen bisher TipTaps eingebaute       */
/* toggleBulletList/toggleOrderedList/toggleTaskList-Kommandos auf, die     */
/* intern @tiptap/core#toggleList nutzen. toggleList behandelt NUR den      */
/* Fall "Selektion + ihr NÄCHSTER umschließender Listen-Vorfahre" – bei     */
/* einem VERSCHACHTELTEN Listenpunkt (z. B. ein Checkbox-Elternpunkt mit    */
/* zwei eingerückten Checklisten-Kindern, seit TaskItem.configure(          */
/* {nested:true}) überhaupt erst erreichbar, siehe DECISIONS) ist dieser    */
/* NÄCHSTE Vorfahre die INNERE (verschachtelte) Liste. toggleList prüft für */
/* "Listentyp wechseln" zwar zuerst tr.setNodeMarkup() (reine Typ-Änderung  */
/* AN ORT UND STELLE), das schlägt aber immer fehl, weil die vorhandenen    */
/* Kind-Knoten (z. B. "taskItem") nicht zum Content-Schema des Zieltyps     */
/* ("bulletList" erwartet "listItem") passen (listType.validContent(...)   */
/* liefert false) – toggleList fällt danach auf commands.clearNodes() +     */
/* wrapInList() zurück. clearNodes() entfernt SÄMTLICHE Block-Verschach-    */
/* telung der betroffenen Selektion (nicht nur eine Ebene), wrapInList()    */
/* baut danach nur die BERÜHRTEN Punkte neu ein – das komplette Eltern-     */
/* Kind-Gefüge (inkl. UNBERÜHRTER Geschwisterpunkte!) geht verloren, alle   */
/* Punkte landen als getrennte Top-Level-Listen (siehe Ursachenanalyse im   */
/* Abschlussbericht).                                                      */
/*                                                                          */
/* Fix: eine EIGENE, verschachtelungserhaltende Umsetzung. Statt "heraus-   */
/* heben + neu einwickeln" wird die UMSCHLIESSENDE Liste direkt an Ort und  */
/* Stelle in bis zu DREI Geschwister-Listen AUFGETEILT ("davor" im          */
/* Original-Typ unverändert / "die betroffenen Punkte" im NEUEN Zieltyp /   */
/* "danach" im Original-Typ unverändert) – exakt wie ein Fließtext-Absatz   */
/* eine Liste in Markdown "durchtrennen" würde. Nur die tatsächlich         */
/* ausgewählten Punkte wechseln den Typ, alles andere (inkl. der ÄUSSEREN   */
/* Verschachtelung, z. B. der Checkbox-Elternpunkt) bleibt strukturell      */
/* exakt an seinem Platz.                                                  */
function nearestListItemAncestor(state) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === "listItem" || n.type.name === "taskItem") return n.type;
  }
  return null;
}

// Reines ProseMirror-Kommando (state, dispatch) => boolean – GENAU wie
// sinkListItem/liftListItem selbst oder tiptaps eigenes clearNodes (siehe
// node_modules/@tiptap/core/src/commands/clearNodes.ts) aufgebaut: arbeitet
// AUSSCHLIESSLICH über den übergebenen "tr" und ruft "dispatch(tr)" nur bei
// tatsächlicher Anwendung auf. WICHTIG: Ein direkter editor.view.dispatch()
// wäre hier ein eigener Bugfix wert gewesen – innerhalb einer
// editor.chain()...run()-Kette baut tiptap EINE gemeinsame Transaktion über
// mehrere Kommandos hinweg auf und dispatcht sie erst am Ende; ein
// zwischenzeitlicher, eigenständiger view.dispatch() lässt den Rest der
// Kette auf einem bereits veralteten State aufsetzen ("Applying a mismatched
// transaction", beim Testschreiben selbst gefunden und hier vermieden).
// "listAttrs" (z. B. {} für bulletList/taskList) wird NUR auf den neuen
// Zieltyp-Teil angewendet – "davor"/"danach" behalten die Original-Attribute
// (z. B. "tight") der umschlossenen Liste unverändert.
function convertListItemTypeCommand(targetListTypeName, targetItemTypeName, listAttrs) {
  return (state, dispatch) => {
    const { schema } = state;
    const { $from, $to } = state.selection;
    const targetListType = schema.nodes[targetListTypeName];
    const targetItemType = schema.nodes[targetItemTypeName];
    if (!targetListType || !targetItemType) return false;

    const itemType = nearestListItemAncestor(state);
    // Kein Listenpunkt an der Selektion: kein Sonderfall dieses Blockers –
    // das native toggleList (siehe NestedListToggle unten) erledigt "neue
    // Liste anlegen"/"Liste komplett entfernen" bereits korrekt.
    if (!itemType) return false;

    // GENAU derselbe Bereichs-Finder wie sinkListItem/liftListItem selbst
    // (prosemirror-schema-list) – deckt Cursor UND Mehrfachauswahl über
    // mehrere Geschwister-Punkte hinweg identisch ab.
    const range = $from.blockRange($to, (node) => node.childCount > 0 && node.firstChild.type === itemType);
    if (!range) return false;
    const listNode = range.parent;

    if (listNode.type.name === targetListTypeName) {
      // Zieltyp bereits aktiv: unverändertes Bestandsverhalten ("Knopf
      // erneut klicken" hebt die betroffenen Punkte aus der Liste, wie es
      // die native toggleList-Logik für diesen Fall ohnehin schon vorsieht).
      return liftListItem(itemType)(state, dispatch);
    }

    // GRENZFALL, BIS v7.41.1 hier per No-op abgesichert, seit v7.41.2
    // ENTFALLEN (siehe DECISIONS): "davor"/"Zielteil"/"danach" landen beim
    // Speichern als DREI TEXTUELL UNUNTERSCHEIDBARE, direkt aufeinander-
    // folgende "-"-Zeilen im selben Markdown – Markdown kennt kein Konzept
    // von "drei benachbarte, aber strukturell getrennte Listen". markdown-it
    // fasste sie beim ERNEUTEN Laden deshalb wieder zu EINEM <ul> zusammen;
    // war dessen ERSTES <li> danach KEIN Checklisten-Punkt, während ein
    // SPÄTERES einer war, füllte ProseMirrors HTML-Parser die Schema-Lücke
    // mit einem GESPENSTISCHEN LEEREN taskItem auf (dieselbe "Geister-
    // Checkbox"-Parser-Lücke wie beim ganz gewöhnlichen "Stichpunktliste
    // gefolgt von Checkliste"-Fall, siehe SplitMixedTaskLists weiter oben).
    // SplitMixedTaskLists löst genau diese Mehrdeutigkeit jetzt beim Laden
    // auf (unabhängig davon, WIE die zusammengefasste Liste entstanden ist)
    // – die frühere No-op-Absicherung HIER wäre dadurch nur noch ein
    // überflüssiger, den Nutzer verwirrender Sonderfall ohne jede
    // Rückmeldung ("Checkliste zuerst" funktionierte immer schon, die
    // umgekehrte Richtung tat scheinbar nichts) und wurde ersatzlos
    // entfernt (verifiziert: alle betroffenen Konvertierungsrichtungen sind
    // jetzt roundtrip-stabil, siehe tests/docEditorListToggle.test.jsx).

    const before = [], middle = [], after = [];
    listNode.forEach((child, _offset, i) => {
      if (i < range.startIndex) before.push(child);
      else if (i < range.endIndex) middle.push(targetItemType.create(null, child.content));
      else after.push(child);
    });
    if (!middle.length) return false; // sollte durch den Range-Finder nie vorkommen

    if (dispatch) {
      // Anchor/Head VOR dem Umbau merken (siehe Selektions-Fix unten) –
      // "state.selection" ist hier noch die ALTE, unveränderte Selektion.
      const { anchor, head } = state.selection;

      const parts = [];
      if (before.length) parts.push(listNode.type.create(listNode.attrs, Fragment.fromArray(before)));
      parts.push(targetListType.create({ ...listNode.attrs, ...listAttrs }, Fragment.fromArray(middle)));
      if (after.length) parts.push(listNode.type.create(listNode.attrs, Fragment.fromArray(after)));

      const listPos = range.$from.before(range.depth);
      const tr = state.tr.replaceWith(listPos, listPos + listNode.nodeSize, Fragment.fromArray(parts));

      // 🟡 v7.49 E2E-Finding: "Checkliste"-Knopf auf einem LEEREN Listenpunkt
      // mit einer Tabelle direkt danach setzte die Selektion in die Kopfzelle
      // der Tabelle statt in den neu entstandenen leeren Checklisten-Eintrag
      // – derselben Fokus-Fehler-KLASSE wie #85 (v7.41.3), aber eine ANDERE
      // Ursache: #85 war ein DOM-Fokus-Diebstahl durch den Button selbst
      // (durch preventFocusSteal bereits abgedeckt), HIER ist die interne
      // ProseMirror-Selektion selbst schon falsch, WEIT BEVOR sie je den DOM
      // erreicht. tr.replaceWith() oben ersetzt "davor"+Zielteil+"danach" als
      // EINEN einzigen Schritt; ProseMirrors STANDARD-Selektionsmapping
      // (Transaction.selection-Getter, node_modules/prosemirror-state/src/
      // transaction.ts) mapped jede Position, die STRIKT INNERHALB des
      // ersetzten Bereichs lag (das ist die Selektion hier IMMER – siehe
      // nearestListItemAncestor/blockRange oben, sie liegt per Konstruktion
      // im Zielteil, nie exakt an dessen Rändern), mit assoc=1 an das ENDE
      // DES GESAMTEN ersetzten Bereichs (node_modules/prosemirror-transform/
      // src/map.ts, StepMap._map: "side = assoc" für jede Position, die
      // weder exakt am Anfang noch am Ende des Bereichs liegt) – bei einem
      // Folgeblock (Tabelle/Absatz/Überschrift) direkt danach sucht
      // Selection.near von DORT aus zuerst VORWÄRTS und landet im
      // Folgeblock, nicht im neuen Zielpunkt. Aktiv verifiziert (siehe
      // tests/docEditorListToggleSelection.test.jsx, roter Lauf mit
      // versionsweise entferntem Fix dokumentiert): derselbe Effekt tritt
      // GENAUSO bei einem TEXTHALTIGEN Zielpunkt auf, sobald ein Folgeblock
      // ODER ein spätes Geschwister ("danach") existiert – nur fiel er dort
      // nie auf, weil kein bisheriger Testfall "Knopf klicken, sofort
      // weitertippen" mit einem NICHT-leeren Punkt UND einem Folgeblock
      // kombinierte (D20 deckte bislang nur den leeren Punkt ab).
      //
      // Fix: Position ANALYTISCH statt per Mapping bestimmen. "davor"/
      // Zielteil/"danach" übernehmen ihre Kind-Knoten 1:1 (nur der
      // Knotentyp des Zielteils ändert sich – nodeSize hängt NIE von
      // Attributen wie "checked" ab, sondern ausschließlich vom Inhalt, der
      // unverändert per child.content übernommen wird). Die einzige
      // Größenänderung VOR dem Zielteil ist die Anzahl neu eingefügter
      // Listen-Rahmen: keiner, wenn "davor" leer ist (der Zielteil beginnt
      // dann exakt an derselben Stelle wie zuvor die Gesamtliste), sonst
      // GENAU zwei zusätzliche Tokens (Schließen von "davor" + Öffnen des
      // Zielteils) – unabhängig davon, wie viele Punkte "davor" enthält
      // oder wie tief die Selektion im Zielteil verschachtelt ist (Text,
      // leerer Absatz, verschachtelter Listenpunkt: siehe Testmatrix).
      const shift = before.length ? 2 : 0;
      const clampPos = (pos) => Math.max(0, Math.min(pos + shift, tr.doc.content.size));
      const $anchor = tr.doc.resolve(clampPos(anchor));
      const $head = tr.doc.resolve(clampPos(head));
      tr.setSelection(TextSelection.between($anchor, $head, head >= anchor ? 1 : -1));

      dispatch(tr);
    }
    return true;
  };
}

// Exportiert (für gezielte Unit-Tests unabhängig vom Toolbar-Knopf) –
// editor.commands.command() bettet das reine (state,dispatch)-Kommando
// korrekt ein, inklusive Chain-Kompatibilität.
export function convertListItemType(editor, targetListTypeName, targetItemTypeName, listAttrs = {}) {
  if (!editor) return false;
  const cmd = convertListItemTypeCommand(targetListTypeName, targetItemTypeName, listAttrs);
  return editor.commands.command(({ state, dispatch }) => cmd(state, dispatch));
}

// Ersetzt toggleBulletList/toggleOrderedList/toggleTaskList NUR für den
// verschachtelten Fall (siehe convertListItemTypeCommand oben) – "kein
// Listenpunkt an der Selektion" fällt unverändert auf das jeweilige NATIVE
// Kommando zurück (über den separat registrierten, generischen
// "toggleList"-Befehl von @tiptap/core, DENSELBEN, den die
// Original-Kommandos intern nutzen – "neue Liste anlegen"/"komplette Liste
// entfernen" bleibt dadurch exakt Bestandsverhalten). ExtensionManager
// mischt addCommands() aller Extensions über Object.assign in ihrer (nach
// Priorität sortierten, bei Gleichstand ORIGINAL-Reihenfolge beibehaltenden)
// Reihenfolge – der ZULETZT gemischte Eintrag gewinnt bei gleichem
// Kommando-Namen.
//
// "priority: 50" (v7.41.2, Nachbesserung): NIEDRIGER als der Default (100)
// von TaskList/TaskItem/StarterKits BulletList/OrderedList/ListItem (keiner
// von ihnen setzt einen eigenen Extension-Level-priority-Wert, siehe
// node_modules/@tiptap/extension-task-list|task-item/src – der "priority:
// 51" DORT gehört zu einer parseDOM-Regel, nicht zur Extension selbst)
// sortiert NestedListToggle in ExtensionManager.sort() GARANTIERT ans Ende
// der für addCommands() maßgeblichen Reihenfolge, UNABHÄNGIG von ihrer
// tatsächlichen Position in der useEditor()-Extensions-Liste (siehe unten)
// – die bisherige Reihenfolge-Argumentation ("MUSS NACH TaskList/TaskItem/
// StarterKit stehen") war korrekt, aber zerbrechlich (genau wie bei
// IndentKeymap vor dessen eigenem "priority: 1001", siehe dort). Gefahrlos:
// NestedListToggle steuert weder Nodes/Marks noch ProseMirror-Plugins bei,
// eine niedrigere Priorität kann deshalb an KEINER anderen Stelle (Schema-
// Aufbau, Plugin-/Keymap-Reihenfolge) etwas verschieben.
export const NestedListToggle = Extension.create({
  name: "nestedListToggle",
  priority: 50,
  addCommands() {
    const make = (listTypeName, itemTypeName, listAttrs) => () => ({ state, dispatch, commands }) =>
      convertListItemTypeCommand(listTypeName, itemTypeName, listAttrs)(state, dispatch) ||
      commands.toggleList(listTypeName, itemTypeName, false);
    return {
      toggleBulletList: make("bulletList", "listItem", {}),
      toggleOrderedList: make("orderedList", "listItem", {}),
      toggleTaskList: make("taskList", "taskItem", {}),
    };
  },
});

/* ---------------------------------------------------------------------- */
/* Bilder direkt in den Editor einfügen (v7.41 Teil B, Nutzerwunsch         */
/* "Ich würde gerne Bilder direkt in den Editor kopieren können. Das geht   */
/* auch, aber ich kann es nicht speichern."). Bisher blockte save() (unten) */
/* jedes eingefügte Bild als "Bild ohne Referenz" – dieser Block sorgt      */
/* dafür, dass ein per Zwischenablage eingefügtes ODER per Drag&Drop        */
/* abgelegtes Bild SOFORT zu einer echten App-Referenz wird (Upload über    */
/* die onAddImage-Prop, siehe App.jsx#addEditorImage/uploadEditorImage),    */
/* statt nur als lose data:-URL im Dokument zu landen. Alle Bausteine sind  */
/* reine, exportierte Funktionen (wie extractOutline/jumpToHeading oben) –  */
/* testbar ohne echten Paste-/Drop-DOM-Event, siehe                        */
/* tests/docEditorImages.test.jsx.                                         */
/* ---------------------------------------------------------------------- */

// Erkennt Bilddateien in einem Paste-/Drop-Ereignis: SOWOHL ".items" ALS
// AUCH ".files" (Auftrag) – je nach Browser/Quelle ist nur eine der beiden
// DataTransfer-APIs zuverlässig gefüllt (Firefox liefert einen eingefügten
// Screenshot z. B. nur über .items, ein Drag aus dem Explorer/Finder eher
// über .files). Bei einem eingefügten Bild enthalten aber ÜBLICHERWEISE
// BEIDE APIs dieselbe(n) Datei(en) – deshalb NUR ein Fallback: ".files"
// wird nur befragt, wenn ".items" NICHTS Bild-artiges ergab, sonst kämen
// Screenshots doppelt in den Editor.
//
// isAcceptedImageType statt generischem ".startsWith(\"image/\")" (Code-
// Review vor v7.41-Commit, 🔵 Finding 10, siehe lib/images.js für die
// ausführliche Begründung): ein SVG/AVIF/BMP würde sonst unter einer
// falschen ".png"-Endung im Daten-Repo landen (extForMime kennt diese
// Formate nicht) – ein nicht unterstütztes Format wird hier still
// ausgefiltert (fällt danach auf das normale Paste-/Drop-Verhalten
// zurück, z. B. HTML-Text), keine neue Fehlermeldung dafür (Auftrag:
// minimal-invasiv, kein Over-Engineering für einen seltenen Randfall).
export function extractImageFiles(dataTransfer) {
  if (!dataTransfer) return [];
  const fromItems = [];
  if (dataTransfer.items) {
    for (const it of dataTransfer.items) {
      if (it && it.kind === "file" && isAcceptedImageType(it.type)) {
        const f = it.getAsFile && it.getAsFile();
        if (f) fromItems.push(f);
      }
    }
  }
  if (fromItems.length) return fromItems;
  const fromFiles = [];
  if (dataTransfer.files) {
    for (const f of dataTransfer.files) {
      if (f && isAcceptedImageType(f.type)) fromFiles.push(f);
    }
  }
  return fromFiles;
}

// Erkennt eine von einer Webseite kopierte/gezogene Grafik OHNE zugehörige
// Bilddatei (kein Eintrag in clipboardData/dataTransfer, siehe
// extractImageFiles oben) – typischerweise ein per HTML mitgebrachtes
// "<img src="https://…">" (z. B. eine per Rich-Text-Auswahl kopierte
// Webseite). Ein solches Bild kann NICHT über onAddImage geholt werden:
// ein Cross-Origin-Fetch würde auf den meisten Bild-Servern an CORS
// scheitern (siehe DECISIONS – bewusst NICHT versucht), und ein roher
// https-Link ist ohnehin keine gültige Bildreferenz der App (IMG_LINE_RE
// in lib/markdown.jsx kennt nur "img:<id>") – würde also unbemerkt einen
// nicht darstellbaren Bildlink speichern. "slice" ist die von ProseMirror
// bereits geparste Paste-/Drop-Nutzlast (dritter handlePaste-/vierter
// handleDrop-Parameter) – slice.content ist ein Fragment (kein
// Node.descendants()), seine KINDER sind aber vollwertige Nodes, deshalb
// zusätzlich pro Kind rekursiv absuchen (deckt ein Bild INNERHALB einer
// eingefügten Liste/Tabelle mit ab).
// Gemeinsames Prädikat für findRemoteImageSrc/stripRemoteImages (siehe
// unten) – EIN Ort für "was zählt als nicht übernehmbares Remote-Bild".
const isRemoteImageNode = (n) =>
  !!n.type && n.type.name === "image" && /^https?:\/\//i.test(n.attrs.src || "");

export function findRemoteImageSrc(slice) {
  if (!slice || !slice.content) return null;
  let found = null;
  slice.content.forEach((node) => {
    if (found) return;
    const check = (n) => {
      if (found) return false;
      if (isRemoteImageNode(n)) {
        found = n.attrs.src;
        return false;
      }
      return true;
    };
    if (!check(node)) return;
    node.descendants(check);
  });
  return found;
}

// BUGFIX (Code-Review vor v7.41-Commit, 🟡 Finding 4): handlePaste/handleDrop
// (unten) gaben bei EINEM gefundenen Remote-Bild bisher "true" zurück, OHNE
// selbst etwas einzufügen – ProseMirror unterlässt dann laut Vertrag des
// handlePaste/handleDrop-Props JEDE eigene Einfüge-Reaktion, der GESAMTE
// eingefügte Ausschnitt ging verloren, auch begleitender Text (z. B. ein von
// einer Webseite kopierter Absatz mit einem eingebetteten Logo). Diese
// Funktion entfernt NUR die Remote-Bild-Knoten aus dem Fragment (rekursiv,
// damit auch ein Bild INNERHALB einer eingefügten Liste/Tabelle erfasst
// wird) und behält den Rest bei – Aufrufer fügen den bereinigten Slice
// selbst ein (siehe handlePaste/handleDrop), statt den kompletten Ausschnitt
// zu verwerfen. openStart/openEnd bleiben unverändert: Für die realistischen
// Fälle (Bild als eigener Block bzw. Bild+Text auf oberster Ebene des
// Fragments) bleibt die "offene" Struktur der äußeren Ränder davon
// unberührt, ein entferntes Bild sitzt nie an der offenen Kante selbst
// (siehe Tests) – ein rein hypothetisches, extrem verschachteltes
// Paste-Fragment, das genau DORT ein Remote-Bild trüge, ist ein bewusst
// akzeptierter Randfall (siehe DECISIONS).
export function stripRemoteImages(slice) {
  if (!slice || !slice.content) return slice;
  const filterFragment = (fragment) => {
    const kept = [];
    let changed = false;
    fragment.forEach((node) => {
      if (isRemoteImageNode(node)) { changed = true; return; }
      if (node.content && node.content.childCount) {
        const newContent = filterFragment(node.content);
        if (newContent !== node.content) {
          changed = true;
          kept.push(node.copy(newContent));
          return;
        }
      }
      kept.push(node);
    });
    return changed ? Fragment.fromArray(kept) : fragment;
  };
  const content = filterFragment(slice.content);
  if (content === slice.content) return slice; // nichts zu tun
  return new Slice(content, slice.openStart, slice.openEnd);
}

// Gemeinsame Entscheidungslogik für Paste UND Drop: liefert entweder eine
// Liste zu übernehmender Bilddateien ({ files }), ODER die URL einer NICHT
// übernehmbaren, von einer Webseite kopierten Grafik ({ remoteSrc }), ODER
// null (kein Bild beteiligt – der Aufrufer lässt dann das BESTEHENDE
// Paste-/Drop-Verhalten unverändert, z. B. linkOnPaste/reinen Text/HTML).
export function detectPastedImages(dataTransfer, slice) {
  const files = extractImageFiles(dataTransfer);
  if (files.length) return { files };
  const remoteSrc = findRemoteImageSrc(slice);
  if (remoteSrc) return { remoteSrc };
  return null;
}

// Fügt eine Reihe von Bilddateien NACHEINANDER an einer festen Startposition
// ein (Cursor bei Paste/Toolbar-Knopf, Mausposition bei Drop). Bewusst
// SEQUENTIELL statt parallel (Promise.all): die Einfüge-Position des
// jeweils NÄCHSTEN Bildes hängt von der tatsächlich erreichten
// Cursor-Position NACH dem vorherigen Insert ab (insertContentAt setzt die
// Selektion automatisch ans Ende des eingefügten Inhalts, siehe
// @tiptap/core) – parallele Uploads würden sowohl die Upload-Reihenfolge
// als auch die Einfüge-Reihenfolge der Bilder verwürfeln. Ein fehlgeschlagenes
// Bild (onAddImage wirft, z. B. nicht verbunden/Upload-Fehler) bricht die
// übrigen NICHT ab: onError wird pro Fehler aufgerufen (letzter Fehler
// "gewinnt" in der einzeiligen Fehleranzeige des Editors, siehe unten),
// aber kein Node wird für die fehlgeschlagene Datei eingefügt – "kein
// halber Zustand" (Auftrag). indent:0 (explizit, obwohl bereits Schema-
// Default, siehe indentAttrSpec oben) macht die Konvention "neu eingefügte
// Bilder starten uneingerückt" an dieser Stelle sichtbar.
export async function insertImagesSequentially(editor, files, startPos, onAddImage, onError) {
  let pos = startPos;
  for (const file of files) {
    try {
      const { dataUrl } = await onAddImage(file);
      // BUGFIX (Code-Review vor v7.41-Commit, 🔵 Finding 8): "pos" stammt
      // ggf. von VOR diesem "await" (erste Iteration: vom Aufrufer
      // übergebener startPos, spätere Iterationen: vor dem NÄCHSTEN Upload).
      // Der Upload braucht bei einer echten GitHub-API-Anfrage spürbar Zeit
      // – ändert der Nutzer währenddessen das Dokument (z. B. löscht er
      // Text), kann "pos" danach außerhalb des inzwischen KÜRZEREN Dokuments
      // liegen; insertContentAt würde dann mit einer RangeError abstürzen,
      // OHNE dass der bereits abgeschlossene Upload (Datei liegt im
      // Daten-Repo) rückgängig gemacht wird – eine Waisen-Datei UND ein
      // verlorenes Bild. Math.min klemmt auf die aktuelle Dokumentgröße;
      // im Normalfall (Dokument währenddessen unverändert) ist das ein
      // No-op.
      const safePos = Math.min(pos, editor.state.doc.content.size);
      editor.chain().insertContentAt(safePos, { type: "image", attrs: { src: dataUrl, indent: 0 } }).run();
      pos = editor.state.selection.to;
    } catch (e) {
      onError(e && e.message ? e.message : "Bild konnte nicht eingefügt werden");
    }
  }
}

// Sicherheitsnetz in save() (unten): Eine Bildreferenz OHNE "img:"-Ziel darf
// nie gespeichert werden. Vor v7.41 Teil B prüfte dieser Check NUR auf
// "](data:" (ein direkt eingefügtes Bild hatte damals IMMER eine data:-URL,
// weil es gar keinen anderen Weg ins Dokument gab) – seit Paste/Drop jetzt
// automatisch über onAddImage laufen (siehe oben), bekommt ein eingefügtes
// Bild im NORMALFALL bereits eine echte img:-Referenz, BEVOR save() überhaupt
// läuft. Trotzdem bleibt ein generischeres Netz nötig: (a) ohne Verbindung
// wirft onAddImage/uploadEditorImage sofort (siehe dort) – insertImagesSequentially
// fügt dann GAR KEINEN Node ein, ABER eine als HTML mitgebrachte data:-URL
// (z. B. aus einer Quelle, die Bilder direkt als Base64 im Markup einbettet,
// nicht als eigenständige Datei/Item) nimmt NICHT den handlePaste-Weg oben,
// weil extractImageFiles nur echte File-Objekte erkennt; (b) findRemoteImageSrc
// fängt die typische "von einer Webseite kopiert"-Grafik zwar bereits beim
// Einfügen ab, ein zusätzliches Netz beim Speichern schadet aber nicht
// (Verteidigung in der Tiefe – z. B. falls Inhalt auf einem anderen Weg als
// Paste/Drop ins Dokument gelangt, etwa über "Rückgängig" nach einem
// Editor-Wechsel). Exportiert (wie unescapeMd/MdTable/… oben), damit Tests
// die ECHTE Prüfung verwenden statt eine Kopie nachzubauen.
export const UNRESOLVED_IMG_RE = /!\[[^\]]*\]\((?:data:|https?:\/\/)[^)]*\)/;

export default function DocEditor({
  initialDoc, imgMap, onSave, onCancel, saving, navWidth, autocorrect, onAddImage,
}) {
  const baseline = useRef(null);
  // AutoKorrektur (v7.25): Regeln werden NUR EINMAL beim Mount aus der
  // übergebenen Konfiguration gebaut (leeres deps-Array – dieselbe
  // Mount-only-Konvention wie useEditor() selbst unten, siehe dessen
  // Aufruf ohne deps-Argument: @tiptap/react erstellt den Editor nur
  // beim ersten Rendern neu). Ändert der Nutzer die Einstellungen,
  // während der Editor bereits offen ist, zieht die LAUFENDE Sitzung das
  // NICHT live nach – erst ein Schließen+erneutes Öffnen des Editors
  // liest den neuen Stand (bewusst so einfach gehalten, siehe DECISIONS;
  // ein Nutzer, der mitten in einer Bearbeitung die AutoKorrektur
  // umstellt, ist ein seltener Randfall).
  const autocorrectRules = useMemo(() => buildActiveRules(autocorrect), []); // eslint-disable-line react-hooks/exhaustive-deps
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
  // Bild-Upload (v7.41 Teil B): Zähler statt bool, weil ein Paste/Drop
  // MEHRERE Bilder gleichzeitig anstoßen kann (insertImagesSequentially,
  // siehe oben) – "uploading" ist erst wieder false, wenn WIRKLICH alle
  // laufenden Uploads fertig sind. Blockt "Speichern" (analog "saving"),
  // damit nie mit halbfertigem Zustand gespeichert wird (Auftrag).
  const [uploadCount, setUploadCount] = useState(0);
  const uploading = uploadCount > 0;
  // Verstecktes <input type="file"> für den Toolbar-Knopf "Bild einfügen"
  // (B3) – dieselbe Technik wie z. B. der Notizbuch-Icon-Upload in App.jsx.
  const imageFileInputRef = useRef(null);
  // Finding 9 aus dem Code-Review vor dem v7.41-Commit vermutete, handlePaste/
  // handleDrop (siehe editorProps unten) würden den "onAddImage"-Prop vom
  // ERSTEN Render dauerhaft einfrieren, weil useEditor() ohne deps-Array
  // aufgerufen wird. NACHGEPRÜFT (echter Regressionstest mit zwei
  // aufeinanderfolgenden root.render()-Aufrufen + einem simulierten Paste,
  // siehe tests/docEditorImages.test.jsx): Das trifft für die installierte
  // @tiptap/react-Version (2.27.2) NICHT zu – deren useEditor() vergleicht
  // bei JEDEM Render die Options (EditorInstanceManager.compareOptions,
  // node_modules/@tiptap/react/src/useEditor.ts) und ruft bei Unterschieden
  // (editorProps ist bei jedem Render ein NEUES Objektliteral, damit IMMER
  // "unterschiedlich") editor.setOptions({...}) auf – das wiederum ruft
  // view.setProps(this.options.editorProps) auf (@tiptap/core#setOptions)
  // und aktualisiert damit handlePaste/handleDrop der LEBENDEN View auf JEDEM
  // Render, OHNE den Editor neu zu erzeugen. Der Prop-Zugriff war also schon
  // VOR dieser Ref korrekt aktuell. Die Ref bleibt trotzdem drin (schadet
  // nicht, macht den Zugriff explizit unabhängig von diesem tiptap-internen
  // Refresh-Mechanismus, falls sich dessen Verhalten in einer künftigen
  // Version ändert) – aber Finding 9 ist als tatsächlicher Bug NICHT
  // reproduzierbar, siehe Bericht.
  const onAddImageRef = useRef(onAddImage);
  onAddImageRef.current = onAddImage;

  const editor = useEditor({
    extensions: [
      // Einzugs-Tastenkürzel (v7.41, Auftrag "Einrückungen"): Die Position
      // in dieser Liste ist NICHT mehr die Priorität-Absicherung (siehe
      // "priority: 1001" direkt an der IndentKeymap-Definition oben für die
      // Begründung, inkl. des Blockers, den die frühere reine
      // Reihenfolge-Argumentation live verursacht hat) – IndentKeymap steht
      // hier trotzdem bewusst weit oben, rein als Lese-Konvention ("zuerst,
      // was für Tastatureingaben zuständig ist").
      IndentKeymap,
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // paragraph (v7.41): StarterKits eingebauter Absatz-Node bleibt
        // deaktiviert – IndentParagraph unten ersetzt ihn mit demselben
        // Node-Namen ("paragraph"), ergänzt um das "indent"-Attribut
        // (analog codeBlock/FencedCodeBlock direkt darunter).
        paragraph: false,
        // codeBlock (v7.7, Nutzerwunsch "voller Support"): StarterKits
        // eingebaute Node bleibt hier deaktiviert – FencedCodeBlock oben
        // ersetzt sie mit demselben Node-Typnamen ("codeBlock", toggle-/
        // Tastatur-Verhalten bleibt über .extend() erhalten), aber einem
        // eigenen Serializer mit Zaun-Verlängerung (Re-Review-Fix K1,
        // siehe dort und DECISIONS #54).
        codeBlock: false,
        blockquote: false,
      }),
      IndentParagraph,
      FencedCodeBlock,
      BlockImage,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      // Geister-Checkbox (v7.41.2, siehe SplitMixedTaskLists oben): Muss VOR
      // TaskLists eigenem updateDOM-Hook laufen – seit der v7.41.2-
      // Nachbesserung über "priority: 101" an der Extension selbst
      // sichergestellt (nicht mehr über diese Listenposition, siehe
      // ausführlichen Kommentar dort). Position hier bleibt als
      // Lese-Konvention stehen.
      SplitMixedTaskLists,
      // EmptyTaskMarkdownIt (v7.45, siehe Kopfkommentar dort und DECISIONS
      // #91): behebt eine ANDERE Parser-Lücke als SplitMixedTaskLists
      // (eine INHALTSLEERE Checkbox-Zeile wird von markdown-it-task-lists
      // beim Laden nie als Checkbox erkannt) – Reihenfolge zu
      // SplitMixedTaskLists/TaskList irrelevant, WEIL "md.core.ruler.
      // before('inline', …)" seine Regel innerhalb von markdown-its EIGENER
      // Regelkette IMMER unmittelbar vor der (einzigen, fest verdrahteten)
      // "inline"-Kernregel einsortiert – unabhängig davon, an welcher
      // Position/Priorität EmptyTaskMarkdownIt in DIESER Extensions-Liste
      // steht. Das gilt NICHT allgemein für die Reihenfolge, in der
      // tiptap-markdown mehrere "parse.setup(md)"-Hooks VERSCHIEDENER
      // Extensions aufruft (die folgt sehr wohl der nach Priorität
      // sortierten "extensionManager.extensions"-Liste, siehe
      // MarkdownParser.js#parse und SplitMixedTaskLists' eigener
      // "priority: 101" oben) – hier bleibt es folgenlos, weil aktuell
      // KEINE andere Extension ebenfalls eine Regel relativ zu "inline"
      // registriert; ein künftiger zweiter solcher Hook müsste diese
      // Aufruf-Reihenfolge (und ob "before"/"after" dabei stabil bleibt)
      // erneut prüfen.
      EmptyTaskMarkdownIt,
      TaskList,
      // nested:true (v7.41, Auftrag "Einrückungen"): Checklisten müssen
      // verschachtelbar sein (der Nutzer-Fall hat eine Checkliste als
      // Elternpunkt mit eingerückten Unterpunkten). TaskItem bringt dafür
      // eigene Tab/Shift-Tab-Bindungen mit (siehe
      // node_modules/@tiptap/extension-task-item) – IndentKeymap (priority
      // 1001, siehe dort) ist bei JEDEM Tab/Shift-Tab-Druck ZUERST dran und
      // löst den Normalfall über das korrigierte runIndentChange auf.
      // Liefert das nichts (z. B. weil der INNERSTE Listenpunkt der
      // Selektion nicht dem entspricht, den TaskItem/ListItems EIGENE
      // Bindung träfe – siehe Re-Review-Fix Finding A, inTopLevelList()),
      // SCHLUCKT IndentKeymap den Tastendruck innerhalb einer Top-Level-
      // Liste bewusst, statt ihn an diese Bindungen durchzureichen: die
      // würden sonst einen ANDEREN, meist äußeren Block einrücken als den,
      // auf dem der Cursor steht. TaskItem/ListItems eigene Bindungen
      // kommen dadurch bei EINER Top-Level-Liste im Dokument NIE zum Zug
      // (weder im Erfolgs- noch im No-op-Fall) – rein technisch weiterhin
      // vorhanden (z. B. falls IndentKeymap versehentlich entfernt würde),
      // aber für den normalen Betrieb irrelevant.
      TaskItem.configure({ nested: true }),
      // NestedListToggle (v7.41.1, Blocker 2) MUSS nach StarterKit/TaskList/
      // TaskItem stehen (siehe Kopfkommentar dort) – nur so gewinnt ihre
      // eigene toggleBulletList/toggleOrderedList/toggleTaskList-Definition
      // beim Command-Merge gegen die eingebauten Varianten.
      NestedListToggle,
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
      // v7.31: isAllowedUri lässt ZUSÄTZLICH GENAU unsere file:-Grammatik zu
      // (FILE_URL_FULL_RE, siehe FileLinkMarkdownIt oben) – diese Option ist
      // der EINZIGE Gatekeeper für autolink/linkOnPaste/setLink/toggleLink
      // UND für parseHTML/getAttrs (entscheidet, ob der Link-Mark beim Laden
      // aus dem von markdown-it gerenderten HTML überhaupt erhalten bleibt –
      // ohne diese Erweiterung würde ProseMirror den vom
      // FileLinkMarkdownIt-Patch erst ermöglichten <a href="file:…">
      // sofort wieder verwerfen). javascript:/data:/mailto:/… bleiben über
      // den ersten Teil der Bedingung weiterhin blockiert.
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        isAllowedUri: (url, ctx) =>
          (ctx.defaultValidate(url) && /^https?:/i.test(url)) || FILE_URL_FULL_RE.test(String(url || "")),
      }),
      // markdown-it lässt file:-URLs beim Laden zu (siehe Kopfkommentar dort) –
      // OHNE diese Extension bleibt "[Titel](file:///…)" beim Öffnen Klartext.
      FileLinkMarkdownIt,
      // Einzug beim Laden (v7.41, siehe IndentMarkdownIt oben) – ohne diese
      // Extension käme ein gespeicherter Absatz-/Bild-Einzug beim erneuten
      // Öffnen des Editors nie wieder an.
      IndentMarkdownIt,
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
      // AutoKorrektur (v7.25, siehe AutoCorrect oben) – rules kommt aus der
      // EINMALIGEN Mount-Berechnung oben (autocorrectRules).
      AutoCorrect.configure({ rules: autocorrectRules }),
      // html:true ist nötig, damit Schriftfarbe/Textmarker (Marks ohne
      // Markdown-Entsprechung) als <span>/<mark> UND die Formel-Tags
      // (<math-inline>/<math-block>) serialisiert und beim Öffnen wieder
      // eingelesen werden.
      Markdown.configure({ html: true, bulletListMarker: "-", tightLists: true }),
    ],
    // Pre-Load-Strip des Anlage-Platzhalters (v7.27, Nutzer-Befund/🟡 vom
    // v7.24-26-E2E-Lauf, HEAD e0102c9): stripInboxPlaceholder läuft HIER
    // VOR mathToPlaceholders/resolveImgs, damit der Platzhaltertext den
    // Editor NIE erreicht – vorher war er echter, editierbarer Absatztext:
    // ein Klick MITTEN in die Zeile + Tippen verschmolz Nutzertext mit dem
    // Hinweissatz ("Noch nichts erfasst. Die ersta<b>e Notiz im Chat legt
    // hier los."), und der so entstandene Murks matchte den v7.22-Zeilen-
    // vergleich (exakter String-Vergleich, siehe stripInboxPlaceholder)
    // nicht mehr – blieb also für immer stehen. Der Viewer (DocView,
    // App.jsx) bleibt UNVERÄNDERT: er zeigt den Platzhalter für frische
    // Notizbücher weiterhin an (reine Anzeige, nie anklickbar/editierbar
    // dort) – NUR der WYSIWYG-Editor bekommt ihn nie zu Gesicht. Die
    // Baseline (onCreate unten) entsteht dadurch bereits NACH dem Strip:
    // Öffnen+Abbrechen bzw. Öffnen+Speichern OHNE jede Änderung bleiben
    // No-ops (der bestehende "md === baseline.current"-Vergleich in save()
    // greift unverändert, nur dass baseline UND ein unverändertes md jetzt
    // beide placeholder-frei sind statt beide placeholder-behaftet – das
    // Ergebnis "kein Commit" ist in beiden Fällen identisch). Erst eine
    // ECHTE Änderung committet – und im Ergebnis fehlt der Platzhalter
    // dann konsequent (konsistent zur v7.22-Semantik in App.jsx#saveEdit,
    // die stripInboxPlaceholder zusätzlich bedingungslos auf das
    // Speicher-Ergebnis anwendet, für ALTE, bereits gespeicherte
    // Bestände mit dem Platzhalter – hier rein defensiv/idempotent, siehe
    // DECISIONS #64/#64-Erweiterung).
    content: resolveImgs(mathToPlaceholders(stripInboxPlaceholder(initialDoc)), imgMap),
    autofocus: "start",
    editorProps: {
      attributes: { class: "tiptap-doc focus:outline-none" },
      // Bilder direkt einfügen (v7.41 Teil B): "editor" wird hier per
      // Closure referenziert, NICHT als Argument übergeben – zulässig, weil
      // handlePaste/handleDrop erst durch einen ECHTEN Paste-/Drop-Event
      // aufgerufen werden, also immer erst NACHDEM "const editor = ..."
      // unten fertig zugewiesen ist (dasselbe Prinzip wie bei jedem anderen
      // Callback in dieser Komponente, der "editor" referenziert, z. B.
      // save()/openLinkPicker() weiter unten). "onAddImageRef.current" statt
      // der Prop direkt: siehe die ausführliche Begründung bei der
      // useRef-Definition oben (Finding 9 aus dem Code-Review – als
      // tatsächlicher Bug NICHT reproduzierbar, die Ref bleibt trotzdem als
      // zusätzliche, vom tiptap-internen Refresh-Mechanismus unabhängige
      // Absicherung). Ohne onAddImage-Prop bleibt ALLES beim bisherigen
      // Verhalten (Auftrag: "undefined-tolerant") – someProp() aus
      // prosemirror-view fällt dann direkt auf die bestehenden Plugins
      // zurück (u. a. linkOnPaste), siehe Kommentar an detectPastedImages
      // oben.
      handlePaste: (view, event, slice) => {
        const addImage = onAddImageRef.current;
        if (!addImage) return false;
        const detected = detectPastedImages(event.clipboardData, slice);
        if (!detected) return false; // kein Bild beteiligt -> Standard-Paste (Text/HTML/linkOnPaste)
        if (detected.remoteSrc) {
          setError(
            "Von einer Webseite kopierte Bilder können nicht direkt übernommen werden " +
            "(kein Zugriff auf die Bilddatei). Bitte das Bild speichern und über den " +
            "Knopf „Bild einfügen“ hochladen."
          );
          // BUGFIX (Code-Review vor v7.41-Commit, 🟡 Finding 4): NICHT mehr
          // "return true" ohne jede Einfügung – das verwarf laut Vertrag des
          // handlePaste-Props den KOMPLETTEN Ausschnitt, auch begleitenden
          // Text (z. B. ein von einer Webseite kopierter Absatz mit einem
          // eingebetteten Logo). stripRemoteImages entfernt NUR die
          // Remote-Bild-Knoten, der Rest wird ganz normal eingefügt.
          const cleaned = stripRemoteImages(slice);
          if (cleaned.content.size) view.dispatch(view.state.tr.replaceSelection(cleaned).scrollIntoView());
          return true;
        }
        setError(null);
        setUploadCount((n) => n + 1);
        insertImagesSequentially(editor, detected.files, view.state.selection.to, addImage, setError)
          .finally(() => setUploadCount((n) => n - 1));
        return true;
      },
      handleDrop: (view, event, slice, moved) => {
        // "moved": ein interner ProseMirror-Drag (Text/Bild INNERHALB des
        // Editors verschieben) – dabei ist niemals eine externe Bilddatei
        // im Spiel, unverändertes Bestandsverhalten.
        const addImage = onAddImageRef.current;
        if (!addImage || moved) return false;
        const detected = detectPastedImages(event.dataTransfer, slice);
        if (!detected) return false;
        // "pos" (Drop-Koordinaten, mit Fallback auf die aktuelle Selektion)
        // wird für BEIDE Zweige unten gebraucht – ein Drop landet an der
        // Mausposition, NICHT an der aktuellen Selektion wie ein Paste.
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        const pos = coords ? coords.pos : view.state.selection.to;
        if (detected.remoteSrc) {
          setError(
            "Von einer Webseite kopierte Bilder können nicht direkt übernommen werden " +
            "(kein Zugriff auf die Bilddatei). Bitte das Bild speichern und über den " +
            "Knopf „Bild einfügen“ hochladen."
          );
          // Siehe handlePaste oben für die ausführliche Begründung. Anders
          // als dort ("replaceSelection") landet der bereinigte Rest HIER an
          // der Drop-Position ("pos" oben) – ein Drop ersetzt NIE die
          // aktuelle Selektion.
          const cleaned = stripRemoteImages(slice);
          if (cleaned.content.size) view.dispatch(view.state.tr.replace(pos, pos, cleaned).scrollIntoView());
          return true;
        }
        setError(null);
        setUploadCount((n) => n + 1);
        insertImagesSequentially(editor, detected.files, pos, addImage, setError)
          .finally(() => setUploadCount((n) => n - 1));
        return true;
      },
    },
    onCreate: ({ editor: ed }) => { baseline.current = ed.storage.markdown.getMarkdown(); },
    onTransaction: () => setTick((t) => t + 1),
  });

  // Gliederungs-Leiste (v7.14): "editor.state.doc" als useMemo-Abhängigkeit
  // ist bereits die geforderte leichte Drosselung, ganz ohne Timer – ein
  // reiner Selektions-/Cursor-Wechsel erzeugt bei ProseMirror KEIN neues
  // doc-Objekt (nur bei tr.docChanged ändert sich die Referenz), extractOutline
  // läuft also nur bei echten Bearbeitungen erneut, nicht bei jedem Tick aus
  // onTransaction (der u. a. auch für die Toolbar-Aktivzustände feuert).
  // v7.26: computeOutlineRanges (statt extractOutline direkt) liefert
  // zusätzlich die [from, to)-Bereiche, die die Drag&Drop-Umsortierung
  // unten braucht – die Leiste selbst nutzt weiterhin nur level/title/from.
  const outline = useMemo(
    () => computeOutlineRanges(editor ? editor.state.doc : null),
    [editor && editor.state.doc] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Drag&Drop-Umsortierung der Gliederungs-Leiste (v7.26): siehe
  // computeOutlineRanges/validDropTargets/moveOutlineRange oben für die
  // reine Logik. NUR Pointer-Events (kein natives HTML5-Drag&Drop) –
  // Begründung siehe DECISIONS: (a) dieselbe Technik wie der bestehende
  // Bild-Anfasser (BlockImage-NodeView oben, "img-resize-handle") statt
  // eines zweiten, andersartigen Interaktionsmusters im selben Editor; (b)
  // volle Kontrolle über den Drop-Indikator ohne die Eigenheiten der
  // nativen DnD-API (dataTransfer/dragImage/effectAllowed, browser- und
  // Eingabegerät-abhängige Startschwellen) – hier reicht ein simples
  // "Grip gedrückt halten, über eine Zielzone bewegen, loslassen".
  // "dragOutline" ist NUR für die Optik (gedrückter Eintrag halbtransparent,
  // Zielzonen überhaupt gerendert) – die eigentliche Zielauswahl beim
  // Loslassen liest ausschließlich "dropTargetRef" (siehe unten), damit der
  // beim Drag-Start erzeugte window-Listener nie einen veralteten
  // React-State-Snapshot sieht (klassisches Stale-Closure-Risiko bei
  // Listenern, die nur einmal pro Drag registriert werden).
  const [dragOutline, setDragOutline] = useState(null); // { index, level } | null
  const [dropTargetIndex, setDropTargetIndex] = useState(null); // nur für die Anzeige
  const dropTargetRef = useRef(null);
  // Aufräum-Funktion des GERADE laufenden Drags (falls einer läuft) – wird
  // beim Unmount aufgerufen (siehe useEffect unten), damit ein Editor, der
  // MITTEN in einer Ziehbewegung geschlossen wird (z. B. "Abbrechen"),
  // keine window-Listener zurücklässt, die danach auf eine unmountete
  // Komponente einzuwirken versuchen (gleiches Muster wie cancelAutoFetch).
  const dragCleanupRef = useRef(null);
  useEffect(() => () => { if (dragCleanupRef.current) dragCleanupRef.current(); }, []);

  const startOutlineDrag = (e, index) => {
    e.preventDefault();
    e.stopPropagation();
    if (!editor) return;
    // Frischer Snapshot bei Drag-Beginn: entries/valid ändern sich während
    // EINES Drags nie (das Dokument wird erst beim Loslassen verändert),
    // als lokale const in den Closures unten also gefahrlos "eingefroren".
    const entries = computeOutlineRanges(editor.state.doc);
    const valid = validDropTargets(entries, index);
    if (!valid.length) return; // nichts zu tun (z. B. einziger Eintrag)
    setDragOutline({ index, level: entries[index].level });
    setDropTargetIndex(null);
    dropTargetRef.current = null;

    // document.elementFromPoint statt pointer capture: mit gesetzter
    // Pointer-Capture würden pointerenter/-move-Events auf den einzelnen
    // Zielzonen NICHT mehr feuern (das gehaltene Element bliebe alleiniges
    // Ziel) – die Hit-Tests unten funktionieren dadurch unabhängig davon,
    // über welchem Element der Zeiger technisch "gefangen" ist.
    const onMove = (ev) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const zone = el && el.closest ? el.closest("[data-outline-boundary]") : null;
      const boundary = zone ? Number(zone.getAttribute("data-outline-boundary")) : null;
      const isValid = boundary !== null && valid.includes(boundary);
      dropTargetRef.current = isValid ? boundary : null;
      setDropTargetIndex(isValid ? boundary : null);
    };
    const end = (apply) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      dragCleanupRef.current = null;
      if (apply && dropTargetRef.current !== null) {
        moveOutlineRange(editor, entries, index, dropTargetRef.current);
      }
      setDragOutline(null);
      setDropTargetIndex(null);
      dropTargetRef.current = null;
    };
    const onUp = () => end(true);
    const onCancel = () => end(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    dragCleanupRef.current = () => end(false); // beim Unmount: KEIN Verschieben mehr anwenden
  };

  // Eine Dropzone je Grenzindex (siehe validDropTargets – 0..outline.length),
  // NUR während eines laufenden Drags überhaupt im DOM (kein zusätzliches
  // Markup/keine Layoutverschiebung, solange nicht gezogen wird). Wird
  // IMMER für jede Grenze gerendert, unabhängig davon, ob sie für DIESES
  // Drag-Level gültig ist – die Hit-Tests in startOutlineDrag brauchen
  // durchgehende Zielzonen, die Optik (Indikator-Linie) erscheint aber nur,
  // wenn "dropTargetIndex" (bereits gegen "valid" gefiltert) genau hier
  // steht: ein ungültiges Ziel zeigt dadurch NIE einen Indikator, obwohl
  // die Zone selbst da ist (siehe Auftrag).
  const renderDropZone = (index) => {
    if (!dragOutline) return null;
    const active = dropTargetIndex === index;
    return (
      <div
        key={"dz" + index}
        data-outline-boundary={index}
        className={"rounded-full transition-colors " + (active ? "h-1 my-1 bg-indigo-500" : "h-2")}
      />
    );
  };

  const save = () => {
    // uploading (v7.41 Teil B): mindestens ein Bild-Upload läuft noch – erst
    // NACH dessen Abschluss hat das Dokument eine echte img:-Referenz statt
    // einer rohen data:-URL (siehe insertImagesSequentially oben).
    if (!editor || saving || uploading) return;
    const md = editor.storage.markdown.getMarkdown();
    if (md === baseline.current) { onCancel(); return; } // nichts geändert
    let out = dropEmptyCheckboxLines(
      stripEmptyCheckboxTrailingSpace(collapseChecklistGaps(unescapeMd(unresolveImgs(md, imgMap))))
    );
    // Sicherheitsnetz (siehe UNRESOLVED_IMG_RE oben für die ausführliche
    // Begründung): eine Bildreferenz OHNE img:-Ziel darf nicht gespeichert
    // werden – seit v7.41 Teil B nur noch der Ausnahmefall (z. B. ohne
    // Verbindung eingefügt oder von einer Webseite kopiert), der normale
    // Weg (Zwischenablage/Drag&Drop/Toolbar-Knopf) bekommt seine Referenz
    // bereits beim Einfügen.
    if (UNRESOLVED_IMG_RE.test(out)) {
      setError(
        "Das Dokument enthält ein Bild, das nicht dauerhaft gespeichert werden konnte " +
        "(z. B. ohne Verbindung eingefügt oder von einer Webseite kopiert). " +
        "Bitte entferne es hier und füge es erneut ein, sobald eine Verbindung besteht."
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

  // Gemeinsamer onMouseDown-Handler für alle Selektions-Knöpfe der Toolbar
  // (v7.41.3, siehe ausführliche Analyse/Ausnahmeliste weiter unten vor dem
  // JSX-Rückgabewert): verhindert NUR den impliziten Browser-Fokuswechsel
  // auf den Button, der click-Handler feuert unverändert weiter.
  const preventFocusSteal = (e) => e.preventDefault();

  if (!editor) return null;

  const currentColor = editor.getAttributes("textStyle").color || null;
  const currentHighlight = editor.isActive("highlight")
    ? editor.getAttributes("highlight").color || "#fde047"
    : null;
  // Einzugs-Knöpfe (v7.41): pro Render neu geprüft (onTransaction/setTick
  // oben löst bei jeder Editor-Änderung einen Re-Render aus) – reine,
  // dispatch-freie Probe (canChangeIndent), damit die Knöpfe ausgegraut
  // erscheinen, sobald nichts mehr zu tun ist (Auftrag).
  const indentDecOk = canChangeIndent(editor, -1);
  const indentIncOk = canChangeIndent(editor, 1);

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

  // onMouseDown+preventDefault auf den Selektions-Knöpfen (v7.41.3, E2E-
  // Finding: Toolbar-Klick + SOFORT weitertippen landet am falschen Platz –
  // Repro exakt wie beim v7.15-Fix an jumpToHeading/der Gliederungsleiste
  // oben, hier aber generalisiert auf die GESAMTE Format-Toolbar).
  //
  // Analyse (belegt, siehe DECISIONS): Bestandsverhalten, NICHT durch
  // NestedListToggle/convertListItemTypeCommand (v7.41.1/.2) verursacht –
  // ein Headless-Test mit UND ohne NestedListToggle (also mit TipTaps
  // eingebautem toggleTaskList) liefert nach dem Toggle IDENTISCH die
  // richtige ProseMirror-Selektion (im neuen, leeren Checklisten-Punkt).
  //
  // PRÄZISIERUNG v7.49 (DECISIONS #101) – dieser Beleg galt nur unter einer
  // Bedingung, die im damaligen Testdokument zufällig erfüllt war: Es ENDETE
  // mit der Liste. Dann rettet die Rückwärtssuche von Selection.near die
  // Position. Steht hinter der Liste noch ein Block (Tabelle, Absatz,
  // Überschrift), war die interne ProseMirror-Selektion sehr wohl falsch –
  // sie landete im FOLGEBLOCK. convertListItemTypeCommand setzt sie seit
  // v7.49 deshalb explizit (siehe dort und tests/
  // docEditorListToggleSelection.test.jsx). Der DOM-Fokus-Diebstahl unten
  // bleibt davon unberührt: ZWEI getrennte Ursachen, beide Fixes nötig.
  //
  // Der HIER behandelte Defekt liegt eine Ebene TIEFER, in der Browser/DOM-Welt:
  // 1. Ein `<button>` bekommt per Browser-Default den DOM-Fokus schon beim
  //    mousedown, NOCH VOR dem click-Handler (also bevor "chain().focus()"
  //    überhaupt läuft).
  // 2. @tiptap/core#focus (node_modules/@tiptap/core/src/commands/focus.ts)
  //    holt sich den DOM-Fokus NICHT synchron zurück, sondern erst per
  //    requestAnimationFrame (delayedFocus) – bis dahin bleibt
  //    document.activeElement der Button.
  // 3. Der eigentliche Editier-Befehl (z. B. toggleTaskList) dispatcht seine
  //    Transaktion trotzdem SOFORT, noch bevor dieser RAF gefeuert hat.
  //    prosemirror-view aktualisiert das gerenderte DOM bei JEDEM Dispatch,
  //    zieht die ECHTE Browser-Selection (selectionToDOM) aber NUR nach,
  //    wenn "editorOwnsSelection(view)" – für einen editierbaren View exakt
  //    "view.hasFocus()" – zu diesem Zeitpunkt true ist (siehe
  //    node_modules/prosemirror-view/dist/index.js, editorOwnsSelection/
  //    selectionToDOM). Das ist hier NICHT der Fall (Fokus liegt ja noch auf
  //    dem Button) – die Browser-Selection wird also nicht mitgezogen.
  //    Ersetzt ein Befehl dabei DOM-Knoten AN der alten Cursor-Position
  //    (z. B. "toggleTaskList" beim Aufteilen der Liste, aber auch jeder
  //    andere Struktur-Befehl), verwaist die alte Browser-Selection (ihr
  //    DOM-Knoten existiert nicht mehr) – der Browser kollabiert sie
  //    daraufhin von sich aus auf die nächstgelegene, noch vorhandene
  //    Position (beobachtet: Ende des UNVERÄNDERTEN Punkts davor). GENAU
  //    diese (falsche) Position ist es, wohin der nächste Tastendruck geht,
  //    sobald der Fokus zurückkehrt – NICHT die (korrekte) interne
  //    ProseMirror-Selektion aus Schritt "Analyse" oben. Reine Marken-
  //    Umschalter (fett/kursiv/…) ändern dagegen keinen DOM-Knoten AN der
  //    Cursor-Position selbst, weshalb ihnen dieselbe Falle bisher kaum
  //    auffiel – der Fokus-Diebstahl (Schritt 1+2) betrifft sie GLEICHERMASSEN,
  //    nur ohne sichtbare Folgen.
  //
  // Fix: wie beim v7.15-Fix – der Browser darf den Fokus gar nicht erst
  // stehlen (onMouseDown+preventDefault verhindert NUR den impliziten
  // Fokuswechsel, der click-Handler feuert unverändert). Angewendet auf
  // ALLE Knöpfe dieser Leiste, die per editor.chain()/editor.view.dispatch
  // auf die aktuelle Selektion wirken (Formatierung, Überschriften, Listen,
  // Einzug, Trennlinie, Formel, Tabellen-Zeilen/Spalten, Rückgängig/
  // Wiederholen – Letztere bewusst ZUSÄTZLICH zur Auftragsliste, weil ein
  // Undo/Redo ebenso Knoten an der Cursor-Position ersetzen kann).
  //
  // BEWUSST ausgenommen (Popover-Öffner + deren Inhalte brauchen den echten
  // Fokuswechsel bzw. lösen selbst keinen Struktur-Befehl auf der ALTEN
  // Selektion aus):
  // - Schriftfarbe/Textmarker: Öffner-Knopf UND die Farbkästchen in
  //   swatchGrid (setzen nur eine Marke auf die beim ÖFFNEN bereits fest-
  //   stehende Selektion, kein Node-Austausch an der Cursor-Position).
  // - Link einfügen/bearbeiten: Öffner-Knopf UND alle Knöpfe/Eingabefelder
  //   im Popover (die Eingabefelder MÜSSEN echten Fokus bekommen können).
  // - Tabelle einfügen: Öffner-Knopf UND das Größen-Raster (reine <div>s
  //   ohne tabIndex – bekommen ohnehin nie Fokus per mousedown).
  // - "Bild einfügen": der sichtbare Knopf löst nur imageFileInputRef
  //   .click() aus (kein Editor-Befehl); die tatsächliche Einfüge-Position
  //   (editor.state.selection.to) wird ERST im onChange des versteckten
  //   Datei-Inputs gelesen – NACH dem (fokusraubenden, aber blockierenden)
  //   nativen Dateidialog, zu einem Zeitpunkt, an dem "sofort weitertippen"
  //   ohnehin unmöglich ist.
  // - "Speichern"/"Abbrechen": lösen keinen Editor-Befehl auf der Selektion
  //   aus, Fokusverlust ist hier folgenlos.
  return (
    <div className="flex-1 min-h-0 flex flex-col px-4 pb-4 gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <button onMouseDown={preventFocusSteal} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={btn(editor.isActive("heading", { level: 1 }))} title="Kapitel (#)">
          <Heading1 size={15} />
        </button>
        <button onMouseDown={preventFocusSteal} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={btn(editor.isActive("heading", { level: 2 }))} title="Abschnitt (##)">
          <Heading2 size={15} />
        </button>
        <button onMouseDown={preventFocusSteal} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={btn(editor.isActive("heading", { level: 3 }))} title="Unterthema (###)">
          <Heading3 size={15} />
        </button>
        <button onMouseDown={preventFocusSteal} onClick={() => editor.chain().focus().toggleBold().run()}
          className={btn(editor.isActive("bold"))} title="Fett">
          <Bold size={15} />
        </button>
        <button onMouseDown={preventFocusSteal} onClick={() => editor.chain().focus().toggleItalic().run()}
          className={btn(editor.isActive("italic"))} title="Kursiv">
          <Italic size={15} />
        </button>
        <button onMouseDown={preventFocusSteal} onClick={() => editor.chain().focus().toggleStrike().run()}
          className={btn(editor.isActive("strike"))} title="Durchgestrichen">
          <Strikethrough size={15} />
        </button>
        <button onMouseDown={preventFocusSteal} onClick={() => editor.chain().focus().toggleCode().run()}
          className={btn(editor.isActive("code"))} title="Code">
          <Code size={15} />
        </button>
        <button onMouseDown={preventFocusSteal} onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          className={btn(editor.isActive("codeBlock"))} title="Codeblock">
          <Code2 size={15} />
        </button>

        {/* Schriftfarbe/Textmarker (v7.41.3): Öffner-Knopf UND Farbkästchen
            BEWUSST OHNE preventFocusSteal (siehe Ausnahmeliste oben) – sie
            setzen nur eine Marke auf die beim Öffnen bereits feststehende
            Selektion, kein Node-Austausch an der Cursor-Position. */}
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

        <button onMouseDown={preventFocusSteal} onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={btn(editor.isActive("bulletList"))} title="Stichpunktliste">
          <List size={15} />
        </button>
        <button onMouseDown={preventFocusSteal} onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={btn(editor.isActive("orderedList"))} title="Nummerierte Liste">
          <ListOrdered size={15} />
        </button>
        <button onMouseDown={preventFocusSteal} onClick={() => editor.chain().focus().toggleTaskList().run()}
          className={btn(editor.isActive("taskList"))} title="Checkliste">
          <ListChecks size={15} />
        </button>
        {/* Einzug vergrößern/verkleinern (v7.41, Nutzerwunsch "Icons wie in
            Excel"): wirkt auf den Block der Cursorposition bzw. bei einer
            Auswahl auf ALLE berührten Blöcke, siehe changeIndent/
            canChangeIndent oben. Der vormals hier stehende, zusätzliche
            "editor.commands.focus()"-Aufruf (gleiche Idee, aber weiterhin
            per requestAnimationFrame verzögert, siehe Analyse oben) ist mit
            preventFocusSteal überflüssig geworden: der Fokus geht jetzt gar
            nicht erst verloren. */}
        <button onMouseDown={preventFocusSteal} onClick={() => changeIndent(editor, -1)}
          disabled={!indentDecOk}
          className={btn(false) + (indentDecOk ? "" : " opacity-40")}
          title="Einzug verkleinern (Umschalt+Tab)">
          <IndentDecrease size={15} />
        </button>
        <button onMouseDown={preventFocusSteal} onClick={() => changeIndent(editor, 1)}
          disabled={!indentIncOk}
          className={btn(false) + (indentIncOk ? "" : " opacity-40")}
          title="Einzug vergrößern (Tab)">
          <IndentIncrease size={15} />
        </button>
        <button onMouseDown={preventFocusSteal} onClick={() => editor.chain().focus().setHorizontalRule().run()}
          className={btn(false)} title="Trennlinie">
          <Minus size={15} />
        </button>

        {/* Bild einfügen (v7.41 Teil B, B3): Dateiauswahl als Alternative zu
            Zwischenablage/Drag&Drop (siehe editorProps.handlePaste/handleDrop
            oben) – NUR sichtbar, wenn eine onAddImage-Prop übergeben wurde
            (undefined-tolerant, Auftrag). "multiple" erlaubt mehrere Bilder
            auf einmal (dieselbe insertImagesSequentially-Funktion wie beim
            Paste/Drop). e.target.value wird zurückgesetzt, damit dieselbe
            Datei ein zweites Mal ausgewählt werden kann (Standard-Trick bei
            <input type="file">, sonst feuert onChange beim erneuten Wählen
            derselben Datei nicht). */}
        {onAddImage && (
          <>
            {/* BEWUSST OHNE preventFocusSteal (v7.41.3, siehe Ausnahmeliste
                oben): löst keinen Editor-Befehl aus, nur den nativen
                Dateidialog – die tatsächliche Einfügeposition wird erst in
                dessen onChange gelesen, lange nach jedem Fokus-Timing. */}
            <button
              onClick={() => imageFileInputRef.current && imageFileInputRef.current.click()}
              className={btn(false)}
              title="Bild einfügen"
            >
              <ImagePlus size={15} />
            </button>
            <input
              ref={imageFileInputRef}
              type="file"
              // ACCEPTED_IMAGE_MIME statt "image/*" (Code-Review vor
              // v7.41-Commit, 🔵 Finding 10, siehe lib/images.js/
              // extractImageFiles oben) – "accept" ist nur ein Hinweis für
              // den Datei-Dialog (Nutzer können trotzdem "Alle Dateien"
              // wählen), der isAcceptedImageType-Filter unten ist das
              // eigentliche Sicherheitsnetz.
              accept={ACCEPTED_IMAGE_MIME.join(",")}
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files || []).filter((f) => isAcceptedImageType(f.type));
                e.target.value = "";
                if (!files.length) return;
                setError(null);
                setUploadCount((n) => n + 1);
                insertImagesSequentially(editor, files, editor.state.selection.to, onAddImage, setError)
                  .finally(() => setUploadCount((n) => n - 1));
              }}
            />
          </>
        )}

        <button onMouseDown={preventFocusSteal} onClick={() => insertMath(false)} className={btn(false)} title="Formel einfügen (inline, $…$)">
          <Sigma size={15} />
        </button>
        <button onMouseDown={preventFocusSteal} onClick={() => insertMath(true)} className={btn(false)} title="Formel einfügen (abgesetzt, $$…$$)">
          <SquareFunction size={15} />
        </button>

        {/* Link einfügen/bearbeiten (v7.41.3): Öffner-Knopf UND das gesamte
            Popover BEWUSST OHNE preventFocusSteal (siehe Ausnahmeliste
            oben) – die Eingabefelder brauchen echten Fokus, applyLink()
            selbst löst keinen Struktur-Befehl auf einer FRISCH VERÄNDERTEN
            Cursor-Position aus (die Selektion steht bereits seit
            openLinkPicker() fest). */}
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

        {/* Tabelle einfügen (v7.41.3): Öffner-Knopf UND Größen-Raster MIT
            preventFocusSteal – zunächst als "Restrisiko, nicht verifiziert"
            ausgenommen, im Review dann am Quellcode belegt: "insertTable"
            führt tr.replaceSelectionWith aus (@tiptap/extension-table), also
            GENAU die Knotenersetzung an der Cursor-Position, die das
            Orphaning auslöst – und der Fokus ist zum Klick auf eine
            Rasterzelle längst weg, weil der Öffner-<button> ihn beim
            Aufklappen genommen hat. Damit sind alle drei Vorbedingungen
            erfüllt, das Raster gehört also NICHT in die Ausnahmeliste.
            Am Container statt an den 36 Zellen: mousedown blubbert hoch.
            Gefahrlos, weil weder Öffner noch Raster Eingabefelder haben. */}
        <div className="relative">
          <button
            onMouseDown={preventFocusSteal}
            onClick={() => { setPicker(picker === "table" ? null : "table"); setTableHover({ r: 0, c: 0 }); }}
            className={btn(editor.isActive("table"))}
            title="Tabelle einfügen"
          >
            <TableIcon size={15} />
          </button>
          {picker === "table" && (
            <div className="absolute z-10 top-full left-0 mt-1 p-2 bg-white border border-slate-200 rounded-lg shadow-lg">
              <div className="grid grid-cols-6 gap-0.5" onMouseDown={preventFocusSteal}>
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
            <button onMouseDown={preventFocusSteal} onClick={() => editor.chain().focus().addRowAfter().run()}
              className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 text-xs"
              title="Zeile unterhalb einfügen">
              +Zeile
            </button>
            <button onMouseDown={preventFocusSteal} onClick={() => editor.chain().focus().addColumnAfter().run()}
              className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 text-xs"
              title="Spalte rechts einfügen">
              +Spalte
            </button>
            {/* Die Kopfzeile ist nicht löschbar: ohne sie wäre die Tabelle
                kein GFM mehr und fiele auf HTML-Serialisierung zurück, die
                die Leseansicht nicht darstellt. */}
            <button onMouseDown={preventFocusSteal} onClick={() => editor.chain().focus().deleteRow().run()}
              disabled={editor.isActive("tableHeader")}
              className={"px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-600 text-xs " +
                (editor.isActive("tableHeader") ? "opacity-40" : "hover:bg-slate-50")}
              title={editor.isActive("tableHeader") ? "Kopfzeile kann nicht gelöscht werden" : "Aktuelle Zeile löschen"}>
              −Zeile
            </button>
            <button onMouseDown={preventFocusSteal} onClick={() => editor.chain().focus().deleteColumn().run()}
              className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 text-xs"
              title="Aktuelle Spalte löschen">
              −Spalte
            </button>
            <button onMouseDown={preventFocusSteal} onClick={() => editor.chain().focus().deleteTable().run()}
              className="px-2 py-1.5 rounded-lg border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 text-xs"
              title="Ganze Tabelle löschen">
              ✕Tabelle
            </button>
          </>
        )}
        <div className="flex-1" />
        {/* Rückgängig/Wiederholen (v7.41.3, über die Auftragsliste hinaus
            ERGÄNZT, siehe Analyse oben): kann Knoten GENAU an der
            Cursor-Position ersetzen wie jeder andere Struktur-Befehl. */}
        <button onMouseDown={preventFocusSteal} onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          className={btn(false) + (editor.can().undo() ? "" : " opacity-40")} title="Rückgängig">
          <Undo2 size={15} />
        </button>
        <button onMouseDown={preventFocusSteal} onClick={() => editor.chain().focus().redo().run()}
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
            außer der reinen Breitenangabe).
            v7.26: jeder Eintrag bekommt links einen Grip-Anfasser
            (GripVertical) für Drag&Drop-Umsortierung (startOutlineDrag
            oben) – bewusst ein EIGENES Element statt draggable auf dem
            Navigations-Knopf selbst, sonst würde jeder Ziehversuch
            zusätzlich einen Klick/Sprung auslösen. Zwischen (und vor/nach)
            den Einträgen liegt je eine unsichtbare Dropzone
            (data-outline-boundary), die NUR während eines laufenden Drags
            gerendert wird – siehe renderDropZone unten. */}
        <nav
          style={{ "--nav-w": (navWidth || 148) + "px" }}
          className="hidden md:block md:w-[var(--nav-w)] shrink-0 overflow-y-auto py-1 pr-1"
        >
          {renderDropZone(0)}
          {outline.map((item, i) => (
            // Einrückung über einen Wrapper mit Innenabstand (pl-3) statt
            // ml-3 direkt am Knopf: "w-full" bezöge sich sonst weiter auf
            // die volle Leistenbreite und würde nach rechts überstehen.
            <div key={i + item.from}>
              <div
                className={(item.level === 2 ? "pl-3 " : "") +
                  "flex items-center gap-0.5 mb-1.5 " +
                  (dragOutline && dragOutline.index === i ? "opacity-40" : "")}
              >
                <button
                  type="button"
                  onPointerDown={(e) => startOutlineDrag(e, i)}
                  // Der Grip selbst navigiert NIE (siehe Kopfkommentar) –
                  // ein reiner Klick ohne Ziehen darf keine Aktion auslösen.
                  onClick={(e) => e.preventDefault()}
                  title="Ziehen zum Verschieben"
                  className="shrink-0 p-0.5 rounded text-slate-300 hover:text-slate-500 hover:bg-slate-100 cursor-grab active:cursor-grabbing touch-none"
                >
                  <GripVertical size={13} />
                </button>
                <button
                  // onMouseDown+preventDefault (v7.15-Fix): verhindert, dass
                  // der Browser den DOM-Fokus schon beim Mausdruck auf den
                  // Button verschiebt, BEVOR onClick überhaupt läuft – sonst
                  // driften DOM-Selection und ProseMirror-Selection auseinander
                  // (siehe jumpToHeading-Kommentar oben).
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => jumpToHeading(editor, item.from)}
                  title={item.title || (item.level === 1 ? "Kapitel" : "Abschnitt")}
                  className={"flex-1 min-w-0 text-left truncate rounded-r-xl border border-l-0 shadow-sm " +
                    (item.level === 1
                      ? "text-xs font-bold py-1.5 pl-2 pr-2 border-slate-300 bg-gradient-to-r from-slate-100 to-slate-200 text-slate-900"
                      : "text-xs py-1 pl-2 pr-2 border-slate-200 bg-gradient-to-r from-slate-50 to-slate-100 text-slate-600")}
                >
                  {item.title || "(ohne Titel)"}
                </button>
              </div>
              {renderDropZone(i + 1)}
            </div>
          ))}
        </nav>
      </div>

      {/* Upload-Hinweis (v7.41 Teil B): solange mindestens ein Bild noch
          hochgeladen wird, ist "Speichern" gesperrt (siehe save() oben) –
          dieser Hinweis macht sichtbar, WARUM, statt den Knopf kommentarlos
          ausgegraut zu lassen. */}
      {uploading && (
        <div className="px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-200 text-xs text-indigo-800 flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" />
          Bild wird hochgeladen …
        </div>
      )}
      {error && (
        <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving || uploading}
          className={"px-3 py-1.5 rounded-lg bg-indigo-700 text-white text-sm font-medium " +
            (saving || uploading ? "opacity-40" : "hover:bg-indigo-800")}>
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
