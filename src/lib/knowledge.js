/* ------------------------------------------------------------------ */
/* Hintergrundwissen: Text-Extraktion aus hochgeladenen Dateien        */
/*                                                                     */
/* Die Extraktion passiert EINMALIG beim Upload (client-seitig, lazy   */
/* geladene Bibliotheken) und wird als .extrakt.md neben dem Original  */
/* im Daten-Repo abgelegt. Prompts verwenden nur die Extraktion –      */
/* das Original pro Prompt mitzuschicken (z. B. als PDF-Block) würde   */
/* jede Nachricht massiv verteuern.                                    */
/* ------------------------------------------------------------------ */

export const KNOWLEDGE_EXTS = ["pdf", "md", "markdown", "txt", "csv", "xlsx", "xls", "docx"];

export const knowledgeDir = (nbId) => "wissen/" + nbId;

// Dateinamen für die Ablage im Repo entschärfen (Umlaute, Sonderzeichen).
export function safeFileName(name) {
  const dot = name.lastIndexOf(".");
  let base = (dot > 0 ? name.slice(0, dot) : name)
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|-+$/g, "")
    .slice(0, 80);
  // Nie "." / ".." / versteckte Dateien als Namensbestandteil erzeugen
  if (!base || /^\.+$/.test(base)) base = "datei";
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  return ext ? base + "." + ext : base;
}

export const extractPathFor = (originalPath) => originalPath + ".extrakt.md";
export const isExtractPath = (name) => /\.extrakt\.md$/i.test(name);

const extOf = (name) => {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : "";
};

/* --- Extraktoren (Bibliotheken werden erst bei Bedarf geladen) --- */

async function extractPdf(file) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const doc = await task.promise;
  const pages = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const text = tc.items.map((it) => it.str).join(" ").replace(/\s{3,}/g, "  ").trim();
      if (text) pages.push("## Seite " + p + "\n\n" + text);
    }
  } finally {
    // destroy() liegt am Loading-Task, nicht am Dokument-Proxy
    try { await task.destroy(); } catch (e) { /* Aufräumen ist best effort */ }
  }
  if (!pages.length) {
    throw new Error("PDF enthält keinen extrahierbaren Text (vermutlich nur Scans/Bilder)");
  }
  return pages.join("\n\n");
}

async function extractDocx(file) {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  const text = (result.value || "").trim();
  if (!text) throw new Error("Dokument enthält keinen extrahierbaren Text");
  return text;
}

async function extractXlsx(file) {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const parts = [];
  for (const name of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]).trim();
    if (csv) parts.push("## Tabellenblatt: " + name + "\n\n" + csv);
  }
  if (!parts.length) throw new Error("Arbeitsmappe enthält keine Daten");
  return parts.join("\n\n");
}

/* --- Öffentliche API --- */

// Liefert den extrahierten Text einer Datei (Markdown-artig).
export async function extractText(file) {
  const ext = extOf(file.name);
  if (["txt", "md", "markdown", "csv"].includes(ext)) {
    const text = (await file.text()).trim();
    if (!text) throw new Error("Datei ist leer");
    return text;
  }
  if (ext === "pdf") return extractPdf(file);
  if (ext === "docx") return extractDocx(file);
  if (ext === "xlsx" || ext === "xls") return extractXlsx(file);
  throw new Error(
    "Format ." + ext + " wird nicht unterstützt (möglich: " + KNOWLEDGE_EXTS.join(", ") + ")"
  );
}

/* --- Abruf auf Anfrage für große Extrakte (lookup_wissen) --- */

// PDF-Extrakte bestehen aus "## Seite N"-Blöcken; andere Formate werden als
// nummerierte Kunst-Blöcke von ~4k Zeichen behandelt, damit Suche und
// Seitenangaben einheitlich funktionieren.
export function splitPages(extract) {
  const text = String(extract || "");
  const parts = text.split(/\n\n(?=## Seite \d+\n)/);
  const withNums = parts
    .map((t) => {
      const m = /^## Seite (\d+)\n/.exec(t);
      return m ? { page: parseInt(m[1], 10), text: t } : null;
    })
    .filter(Boolean);
  if (withNums.length > 1) return withNums;
  const blocks = [];
  for (let i = 0; i * 4000 < text.length; i++) {
    blocks.push({ page: i + 1, text: "## Abschnitt " + (i + 1) + "\n\n" + text.slice(i * 4000, (i + 1) * 4000) });
  }
  return blocks.length ? blocks : [{ page: 1, text }];
}

// Gezielter Abruf: Seitenbereich ("120-128" bzw. "42") oder Stichwortsuche.
// Treffer-Seiten kommen mit ±1 Seite Kontext, in Dokumentreihenfolge,
// gedeckelt auf maxChars. null, wenn nichts gefunden wurde.
export function lookupInExtract(extract, { suchbegriffe, seiten } = {}, maxChars = 30000) {
  const pages = splitPages(extract);
  let selected = null;

  const range = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/.exec(String(seiten || ""));
  if (range) {
    const from = parseInt(range[1], 10);
    const to = range[2] ? parseInt(range[2], 10) : from;
    selected = pages.filter((p) => p.page >= from && p.page <= to);
  } else if (typeof suchbegriffe === "string" && suchbegriffe.trim()) {
    const terms = suchbegriffe.toLowerCase().split(/[\s,;]+/).filter((t) => t.length >= 3);
    if (!terms.length) return null;
    const hitIdx = new Set();
    pages.forEach((p, i) => {
      const lower = p.text.toLowerCase();
      if (terms.some((t) => lower.includes(t))) {
        hitIdx.add(i - 1); hitIdx.add(i); hitIdx.add(i + 1); // ±1 Seite Kontext
      }
    });
    selected = [...hitIdx].filter((i) => i >= 0 && i < pages.length).sort((a, b) => a - b).map((i) => pages[i]);
  }

  if (!selected || !selected.length) return null;
  const out = [];
  let used = 0;
  for (const p of selected) {
    if (used + p.text.length > maxChars) {
      out.push("[… weitere Treffer abgeschnitten – grenze die Suche ein oder fordere einen Seitenbereich an]");
      break;
    }
    out.push(p.text);
    used += p.text.length + 2;
  }
  return out.join("\n\n");
}

// Datei als Base64 lesen (für den Upload des Originals).
export const fileToBase64 = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] || "");
    r.onerror = () => rej(new Error("Datei konnte nicht gelesen werden"));
    r.readAsDataURL(file);
  });
