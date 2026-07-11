/* ------------------------------------------------------------------ */
/* Dokument-Operationen (Abschnitte auf ##-Ebene)                      */
/* 1:1 aus der Referenz-App (Artifact v3.1) übernommen.                */
/* ------------------------------------------------------------------ */

const HEAD_RE = /^##\s+/;
export const normHead = (h) => String(h || "").replace(/^#+\s*/, "").trim().toLowerCase();
export const dispHead = (h) => String(h || "").replace(/^#+\s*/, "").trim();

function findSection(lines, heading) {
  const t = normHead(heading);
  if (!t) return null;
  let s = -1;
  for (let i = 0; i < lines.length; i++) {
    if (HEAD_RE.test(lines[i]) && normHead(lines[i]) === t) { s = i; break; }
  }
  if (s === -1) return null;
  let e = lines.length;
  for (let j = s + 1; j < lines.length; j++) {
    if (HEAD_RE.test(lines[j])) { e = j; break; }
  }
  return [s, e];
}

function tidy(lines) {
  const out = [];
  let blank = 0;
  for (const l of lines) {
    if (l.trim() === "") { blank++; if (blank <= 1) out.push(""); }
    else { blank = 0; out.push(l); }
  }
  const res = [];
  for (let i = 0; i < out.length; i++) {
    if (/^##\s+/.test(out[i]) && res.length && res[res.length - 1].trim() !== "") res.push("");
    res.push(out[i]);
  }
  return res.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function padEnd(lines) {
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  lines.push("");
}

function applyOne(text, op) {
  if (!op || typeof op !== "object") return text;

  if (op.type === "rewrite") {
    return typeof op.content === "string" && op.content.trim()
      ? op.content.trim() + "\n"
      : text;
  }

  const disp = dispHead(op.heading);
  if (!disp) return text;
  const lines = text.split("\n");
  const b = findSection(lines, disp);
  const content =
    typeof op.content === "string" ? op.content.replace(/^\n+|\n+$/g, "") : "";

  if (op.type === "delete_section") {
    if (!b) return text;
    lines.splice(b[0], b[1] - b[0]);
    return tidy(lines);
  }

  if (op.type === "replace_section") {
    const block = ["## " + disp, "", ...(content ? content.split("\n") : []), ""];
    if (b) lines.splice(b[0], b[1] - b[0], ...block);
    else { padEnd(lines); lines.push(...block); }
    return tidy(lines);
  }

  if (op.type === "append_to_section") {
    if (!content) return text;
    if (!b) {
      padEnd(lines);
      lines.push("## " + disp, "", ...content.split("\n"), "");
      return tidy(lines);
    }
    let at = b[1];
    while (at > b[0] + 1 && lines[at - 1].trim() === "") at--;
    lines.splice(at, 0, ...content.split("\n"));
    return tidy(lines);
  }

  return text;
}

export function applyOps(docText, ops) {
  let text = docText;
  for (const op of (ops || []).slice(0, 20)) {
    try { text = applyOne(text, op); } catch (e) { /* Op überspringen */ }
  }
  return text;
}
