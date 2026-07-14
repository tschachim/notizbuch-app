/* ------------------------------------------------------------------ */
/* Chat-Archivierung                                                   */
/*                                                                     */
/* Der Chat-Verlauf wird laufend auf die letzten 80 Nachrichten        */
/* gekappt (state.json) – Älteres geht stillschweigend verloren. Der   */
/* Archiv-Knopf legt den aktuellen Verlauf als lesbares Markdown unter */
/* chats/ im Daten-Repo ab und leert den Chat anschließend.            */
/* ------------------------------------------------------------------ */

import { citeTagsToDocLinks, stripCiteTags } from "./citations.jsx";
import { renumberCitations } from "./markdown.jsx";

const p2 = (n) => String(n).padStart(2, "0");

// Basisname (ohne Ordner/Endung) eines Archivs zum Zeitpunkt d.
// Lokale Zeit, sortierbar: chat-2026-07-14-0932
export const archiveBaseName = (d) =>
  "chat-" + d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) +
  "-" + p2(d.getHours()) + p2(d.getMinutes());

const fmtStamp = (ts) =>
  new Date(ts).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

// Lokalen und Remote-Chat (state.json kann bis zu einem Poll-Intervall
// voraus sein, der lokale Stand bis zu einem Debounce) zu einem
// vollständigen Verlauf vereinen: Duplikate über (ts, Rolle, Text, …)
// erkennen, Ergebnis chronologisch. Nachrichten ohne ts (Begrüßung)
// bleiben außen vor.
export function mergeChats(local, remote) {
  const key = (m) =>
    m.ts + "|" + (m.role || "") + "|" + (m.text || "") + "|" +
    (m.imgId || "") + "|" + (m.fileName || "");
  const out = [];
  const seen = new Set();
  for (const list of [local, remote]) {
    for (const m of Array.isArray(list) ? list : []) {
      if (!m || !m.ts || seen.has(key(m))) continue;
      seen.add(key(m));
      out.push(m);
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

// Platzhalter für Quellen-Listen: sie werden erst NACH der archivweiten
// Umnummerierung eingesetzt, damit renumberCitations Listen-Links mit
// rein numerischem Titel (z. B. „[2024](url)“) nicht anfasst. Nullbytes
// können nicht aus Nachrichtentexten kommen (werden dort entfernt).
const SRC_TOKEN = (i) => "\u0000SRC" + i + "\u0000";
const SRC_TOKEN_RE = /\u0000SRC(\d+)\u0000/g;

// Eckige Klammern im Anzeigetitel escapen, damit der Markdown-Link
// nicht zerbricht.
const escTitle = (t) => String(t).replace(/([[\]])/g, "\\$1");

// Nullbytes dürfen die SRC-Platzhalter nicht imitieren – aus allen
// Feldern entfernen, die in den Archivtext gelangen.
const noNul = (s) => String(s).replace(/\u0000/g, "");

// Chat-Verlauf als Markdown für die Ablage im Daten-Repo.
//
// chat: Nachrichten wie im State ({ role, text, ts, imgId, fileName,
// sources, commit, info, error }); Einträge ohne ts (Begrüßung) werden
// übersprungen. opts.resolveImg liefert zu einer imgId den Repo-Pfad
// (z. B. "bilder/img-1.png") oder null; Links im Archiv sind relativ zu
// chats/, damit sie in der GitHub-Ansicht funktionieren. opts.now
// bestimmt den Zeitstempel der Überschrift (Default: jetzt).
// Nachrichtentexte bleiben bewusst Roh-Markdown (nutzereigene Inhalte,
// das Archiv wird nie in die App zurückgeladen).
export function chatToMarkdown(chat, opts = {}) {
  const resolveImg = opts.resolveImg || (() => null);
  const now = opts.now || new Date();
  const msgs = (Array.isArray(chat) ? chat : []).filter((m) => m && m.ts);

  const parts = [];
  const srcLists = [];
  parts.push("# Chat-Archiv vom " + fmtStamp(now.getTime()));
  parts.push("");
  parts.push(msgs.length + " Nachrichten · archiviert aus der Notizbuch-App");

  for (const m of msgs) {
    parts.push("");
    parts.push("---");
    parts.push("");

    if (m.info) {
      parts.push("> ℹ️ " + stripCiteTags(noNul(m.text || "")) + " _(" + fmtStamp(m.ts) + ")_");
      continue;
    }

    const who = m.role === "user" ? "Nutzer" : "Assistent";
    parts.push("**" + who + (m.error ? " · Fehler" : "") + "** · " + fmtStamp(m.ts));
    parts.push("");

    if (m.imgId) {
      const p = resolveImg(m.imgId);
      parts.push(p ? "![Bild](../" + p + ")" : "_[Bild – nicht im Daten-Repo abgelegt]_");
      parts.push("");
    }
    if (m.fileName) {
      parts.push("📎 Datei „" + noNul(m.fileName) + "“ (im Ordner dateien/ abgelegt)");
      parts.push("");
    }

    // cite-Marker der Websuche in Fußnoten-Links [0](url) überführen;
    // ohne Quellenliste werden sie restlos gestrippt.
    const raw = noNul(m.text || "");
    const sources = Array.isArray(m.sources) ? m.sources : [];
    const stripped = stripCiteTags(raw);
    const body = sources.length ? citeTagsToDocLinks(raw, sources) : stripped;
    if (body.trim()) parts.push(body.trim());

    // Recherchiert, aber nichts inline zitiert (kein Marker aufgelöst):
    // konsultierte Quellen wie im Chat trotzdem auflisten (nur http(s),
    // wie resolveSources).
    if (sources.length && body === stripped) {
      const listed = sources.filter((s) => s && /^https?:\/\//i.test(s.url));
      if (listed.length) {
        parts.push("");
        parts.push(SRC_TOKEN(srcLists.length));
        srcLists.push(listed);
      }
    }

    if (m.commit) {
      parts.push("");
      parts.push("> 💾 Ins Notizbuch übernommen: „" + noNul(m.commit) + "“");
    }
  }

  // Fußnoten archivweit durchnummerieren (gleiche URL = gleiche Nummer),
  // erst danach die Quellen-Listen einsetzen (siehe SRC_TOKEN).
  return renumberCitations(parts.join("\n")).replace(SRC_TOKEN_RE, (t, i) =>
    "Quellen:\n" +
    srcLists[+i].map((s) => "- [" + escTitle(s.title || s.url) + "](" + s.url + ")").join("\n")
  ) + "\n";
}
