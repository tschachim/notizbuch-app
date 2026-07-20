/* ------------------------------------------------------------------ */
/* AutoKorrektur-Bibliothek (v7.25, Nutzerwunsch: "Word-artige Zeichen- */
/* ersetzung beim Tippen, mit umfangreicher eingebauter Bibliothek nach */
/* Word-/Typografie-Konventionen, konfigurierbar").                    */
/*                                                                      */
/* BLATT im Abhängigkeitsbaum wie code.jsx/linkProviders.jsx (siehe     */
/* deren Kopfkommentare): reine Daten + Logik, importiert NICHTS aus    */
/* markdown.jsx/math.jsx/DocEditor.jsx und auch nichts aus TipTap/      */
/* ProseMirror – die Regex-Objekte hier sind reines JavaScript und      */
/* funktionieren unabhängig vom Editor, voll ohne DOM testbar. Die      */
/* Editor-Anbindung (TipTap-InputRules aus den hier kompilierten        */
/* Regeln) lebt in DocEditor.jsx, die Einstellungen-UI in               */
/* SettingsDialog.jsx – beide importieren VON hier, nie umgekehrt.      */
/*                                                                      */
/* Persistenz (v7.25-Auftragsänderung, Nutzerwunsch "natürlich global   */
/* gespeichert"): Die Konfiguration lebt NICHT in localStorage (anders  */
/* als linkProviders/Zugangsdaten), sondern als Teil von state.json     */
/* (App.jsx serializeState/connect) – geräteübergreifend über das       */
/* Daten-Repo synchronisiert, weil sie keine Zugangsdaten enthält.      */
/* sanitizeAutocorrectConfig (unten) ist deshalb sowohl beim LADEN aus  */
/* state.json als auch beim SCHREIBEN defensiv anzuwenden (App.jsx).    */
/*                                                                      */
/* ===================================================================*/
/* KONFLIKT-DESIGN (Kernstück, siehe Auftrag)                          */
/* ===================================================================*/
/* ProseMirror/TipTap-InputRules feuern beim Tippen des LETZTEN         */
/* Zeichens eines Treffers. Ein zu früh feuernder KURZER Trigger kann    */
/* einen LÄNGEREN, eigentlich gewollten Trigger unerreichbar machen,     */
/* weil der kurze Trigger dessen Zeichen bereits ersetzt hat, BEVOR die  */
/* weiteren Zeichen überhaupt getippt sind (Beispiel aus dem Auftrag:    */
/* "--"→– dürfte "-->" niemals mehr entstehen lassen, wenn es sofort     */
/* beim zweiten "-" feuert – der rohe Text "--" existiert dann nicht     */
/* mehr, wenn ">" folgt). Für jeden Eintrag wird deshalb bewusst eines   */
/* von vier Feuer-Regimen ("kind") gewählt:                             */
/*                                                                      */
/*  - "instant": feuert SOFORT beim letzten Zeichen, ohne weitere        */
/*    Bedingung. Für alle Trigger, die KEIN echter PRÄFIX eines anderen  */
/*    aktiven Triggers sind (nur SUFFIX-Überschneidungen sind möglich,   */
/*    z. B. endet "-->" auf "->", "<=>" auf "=>"/"<="-ähnlich, "<->" auf  */
/*    "->"). Das löst compileAll unten GENERISCH über eine nach          */
/*    Trigger-Länge ABSTEIGEND sortierte Regel-Liste: TipTap/            */
/*    ProseMirror prüft Regeln in Array-Reihenfolge und wendet die       */
/*    ERSTE an, die passt – bei "-->" gewinnt die 3-Zeichen-Regel         */
/*    automatisch gegen die 2-Zeichen-Regel "->", weil sie zuerst        */
/*    geprüft wird.                                                     */
/*  - "terminator": der Trigger IST ein echter Präfix eines längeren     */
/*    aktiven Triggers (z. B. "--" von "-->"/"---", "<-" von "<--"/      */
/*    "<->", "<=" von "<=="/"<=>") und feuert deshalb NUR, wenn direkt    */
/*    danach ein weiteres Zeichen getippt wird, das NICHT zur            */
/*    Fortsetzung des längeren Triggers gehört (siehe "exclude" je       */
/*    Eintrag). Das Abschlusszeichen selbst bleibt im Dokument stehen –  */
/*    TipTaps textInputRule() hängt es über die Capture-Gruppe (match[1])*/
/*    automatisch wieder an. Ohne diese Bedingung würde z. B. "--"        */
/*    bereits beim zweiten Bindestrich feuern und "-->"/"---" wären nie   */
/*    erreichbar (siehe Test "Ketten-Konflikte").                        */
/*  - "word": Brüche (Auftrag: "nur als EIGENSTÄNDIGES Wort") – wie       */
/*    "terminator" (Abschlusszeichen darf keine weitere Ziffer sein),     */
/*    ZUSÄTZLICH eine Wortgrenze VOR dem Trigger (negativer Lookbehind,   */
/*    kein Ziffern-/Buchstaben-Zeichen direkt davor) – sonst würde z. B.  */
/*    "11/2" die Teilzeichenfolge "1/2" mitten in der Zahl "11" fälschlich*/
/*    zu "1½" machen, oder "12/3" die Teilzeichenfolge "2/3" mitten in    */
/*    "12" zu "1⅔".                                                     */
/*  - "backslash": Word-Math-Kommandos (\alpha, \sum, …) – wie            */
/*    "terminator" (Abschlusszeichen darf kein weiterer Buchstabe sein),  */
/*    aber OHNE Lookbehind (ein Backslash ist bereits eine eindeutige     */
/*    Grenze, nichts "leakt" von davor hinein). Das entschärft            */
/*    automatisch AUCH Präfix-Paare INNERHALB der Kommando-Liste selbst   */
/*    (z. B. ist "\in" ein Präfix von "\int" UND "\infty" – da "\in" nur  */
/*    bei einem NICHT-Buchstaben direkt danach feuert, "t"/"f" (die       */
/*    Fortsetzung zu "int"/"infty") aber Buchstaben sind, feuert "\in"    */
/*    nicht, solange noch weitere Buchstaben folgen).                    */
/*                                                                      */
/* Zwei weitere Einträge sind strukturell KEIN einfaches                */
/* trigger→replacement und bekommen deshalb eigene Kind-Werte:           */
/*  - "multiply" (Kategorie vergleiche): "Ziffer x Ziffer" → "×" – eigene */
/*    Regex mit Ziffern-Gruppen statt festem Text (siehe                 */
/*    compileMultiplyEntry unten). Bewusstes Restrisiko: eine ZWEITE      */
/*    MEHRSTELLIGE Zahl (z. B. "2x34") wird schon bei der ERSTEN Ziffer    */
/*    umgewandelt ("2x3"→"2×3", die "4" wird danach normal angehängt) –   */
/*    der Auftrag nennt nur einstellige Beispiele; ein Nachlauf-          */
/*    Terminator wie bei Brüchen würde "2x3" am Ende eines Satzes (ohne   */
/*    folgendes Zeichen) dagegen NIE feuern lassen – das wäre schlechter  */
/*    als das dokumentierte Restrisiko.                                  */
/*  - "quote" (Kategorie anfuehrung_de, default AUS): kontextabhängig     */
/*    öffnend ODER schließend, je nachdem, ob dem getippten Zeichen       */
/*    Zeilenanfang/Whitespace/eine öffnende Klammer vorausgeht (siehe     */
/*    compileQuoteEntry unten) – zwei separate Regeln, öffnend zuerst     */
/*    im Array (spezifischer, "instant"-artig geprüft).                  */
/* ------------------------------------------------------------------ */

