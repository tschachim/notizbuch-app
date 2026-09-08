import { describe, it, expect } from "vitest";
import {
  UNKNOWN_META, resolveMetaForDisplay, applyMetaResult, metaAfterError, bumpMetaCount,
  isStaleResponse,
} from "../src/lib/meta.js";

// v7.52.2 (Review-Finding 1, E2E-Lauf v7.52 – siehe DECISIONS #110): der
// Tester beobachtete nach einem Notizbuch-Wechsel A→B→A kurzzeitig einen
// falschen (zu niedrigen) Versionszähler in der Kopfzeile/im Historie-
// Dialog – die Historien-LISTE war dabei stets korrekt. Der exakte Auslöser
// ließ sich nicht reproduzieren; diese Tests decken die DREI Wege ab, auf
// denen "meta" im Bestandscode einem anderen als dem aktiven Notizbuch
// gehören konnte (a: Race bei verspäteter Antwort, b/d: Cross-Notizbuch-
// Commit landet nur im Cache, c: ein Fehler löscht/verfälscht nie einen
// vorhandenen Cache-Wert).

describe("resolveMetaForDisplay", () => {
  it("liefert den gecachten Wert für ein bekanntes Notizbuch", () => {
    const cache = new Map([["a", { count: 34, lastTs: 1000 }]]);
    expect(resolveMetaForDisplay(cache, "a")).toEqual({ count: 34, lastTs: 1000 });
  });

  it("liefert den 'unbekannt'-Platzhalter (count:null), wenn das Notizbuch noch KEINEN Cache-Eintrag hat", () => {
    const cache = new Map([["a", { count: 34, lastTs: 1000 }]]);
    expect(resolveMetaForDisplay(cache, "b")).toEqual(UNKNOWN_META);
    expect(resolveMetaForDisplay(cache, "b").count).toBeNull();
  });

  it("verwechselt NIEMALS zwei Notizbücher: 'a' bleibt 'a', auch wenn 'b' im selben Cache steht", () => {
    const cache = new Map([
      ["a", { count: 46, lastTs: 5000 }],
      ["b", { count: 1, lastTs: 6000 }],
    ]);
    expect(resolveMetaForDisplay(cache, "a").count).toBe(46);
    expect(resolveMetaForDisplay(cache, "b").count).toBe(1);
  });

  it("funktioniert auch mit einem leeren/frischen Cache (frisch verbunden)", () => {
    expect(resolveMetaForDisplay(new Map(), "a")).toEqual(UNKNOWN_META);
  });
});

