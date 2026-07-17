/* ------------------------------------------------------------------ */
/* Link-Provider (v7.9, Nutzerwunsch: „Icons für DevOps/Confluence-Links */
/* + Titel-Ermittlung aus dem Ziel")                                    */
/*                                                                      */
/* BLATT im Abhängigkeitsbaum wie code.jsx: importiert NICHTS aus       */
/* markdown.jsx/math.jsx/DocEditor.jsx (Zirkelbezug-Regel, siehe        */
/* code.jsx-Kopfkommentar) – markdown.jsx UND DocEditor.jsx importieren */
/* umgekehrt AUS dieser Datei (Icons, Matching, Titel-Fetch). Die        */
/* Titel-Bereinigungsregel (cleanupLinkTitle) lag bisher als             */
/* validateLinkTitle NUR in DocEditor.jsx – jetzt hier EINMAL definiert  */
/* und von DocEditor.jsx re-exportiert/aufgerufen (siehe dort), damit    */
/* sowohl der Link-Dialog als auch ein automatisch ermittelter Titel     */
/* (fetchLinkTitle unten) exakt dieselbe Regel durchlaufen, ohne dass     */
/* linkProviders.jsx aus DocEditor.jsx importieren müsste.               */
/*                                                                      */
/* SICHERHEIT: PAT/E-Mail eines Providers leben ausschließlich im        */
/* localStorage-Settings-Objekt (App.jsx ruft setLinkProviders() beim    */
/* Settings-Load/-Save, NIE beim Schreiben von state.json). Ein          */
/* Titel-Fetch (fetchLinkTitle) läuft NUR auf explizite Nutzeraktion im   */
/* Link-Popover (DocEditor.jsx, Knopf „Titel ermitteln") – NIE beim       */
/* Rendern/Anzeigen: Icons kommen ausschließlich aus providerFor(), einer */
/* reinen String-Prüfung auf das URL-Präfix, ohne jeden Netzzugriff.      */
/* ------------------------------------------------------------------ */

const PROVIDER_TYPES = new Set(["azure-devops", "confluence", "custom"]);
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
const looksLikeHttpPrefix = (v) => isNonEmptyString(v) && /^https?:\/\//i.test(v);

/* ---------------- Titel-Bereinigung (geteilt mit DocEditor.jsx) ---------------- */

// (a) reine Ziffern sind für Quellen-Fußnoten reserviert (renumberCitations,
// markdown.jsx, CITE_LINK_RE würde einen solchen Titel beim nächsten
// Speichern dokumentweit durch eine fortlaufende Nummer ersetzen).
// (b) "[" / "]" werden STILL durch "(" / ")" ersetzt (prosemirror-markdown
// escaped sie beim Serialisieren, unescapeMd macht das Escape beim
// Speichern bedingungslos rückgängig – ein roher "]" im Titel würde sonst
// den Viewer-Link-Regex mitten im Titel beenden). Ein von fetchLinkTitle
// automatisch ermittelter Titel (z. B. ein Azure-DevOps-Titel mit "[")
// läuft durch GENAU dieselbe Regel wie ein manuell eingegebener.
export function cleanupLinkTitle(raw) {
  const title = String(raw ?? "").trim();
  if (!title) return { error: "Bitte einen Titel angeben." };
  if (/^\d+$/.test(title)) {
    return {
      error: "Reine Zahlen sind für Quellen-Fußnoten reserviert – bitte einen sprechenden Titel wählen.",
    };
  }
  return { title: title.replace(/\[/g, "(").replace(/\]/g, ")") };
}

