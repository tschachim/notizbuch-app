import { describe, it, expect } from "vitest";
import {
  mergeQuickNotes, mergeQuickNotesForNb, normalizeQuickNotesMap,
  parseQuickNotesCache, serializeQuickNotesCache,
} from "../src/lib/quicknotes.js";

// v7.57.1, DECISIONS #119 – E2E-Befund E2 (Datenverlust nach Reload): Basis
// des Merges ist immer ein NOTIZBUCH-Objekt { nbId: Notiz[] }. Für die
// meisten Szenarien reicht EIN Notizbuch ("nb"), das wird über
// mergeQuickNotesForNb() direkt geprüft.

function n(id, text, extra = {}) {
  return { id, text, x: 10, y: 10, w: 260, h: 200, ...extra };
}

describe("mergeQuickNotesForNb (3-Wege-Merge PRO Notiz)", () => {
  it("lokal editiert + remote == base: lokal gewinnt (E2/P1 – der Live-Befund)", () => {
    const base = [n("a", "")];
    const local = [n("a", "QA-Sync-Test")];
    const remote = [n("a", "")];
    expect(mergeQuickNotesForNb(base, local, remote)).toEqual([n("a", "QA-Sync-Test")]);
  });

  it("remote [] == base (aufgeräumt), lokal neu: lokal bleibt (P1b)", () => {
    const base = [];
    const local = [n("a", "QA-Sync-Test")];
    const remote = [];
    expect(mergeQuickNotesForNb(base, local, remote)).toEqual([n("a", "QA-Sync-Test")]);
  });

  it("lokal unverändert + remote editiert: remote gewinnt", () => {
    const base = [n("a", "alt")];
    const local = [n("a", "alt")];
    const remote = [n("a", "neu von B")];
    expect(mergeQuickNotesForNb(base, local, remote)).toEqual([n("a", "neu von B")]);
  });

  it("beide editiert (unterschiedlich): höheres 'u' gewinnt", () => {
    const base = [n("a", "alt", { u: 1000 })];
    const local = [n("a", "lokal", { u: 2000 })];
    const remote = [n("a", "remote", { u: 5000 })];
    expect(mergeQuickNotesForNb(base, local, remote)).toEqual([n("a", "remote", { u: 5000 })]);
  });

  it("beide editiert, Gleichstand bei 'u': lokal gewinnt", () => {
    const base = [n("a", "alt", { u: 1000 })];
    const local = [n("a", "lokal", { u: 3000 })];
    const remote = [n("a", "remote", { u: 3000 })];
    expect(mergeQuickNotesForNb(base, local, remote)).toEqual([n("a", "lokal", { u: 3000 })]);
  });

  it("lokal neu + remote neu (andere ID, anderes Gerät): beide bleiben (P6)", () => {
    const base = [];
    const local = [n("a", "von A")];
    const remote = [n("b", "von B")];
    const out = mergeQuickNotesForNb(base, local, remote);
    expect(out.map((x) => x.id).sort()).toEqual(["a", "b"]);
  });

  it("lokal gelöscht + remote unverändert: bleibt gelöscht (P8 – vorher reproduzierbarer Bug)", () => {
    const base = [n("a", "Alt")];
    const local = []; // lokal per X verworfen
    const remote = [n("a", "Alt")]; // Remote hat noch nicht mitbekommen
    expect(mergeQuickNotesForNb(base, local, remote)).toEqual([]);
  });

  it("remote gelöscht + lokal unverändert: gelöscht", () => {
    const base = [n("a", "Alt")];
    const local = [n("a", "Alt")];
    const remote = [];
    expect(mergeQuickNotesForNb(base, local, remote)).toEqual([]);
  });

  it("lokal editiert + remote gelöscht: die Bearbeitung bleibt (Edit schlägt Löschung)", () => {
    const base = [n("a", "Alt")];
    const local = [n("a", "Alt, jetzt ergänzt")];
    const remote = [];
    expect(mergeQuickNotesForNb(base, local, remote)).toEqual([n("a", "Alt, jetzt ergänzt")]);
  });

  it("remote editiert + lokal gelöscht: die Bearbeitung bleibt (Edit schlägt Löschung)", () => {
    const base = [n("a", "Alt")];
    const local = [];
    const remote = [n("a", "Alt, von B ergänzt")];
    expect(mergeQuickNotesForNb(base, local, remote)).toEqual([n("a", "Alt, von B ergänzt")]);
  });

  it("beide Seiten löschen dieselbe Notiz: bleibt weg", () => {
    const base = [n("a", "Alt")];
    expect(mergeQuickNotesForNb(base, [], [])).toEqual([]);
  });

  // v7.57.1-Nachbesserung (Review-Fund 🔴, DECISIONS #121): der REGELFALL
  // direkt nach einem Cache-Formatwechsel (v0/v1 → v2) ist NICHT die
  // ID-Kollision aus dem Test oben, sondern GENAU dieser hier – dieselbe ID
  // existiert auf BEIDEN Seiten mit unterschiedlichem Inhalt, weil dieses
  // Gerät die Notiz schon aus einer früheren Sitzung kennt und ein ANDERES
  // Gerät sie seither geändert hat. Die Erst-Fassung entschied hier per
  // Gleichstand-Regel (0 >= 0, weil alte Geräte "u" gar nicht stempelten)
  // IMMER lokal und überschrieb damit bei JEDER Migration eine fremde
  // Änderung (Probe M1 im Review).
  it("Basis unbekannt, GLEICHE ID auf beiden Seiten mit anderem Text, beide ohne 'u': remote gewinnt (Migrationsfall, DECISIONS #121)", () => {
    const local = [n("a", "Milch")];
    const remote = [n("a", "Milch, Brot")];
    expect(mergeQuickNotesForNb(undefined, local, remote)).toEqual([n("a", "Milch, Brot")]);
  });

  it("Basis unbekannt, GLEICHE ID, lokal mit BELEGTEM Zeitvorsprung (u gesetzt), remote ohne 'u': lokal gewinnt", () => {
    const local = [n("a", "Milch", { u: 2000 })];
    const remote = [n("a", "Milch, Brot")];
    expect(mergeQuickNotesForNb(undefined, local, remote)).toEqual([n("a", "Milch", { u: 2000 })]);
  });

  // Randfall-Hinweis (bewusst NICHT als eigener Test, siehe DECISIONS #121):
  // eine per-ID BEKANNTE, aber diese ID nicht enthaltende Basis (z. B. ein
  // Notizbuch-Array ohne die betroffene ID) ist auf mergeOneNote-Ebene NICHT
  // von "Basis komplett unbekannt" unterscheidbar (b.get(id) liefert in
  // beiden Fällen undefined) – dieselbe ID unabhängig auf BEIDEN Seiten mit
  // unterschiedlichem Inhalt entstehen zu lassen, ist wegen der zufälligen
  // ID-Vergabe (Date.now() + Zufallszeichen, siehe App.jsx#addQuickNote)
  // praktisch nur im Migrationsfall oder bei einer astronomisch seltenen
  // ID-Kollision denkbar – für beide ist "Remote gewinnt ohne belegten
  // Zeitvorsprung" die richtige Wahl (siehe Test oben).

  it("Basis unbekannt (null/fehlend): reine Vereinigung, KEINE Löschung", () => {
    // Simuliert den allerersten Merge nach einem Cache-Formatwechsel:
    // remote hat eine Notiz, die lokal (noch) fehlt, UND umgekehrt.
    const local = [n("a", "nur lokal")];
    const remote = [n("b", "nur remote")];
    const out = mergeQuickNotesForNb(undefined, local, remote);
    expect(out.map((x) => x.id).sort()).toEqual(["a", "b"]);
  });

  it("defekte Einträge (kein Array, Notiz ohne id) werden gefiltert", () => {
    const local = [n("a", "gut"), { text: "ohne id" }, null, "kein Objekt"];
    const out = mergeQuickNotesForNb(null, local, null);
    expect(out).toEqual([n("a", "gut")]);
  });

  it("Reihenfolge: Remote-Reihenfolge zuerst, lokale Neuanlagen hinten angehängt", () => {
    const base = [n("x", "x"), n("y", "y")];
    const local = [n("x", "x"), n("y", "y"), n("neu", "neu")];
    const remote = [n("y", "y"), n("x", "x")]; // Remote-Reihenfolge abweichend
    const out = mergeQuickNotesForNb(base, local, remote);
    expect(out.map((q) => q.id)).toEqual(["y", "x", "neu"]);
  });
});

