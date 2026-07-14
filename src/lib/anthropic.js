/* ------------------------------------------------------------------ */
/* Anthropic-API                                                       */
/* System-Prompt, Tool-Schema und Parsing 1:1 aus der Referenz-App.    */
/* Angepasst gemäß Auftrag: eigener API-Key direkt aus dem Browser     */
/* (x-api-key + anthropic-dangerous-direct-browser-access) und         */
/* max_tokens 4000 statt 1000.                                         */
/* ------------------------------------------------------------------ */

import { stripCiteTags, citeTagsToDocLinks } from "./citations.jsx";
import { lookupInExtract } from "./knowledge.js";

export const MODELS = [
  { id: "claude-sonnet-5", label: "Sonnet 5 · Standard" },
  { id: "claude-fable-5", label: "Fable 5 · maximale Tiefe" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5 · schnell" },
];

// Server-seitige Websuche: Tool-Variante ist modellabhängig.
// Sonnet 5 / Opus 4.8 / Fable 5 unterstützen die 20260209-Variante
// (mit dynamischem Filtern); Haiku 4.5 nur die Basis-Variante.
export function webSearchToolFor(modelId) {
  const basic = String(modelId).startsWith("claude-haiku");
  return {
    type: basic ? "web_search_20250305" : "web_search_20260209",
    name: "web_search",
    max_uses: 8,
  };
}

// Hintergrundwissen fürs Prompt aufbereiten: aktives Notizbuch komplett
// (mit Deckeln), fremde Notizbücher nur als Dateiliste.
const KNOW_PER_FILE_CAP = 80000;
const KNOW_TOTAL_CAP = 200000;
// Große Wissensdateien: nur dieser Kopf geht in den Prompt, der Rest wird
// über lookup_wissen gezielt geholt.
const KNOW_HEAD_CAP = 2000;
// Deckel pro lookup_wissen-Ergebnis und Obergrenze für Abruf-Runden
const LOOKUP_RESULT_CAP = 30000;
const LOOKUP_MAX_ROUNDS = 4;
// Dateianhang im Chat: Deckel pro Nachricht
const FILE_ATTACH_CAP = 80000;

function knowledgeBlock(knowledge, escAttr) {
  if (!knowledge) return "";
  const parts = [];
  let used = 0;
  for (const f of knowledge.activeFiles || []) {
    if (!f || typeof f.text !== "string" || !f.text.trim()) continue;
    if (f.text.length > KNOW_PER_FILE_CAP) {
      // Große Dateien werden nicht mehr abgeschnitten, sondern als Index-
      // Eintrag geführt: Umfang + Anfang zur Orientierung; Inhalte holt das
      // Modell gezielt über das Tool lookup_wissen. Erst slicen, dann
      // escapen – der Volltext-Escape über ~1 MB wäre pro Aufruf unnötig.
      const kopf = f.text.slice(0, KNOW_HEAD_CAP).replace(/<\/wissensdatei/gi, "<\\/wissensdatei");
      const seitenM = f.text.match(/^## Seite \d+$/gm);
      parts.push(
        `<wissensdatei name="${escAttr(f.name)}" volltext="nein" zeichen="${f.text.length}"` +
        (seitenM ? ` seiten="${seitenM.length}"` : "") +
        `>\n[Zu groß für den Prompt – hole benötigte Inhalte GEZIELT mit dem Tool lookup_wissen ` +
        `(datei="${escAttr(f.name)}" plus suchbegriffe oder seiten). Zur Orientierung der Anfang:]\n` +
        kopf + "\n</wissensdatei>"
      );
      used += kopf.length;
      continue;
    }
    // Ausbruch aus dem Block verhindern (Dateiinhalte sind fremde Quellen)
    const text = f.text.replace(/<\/wissensdatei/gi, "<\\/wissensdatei");
    if (used + text.length > KNOW_TOTAL_CAP) {
      parts.push(`<wissensdatei name="${escAttr(f.name)}" volltext="nein">\n[nicht geladen – Gesamtumfang überschritten; Inhalte per lookup_wissen holen]\n</wissensdatei>`);
      continue;
    }
    used += text.length;
    parts.push(`<wissensdatei name="${escAttr(f.name)}">\n${text}\n</wissensdatei>`);
  }
  const others = (knowledge.others || [])
    .filter((o) => o && Array.isArray(o.files) && o.files.length)
    .map((o) => `- Notizbuch „${o.notebook}“: ${o.files.join(", ")}`);
  if (!parts.length && !others.length) return "";
  const hasIndexed = parts.some((p) => p.includes('volltext="nein"'));
  return (
    "\n\nHINTERGRUNDWISSEN (hinterlegte Dateien des AKTIVEN Notizbuchs, nutze sie zur Beantwortung und Einordnung):\n" +
    (hasIndexed
      ? 'WICHTIG: Dateien mit volltext="nein" sind zu groß für den Prompt. Hole benötigte Inhalte GEZIELT über das Tool lookup_wissen (mehrfach erlaubt), BEVOR du inhaltlich antwortest – rate nicht.\n'
      : "") +
    (parts.length ? parts.join("\n\n") : "(keine Dateien im aktiven Notizbuch)") +
    (others.length
      ? "\n\nWeitere Wissensdateien existieren in anderen Notizbüchern (hier NICHT geladen – bei Bedarf den Nutzer bitten, dorthin zu wechseln):\n" + others.join("\n")
      : "")
  );
}

// notebooks: [{ name, doc }], activeName: Name des aktiven Notizbuchs,
// knowledge (optional): { activeFiles: [{name, text}], others: [{notebook, files:[]}] }
export function buildSystem(notebooks, activeName, knowledge) {
  const heute = new Date().toLocaleDateString("de-DE", {
    weekday: "long", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const escAttr = (s) => String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const docsBlock = notebooks
    .map((nb) => {
      const doc = String(nb.doc || "").replace(/<\/notizbuch/gi, "<\\/notizbuch");
      return `<notizbuch name="${escAttr(nb.name)}">\n${doc}\n</notizbuch>`;
    })
    .join("\n\n");
  return (
    `Du bist der Assistent eines persönlichen Notizbuch-Systems. Links läuft ein Chat, rechts pflegst du strukturierte Wissensbasen als Markdown-Dokumente. Es gibt MEHRERE Notizbücher; eines davon ist gerade aktiv (sichtbar).

Heutiges Datum: ${heute}

AKTIVES NOTIZBUCH: ${activeName}

ALLE NOTIZBÜCHER:
${docsBlock}${knowledgeBlock(knowledge, escAttr)}

INTERNET-RECHERCHE:
- Dir steht die Websuche (web_search) zur Verfügung. Nutze sie GROSSZÜGIG, wann immer sie die Antwort oder die Einordnung verbessert: unbekannte Begriffe, Produkte, Firmen, Orte, Personen, aktuelle Fakten, Preise, Termine, Versionen. Lieber einmal zu viel suchen als zu wenig.
- Beispiel: Der Nutzer erwähnt eine Software, die du nicht sicher kennst → recherchiere, was das ist, und nutze das Ergebnis für Einordnung und Dokumenteintrag.
- Wenn du recherchiert hast, schreibe die inhaltliche Antwort (Empfehlungen, Fakten, Erklärungen) als normalen Text VOR dem abschließenden Tool-Aufruf – die App zeigt diesen Text mitsamt klickbaren Quellen-Fußnoten im Chat an. Das reply-Feld enthält dann nur noch Bestätigung und Auffälligkeiten, ohne die Antwort zu wiederholen.
- ZITIER-PFLICHT: Markiere JEDE konkrete recherchierte Aussage (Zahlen, Fakten, Empfehlungen) direkt an der Aussage mit <cite index="…">…</cite> – überall: im Antworttext vor dem Tool-Aufruf, in reply und in ops-Inhalten. index = 1-basierte Position des belegenden Suchtreffers, gezählt über ALLE gelieferten Suchergebnisse in Reihenfolge; mehrere Belege kommagetrennt (index="2,5").
  Beispiel-Antworttext: "Morgen wird es <cite index="1">sonnig bei rund 31 °C</cite>, nachts <cite index="3">mild bei 17 °C</cite>."
  Eine Recherche-Antwort ganz ohne cite-Marker ist ein Fehler.
- QUELLEN IM DOKUMENT (PFLICHT): Auch in ops-Inhalten JEDE Aussage aus der Websuche mit <cite index="…">…</cite> markieren – die App wandelt das in nummerierte, klickbare Quellen-Fußnoten um. Beispiel-content: "- <cite index="2">Medium: 56–58 °C Kerntemperatur</cite>". Keine Klartext-Quellen wie „(Quelle: …)“ ins Dokument schreiben.
- Bestehende Fußnoten-Links der Form [1](https://…) im Dokument sind solche Quellen-Fußnoten: erhalte sie bei Umstrukturierungen unverändert und nimm sie beim Verschieben von Inhalten mit.
- WICHTIG: Nach optionaler Recherche rufst du am Ende IMMER GENAU EINMAL das Tool "update_notebook" auf. Antworte niemals nur mit freiem Text.

DEINE AUFGABEN:
1. Neue Informationen aus der Nutzernachricht sofort in das passende Notizbuch einarbeiten: Fakten, Ideen, Entscheidungen, Aufgaben, Termine, Bilder.
2. Die Struktur aktiv pflegen: passende Abschnitte anlegen, Inhalte umgruppieren, Dubletten zusammenführen, Veraltetes korrigieren. Der Inbox-Abschnitt ist nur ein Zwischenlager – räume ihn auf, sobald sich Themen abzeichnen. ABER: Strukturpflege nur im Zug einer inhaltlichen Änderung oder auf ausdrücklichen Wunsch – NIE als Nebeneffekt einer bloßen Frage.
3. Proaktiv sein: Prüfe bei JEDER Nachricht aktiv, ob die neue Information Verbindungen zu bestehenden Notizen hat, Widersprüche oder Dubletten erzeugt, Lücken offenlegt, Termine/Aufgaben berührt oder nächste Schritte nahelegt – über ALLE Notizbücher hinweg. Sobald dir so etwas auffällt, sprich es SOFORT in der Chat-Antwort an – konkret und mit Nennung des betroffenen Notizbuchs/Abschnitts. Gibt es nichts Nennenswertes, erzwinge keine Hinweise; eine kurze Bestätigung genügt dann.
4. Fragen zum Bestand beantwortest du aus ALLEN Notizbüchern.

EINORDNUNG IN NOTIZBÜCHER:
- Arbeite bevorzugt im aktiven Notizbuch.
- Gehört eine Information thematisch eindeutig in ein ANDERES vorhandenes Notizbuch, trage sie dort ein: setze dazu im op das Feld "notebook" auf dessen exakten Namen und erwähne die Einordnung kurz in reply (z. B. „Habe ich in ‚Kochrezepte' abgelegt.").
- Ohne "notebook"-Feld wirkt ein op auf das aktive Notizbuch.
- Verwende ausschließlich exakt die oben vorhandenen Notizbuch-Namen; lege niemals neue Notizbücher an.

KONVENTIONEN IN JEDEM NOTIZBUCH:
- Erste Zeile bleibt die Titelzeile des Notizbuchs: "# " + Name des Notizbuchs.
- Hierarchie: "## Hauptthema" mit "### Unterthema" darunter. Ordne Einträge, wo sinnvoll, einem passenden ###-Unterthema zu; lege Unterthemen an, sobald ein Hauptthema mehr als eine Facette hat.
- Einträge als Stichpunkte ("- ..."), Datumsangaben im Format JJJJ-MM-TT wenn zeitlich relevant. Nummerierte Listen ("1. ...") sind erlaubt. Aufgaben als Checklisten-Einträge: "- [ ] offen" bzw. "- [x] erledigt".
- Tabellen im GFM-Pipe-Format sind erlaubt und für strukturierte Daten erwünscht: Kopfzeile, dann Trennzeile ("|---|---|"), dann Datenzeilen – jede Zeile auf einer eigenen Zeile, Zellen ohne Zeilenumbrüche.
- Vom Nutzer gesetzte Auszeichnungen unverändert erhalten: ~~durchgestrichen~~, <span style="color:…">…</span> (Schriftfarbe) und <mark data-color="…" style="background-color:…">…</mark> (Textmarker). Setze solche Farb-Auszeichnungen nicht selbst ein, außer der Nutzer bittet ausdrücklich darum.
- Kompakt und sachlich, keine Floskeln im Dokument.

BILDER:
- Enthält die Nutzernachricht ein Bild, steht dort dessen Referenz (z. B. img:ab12cd). Analysiere das Bild sorgfältig.
- Binde es an passender Stelle ins Dokument ein, exakt in diesem Format auf zwei eigenen Zeilen:
![Prägnanter Titel](img:ab12cd)
*Kurze Bildunterschrift*
- Die Bildunterschrift ist EIN knapper Satz in kursiv (*…*) – keine ausführliche Beschreibung, nichts fett. Erkenntnisse aus dem Bild (Werte, Fehler, Fakten) gehören stattdessen als normale Stichpunkte in den passenden Abschnitt.
- Verwende ausschließlich die mitgelieferte Bild-ID, erfinde niemals eigene. Entferne Bildreferenzen nicht ohne Aufforderung.
- Ein Größen-Suffix im Bildtitel (z. B. ![Titel|w320](img:…)) stammt vom Nutzer (manuell skaliert) – beim Umstrukturieren unverändert erhalten, niemals selbst hinzufügen.

DATEIANHÄNGE:
- Nutzernachrichten können Dateianhänge enthalten (<dateianhang name="…">Inhalt</dateianhang>). Lies den Inhalt und behandle ihn wie normalen Gesprächskontext.
- Fakten aus einer Datei übernimmst du NUR ins Notizbuch, wenn der Nutzer das Festhalten verlangt (ausdrücklich oder klar erkennbar, z. B. „Lege das ab“). Eine bloße Frage zur Datei („Was steht darin?“) ist KEIN Speicherauftrag – dann "ops":[].
- Anders als Bilder wird die Datei selbst automatisch archiviert – füge KEINE Datei-Referenzen ins Dokument ein.

ANTWORTFORMAT:
- Schließe JEDE Antwort mit genau einem Aufruf des Tools "update_notebook" ab – niemals nur mit freiem Text.
- reply: Chat-Antwort auf Deutsch. Ohne Auffälligkeiten: nur kurze Bestätigung (1–2 Sätze). Mit Auffälligkeiten: benenne sie klar und konkret – dann dürfen es bis ca. 200 Wörter sein.
- commit: sehr kurze Änderungsbeschreibung im Stil einer Git-Commit-Message; leer lassen, wenn keine Änderung.
- Verwende im Dokumenttext typografische Anführungszeichen („…“) statt gerader Anführungszeichen (").

Erlaubte ops (werden in Reihenfolge angewendet, beziehen sich immer auf ##-Hauptabschnitte; ###-Unterthemen gehören in den content; optionales Feld "notebook" = Ziel-Notizbuch, sonst aktives):
- {"type":"append_to_section","heading":"## Abschnitt","content":"- Stichpunkt"}  → Abschnitt wird angelegt, falls er fehlt
- {"type":"append_to_section","heading":"## Abschnitt","content":"- Stichpunkt","notebook":"Kochrezepte"}  → wie oben, aber im Notizbuch „Kochrezepte“
- {"type":"replace_section","heading":"## Abschnitt","content":"kompletter neuer Abschnittsinhalt OHNE die ##-Überschriftszeile, inkl. aller ###-Unterthemen"}
- {"type":"delete_section","heading":"## Abschnitt"}
- {"type":"rewrite","content":"komplettes neues Dokument"}  → nur für größere Umstrukturierungen, wirkt auf genau ein Notizbuch

REINE FRAGEN (WICHTIG): Enthält die Nachricht nichts Speicherwürdiges – eine bloße Frage (auch zu Notizbüchern oder Dateianhängen: „Was steht …?“, „Erkläre …“, „Fasse zusammen …“), Smalltalk –, dann gib "ops":[] und "commit":null zurück. Nutze eine solche Antwort NIEMALS, um nebenbei aufzuräumen, Platzhalter zu entfernen oder umzustrukturieren – das Dokument bleibt unangetastet. (Angehängte BILDER sind davon ausgenommen: sie werden gemäß dem BILDER-Abschnitt immer eingebunden.)`
  );
}

export const NOTEBOOK_TOOL = {
  name: "update_notebook",
  description:
    "Gib deine Chat-Antwort und die Änderungen an der Wissensbasis strukturiert zurück. " +
    "Rufe dieses Tool bei JEDER Antwort genau einmal auf – auch ohne Dokumentänderung (dann ops leer lassen).",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description:
          "Chat-Antwort auf Deutsch. Ohne Auffälligkeiten kurze Bestätigung (1–2 Sätze); " +
          "mit Auffälligkeiten (Verbindungen, Widersprüche, Lücken, nächste Schritte) konkrete Hinweise, bis ca. 200 Wörter. " +
          'Recherchierte Aussagen mit <cite index="…">…</cite> direkt an der Aussage belegen.',
      },
      commit: {
        type: "string",
        description:
          "Sehr kurze Änderungsbeschreibung im Stil einer Git-Commit-Message. Leer lassen, wenn keine Änderung.",
      },
      ops: {
        type: "array",
        description:
          "Dokument-Operationen, werden in Reihenfolge angewendet. Leer, wenn nichts zu ändern ist. " +
          "Bei einer bloßen Frage IMMER leer – keine Aufräum- oder Struktur-Ops ohne inhaltlichen Anlass.",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["append_to_section", "replace_section", "delete_section", "rewrite"],
            },
            heading: {
              type: "string",
              description: 'Betroffener ##-Hauptabschnitt, z. B. "## Aufgaben". Entfällt bei rewrite.',
            },
            content: {
              type: "string",
              description:
                "Inhalt gemäß den Konventionen. Entfällt bei delete_section. " +
                'Aussagen aus der Websuche MIT <cite index="…">…</cite> markieren (wird zur Quellen-Fußnote).',
            },
            notebook: {
              type: "string",
              description:
                "Ziel-Notizbuch (exakter Name aus der Liste). Weglassen = aktives Notizbuch. " +
                "Nur setzen, wenn die Information thematisch eindeutig in ein anderes Notizbuch gehört.",
            },
          },
          required: ["type"],
        },
      },
    },
    required: ["reply", "ops"],
  },
};

