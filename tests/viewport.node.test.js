// Bewusst OHNE "@vitest-environment jsdom" - läuft in der Node-Standard-
// umgebung dieses Projekts (vitest.config.js: environment: "node"), in der
// es KEIN globales document gibt. tests/viewport.test.js selbst läuft
// komplett unter jsdom (dort ist document immer vorhanden) und kann diesen
// Rand deshalb nicht prüfen.
// Review-Fix (Runde "Nachbesserung", blau/optional): der Kommentar behauptete
// bisher zusätzlich "kein globales navigator" - das stimmt seit Node 21
// NICHT mehr (globales navigator, u. a. userAgent/platform, ist seitdem
// Teil der Node-Laufzeit; nachgeprüft mit `node --version` v24.16.0:
// `typeof navigator` ist "object", `typeof document` bleibt "undefined").
// Der zweite Test unten entfernt "navigator" deshalb EXPLIZIT per
// vi.stubGlobal(...), um den echten "gar kein navigator"-Rand (z. B. ältere
// Node-Versionen, SSR ohne Web-API-Polyfills) trotzdem abzudecken - ohne ihn
// bliebe der Zweig "typeof navigator === 'undefined'" in viewport.js
// ungetestet.
//
// v7.57 Review-Fix (Runde 5, blau/optional, DECISIONS #117): die frühere
// Signatur "applyIOSInputZoomGuard(doc = document, nav = navigator)" wertete
// die Default-Parameter VOR dem try-Block aus - ein Aufruf ganz ohne
// Argumente hätte hier (kein globales document) mit einem ReferenceError
// geworfen, entgegen dem dokumentierten "wirft nie"-Vertrag. Die
// Default-Auflösung steht jetzt selbst im try (siehe src/lib/viewport.js).
import { describe, it, expect, afterEach, vi } from "vitest";
import { applyIOSInputZoomGuard } from "../src/lib/viewport.js";

describe("applyIOSInputZoomGuard ohne globales document/navigator (Node-Umgebung, v7.57, DECISIONS #117)", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("Aufruf ganz ohne Argumente wirft NICHT, liefert false", () => {
    expect(() => applyIOSInputZoomGuard()).not.toThrow();
    expect(applyIOSInputZoomGuard()).toBe(false);
  });

  it("auch OHNE globales navigator (explizit entfernt): wirft NICHT, liefert false", () => {
    vi.stubGlobal("navigator", undefined);
    expect(typeof navigator).toBe("undefined");
    expect(() => applyIOSInputZoomGuard()).not.toThrow();
    expect(applyIOSInputZoomGuard()).toBe(false);
  });
});
