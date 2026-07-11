/* ------------------------------------------------------------------ */
/* Anthropic-API                                                       */
/* System-Prompt, Tool-Schema und Parsing 1:1 aus der Referenz-App.    */
/* Angepasst gemäß Auftrag: eigener API-Key direkt aus dem Browser     */
/* (x-api-key + anthropic-dangerous-direct-browser-access) und         */
/* max_tokens 4000 statt 1000.                                         */
/* ------------------------------------------------------------------ */

export const MODELS = [
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6 · Standard" },
  { id: "claude-fable-5", label: "Fable 5 · maximale Tiefe" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5 · schnell" },
];

export function buildSystem(doc) {
  const heute = new Date().toLocaleDateString("de-DE", {
    weekday: "long", year: "numeric", month: "2-digit", day: "2-digit",
  });
  return (
    `Du bist der Assistent eines persönlichen Notizbuchs. Links läuft ein Chat, rechts pflegst du eine strukturierte Wissensbasis als Markdown-Dokument.

Heutiges Datum: ${heute}

AKTUELLES DOKUMENT:
<dokument>
${doc}
</dokument>

DEINE AUFGABEN:
1. Neue Informationen aus der Nutzernachricht sofort in das Dokument einarbeiten: Fakten, Ideen, Entscheidungen, Aufgaben, Termine, Bilder.
2. Die Struktur aktiv pflegen: passende Abschnitte anlegen, Inhalte umgruppieren, Dubletten zusammenführen, Veraltetes korrigieren. Der Inbox-Abschnitt ist nur ein Zwischenlager – räume ihn auf, sobald sich Themen abzeichnen.
3. Proaktiv sein: Weise in deiner Chat-Antwort kurz auf Verbindungen zu bestehenden Notizen, Widersprüche, Lücken oder sinnvolle nächste Schritte hin.
4. Fragen zum Bestand beantwortest du aus dem Dokument.

KONVENTIONEN IM DOKUMENT:
- Erste Zeile bleibt "# Wissensbasis".
- Hierarchie: "## Hauptthema" mit "### Unterthema" darunter. Ordne Einträge, wo sinnvoll, einem passenden ###-Unterthema zu; lege Unterthemen an, sobald ein Hauptthema mehr als eine Facette hat.
- Einträge als Stichpunkte ("- ..."), Datumsangaben im Format JJJJ-MM-TT wenn zeitlich relevant. Nummerierte Listen ("1. ...") sind erlaubt. Aufgaben als Checklisten-Einträge: "- [ ] offen" bzw. "- [x] erledigt".
- Vom Nutzer gesetzte Auszeichnungen unverändert erhalten: ~~durchgestrichen~~, <span style="color:…">…</span> (Schriftfarbe) und <mark data-color="…" style="background-color:…">…</mark> (Textmarker). Setze solche Farb-Auszeichnungen nicht selbst ein, außer der Nutzer bittet ausdrücklich darum.
- Kompakt und sachlich, keine Floskeln im Dokument.

BILDER:
- Enthält die Nutzernachricht ein Bild, steht dort dessen Referenz (z. B. img:ab12cd). Analysiere das Bild sorgfältig.
- Binde es an passender Stelle ins Dokument ein, exakt in diesem Format auf zwei eigenen Zeilen:
![Prägnanter Titel](img:ab12cd)
*Bildbeschreibung: 1–3 Sätze mit dem Wesentlichen. Bei Screenshots: welche Anwendung/Ansicht, welche Werte, Meldungen oder Fehler zu sehen sind.*
- Verwende ausschließlich die mitgelieferte Bild-ID, erfinde niemals eigene. Entferne Bildreferenzen nicht ohne Aufforderung.

ANTWORTFORMAT:
- Antworte IMMER über das Tool "update_notebook" – niemals mit freiem Text.
- reply: Chat-Antwort auf Deutsch, kurz (Bestätigung + proaktive Hinweise, max. ca. 100 Wörter).
- commit: sehr kurze Änderungsbeschreibung im Stil einer Git-Commit-Message; leer lassen, wenn keine Änderung.
- Verwende im Dokumenttext typografische Anführungszeichen („…“) statt gerader Anführungszeichen (").

Erlaubte ops (werden in Reihenfolge angewendet, beziehen sich immer auf ##-Hauptabschnitte; ###-Unterthemen gehören in den content):
- {"type":"append_to_section","heading":"## Abschnitt","content":"- Stichpunkt"}  → Abschnitt wird angelegt, falls er fehlt
- {"type":"replace_section","heading":"## Abschnitt","content":"kompletter neuer Abschnittsinhalt OHNE die ##-Überschriftszeile, inkl. aller ###-Unterthemen"}
- {"type":"delete_section","heading":"## Abschnitt"}
- {"type":"rewrite","content":"komplettes neues Dokument"}  → nur für größere Umstrukturierungen

Enthält die Nachricht nichts Speicherwürdiges (reine Frage, Smalltalk), gib "ops":[] und "commit":null zurück.`
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
          "Chat-Antwort auf Deutsch, kurz: Bestätigung plus proaktive Hinweise, max. ca. 100 Wörter.",
      },
      commit: {
        type: "string",
        description:
          "Sehr kurze Änderungsbeschreibung im Stil einer Git-Commit-Message. Leer lassen, wenn keine Änderung.",
      },
      ops: {
        type: "array",
        description: "Dokument-Operationen, werden in Reihenfolge angewendet. Leer, wenn nichts zu ändern ist.",
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
              description: "Inhalt gemäß den Konventionen. Entfällt bei delete_section.",
            },
          },
          required: ["type"],
        },
      },
    },
    required: ["reply", "ops"],
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