describe("normalizeQuickNotesMap", () => {
  it("lässt eine wohlgeformte Struktur unverändert (inhaltlich)", () => {
    expect(normalizeQuickNotesMap({ nb1: [n("a", "x")] })).toEqual({ nb1: [n("a", "x")] });
  });

  it("verwirft Notizbücher, deren Wert kein Array ist", () => {
    expect(normalizeQuickNotesMap({ nb1: [n("a", "x")], nb2: "kaputt", nb3: null })).toEqual({ nb1: [n("a", "x")] });
  });

  it("verwirft einzelne Notizen ohne string-id sowie doppelte IDs (erste gewinnt)", () => {
    const out = normalizeQuickNotesMap({
      nb1: [n("a", "erste"), { text: "ohne id" }, n("a", "zweite mit gleicher id"), 42],
    });
    expect(out.nb1).toEqual([n("a", "erste")]);
  });

  it("null/undefined/Array/Primitive liefern {}", () => {
    expect(normalizeQuickNotesMap(null)).toEqual({});
    expect(normalizeQuickNotesMap(undefined)).toEqual({});
    expect(normalizeQuickNotesMap([1, 2])).toEqual({});
    expect(normalizeQuickNotesMap("x")).toEqual({});
  });
});

describe("mergeQuickNotes (map-Ebene, mehrere Notizbücher)", () => {
  it("remote === null: lokaler Stand bleibt UNVERÄNDERT (Migrationsfall)", () => {
    const local = { nb1: [n("a", "lokal")] };
    expect(mergeQuickNotes({ nb1: [n("a", "lokal")] }, local, null)).toEqual(local);
    expect(mergeQuickNotes(undefined, local, undefined)).toEqual(local);
  });

  it("base === null: Vereinigung ohne Löschungen über mehrere Notizbücher", () => {
    const local = { nb1: [n("a", "lokal")] };
    const remote = { nb1: [], nb2: [n("b", "remote")] };
    const out = mergeQuickNotes(null, local, remote);
    expect(out.nb1).toEqual([n("a", "lokal")]);
    expect(out.nb2).toEqual([n("b", "remote")]);
  });

  it("verarbeitet mehrere Notizbücher unabhängig voneinander", () => {
    const base = { nb1: [n("a", "alt")], nb2: [n("b", "alt")] };
    const local = { nb1: [n("a", "alt")], nb2: [n("b", "lokal editiert")] };
    const remote = { nb1: [n("a", "remote editiert")], nb2: [n("b", "alt")] };
    const out = mergeQuickNotes(base, local, remote);
    expect(out.nb1).toEqual([n("a", "remote editiert")]);
    expect(out.nb2).toEqual([n("b", "lokal editiert")]);
  });

  it("ist stabil gegenüber kaputten Eingaben (kein Crash, sinnvoller Fallback)", () => {
    expect(mergeQuickNotes("kaputt", "auch kaputt", { nb1: [n("a", "x")] })).toEqual({ nb1: [n("a", "x")] });
  });

  // v7.57.1-NACHBESSERUNG Runde 3 (Review-Fund 🔵, DECISIONS #122): Nebenbefund
  // "endlose Schreibschleife bei abweichender Notizbuch-Schlüsselreihenfolge"
  // (schon in v7.57, keine Regression – #119s neuer Merge führt über P6 aber
  // direkt in die auslösende Datenlage: zwei Geräte legen gleichzeitig eigene
  // neue Notizbücher an). App.jsx vergleicht den SERIALISIERTEN JSON-String
  // gegen den zuletzt gespeicherten Remote-Stand (`lastSavedState`) – weicht
  // NUR die Objekt-SCHLÜSSELREIHENFOLGE ab, ist der String trotzdem
  // unterschiedlich und ein (inhaltsloser) Write wird ausgelöst.
  it("Object.keys()-Reihenfolge des Ergebnisses folgt REMOTE zuerst, nicht Basis/lokal (Ping-Pong-Schutz)", () => {
    const base = { w: [], p: [n("p1", "p")], q: [n("q1", "q")] }; // Basis-Reihenfolge W,P,Q
    const local = { w: [], p: [n("p1", "p")], q: [n("q1", "q")] }; // lokale Reihenfolge W,P,Q (identisch zur Basis)
    const remote = { w: [], q: [n("q1", "q")], p: [n("p1", "p")] }; // Remote-Reihenfolge W,Q,P
    const out = mergeQuickNotes(base, local, remote);
    expect(Object.keys(out)).toEqual(["w", "q", "p"]);
  });

  it("verhindert die Ping-Pong-Schreibschleife: bei inhaltlich unverändertem Stand ist das Merge-Ergebnis JSON-IDENTISCH mit Remote, auch wenn Basis/lokal eine andere Schlüsselreihenfolge hatten", () => {
    const remote = { w: [], q: [n("q1", "q")], p: [n("p1", "p")] };
    const base = { w: [], p: [n("p1", "p")], q: [n("q1", "q")] }; // andere Reihenfolge als remote
    const local = { w: [], p: [n("p1", "p")], q: [n("q1", "q")] }; // == Basis, nichts lokal geändert
    const out = mergeQuickNotes(base, local, remote);
    // App.jsx#flushState vergleicht serializeState()-Strings – sind die
    // Schlüssel-Reihenfolgen gleich, ist auch der JSON-String gleich und es
    // wird KEIN weiterer PUT ausgelöst.
    expect(JSON.stringify(out)).toBe(JSON.stringify(remote));
  });

  // v7.57.1-NACHBESSERUNG Runde 4 (Review-Fund 🔵, DECISIONS #123): ein
  // Notizbuch, das auf BEIDEN Seiten (lokal UND remote) gelöscht wurde,
  // existiert nur noch in der Basis – das darf KEINEN Zombie-Schlüssel
  // ("p": []) im Ergebnis erzeugen (und damit auch keinen inhaltslosen
  // Extra-Commit auslösen).
  it("Notizbuch nur noch in der Basis (auf beiden Seiten gelöscht): KEIN Zombie-Schlüssel im Ergebnis", () => {
    const base = { w: [], p: [n("p1", "x")] };
    const local = { w: [] };
    const remote = { w: [] };
    expect(mergeQuickNotes(base, local, remote)).toEqual({ w: [] });
  });

  it("Notizbuch nur in der Basis, aber NUR lokal wieder angelegt: Schlüssel bleibt (kein falsches Verwerfen)", () => {
    const base = { w: [], p: [n("p1", "alt")] };
    const local = { w: [], p: [n("p2", "neu angelegt")] };
    const remote = { w: [] };
    const out = mergeQuickNotes(base, local, remote);
    expect(out.p).toEqual([n("p2", "neu angelegt")]);
  });
});

