import { useState } from "react";
import { Settings, X, Loader2, LogOut, Check, Link2, Plus, Pencil, Trash2, Sparkles } from "lucide-react";
import { MODELS } from "../lib/anthropic.js";
import { PROVIDER_TYPE_INFO, ProviderIcon, hostOf } from "../lib/linkProviders.jsx";
import { MEMORY_SOFT_LIMIT } from "../lib/memory.js";
import {
  AUTOCORRECT_CATEGORIES, isCategoryEnabled, sanitizeAutocorrectConfig,
  validateCustomTrigger, validateCustomReplacement,
} from "../lib/autocorrect.js";

// Neuer, leerer Provider-Formularzustand für den gewählten Typ (v7.9,
// Nutzerwunsch "Link-Provider konfigurierbar"). id bleibt null, solange kein
// bestehender Eintrag bearbeitet wird (saveProviderForm unten vergibt dann
// eine neue).
const emptyProviderForm = (type) => ({
  id: null,
  type,
  name: PROVIDER_TYPE_INFO[type].defaultName,
  prefix: PROVIDER_TYPE_INFO[type].defaultPrefix,
  icon: "🔗",
  pat: "",
  email: "",
});

/* ---------------- Reine Helfer (v7.13, direkt testbar ohne Rendering) ---------------- */
// Aus der Komponente herausgezogen: bestehende Testkonvention laut
// vitest.config.js ("App.jsx nur E2E") gilt auch für Komponenten – aber die
// eigentliche BUGFIX-Logik dieser Version (E2E-Finding 🟡 "Provider gehen
// beim Schließen per X verloren") steckt genau hier (Liste korrekt mutieren,
// damit onProvidersChange/App.jsx sie sofort persistieren kann) und ist
// dadurch OHNE Rendering/Interaktion direkt unit-testbar, siehe
// tests/settingsDialog.test.jsx. Gleiches Muster wie die aus DocEditor.jsx
// herausgezogenen Helfer (autoFetchProviderFor/applyAutoFetchResult, v7.12).