// Client-seitiges Abruf-Tool für große Wissensdateien: Das Modell fordert
// gezielt Inhalte an, die App sucht im lokal gecachten Extrakt und setzt
// die Konversation mit dem Ergebnis fort (keine Serverkomponente nötig).
export const LOOKUP_TOOL = {
  name: "lookup_wissen",
  description:
    'Holt gezielt Inhalte aus einer großen Wissensdatei des AKTIVEN Notizbuchs (Dateien mit volltext="nein"). ' +
    "Nutze das Tool – auch mehrfach –, BEVOR du inhaltlich antwortest, wenn die Frage solche Inhalte braucht.",
  input_schema: {
    type: "object",
    properties: {
      datei: { type: "string", description: "Exakter Dateiname aus dem HINTERGRUNDWISSEN-Block" },
      suchbegriffe: {
        type: "string",
        description: "2–5 aussagekräftige Stichwörter (Leerzeichen-getrennt); Treffer-Seiten kommen mit Kontext zurück",
      },
      seiten: { type: "string", description: 'Alternativ ein Seitenbereich, z. B. "120-128" oder "42"' },
    },
    required: ["datei"],
  },
};

// Repariert häufige Fehler in Modell-JSON: ungeschützte Anführungszeichen
// innerhalb von Strings sowie rohe Zeilenumbrüche/Tabs.
function repairJsonString(s) {
  let out = "";
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (!inStr) {
      out += ch;
      if (ch === '"') inStr = true;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      if (i + 1 < s.length) { out += s[i + 1]; i++; }
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      const nx = s[j];
      if (nx === "," || nx === "}" || nx === "]" || nx === ":" || nx === undefined) {
        out += ch;
        inStr = false;
      } else {
        out += '\\"'; // ungeschütztes Anführungszeichen mitten im String
      }
      continue;
    }
    if (ch === "\n") { out += "\\n"; continue; }
    if (ch === "\r") { continue; }
    if (ch === "\t") { out += "\\t"; continue; }
    out += ch;
  }
  return out;
}