describe("applyMetaResult (Race-Guard, Finding 1a)", () => {
  it("eine VERSPÄTETE Antwort für das inzwischen VERLASSENE Notizbuch schreibt in den Cache, liefert aber KEIN displayMeta", () => {
    const cache = new Map();
    // Nutzer ist inzwischen zu "b" gewechselt (activeId "b"), aber die
    // Antwort für "a" (das ehemals aktive Notizbuch) trifft jetzt erst ein.
    const { displayMeta } = applyMetaResult(cache, "a", "b", { count: 34, lastTs: 1000 });
    expect(displayMeta).toBeNull(); // Anzeige (für "b") wird NICHT überschrieben
    expect(cache.get("a")).toEqual({ count: 34, lastTs: 1000 }); // Cache-Update passiert trotzdem
  });

  it("eine Antwort für das WEITERHIN aktive Notizbuch liefert displayMeta", () => {
    const cache = new Map();
    const { displayMeta } = applyMetaResult(cache, "a", "a", { count: 46, lastTs: 5000 });
    expect(displayMeta).toEqual({ count: 46, lastTs: 5000 });
    expect(cache.get("a")).toEqual({ count: 46, lastTs: 5000 });
  });

  it("Wechsel-Szenario A→B→A: die verspätete A-Antwort nach dem Rückwechsel überschreibt NICHT den frischen B-Zwischenstand, der Cache bleibt für BEIDE Bücher korrekt getrennt", () => {
    const cache = new Map();
    // 1) Abruf für A gestartet (noch nicht angekommen).
    // 2) Nutzer wechselt zu B, Abruf für B kommt SCHNELLER zurück.
    const forB = applyMetaResult(cache, "b", "b", { count: 1, lastTs: 2000 });
    expect(forB.displayMeta).toEqual({ count: 1, lastTs: 2000 });
    // 3) Nutzer wechselt zurück zu A, sofortige Cache-Anzeige (kein A-Eintrag
    //    vorhanden -> "unbekannt").
    expect(resolveMetaForDisplay(cache, "a")).toEqual(UNKNOWN_META);
    // 4) JETZT trifft die verspätete Antwort aus Schritt 1 ein - "a" ist
    //    wieder aktiv, darf also die Anzeige aktualisieren.
    const forA = applyMetaResult(cache, "a", "a", { count: 34, lastTs: 1000 });
    expect(forA.displayMeta).toEqual({ count: 34, lastTs: 1000 });
    expect(cache.get("a")).toEqual({ count: 34, lastTs: 1000 });
    expect(cache.get("b")).toEqual({ count: 1, lastTs: 2000 }); // unangetastet
  });

  it("überschreibt einen bereits vorhandenen Cache-Eintrag für dasselbe (weiterhin inaktive) Notizbuch trotzdem (Cache bleibt der aktuellste bekannte Stand)", () => {
    const cache = new Map([["a", { count: 1, lastTs: 100 }]]);
    const { displayMeta } = applyMetaResult(cache, "a", "b", { count: 2, lastTs: 200 });
    expect(displayMeta).toBeNull();
    expect(cache.get("a")).toEqual({ count: 2, lastTs: 200 });
  });
});

// v7.52.2 Review-Nachbesserung (Finding "e", DECISIONS #110): der optionale
// 5. Parameter "startedAt" ist der Bump-Schutz gegen einen bereits VOR einem
// lokalen bumpMetaCount()-Inkrement gestarteten (und deshalb inzwischen
// veralteten) refreshMeta-Abruf – ohne ihn konnte ein sofortiger zweiter
// Commit (z. B. Checkbox-Klick -> toggleTask -> commitDocNb) während ein
// älterer Abruf noch unterwegs war, sein eigenes frisches N+1 durch die
// zurückkommende, ältere Antwort wieder verlieren.
describe("applyMetaResult mit startedAt (Review-Nachbesserung, Bump-Schutz)", () => {
  it("startedAt VOR bumpedAt: das Abruf-Ergebnis ist veraltet und wird verworfen – der Cache behält den frischeren Bump-Stand", () => {
    const cache = new Map([["a", { count: 34, lastTs: 100, bumpedAt: 500 }]]);
    // Der Abruf für "a" begann bei ts=200 (VOR dem Bump bei ts=500) und
    // liefert jetzt den zu diesem früheren Zeitpunkt noch gültigen Stand 34.
    const { displayMeta } = applyMetaResult(cache, "a", "a", { count: 34, lastTs: 100 }, 200);
    expect(displayMeta).toBeNull();
    expect(cache.get("a")).toEqual({ count: 34, lastTs: 100, bumpedAt: 500 }); // unverändert, NICHT überschrieben
  });

  it("startedAt NACH bumpedAt: das Abruf-Ergebnis ist frischer als der Bump und wird übernommen", () => {
    const cache = new Map([["a", { count: 35, lastTs: 100, bumpedAt: 500 }]]);
    const { displayMeta } = applyMetaResult(cache, "a", "a", { count: 35, lastTs: 900 }, 700);
    expect(displayMeta).toEqual({ count: 35, lastTs: 900 });
    expect(cache.get("a")).toEqual({ count: 35, lastTs: 900 });
  });

  it("Bestandsfall {count:34} -> lokaler Bump auf 35 -> ein verspäteter Abruf mit dem alten Stand 34 wird verworfen", () => {
    const cache = new Map([["a", { count: 34, lastTs: 1000 }]]);
    const startedAt = 1500; // Abruf für "a" startet, noch mit dem alten Stand unterwegs
    const bumped = bumpMetaCount(cache, "a", 2000); // Zwischenzeitlich: sofortiger Commit erhöht lokal
    expect(bumped).toEqual({ count: 35, lastTs: 2000, bumpedAt: 2000 });
    const { displayMeta } = applyMetaResult(cache, "a", "a", { count: 34, lastTs: 1000 }, startedAt);
    expect(displayMeta).toBeNull();
    expect(cache.get("a")).toEqual({ count: 35, lastTs: 2000, bumpedAt: 2000 }); // Bump bleibt bestehen
  });

  it("ohne übergebenes startedAt (Aufrufer verzichtet darauf): verhält sich wie vor der Nachbesserung – übernimmt IMMER", () => {
    const cache = new Map([["a", { count: 34, lastTs: 100, bumpedAt: 99999 }]]);
    const { displayMeta } = applyMetaResult(cache, "a", "a", { count: 1, lastTs: 5 });
    expect(displayMeta).toEqual({ count: 1, lastTs: 5 });
    expect(cache.get("a")).toEqual({ count: 1, lastTs: 5 });
  });

  it("Grenzfall: startedAt exakt gleich bumpedAt gilt NICHT als veraltet (Vergleich ist '>', nicht '>=' – siehe Restrisiko in DECISIONS)", () => {
    const cache = new Map([["a", { count: 35, lastTs: 100, bumpedAt: 500 }]]);
    const { displayMeta } = applyMetaResult(cache, "a", "a", { count: 12, lastTs: 999 }, 500);
    expect(displayMeta).toEqual({ count: 12, lastTs: 999 }); // Abruf gewinnt trotz "Gleichstand"
  });
});

