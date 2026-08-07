// @vitest-environment jsdom
//
// v7.43 (Nutzerwunsch "Passwortmanager soll die Zugangsdaten automatisch
// ausfüllen", siehe DECISIONS #87): SettingsDialog.jsx stellt die
// Zugangsdaten-Felder jetzt in ECHTEN <form>-Elementen mit sprechenden
// name/id/autocomplete-Attributen bereit, deren onSubmit die native
// Formular-Navigation IMMER verhindert. Diese Tests nageln GENAU diese
// Formular-SEMANTIK fest (Attribute, Trennung GitHub-PAT/API-Key/Provider-
// Zugangsdaten, kein Navigieren bei Submit) – NICHT ob ein konkreter
// Passwortmanager die Felder tatsächlich anbietet (das kann nur ein
// echter Browser mit installierter Erweiterung/eigenem Passwortspeicher
// beurteilen, siehe docs/TESTFAELLE.md für den zugehörigen E2E-Fall, den
// der tester-Subagent OHNE Eingabe echter Zugangsdaten abarbeitet).
//
// jsdom-Grenze (ehrlich, analog zum Kopfkommentar in
// docEditorToolbarFocus.test.jsx): jsdom implementiert NICHT die
// Browser-Konvenienz "Enter in einem Textfeld löst implizit ein
// 'submit'-Event auf dem umschließenden <form> aus" – ein Test, der
// stattdessen ein keydown("Enter") simuliert und danach prüft, ob
// navigiert wurde, wäre deshalb IMMER grün, unabhängig vom eigentlichen
// Verhalten. Stattdessen wird hier direkt geprüft, was in jsdom TATSÄCHLICH
// aussagekräftig ist: dass ein 'submit'-Event auf dem <form> (GENAU das,
// was ein Browser bei Enter ODER bei Klick auf den unsichtbaren
// Default-Button erzeugt) zuverlässig per preventDefault() abgefangen wird
// und dieselbe Verbinden-/Speichern-Logik wie der bestehende Button-Klick
// auslöst.
import { describe, it, expect, vi, afterEach } from "vitest";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import SettingsDialog from "../src/components/SettingsDialog.jsx";

let container = null;
let root = null;

function mount(props) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<SettingsDialog {...props} />);
  });
  return container;
}

