/* ------------------------------------------------------------------ */
/* Markdown: Baum-Parser & Block-Renderer                              */
/* Basis aus der Referenz-App (Artifact v3.1); erweitert um:           */
/* ~~durchgestrichen~~, Schriftfarbe (<span style="color:…">),         */
/* Textmarker (<mark …>), nummerierte Listen und Checklisten mit       */
/* klickbaren Kästchen (Zeilen behalten dafür ihren Original-Index).   */
/* ------------------------------------------------------------------ */

import { ChevronDown } from "lucide-react";
import {
  MATH_TOKEN_RE, renderMathToken, renderKatexHtml,
  DISPLAY_MATH_START_RE, matchDisplayBlock,
} from "./math.jsx";
import { FENCE_OPEN_RE, matchFenceBlock, splitFenceSegments, CodeBlockView } from "./code.jsx";

export const IMG_LINE_RE = /^!\[([^\]]*)\]\(img:([a-zA-Z0-9]+)\)$/;
export const IMG_REF_RE = /!\[[^\]]*\]\(img:([a-zA-Z0-9]+)\)/g;

export const TASK_RE = /^(\s*[-*]\s+\[)( |x|X)(\]\s+)(.*)$/;
const OL_RE = /^\s*\d+[.)]\s+(.*)$/;
const UL_RE = /^\s*[-*]\s+(.*)$/;
const TABLE_LINE_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEP_RE = /^\s*\|(\s*:?-+:?\s*\|)+\s*$/;

// Display-Math-Block-Erkennung: DISPLAY_MATH_START_RE/matchDisplayBlock
// leben zentral in math.jsx (EINE Regel für Dokument-Ansicht UND den
// Editor-Ladepfad, siehe dort und DECISIONS #46-49).

/* Zeilen behalten ihren Original-Index im Dokument, damit z. B. das
   Abhaken einer Checkbox die richtige Zeile im Markdown ändern kann. */
export function parseTree(text) {
  const lines = text.split("\n");
  const pre = [];
  const sections = [];
  let cur = null;
  let curSub = null;
  lines.forEach((line, idx) => {
    if (/^###\s+/.test(line)) {
      if (!cur) { cur = { title: "Allgemein", lines: [], subs: [] }; sections.push(cur); }
      curSub = { title: line.replace(/^###\s+/, "").trim(), lines: [] };
      cur.subs.push(curSub);
    } else if (/^##\s+/.test(line)) {
      cur = { title: line.replace(/^##\s+/, "").trim(), lines: [], subs: [] };
      sections.push(cur);
      curSub = null;
    } else {
      (curSub ? curSub.lines : cur ? cur.lines : pre).push({ text: line, idx });
    }
  });
  return { pre, sections };
}

/* ---------------- Inline-Rendering (rekursiv) ---------------- */

// Nur echte Farbwerte in Inline-Styles übernehmen (kein Weg für XSS).
const COLOR_OK = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\))$/;

// _-Emphase nur an Wortgrenzen (wie GFM): Unterstriche mitten im Wort –
// etwa in URLs von Quellen-Fußnoten – sind keine Auszeichnung.
const INLINE_TOKEN_RE =
  /(\*\*[^*\n]+\*\*|~~[^~\n]+~~|\*[^*\n]+\*|(?<![\w\d])_[^_\n]+_(?![\w\d])|`[^`\n]+`|\[\d+\]\(https?:\/\/(?:[^\s()]|\([^\s()]*\))+\)|<(?:span|mark)\b[^>]*>)/;

// Formeln ($…$, $$…$$, \$) werden NICHT als weitere Alternative in
// INLINE_TOKEN_RE eingebaut (Regex-Source-Konkatenation wäre fehleranfällig
// und würde die Formel-Regel aus math.jsx duplizieren). Stattdessen prüft
// renderInline beide Regexe parallel und lässt die früher beginnende
// gewinnen – bei Gleichstand die Formel. Das garantiert, dass fett/kursiv/
// Links eine Formel nie mitten durchschneiden: Läuft z. B. **fett** VOR
// einer Formel, gewinnt fett und reicht seinen Inhalt rekursiv an
// renderInline zurück, das die Formel darin beim nächsten Durchlauf erneut
// erkennt. Beginnt dagegen die Formel zuerst (z. B. "$x_i$" mit Unterstrich
// für den Index), kann die _-Emphase sie nicht anschneiden: Deren Regel
// verlangt ohnehin einen Unterstrich an einer Wortgrenze – ein Index-
// Unterstrich direkt hinter einem Buchstaben erfüllt das nie.

/* ---------------- Quellen-Fußnoten im Dokument ---------------- */
/* Konvention: [n](https://…) direkt hinter der belegten Aussage – ein
   Markdown-Link mit reiner Zahl als Text. Er übersteht den WYSIWYG-
   Roundtrip (Link-Extension) und wird hier als hochgestellte Zahl
   gerendert. Die Nummern vergibt renumberCitations dokumentweit.
   Die URL darf eine Ebene runder Klammern enthalten (Wikipedia!). */

const CITE_LINK_RE = /\[(\d+)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)/g;

// Fußnoten von Dokumentanfang bis -ende durchnummerieren: gleiche URL =
// gleiche Nummer (erste Fundstelle bestimmt die Reihenfolge). Wird bei
// jedem Schreiben angewendet, damit Einfügungen sauber umnummerieren.
// Codespans bleiben unangetastet (der Renderer zeigt sie literal).
// Fenced-Codeblöcke (```…```, v7.7) werden VORAB per splitFenceSegments
// komplett ausgenommen – ein "[1](https://…)" innerhalb eines Codeblocks
// (z. B. Beispiel-Markdown in einem Snippet) darf nicht umnummeriert
// werden, der Block bleibt byte-genau erhalten. numByUrl lebt bewusst
// AUSSERHALB der Segment-Schleife: die Nummerierung muss über Fence-
// Grenzen hinweg konsistent bleiben (dieselbe URL vor UND nach einem
// Codeblock bekommt weiterhin dieselbe Nummer).
export function renumberCitations(md) {
  const numByUrl = new Map();
  const renumberOutsideFences = (text) =>
    text
      .split(/(`[^`\n]+`)/)
      .map((seg, i) =>
        i % 2
          ? seg
          : seg.replace(CITE_LINK_RE, (m, num, url) => {
              if (!numByUrl.has(url)) numByUrl.set(url, numByUrl.size + 1);
              return "[" + numByUrl.get(url) + "](" + url + ")";
            })
      )
      .join("");
  return splitFenceSegments(String(md))
    .map((seg) => (seg.code ? seg.raw : renumberOutsideFences(seg.raw)))
    .join("\n");
}