/* ---------------- Eingebaute Standard-Provider ---------------- */
// Immer aktiv, ohne jede Konfiguration – NUR Icon, KEIN Fetch (kein PAT
// hinterlegt). Azure DevOps ist zentral gehostet (ein fester Präfix reicht);
// Confluence Cloud liegt dagegen unter einer pro Kunde unterschiedlichen
// Subdomain (<team>.atlassian.net) – dafür ein Host-MUSTER statt eines
// festen Präfixes (siehe hostMatchesGlob unten).
export const BUILTIN_AZURE_DEVOPS = {
  id: "builtin-azure-devops",
  type: "azure-devops",
  name: "Azure DevOps",
  prefix: "https://dev.azure.com/",
  builtin: true,
};
export const BUILTIN_CONFLUENCE = {
  id: "builtin-confluence",
  type: "confluence",
  name: "Confluence",
  hostPattern: "*.atlassian.net",
  builtin: true,
};
const BUILTIN_PROVIDERS = [BUILTIN_AZURE_DEVOPS, BUILTIN_CONFLUENCE];

// Vorbelegung für das Provider-Formular im Einstellungen-Dialog
// (SettingsDialog.jsx) – je Typ ein sinnvoller Default für Name/Präfix.
//
// SICHERHEITS-FIX (Review-Finding 3, 🟡): Confluence hatte hier bisher das
// generische "https://" als Default – ein Präfix OHNE Host, das (vor den
// Fixes zu Finding 1/2) JEDE */wiki/spaces/*/pages/*-URL matchte und damit
// das Confluence-PAT/die E-Mail an jeden beliebigen Host geschickt hätte
// (Finding S2). Confluence hat (anders als Azure DevOps) keinen sinnvollen
// festen Default-Host (jeder Kunde hat seine eigene *.atlassian.net-
// Subdomain) – bewusst LEER vorbelegt, statt eines Platzhalters, der
// providerFormValid (SettingsDialog.jsx) ohnehin als ungültig ablehnt
// (hasRealHostPrefix, siehe sanitizeLinkProviders unten): der Nutzer MUSS
// aktiv den eigenen Tenant-Host eintragen.
export const PROVIDER_TYPE_INFO = {
  "azure-devops": { label: "Azure DevOps", defaultName: "Azure DevOps", defaultPrefix: "https://dev.azure.com/" },
  confluence: { label: "Confluence", defaultName: "Confluence", defaultPrefix: "" },
  custom: { label: "Eigener Anbieter", defaultName: "", defaultPrefix: "https://" },
};

/* ---------------- Matching (providerFor) ---------------- */

// Exportiert (Review-Fix, Finding 1): SettingsDialog.jsx braucht dieselbe
// Host-Extraktion für die Formularvalidierung (providerFormValid) – ein
// Präfix ohne echten Host darf nicht mal bis zum Speichern kommen, siehe
// dort UND sanitizeLinkProviders unten (dort ist es der eigentliche
// Sicherheits-Gatekeeper, hier nur die UX-Vorprüfung).
export function hostOf(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase();
  } catch (e) {
    return null;
  }
}

// glob ist bislang immer "*.<domain>" (ein führendes "*.", danach die
// Domain) – EIN Label reicht, mehrstufige Subdomains (a.b.atlassian.net)
// zählen ebenfalls. Ein bloßes "atlassian.net" OHNE Team-Subdomain gilt
// bewusst NICHT als Treffer: Confluence Cloud braucht immer einen
// Space-/Team-Namen davor, ein Treffer auf die nackte Domain wäre also
// ohnehin nie eine echte Confluence-Instanz.
function hostMatchesGlob(host, glob) {
  if (!host || typeof glob !== "string" || !glob.startsWith("*.")) return false;
  const suffix = glob.slice(1); // ".atlassian.net"
  return host.length > suffix.length && host.endsWith(suffix);
}

