/* ------------------------------------------------------------------ */
/* Markdown: Baum-Parser & Block-Renderer                              */
/* 1:1 aus der Referenz-App (Artifact v3.1) übernommen.                */
/* ------------------------------------------------------------------ */

import { ChevronDown } from "lucide-react";

export const IMG_LINE_RE = /^!\[([^\]]*)\]\(img:([a-zA-Z0-9]+)\)$/;
export const IMG_REF_RE = /!\[[^\]]*\]\(img:([a-zA-Z0-9]+)\)/g;

export function parseTree(text) {
  const lines = text.split("\n");
  const pre = [];
  const sections = [];
  let cur = null;
  let curSub = null;
  for (const line of lines) {
    if (/^###\s+/.test(line)) {
      if (!cur) { cur = { title: "Allgemein", lines: [], subs: [] }; sections.push(cur); }
      curSub = { title: line.replace(/^###\s+/, "").trim(), lines: [] };
      cur.subs.push(curSub);
    } else if (/^##\s+/.test(line)) {
      cur = { title: line.replace(/^##\s+/, "").trim(), lines: [], subs: [] };
      sections.push(cur);
      curSub = null;
    } else {
      (curSub ? curSub.lines : cur ? cur.lines : pre).push(line);
    }
  }
  return { pre, sections };
}

function Inline({ text }) {
  const parts = [];
  const re = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`)/g;
  let last = 0, m, k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const s = m[0];
    if (s.startsWith("**")) parts.push(<strong key={k++} className="font-semibold text-slate-900">{s.slice(2, -2)}</strong>);
    else if (s.startsWith("`")) parts.push(<code key={k++} className="font-mono text-sm bg-slate-100 border border-slate-200 rounded px-1">{s.slice(1, -1)}</code>);
    else parts.push(<em key={k++}>{s.slice(1, -1)}</em>);
    last = m.index + s.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function renderBlocks(lines, imgMap, onImgClick, keyPrefix) {
  const blocks = [];
  let list = null;
  let key = 0;
  const kp = keyPrefix || "b";
  const flush = () => {
    if (list && list.length) {
      blocks.push(<ul key={kp + key++} className="list-disc pl-5 mb-3 space-y-1">{list}</ul>);
    }
    list = null;
  };
  for (const line of lines) {
    const imgM = IMG_LINE_RE.exec(line.trim());
    if (imgM) {
      flush();
      const [, alt, id] = imgM;
      const src = imgMap[id];
      blocks.push(
        <figure key={kp + key++} className="my-3">
          {src ? (
            <img
              src={src}
              alt={alt}
              onClick={() => onImgClick && onImgClick(src)}
              className="max-h-64 rounded-lg border border-slate-200 shadow-sm cursor-pointer"
            />
          ) : (
            <div className="h-24 flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-400 font-sans">
              Bild wird geladen …
            </div>
          )}
          {alt ? <figcaption className="mt-1 text-sm font-semibold text-slate-800">{alt}</figcaption> : null}
        </figure>
      );
    } else if (/^#\s+/.test(line)) {
      flush();
      blocks.push(<h1 key={kp + key++} className="text-xl font-bold text-slate-900 mb-2">{line.replace(/^#\s+/, "")}</h1>);
    } else if (/^\s*[-*]\s+/.test(line)) {
      const item = line.replace(/^\s*[-*]\s+/, "");
      if (!list) list = [];
      list.push(<li key={kp + key++} className="text-slate-700 leading-relaxed"><Inline text={item} /></li>);
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

export function DocView({ text, collapsed, onToggle, imgMap, onImgClick }) {
  const { pre, sections } = parseTree(text);
  return (
    // Gleiche Schriftart/-größe wie der Chat (Nutzerwunsch); Hierarchie nur
    // noch über Größe/Gewicht der Überschriften.
    <div className="font-sans text-sm">
      {renderBlocks(pre, imgMap, onImgClick, "pre")}
      {sections.map((sec, si) => {
        const key = "s:" + sec.title;
        const isC = !!collapsed[key];
        return (
          <div key={key + si} className="mt-5">
            <button
              onClick={() => onToggle(key)}
              className="w-full flex items-center gap-1.5 text-left pb-1 border-b border-slate-200"
            >
              <ChevronDown size={16} className={"text-slate-400 " + (isC ? "-rotate-90" : "")} />
              <span className="text-base font-semibold text-slate-900">{sec.title}</span>
            </button>
            {!isC && (
              <div className="pt-2">
                {renderBlocks(sec.lines, imgMap, onImgClick, "s" + si)}
                {sec.subs.map((sub, bi) => {
                  const sk = "s:" + sec.title + "/" + sub.title;
                  const sc = !!collapsed[sk];
                  return (
                    <div key={sk + bi} className="mt-3 pl-3 border-l-2 border-slate-100">
                      <button onClick={() => onToggle(sk)} className="flex items-center gap-1.5 text-left">
                        <ChevronDown size={14} className={"text-slate-400 " + (sc ? "-rotate-90" : "")} />
                        <span className="text-sm font-semibold text-slate-800">{sub.title}</span>
                      </button>
                      {!sc && <div className="pt-1">{renderBlocks(sub.lines, imgMap, onImgClick, "s" + si + "b" + bi)}</div>}
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