describe("isStaleResponse (Review-Nachbesserung, Finding 1(d) – Reconnect-Epoch-Guard)", () => {
  it("gleiche Epoche: die Antwort ist NICHT veraltet", () => {
    expect(isStaleResponse(3, 3)).toBe(false);
  });

  it("unterschiedliche Epoche (Reconnect zwischen Abruf-Start und -Ende): die Antwort IST veraltet", () => {
    expect(isStaleResponse(3, 4)).toBe(true);
  });

  it("mehrere Reconnects in Folge: nur ein Vergleich mit der AKTUELLEN Epoche gilt als frisch", () => {
    expect(isStaleResponse(1, 5)).toBe(true);
    expect(isStaleResponse(5, 5)).toBe(false);
  });
});

describe("metaAfterError (Finding 1c)", () => {
  it("inaktives Notizbuch: kein displayMeta, Cache bleibt unangetastet", () => {
    const cache = new Map([["a", { count: 5, lastTs: 100 }]]);
    expect(metaAfterError(cache, "a", "b")).toBeNull();
    expect(cache.get("a")).toEqual({ count: 5, lastTs: 100 }); // unverändert
  });

  it("aktives Notizbuch MIT bereits vorhandenem Cache-Wert: der alte Stand bleibt (kein Zurücksetzen auf 'unbekannt')", () => {
    const cache = new Map([["a", { count: 5, lastTs: 100 }]]);
    expect(metaAfterError(cache, "a", "a")).toBeNull(); // Aufrufer setzt NICHTS -> alter State bleibt sichtbar
    expect(cache.get("a")).toEqual({ count: 5, lastTs: 100 });
  });

  it("aktives Notizbuch OHNE jeden Cache-Wert (z. B. erster Abruf nach dem Verbinden schlägt fehl): liefert den 'unbekannt'-Platzhalter, damit der Zähler des VORHERIGEN Notizbuchs nicht ewig stehen bleibt", () => {
    const cache = new Map();
    expect(metaAfterError(cache, "a", "a")).toEqual(UNKNOWN_META);
    expect(cache.has("a")).toBe(false); // Fehler legt selbst KEINEN Cache-Eintrag an
  });

  it("ein Fehler löscht NIE einen bereits vorhandenen Eintrag für ein ANDERES Notizbuch", () => {
    const cache = new Map([["a", { count: 5, lastTs: 100 }], ["b", { count: 9, lastTs: 900 }]]);
    metaAfterError(cache, "b", "a"); // Fehler betrifft "b", "a" ist aktiv
    expect(cache.get("a")).toEqual({ count: 5, lastTs: 100 });
    expect(cache.get("b")).toEqual({ count: 9, lastTs: 900 });
  });
});