// Länge des Treffers für den "längster Match gewinnt"-Vergleich INNERHALB
// einer Kategorie (konfiguriert bzw. eingebaut, siehe providerFor). Für
// Präfix-Provider schlicht die Präfixlänge (Groß/Klein-unabhängig – eine
// URL-Autorität ist ohnehin case-insensitiv, und eine strengere Prüfung
// hätte hier keinen Sicherheitswert, nur Nutzer-Überraschungen); für das
// Host-Muster die Länge des Musters selbst (praktisch nie relevant, da es
// aktuell nur einen einzigen Host-Muster-Provider gibt).
//
// SICHERHEITS-FIX (Review-Finding 2, 🟡, schließt zugleich einen Teil des
// 🔴 Finding 1 an der Matching-Wurzel): ein reines startsWith() auf den
// Präfix ist KEINE URL-Grenze – ein Präfix "https://acme.atlassian.net"
// (ohne abschließenden "/") matchte bisher auch
// "https://acme.atlassian.net.evil.example/…" (Suffix-Angriff: derselbe
// String ist Präfix TROTZ anderer Autorität) oder
// "https://acme.atlassian.netx.example/…". Ein Präfix darf daher nur an
// einer SAUBEREN Grenze enden: entweder der Präfix selbst endet auf "/",
// oder das Zeichen der URL UNMITTELBAR nach dem Präfix ist "/", "?", "#"
// oder das Stringende (die URL ist exakt der Präfix, ohne Rest).
function matchLength(url, provider) {
  const u = String(url || "");
  if (isNonEmptyString(provider.prefix)) {
    const prefix = provider.prefix;
    if (!u.toLowerCase().startsWith(prefix.toLowerCase())) return -1;
    if (prefix.endsWith("/")) return prefix.length;
    const boundary = u[prefix.length];
    return boundary === undefined || boundary === "/" || boundary === "?" || boundary === "#"
      ? prefix.length
      : -1;
  }
  if (isNonEmptyString(provider.hostPattern)) {
    return hostMatchesGlob(hostOf(u), provider.hostPattern) ? provider.hostPattern.length : -1;
  }
  return -1;
}