describe("parseQuickNotesCache (localStorage-Formatmigration)", () => {
  it("v2-Format: übernimmt notes UND base unverändert", () => {
    const raw = { v: 2, notes: { nb1: [n("a", "x")] }, base: { nb1: [n("a", "x")] } };
    expect(parseQuickNotesCache(raw)).toEqual({ notes: { nb1: [n("a", "x")] }, base: { nb1: [n("a", "x")] } });
  });

  it("v1-Format (flaches Objekt ohne Hülle): notes übernommen, Basis unbekannt ({})", () => {
    const raw = { nb1: [n("a", "x")] };
    expect(parseQuickNotesCache(raw)).toEqual({ notes: { nb1: [n("a", "x")] }, base: {} });
  });

  it("v0-Format (rohes Array): wird dem Root-Notizbuch zugeordnet, Basis unbekannt", () => {
    const raw = [n("a", "x")];
    expect(parseQuickNotesCache(raw, "wissensbasis")).toEqual({ notes: { wissensbasis: [n("a", "x")] }, base: {} });
  });

  it("null/undefined/kaputt liefert leere Struktur", () => {
    expect(parseQuickNotesCache(null)).toEqual({ notes: {}, base: {} });
    expect(parseQuickNotesCache(undefined)).toEqual({ notes: {}, base: {} });
    expect(parseQuickNotesCache("kaputter String")).toEqual({ notes: {}, base: {} });
  });

  it("v1-Notizbuch mit der Slug-ID 'v' kollidiert NICHT mit der v2-Erkennung (Array != Zahl 2)", () => {
    // Ein Notizbuch namens "V" hätte den Slug "v" -> raw.v ist dort ein
    // ARRAY, nie die Zahl 2 – siehe Kommentar in quicknotes.js.
    const raw = { v: [n("a", "Notiz im Notizbuch V")] };
    expect(parseQuickNotesCache(raw)).toEqual({ notes: { v: [n("a", "Notiz im Notizbuch V")] }, base: {} });
  });
});

describe("serializeQuickNotesCache", () => {
  it("verpackt notes+base als v2-Paar und normalisiert beide Seiten", () => {
    const out = serializeQuickNotesCache({ nb1: [n("a", "x")] }, { nb1: [n("a", "x")] });
    expect(out).toEqual({ v: 2, notes: { nb1: [n("a", "x")] }, base: { nb1: [n("a", "x")] } });
  });

  it("fehlende Basis wird zu {} (nicht undefined/null im Ergebnis)", () => {
    const out = serializeQuickNotesCache({ nb1: [n("a", "x")] }, null);
    expect(out.base).toEqual({});
  });

  it("Roundtrip mit parseQuickNotesCache liefert dieselbe Struktur zurück", () => {
    const notes = { nb1: [n("a", "x")] };
    const base = { nb1: [n("a", "x")] };
    const serialized = serializeQuickNotesCache(notes, base);
    expect(parseQuickNotesCache(serialized)).toEqual({ notes, base });
  });
});