// Exportiert für Unit-Tests (riskanteste Heuristik der Datei).
export function parseLooseJson(raw) {
  if (!raw) return null;
  const clean = raw.replace(/```json|```/g, "").trim();
  const candidates = [clean];
  const s = clean.indexOf("{");
  const e = clean.lastIndexOf("}");
  if (s >= 0 && e > s) {
    const sliced = clean.slice(s, e + 1);
    candidates.push(sliced, repairJsonString(sliced));
  }
  for (const c of candidates) {
    try {
      const p = JSON.parse(c);
      if (p && typeof p === "object") return p;
    } catch (err) { /* nächsten Kandidaten probieren */ }
  }
  return null;
}

// Bei Websuche steht die inhaltliche Antwort meist in den Textblöcken VOR
// dem Tool-Aufruf (dort hängt die API echte Zitate mit URL+Titel an); das
// reply-Feld enthält dann nur die Bestätigung. Beides zur Chat-Nachricht
// kombinieren: API-Zitate werden als <cite index="…">-Marker hinter den
// jeweiligen Textblock kodiert, anschließend werden alle cite-Indizes auf
// eine kompakte Liste NUR der tatsächlich zitierten Quellen umnummeriert
// (klein zu speichern, und 1-basiert exakt auflösbar).
// Exportiert für Tests. data.content = akkumulierte Textblöcke aller
// Antwortsegmente; hits = Roh-Trefferliste, wird nicht verändert.
export function buildChatReply(data, hits, toolReply) {
  const sources = [...hits];
  const parts = [];
  for (const b of (data && data.content) || []) {
    if (b.type !== "text" || typeof b.text !== "string" || !b.text) continue;
    // Payload-Heuristik: Antwortet das Modell (fälschlich) mit dem Tool-JSON
    // als Text, ist das die Nutzlast für parseLooseJson – keine Antwortprosa.
    if (/^\s*(\{|```)/.test(b.text)) continue;
    let t = b.text;
    if (Array.isArray(b.citations) && b.citations.length) {
      const idxs = [];
      for (const c of b.citations) {
        if (!c || !c.url) continue;
        let i = sources.findIndex((s) => s.url === c.url);
        if (i < 0) { sources.push({ url: c.url, title: c.title || c.url }); i = sources.length - 1; }
        if (!idxs.includes(i + 1)) idxs.push(i + 1);
      }
      if (idxs.length) {
        // Marker vor dem abschließenden Weißraum einsetzen, damit die
        // Fußnote direkt am zitierten Text klebt (Blöcke enden teils mitten
        // im Satz – deshalb Blöcke unverändert aneinanderfügen).
        const cut = t.length - /\s*$/.exec(t)[0].length;
        t = t.slice(0, cut) + '<cite index="' + idxs.join(",") + '"></cite>' + t.slice(cut);
      }
    }
    parts.push(t);
  }
  const combined = parts.join("").trim();
  const tr = typeof toolReply === "string" ? toolReply.trim() : "";
  // Exakter Vergleich statt includes: eine kurze legitime Bestätigung darf
  // nicht unterdrückt werden, nur weil sie zufällig als Teilstring vorkommt.
  const reply = combined
    ? combined + (tr && combined !== tr ? "\n\n" + tr : "")
    : tr;

  // Indizes (auch modellgeschriebene wie "3-1") auf die kompakte Liste der
  // zitierten Quellen umschreiben; Unauflösbares wird zu index="" (die
  // Anzeige lässt dann nur den Text stehen).
  const cited = [];
  const remapped = reply.replace(/(<cite\s+index=")([^"]*)(")/gi, (m0, pre, attr, post) => {
    const mapped = [];
    for (const part of String(attr).split(",")) {
      const n = parseInt(part.split("-")[0], 10);
      const src = Number.isFinite(n) ? (sources[n - 1] || sources[n] || null) : null;
      if (!src) continue;
      let i = cited.findIndex((s) => s.url === src.url);
      if (i < 0) { cited.push({ url: src.url, title: src.title }); i = cited.length - 1; }
      if (!mapped.includes(String(i + 1))) mapped.push(String(i + 1));
    }
    return pre + mapped.join(",") + post;
  });
  return { reply: remapped, sources: cited };
}

// nbContext: { notebooks: [{ name, doc }], activeName }
// fileInfo (optional): { name, text|null } – Dateianhang dieses Turns;
// der Inhalt geht nur in DIESEN Aufruf, im Verlauf bleibt nur der Name.
export async function callClaude(apiKey, userText, nbContext, priorChat, modelId, img, imgId, fileInfo) {
  // cite-Marker aus dem Verlauf strippen: ihre Indizes sind auf die pro
  // Nachricht gespeicherte Quellenliste umnummeriert und für das Modell
  // ohne Bedeutung – es soll sie nicht nachahmen.
  const msgs = priorChat
    .filter((m) => !m.error && (m.text || m.imgId || m.fileName))
    .slice(-12)
    .map((m) => ({
      role: m.role,
      content:
        (m.imgId ? "[Bild " + m.imgId + "] " : "") +
        (m.fileName ? "[Datei „" + m.fileName + "“] " : "") +
        stripCiteTags(m.text || ""),
    }));

  const content = [];
  if (img && imgId) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mime,
        data: img.dataUrl.split(",")[1],
      },
    });
  }
  let text = userText || "";
  if (imgId) {
    text +=
      (text ? "\n\n" : "") +
      "[Angehängtes Bild mit der Referenz img:" + imgId +
      " – analysiere es und binde es gemäß den Bild-Konventionen ins Dokument ein.]";
  }
  if (fileInfo && fileInfo.name) {
    if (typeof fileInfo.text === "string" && fileInfo.text.trim()) {
      // Ausbruch verhindern (Dateiinhalte sind fremde Quellen) und deckeln
      let ft = fileInfo.text.replace(/<\/dateianhang/gi, "<\\/dateianhang");
      if (ft.length > FILE_ATTACH_CAP) {
        ft = ft.slice(0, FILE_ATTACH_CAP) + "\n\n[… gekürzt – Datei ist länger]";
      }
      text +=
        (text ? "\n\n" : "") +
        '<dateianhang name="' + String(fileInfo.name).replace(/"/g, "'") + '">\n' + ft + "\n</dateianhang>";
    } else {
      text +=
        (text ? "\n\n" : "") +
        "[Angehängte Datei „" + fileInfo.name + "“ – Inhalt konnte nicht als Text extrahiert werden; " +
        "die Datei wurde im Daten-Repo archiviert.]";
    }
  }
  content.push({ type: "text", text });
  msgs.push({ role: "user", content });

  // lookup_wissen anbieten, sobald der Prompt Index-Einträge enthält:
  // Einzeldatei über dem Datei-Deckel ODER Summe über dem Gesamt-Deckel
  // (dann verweist auch der Gesamt-Deckel-Eintrag auf das Tool).
  const activeKnowFiles = (nbContext.knowledge && nbContext.knowledge.activeFiles) || [];
  const totalKnowLen = activeKnowFiles.reduce(
    (s, f) => s + (f && typeof f.text === "string" ? f.text.length : 0), 0
  );
  const lookupEnabled =
    activeKnowFiles.some((f) => f && typeof f.text === "string" && f.text.length > KNOW_PER_FILE_CAP) ||
    totalKnowLen > KNOW_TOTAL_CAP;
  const runLookup = (input) => {
    const name = input && typeof input.datei === "string" ? input.datei.trim() : "";
    const f =
      activeKnowFiles.find((x) => x.name === name) ||
      activeKnowFiles.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!f) {
      return "Keine Wissensdatei namens „" + name + "“ im aktiven Notizbuch. Verfügbar: " +
        (activeKnowFiles.map((x) => x.name).join(", ") || "keine");
    }
    const res = lookupInExtract(
      f.text,
      { suchbegriffe: input && input.suchbegriffe, seiten: input && input.seiten },
      LOOKUP_RESULT_CAP
    );
    return res || "Keine Treffer – versuche andere Suchbegriffe oder fordere einen Seitenbereich an.";
  };

  // Modi: "search"  = Websuche + lookup_wissen + update_notebook, tool_choice auto
  //       "forced"  = nur update_notebook, erzwungen (ohne Recherche)
  //       "none"    = ganz ohne Tools (JSON aus Text, letzte Rettung)
  // Erzwungenes tool_choice verhindert Server-Tool-Aufrufe – deshalb "auto"
  // im Suchmodus, abgesichert über den Prompt und die Fallback-Kette.
  const postOnce = async (messages, mode) => {
    const body = {
      model: modelId,
      max_tokens: 4000,
      system: buildSystem(nbContext.notebooks, nbContext.activeName, nbContext.knowledge),
      messages,
    };
    if (mode === "search") {
      body.tools = [
        webSearchToolFor(modelId),
        ...(lookupEnabled ? [LOOKUP_TOOL] : []),
        NOTEBOOK_TOOL,
      ];
      body.tool_choice = { type: "auto" };
    } else if (mode === "forced") {
      body.tools = [NOTEBOOK_TOOL];
      body.tool_choice = { type: "tool", name: "update_notebook" };
    }
    let response;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error("Keine Verbindung zur Anthropic-API – bitte Netzwerk prüfen");
    }
    let data = null;
    try { data = await response.json(); } catch (e) { /* keine JSON-Antwort */ }
    if (!response.ok && (!data || !data.error)) {
      // z. B. HTML-Fehlerseite eines Proxys – nicht als Formatfehler tarnen
      throw new Error("Anthropic-API-Fehler " + response.status);
    }
    return data;
  };

  // Quellen (URL + Titel) aus den Websuche-Ergebnisblöcken einsammeln –
  // in Trefferreihenfolge und OHNE Dedup, damit die <cite index="D-…">-
  // Nummern des Modells positionsstabil auf die Treffer abgebildet werden
  // (dedupliziert wird erst bei der Fußnotenvergabe in citations.jsx).
  const sources = [];
  // Ob wirklich recherchiert wurde (auch bei 0 Treffern): nur dann werden
  // Textblöcke mit ins Chat-reply kombiniert – sonst bliebe eine belanglose
  // Preamble vor dem Tool-Aufruf nicht mehr wie bisher unsichtbar.
  let usedSearch = false;
  const collectSources = (d) => {
    for (const b of (d && d.content) || []) {
      if (b.type !== "web_search_tool_result") continue;
      usedSearch = true;
      if (!Array.isArray(b.content)) continue;
      for (const r of b.content) {
        if (r && r.type === "web_search_result" && r.url) {
          sources.push({ url: r.url, title: r.title || r.url });
        }
      }
    }
  };

  // Recherche-Prosa über ALLE Antwortsegmente einsammeln: pause_turn-
  // Fortsetzungen und der forced-Retry überschreiben data, die Textblöcke
  // früherer Segmente gingen sonst verloren. Nur im Suchmodus – in den
  // Fallback-Modi wäre Text die JSON-Nutzlast, keine Antwortprosa.
  const textBlocks = [];
  const collectText = (d) => {
    for (const b of (d && d.content) || []) {
      if (b.type === "text" && typeof b.text === "string" && b.text) textBlocks.push(b);
    }
  };

  const doPost = async (mode) => {
    let data = await postOnce(msgs, mode);
    collectSources(data);
    if (mode === "search") collectText(data);
    // Fortsetzungs-Schleife für zwei Fälle:
    // 1. pause_turn: Server-Tools (Websuche) unterbrechen – Inhalt anhängen
    //    und weiterlaufen lassen (max. 3 Fortsetzungen).
    // 2. lookup_wissen: Das Modell fordert Inhalte aus großen Wissensdateien
    //    an – die App beantwortet den Tool-Aufruf lokal und setzt fort
    //    (max. LOOKUP_MAX_ROUNDS Runden; ein vorhandener update_notebook-
    //    Aufruf beendet den Turn, dann kein Lookup mehr).
    let convo = msgs;
    let cont = 0;
    let lookups = 0;
    for (;;) {
      if (!data || data.error) break;
      const isPause = data.stop_reason === "pause_turn" && cont < 3;
      const lookupCalls = !isPause
        ? (data.content || []).filter((b) => b.type === "tool_use" && b.name === "lookup_wissen")
        : [];
      const hasFinal = (data.content || []).some(
        (b) => b.type === "tool_use" && b.name === "update_notebook"
      );
      const doLookup = mode === "search" && !hasFinal && lookupCalls.length > 0 && lookups < LOOKUP_MAX_ROUNDS;
      if (!isPause && !doLookup) break;
      // Aufeinanderfolgende assistant-Turns zusammenführen (Rollen müssen
      // alternieren; bei mehrfacher Pause entstünden sonst zwei in Folge).
      const prev = convo[convo.length - 1];
      convo = prev && prev.role === "assistant" && Array.isArray(prev.content)
        ? [...convo.slice(0, -1), { role: "assistant", content: [...prev.content, ...(data.content || [])] }]
        : [...convo, { role: "assistant", content: data.content }];
      if (doLookup) {
        convo = [...convo, {
          role: "user",
          content: lookupCalls.map((c) => ({
            type: "tool_result",
            tool_use_id: c.id,
            content: runLookup(c.input),
          })),
        }];
        lookups++;
      } else {
        cont++;
      }
      data = await postOnce(convo, mode);
      collectSources(data);
      if (mode === "search") collectText(data);
    }
    // convo mitliefern: endet der Turn ohne update_notebook (z. B. Lookup-
    // Budget erschöpft), kann die Forced-Nachfrage darauf aufsetzen, statt
    // die bereits geholten Inhalte zu verwerfen.
    return { data, convo };
  };

  let { data, convo: lastConvo } = await doPost("search");
  if (data && data.error && /web_search|tool/i.test(String(data.error.message || data.error.type || ""))) {
    // Websuche nicht verfügbar (Modell/Org): ohne Recherche, Tool erzwungen
    ({ data, convo: lastConvo } = await doPost("forced"));
  }
  if (data && data.error && /tool/i.test(String(data.error.message || data.error.type || ""))) {
    ({ data, convo: lastConvo } = await doPost("none"));
  }
  if (!data || data.error) {
    const type = data && data.error && data.error.type;
    if (type === "authentication_error") {
      throw new Error("Anthropic-API-Key ungültig – bitte in den Einstellungen prüfen");
    }
    throw new Error((data && data.error && data.error.message) || "API-Fehler");
  }

  const extractParsed = (d) => {
    // 1. Bevorzugt: strukturierter update_notebook-Aufruf
    const toolBlock = (d.content || []).find(
      (b) => b.type === "tool_use" && b.name === "update_notebook" &&
        b.input && typeof b.input === "object"
    );
    if (toolBlock) return toolBlock.input;
    // 2. Fallback: JSON aus einer Textantwort ziehen, inkl. Reparatur
    const raw = (d.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return parseLooseJson(raw);
  };

  let parsed = extractParsed(data);

  // tool_choice "auto" kann trotz Anweisung ohne update_notebook enden:
  // einmal mit erzwungenem Tool nachfassen. Bevorzugt auf der bisherigen
  // Konversation (bewahrt geholte lookup-Ergebnisse; deren letzter Eintrag
  // ist dann ein user-tool_result). Schlägt das fehl – etwa weil Server-
  // Tool-Blöcke in der History das deklarierte Tool verlangen –, klassisch
  // von vorn ohne Recherche.
  if ((!parsed || typeof parsed !== "object") && data.stop_reason !== "max_tokens") {
    let next = null;
    const tail = lastConvo[lastConvo.length - 1];
    if (lastConvo !== msgs && tail && tail.role === "user") {
      try {
        next = await postOnce(lastConvo, "forced");
        if (next && next.error) next = null;
      } catch (e) { next = null; }
    }
    if (next) data = next;
    else ({ data } = await doPost("forced"));
    if (!data || data.error) {
      throw new Error((data && data.error && data.error.message) || "API-Fehler");
    }
    parsed = extractParsed(data);
  }

  if (!parsed || typeof parsed !== "object") {
    if (data.stop_reason === "max_tokens") {
      throw new Error("Antwort wurde wegen Längenbegrenzung abgeschnitten – bitte die Änderung in kleineren Schritten anstoßen");
    }
    throw new Error("Antwort hatte ein ungültiges Format – bitte einfach noch einmal senden");
  }

  // Abgeschnittene Antworten nie aufs Dokument anwenden (Gefahr unvollständiger Rewrites)
  if (data.stop_reason === "max_tokens") {
    return {
      reply:
        (typeof parsed.reply === "string" && parsed.reply ? parsed.reply + " " : "") +
        "⚠ Die Antwort wurde wegen Längenbegrenzung abgeschnitten – ich habe sicherheitshalber nichts am Dokument geändert. Bitte stoße die Änderung in kleineren Schritten an.",
      ops: [],
      commit: null,
    };
  }

  // cite-Tags in Dokument-Inhalten werden zu Fußnoten-Links [0](url)
  // aufgelöst (Platzhalter-Nummer; die dokumentweite Durchnummerierung
  // passiert beim Schreiben). Ohne Recherche gibt es keine Quellen –
  // dann werden die Tags wie bisher gestrippt.
  const ops = (Array.isArray(parsed.ops) ? parsed.ops : []).map((op) =>
    op && typeof op === "object"
      ? { ...op, content: citeTagsToDocLinks(op.content, usedSearch ? sources : []) }
      : op
  );

  // Roh-reply übergeben (ohne "Notiert."-Default): der Default soll nicht
  // an eine vollständige Recherche-Antwort angehängt werden.
  const toolReply = typeof parsed.reply === "string" ? parsed.reply : "";
  const chat = usedSearch
    ? buildChatReply({ content: textBlocks }, sources, toolReply)
    : { reply: toolReply, sources: [] };
  // Recherchiert, aber nichts inline zitiert: die konsultierten Quellen
  // trotzdem anzeigen (dedupliziert, gedeckelt), statt sie zu verschweigen.
  if (usedSearch && !chat.sources.length && sources.length) {
    const seen = new Set();
    chat.sources = sources
      .filter((s) => !seen.has(s.url) && seen.add(s.url))
      .slice(0, 6);
  }
  return {
    reply: chat.reply || "Notiert.",
    ops,
    commit: typeof parsed.commit === "string" && parsed.commit.trim() ? parsed.commit.trim() : null,
    sources: chat.sources,
  };
}