// Escaped einen literalen String für den Einbau in eine RegExp-Quelle
// (Zeichenklassen-sicher wird NICHT hier, sondern in excludeClass()
// behandelt – diese Funktion ist nur für Text AUSSERHALB einer Klasse).
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Baut "[^…]" aus einer Liste auszuschließender Zeichen – escaped die
// innerhalb einer Zeichenklasse besonderen Zeichen (]  ^  -  \).
function excludeClass(chars) {
  return "[^" + String(chars).replace(/[\]\\^-]/g, "\\$&") + "]";
}

/* ---------------- Griechisches Alphabet + Math-Symbole (Kategorie "symbole") ---------------- */
// Kompakte Tabellen statt 68 einzelner Objekt-Literale – weniger
// Tippfehler-Risiko, Zähler bleiben leicht nachvollziehbar (siehe Tests).
// Nur Großbuchstaben mit EIGENEM, von der lateinischen Form unterscheid-
// barem Unicode-Zeichen sind dabei (Auftrag): Alpha/Beta/Epsilon/Zeta/Eta/
// Iota/Kappa/Mu/Nu/Omicron/Rho/Tau/Chi sehen im Großbuchstaben genau wie
// A/B/E/Z/H/I/K/M/N/O/P/T/X aus – ein "\Alpha"-Kommando dafür wäre nur
// verwirrend (still gegen "A" ersetzt), deshalb bewusst weggelassen.
const GREEK_LOWER = [
  ["alpha", "α"], ["beta", "β"], ["gamma", "γ"], ["delta", "δ"], ["epsilon", "ε"],
  ["zeta", "ζ"], ["eta", "η"], ["theta", "θ"], ["iota", "ι"], ["kappa", "κ"],
  ["lambda", "λ"], ["mu", "μ"], ["nu", "ν"], ["xi", "ξ"], ["omicron", "ο"],
  ["pi", "π"], ["rho", "ρ"], ["sigma", "σ"], ["tau", "τ"], ["upsilon", "υ"],
  ["phi", "φ"], ["chi", "χ"], ["psi", "ψ"], ["omega", "ω"],
];
const GREEK_UPPER = [
  ["Gamma", "Γ"], ["Delta", "Δ"], ["Theta", "Θ"], ["Lambda", "Λ"], ["Xi", "Ξ"],
  ["Pi", "Π"], ["Sigma", "Σ"], ["Phi", "Φ"], ["Psi", "Ψ"], ["Omega", "Ω"],
];
const MATH_SYMBOLS = [
  ["sum", "∑"], ["prod", "∏"], ["int", "∫"], ["infty", "∞"], ["pm", "±"],
  ["times", "×"], ["div", "÷"], ["cdot", "·"], ["bullet", "•"], ["degree", "°"],
  ["micro", "µ"], ["euro", "€"], ["sqrt", "√"], ["approx", "≈"], ["neq", "≠"],
  ["leq", "≤"], ["geq", "≥"], ["rightarrow", "→"], ["leftarrow", "←"],
  ["Rightarrow", "⇒"], ["Leftrightarrow", "⇔"], ["uparrow", "↑"], ["downarrow", "↓"],
  ["in", "∈"], ["subset", "⊂"], ["cup", "∪"], ["cap", "∩"], ["forall", "∀"],
  ["exists", "∃"], ["nabla", "∇"], ["partial", "∂"], ["emptyset", "∅"],
  ["checkmark", "✓"], ["star", "★"],
];
const symboleEntries = [...GREEK_LOWER, ...GREEK_UPPER, ...MATH_SYMBOLS].map(([name, replacement]) => ({
  trigger: "\\" + name,
  replacement,
  kind: "backslash",
}));