function parseLooseJson(raw) {
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

export async function callClaude(apiKey, userText, doc, priorChat, modelId, img, imgId) {
  const msgs = priorChat
    .filter((m) => !m.error && (m.text || m.imgId))
    .slice(-12)
    .map((m) => ({
      role: m.role,
      content: (m.imgId ? "[Bild " + m.imgId + "] " : "") + (m.text || ""),
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
  content.push({ type: "text", text });
  msgs.push({ role: "user", content });

  const doPost = async (withTools) => {
    const body = {
      model: modelId,
      max_tokens: 4000,
      system: buildSystem(doc),
      messages: msgs,
    };
    if (withTools) {
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

  let data = await doPost(true);
  if (data && data.error && /tool/i.test(String(data.error.message || data.error.type || ""))) {
    // Falls die Umgebung keine eigenen Tools zulässt: einmal ohne Tools wiederholen
    data = await doPost(false);
  }
  if (!data || data.error) {
    const type = data && data.error && data.error.type;
    if (type === "authentication_error") {
      throw new Error("Anthropic-API-Key ungültig – bitte in den Einstellungen prüfen");
    }
    throw new Error((data && data.error && data.error.message) || "API-Fehler");
  }

  // 1. Bevorzugt: strukturierter Tool-Aufruf – Eingabe kommt bereits als Objekt an
  const toolBlock = (data.content || []).find(
    (b) => b.type === "tool_use" && b.input && typeof b.input === "object"
  );
  let parsed = toolBlock ? toolBlock.input : null;

  // 2. Fallback: JSON aus einer Textantwort ziehen, inkl. Reparatur typischer Fehler
  if (!parsed) {
    const raw = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    parsed = parseLooseJson(raw);
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

  return {
    reply: typeof parsed.reply === "string" && parsed.reply ? parsed.reply : "Notiert.",
    ops: Array.isArray(parsed.ops) ? parsed.ops : [],
    commit: typeof parsed.commit === "string" && parsed.commit.trim() ? parsed.commit.trim() : null,
  };
}
