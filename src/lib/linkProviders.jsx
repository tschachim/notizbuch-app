/* ------------------------------------------------------------------ */
/* Link-Provider (v7.9, Nutzerwunsch: „Icons für DevOps/Confluence-Links */
/* + Titel-Ermittlung aus dem Ziel"; v7.12: automatische Titel-           */
/* Ermittlung "egal wo sie herkommt" – siehe resolveProviderLinkTitles    */
/* unten und DECISIONS #58)                                             */
/*                                                                      */
/* BLATT im Abhängigkeitsbaum wie code.jsx: importiert NICHTS aus       */
/* markdown.jsx/math.jsx/DocEditor.jsx (Zirkelbezug-Regel, siehe        */
/* code.jsx-Kopfkommentar) – markdown.jsx UND DocEditor.jsx importieren */
/* umgekehrt AUS dieser Datei (Icons, Matching, Titel-Fetch). code.jsx   */
/* selbst ist ebenfalls ein Blatt (importiert nichts von hier) und darf  */
/* deshalb GEFAHRLOS importiert werden (splitFenceSegments unten, für    */
/* resolveProviderLinkTitles). Die Titel-Bereinigungsregel                */
/* (cleanupLinkTitle) lag bisher als validateLinkTitle NUR in            */
/* DocEditor.jsx – jetzt hier EINMAL definiert und von DocEditor.jsx     */
/* re-exportiert/aufgerufen (siehe dort), damit sowohl der Link-Dialog    */
/* als auch ein automatisch ermittelter Titel (fetchLinkTitle unten)     */
/* exakt dieselbe Regel durchlaufen, ohne dass linkProviders.jsx aus      */
/* DocEditor.jsx importieren müsste.                                    */
/*                                                                      */
/* SICHERHEIT: PAT/E-Mail eines Providers leben ausschließlich im        */
/* localStorage-Settings-Objekt (App.jsx ruft setLinkProviders() beim    */
/* Settings-Load/-Save, NIE beim Schreiben von state.json). Ein          */
/* Titel-Fetch (fetchLinkTitle) lief bis v7.9 NUR auf explizite           */
/* Nutzeraktion im Link-Popover (Knopf „Titel ermitteln"). v7.12 löst     */
/* das ab: Fetch jetzt zusätzlich automatisch beim Eintippen/Einfügen     */
/* einer URL (debounced, DocEditor.jsx) UND beim Speichern/bei Chat-Ops   */
/* (resolveProviderLinkTitles, App.jsx – siehe dort und DECISIONS #58)    */
/* – aber IMMER NUR, wenn ein KONFIGURIERTER Provider MIT Zugangsdaten    */
/* die URL abdeckt, und NIE beim bloßen Rendern/Anzeigen: Icons kommen    */
/* weiterhin ausschließlich aus providerFor(), einer reinen String-       */
/* Prüfung auf das URL-Präfix, ohne jeden Netzzugriff.                    */
/* ------------------------------------------------------------------ */

import { splitFenceSegments } from "./code.jsx";

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

// DevOps-302-Maskierung (Auftrag v7.12 Teil A, empirisch gegen dev.azure.com
// verifiziert, siehe DECISIONS #58): OHNE gültige Auth antwortet die Azure-
// DevOps-REST-API NICHT mit 401, sondern mit einem 302-Redirect zur
// Login-Seite (spsprodweu3.vssps.visualstudio.com). Diese Login-Seite trägt
// KEINE CORS-Header – der Browser-fetch scheitert daran mit einem
// nichtssagenden TypeError, das timedFetch (s.o.) bislang unterschiedslos
// zu "Netzwerk/CORS-Fehler …" normalisiert hat. Ergebnis: JEDER Auth-Fehler
// (ungültiges/abgelaufenes PAT, falsche Organisation, fehlender Scope) sah
// für den Nutzer wie ein Netzwerkproblem aus, nie wie ein Auth-Problem.
// Der Header unten (vom CORS-Preflight nachweislich erlaubt) lässt die API
// bei fehlender/ungültiger Auth stattdessen sauber mit 401 als JSON
// antworten; redirect:"manual" ist Gürtel+Hosenträger, falls der Header
// dennoch ignoriert wird: der Browser liefert dann statt eines TypeErrors
// eine Response mit type:"opaqueredirect" (status 0), die unten EBENFALLS
// als Auth-Fehler erkannt wird statt als generischer Netzwerkfehler.
const AZURE_SUPPRESS_REDIRECT_HEADERS = { "X-TFS-FedAuthRedirect": "Suppress" };