// providerFor(url, configured) – reine Funktion, KEIN Zugriff auf die
// Registry (die Aufrufer in markdown.jsx/DocEditor.jsx lesen configured
// selbst über getLinkProviders(), siehe unten): einfacher zu testen, und
// der Aufrufer entscheidet explizit, welchen Provider-Stand er sieht.
//
// Regel bei Überschneidung (Auftrag): konfigurierte Provider gewinnen IMMER
// gegen eingebaute – unabhängig von der Präfixlänge (der Hauptfall dafür
// ist eine Nutzer-Konfiguration MIT DEMSELBEN Präfix wie ein eingebauter
// Provider, nur um ein PAT zu hinterlegen; ohne diese Priorität würde der
// eingebaute Provider – ohne PAT – weiterhin gewinnen und die Titel-
// Ermittlung bliebe unerreichbar). Innerhalb einer Kategorie (konfiguriert
// bzw. eingebaut) gewinnt der LÄNGSTE Präfix (spezifischere Konfiguration
// vor allgemeinerer).
export function providerFor(url, configured) {
  const u = String(url || "");
  if (!/^https?:\/\//i.test(u)) return null;
  const cfgList = Array.isArray(configured) ? configured : [];
  const pickBest = (list) => {
    let best = null;
    let bestLen = -1;
    for (const p of list) {
      const len = matchLength(u, p);
      if (len > bestLen) {
        bestLen = len;
        best = p;
      }
    }
    return best;
  };
  return pickBest(cfgList) || pickBest(BUILTIN_PROVIDERS);
}

/* ---------------- Zugangsdaten-Prüfung ---------------- */

// Nur konfigurierte Provider können ein PAT tragen (eingebaute nie – siehe
// BUILTIN_PROVIDERS oben). custom-Provider haben kein bekanntes REST-API
// und unterstützen deshalb generell keine Titel-Ermittlung.
export function providerHasCredentials(provider) {
  if (!provider) return false;
  if (provider.type === "azure-devops") return isNonEmptyString(provider.pat);
  if (provider.type === "confluence") return isNonEmptyString(provider.pat) && isNonEmptyString(provider.email);
  return false;
}

/* ---------------- Modul-Registry ---------------- */
// App.jsx ruft setLinkProviders() beim Settings-Load UND -Save auf (siehe
// dort); markdown.jsx (Viewer) und DocEditor.jsx (Editor-Decorations,
// Link-Popover) lesen den aktuellen Stand über getLinkProviders(), OHNE ein
// neues Prop quer durch beide Komponentenbäume zu ziehen (DocView/DocEditor
// werden an mehreren Stellen in App.jsx eingebunden). sanitizeLinkProviders
// läuft hier zusätzlich zur Prüfung in settings.js (Defense-in-Depth: ein
// direkt aus dem SettingsDialog kommendes Array ist zwar bereits sauber
// gebaut, aber ein zweiter, günstiger Filter direkt vor dem Registry-Write
// schützt auch vor künftigen Aufrufstellen, die diese Prüfung vergessen).
let _providers = [];

// Präfix-Grundprüfung + SICHERHEITS-FIX (Review-Finding 3, 🟡 – die
// eigentliche Durchsetzungsstelle, providerFormValid im SettingsDialog ist
// nur die UX-Vorprüfung derselben Regel): ein Präfix OHNE echten Host (z. B.
// der frühere Confluence-Formular-Default "https://" allein) matcht über
// matchLength() via dessen "endet auf /"-Kurzschluss JEDE http(s)-URL – ein
// so konfigurierter Provider hätte PAT/E-Mail an JEDEN beliebigen Host
// geschickt (Finding S2, siehe DECISIONS #56). Ein Präfix muss daher zu
// new URL(prefix) parsen UND einen Host mit mindestens einem Punkt liefern
// (schließt "https://localhost/" u. Ä. aus – für dieses Feature irrelevant,
// echte DevOps-/Confluence-/Firmen-Hosts haben immer eine Domain).
function hasRealHostPrefix(rawPrefix) {
  if (!looksLikeHttpPrefix(rawPrefix)) return false;
  const host = hostOf(rawPrefix);
  return !!host && host.includes(".");
}

export function sanitizeLinkProviders(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(
      (p) =>
        p &&
        typeof p === "object" &&
        isNonEmptyString(p.id) &&
        PROVIDER_TYPES.has(p.type) &&
        isNonEmptyString(p.name) &&
        // Trimmen VOR der Schema-/Host-Prüfung (nicht danach, wie
        // ursprünglich): ein Präfix mit führendem/nachgestelltem Whitespace
        // (z. B. aus Copy-Paste im Einstellungen-Dialog) ist nach dem
        // Trimmen gültig und darf nicht an der rohen, noch untrimmten Form
        // scheitern.
        isNonEmptyString(p.prefix) &&
        hasRealHostPrefix(p.prefix.trim())
    )
    .map((p) => ({
      id: p.id,
      type: p.type,
      name: p.name.trim(),
      prefix: p.prefix.trim(),
      icon: typeof p.icon === "string" ? p.icon : "",
      pat: typeof p.pat === "string" ? p.pat : "",
      email: typeof p.email === "string" ? p.email : "",
    }));
}

export function setLinkProviders(list) {
  _providers = sanitizeLinkProviders(list);
}

export function getLinkProviders() {
  return _providers;
}

/* ---------------- Azure-DevOps-Work-Item-URL parsen ---------------- */

// https://dev.azure.com/{org}/{project}/_workitems/edit/{id}[/?#…]
// Org/Projekt können URL-encodet sein (Leerzeichen etc.); ein Query-/Hash-
// Anhängsel ODER ein einzelner Trailing-Slash nach der ID werden toleriert,
// weitere Pfadsegmente NICHT (dann ist es kein Work-Item-Link mehr im hier
// unterstützten Sinn).
const WORK_ITEM_URL_RE =
  /^https?:\/\/dev\.azure\.com\/([^/?#]+)\/([^/?#]+)\/_workitems\/edit\/(\d+)\/?(?:[?#].*)?$/i;

export function parseWorkItemUrl(url) {
  const m = WORK_ITEM_URL_RE.exec(String(url || ""));
  if (!m) return null;
  try {
    return { org: decodeURIComponent(m[1]), project: decodeURIComponent(m[2]), id: m[3] };
  } catch (e) {
    return null; // kaputte Prozent-Kodierung
  }
}

// https://{host}/wiki/spaces/{space}/pages/{id}[/…]
const CONFLUENCE_PAGE_URL_RE = /^https?:\/\/([^/?#]+)\/wiki\/spaces\/[^/?#]+\/pages\/(\d+)(?:[/?#].*)?$/i;

/* ---------------- Titel-Fetch (nur auf Nutzeraktion, siehe Kopfkommentar) ---------------- */

const DEFAULT_TIMEOUT_MS = 6000;

// btoa reicht für den realistischen Zeichensatz eines PAT/E-Mail-Werts
// (ASCII) – ein vollwertiges UTF-8-Base64 wäre hier Overkill und keine der
// beiden APIs (Azure DevOps/Confluence) verlangt es für Basic-Auth-Header.
function basicAuthHeader(user, secret) {
  const raw = String(user) + ":" + String(secret);
  if (typeof btoa === "function") return "Basic " + btoa(raw);
  // Node-Testumgebung ohne btoa (jsdom/Browser haben es immer).
  return "Basic " + Buffer.from(raw, "binary").toString("base64");
}

// Führt fetchImpl mit einem AbortController-Timeout aus; wirft NIE –
// Netzwerk-/CORS-Fehler (Browser liefert dafür ein TypeError ohne weitere
// Details) und ein Timeout (AbortError) werden hier bereits zu derselben
// Ergebnisform normalisiert wie alle anderen Fehlerfälle.
async function timedFetch(fetchImpl, url, init, timeoutMs) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, { ...init, signal: controller ? controller.signal : undefined });
    return { res };
  } catch (e) {
    if (e && e.name === "AbortError") {
      return { errorReason: "Zeitüberschreitung beim Titel-Abruf (" + Math.round(timeoutMs / 1000) + " s)." };
    }
    // TypeError = der übliche Fetch-Fehlerfall bei Netzwerk-/CORS-Problemen
    // im Browser (kein Statuscode, keine Details) – Atlassian Cloud
    // blockiert Browser-CORS für die Content-API häufig, das ist eine
    // dokumentierte Grenze (siehe DECISIONS.md); das Icon funktioniert
    // trotzdem weiter, nur die automatische Titel-Ermittlung scheitert.
    return { errorReason: "Netzwerk/CORS-Fehler – Titel konnte nicht automatisch ermittelt werden." };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// fetchLinkTitle(url, provider, { fetchImpl, timeoutMs }) → { ok:true, title }
// oder { ok:false, reason } – wirft NIE. fetchImpl ist injizierbar (Tests
// mocken damit die HTTP-Antwort statt echt zu fetchen); ohne fetchImpl wird
// das globale fetch verwendet (Browser).
export async function fetchLinkTitle(url, provider, opts = {}) {
  const fetchImpl = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  if (!fetchImpl) return { ok: false, reason: "Kein Netzzugriff verfügbar." };
  if (!providerHasCredentials(provider)) {
    return { ok: false, reason: "Kein Provider mit Zugangsdaten für diese URL." };
  }

  if (provider.type === "azure-devops") {
    const wi = parseWorkItemUrl(url);
    if (!wi) return { ok: false, reason: "Die URL passt nicht zum Azure-DevOps-Work-Item-Muster." };
    const api =
      "https://dev.azure.com/" +
      encodeURIComponent(wi.org) +
      "/" +
      encodeURIComponent(wi.project) +
      "/_apis/wit/workitems/" +
      wi.id +
      "?fields=System.Title,System.WorkItemType&api-version=7.1";
    const { res, errorReason } = await timedFetch(
      fetchImpl,
      api,
      { headers: { Authorization: basicAuthHeader("", provider.pat) } },
      timeoutMs
    );
    if (errorReason) return { ok: false, reason: errorReason };
    if (!res.ok) return { ok: false, reason: "Azure DevOps antwortete mit Status " + res.status + "." };
    let data;
    try {
      data = await res.json();
    } catch (e) {
      return { ok: false, reason: "Antwort von Azure DevOps konnte nicht gelesen werden." };
    }
    const fields = (data && data.fields) || {};
    const type = fields["System.WorkItemType"] || "Work Item";
    const rawTitle = fields["System.Title"] || "";
    const cleaned = cleanupLinkTitle(type + " " + wi.id + ": " + rawTitle);
    return cleaned.error ? { ok: false, reason: cleaned.error } : { ok: true, title: cleaned.title };
  }

  if (provider.type === "confluence") {
    const cm = CONFLUENCE_PAGE_URL_RE.exec(String(url || ""));
    if (!cm) return { ok: false, reason: "Die URL passt nicht zum Confluence-Seiten-Muster." };
    // SICHERHEITS-FIX (Review-Finding 1, 🔴, primäre Absicherung): die
    // API-URL/Credentials dürfen NUR an den Host gehen, der im
    // KONFIGURIERTEN Provider-Präfix steckt – NIEMALS an den Host der
    // eingegebenen Link-URL (cm[1]). Ohne diese Verankerung hätte z. B.
    // "https://acme.atlassian.net.evil.example/wiki/spaces/X/pages/1" (oder
    // generell jede beliebige */wiki/spaces/*/pages/*-URL) das Confluence-
    // PAT/die E-Mail an einen fremden Host geschickt – matchLength() oben
    // ist zwar seit Finding 2 selbst gehärtet, aber diese Prüfung hier ist
    // die eigentliche Instanz, die Zugangsdaten tatsächlich verschickt und
    // darf sich nicht ausschließlich auf die (regex-basierte) Vorauswahl
    // durch providerFor() verlassen (Defense-in-Depth). hostOf() liefert
    // null bei einem kaputten/hostlosen Präfix (z. B. "https://" allein,
    // Finding S2 – sanitizeLinkProviders verhindert das inzwischen zwar
    // schon beim Speichern, aber ein direkt konstruiertes Provider-Objekt
    // – z. B. in Tests – darf sich nicht darauf verlassen).
    const host = cm[1].toLowerCase();
    const prefixHost = hostOf(provider.prefix);
    if (!prefixHost || host !== prefixHost) {
      return { ok: false, reason: "URL-Host passt nicht zum konfigurierten Provider." };
    }
    const api = "https://" + host + "/wiki/rest/api/content/" + cm[2];
    const { res, errorReason } = await timedFetch(
      fetchImpl,
      api,
      { headers: { Authorization: basicAuthHeader(provider.email, provider.pat) } },
      timeoutMs
    );
    if (errorReason) return { ok: false, reason: errorReason };
    if (!res.ok) return { ok: false, reason: "Confluence antwortete mit Status " + res.status + "." };
    let data;
    try {
      data = await res.json();
    } catch (e) {
      return { ok: false, reason: "Antwort von Confluence konnte nicht gelesen werden." };
    }
    const cleaned = cleanupLinkTitle((data && data.title) || "");
    return cleaned.error ? { ok: false, reason: cleaned.error } : { ok: true, title: cleaned.title };
  }

  return { ok: false, reason: "Kein Provider mit Zugangsdaten für diese URL." };
}

/* ---------------- Icons ---------------- */
// Bewusst vereinfachte, NICHT pixelgenaue Annäherungen (ein exakter
// Marken-Logo-Nachbau aus Handarbeits-Pfaden wäre fragil und nicht Ziel
// dieses Features) – Farbe + abstrakte Form dienen nur als
// Wiedererkennungs-Hinweis direkt vor dem Link. Die Form-Daten stecken in
// EINER Konstante je Provider und werden von ZWEI Renderern konsumiert:
// den React-Komponenten unten (Viewer, markdown.jsx) UND
// buildProviderIconDom (rohes DOM-Element für die ProseMirror-Decoration
// in DocEditor.jsx, die kein React rendern kann) – so bleibt die Optik an
// genau einer Stelle definiert.
const AZURE_DEVOPS_COLOR = "#0078D4";
const AZURE_DEVOPS_SHAPES = [
  { tag: "polygon", points: "2,4 10,12 2,20" },
  { tag: "polygon", points: "22,4 14,12 22,20" },
];
const CONFLUENCE_COLOR = "#2684FF";
const CONFLUENCE_SHAPES = [
  { tag: "circle", cx: 9, cy: 12, r: 7, opacity: 0.55 },
  { tag: "circle", cx: 15, cy: 12, r: 7 },
];

function IconSvg({ shapes, color, className }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      aria-hidden="true"
      focusable="false"
      fill={color}
      className={className}
    >
      {shapes.map((s, i) =>
        s.tag === "polygon" ? (
          <polygon key={i} points={s.points} opacity={s.opacity} />
        ) : (
          <circle key={i} cx={s.cx} cy={s.cy} r={s.r} opacity={s.opacity} />
        )
      )}
    </svg>
  );
}

export function AzureDevOpsIcon({ className }) {
  return <IconSvg shapes={AZURE_DEVOPS_SHAPES} color={AZURE_DEVOPS_COLOR} className={className} />;
}

export function ConfluenceIcon({ className }) {
  return <IconSvg shapes={CONFLUENCE_SHAPES} color={CONFLUENCE_COLOR} className={className} />;
}

// Generischer Icon-Renderer für EINEN Provider (Viewer + Einstellungen-
// Dialog): bekannter Typ → eingebautes SVG, sonst (custom) das vom Nutzer
// hinterlegte Emoji (Fallback 🔗, falls leer).
export function ProviderIcon({ provider, className }) {
  if (!provider) return null;
  if (provider.type === "azure-devops") return <AzureDevOpsIcon className={className} />;
  if (provider.type === "confluence") return <ConfluenceIcon className={className} />;
  return (
    <span className={className} aria-hidden="true">
      {provider.icon || "🔗"}
    </span>
  );
}

const SVG_NS = "http://www.w3.org/2000/svg";
function buildIconSvgDom(shapes, color) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "13");
  svg.setAttribute("height", "13");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("fill", color);
  for (const s of shapes) {
    const el = document.createElementNS(SVG_NS, s.tag);
    for (const [k, v] of Object.entries(s)) {
      if (k === "tag" || v === undefined) continue;
      el.setAttribute(k, String(v));
    }
    svg.appendChild(el);
  }
  return svg;
}

// Rohes DOM-Element (KEIN React) für die ProseMirror-Widget-Decoration im
// Editor (DocEditor.jsx, LinkDecorations-Plugin) – ProseMirror-Decorations
// verlangen ein echtes DOM-Element, kein JSX. contenteditable=false zusätzlich
// zur ohnehin nicht-editierbaren Natur von Widget-Decorations (Belt-and-
// Suspenders gegen Cursor-Artefakte in älteren Browsern).
export function buildProviderIconDom(provider) {
  if (!provider) return null;
  let el;
  if (provider.type === "azure-devops") el = buildIconSvgDom(AZURE_DEVOPS_SHAPES, AZURE_DEVOPS_COLOR);
  else if (provider.type === "confluence") el = buildIconSvgDom(CONFLUENCE_SHAPES, CONFLUENCE_COLOR);
  else {
    el = document.createElement("span");
    el.setAttribute("aria-hidden", "true");
    el.textContent = provider.icon || "🔗";
  }
  const wrap = document.createElement("span");
  wrap.className = "provider-link-icon";
  wrap.contentEditable = "false";
  wrap.setAttribute("aria-hidden", "true");
  wrap.appendChild(el);
  return wrap;
}
