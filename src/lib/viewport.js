/* ------------------------------------------------------------------ */
/* Viewport-Helfer (v7.57, DECISIONS #117, Nutzerwunsch A'/A''):        */
/* iOS Safari zoomt beim Fokussieren eines Eingabefelds mit einer       */
/* Schriftgröße unter 16px automatisch in die Seite hinein - das Chat-  */
/* Eingabefeld ist seit v7.57 bewusst text-sm (14px, vorher text-base/   */
/* 16px), die Einstellungsfelder waren es bereits VORHER - der frühere   */
/* Schutz "getippter Text bleibt text-base (16px)" entfällt deshalb für  */
/* den Chat. Ersatz: maximum-scale=1 im viewport-Meta-Tag unterdrückt    */
/* GENAU diesen Auto-Zoom bei Fokus - Pinch-Zoom bleibt auf iOS ab       */
/* Version 10 trotzdem möglich, weil Safari maximum-scale dort für echte */
/* Nutzergesten (zwei Finger) ignoriert, nur den Auto-Zoom beim          */
/* Fokussieren respektiert es. Android/Desktop bekommen den Schutz       */
/* bewusst NICHT: dort gibt es den Auto-Zoom nicht, und maximum-scale    */
/* würde auf Android den Pinch-Zoom echt sperren (kein iOS-Sonderfall) - */
/* deshalb ist applyIOSInputZoomGuard() strikt an isIOSLike() gekoppelt. */
/* ------------------------------------------------------------------ */

// iOS-Erkennung: klassische iPhone/iPad/iPod-User-Agents ODER iPadOS im
// "Desktop-Modus" (Safari meldet dort seit iPadOS 13 einen macOS-artigen
// User-Agent - platform bleibt aber "MacIntel"; maxTouchPoints > 1 verrät
// dort trotzdem ein Touch-Gerät, ein echter Mac-Desktop hat 0 Touchpoints).
// Robust gegen fehlende/undefinierte/null/Nicht-String-Werte (ältere
// Browser ohne navigator.platform, Test-DOMs, SSR) - liefert dann bewusst
// false (der sichere Default: KEIN ungewollter Eingriff in den Viewport).
// Review-Fix (Runde 5, blau/optional): "nav || {}" statt eines
// Default-Parameters in der Destrukturierung ("= {}" greift NUR bei
// undefined, ein expliziter null-Aufruf hätte vorher trotzdem geworfen).
export function isIOSLike(nav) {
  const { userAgent, platform, maxTouchPoints } = nav || {};
  const ua = typeof userAgent === "string" ? userAgent : "";
  const plat = typeof platform === "string" ? platform : "";
  const touch = typeof maxTouchPoints === "number" && !Number.isNaN(maxTouchPoints) ? maxTouchPoints : 0;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  if (plat === "MacIntel" && touch > 1) return true;
  return false;
}

// Ergänzt "maximum-scale=1" an einen viewport-content-String bzw. setzt ein
// bereits vorhandenes maximum-scale=<x> auf 1. Übrige Einträge (z. B.
// width=device-width, initial-scale=1.0, viewport-fit=cover) bleiben in
// ihrer Reihenfolge erhalten. Idempotent (zweiter Aufruf ändert nichts
// mehr). NIEMALS user-scalable=no setzen - das würde Pinch-Zoom für
// Nutzer mit Sehbehinderung vollständig sperren (Barrierefreiheit,
// bewusster Unterschied zu maximum-scale, das echte Nutzergesten auf iOS
// ausdrücklich NICHT sperrt, siehe Kommentar oben).
export function withMaximumScale(content) {
  const raw = typeof content === "string" ? content : "";
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  let found = false;
  const next = parts.map((p) => {
    const eq = p.indexOf("=");
    const key = (eq === -1 ? p : p.slice(0, eq)).trim().toLowerCase();
    if (key === "maximum-scale") {
      found = true;
      return "maximum-scale=1";
    }
    return p;
  });
  if (!found) next.push("maximum-scale=1");
  return next.join(", ");
}

// Einmalig VOR dem ersten Render aufrufen (siehe src/main.jsx). Nur auf
// einem iOS-artigen Gerät (isIOSLike) UND wenn ein meta[name="viewport"]
// existiert wird dessen content ersetzt - sonst No-op. Wirft nie (auch
// nicht bei einem kaputten/unvollständigen doc/nav-Mock in Tests ODER
// wenn document/navigator global gar nicht existieren, z. B. Node ohne
// jsdom), damit ein Fehler hier niemals den App-Start verhindert.
// Review-Fix (Runde 5, blau/optional): "doc = document, nav = navigator"
// als Default-PARAMETER wurde VOR dem try-Block ausgewertet - ein Aufruf
// ohne Argumente in einer Umgebung ganz OHNE globales document/navigator
// hätte dadurch trotzdem geworfen (Vertragsbruch "wirft nie"). Die
// Default-Auflösung steht jetzt selbst im try.
export function applyIOSInputZoomGuard(doc, nav) {
  try {
    const d = doc !== undefined ? doc : (typeof document !== "undefined" ? document : null);
    const n = nav !== undefined ? nav : (typeof navigator !== "undefined" ? navigator : null);
    if (!isIOSLike(n)) return false;
    const meta = d && typeof d.querySelector === "function" ? d.querySelector('meta[name="viewport"]') : null;
    if (!meta) return false;
    meta.setAttribute("content", withMaximumScale(meta.getAttribute("content")));
    return true;
  } catch (e) {
    return false;
  }
}
