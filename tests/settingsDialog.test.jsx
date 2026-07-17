// SettingsDialog (v7.13, E2E-Finding 🟡 "Provider gehen beim Schließen per X
// verloren") – Node-Umgebung reicht (vitest.config.js Default): weder die
// getesteten reinen Helfer noch renderToStaticMarkup brauchen ein DOM.
// Bestehende Testkonvention (vitest.config.js-Kommentar: "App.jsx nur
// E2E") gilt sinngemäß auch für Komponenten – aber die eigentliche
// BUGFIX-Logik dieser Version (Liste korrekt mutieren, damit
// onProvidersChange sie sofort an App.jsx melden kann) steckt in reinen,
// aus der Komponente herausgezogenen Funktionen und ist dadurch OHNE
// Rendering/Interaktion direkt testbar (gleiches Muster wie DocEditor.jsx'
// autoFetchProviderFor/applyAutoFetchResult, v7.12).
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import SettingsDialog, {
  providerFormIsValid, buildProviderEntry, upsertProvider, removeProvider,
} from "../src/components/SettingsDialog.jsx";

const validForm = {
  id: null, type: "azure-devops", name: "DevOps", prefix: "https://dev.azure.com/",
  icon: "🔗", pat: "test-pat", email: "",
};

describe("providerFormIsValid", () => {
  it("akzeptiert ein vollständiges, gültiges Formular", () => {
    expect(providerFormIsValid(validForm)).toBe(true);
  });

  it("lehnt null (kein offenes Formular) ab", () => {
    expect(providerFormIsValid(null)).toBe(false);
  });

  it("lehnt einen leeren/nur-Whitespace-Namen ab", () => {
    expect(providerFormIsValid({ ...validForm, name: "   " })).toBe(false);
  });

  it("lehnt ein Präfix ohne http(s)-Schema ab", () => {
    expect(providerFormIsValid({ ...validForm, prefix: "ftp://dev.azure.com/" })).toBe(false);
  });

  // SICHERHEITS-FIX (Review-Finding 3, v7.9, siehe DECISIONS.md #56): ein
  // Präfix ohne echten Host (z. B. "https://" allein) matchte früher JEDE
  // http(s)-URL – die UX-Vorprüfung hier muss das konsequent ablehnen,
  // genau wie die eigentliche Durchsetzung in sanitizeLinkProviders.
  it("lehnt ein hostloses Präfix ('https://' allein) ab", () => {
    expect(providerFormIsValid({ ...validForm, prefix: "https://" })).toBe(false);
  });

  it("lehnt einen Host ohne Punkt ab (z. B. 'https://localhost/')", () => {
    expect(providerFormIsValid({ ...validForm, prefix: "https://localhost/" })).toBe(false);
  });

  it("gilt auch für custom-Provider (kein Sonderfall ohne Host-Pflicht)", () => {
    expect(providerFormIsValid({ ...validForm, type: "custom", prefix: "https://" })).toBe(false);
    expect(providerFormIsValid({ ...validForm, type: "custom", prefix: "https://intranet.example/" })).toBe(true);
  });
});

describe("buildProviderEntry", () => {
  it("vergibt einem NEUEN Eintrag (id:null) eine frische 'lp-'-id", () => {
    const entry = buildProviderEntry(validForm);
    expect(entry.id).toMatch(/^lp-/);
    expect(entry.id.length).toBeGreaterThan(3);
  });

  it("behält die bestehende id eines bearbeiteten Eintrags", () => {
    const entry = buildProviderEntry({ ...validForm, id: "lp-bestehend" });
    expect(entry.id).toBe("lp-bestehend");
  });

  it("trimmt Name und Präfix", () => {
    const entry = buildProviderEntry({ ...validForm, name: "  DevOps  ", prefix: "  https://dev.azure.com/  " });
    expect(entry.name).toBe("DevOps");
    expect(entry.prefix).toBe("https://dev.azure.com/");
  });

  it("übernimmt das (getrimmte) Icon nur bei type:custom, sonst leerer String", () => {
    const custom = buildProviderEntry({ ...validForm, type: "custom", icon: " 🏠 " });
    expect(custom.icon).toBe("🏠");
    const azure = buildProviderEntry({ ...validForm, type: "azure-devops", icon: "🏠" });
    expect(azure.icon).toBe("");
  });

  it("pat/email fallen auf '' zurück, wenn nicht gesetzt", () => {
    const entry = buildProviderEntry({ ...validForm, pat: undefined, email: undefined });
    expect(entry.pat).toBe("");
    expect(entry.email).toBe("");
  });
});

describe("upsertProvider", () => {
  const a = { id: "a", name: "A" };
  const b = { id: "b", name: "B" };

  it("hängt einen neuen Eintrag (unbekannte id) an", () => {
    expect(upsertProvider([a], b)).toEqual([a, b]);
  });

  it("ersetzt einen bestehenden Eintrag AN DERSELBEN Position (Bearbeiten-Fall)", () => {
    const updatedA = { id: "a", name: "A geändert" };
    expect(upsertProvider([a, b], updatedA)).toEqual([updatedA, b]);
  });

  it("mutiert die Eingabeliste nicht (neue Array-Referenz)", () => {
    const list = [a];
    const next = upsertProvider(list, b);
    expect(list).toEqual([a]); // unverändert
    expect(next).not.toBe(list);
  });
});

describe("removeProvider", () => {
  const a = { id: "a" };
  const b = { id: "b" };

  it("entfernt den Eintrag mit passender id, lässt andere unberührt", () => {
    expect(removeProvider([a, b], "a")).toEqual([b]);
  });

  it("eine unbekannte id lässt die Liste inhaltlich unverändert", () => {
    expect(removeProvider([a, b], "nicht-vorhanden")).toEqual([a, b]);
  });

  it("mutiert die Eingabeliste nicht", () => {
    const list = [a, b];
    removeProvider(list, "a");
    expect(list).toEqual([a, b]);
  });
});

// Statisches Rendering (renderToStaticMarkup, wie die Icon-Tests in
// tests/linkProviders.test.jsx) – prüft NUR die deklarative Sichtbarkeit
// des Hinweistexts, keine Interaktion (Klicks/Events feuern bei
// renderToStaticMarkup ohnehin nicht). Randfall aus dem Auftrag (Teil 2):
// im unverbundenen Zustand (hasSettings:false) müssen Provider-Änderungen
// weiterhin über "Speichern & Verbinden" laufen – der Hinweistext macht das
// sichtbar, statt den Nutzer stillschweigend im Unklaren zu lassen.
const noop = () => {};
const baseProps = {
  initial: null, model: "sonnet-5", onModelChange: noop, onSave: noop,
  onProvidersChange: noop, onLogout: noop, onClose: noop,
  connecting: false, error: null,
};

describe("SettingsDialog: Hinweistext 'wird erst mit Speichern & Verbinden übernommen'", () => {
  it("erscheint im UNVERBUNDENEN Zustand (hasSettings:false)", () => {
    const html = renderToStaticMarkup(<SettingsDialog {...baseProps} hasSettings={false} />);
    expect(html).toContain("Wird erst mit");
    expect(html).toContain("bestehende Verbindung");
  });

  it("erscheint NICHT im VERBUNDENEN Zustand (hasSettings:true) – Provider persistieren dort sofort", () => {
    const html = renderToStaticMarkup(<SettingsDialog {...baseProps} hasSettings={true} />);
    expect(html).not.toContain("Wird erst mit");
  });
});