afterEach(() => {
  if (root) {
    act(() => root.unmount());
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
});

// Setzt den Wert eines kontrollierten React-<input> über den NATIVEN Setter
// und feuert danach ein echtes 'input'-Event – Standard-Trick, um Reacts
// Value-Tracking zu umgehen (ein reines "el.value = x" wird von React NICHT
// als Änderung erkannt, weil React denselben Setter überschreibt). Kein
// @testing-library/react im Projekt (siehe package.json), daher der
// manuelle Weg – gleiche Kategorie Workaround wie die bereits bestehenden
// dispatchEvent-Helfer in tests/docEditorToolbarFocus.test.jsx/
// tests/markdown.test.jsx.
function typeInto(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function selectValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function submit(form) {
  const ev = new Event("submit", { bubbles: true, cancelable: true });
  act(() => { form.dispatchEvent(ev); });
  return ev;
}

const noop = () => {};
const baseProps = {
  initial: null, model: "sonnet-5", onModelChange: noop, onSave: noop,
  onProvidersChange: noop, onLogout: noop, onClose: noop,
  connecting: false, error: null, hasSettings: false,
};

describe("SettingsDialog: GitHub-Formular (settings-github-form) – Passwortmanager-Semantik", () => {
  it("ist ein echtes <form>, OHNE 'action', mit method='post' (Tiefenverteidigung gegen ein GET-Leck)", () => {
    const c = mount(baseProps);
    const form = c.querySelector("#settings-github-form");
    expect(form).toBeTruthy();
    expect(form.tagName).toBe("FORM");
    expect(form.getAttribute("action")).toBeNull();
    expect(form.getAttribute("method")).toBe("post");
  });

  // Beides Eigenschaften, auf denen die Korrektheit hier ruht und die ein
  // späteres Refactoring unbemerkt brechen könnte (Review-🔵 zu v7.43):
  // verschachtelte <form>s sind in HTML verboten (der Browser wirft das
  // innere weg), und läge "Speichern & Verbinden" INNERHALB eines Formulars,
  // löste ein Klick Submit UND onClick aus – doppelter Verbindungsversuch.
  it("die Formulare sind NICHT ineinander verschachtelt", () => {
    const c = mount(baseProps);
    expect(c.querySelector("#settings-github-form").querySelector("form")).toBeNull();
    expect(c.querySelector("#settings-anthropic-form").querySelector("form")).toBeNull();
  });

  it("'Speichern & Verbinden' liegt AUSSERHALB aller Formulare (kein Doppel-Auslösen)", () => {
    const c = mount(baseProps);
    const btn = Array.from(c.querySelectorAll("button")).find((b) => /Verbinden/.test(b.textContent || ""));
    expect(btn).toBeTruthy();
    expect(btn.closest("form")).toBeNull();
  });

  it("Owner-Feld: name='github-owner', autocomplete='username' (natürlicher Benutzername fürs PAT), KEIN type=password", () => {
    const c = mount(baseProps);
    const owner = c.querySelector("#settings-owner");
    expect(owner.getAttribute("name")).toBe("github-owner");
    expect(owner.getAttribute("autocomplete")).toBe("username");
    expect(owner.type).not.toBe("password");
  });

  it("Repo-Feld: eigener name, autocomplete='off' (kein Zugangsdatum, aber kein Autofill-Rauschen)", () => {
    const c = mount(baseProps);
    const repo = c.querySelector("#settings-repo");
    expect(repo.getAttribute("name")).toBe("github-repo");
    expect(repo.getAttribute("autocomplete")).toBe("off");
  });

  it("PAT-Feld: type='password' bleibt erhalten, name='github-pat', autocomplete='current-password'", () => {
    const c = mount(baseProps);
    const pat = c.querySelector("#settings-pat");
    expect(pat.type).toBe("password");
    expect(pat.getAttribute("name")).toBe("github-pat");
    expect(pat.getAttribute("autocomplete")).toBe("current-password");
  });

  it("alle drei Felder liegen INNERHALB desselben Formulars (ein Manager kann sie als EIN Login zuordnen)", () => {
    const c = mount(baseProps);
    const form = c.querySelector("#settings-github-form");
    expect(form.contains(c.querySelector("#settings-owner"))).toBe(true);
    expect(form.contains(c.querySelector("#settings-repo"))).toBe(true);
    expect(form.contains(c.querySelector("#settings-pat"))).toBe(true);
  });

  it("Submit (wie durch Enter ausgelöst) verhindert IMMER die native Navigation, auch bei unvollständigen Daten", () => {
    const onSave = vi.fn();
    const c = mount({ ...baseProps, onSave });
    const form = c.querySelector("#settings-github-form");
    const ev = submit(form);
    expect(ev.defaultPrevented).toBe(true);
    expect(onSave).not.toHaveBeenCalled(); // wie der disabled-Button: unvollständig -> No-op
  });

  it("Submit mit vollständigen Zugangsdaten ruft onSave mit den getrimmten Werten auf (dieselbe Logik wie der Button-Klick)", () => {
    const onSave = vi.fn();
    const c = mount({ ...baseProps, onSave });
    act(() => {
      typeInto(c.querySelector("#settings-owner"), " tschachim ");
      typeInto(c.querySelector("#settings-repo"), "notizbuch-data");
      typeInto(c.querySelector("#settings-pat"), "github_pat_x");
      typeInto(c.querySelector("#settings-api-key"), "sk-ant-x");
    });
    const ev = submit(c.querySelector("#settings-github-form"));
    expect(ev.defaultPrevented).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      owner: "tschachim", repo: "notizbuch-data", pat: "github_pat_x", apiKey: "sk-ant-x", linkProviders: [],
    });
  });
});