/* ---------------- Brüche (Kategorie "brueche") ---------------- */
const fractionEntries = [
  ["1/2", "½"], ["1/4", "¼"], ["3/4", "¾"], ["1/3", "⅓"], ["2/3", "⅔"],
  ["1/5", "⅕"], ["2/5", "⅖"], ["3/5", "⅗"], ["4/5", "⅘"], ["1/6", "⅙"],
  ["5/6", "⅚"], ["1/8", "⅛"], ["3/8", "⅜"], ["5/8", "⅝"], ["7/8", "⅞"],
].map(([trigger, replacement]) => ({ trigger, replacement, kind: "word" }));

/* ---------------- Kategorien (öffentliche Bibliothek) ---------------- */
export const AUTOCORRECT_CATEGORIES = [
  {
    id: "pfeile",
    label: "Pfeile",
    defaultEnabled: true,
    entries: [
      { trigger: "->", replacement: "→", kind: "instant" },
      // Präfix von "<--"/"<->" – siehe Konflikt-Design oben.
      { trigger: "<-", replacement: "←", kind: "terminator", exclude: "->" },
      { trigger: "-->", replacement: "⟶", kind: "instant" },
      { trigger: "<--", replacement: "⟵", kind: "instant" },
      { trigger: "=>", replacement: "⇒", kind: "instant" },
      { trigger: "<==", replacement: "⇐", kind: "instant" },
      { trigger: "==>", replacement: "⇒", kind: "instant" },
      { trigger: "<=>", replacement: "⇔", kind: "instant" },
      { trigger: "<->", replacement: "↔", kind: "instant" },
    ],
  },
  {
    id: "typografie",
    label: "Typografie",
    defaultEnabled: true,
    entries: [
      // Präfix von "-->"/"---" – siehe Konflikt-Design oben (Kernfall
      // aus dem Auftrag).
      { trigger: "--", replacement: "–", kind: "terminator", exclude: "->" },
      { trigger: "---", replacement: "—", kind: "instant" },
      { trigger: "...", replacement: "…", kind: "instant" },
      { trigger: "<<", replacement: "«", kind: "instant" },
      { trigger: ">>", replacement: "»", kind: "instant" },
    ],
  },
  {
    id: "marken",
    label: "Marken & Zeichen",
    defaultEnabled: true,
    entries: [
      { trigger: "(c)", replacement: "©", kind: "instant" },
      { trigger: "(r)", replacement: "®", kind: "instant" },
      { trigger: "(tm)", replacement: "™", kind: "instant" },
      { trigger: "(e)", replacement: "€", kind: "instant" },
      // Ausdrücklicher Nutzerwunsch trotz Kollisionsrisiko mit
      // Aufzählungen wie "(a) erstens" – siehe DECISIONS.md. Per
      // Kategorie ODER als einzelner Eintrag (custom-Override mit
      // identischem Trigger, siehe buildActiveRules) abschaltbar.
      { trigger: "(a)", replacement: "@", kind: "instant" },
      { trigger: "(deg)", replacement: "°", kind: "instant" },
    ],
  },
  {
    id: "vergleiche",
    label: "Vergleiche & Rechenzeichen",
    defaultEnabled: true,
    entries: [
      { trigger: "!=", replacement: "≠", kind: "instant" },
      // Präfix von "<=="/"<=>" – siehe Konflikt-Design oben (Kernfall
      // aus dem Auftrag).
      { trigger: "<=", replacement: "≤", kind: "terminator", exclude: "=>" },
      { trigger: ">=", replacement: "≥", kind: "instant" },
      { trigger: "~=", replacement: "≈", kind: "instant" },
      { trigger: "+-", replacement: "±", kind: "instant" },
      // "Ziffer x Ziffer" → "×" (auch mit Leerzeichen, z. B. "2 x 3");
      // kind:"multiply" hat KEINEN festen Trigger-Text – trigger/
      // replacement hier sind nur ein Beispiel für die Einstellungen-UI,
      // siehe compileMultiplyEntry.
      { trigger: "2x3", replacement: "2×3", kind: "multiply" },
    ],
  },
  {
    id: "brueche",
    label: "Brüche",
    defaultEnabled: true,
    entries: fractionEntries,
  },
  {
    id: "smileys",
    label: "Smileys",
    defaultEnabled: true,
    entries: [
      { trigger: ":)", replacement: "😊", kind: "instant" },
      { trigger: ":(", replacement: "🙁", kind: "instant" },
      { trigger: ":|", replacement: "😐", kind: "instant" },
      { trigger: ";)", replacement: "😉", kind: "instant" },
      { trigger: "<3", replacement: "❤️", kind: "instant" },
    ],
  },
  {
    id: "symbole",
    label: "Mathe- & Griechisch-Symbole (\\-Kommandos)",
    defaultEnabled: true,
    entries: symboleEntries,
  },
  {
    id: "anfuehrung_de",
    label: "Deutsche Anführungszeichen",
    // Default AUS (Auftrag): riskant bei technischen Texten (Zitate aus
    // Code/Konfiguration mit geraden Anführungszeichen).
    defaultEnabled: false,
    entries: [
      // "open"/"close" statt "replacement" – siehe compileQuoteEntry.
      { trigger: '"', open: "„", close: "“", kind: "quote" },
      { trigger: "'", open: "‚", close: "‘", kind: "quote" },
    ],
  },
];