// Klare, deutsche Fehlertexte je Statuscode (Auftrag v7.12 Teil A) – bewusst
// OHNE jeden Bezug zum PAT-Wert/Authorization-Header (reason landet direkt
// im UI, siehe DocEditor.jsx). org/id kommen aus parseWorkItemUrl, nicht aus
// der Antwort (die liefert bei einem Auth-Fehler ohnehin keine Nutzdaten).
function azureDevOpsErrorReason(status, wi) {
  if (status === 401) {
    return "PAT ungültig oder abgelaufen, oder PAT gehört nicht zur Organisation ‚" + wi.org + "‘.";
  }
  if (status === 403) {
    return "PAT-Berechtigung fehlt (Scope ‚Work Items: Read‘) oder Organisations-Richtlinie blockiert PAT-Zugriff.";
  }
  if (status === 404) {
    return "Work Item " + wi.id + " nicht gefunden.";
  }
  return "Azure DevOps antwortete mit Status " + status + ".";
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
      {
        headers: { Authorization: basicAuthHeader("", provider.pat), ...AZURE_SUPPRESS_REDIRECT_HEADERS },
        redirect: "manual",
      },
      timeoutMs
    );
    if (errorReason) return { ok: false, reason: errorReason };
    // opaqueredirect: der Suppress-Header wurde ignoriert/griff nicht, der
    // Browser wollte dem 302 zur Login-Seite folgen – mit redirect:"manual"
    // bricht er das VOR dem CORS-losen Ziel ab, statt dort zu scheitern.
    // Praktisch nur bei einem Auth-Fehler möglich (siehe Kopfkommentar oben).
    if (res.type === "opaqueredirect") return { ok: false, reason: azureDevOpsErrorReason(401, wi) };
    if (!res.ok) return { ok: false, reason: azureDevOpsErrorReason(res.status, wi) };
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

/* ---------------- Automatische Titel-Ermittlung (v7.12, DECISIONS #58) ---------------- */
// resolveProviderLinkTitles(md, opts): scannt EIN Dokument/Fragment nach
// unaufgelösten Provider-Links und ersetzt sie, wenn möglich, durch
// "[<ermittelter Titel>](url)" – aufgerufen aus DocEditor.jsx (Auto-Fetch
// beim Tippen, siehe dort) UND App.jsx (vor commitDocNb im Editor-
// Speicherpfad, vor der ops-Anwendung im Chat-Pfad). Ersetzt "Fetch nur auf
// Klick" (v7.9, siehe DECISIONS #56) NICHT – der manuelle Knopf im
// Link-Popover bleibt als Retry –, ergänzt es aber um automatische
// Auslöser. Wirft NIE (wie fetchLinkTitle, auf dem es aufbaut).

// URL-Grammatiken dupliziert aus markdown.jsx (LINK_URL_RE bzw.
// INLINE_TOKEN_RE; linkProviders.jsx ist laut Kopfkommentar ein BLATT, aus
// dem markdown.jsx umgekehrt importiert – ein Reimport wäre ein
// Zirkelbezug, die Duplikation hier ist die Kehrseite davon). ZWEI
// unterschiedliche Grammatiken, exakt wie im Viewer:
// - BRACKETED_URL_SRC (= LINK_URL_RE): für "[Titel](url)"/Bild-Ziele – EINE
//   Ebene balancierter runder Klammern, sonst weder Klammern noch Whitespace.
// - NAKED_URL_SRC (= INLINE_TOKEN_RE's letzte Alternative, dort als
//   BARE_URL_INLINE_SRC exportiert): für eine nackte URL im Fließtext –
//   bewusst LOOSER (jedes Nicht-Whitespace/Nicht-"<>"-Zeichen, AUCH
//   unbalancierte Klammern), weil der Viewer genau diese Grammatik für
//   "nackte URL" verwendet und die Grenze erst NACHTRÄGLICH über
//   trimBareUrl (unten) zieht – z. B. lässt ein Wikipedia-Link in
//   Prosa-Klammern ("(siehe https://…/Steak_(Fleisch))") sich nur mit
//   dieser Reihenfolge (erst großzügig matchen, dann trimmen) korrekt von
//   der umschließenden Prosa-Klammer trennen.
//
// REVIEW-FIX (🟡 Grammatik-Drift, vor dem Commit gemeldet): beide
// Konstanten sind jetzt EXPORTIERT, damit ein Test
// (tests/resolveProviderLinkTitles.test.jsx) BEIDE Module direkt
// importieren und `LINK_URL_RE.source === BRACKETED_URL_SRC` sowie
// `BARE_URL_INLINE_SRC === NAKED_URL_SRC` pinnen kann (ein Testfile darf
// zwei Blätter importieren, ohne selbst Teil eines Laufzeit-Zirkels zu
// werden – nur linkProviders.jsx→markdown.jsx bzw. umgekehrt wäre einer).
// trimBareUrl wurde dagegen NICHT dupliziert gehalten, sondern nach hier
// verschoben und exportiert (siehe unten) – markdown.jsx importiert es von
// hier, GENAU wie es bereits providerFor/getLinkProviders von hier
// importiert (zirkelfrei, da linkProviders.jsx nichts aus markdown.jsx
// importiert). Eine EINZIGE Quelle statt eines Pin-Tests, wo es möglich war.
export const BRACKETED_URL_SRC = "https?:\\/\\/(?:[^\\s()]|\\([^\\s()]*\\))+";
export const NAKED_URL_SRC = "https?:\\/\\/[^\\s<>]+";