describe("bumpMetaCount (Finding 1b/1d, Inkrement nach commitDocNb)", () => {
  it("erhöht einen vorhandenen Zähler um 1, aktualisiert lastTs UND setzt bumpedAt (Bump-Schutz, siehe applyMetaResult)", () => {
    const cache = new Map([["a", { count: 5, lastTs: 100 }]]);
    const next = bumpMetaCount(cache, "a", 200);
    expect(next).toEqual({ count: 6, lastTs: 200, bumpedAt: 200 });
    expect(cache.get("a")).toEqual({ count: 6, lastTs: 200, bumpedAt: 200 });
  });

  // v7.52.2 Review-Nachbesserung (Finding "e", DECISIONS #110): die beiden
  // ursprünglichen Fälle "startet bei 1" bzw. "count:null wie 0" erfanden
  // eine Basis, die schlicht nicht bekannt war – ein Cross-Notizbuch-Commit
  // (z. B. über das "notebook"-Feld einer Op) auf ein in dieser Session nie
  // besuchtes Buch mit bereits 34 Versionen lieferte damit "0+1=1" statt
  // "unbekannt". Diese beiden Tests ersetzen die alten Erwartungen.
  it("OHNE Cache-Eintrag (z. B. Cross-Notizbuch-Commit auf ein nie besuchtes Buch): erfindet KEINE Basis, count bleibt null statt einer geratenen 1", () => {
    const cache = new Map();
    const next = bumpMetaCount(cache, "neu", 500);
    expect(next).toEqual({ count: null, lastTs: 500, bumpedAt: 500 });
    expect(cache.get("neu")).toEqual({ count: null, lastTs: 500, bumpedAt: 500 });
  });

  it("auf einem vorhandenen 'unbekannt'-Platzhalter (count:null): bleibt ebenfalls null statt einer geratenen 1 oder NaN", () => {
    const cache = new Map([["a", UNKNOWN_META]]);
    const next = bumpMetaCount(cache, "a", 300);
    expect(next).toEqual({ count: null, lastTs: 300, bumpedAt: 300 });
  });

  it("Inkrement auf ein INAKTIVES Notizbuch (Cross-Notizbuch-Commit, z. B. SHA-Konflikt-Reload eines anderen Buchs) landet NUR im Cache – der Aufrufer entscheidet separat, ob angezeigt wird", () => {
    const cache = new Map([["a", { count: 10, lastTs: 100 }], ["b", { count: 3, lastTs: 50 }]]);
    // "b" wird committet, aktiv ist aber weiterhin "a" - bumpMetaCount kennt
    // "activeId" gar nicht, das Gate liegt beim Aufrufer (App.jsx:
    // "if (nbId === activeNbRef.current) setMeta(bumped)").
    const next = bumpMetaCount(cache, "b", 400);
    expect(next).toEqual({ count: 4, lastTs: 400, bumpedAt: 400 });
    expect(cache.get("b")).toEqual({ count: 4, lastTs: 400, bumpedAt: 400 });
    expect(cache.get("a")).toEqual({ count: 10, lastTs: 100 }); // unangetastet
  });
});