describe("SettingsDialog: Anthropic-Formular (settings-anthropic-form) – EIGENES <form>, getrennt vom GitHub-PAT", () => {
  it("ist ein eigenständiges <form>, NICHT identisch mit settings-github-form, enthält das PAT-Feld nicht", () => {
    const c = mount(baseProps);
    const githubForm = c.querySelector("#settings-github-form");
    const anthropicForm = c.querySelector("#settings-anthropic-form");
    expect(anthropicForm).toBeTruthy();
    expect(anthropicForm).not.toBe(githubForm);
    expect(anthropicForm.contains(c.querySelector("#settings-pat"))).toBe(false);
    expect(githubForm.contains(c.querySelector("#settings-api-key"))).toBe(false);
  });

  it("API-Key-Feld: type='password' bleibt erhalten, EIGENER name (nicht 'github-pat'), autocomplete='current-password'", () => {
    const c = mount(baseProps);
    const key = c.querySelector("#settings-api-key");
    expect(key.type).toBe("password");
    expect(key.getAttribute("name")).toBe("anthropic-api-key");
    expect(key.getAttribute("name")).not.toBe("github-pat");
    expect(key.getAttribute("autocomplete")).toBe("current-password");
  });

  it("hat ebenfalls kein 'action', method='post' – dieselbe Tiefenverteidigung wie das GitHub-Formular", () => {
    const c = mount(baseProps);
    const form = c.querySelector("#settings-anthropic-form");
    expect(form.getAttribute("action")).toBeNull();
    expect(form.getAttribute("method")).toBe("post");
  });

  it("Submit verhindert die native Navigation UND ruft dieselbe Verbinden-Logik wie das GitHub-Formular auf", () => {
    const onSave = vi.fn();
    const c = mount({ ...baseProps, onSave });
    act(() => {
      typeInto(c.querySelector("#settings-owner"), "tschachim");
      typeInto(c.querySelector("#settings-repo"), "notizbuch-data");
      typeInto(c.querySelector("#settings-pat"), "github_pat_x");
      typeInto(c.querySelector("#settings-api-key"), "sk-ant-x");
    });
    const ev = submit(c.querySelector("#settings-anthropic-form"));
    expect(ev.defaultPrevented).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe("SettingsDialog: Link-Provider-Formular – pro Provider-Typ unterscheidbare Feldnamen", () => {
  function openAddProviderForm(c) {
    const addBtn = Array.from(c.querySelectorAll("button")).find((b) => b.textContent.includes("Provider hinzufügen"));
    act(() => { addBtn.click(); });
  }

  it("öffnet als ECHTES <form> (nicht mehr nur <div>)", () => {
    const c = mount(baseProps);
    openAddProviderForm(c);
    const nameInput = c.querySelector('input[name="link-provider-name"]');
    expect(nameInput).toBeTruthy();
    expect(nameInput.closest("form")).toBeTruthy();
  });

  it("Azure DevOps (Default beim Öffnen): PAT-Feld mit EIGENEM Namen, verschieden vom GitHub-PAT", () => {
    const c = mount(baseProps);
    openAddProviderForm(c);
    const pat = c.querySelector('input[name="link-provider-azure-devops-pat"]');
    expect(pat).toBeTruthy();
    expect(pat.type).toBe("password");
    expect(pat.getAttribute("autocomplete")).toBe("current-password");
    expect(pat.getAttribute("name")).not.toBe("github-pat");
  });

  it("Confluence: E-Mail als Benutzername (autocomplete=username), API-Token als current-password, beide mit eigenen Namen", () => {
    const c = mount(baseProps);
    openAddProviderForm(c);
    act(() => selectValue(c.querySelector('select[name="link-provider-type"]'), "confluence"));
    const email = c.querySelector('input[name="link-provider-confluence-email"]');
    const token = c.querySelector('input[name="link-provider-confluence-pat"]');
    expect(email).toBeTruthy();
    expect(email.type).not.toBe("password");
    expect(email.getAttribute("autocomplete")).toBe("username");
    expect(token.type).toBe("password");
    expect(token.getAttribute("autocomplete")).toBe("current-password");
    expect(token.getAttribute("name")).not.toBe("link-provider-azure-devops-pat");
    expect(token.getAttribute("name")).not.toBe("github-pat");
  });

  it("'Abbrechen' ist explizit type='button' (verhindert versehentliches Absenden des jetzt echten <form>)", () => {
    const c = mount(baseProps);
    openAddProviderForm(c);
    const form = c.querySelector('input[name="link-provider-name"]').closest("form");
    const cancelBtn = Array.from(form.querySelectorAll("button")).find((b) => b.textContent.trim() === "Abbrechen");
    expect(cancelBtn.getAttribute("type")).toBe("button");
  });

  // Review-Fund zu v7.43: Dem Provider-Formular fehlte als EINZIGEM
  // method="post". Manche Passwortmanager rufen HTMLFormElement.submit()
  // direkt auf – das umgeht onSubmit/preventDefault, und ohne method würde
  // der Browser mit GET navigieren: Azure-PAT bzw. Confluence-Token stünden
  // dann in der URL.
  it("hat kein 'action' und method='post' – dieselbe Tiefenverteidigung wie die beiden Zugangsdaten-Formulare", () => {
    const c = mount(baseProps);
    openAddProviderForm(c);
    const form = c.querySelector('input[name="link-provider-name"]').closest("form");
    expect(form.getAttribute("action")).toBeNull();
    expect(form.getAttribute("method")).toBe("post");
  });

  it("'Hinzufügen' ist der ECHTE Submit-Button (type='submit')", () => {
    const c = mount(baseProps);
    openAddProviderForm(c);
    const form = c.querySelector('input[name="link-provider-name"]').closest("form");
    const addBtn = Array.from(form.querySelectorAll("button")).find((b) => b.textContent.trim() === "Hinzufügen");
    expect(addBtn.getAttribute("type")).toBe("submit");
  });

  it("Submit mit gültigen Daten ruft onProvidersChange mit dem neuen Eintrag auf, verhindert aber die Navigation", () => {
    const onProvidersChange = vi.fn();
    const c = mount({ ...baseProps, hasSettings: true, onProvidersChange });
    openAddProviderForm(c);
    act(() => {
      typeInto(c.querySelector('input[name="link-provider-name"]'), "Mein Board");
      typeInto(c.querySelector('input[name="link-provider-prefix"]'), "https://dev.azure.com/team/");
    });
    const form = c.querySelector('input[name="link-provider-name"]').closest("form");
    const ev = submit(form);
    expect(ev.defaultPrevented).toBe(true);
    expect(onProvidersChange).toHaveBeenCalledTimes(1);
    const [saved] = onProvidersChange.mock.calls[0];
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe("Mein Board");
    expect(saved[0].type).toBe("azure-devops");
  });

  it("Submit mit UNGÜLTIGEM Präfix (kein Host) bleibt ein No-op (kein onProvidersChange) – wie der disabled-Button", () => {
    const onProvidersChange = vi.fn();
    const c = mount({ ...baseProps, hasSettings: true, onProvidersChange });
    openAddProviderForm(c);
    act(() => {
      typeInto(c.querySelector('input[name="link-provider-name"]'), "Kaputt");
      typeInto(c.querySelector('input[name="link-provider-prefix"]'), "https://");
    });
    const form = c.querySelector('input[name="link-provider-name"]').closest("form");
    const ev = submit(form);
    expect(ev.defaultPrevented).toBe(true);
    expect(onProvidersChange).not.toHaveBeenCalled();
  });
});