/* ---------------- Regel-Compiler (Kategorie-Eintrag → TipTap-taugliche Regex) ---------------- */

function compileEntry(entry) {
  const esc = escapeRegex(entry.trigger);
  let source;
  if (entry.kind === "terminator") {
    source = "(" + esc + ")" + excludeClass(entry.exclude) + "$";
  } else if (entry.kind === "word") {
    source = "(?<![0-9A-Za-z])(" + esc + ")[^0-9]$";
  } else if (entry.kind === "backslash") {
    source = "(" + esc + ")[^A-Za-z]$";
  } else {
    source = esc + "$"; // "instant"
  }
  return { trigger: entry.trigger, replacement: entry.replacement, kind: "text", find: new RegExp(source) };
}

// "Ziffer x Ziffer" → "×": EIN Digit auf jeder Seite (Auftrag nennt nur
// einstellige Beispiele), optionaler Leerraum um das "x", Lookbehind
// verhindert ein Feuern MITTEN in einer mehrstelligen ersten Zahl (z. B.
// "12x3" bleibt unangetastet – der Charakter vor der letzten Ziffer der
// ersten Zahl ist dort selbst eine Ziffer). DocEditor.jsx baut daraus
// eine eigene InputRule, die match[1..4] (Ziffer/Leerraum/Leerraum/
// Ziffer) unverändert wieder zusammensetzt und NUR das "x" ersetzt.
const MULTIPLY_FIND = /(?<![0-9A-Za-z])(\d)(\s*)x(\s*)(\d)$/;
function compileMultiplyEntry(entry) {
  return { trigger: entry.trigger, replacement: entry.replacement, kind: "multiply", find: MULTIPLY_FIND };
}

