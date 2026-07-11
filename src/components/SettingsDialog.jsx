import { useState } from "react";
import { Settings, X, Loader2, LogOut, Check } from "lucide-react";
import { MODELS } from "../lib/anthropic.js";

/* Settings-Dialog: erscheint beim Erststart und über das Zahnrad.
   Zugangsdaten trägt ausschließlich der Nutzer hier ein; sie landen
   nur im localStorage dieses Geräts, nie in einem Repo. */
export default function SettingsDialog({
  initial, model, onModelChange, onSave, onLogout, onClose,
  connecting, error, hasSettings,
}) {
  const [owner, setOwner] = useState((initial && initial.owner) || "");
  const [repo, setRepo] = useState((initial && initial.repo) || "notizbuch-data");
  const [pat, setPat] = useState((initial && initial.pat) || "");
  const [apiKey, setApiKey] = useState((initial && initial.apiKey) || "");

  const complete = owner.trim() && repo.trim() && pat.trim() && apiKey.trim();

  const submit = () => {
    if (!complete || connecting) return;
    onSave({
      owner: owner.trim(),
      repo: repo.trim(),
      pat: pat.trim(),
      apiKey: apiKey.trim(),
    });
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