// Formularvalidierung – SICHERHEITS-FIX (Review-Finding 3, v7.9): ein
// Präfix ohne echten Host (z. B. das frühere Confluence-Default "https://"
// allein) matchte jede http(s)-URL und hätte Zugangsdaten an jeden Host
// geschickt (Finding S2, siehe DECISIONS.md #56). Verlangt deshalb für
// JEDEN Provider-Typ (auch custom – ein Präfix ohne Host ist nie legitim)
// einen per new URL() auflösbaren Host mit mindestens einem Punkt (hostOf,
// dieselbe Funktion wie die eigentliche Durchsetzung in
// sanitizeLinkProviders/lib/linkProviders.jsx – diese Prüfung hier ist nur
// die UX-Vorprüfung, die spätere Sanitisierung bleibt der echte
// Sicherheits-Gatekeeper).
export function providerFormIsValid(providerForm) {
  if (!providerForm || !providerForm.name.trim()) return false;
  const prefix = providerForm.prefix.trim();
  if (!/^https?:\/\//i.test(prefix)) return false;
  const host = hostOf(prefix);
  return !!host && host.includes(".");
}

// Baut den zu speichernden Provider-Eintrag aus dem (bereits validierten)
// Formularzustand – vergibt bei einem NEUEN Eintrag (providerForm.id ist
// null) eine frische id, ein bearbeiteter Eintrag behält seine bestehende.
export function buildProviderEntry(providerForm) {
  return {
    id: providerForm.id || ("lp-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
    type: providerForm.type,
    name: providerForm.name.trim(),
    prefix: providerForm.prefix.trim(),
    icon: providerForm.type === "custom" ? (providerForm.icon || "🔗").trim() : "",
    pat: providerForm.pat || "",
    email: providerForm.email || "",
  };
}

// Fügt einen Eintrag ein (unbekannte id) oder ersetzt ihn (bestehende id,
// Bearbeiten-Fall) – reine Funktion, mutiert `list` nicht (neue Array-
// Referenz, damit React-States/onProvidersChange sauber darauf reagieren).
export function upsertProvider(list, entry) {
  const idx = list.findIndex((p) => p.id === entry.id);
  return idx === -1 ? [...list, entry] : list.map((p, i) => (i === idx ? entry : p));
}

export function removeProvider(list, id) {
  return list.filter((p) => p.id !== id);
}

/* Settings-Dialog: erscheint beim Erststart und über das Zahnrad.
   Zugangsdaten trägt ausschließlich der Nutzer hier ein; sie landen
   nur im localStorage dieses Geräts, nie in einem Repo. */
export default function SettingsDialog({
  initial, model, onModelChange, onSave, onProvidersChange = () => {}, onLogout, onClose,
  connecting, error, hasSettings, memory = "", onMemorySave = () => {},
  autocorrect, onAutocorrectChange = () => {},
}) {
  const [owner, setOwner] = useState((initial && initial.owner) || "");
  const [repo, setRepo] = useState((initial && initial.repo) || "notizbuch-data");
  const [pat, setPat] = useState((initial && initial.pat) || "");
  const [apiKey, setApiKey] = useState((initial && initial.apiKey) || "");
  // Link-Provider (v7.9): eigener, von owner/repo/pat/apiKey UNABHÄNGIGER
  // Zustand – Provider sind optional, die bestehende Pflichtfeld-Logik
  // (siehe "complete" unten) bleibt unberührt.
  const [linkProviders, setLinkProvidersState] = useState(
    () => (initial && Array.isArray(initial.linkProviders) ? initial.linkProviders : [])
  );
  // Formular für "Provider hinzufügen"/Bearbeiten; null = geschlossen.
  const [providerForm, setProviderForm] = useState(null);

  // Globales Gedächtnis (v7.16): eigener, von owner/repo/pat/apiKey
  // UNABHÄNGIGER Zustand (Muster wie linkProviders oben) – vorbefüllt mit
  // dem aktuellen Stand beim Öffnen des Dialogs (memory-Prop). Der
  // "Gedächtnis speichern"-Knopf persistiert SOFORT über onMemorySave,
  // unabhängig vom "Speichern & Verbinden"-Formular.
  const [memoryText, setMemoryText] = useState(memory);
  const [memorySaving, setMemorySaving] = useState(false);

  // AutoKorrektur (v7.25, Auftragsänderung: GLOBAL über state.json statt
  // localStorage, siehe App.jsx/lib/autocorrect.js) – eigener, von
  // owner/repo/pat/apiKey UNABHÄNGIGER Zustand (Muster wie linkProviders/
  // memoryText oben), vorbefüllt mit dem aktuellen state.json-Stand
  // (autocorrect-Prop). JEDE Änderung (Master-Toggle, Kategorie, eigene
  // Ersetzung) ruft SOFORT onAutocorrectChange(next) auf – App.jsx
  // übernimmt das nur noch in seinen State, der BESTEHENDE debounced
  // state.json-Write erledigt den Rest (kein eigener Sofort-Commit wie
  // bei Link-Providern/Gedächtnis nötig). Der Abschnitt unten erscheint
  // nur bei hasSettings (siehe dort) – ohne bestehende Verbindung gäbe es
  // noch kein state.json, in das sich eine Änderung einfügen ließe.
  const [ac, setAc] = useState(() => sanitizeAutocorrectConfig(autocorrect));
  const [customForm, setCustomForm] = useState({ trigger: "", replacement: "", error: null });

  const applyAutocorrect = (next) => {
    setAc(next);
    onAutocorrectChange(next);
  };
  const toggleAutocorrectEnabled = () => applyAutocorrect({ ...ac, enabled: !ac.enabled });
  const toggleAutocorrectCategory = (catId) =>
    applyAutocorrect({ ...ac, categories: { ...ac.categories, [catId]: !isCategoryEnabled(ac, catId) } });
  const addCustomAutocorrect = () => {
    const t = validateCustomTrigger(customForm.trigger);
    if (t.error) { setCustomForm((f) => ({ ...f, error: t.error })); return; }
    const r = validateCustomReplacement(customForm.replacement);
    if (r.error) { setCustomForm((f) => ({ ...f, error: r.error })); return; }
    applyAutocorrect({ ...ac, custom: [...ac.custom, { trigger: t.value, replacement: r.value }] });
    setCustomForm({ trigger: "", replacement: "", error: null });
  };
  const removeCustomAutocorrect = (idx) =>
    applyAutocorrect({ ...ac, custom: ac.custom.filter((_, i) => i !== idx) });

  const complete = owner.trim() && repo.trim() && pat.trim() && apiKey.trim();

  const submit = () => {
    if (!complete || connecting) return;
    onSave({
      owner: owner.trim(),
      repo: repo.trim(),
      pat: pat.trim(),
      apiKey: apiKey.trim(),
      linkProviders,
    });
  };

  const startAddProvider = () => setProviderForm(emptyProviderForm("azure-devops"));
  const startEditProvider = (p) => setProviderForm({ ...p });
  const cancelProviderForm = () => setProviderForm(null);

  // Typwechsel im Formular: Name/Präfix nur dann auf den Default des neuen
  // Typs umstellen, wenn der Nutzer sie noch nicht selbst angepasst hat
  // (sonst würde ein Typwechsel bereits Getipptes überschreiben).
  const changeProviderType = (type) => {
    setProviderForm((f) => {
      if (!f) return f;
      const oldInfo = PROVIDER_TYPE_INFO[f.type];
      const newInfo = PROVIDER_TYPE_INFO[type];
      return {
        ...f,
        type,
        name: f.name === oldInfo.defaultName ? newInfo.defaultName : f.name,
        prefix: f.prefix === oldInfo.defaultPrefix ? newInfo.defaultPrefix : f.prefix,
      };
    });
  };

  // providerFormValid/saveProviderForm/deleteProvider nutzen die reinen,
  // exportierten Helfer oben (providerFormIsValid/buildProviderEntry/
  // upsertProvider/removeProvider) – die eigentliche Logik ist dort direkt
  // testbar, hier bleibt nur noch die React-State-Anbindung.
  const providerFormValid = providerFormIsValid(providerForm);

  // v7.13 (E2E-Finding 🟡 "Provider gehen beim Schließen per X verloren"):
  // saveProviderForm/deleteProvider berechnen die neue Liste jetzt SYNCHRON
  // (statt über den funktionalen setState-Updater), damit sie im selben
  // Zug per onProvidersChange an App.jsx gemeldet werden kann – App.jsx
  // persistiert sie dort sofort (sofern bereits eine Verbindung besteht,
  // siehe handleProvidersChange), unabhängig vom "Speichern & Verbinden"-
  // Knopf. Sicher, weil beide Handler ausschließlich durch direkte
  // Nutzerklicks ausgelöst werden (keine konkurrierende Mutation von
  // linkProviders zwischen zwei Klicks).
  const saveProviderForm = () => {
    if (!providerForm || !providerFormValid) return;
    const next = upsertProvider(linkProviders, buildProviderEntry(providerForm));
    setLinkProvidersState(next);
    onProvidersChange(next);
    setProviderForm(null);
  };

  const deleteProvider = (id) => {
    const next = removeProvider(linkProviders, id);
    setLinkProvidersState(next);
    onProvidersChange(next);
  };

  // Async, weil onMemorySave einen GitHub-Commit auslöst (App.jsx
  // handleMemorySave/commitMemory) – memorySaving blendet den Knopf
  // währenddessen aus, damit kein Doppel-Commit durch schnelles Doppelklicken
  // entsteht.
  const saveMemory = async () => {
    setMemorySaving(true);
    try { await onMemorySave(memoryText); } finally { setMemorySaving(false); }
  };

  const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 font-mono";
  const label = "block text-xs font-medium text-slate-600 mb-1 mt-3";

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "rgba(15,23,42,0.45)" }}
        onClick={onClose}
      />
      <div className="relative bg-white w-full md:max-w-lg max-h-full rounded-t-2xl md:rounded-2xl shadow-xl flex flex-col" style={{ maxHeight: "92vh" }}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
          <Settings size={16} className="text-indigo-700" />
          <span className="font-semibold">Einstellungen</span>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          {!hasSettings && (
            <p className="text-sm text-slate-600 mb-2">
              Willkommen! Verbinde das Notizbuch einmalig mit deinem privaten
              Daten-Repo und deinem Anthropic-API-Key. Beides bleibt nur auf
              diesem Gerät (localStorage) und landet nie in einem Repo.
            </p>
          )}

          <label className={label}>GitHub-Owner (Benutzername)</label>
          <input className={field} value={owner} onChange={(e) => setOwner(e.target.value)}
            placeholder="z. B. tschachim" autoCapitalize="none" autoCorrect="off" spellCheck={false} />

          <label className={label}>Daten-Repo (privat)</label>
          <input className={field} value={repo} onChange={(e) => setRepo(e.target.value)}
            placeholder="notizbuch-data" autoCapitalize="none" autoCorrect="off" spellCheck={false} />

          <label className={label}>Fine-grained PAT (nur dieses Repo, „Contents: Read and write“)</label>
          <input className={field} type="password" value={pat} onChange={(e) => setPat(e.target.value)}
            placeholder="github_pat_…" autoComplete="off" />
          <p className="text-xs text-slate-400 mt-1">
            Erstellen unter GitHub → Settings → Developer settings → Fine-grained tokens.
          </p>

          <label className={label}>Anthropic-API-Key</label>
          <input className={field} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-…" autoComplete="off" />
          <p className="text-xs text-slate-400 mt-1">
            Erstellen unter console.anthropic.com → API Keys. Budgetlimit setzen!
          </p>

          <label className={label}>Modell für die Strukturierung</label>
          <select className={field} value={model} onChange={(e) => onModelChange(e.target.value)}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>

          {/* Link-Provider (v7.9, Nutzerwunsch "DevOps/Confluence-Icons +
              Titel-Ermittlung"): rein optional, betrifft NICHT die
              "complete"-Pflichtfeldprüfung oben. Azure DevOps/Confluence
              funktionieren als Icon bereits OHNE jeden Eintrag hier (siehe
              lib/linkProviders.jsx, eingebaute Provider) – ein Eintrag hier
              ergänzt nur ein PAT (schaltet die Titel-Ermittlung frei) bzw.
              weitere Präfixe/eigene Provider. */}
          <div className="mt-5 pt-3 border-t border-slate-200">
            <div className="flex items-center gap-1.5 mb-1">
              <Link2 size={14} className="text-indigo-700" />
              <span className="text-sm font-semibold text-slate-800">Link-Provider</span>
            </div>
            <p className="text-xs text-slate-400 mb-2">
              Zugangsdaten bleiben nur auf diesem Gerät (localStorage) und
              landen nie in einem Repo. Azure DevOps- und Confluence-Links
              bekommen ihr Icon auch ohne Eintrag hier – erst ein Eintrag mit
              Zugangsdaten schaltet die automatische Titel-Ermittlung frei.
            </p>

            {/* v7.13 (Randfall Erststart/unverbunden, siehe App.jsx
                handleProvidersChange): OHNE bestehende Verbindung (noch kein
                owner/repo/pat/apiKey persistiert) gibt es nichts, in das
                sich eine Provider-Änderung sofort einfügen ließe – Provider
                bleiben in diesem Fall bewusst NUR im Dialog-State und werden
                erst mit dem Verbinden-Formular zusammen übernommen. Anders
                als bei einer bestehenden Verbindung (dort persistiert
                onProvidersChange sofort, X verwirft dann NUR noch die
                Formularfelder) wäre das X hier also weiterhin ein stiller
                Datenverlust – deshalb der explizite Hinweis. */}
            {!hasSettings && (
              <p className="text-xs text-amber-600 mb-2">
                Wird erst mit „Speichern &amp; Verbinden“ übernommen (noch
                keine bestehende Verbindung).
              </p>
            )}

            {linkProviders.length > 0 && (
              <ul className="mb-2 space-y-1">
                {linkProviders.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-slate-200 bg-slate-50">
                    <ProviderIcon provider={p} className="shrink-0" />
                    <span className="text-sm text-slate-800 truncate">{p.name}</span>
                    <span className="text-xs text-slate-400 font-mono truncate flex-1">{p.prefix}</span>
                    <button onClick={() => startEditProvider(p)}
                      className="p-1 rounded text-slate-500 hover:bg-slate-200" title="Bearbeiten">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => deleteProvider(p.id)}
                      className="p-1 rounded text-rose-600 hover:bg-rose-50" title="Löschen">
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {!providerForm ? (
              <button
                onClick={startAddProvider}
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-300 text-slate-600 text-xs hover:bg-slate-50"
              >
                <Plus size={13} /> Provider hinzufügen
              </button>
            ) : (
              <div className="p-2.5 rounded-lg border border-indigo-200 bg-indigo-50/40">
                <label className={label + " mt-0"}>Typ</label>
                <select className={field} value={providerForm.type} onChange={(e) => changeProviderType(e.target.value)}>
                  <option value="azure-devops">Azure DevOps</option>
                  <option value="confluence">Confluence</option>
                  <option value="custom">Eigener Anbieter</option>
                </select>

                <label className={label}>Name</label>
                <input className={field} value={providerForm.name}
                  onChange={(e) => setProviderForm((f) => ({ ...f, name: e.target.value }))} />

                <label className={label}>URL-Präfix</label>
                <input className={field} value={providerForm.prefix}
                  onChange={(e) => setProviderForm((f) => ({ ...f, prefix: e.target.value }))}
                  placeholder="https://…" autoCapitalize="none" autoCorrect="off" spellCheck={false} />

                {providerForm.type === "azure-devops" && (
                  <>
                    <label className={label}>Personal Access Token (Work Items: Read)</label>
                    <input className={field} type="password" autoComplete="off" value={providerForm.pat}
                      onChange={(e) => setProviderForm((f) => ({ ...f, pat: e.target.value }))}
                      placeholder="optional – schaltet Titel-Ermittlung frei" />
                  </>
                )}

                {providerForm.type === "confluence" && (
                  <>
                    <label className={label}>E-Mail (Atlassian-Konto)</label>
                    <input className={field} value={providerForm.email} autoComplete="off"
                      onChange={(e) => setProviderForm((f) => ({ ...f, email: e.target.value }))}
                      placeholder="optional – für Titel-Ermittlung" />
                    <label className={label}>API-Token</label>
                    <input className={field} type="password" autoComplete="off" value={providerForm.pat}
                      onChange={(e) => setProviderForm((f) => ({ ...f, pat: e.target.value }))}
                      placeholder="optional – schaltet Titel-Ermittlung frei" />
                    <p className="text-xs text-slate-400 mt-1">
                      Automatische Titel-Ermittlung scheitert je nach
                      Atlassian-CORS-Policy – dann Titel manuell eintragen.
                    </p>
                  </>
                )}

                {providerForm.type === "custom" && (
                  <>
                    <label className={label}>Icon (Emoji)</label>
                    <input className={field} value={providerForm.icon} maxLength={4}
                      onChange={(e) => setProviderForm((f) => ({ ...f, icon: e.target.value }))}
                      placeholder="🔗" />
                  </>
                )}

                <div className="flex items-center gap-1.5 mt-3">
                  <button
                    onClick={saveProviderForm}
                    disabled={!providerFormValid}
                    className={"px-2 py-1 rounded bg-indigo-700 text-white text-xs " +
                      (providerFormValid ? "hover:bg-indigo-800" : "opacity-40")}
                  >
                    {providerForm.id ? "Übernehmen" : "Hinzufügen"}
                  </button>
                  <button onClick={cancelProviderForm}
                    className="px-2 py-1 rounded border border-slate-300 text-slate-600 text-xs hover:bg-slate-50">
                    Abbrechen
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Globales Gedächtnis (v7.16, Nutzerwunsch): NUR sichtbar, wenn
              bereits eine Verbindung besteht (memory.md liegt im Daten-Repo –
              ohne owner/repo/pat gäbe es nichts zu laden/speichern). Eigener,
              vom "Speichern & Verbinden"-Formular UNABHÄNGIGER Schreibpfad
              (Muster wie Link-Provider oben): der Knopf persistiert sofort;
              schließt der Nutzer stattdessen per X, geht höchstens eine NOCH
              NICHT gespeicherte Textarea-Eingabe verloren – das ist hier
              bewusst in Ordnung (kein stiller Datenverlust wie beim
              Link-Provider-Finding v7.13, weil der Hinweistext am Knopf das
              klarstellt und ein Klick auf "Gedächtnis speichern" sofort
              wirkt, statt erst mit dem restlichen Formular verzögert zu
              werden). */}
          {hasSettings && (
            <div className="mt-5 pt-3 border-t border-slate-200">
              <div className="flex items-center gap-1.5 mb-1">
                <span aria-hidden="true">🧠</span>
                <span className="text-sm font-semibold text-slate-800">Globales Gedächtnis</span>
              </div>
              <p className="text-xs text-slate-400 mb-2">
                Notizbuchübergreifend; wird dem Modell bei jeder Anfrage
                mitgegeben; überlebt das Chat-Archivieren. Keine
                Zugangsdaten hier ablegen.
              </p>
              <textarea
                className={field + " resize-y"}
                rows={8}
                style={{ maxHeight: "16rem" }}
                value={memoryText}
                onChange={(e) => setMemoryText(e.target.value)}
                placeholder="(noch leer)"
              />
              <div className="flex items-center gap-2 mt-1.5">
                <span className={"text-xs " + (memoryText.length > MEMORY_SOFT_LIMIT ? "text-amber-600" : "text-slate-400")}>
                  {memoryText.length} / {MEMORY_SOFT_LIMIT}
                </span>
                <div className="flex-1" />
                <button
                  onClick={saveMemory}
                  disabled={memorySaving}
                  className={"inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-700 text-white text-xs " +
                    (memorySaving ? "opacity-60" : "hover:bg-indigo-800")}
                >
                  {memorySaving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  Gedächtnis speichern
                </button>
              </div>
            </div>
          )}

          {/* AutoKorrektur (v7.25, Nutzerwunsch "natürlich global
              gespeichert"): NUR sichtbar mit bestehender Verbindung (Muster
              wie Globales Gedächtnis oben – die Konfiguration lebt in
              state.json, ohne owner/repo/pat gäbe es nichts zu laden/
              speichern). Änderungen wirken SOFORT (siehe applyAutocorrect
              oben) – kein eigener Speichern-Knopf nötig, der bestehende
              debounced state.json-Write in App.jsx übernimmt sie. */}
          {hasSettings && (
            <div className="mt-5 pt-3 border-t border-slate-200">
              <div className="flex items-center gap-1.5 mb-1">
                <Sparkles size={14} className="text-indigo-700" />
                <span className="text-sm font-semibold text-slate-800">AutoKorrektur (Editor)</span>
              </div>
              <p className="text-xs text-slate-400 mb-2">
                Ersetzt beim Tippen im WYSIWYG-Editor konfigurierte
                Zeichenketten durch Symbole (z. B. „-&gt;“ → „→“). Gilt auf
                allen Geräten (wird über das Daten-Repo synchronisiert). Ein
                bereits geöffneter Editor zieht Änderungen erst beim
                nächsten Öffnen nach.
              </p>

              <label className="flex items-center gap-2 text-sm text-slate-700 mb-2">
                <input type="checkbox" checked={ac.enabled} onChange={toggleAutocorrectEnabled} />
                AutoKorrektur aktiv
              </label>

              {ac.enabled && (
                <div className="space-y-1.5 mb-3">
                  {AUTOCORRECT_CATEGORIES.map((c) => (
                    <label key={c.id} className="flex items-start gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={isCategoryEnabled(ac, c.id)}
                        onChange={() => toggleAutocorrectCategory(c.id)}
                      />
                      <span>
                        {c.label}
                        <span className="block text-xs text-slate-400 font-mono">
                          {c.entries.slice(0, 3).map((e) => e.trigger + "→" + (e.replacement ?? e.open)).join("  ")}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}

              <div className="text-xs font-medium text-slate-600 mb-1">Eigene Ersetzungen</div>
              {ac.custom.length > 0 && (
                <ul className="mb-2 space-y-1">
                  {ac.custom.map((c, i) => (
                    <li key={c.trigger + i} className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-slate-200 bg-slate-50">
                      <span className="text-sm font-mono text-slate-800 truncate">{c.trigger} → {c.replacement}</span>
                      <div className="flex-1" />
                      <button onClick={() => removeCustomAutocorrect(i)}
                        className="p-1 rounded text-rose-600 hover:bg-rose-50" title="Löschen">
                        <Trash2 size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-center gap-1.5">
                <input
                  className={field + " w-24"}
                  placeholder="Trigger"
                  value={customForm.trigger}
                  maxLength={20}
                  onChange={(e) => setCustomForm((f) => ({ ...f, trigger: e.target.value, error: null }))}
                />
                <input
                  className={field + " w-24"}
                  placeholder="Ersetzung"
                  value={customForm.replacement}
                  maxLength={20}
                  onChange={(e) => setCustomForm((f) => ({ ...f, replacement: e.target.value, error: null }))}
                />
                <button
                  onClick={addCustomAutocorrect}
                  className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-300 text-slate-600 text-xs hover:bg-slate-50"
                >
                  <Plus size={13} /> Hinzufügen
                </button>
              </div>
              {customForm.error && <div className="mt-1 text-xs text-rose-700">{customForm.error}</div>}
            </div>
          )}

          {error && (
            <div className="mt-3 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-t border-slate-200">
          <button
            onClick={submit}
            disabled={!complete || connecting}
            className={"inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-700 text-white text-sm font-medium " +
              (!complete || connecting ? "opacity-40" : "hover:bg-indigo-800")}
          >
            {connecting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {connecting ? "Verbinde …" : "Speichern & Verbinden"}
          </button>
          <div className="flex-1" />
          {hasSettings && (
            <button
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-300 text-rose-700 text-sm hover:bg-rose-50"
              title="Löscht PAT und API-Key von diesem Gerät"
            >
              <LogOut size={14} />
              Abmelden
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