// Kontextabhängige Anführungszeichen: "öffnend", wenn dem getippten
// Zeichen nichts, Whitespace oder eine öffnende Klammer vorausgeht,
// sonst "schließend". ZWEI Regeln (öffnend zuerst im Ergebnis-Array,
// siehe buildActiveRules) statt einer bedingten Ersetzung, weil
// textInputRule() pro Regel nur EIN festes replace kennt.
function compileQuoteEntry(entry) {
  const esc = escapeRegex(entry.trigger);
  const openFind = new RegExp("(?<![^\\s([{])" + esc + "$");
  const closeFind = new RegExp(esc + "$");
  return [
    { trigger: entry.trigger, replacement: entry.open, kind: "text", find: openFind },
    { trigger: entry.trigger, replacement: entry.close, kind: "text", find: closeFind },
  ];
}

/* ---------------- Aktive Regeln aus der Konfiguration bauen ---------------- */

// Ist eine Kategorie aktiv? Fehlt sie in config.categories (noch nie
// angefasst), gilt ihr defaultEnabled. Exportiert für die Einstellungen-
// UI (Checkbox-Zustand) – GENAU dieselbe Regel wie buildActiveRules unten.
export function isCategoryEnabled(config, categoryId) {
  const cat = AUTOCORRECT_CATEGORIES.find((c) => c.id === categoryId);
  if (!cat) return false;
  const cfg = sanitizeAutocorrectConfig(config);
  return typeof cfg.categories[categoryId] === "boolean" ? cfg.categories[categoryId] : cat.defaultEnabled;
}

// buildActiveRules(config) → Array kompilierter Regeln, bereit für
// DocEditor.jsx (siehe dort, addInputRules()). config kommt aus dem
// App-State (state.json-Feld "autocorrect", siehe App.jsx) und wird
// HIER defensiv sanitisiert – ein Aufrufer muss das nicht vorher tun.
//
// Reihenfolge/Konflikt-Auflösung: eingebaute Trigger werden in einer
// Map nach Trigger-STRING gesammelt (spätere Kategorien überschreiben
// frühere mit demselben Trigger NICHT – es gibt im eingebauten Bestand
// keine Duplikate, siehe Tests), custom-Einträge laufen ZULETZT über
// dieselbe Map und GEWINNEN bei identischem Trigger-String bewusst
// (Auftrag: "custom überschreibt eingebauten Trigger") – custom-
// Einträge laufen immer im simplen "instant"-Modus (kein Terminator-/
// Wort-/Backslash-Feingefühl für frei getippten Nutzertext). Die
// resultierende Liste wird nach Trigger-LÄNGE ABSTEIGEND sortiert
// (siehe Konflikt-Design oben, "instant") – multiply/quote-Einträge
// hängen danach unsortiert an (strukturell konfliktfrei mit dem Rest:
// eigene Zeichen-Alphabete, siehe Kopfkommentar).
export function buildActiveRules(config) {
  const cfg = sanitizeAutocorrectConfig(config);
  if (!cfg.enabled) return [];

  const byTrigger = new Map(); // trigger-String -> Roh-Eintrag (vor dem Compile)
  const extra = []; // multiply/quote: kein einfacher trigger-Schlüssel

  for (const cat of AUTOCORRECT_CATEGORIES) {
    const on = typeof cfg.categories[cat.id] === "boolean" ? cfg.categories[cat.id] : cat.defaultEnabled;
    if (!on) continue;
    for (const entry of cat.entries) {
      if (entry.kind === "multiply") extra.push(compileMultiplyEntry(entry));
      else if (entry.kind === "quote") extra.push(...compileQuoteEntry(entry));
      else byTrigger.set(entry.trigger, entry);
    }
  }
  for (const c of cfg.custom) {
    byTrigger.set(c.trigger, { trigger: c.trigger, replacement: c.replacement, kind: "instant" });
  }

  const textRules = [...byTrigger.values()]
    .map(compileEntry)
    .sort((a, b) => b.trigger.length - a.trigger.length);

  return [...textRules, ...extra];
}