// Passendes schließendes Tag finden (gleichnamige Verschachtelung mitzählen).
function findClose(text, from, tag) {
  const open = "<" + tag;
  const close = "</" + tag + ">";
  let depth = 1;
  let i = from;
  while (i < text.length) {
    const nextOpen = text.indexOf(open, i);
    const nextClose = text.indexOf(close, i);
    if (nextClose === -1) return -1;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + open.length;
    } else {
      depth--;
      if (!depth) return nextClose;
      i = nextClose + close.length;
    }
  }
  return -1;
}

// Aus dem öffnenden Tag nur die erlaubten Farb-Styles übernehmen.
function extractStyles(openTag, tag) {
  const style = {};
  const styleM = /style="([^"]*)"/.exec(openTag);
  const dataColorM = /data-color="([^"]*)"/.exec(openTag);
  for (const decl of styleM ? styleM[1].split(";") : []) {
    const at = decl.indexOf(":");
    if (at === -1) continue;
    const prop = decl.slice(0, at).trim().toLowerCase();
    const val = decl.slice(at + 1).trim();
    if (!COLOR_OK.test(val)) continue;
    if (tag === "span" && prop === "color") style.color = val;
    if (tag === "mark" && prop === "background-color") style.backgroundColor = val;
  }
  if (tag === "mark" && !style.backgroundColor && dataColorM && COLOR_OK.test(dataColorM[1])) {
    style.backgroundColor = dataColorM[1];
  }
  return style;
}

