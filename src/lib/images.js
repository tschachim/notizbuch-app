/* ------------------------------------------------------------------ */
/* Bilder: Verkleinern & Einlesen                                      */
/* prepareImage/readAsDataURL 1:1 aus der Referenz-App übernommen.     */
/* ------------------------------------------------------------------ */

import { ghPutFile } from "./github.js";

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

// Direkt-Einfügen in den Editor (v7.41 Teil B, Code-Review vor v7.41-Commit,
// 🔵 Finding 10): "accept="image/*"" am Datei-Dialog UND der generische
// ".type.startsWith("image/")"-Filter bei Zwischenablage/Drag&Drop (siehe
// DocEditor.jsx#extractImageFiles) ließen JEDES Bildformat durch – auch
// SVG/AVIF/BMP, für die extForMime() oben KEINEN eigenen Zweig kennt und
// stillschweigend auf ".png" zurückfällt. Für ein Bild unter der 900-KB-
// Schwelle (prepareImage, oben) bleibt der ROHE Dateiinhalt unverändert
// (z. B. SVG-XML-Text), landet aber unter einem "bilder/<id>.png"-Pfad im
// Daten-Repo – ein späteres Lesen als "image/png" ergibt ein kaputtes Bild.
// ENTSCHEIDUNG (statt extForMime/mimeForName um weitere Formate zu
// erweitern): Direktes Einfügen bewusst auf GENAU die vier Formate
// beschränkt, die extForMime bereits korrekt rundtrip-sicher ablegt –
// SVG zusätzlich aus Sicherheitsgründen (kann Skripte/externe Referenzen
// enthalten) nicht pauschal freigegeben. EIN gemeinsames Array für
// Datei-Dialog ("accept"), Zwischenablage- UND Drag&Drop-Filter
// (DocEditor.jsx#extractImageFiles/das manuelle <input>-onChange), damit
// alle drei Einfüge-Wege dieselbe Grenze ziehen.
export const ACCEPTED_IMAGE_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export function isAcceptedImageType(type) {
  return ACCEPTED_IMAGE_MIME.includes(type);
}

export function dataUrlParts(dataUrl) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  return { mime: m[1], base64: m[2] };
}

// Bild direkt in den WYSIWYG-Editor einfügen (v7.41 Teil B, Nutzerwunsch
// "Bilder direkt in den Editor kopieren können"). Läuft bewusst denselben
// Weg wie ein per Chat angehängtes Bild (App.jsx#send: prepareImage ->
// dataUrlParts -> newImgId -> ghPutFile -> imgIndex/imgMap) – NUR die
// Reihenfolge ist zwingend anders: send() lädt das Bild erst NACH einer
// erfolgreichen Modellantwort hoch (keine Datei-Leiche bei einem
// abgelehnten/fehlgeschlagenen API-Call), während hier der Upload SOFORT
// passieren muss, weil der Editor eine dauerhafte "img:<id>"-Referenz
// braucht, um das Bild überhaupt anzeigen/speichern zu können. Bricht der
// Nutzer die Bearbeitung danach ab, bleibt die Datei als Waise im
// Daten-Repo liegen (kein Datenverlust, siehe DECISIONS – bewusst
// akzeptiert, wie im Auftrag vorgegeben).
//
// Als eigenständige, aus App.jsx herausgezogene Funktion (statt Closure
// in der Komponente) direkt mit echten Datenlagen testbar (Erfolg/Fehler/
// nicht verbunden), OHNE React/DOM – App.jsx reicht nur noch den
// aktuellen Verbindungs-/State-Zugriff durch (siehe addEditorImage dort).
// imgIndex wird ABSICHTLICH als das rohe Objekt (nicht der React-Ref
// selbst) übergeben und direkt mutiert – exakt dieselbe Semantik wie
// "imgIndex.current[imgId] = path" in App.jsx#send.
export async function uploadEditorImage(file, { connected, cfg, imgIndex, setImgMap } = {}) {
  if (!connected || !cfg) {
    throw new Error("Nicht verbunden – ein eingefügtes Bild kann nicht dauerhaft gespeichert werden.");
  }
  const p = await prepareImage(file);
  const parts = dataUrlParts(p.dataUrl);
  if (!parts) throw new Error("Bilddaten unlesbar");
  const id = newImgId();
  const path = "bilder/" + id + "." + extForMime(parts.mime);
  await ghPutFile(cfg, path, parts.base64, "Bild " + id + " hinzugefügt");
  // Erst NACH erfolgreichem Upload registrieren (kein halber Zustand bei
  // einem Fehler oben – der throw davor verlässt die Funktion, bevor
  // irgendetwas mutiert wird).
  imgIndex[id] = path;
  setImgMap((prev) => ({ ...prev, [id]: p.dataUrl }));
  return { id, dataUrl: p.dataUrl };
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