/* ---------------- Settings-Persistenz (Sanitize, defensiv) ---------------- */

const CUSTOM_TRIGGER_MIN = 2;
const CUSTOM_TRIGGER_MAX = 20;
const CUSTOM_REPLACEMENT_MIN = 1;
const CUSTOM_REPLACEMENT_MAX = 20;

// Formular-Validierung für die Einstellungen-UI (SettingsDialog.jsx) –
// GENAU dieselben Grenzen wie sanitizeAutocorrectConfig unten (die
// eigentliche Durchsetzungsstelle, hier nur die UX-Vorprüfung mit
// sprechendem Fehlertext, gleiches Muster wie cleanupLinkTitle/
// normalizeLinkUrl in linkProviders.jsx/DocEditor.jsx).
export function validateCustomTrigger(raw) {
  const t = String(raw ?? "").trim();
  if (t.length < CUSTOM_TRIGGER_MIN || t.length > CUSTOM_TRIGGER_MAX) {
    return { error: "Trigger muss " + CUSTOM_TRIGGER_MIN + "–" + CUSTOM_TRIGGER_MAX + " Zeichen lang sein." };
  }
  return { value: t };
}
export function validateCustomReplacement(raw) {
  const r = String(raw ?? "").trim();
  if (r.length < CUSTOM_REPLACEMENT_MIN || r.length > CUSTOM_REPLACEMENT_MAX) {
    return { error: "Ersetzung muss " + CUSTOM_REPLACEMENT_MIN + "–" + CUSTOM_REPLACEMENT_MAX + " Zeichen lang sein." };
  }
  return { value: r };
}

function isValidCustomEntry(c) {
  if (!c || typeof c !== "object") return false;
  if (typeof c.trigger !== "string" || typeof c.replacement !== "string") return false;
  const t = c.trigger.trim();
  const r = c.replacement.trim();
  return (
    t.length >= CUSTOM_TRIGGER_MIN && t.length <= CUSTOM_TRIGGER_MAX &&
    r.length >= CUSTOM_REPLACEMENT_MIN && r.length <= CUSTOM_REPLACEMENT_MAX
  );
}

// sanitizeAutocorrectConfig(raw) → { enabled, categories, custom }.
// Defensiv gegen jeden Fremd-/Alt-Zustand (fehlendes Feld, kaputtes
// state.json, manuell editiertes Repo) – wirft NIE, liefert bei
// jedem Zweifel den Default (Master-Toggle AN, keine Kategorie-
// Überschreibung = alle defaultEnabled-Kategorien aktiv, keine eigenen
// Ersetzungen). Wird sowohl beim LADEN aus state.json als auch VOR dem
// Schreiben angewendet (App.jsx) – idempotent, sanitize(sanitize(x))
// liefert dasselbe Ergebnis wie sanitize(x).
export function sanitizeAutocorrectConfig(raw) {
  const enabled = raw && typeof raw === "object" && typeof raw.enabled === "boolean" ? raw.enabled : true;

  const categories = {};
  if (raw && typeof raw === "object" && raw.categories && typeof raw.categories === "object") {
    for (const cat of AUTOCORRECT_CATEGORIES) {
      if (typeof raw.categories[cat.id] === "boolean") categories[cat.id] = raw.categories[cat.id];
    }
  }

  const custom = raw && typeof raw === "object" && Array.isArray(raw.custom)
    ? raw.custom.filter(isValidCustomEntry).map((c) => ({ trigger: c.trigger.trim(), replacement: c.replacement.trim() }))
    : [];

  return { enabled, categories, custom };
}