// Erkennt in EINEM Durchlauf alle relevanten Konstrukte, damit die jeweils
// FRÜHESTE Fundstelle gewinnt und eine bereits konsumierte URL (z. B. die
// eines "[Titel](url)") nicht anschließend nochmal als "nackte URL"
// auftaucht – gleiches Grundmuster wie INLINE_TOKEN_RE in markdown.jsx.
// Reihenfolge/Gruppen: (1) Bild "![...](...)" – IMMER überspringen, auch
// mit http(s)-Ziel (Auftrag: "NIE anfassen"); (2)+(3) "[Titel](url)" – der
// Aufrufer prüft anschließend Titel===URL (Fußnoten/echte Titel bleiben
// sonst unangetastet); (4) "<url>"-Autolink; (5) nackte URL.
const PROVIDER_LINK_SCAN_RE = new RegExp(
  "(!\\[[^\\]\\n]*\\]\\(" + BRACKETED_URL_SRC + "\\))" +
  "|\\[([^\\]\\n]{1,300})\\]\\((" + BRACKETED_URL_SRC + ")\\)" +
  "|<(https?:\\/\\/[^\\s>]+)>" +
  "|(" + NAKED_URL_SRC + ")",
  "g"
);

// Codespan-Grenze wie renumberCitations (markdown.jsx): Inhalt zwischen
// Backticks bleibt literal, wird nie auf Provider-Links durchsucht.
const CODESPAN_SPLIT_RE = /(`[^`\n]+`)/;

// GEMEINSAME Quelle für die Grenzziehung einer nackten URL (Review-Fix
// "Grammatik-Drift", vor dem Commit gemeldet – siehe Kommentar bei
// BRACKETED_URL_SRC/NAKED_URL_SRC oben): lag bis v7.12 als reines Duplikat
// in markdown.jsx (dort seit v7.8, GFM-ähnliches Trailing-Trimming), jetzt
// EINMAL hier definiert und exportiert – markdown.jsx importiert diese
// Funktion von hier (zirkelfrei, linkProviders.jsx importiert nichts aus
// markdown.jsx), statt eine zweite, per Hand synchron zu haltende Kopie zu
// pflegen.
//
// Verhalten: abschließende Satzzeichen gehören fast immer zum umgebenden
// Satz, nicht zur URL ("Siehe https://x.de/a." soll den Punkt NICHT
// mitverlinken; genauso ".../edit/123." beim Auto-Titel-Fetch unten). Eine
// schließende ")" ist die Ausnahme: Sie bleibt Teil der URL, wenn sie eine
// im bereits akzeptierten Teil der URL offene "(" schließt (Wikipedia-
// Artikel mit Klammer im Titel, z. B. .../wiki/Steak_(Fleisch)) – sonst
// wird auch sie abgetrennt (z. B. eine URL in Klammern im Fließtext:
// "(https://x.de/a)" soll die Satzklammer nicht mitverlinken). Der
// abgeschnittene Rest bleibt normaler Text (siehe scanChunkForProviderLinks
// unten bzw. der trimBareUrl-Aufruf in markdown.jsx' renderInline).
export function trimBareUrl(url) {
  let end = url.length;
  for (;;) {
    if (end === 0) break;
    const ch = url[end - 1];
    if (".,;:!?".includes(ch)) { end--; continue; }
    if (ch === ")") {
      const prefix = url.slice(0, end - 1);
      const opens = (prefix.match(/\(/g) || []).length;
      const closes = (prefix.match(/\)/g) || []).length;
      if (opens > closes) break; // gehört zu einer offenen "(" -> URL endet hier
      end--;
      continue;
    }
    break;
  }
  return url.slice(0, end);
}

// Scannt EINEN Chunk (bereits außerhalb Fences/Codespans) und hängt an
// `out` entweder unveränderten Text (String) oder einen Kandidaten
// ({ __providerLink:true, url, fallback, provider }) an. `cap` ist ein über
// den GESAMTEN Dokumentdurchlauf geteiltes { remaining }-Objekt (maxLinks-
// Deckel, dokumentweit über alle Chunks/Segmente hinweg gezählt – die
// Reihenfolge der Fundstellen entspricht der Dokumentreihenfolge, da
// splitFenceSegments/CODESPAN_SPLIT_RE die Reihenfolge erhalten). `configured`
// ist die Provider-Liste (getLinkProviders()-Stand des Aufrufers).
//
// REVIEW-FIX (🟡 maxLinks-Aushungerung, vor dem Commit gemeldet): der
// Provider-Match (providerFor + providerHasCredentials) wird jetzt HIER IM
// SCAN geprüft (beides reine, synchrone Funktionen) – NUR eine Fundstelle
// mit echtem Provider-Match UND Zugangsdaten verbraucht den maxLinks-
// Deckel und wird zum Kandidaten. Vorher zählte JEDE grammatikalisch
// unaufgelöste Fundstelle gegen den Deckel, unabhängig vom Provider-Match:
// mehrere provider-fremde URLs (z. B. externe Wissensbasis-Links wie
// example.org) VOR einem echten, auflösbaren Provider-Link (z. B. ein
// DevOps-Ticket) hätten den Deckel bereits erschöpft, BEVOR der echte Link
// überhaupt geprüft wurde – das Kernversprechen ("Provider-Links werden
// aufgelöst") wäre in dieser Konstellation nie eingelöst worden. maxLinks
// bedeutet jetzt "maximal so viele Provider-Links (mit Match+Zugangsdaten)
// pro Lauf auflösen", nicht mehr "maximal so viele unaufgelöste Fundstellen
// überhaupt anfassen".
function scanChunkForProviderLinks(text, cap, out, configured) {
  let last = 0;
  PROVIDER_LINK_SCAN_RE.lastIndex = 0;
  let m;
  while ((m = PROVIDER_LINK_SCAN_RE.exec(text))) {
    const full = m[0];
    const start = m.index;
    if (start > last) out.push(text.slice(last, start));

    if (m[1] !== undefined) { // Bild: nie anfassen (auch nicht auf den Deckel anrechnen)
      out.push(full);
      last = start + full.length;
      continue;
    }

    let url = null;
    let fallback = full;
    let consumedLen = full.length;
    if (m[2] !== undefined) {
      if (m[2] === m[3]) url = m[3]; // NUR wenn Titel === URL (sonst Fußnote/echter Titel)
    } else if (m[4] !== undefined) {
      url = m[4]; // <url>-Autolink
    } else {
      const trimmed = trimBareUrl(m[5]);
      if (trimmed) { url = trimmed; fallback = trimmed; consumedLen = trimmed.length; }
    }

    // Provider-Match SOFORT prüfen (siehe Review-Fix-Kommentar oben) – eine
    // Fundstelle ohne passenden/credential-losen Provider verbraucht den
    // Deckel nicht und bleibt unangetastet, GENAU wie eine Fußnote/ein
    // echter Titel.
    const provider = url === null ? null : providerFor(url, configured);
    const hasCreds = provider ? providerHasCredentials(provider) : false;

    if (!hasCreds || cap.remaining <= 0) {
      // Kein Kandidat (Fußnote/echter Titel/kaputte Bare-URL/kein Provider-
      // Match) ODER Deckel bereits durch ANDERE auflösbare Links erreicht:
      // Original byte-genau stehen lassen, nichts verbraucht.
      out.push(full);
      last = start + full.length;
      continue;
    }

    cap.remaining--;
    out.push({ __providerLink: true, url, fallback, provider });
    // Ein evtl. abgeschnittener Rest (Satzzeichen) bleibt normaler Text und
    // wird über die nächste `text.slice(last, ...)`-Ausgabe mit ausgegeben.
    last = start + consumedLen;
  }
  if (last < text.length) out.push(text.slice(last));
}

// resolveProviderLinkTitles(md, { fetchImpl, timeoutMs, maxLinks }) →
// Promise<string>. Löst pro Aufruf höchstens `maxLinks` (Default 5)
// Provider-Links MIT Match+Zugangsdaten auf (dokumentweit gezählt, NICHT
// pro Segment – siehe Review-Fix-Kommentar bei scanChunkForProviderLinks:
// eine Fundstelle OHNE Provider-Match verbraucht den Deckel nicht mehr),
// der Rest bleibt unangetastet. Gleiche URL mehrfach: nur EIN
// fetchLinkTitle-Aufruf (Cache pro Aufruf), das Ergebnis wird auf ALLE ihre
// Fundstellen angewendet. Ein Fetch-Fehler lässt die betroffene Fundstelle
// byte-genau unverändert (still, kein UI-Spam – siehe Aufrufer in App.jsx).
// Idempotent: ein aufgelöster Link hat Titel !== URL und wird bei einem
// zweiten Lauf nicht mehr als Kandidat erkannt.
export async function resolveProviderLinkTitles(md, opts = {}) {
  const text = String(md ?? "");
  if (!text) return text;

  const configured = getLinkProviders();
  // Schneller No-op (Auftrag: "ohne passende Provider ist alles ein
  // schneller No-op"): kein einziger konfigurierter Provider trägt
  // Zugangsdaten -> es kann ohnehin nichts aufgelöst werden, das Dokument
  // wird nicht mal gescannt, fetchImpl nie berührt.
  if (!configured.some(providerHasCredentials)) return text;

  const fetchImpl = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!fetchImpl) return text;
  const timeoutMs = opts.timeoutMs;
  const maxLinks = Number.isFinite(opts.maxLinks) ? opts.maxLinks : 5;

  // Fences (code.jsx) UND Codespans (wie renumberCitations, markdown.jsx)
  // bleiben komplett unangetastet. `out` ist eine FLACHE Token-Liste für
  // das GESAMTE Dokument (Strings + Kandidaten-Objekte); die Trenner
  // zwischen Fence-Segmenten sind "\n" (siehe splitFenceSegments-Doku:
  // "segments.map(s => s.raw).join('\n')"), innerhalb eines Segments
  // dagegen "" (reiner String-Split ohne Separator). configured wird
  // durchgereicht, damit der Provider-Match SCHON im Scan entschieden wird
  // (Review-Fix maxLinks-Aushungerung).
  const out = [];
  const cap = { remaining: maxLinks };
  splitFenceSegments(text).forEach((seg, si) => {
    if (si > 0) out.push("\n");
    if (seg.code) { out.push(seg.raw); return; }
    seg.raw.split(CODESPAN_SPLIT_RE).forEach((chunk, i) => {
      if (i % 2) out.push(chunk); // Codespan: unangetastet
      else scanChunkForProviderLinks(chunk, cap, out, configured);
    });
  });

  const providerLinks = out.filter((t) => t && t.__providerLink);
  const uniqueUrls = [...new Set(providerLinks.map((t) => t.url))];
  if (!uniqueUrls.length) return text; // nichts gefunden -> kein Fetch, keine Rekonstruktion nötig

  // Provider ist bereits je Kandidat bekannt (Scan hat das Match schon
  // geprüft) – für dieselbe URL liefert providerFor ohnehin immer denselben
  // Provider (reine Funktion von (url, configured)), die erste Fundstelle
  // reicht als Quelle.
  const providerByUrl = new Map(providerLinks.map((t) => [t.url, t.provider]));

  const results = new Map(); // url -> fetchLinkTitle-Ergebnis
  await Promise.allSettled(uniqueUrls.map(async (url) => {
    const res = await fetchLinkTitle(url, providerByUrl.get(url), { fetchImpl, timeoutMs });
    results.set(url, res);
  }));

  // fetchLinkTitle liefert bei ok:true bereits einen durch cleanupLinkTitle
  // bereinigten Titel (keine "[ ]", nicht rein numerisch) – hier NICHT
  // nochmal bereinigen, das würde nur unnötig doppelt arbeiten.
  return out
    .map((token) => {
      if (typeof token === "string") return token;
      const res = results.get(token.url);
      return res && res.ok ? "[" + res.title + "](" + token.url + ")" : token.fallback;
    })
    .join("");
}