function renderInline(text) {
  const parts = [];
  let k = 0;
  let s = text;
  while (s.length) {
    const otherM = INLINE_TOKEN_RE.exec(s);
    const mathM = MATH_TOKEN_RE.exec(s);
    // Bei Gleichstand gewinnt die Formel (siehe Kommentar bei INLINE_TOKEN_RE).
    const isMath = mathM && (!otherM || mathM.index <= otherM.index);
    const m = isMath ? mathM : otherM;
    if (!m) { parts.push(s); break; }
    if (m.index > 0) parts.push(s.slice(0, m.index));
    const tok = m[0];
    const after = m.index + tok.length;

    if (isMath) {
      parts.push(renderMathToken(tok, k++));
      s = s.slice(after);
      continue;
    }

    if (tok.startsWith("<")) {
      const tag = tok.startsWith("<span") ? "span" : "mark";
      const closeAt = findClose(s, after, tag);
      if (closeAt === -1) {
        // kaputtes/unbekanntes Tag: als Text stehen lassen
        parts.push(tok);
        s = s.slice(after);
        continue;
      }
      const inner = renderInline(s.slice(after, closeAt));
      const style = extractStyles(tok, tag);
      parts.push(
        tag === "span"
          ? <span key={k++} style={style}>{inner}</span>
          : <mark key={k++} style={style} className="rounded px-0.5">{inner}</mark>
      );
      s = s.slice(closeAt + tag.length + 3); // "</" + tag + ">"
      continue;
    }

    if (tok.startsWith("[")) {
      const cm = /^\[(\d+)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)$/.exec(tok);
      if (!cm) { parts.push(tok); s = s.slice(after); continue; }
      parts.push(
        <sup key={k++} className="ml-0.5">
          <a
            href={cm[2]}
            target="_blank"
            rel="noopener noreferrer"
            title={cm[2]}
            className="text-indigo-600 hover:underline font-medium no-underline"
          >
            [{cm[1]}]
          </a>
        </sup>
      );
    } else if (tok.startsWith("**")) {
      parts.push(<strong key={k++} className="font-semibold text-slate-900">{renderInline(tok.slice(2, -2))}</strong>);
    } else if (tok.startsWith("~~")) {
      parts.push(<s key={k++} className="text-slate-400">{renderInline(tok.slice(2, -2))}</s>);
    } else if (tok.startsWith("`")) {
      parts.push(<code key={k++} className="font-mono text-sm bg-slate-100 border border-slate-200 rounded px-1">{tok.slice(1, -1)}</code>);
    } else {
      parts.push(<em key={k++}>{renderInline(tok.slice(1, -1))}</em>);
    }
    s = s.slice(after);
  }
  return parts;
}

function Inline({ text }) {
  return <>{renderInline(text)}</>;
}

/* ---------------- Tabellen (GFM-Pipe-Format) ---------------- */

// Zelle: an unescapten Pipes trennen, \| in Zellen bleibt ein Pipe.
const splitRow = (line) =>
  line.trim().replace(/^\|/, "").replace(/\|\s*$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));

