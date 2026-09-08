/* ------------------------------------------------------------------ */
/* Zitate aus Websuche-Antworten                                       */
/*                                                                     */
/* Das Modell markiert recherchierte Aussagen mit                      */
/* <cite index="D-P">Text</cite> (D = Nummer des Suchtreffers,         */
/* 1-basiert). Die zugehörigen Quellen (URL+Titel) sammelt callClaude  */
/* aus den web_search_tool_result-Blöcken. Hier werden die Tags in     */
/* klickbare Fußnoten umgewandelt.                                     */
/*                                                                     */
/* C3-Nachlauf (v7.54, E2E-Fund v7.53): das Modell schrieb im Chat-Text */
/* vereinzelt eine runde statt spitzer Klammer als Öffner              */
/* ((cite index="1">… statt <cite index="1">…) und ließ das Schluss-   */
/* Tag ganz weg - Modellvarianz, kein Typo im Bestandscode (siehe       */
/* DECISIONS #112). OPEN_RE toleriert deshalb "<" ODER "(" als          */
/* Öffner-Zeichen (CLOSE_RE bleibt STRIKT "</cite>" - ein bloßes ")"    */
/* wird NIE als Schluss gewertet, sonst würde normale Prosa mit runden  */
/* Klammern wie "(siehe oben)" beschädigt). Fehlt "</cite>", endet das  */
/* Zitat implizit am Beginn des NÄCHSTEN OPEN_RE-Treffers statt am      */
/* Stringende, damit eine zweite Quellenattribution direkt danach nicht */
/* als Teil des ersten Zitats verschluckt wird. Seit Nacharbeit Runde 5 */
/* (Finding N1) ist die RUNDE Öffner-Variante in OPEN_RE selbst GENAUSO */
/* STRENG wie die spitze (index-Attribut Pflicht, kein ")"/Zeilenumbruch*/
/* vor dem schließenden ">") - siehe OPEN_RE-Kommentar unten.           */
/* ------------------------------------------------------------------ */

