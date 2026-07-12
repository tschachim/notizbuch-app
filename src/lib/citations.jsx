/* ------------------------------------------------------------------ */
/* Zitate aus Websuche-Antworten                                       */
/*                                                                     */
/* Das Modell markiert recherchierte Aussagen mit                      */
/* <cite index="D-P">Text</cite> (D = Nummer des Suchtreffers,         */
/* 1-basiert). Die zugehörigen Quellen (URL+Titel) sammelt callClaude  */
/* aus den web_search_tool_result-Blöcken. Hier werden die Tags in     */
/* klickbare Fußnoten umgewandelt.                                     */
/* ------------------------------------------------------------------ */

const OPEN_RE = /<cite\s+index="([^"]*)"[^>]*>/i;
const CLOSE_RE = /<\/cite>/i;

// Quellen zu einem index-Attribut auflösen (best effort): kommagetrennte
// Einträge, je Eintrag 1-basiert ("D" oder "D-P", Fallback 0-basiert).
function resolveSources(indexAttr, sources) {
  const out = [];
  for (const part of String(indexAttr).split(",")) {
    const a = parseInt(part.split("-")[0], 10);
    if (!Number.isFinite(a)) continue;
    const src = sources[a - 1] || sources[a] || null;
    // Defense-in-Depth: nur http(s)-Quellen verlinken (kein javascript:-Schema).
    if (src && /^https?:\/\//i.test(src.url) && !out.includes(src)) out.push(src);
  }
  return out;
}

// Zerlegt den Text in React-Knoten und liefert die Fußnoten-Liste.
// { nodes: ReactNode[], footnotes: [{ num, url, title }] }
export function renderWithCites(text, sources) {
  const nodes = [];
  const footnotes = [];
  const numByUrl = new Map();
  let s = String(text || "");
  let k = 0;

  const footnoteFor = (src) => {
    if (numByUrl.has(src.url)) return numByUrl.get(src.url);
    const num = footnotes.length + 1;
    numByUrl.set(src.url, num);
    footnotes.push({ num, url: src.url, title: src.title || src.url });
    return num;
  };

  while (s.length) {
    const open = OPEN_RE.exec(s);
    // Auch Restsegmente strippen: verwaiste </cite> oder Tags ohne index
    // sollen nicht als Rohmarkup im Chat stehen.
    if (!open) { nodes.push(stripCiteTags(s)); break; }
    if (open.index > 0) nodes.push(stripCiteTags(s.slice(0, open.index)));
    const rest = s.slice(open.index + open[0].length);
    const close = CLOSE_RE.exec(rest);
    const inner = close ? rest.slice(0, close.index) : rest;
    nodes.push(stripCiteTags(inner));
    for (const src of resolveSources(open[1], sources || [])) {
      const num = footnoteFor(src);
      nodes.push(
        <sup key={"c" + k++} className="ml-0.5">
          <a
            href={src.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 hover:underline font-medium no-underline"
            title={src.title || src.url}
          >
            [{num}]
          </a>
        </sup>
      );
    }
    s = close ? rest.slice(close.index + close[0].length) : "";
  }
  return { nodes, footnotes };
}

// cite-Tags restlos entfernen (für Dokument-Inhalte: dort gehören
// Quellen als Klartext hin, nicht als Markup).
export function stripCiteTags(s) {
  return typeof s === "string" ? s.replace(/<\/?cite[^>]*>/gi, "") : s;
}