function renderTable(tlines, key) {
  let header = null;
  let bodyLines = tlines;
  if (tlines.length >= 2 && TABLE_SEP_RE.test(tlines[1])) {
    header = splitRow(tlines[0]);
    bodyLines = tlines.slice(2);
  }
  let body = bodyLines.filter((l) => !TABLE_SEP_RE.test(l)).map(splitRow);
  // Wie GFM: Datenzeilen auf die Kopfbreite bringen (kürzen bzw. mit
  // Leerzellen auffüllen), sonst verrutschen die Spalten.
  if (header) {
    body = body.map((row) =>
      row.length > header.length
        ? row.slice(0, header.length)
        : [...row, ...Array(header.length - row.length).fill("")]
    );
  }
  const thCls = "border border-slate-200 bg-slate-50 px-2 py-1 text-left font-semibold text-slate-800";
  const tdCls = "border border-slate-200 px-2 py-1 text-slate-700 align-top";
  return (
    <div key={key} className="overflow-x-auto my-3">
      <table className="border-collapse text-sm">
        {header && (
          <thead>
            <tr>{header.map((c, i) => <th key={i} className={thCls}><Inline text={c} /></th>)}</tr>
          </thead>
        )}
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri}>
              {row.map((c, ci) => <td key={ci} className={tdCls}><Inline text={c} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Block-Rendering ---------------- */

function renderBlocks(lines, imgMap, onImgClick, keyPrefix, onToggleTask) {
  const blocks = [];
  let list = null; // { type: "ul" | "ol" | "task", items: [] }
  let key = 0;
  const kp = keyPrefix || "b";

  const flush = () => {
    if (list && list.items.length) {
      if (list.type === "ol") {
        blocks.push(<ol key={kp + key++} className="list-decimal pl-5 mb-3 space-y-1">{list.items}</ol>);
      } else if (list.type === "task") {
        blocks.push(<ul key={kp + key++} className="pl-1 mb-3 space-y-1">{list.items}</ul>);
      } else {
        blocks.push(<ul key={kp + key++} className="list-disc pl-5 mb-3 space-y-1">{list.items}</ul>);
      }
    }
    list = null;
  };
  const ensure = (type) => {
    if (!list || list.type !== type) { flush(); list = { type, items: [] }; }
  };

  // Für matchDisplayBlock: reine Textzeilen ohne die {text, idx}-Hülle,
  // einmal vorab gebaut statt pro Zeile neu zu mappen.
  const rawLines = lines.map((l) => l.text);

  for (let li = 0; li < lines.length; li++) {
    const { text: line, idx } = lines[li];
    const imgM = IMG_LINE_RE.exec(line.trim());
    const taskM = TASK_RE.exec(line);
    // null bedeutet "kein sauberer, zeilenverankerter Block" (siehe
    // matchDisplayBlock in math.jsx) – die Zeile fällt dann bewusst durch
    // zu den späteren Zweigen (i. d. R. der normale Absatz-Zweig ganz
    // unten), wo renderInline/Inline "$$x$$ mehr Text" als eingebetteten
    // Display-Span erkennt bzw. eine unterminierte $$-Zeile literal lässt
    // (Review-Finding 4 – vorher wurde hier der Rest des Abschnitts als
    // TeX verschluckt). Codespans sind reines Inline-Markup (siehe
    // renderInline). Fenced-Codeblöcke (```…```, v7.7 – DECISIONS #14
    // damit aufgehoben) werden separat über fenceM erkannt (siehe unten);
    // sie stehen ZEILENANFANG-verankert wie mathBlock und werden deshalb
    // hier genauso vorab geprüft, bevor die Zeile in die übrigen Zweige
    // fallen kann.
    const mathBlock = DISPLAY_MATH_START_RE.test(line) ? matchDisplayBlock(rawLines, li) : null;
    // Unterminierter Zaun (kein ausreichend langer schließender Zaun bis
    // Abschnittsende, li läuft hier nie über die aktuelle Section/Sub-
    // Section hinaus, siehe parseTree) liefert null – die Zeile fällt dann
    // bewusst durch zu den normalen Zweigen unten und wird literal als
    // Absatz gerendert (keine INLINE_TOKEN_RE-Alternative matcht eine
    // ununterbrochene Backtick-Folge ohne weiteren Backtick später in der
    // Zeile, unabhängig von deren Länge), statt den Rest des Abschnitts zu
    // verschlucken (gleiche Philosophie wie matchDisplayBlock).
    const fenceM = FENCE_OPEN_RE.test(line) ? matchFenceBlock(rawLines, li) : null;
    if (fenceM) {
      // Inhalt bleibt byte-genau erhalten: KEIN renderInline, keine
      // Math-/Bild-/Fußnoten-/Checklisten-Logik innerhalb eines Codeblocks.
      flush();
      blocks.push(<CodeBlockView key={kp + key++} lang={fenceM.lang} code={fenceM.code} />);
      li = fenceM.endIdx;
    } else if (TABLE_LINE_RE.test(line)) {
      flush();
      const tlines = [line];
      while (li + 1 < lines.length && TABLE_LINE_RE.test(lines[li + 1].text)) {
        li++;
        tlines.push(lines[li].text);
      }
      blocks.push(renderTable(tlines, kp + key++));
    } else if (mathBlock) {
      flush();
      blocks.push(
        <div
          key={kp + key++}
          className="my-3 overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: renderKatexHtml(mathBlock.tex, true) }}
        />
      );
      li = mathBlock.endIdx;
    } else if (imgM) {
      flush();
      const [, altRaw, id] = imgM;
      // Optionaler Größen-Suffix aus dem Editor: "Titel|w320" → 320 px breit.
      const wM = /^(.*?)\|w(\d+)$/.exec(altRaw);
      const alt = wM ? wM[1] : altRaw;
      const width = wM ? parseInt(wM[2], 10) : null;
      const src = imgMap[id];
      // Der Titel (alt) bleibt bewusst nur als alt/title am <img> – keine
      // sichtbare figcaption mehr (v7.2, Nutzerwunsch): direkt darunter
      // folgt per Konvention die kursive Bildunterschrift als eigene
      // Markdown-Zeile, die fette figcaption wirkte wie ein Duplikat. Der
      // Titel steckt weiterhin im Markdown (![Titel](img:…)) – Roundtrip
      // bleibt unverändert, es wird nur nicht mehr zusätzlich gerendert.
      blocks.push(
        <figure key={kp + key++} className="my-3">
          {src ? (
            <img
              src={src}
              alt={alt}
              title={alt || undefined}
              onClick={() => onImgClick && onImgClick(src)}
              style={width ? { width: width + "px", maxWidth: "100%" } : undefined}
              className={(width ? "" : "max-h-64 ") + "rounded-lg border border-slate-200 shadow-sm cursor-pointer"}
            />
          ) : (
            <div className="h-24 flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-400 font-sans">
              Bild wird geladen …
            </div>
          )}
        </figure>
      );
    } else if (/^#\s+/.test(line)) {
      flush();
      blocks.push(<h1 key={kp + key++} className="text-xl font-bold text-slate-900 mb-2">{line.replace(/^#\s+/, "")}</h1>);
    } else if (taskM) {
      ensure("task");
      const checked = taskM[2].toLowerCase() === "x";
      list.items.push(
        <li key={kp + key++} className="flex items-start gap-2 text-slate-700 leading-relaxed">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onToggleTask && onToggleTask(idx, !checked)}
            className="mt-1 shrink-0 accent-indigo-600 cursor-pointer"
          />
          <span className={checked ? "line-through text-slate-400" : ""}>
            <Inline text={taskM[4]} />
          </span>
        </li>
      );
    } else if (OL_RE.test(line)) {
      ensure("ol");
      list.items.push(
        <li key={kp + key++} className="text-slate-700 leading-relaxed">
          <Inline text={line.replace(/^\s*\d+[.)]\s+/, "")} />
        </li>
      );
    } else if (UL_RE.test(line)) {
      ensure("ul");
      list.items.push(
        <li key={kp + key++} className="text-slate-700 leading-relaxed">
          <Inline text={line.replace(/^\s*[-*]\s+/, "")} />
        </li>
      );
    } else if (/^-{3,}$/.test(line.trim())) {
      flush();
      blocks.push(<hr key={kp + key++} className="my-4 border-slate-200" />);
    } else if (line.trim() === "") {
      flush();
    } else {
      flush();
      blocks.push(<p key={kp + key++} className="text-slate-700 leading-relaxed mb-2"><Inline text={line} /></p>);
    }
  }
  flush();
  return blocks;
}

export function DocView({ text, collapsed, onToggle, imgMap, onImgClick, onToggleTask, anchorPrefix }) {
  const { pre, sections } = parseTree(text);
  const ap = anchorPrefix || "sec-";
  return (
    // Gleiche Schriftart/-größe wie der Chat (Nutzerwunsch); Hierarchie nur
    // noch über Größe/Gewicht der Überschriften.
    // break-words: lange Code-Tokens/URLs dürfen die Seite auf dem Handy
    // nicht über die Gerätebreite hinausschieben.
    <div className="font-sans text-sm break-words">
      {renderBlocks(pre, imgMap, onImgClick, "pre", onToggleTask)}
      {sections.map((sec, si) => {
        const key = "s:" + sec.title;
        const isC = !!collapsed[key];
        return (
          <div key={key + si} id={ap + si} className="mt-5">
            <button
              onClick={() => onToggle(key)}
              className="w-full flex items-center gap-1.5 text-left pb-1 border-b border-slate-200"
            >
              <ChevronDown size={16} className={"text-slate-400 " + (isC ? "-rotate-90" : "")} />
              <span className="text-base font-semibold text-slate-900">{sec.title}</span>
            </button>
            {!isC && (
              <div className="pt-2">
                {renderBlocks(sec.lines, imgMap, onImgClick, "s" + si, onToggleTask)}
                {sec.subs.map((sub, bi) => {
                  const sk = "s:" + sec.title + "/" + sub.title;
                  const sc = !!collapsed[sk];
                  return (
                    <div key={sk + bi} className="mt-3 pl-3 border-l-2 border-slate-100">
                      <button onClick={() => onToggle(sk)} className="flex items-center gap-1.5 text-left">
                        <ChevronDown size={14} className={"text-slate-400 " + (sc ? "-rotate-90" : "")} />
                        <span className="text-sm font-semibold text-slate-800">{sub.title}</span>
                      </button>
                      {!sc && <div className="pt-1">{renderBlocks(sub.lines, imgMap, onImgClick, "s" + si + "b" + bi, onToggleTask)}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