// Nacharbeit Runde 5 (🟡 N1, Review-Fund): OPEN_RE bestand bisher aus EINEM
// gemeinsamen Muster ("[<(]cite\s+index=\"…\"[^>]*>") für BEIDE
// Öffner-Zeichen - der Stopper "[^>]*" lief für die RUNDE Variante bis zum
// NÄCHSTEN ">" irgendwo im restlichen Fließtext, egal ob Blockquote-Zeichen
// ("> ") oder Vergleichszeichen ("3 > 2"). renderWithCites/
// citeTagsToDocLinks nutzen OPEN_RE DIREKT für die Tag-Grenzen (NICHT die
// bereits in Runde 4 geschärfte STRIP_ROUND_OPEN_RE weiter unten - deren Fix
// deckte deshalb nur stripCiteTags ab): ein Modell-Typo mit strayer ")"
// direkt nach dem index-Attribut ("(cite index=\"1\") 330 Meter hoch.\n>
// Zitat danach") ließ OPEN_RE bis zu diesem nächsten ">" durchlaufen und
// verschluckte den kompletten Dokumenttext dazwischen - "Der Turm ist "
// + " Zitat danach" blieb übrig. Fix: EIN gemeinsamer Ausdruck mit ZWEI
// eigenen Alternativen/Capture-Gruppen. Gruppe 1 (spitz) bleibt bewusst lax
// (`[^>]*`) - ein "<" gefolgt von "cite" kommt in normaler Prosa praktisch
// nie vor. Gruppe 2 (rund) ist jetzt GENAUSO STRENG wie STRIP_ROUND_OPEN_RE
// (kein ")"/Zeilenumbruch vor dem schließenden ">"). Ein derart
// verstümmeltes rundes Tag matcht OPEN_RE dadurch gar nicht mehr und bleibt
// unangetastet als Rohtext stehen (byte-identisch) - besser ein sichtbares
// Rohmarkup als stillschweigend verschluckter Dokumenttext. Alle Aufrufer
// lesen "open[1] ?? open[2]" (NULLISH statt "||": ein leeres, aber
// vorhandenes index-Attribut "index=\"\"" ist ein gültiger, nur
// unauflösbarer Treffer aus Gruppe 1 und darf nicht auf Gruppe 2
// durchfallen).
const OPEN_RE = /(?:<cite\s+index="([^"]*)"[^>]*>|\(cite\s+index="([^"]*)"[^>)\n]*>)/i;
// Re-Review v7.54 (🔵): auch der runde Schließer "(/cite>" (dieselbe
// Modellvarianz wie der runde Öffner) beendet ein Zitat – sonst landete die
// Fußnote erst am Satzende statt direkt hinter dem zitierten Text.
const CLOSE_RE = /<\/cite>|\(\/cite>/i;
// Nacharbeit Runde 4 (siehe Kopfkommentar, Finding B): stripCiteTags braucht
// eine EIGENE, für die runde Öffner-Variante genauso STRENGE Regel wie
// OPEN_RE (index="…" Pflicht, kein ")"/Zeilenumbruch vor dem schließenden
// ">") - der bisherige laxe Stopper "am nächsten >" beschädigte Prosa wie
// "(cite) als Kürzel. 3 > 2 gilt." oder "(cited in …)\n> Zitat". Die spitze
// Variante bleibt bewusst lax (`<\/?cite[^>]*>`): ein "<" gefolgt von "cite"
// kommt in normaler Prosa praktisch nie vor, anders als die runde Klammer.
// (Nacharbeit Runde 5: der Klammer-Halbsatz "genauso STRENGE Regel wie
// OPEN_RE" oben stimmte beim Schreiben NICHT - OPEN_RE selbst blieb für die
// runde Variante lax, siehe dessen Kommentar oben. Seit Runde 5 stimmt die
// Aussage tatsächlich, siehe DECISIONS #112.)
const STRIP_ROUND_OPEN_RE = /\(cite\s+index="[^"]*"[^>)\n]*>/gi;
const STRIP_RE = /<\/?cite[^>]*>|\(\/cite>/gi;

// Nacharbeit Runde 4 (🔵 Finding E): Grenze eines cite-Inhalts in "rest" (dem
// Text NACH einem Öffner-Tag) - entweder das eigene "</cite>" oder, falls
// VORHER bereits ein NEUER Öffner beginnt (zwei aufeinanderfolgende cites,
// von denen nur das ZWEITE ein "</cite>" trägt), der Beginn dieses nächsten
// Öffners. Bisher wurde "nextOpen" nur berechnet, wenn GAR KEIN "</cite>"
// gefunden wurde - lag ein "</cite>" zwar vor der Position des nächsten
// Öffners, gehörte es aber in Wahrheit zum ZWEITEN (schon geöffneten) Zitat,
// wurde es fälschlich dem ERSTEN zugeschlagen; das zweite Öffner-Tag blieb
// als Rohtext im Inhalt des ersten stecken, die zweite Quelle wurde nie
// aufgelöst. Fix: "nextOpen" wird IMMER berechnet, die Grenze ist die
// JEWEILS FRÜHERE der beiden Positionen.
function citeBoundary(rest) {
  const close = CLOSE_RE.exec(rest);
  const nextOpen = OPEN_RE.exec(rest);
  if (close && (!nextOpen || close.index <= nextOpen.index)) return { kind: "close", match: close };
  if (nextOpen) return { kind: "open", match: nextOpen };
  return { kind: "none", match: null };
}

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
    // C3-Nachlauf/Finding E: die Grenze ist entweder das eigene "</cite>"
    // oder - falls VORHER schon ein neuer Öffner beginnt - dessen Beginn
    // (siehe citeBoundary()-Kommentar oben).
    const b = citeBoundary(rest);
    const inner = b.kind === "none" ? rest : rest.slice(0, b.match.index);
    const remainder = b.kind === "close" ? rest.slice(b.match.index + b.match[0].length) : b.kind === "open" ? rest.slice(b.match.index) : "";
    nodes.push(stripCiteTags(inner));
    // Nacharbeit Runde 5 (🟡 N1): OPEN_RE trägt seit dem Fix ZWEI eigene
    // Capture-Gruppen (spitz/rund) statt einer gemeinsamen - "??" statt "||",
    // ein leeres index-Attribut ("index=\"\"") ist ein gültiger, wenn auch
    // unauflösbarer Treffer und darf nicht auf die andere Gruppe durchfallen.
    for (const src of resolveSources(open[1] ?? open[2], sources || [])) {
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
    s = remainder;
  }
  return { nodes, footnotes };
}

// cite-Tags restlos entfernen (für Kontexte ohne Fußnoten, z. B. die
// API-History oder unauflösbare Tags). Toleriert wie OPEN_RE die runde
// Klammer-Variante des Öffners (C3-Nachlauf) - der Schließer bleibt "</cite>"
// bzw. dessen Klammer-Variante, NIE ein bloßes ")".
export function stripCiteTags(s) {
  if (typeof s !== "string") return s;
  return s.replace(STRIP_ROUND_OPEN_RE, "").replace(STRIP_RE, "");
}

// cite-Tags in Dokument-Inhalten (ops) in Fußnoten-Links der Form
// [0](https://…) umwandeln – die Nummer ist ein Platzhalter, die
// dokumentweite Durchnummerierung übernimmt renumberCitations beim
// Schreiben. Unauflösbare Tags werden gestrippt (Text bleibt).
export function citeTagsToDocLinks(s, sources) {
  if (typeof s !== "string") return s;
  let out = "";
  let rest = s;
  while (rest.length) {
    const open = OPEN_RE.exec(rest);
    if (!open) { out += stripCiteTags(rest); break; }
    out += stripCiteTags(rest.slice(0, open.index));
    const after = rest.slice(open.index + open[0].length);
    // C3-Nachlauf/Finding E: Grenze wie in renderWithCites (siehe
    // citeBoundary()-Kommentar oben).
    const b = citeBoundary(after);
    const inner = b.kind === "none" ? after : after.slice(0, b.match.index);
    // Marker vor abschließendem Weißraum/Zeilenende der markierten Stelle
    const cut = inner.length - /\s*$/.exec(inner)[0].length;
    // Nacharbeit Runde 5 (🟡 N1): siehe Kommentar in renderWithCites oben.
    const links = resolveSources(open[1] ?? open[2], sources || [])
      .map((src) => "[0](" + src.url + ")")
      .join("");
    out += stripCiteTags(inner.slice(0, cut)) + links + inner.slice(cut);
    rest = b.kind === "close" ? after.slice(b.match.index + b.match[0].length) : b.kind === "open" ? after.slice(b.match.index) : "";
  }
  return out;
}
