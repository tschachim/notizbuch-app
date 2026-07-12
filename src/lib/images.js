/* ------------------------------------------------------------------ */
/* Bilder: Verkleinern & Einlesen                                      */
/* prepareImage/readAsDataURL 1:1 aus der Referenz-App übernommen.     */
/* ------------------------------------------------------------------ */

export const readAsDataURL = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("Bild konnte nicht gelesen werden"));
    r.readAsDataURL(file);
  });

export async function prepareImage(file) {
  const orig = await readAsDataURL(file);
  const mime = file.type && file.type.startsWith("image/") ? file.type : "image/png";
  if (orig.length <= 900000) return { dataUrl: orig, mime };

  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("Bildformat nicht unterstützt"));
    i.src = orig;
  });
  const maxDim = 1600;
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = canvas.toDataURL("image/jpeg", 0.85);
  if (out.length > 4500000) throw new Error("Bild ist auch verkleinert zu groß");
  return { dataUrl: out, mime: "image/jpeg" };
}

export const newImgId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* --- Zusätze für die Ablage als Datei im Daten-Repo --- */

export function extForMime(mime) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "png";
}

export function mimeForName(name) {
  if (/\.(jpg|jpeg)$/i.test(name)) return "image/jpeg";
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.webp$/i.test(name)) return "image/webp";
  if (/\.gif$/i.test(name)) return "image/gif";
  return "image/png";
}

export function dataUrlParts(dataUrl) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  return { mime: m[1], base64: m[2] };
}

export const blobToDataURL = (blob) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("Bild konnte nicht gelesen werden"));
    r.readAsDataURL(blob);
  });

/* --- „Smart Icon“ für Notizbücher --- */
// Beliebiges Bild quadratisch aufbereiten: fast-quadratische Motive werden
// mittig beschnitten (möglichst ohne Veränderung), stark längliche
// (Seitenverhältnis > 2) transparent eingepasst – ein Zuschnitt ließe dort
// vom Motiv nichts übrig. Ergebnis: 128-px-PNG.
export async function makeNotebookIcon(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Bildformat nicht unterstützt"));
      i.src = url;
    });
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) throw new Error("Bild konnte nicht gelesen werden");
    const S = 128;
    const canvas = document.createElement("canvas");
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    if (Math.max(w, h) / Math.min(w, h) <= 2) {
      const side = Math.min(w, h);
      ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, S, S);
    } else {
      const scale = S / Math.max(w, h);
      ctx.drawImage(img, (S - w * scale) / 2, (S - h * scale) / 2, w * scale, h * scale);
    }
    const dataUrl = canvas.toDataURL("image/png");
    return { dataUrl, base64: dataUrl.split(",")[1] };
  } finally {
    URL.revokeObjectURL(url);
  }
}
