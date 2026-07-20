import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  BookOpen, Send, Pencil, X, Check, History, Download, Copy,
  RotateCcw, GitCommit, ChevronDown, Loader2, Upload, ImagePlus,
  Settings, AlertTriangle, StickyNote, Paperclip, Trash2, FileUp,
  ArrowUp, ArrowDown, Plus, ListTree, Archive, Maximize2, Minimize2,
} from "lucide-react";

import { applyOpsDetailed, dispHead, PLACEHOLDER_LINE, stripInboxPlaceholder } from "./lib/ops.js";
import { applyMemoryOps, applyMemoryOpsDetailed } from "./lib/memory.js";
import { diffLines, contextize } from "./lib/diff.js";
import { DocView, IMG_REF_RE, TASK_RE, parseTree, renumberCitations, decodeBasicEntities } from "./lib/markdown.jsx";
import {
  prepareImage, newImgId, extForMime, mimeForName, dataUrlParts, blobToDataURL,
  makeNotebookIcon,
} from "./lib/images.js";
import { MODELS, callClaude } from "./lib/anthropic.js";
import { buildFeedbackTrigger, isNoFeedback, dedupeFeedbackParagraphs } from "./lib/feedback.js";
import {
  ShaConflictError, utf8ToB64, ghGetFile, ghGetBlob, ghListDir, ghPutFile,
  ghDeleteFile, ghListCommits, ghCommitMeta, ghCheckRepo,
} from "./lib/github.js";
import {
  KNOWLEDGE_EXTS, knowledgeDir, safeFileName, extractPathFor, isExtractPath,
  extractText, fileToBase64,
} from "./lib/knowledge.js";
import { renderWithCites } from "./lib/citations.jsx";
import { renderMathText, expandMathInNodes } from "./lib/math.jsx";
import { expandFencedCodeInNodes } from "./lib/code.jsx";
import { chatToMarkdown, archiveBaseName, mergeChats } from "./lib/archive.js";
import { loadSettings, saveSettings, clearSettings } from "./lib/settings.js";
import { setLinkProviders, resolveProviderLinkTitles } from "./lib/linkProviders.jsx";
import { sanitizeAutocorrectConfig } from "./lib/autocorrect.js";
import SettingsDialog from "./components/SettingsDialog.jsx";
import DocEditor from "./components/DocEditor.jsx";
import QuickNotes from "./components/QuickNotes.jsx";

/* Geräte-lokale UI-Einstellungen (Spaltenbreiten, Schnellnotizen) */
const LAYOUT_KEY = "notizbuch:layout";
const QUICKNOTES_KEY = "notizbuch:quicknotes";

const loadLocal = (key, fallback) => {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v && typeof v === "object" ? v : fallback;
  } catch (e) { return fallback; }
};

/* ---------- Multi-Notizbuch-Helfer ---------- */
// Das Root-Notizbuch bleibt aus Kompatibilität die Datei wissensbasis.md;
// alle weiteren liegen unter notizbuecher/<slug>.md. Der Name eines
// Notizbuchs ist seine H1-Titelzeile – die Datei ist die einzige Wahrheit,
// state.json cached nur das aktive Notizbuch.
const ROOT_NB_ID = "wissensbasis";

const slugify = (name) =>
  String(name).toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  || "notizbuch";

const nameFromDoc = (text, fallbackSlug) => {
  const m = /^#\s+(.+)/.exec(String(text || "").split("\n")[0]);
  if (m) return m[1].trim();
  // Fehlende H1: Slug lesbar aufbereiten („koch-rezepte“ → „Koch Rezepte“)
  return String(fallbackSlug)
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
};

// Exportiert (v7.22.1, Re-Review): tests/docEditorPlaceholder.test.jsx
// braucht das ECHTE Anlage-Template, um den Editor-Roundtrip-Beleg gegen den
// tatsächlichen Ausgangszustand statt gegen eine nachgebaute Zeichenkette zu
// führen.
export const initialDocFor = (name) =>
  "# " + name + "\n\n## Inbox\n\n" + PLACEHOLDER_LINE + "\n";

/* ------------------------------------------------------------------ */
/* Konstanten (aus der Referenz-App übernommen)                        */
/* ------------------------------------------------------------------ */

const DOC_PATH = "wissensbasis.md";
const STATE_PATH = "data/state.json";
const OLD_HISTORY_PATH = "data/alt-historie.json";
// Globales, notizbuchübergreifendes Gedächtnis (v7.16, Nutzerwunsch): eigene
// Datei, unabhängig von state.json – überlebt dadurch by design die
// Chat-Archivierung (archiveChat leert nur state.json, siehe dort). Details
// zur Anwendung der Ops in lib/memory.js.
const MEMORY_PATH = "data/memory.md";

const INITIAL_DOC = "# Wissensbasis\n\n## Inbox\n\n" + PLACEHOLDER_LINE + "\n";

const WELCOME = {
  role: "assistant",
  ts: 0,
  text:
    "Hallo! Ich bin dein Notizbuch. Erzähl mir einfach, was du festhalten willst – " +
    "ich trage es rechts strukturiert in die Wissensbasis ein, ordne es bestehenden Themen zu " +
    "und melde mich, wenn mir Verbindungen, Widersprüche oder offene Punkte auffallen. " +
    "Du kannst auch Screenshots einfügen (einfügen oder Bild-Knopf) – ich analysiere sie und " +
    "lege sie mit Titel und Beschreibung im Dokument ab.",
};

/* ------------------------------------------------------------------ */
/* Format-Helfer                                                       */
/* ------------------------------------------------------------------ */

const fmtTime = (ts) =>
  new Date(ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

const fmtStamp = (ts) =>
  new Date(ts).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });

// collapsedAll: { notizbuchId: { sectionKey: true } }
// order: Notizbuch-IDs in Dropdown-Reihenfolge (Admin-Seite)
// quicknotes: { notizbuchId: [{ id, text, x, y, w, h }] } – wandert mit
// autocorrect: { enabled, categories:{id:bool}, custom:[{trigger,replacement}] }
// (v7.25, Nutzerwunsch "natürlich global gespeichert" – siehe lib/
// autocorrect.js-Kopfkommentar) – geräteübergreifend über das Daten-Repo
// synchronisiert, weil sie KEINE Zugangsdaten enthält (anders als
// linkProviders, siehe unten). sanitizeAutocorrectConfig läuft HIER
// nochmal defensiv (Defense-in-Depth wie bei linkProviders/
// sanitizeLinkProviders), falls der Aufrufer einen ungeprüften Zustand
// hereinreicht.
//
// SICHERHEIT (v7.9, Link-Provider): Diese Funktion nimmt bewusst NUR die
// sieben Parameter unten entgegen – "settings" (owner/repo/pat/apiKey UND
// die Link-Provider samt PAT/E-Mail) wird ihr NIE übergeben. Das ist
// keine zusätzliche Filterung, sondern strukturell: settings lebt
// ausschließlich in settingsRef/localStorage (siehe lib/settings.js) und
// hat schlicht keinen Pfad in dieses JSON. Exportiert, damit ein Test
// (tests/linkProviders.test.jsx) mit einem realitätsnah befüllten Zustand
// prüfen kann, dass kein Provider-PAT jemals in state.json landen kann –
// bei jeder künftigen Änderung an dieser Funktion soll ein Reviewer diesen
// Kommentar UND den Test sehen, bevor er versehentlich ein settings-Objekt
// hier mit hineinzieht.
export const serializeState = (chat, model, collapsedAll, active, order, quicknotes, autocorrect) =>
  JSON.stringify(
    {
      v: 2, active: active || ROOT_NB_ID, chat, model,
      collapsed: collapsedAll || {}, order: order || [], quicknotes: quicknotes || {},
      autocorrect: sanitizeAutocorrectConfig(autocorrect),
    },
    null, 2
  );

// Ops aus der Modellantwort in zwei Gruppen aufteilen (v7.16, globales
// Gedächtnis): memory_* wirken auf das notizbuchübergreifende Gedächtnis
// (eigene Datei/eigener Commit, siehe commitMemory), alles andere bleibt
// der bisherige Notizbuch-Pfad (applyOpsDetailed). Reihenfolge INNERHALB
// jeder Gruppe bleibt erhalten – nur die Gruppenzugehörigkeit ändert sich.
// Reine Funktion, exportiert für tests/memory.test.js (bzw. wo sinnvoll),
// analog zum serializeState-Exportmuster oben.
export function splitOps(ops) {
  const memoryOps = [];
  const notebookOps = [];
  for (const op of Array.isArray(ops) ? ops : []) {
    if (op && typeof op.type === "string" && op.type.startsWith("memory_")) memoryOps.push(op);
    else notebookOps.push(op);
  }
  return { memoryOps, notebookOps };
}

// Rahmen-Integrität des SYSTEM-HINWEIS (Review-Fix 🟡, Ergänzung/Schicht 1b
// "Quelle"): applyOpsDetailed()/applyMemoryOpsDetailed() liefern type/heading
// UNGEFILTERT aus der Modellantwort (results[].type ist z. B. NICHT auf die
// bekannten Op-Typen beschränkt – ein erfundener op.type landet 1:1 in
// results[].type, siehe ops.js#applyOpsDetailed). explainSkip/
// explainMemorySkip säubern bereits den reason-Text, NICHT aber diese beiden
// separat eingebetteten Felder – ohne Säuberung HIER könnte ein bösartiger
// type/heading/notebook-String den späteren "[SYSTEM-HINWEIS: …]"-Rahmen in
// lib/anthropic.js#callClaude erreichen. Schicht 2 ("Senke", callClaude)
// neutralisiert den kompletten m.warning-String zusätzlich als Sicherheitsnetz
// für genau solche – auch künftig denkbare – vergessenen Einbettungsstellen;
// diese Funktion soll sich aber nicht ALLEIN auf die Senke verlassen.
const WARN_LABEL_MAX = 100;
function sanitizeWarnLabel(s) {
  const collapsed = String(s || "").replace(/\s+/g, " ").trim();
  const bracketsSafe = collapsed.replace(/\[/g, "(").replace(/\]/g, ")");
  return bracketsSafe.length > WARN_LABEL_MAX ? bracketsSafe.slice(0, WARN_LABEL_MAX) + "…" : bracketsSafe;
}

// Baut den Text einer ⚠️-Warn-Pille aus den NICHT angewendeten Ops eines
// Turns (v7.21, Ops-Zuverlässigkeit – siehe DECISIONS #63: das Modell kann
// bisher ohne jede Rückmeldung eine Änderung ankündigen, die stillschweigend
// wirkungslos bleibt). "items": flache Liste von { type?, heading?,
// notebook?, reason }, aus applyOpsDetailed()/applyMemoryOpsDetailed()-
// Ergebnissen (nur die NICHT angewendeten, reason gesetzt) plus optional
// einem "bare" Hinweis ohne type/heading (z. B. "Commit angekündigt, aber
// keine Änderung wirksam geworden" – siehe send()). Bündelt MEHRERE nicht
// angewendete Ops in EINER Pille (Auftrag) statt vieler einzelner. Liefert
// null, wenn nichts zu warnen ist (Pille wird dann gar nicht gerendert).
// Reine Funktion, exportiert für tests/appOps.test.js.
export function buildOpsWarning(items) {
  const list = (Array.isArray(items) ? items : []).filter((it) => it && it.reason);
  if (!list.length) return null;
  const describe = (it) => {
    if (!it.type) return it.reason; // bare Hinweis ohne konkrete Op
    const label = sanitizeWarnLabel(it.type) + (it.heading ? ' „' + sanitizeWarnLabel(it.heading) + '“' : "");
    const where = it.notebook ? " in „" + sanitizeWarnLabel(it.notebook) + "“" : "";
    return label + where + " (" + it.reason + ")";
  };
  if (list.length === 1) return "⚠️ Nicht angewendet: " + describe(list[0]);
  return "⚠️ Nicht angewendet:\n" + list.map((it) => "– " + describe(it)).join("\n");
}

/* ------------------------------------------------------------------ */
/* Notizbuch-Dropdown (v7.2, Nutzerwunsch)                             */
/* Ersetzt das native <select> im Header: natives select kann keine    */
/* Icons in den Optionen zeigen. Trigger-Button + aufklappende Liste   */
/* mit Icon je Zeile (nbIcons[id] oder Standard-Logo), aktives         */
/* Notizbuch markiert, plus die zwei bisherigen Aktions-Einträge.      */
/* Escape/Klick außerhalb schließen; Pfeiltasten + Enter/Leertaste     */
/* reichen als Grund-Tastaturbedienung, Touch funktioniert wie Klick.  */
/* ------------------------------------------------------------------ */
function NotebookMenu({ notebooks, activeNb, nbIcons, disabled, onSelect, onNew, onAdmin }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1); // per Tastatur/Hover hervorgehobener Index
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const btnRef = useRef(null);
  const itemRefs = useRef([]); // DOM-Knoten je items-Index, für scrollIntoView
  const active = notebooks.find((n) => n.id === activeNb) || { name: "Notizbuch" };

  // Gemeinsame Liste (Notizbücher + die zwei Aktionen) für Pfeiltasten-Navigation.
  const items = [
    ...notebooks.map((n) => ({ kind: "nb", id: n.id, name: n.name })),
    { kind: "new", name: "＋ Neues Notizbuch …" },
    { kind: "admin", name: "⚙ Notizbücher verwalten …" },
  ];

  // Schließen, wahlweise mit Fokus zurück auf den Trigger-Button: bei
  // Escape/Auswahl soll der Fokus nicht auf <body> verloren gehen (die
  // Liste wird unmounted); bei Klick außerhalb NICHT refokussieren – dort
  // hat der Nutzer sein Fokusziel bereits selbst gewählt.
  const close = (refocus) => {
    setOpen(false);
    if (refocus && btnRef.current) btnRef.current.focus();
  };

  useEffect(() => {
    if (!open) return;
    if (listRef.current) listRef.current.focus();
    // Aktive Zeile beim Öffnen sofort in den sichtbaren Bereich holen (kann
    // bei vielen Notizbüchern unter max-h-80 hängen).
    if (itemRefs.current[hi]) itemRefs.current[hi].scrollIntoView({ block: "nearest" });
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") close(true); };
    // mousedown statt click: schließt zuverlässig, bevor ein Klick außerhalb
    // (z. B. auf einen anderen Header-Knopf) dessen eigenen Handler auslöst.
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const choose = (item) => {
    close(true);
    if (item.kind === "new") onNew();
    else if (item.kind === "admin") onAdmin();
    else onSelect(item.id);
  };

  // Hervorhebung per Pfeiltaste bewegen und die Zeile mitscrollen, statt sie
  // unsichtbar unter dem Rand von max-h-80 wandern zu lassen.
  const move = (delta) => {
    setHi((h) => {
      const next = Math.min(items.length - 1, Math.max(0, h + delta));
      if (itemRefs.current[next]) itemRefs.current[next].scrollIntoView({ block: "nearest" });
      return next;
    });
  };

  const openAt = () => {
    // Nur echte Notizbuch-Einträge kommen als Ausgangs-Highlight infrage –
    // die Aktions-Einträge haben kein id-Feld (id wäre hier immer undefined).
    setHi(Math.max(0, items.findIndex((i) => i.kind === "nb" && i.id === activeNb)));
    setOpen(true);
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        ref={btnRef}
        disabled={disabled}
        onClick={() => (open ? close(false) : openAt())}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") { e.preventDefault(); openAt(); }
        }}
        className={"flex items-center gap-1 min-w-0 max-w-24 sm:max-w-44 font-semibold tracking-tight " +
          "bg-transparent hover:bg-slate-50 rounded-lg pl-1 pr-1.5 py-1 " +
          (disabled ? "opacity-60 cursor-default" : "")}
        title="Notizbuch wählen"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate min-w-0">{active.name}</span>
        <ChevronDown size={14} className="shrink-0 text-slate-500" />
      </button>
      {open && (
        <div
          role="listbox"
          tabIndex={-1}
          ref={listRef}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
            else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
            else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (hi >= 0) choose(items[hi]); }
            else if (e.key === "Escape") { e.preventDefault(); close(true); }
          }}
          className="absolute left-0 top-full mt-1 z-[45] w-56 max-w-[80vw] max-h-80 overflow-y-auto bg-white border border-slate-300 rounded-lg shadow-xl py-1 outline-none"
        >
          {notebooks.map((n, i) => (
            <div
              key={n.id}
              ref={(el) => { itemRefs.current[i] = el; }}
              role="option"
              aria-selected={n.id === activeNb}
              title={n.name}
              onClick={() => choose(items[i])}
              onMouseEnter={() => setHi(i)}
              className={"flex items-center gap-2 px-2.5 py-2.5 sm:py-1.5 text-sm cursor-pointer " +
                (i === hi ? "bg-indigo-50 " : "") +
                (n.id === activeNb ? "font-semibold text-indigo-700" : "text-slate-700")}
            >
              <img
                src={nbIcons[n.id] || "icons/logo.png"}
                alt=""
                className={"w-4 h-4 shrink-0 " + (nbIcons[n.id] ? "rounded border border-slate-200" : "opacity-70")}
              />
              <span className="truncate">{n.name}</span>
              {n.id === activeNb && <Check size={13} className="ml-auto shrink-0" />}
            </div>
          ))}
          <div className="my-1 border-t border-slate-200" />
          {items.slice(notebooks.length).map((item, k) => {
            const idx = notebooks.length + k;
            return (
              <div
                key={item.kind}
                ref={(el) => { itemRefs.current[idx] = el; }}
                role="option"
                aria-selected={false}
                title={item.name}
                onClick={() => choose(item)}
                onMouseEnter={() => setHi(idx)}
                className={"px-2.5 py-2.5 sm:py-1.5 text-sm cursor-pointer text-slate-600 truncate " +
                  (idx === hi ? "bg-indigo-50" : "")}
              >
                {item.name}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Haupt-Komponente                                                    */
/* ------------------------------------------------------------------ */

export default function NotizbuchApp() {
  const [loaded, setLoaded] = useState(false);
  const [connected, setConnected] = useState(false);
  const [settings, setSettings] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState(null);

  const [doc, setDoc] = useState(INITIAL_DOC); // Text des AKTIVEN Notizbuchs
  const [notebooks, setNotebooks] = useState([]); // [{ id, path, name }]
  const [activeNb, setActiveNb] = useState(ROOT_NB_ID);
  const [chat, setChat] = useState([]);
  const [model, setModel] = useState(MODELS[0].id);
  // Globales, notizbuchübergreifendes Gedächtnis (v7.16) – eigene Datei
  // MEMORY_PATH, unabhängig von state.json/dem aktiven Notizbuch. "memory"
  // (State) speist die Einstellungen-Anzeige, memoryRef (unten) ist der
  // aktuelle Stand für buildNbCtx/commitMemory außerhalb des Renderns.
  const [memory, setMemory] = useState("");
  // AutoKorrektur-Konfiguration (v7.25) – Teil von state.json (siehe
  // serializeState oben), NICHT von localStorage/settings: enthält keine
  // Zugangsdaten und soll geräteübergreifend gelten. sanitizeAutocorrectConfig
  // liefert bei null/undefined bereits die Defaults (Master-Toggle an, alle
  // defaultEnabled-Kategorien aktiv, keine eigenen Ersetzungen).
  const [autocorrect, setAutocorrect] = useState(() => sanitizeAutocorrectConfig(null));
  const [collapsedAll, setCollapsedAll] = useState({}); // nbId -> Klappzustände
  const [meta, setMeta] = useState({ count: 0, lastTs: null });
  const [showNewNb, setShowNewNb] = useState(false);
  const [newNbName, setNewNbName] = useState("");
  const [creatingNb, setCreatingNb] = useState(false);
  const [nbError, setNbError] = useState(null);
  const [showNbAdmin, setShowNbAdmin] = useState(false);
  const [nbAdminBusy, setNbAdminBusy] = useState(null); // nbId der laufenden Aktion
  const [nbRenameId, setNbRenameId] = useState(null);
  const [nbRenameValue, setNbRenameValue] = useState("");
  const [nbDeleteId, setNbDeleteId] = useState(null); // Lösch-Bestätigung offen
  const [nbAdminError, setNbAdminError] = useState(null);
  const [navDrawer, setNavDrawer] = useState(false); // mobiler Abschnitts-Drawer
  const edgeSwipe = useRef(null); // Startpunkt des Randwischens
  const [nbIcons, setNbIcons] = useState({}); // nbId -> dataURL („Smart Icons“)
  const iconShas = useRef({}); // nbId -> SHA von icons/<id>.png
  const iconInputRef = useRef(null);
  const iconTargetNb = useRef(null); // Ziel-Notizbuch des Icon-Uploads
  const [showKnowledge, setShowKnowledge] = useState(false);
  const [knowledgeBusy, setKnowledgeBusy] = useState(null); // Fortschrittstext
  const [, setKnowledgeVersion] = useState(0); // Render-Trigger für Ref-Änderungen

  const collapsed = collapsedAll[activeNb] || {};

  const [input, setInput] = useState("");
  // v7.2: Eingabefeld per Knopf vergrößerbar (lange Prompts) – rein lokaler
  // UI-Zustand, kein Persistieren nötig (Bildschirmgröße/Vorliebe pro Sitzung).
  const [inputExpanded, setInputExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("strukturiert …");
  const [view, setView] = useState("chat");
  const [notesDirty, setNotesDirty] = useState(false);
  const [chatDirty, setChatDirty] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [saveState, setSaveState] = useState("off");
  const [storageError, setStorageError] = useState(null);
  const [banner, setBanner] = useState(null); // { kind: "info"|"warn", text }
  const [copied, setCopied] = useState(false);
  const [flash, setFlash] = useState(false);

  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]); // Git-Commits, neueste zuerst
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [expanded, setExpanded] = useState(null); // Commit-SHA
  const [expandedData, setExpandedData] = useState(null); // { sha, text, parentText, error }

  const [pendingImg, setPendingImg] = useState(null); // { dataUrl, mime }
  const [pendingFile, setPendingFile] = useState(null); // { file, name } – Nicht-Bild-Anhang
  const [imgError, setImgError] = useState(null);
  const [imgMap, setImgMap] = useState({}); // id -> dataURL
  const [lightbox, setLightbox] = useState(null);
  const [importing, setImporting] = useState(null); // Fortschrittstext

  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const imgInputRef = useRef(null);
  const firstDoc = useRef(true);
  const failedImgs = useRef(new Set());

  const [activeSec, setActiveSec] = useState(0);
  const docScrollRef = useRef(null);
  const mainRef = useRef(null);

  const [layout, setLayout] = useState(() => {
    const l = loadLocal(LAYOUT_KEY, {});
    return {
      chatPct: typeof l.chatPct === "number" ? Math.min(80, Math.max(20, l.chatPct)) : 50,
      navW: typeof l.navW === "number" ? Math.min(360, Math.max(96, l.navW)) : 148,
    };
  });
  const [quickNotesAll, setQuickNotesAll] = useState(() => {
    const v = loadLocal(QUICKNOTES_KEY, {});
    if (Array.isArray(v)) return { [ROOT_NB_ID]: v }; // Migration: altes Array-Format
    return v && typeof v === "object" ? v : {};
  });
  const quickNotes = quickNotesAll[activeNb] || [];

  const settingsRef = useRef(null);
  const docRef = useRef(INITIAL_DOC);
  const notebooksRef = useRef([]);
  const activeNbRef = useRef(ROOT_NB_ID);
  const docCache = useRef({}); // nbId -> Text
  const docShas = useRef({});  // nbId -> Content-SHA
  const memoryRef = useRef(""); // aktueller Gedächtnis-Text, siehe MEMORY_PATH
  const memorySha = useRef(null); // Content-SHA von data/memory.md, null = noch nicht angelegt
  const knowledgeIndex = useRef({}); // nbId -> [{ name, path, extractPath }]
  const knowledgeTexts = useRef({}); // extractPath -> extrahierter Text
  const knowledgeFileRef = useRef(null);
  const taskChain = useRef(Promise.resolve());
  const taskEpoch = useRef(0);
  const connectedRef = useRef(false);
  const busyRef = useRef(false);
  const editingRef = useRef(false);
  const viewRef = useRef("chat");
  const stateRef = useRef({ chat: [], model: MODELS[0].id, collapsedAll: {}, quickNotesAll: {}, autocorrect: sanitizeAutocorrectConfig(null) });
  const stateSha = useRef(null);
  const stateTimer = useRef(null);
  const stateFlushing = useRef(0); // Zähler: auch überlappende Flushes abdecken
  const lastSavedState = useRef(null);
  const lastRefresh = useRef(0);
  const imgIndex = useRef({}); // id -> Pfad im Daten-Repo
  const versionCache = useRef(new Map()); // Commit-SHA -> Dokumenttext

  useEffect(() => { connectedRef.current = connected; }, [connected]);
  useEffect(() => { docRef.current = doc; }, [doc]);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => { editingRef.current = editing; }, [editing]);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { notebooksRef.current = notebooks; }, [notebooks]);
  useEffect(() => { activeNbRef.current = activeNb; }, [activeNb]);
  useEffect(() => { stateRef.current = { chat, model, collapsedAll, quickNotesAll, autocorrect }; }, [chat, model, collapsedAll, quickNotesAll, autocorrect]);

  /* ---------- Metadaten (Stand & Versionszahl des aktiven Notizbuchs) ---------- */
  const refreshMeta = useCallback(async (cfg, path) => {
    try { setMeta(await ghCommitMeta(cfg, path || DOC_PATH)); } catch (e) { /* unkritisch */ }
  }, []);

  const activeNotebook = () =>
    notebooksRef.current.find((n) => n.id === activeNbRef.current) ||
    { id: ROOT_NB_ID, path: DOC_PATH, name: "Wissensbasis" };

  /* ---------- Verbinden & Laden ---------- */
  const connect = useCallback(async (cfg) => {
    setConnecting(true);
    setConnectError(null);
    try {
      await ghCheckRepo(cfg);

      // State laden (Chat, Modell, Klappzustände, aktives Notizbuch)
      let nChat = [WELCOME];
      let nModel = MODELS[0].id;
      let nCollapsedAll = {};
      let wantActive = null;
      let wantOrder = [];
      // null = state.json kennt noch keine Schnellnotizen → lokale
      // (localStorage-)Notizen bleiben und werden beim nächsten Write
      // migriert; sonst gilt der Repo-Stand.
      let nQuick = null;
      // Alt-state.json OHNE "autocorrect"-Feld (vor v7.25): sanitize
      // liefert für data.autocorrect === undefined bereits die Defaults
      // (Master-Toggle an, alle defaultEnabled-Kategorien aktiv).
      let nAutocorrect = sanitizeAutocorrectConfig(null);
      const st = await ghGetFile(cfg, STATE_PATH);
      stateSha.current = st ? st.sha : null;
      if (st) {
        try {
          const data = JSON.parse(st.text);
          if (Array.isArray(data.chat) && data.chat.length) nChat = data.chat;
          if (typeof data.model === "string" && MODELS.some((m) => m.id === data.model)) nModel = data.model;
          if (data.collapsed && typeof data.collapsed === "object") {
            // v1: flache Map mit "s:"-Keys → dem Root-Notizbuch zuordnen
            const keys = Object.keys(data.collapsed);
            nCollapsedAll = keys.length && keys.every((k) => k.startsWith("s:"))
              ? { [ROOT_NB_ID]: data.collapsed }
              : data.collapsed;
          }
          if (typeof data.active === "string") wantActive = data.active;
          if (Array.isArray(data.order)) wantOrder = data.order.filter((x) => typeof x === "string");
          if (data.quicknotes && typeof data.quicknotes === "object" && !Array.isArray(data.quicknotes)) {
            // Nur wohlgeformte Einträge (Arrays) übernehmen
            nQuick = Object.fromEntries(
              Object.entries(data.quicknotes).filter(([, v]) => Array.isArray(v))
            );
          }
          nAutocorrect = sanitizeAutocorrectConfig(data.autocorrect);
        } catch (e) { /* defekter State → Defaults */ }
      }

      // Globales Gedächtnis laden (v7.16, notizbuchübergreifend, eigene
      // Datei – siehe MEMORY_PATH). Fehlt sie (frisches/altes Repo ohne
      // Gedächtnis), bleibt sie leer und wird erst beim ersten Schreiben
      // angelegt (siehe commitMemory).
      const memFile = await ghGetFile(cfg, MEMORY_PATH);
      memorySha.current = memFile ? memFile.sha : null;
      memoryRef.current = memFile ? memFile.text : "";
      setMemory(memoryRef.current);

      // Notizbücher entdecken: Root-Datei + notizbuecher/-Ordner.
      // Der Name kommt aus der H1-Titelzeile der Datei (selbstheilend).
      const foundNbs = [];
      const rootFile = await ghGetFile(cfg, "wissensbasis.md");
      if (rootFile) foundNbs.push({ id: ROOT_NB_ID, path: "wissensbasis.md", file: rootFile });
      const nbFiles = await ghListDir(cfg, "notizbuecher");
      for (const f of nbFiles) {
        const m = /^([a-z0-9-]+)\.md$/i.exec(f.name);
        if (!m || m[1].toLowerCase() === ROOT_NB_ID) continue; // Kollision mit Root vermeiden
        const file = await ghGetFile(cfg, f.path);
        if (file) foundNbs.push({ id: m[1].toLowerCase(), path: f.path, file });
      }
      if (!foundNbs.length) {
        const put = await ghPutFile(cfg, "wissensbasis.md", utf8ToB64(INITIAL_DOC), "Initiale Wissensbasis");
        foundNbs.push({ id: ROOT_NB_ID, path: "wissensbasis.md", file: { text: INITIAL_DOC, sha: put.sha } });
      }
      const nbs = [];
      const cache = {};
      const shas = {};
      for (const f of foundNbs) {
        nbs.push({ id: f.id, path: f.path, name: nameFromDoc(f.file.text, f.id) });
        cache[f.id] = f.file.text;
        shas[f.id] = f.file.sha;
      }
      // Dropdown-Reihenfolge aus state.json anwenden; Unbekanntes hinten
      // in Discovery-Reihenfolge (sort ist stabil).
      const pos = new Map(wantOrder.map((id, i) => [id, i]));
      nbs.sort((a, b) => (pos.has(a.id) ? pos.get(a.id) : 1e9) - (pos.has(b.id) ? pos.get(b.id) : 1e9));
      docCache.current = cache;
      docShas.current = shas;
      const active = nbs.some((n) => n.id === wantActive) ? wantActive : nbs[0].id;
      const activePath = nbs.find((n) => n.id === active).path;

      const files = await ghListDir(cfg, "bilder");
      const idx = {};
      for (const f of files) {
        const m = /^([a-zA-Z0-9]+)\.(jpg|jpeg|png|webp|gif)$/i.exec(f.name);
        if (m) idx[m[1]] = f.path;
      }
      imgIndex.current = idx;
      failedImgs.current = new Set();
      versionCache.current = new Map();

      // Notizbuch-Icons laden (icons/<nbId>.png, parallel). Icons sind Deko:
      // Fehler hier dürfen das Verbinden nicht verhindern.
      const icons = {};
      iconShas.current = {};
      try {
        const iconFiles = await ghListDir(cfg, "icons");
        await Promise.all(iconFiles.map(async (f) => {
          const m = /^([a-z0-9-]+)\.png$/i.exec(f.name);
          if (!m) return;
          iconShas.current[m[1].toLowerCase()] = f.sha;
          try {
            const blob = await ghGetBlob(cfg, f.path);
            if (blob) icons[m[1].toLowerCase()] = await blobToDataURL(blob.slice(0, blob.size, "image/png"));
          } catch (e) { /* Icon fehlt dann eben – Standard-Logo greift */ }
        }));
      } catch (e) { /* icons/ nicht lesbar – Standard-Logos reichen */ }
      setNbIcons(icons);

      // Hintergrundwissen entdecken: wissen/<nbId>/ pro Notizbuch (parallel)
      const kIdx = {};
      await Promise.all(nbs.map(async (nb) => {
        const kFiles = await ghListDir(cfg, knowledgeDir(nb.id));
        const names = new Set(kFiles.map((f) => f.name));
        const items = kFiles
          .filter((f) => !isExtractPath(f.name))
          .map((f) => ({ name: f.name, path: f.path, extractPath: extractPathFor(f.path) }));
        // Extrakt-only-Dateien (Original war über 25 MB und wurde nicht
        // gespeichert): am Extrakt erkennen, dem kein Original gegenübersteht.
        for (const f of kFiles) {
          if (!isExtractPath(f.name)) continue;
          const orig = f.name.replace(/\.extrakt\.md$/i, "");
          if (!names.has(orig)) items.push({ name: orig, path: null, extractPath: f.path });
        }
        if (items.length) kIdx[nb.id] = items;
      }));
      knowledgeIndex.current = kIdx;
      knowledgeTexts.current = {};

      // Merge statt hartem Ersetzen: Remote gewinnt pro Notizbuch, lokale
      // Notizbücher ohne Remote-Eintrag behalten ihre Notizen (wichtig bei
      // der Migration mehrerer Geräte). lastSavedState spiegelt den
      // Remote-Stand – weicht der Merge ab, pusht der Save-Effect ihn.
      lastSavedState.current = serializeState(nChat, nModel, nCollapsedAll, active, nbs.map((n) => n.id), nQuick || {}, nAutocorrect);
      if (nQuick) setQuickNotesAll((loc) => ({ ...loc, ...nQuick }));
      setNotebooks(nbs);
      notebooksRef.current = nbs;
      setActiveNb(active);
      activeNbRef.current = active;
      setDoc(cache[active]);
      setChat(nChat);
      setModel(nModel);
      setCollapsedAll(nCollapsedAll);
      setAutocorrect(nAutocorrect);
      setSettings(cfg);
      settingsRef.current = cfg;
      setConnected(true);
      setShowSettings(false);
      setSaveState("saved");
      setStorageError(null);
      setBanner(null);
      refreshMeta(cfg, activePath);
      return true;
    } catch (e) {
      setConnectError(e && e.message ? e.message : String(e));
      setShowSettings(true);
      return false;
    } finally {
      setConnecting(false);
      setLoaded(true);
    }
  }, [refreshMeta]);

  useEffect(() => {
    const s = loadSettings();
    if (s) {
      settingsRef.current = s;
      setSettings(s);
      // Link-Provider-Registry (v7.9): markdown.jsx/DocEditor.jsx lesen sie
      // über getLinkProviders() – kein neues Prop quer durch beide
      // Komponentenbäume (siehe DECISIONS).
      setLinkProviders(s.linkProviders || []);
      connect(s);
    } else {
      setChat([WELCOME]);
      setSaveState("off");
      setShowSettings(true);
      setLoaded(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveSettings = async (cfg) => {
    const ok = await connect(cfg);
    if (ok) {
      saveSettings(cfg);
      setLinkProviders(cfg.linkProviders || []);
    }
  };

  // Link-Provider SOFORT persistieren (v7.13, E2E-Finding 🟡: bisher wurden
  // Provider-Änderungen NUR beim Klick auf "Speichern & Verbinden" in
  // localStorage geschrieben – schloss der Nutzer den Dialog stattdessen per
  // X, gingen frisch angelegte/bearbeitete/gelöschte Provider still
  // verloren, ohne jeden Hinweis). SettingsDialog ruft diesen Callback bei
  // JEDER Provider-Listenänderung (Hinzufügen/Bearbeiten-Übernehmen/Löschen)
  // auf, unabhängig vom restlichen Verbinden-Formular (owner/repo/pat/
  // apiKey bleiben rein lokaler Dialog-Zustand, wie bisher – nur die
  // Provider-Liste wird hier separat behandelt). NUR wirksam, wenn bereits
  // ein verbundener Settings-Stand existiert (settingsRef.current !== null):
  // ohne bestehendes owner/repo/pat/apiKey gäbe es nichts, in das sich die
  // Provider-Liste sinnvoll einfügen ließe – loadSettings() verlangt
  // zwingend alle vier Felder (lib/settings.js), ein Objekt NUR mit
  // linkProviders würde beim nächsten Laden als "nicht verbunden" verworfen
  // und müsste die gesamte connected-Logik (an vielen Stellen in App.jsx an
  // settingsRef.current/connected geknüpft) unnötig verkomplizieren. Im
  // Erststart-/unverbundenen Fall bleiben Provider deshalb bewusst NUR im
  // Dialog-State (wie vor v7.13) und werden erst mit "Speichern &
  // Verbinden" übernommen – SettingsDialog zeigt dafür einen Hinweistext,
  // solange hasSettings falsch ist (siehe dort).
  const handleProvidersChange = (list) => {
    if (!settingsRef.current) return;
    const next = { ...settingsRef.current, linkProviders: list };
    settingsRef.current = next;
    setSettings(next);
    saveSettings(next);
    setLinkProviders(list);
  };

  const handleLogout = () => {
    clearSettings();
    setLinkProviders([]);
    window.location.reload();
  };

  // AutoKorrektur-Änderungen aus dem SettingsDialog (v7.25) – anders als
  // Link-Provider (v7.13, handleProvidersChange oben) KEIN eigener
  // Sofort-Commit: die Konfiguration ist Teil von state.json, der
  // bestehende debounced Save-Effect (siehe useEffect mit serializeState
  // oben) greift bereits, sobald sich der State-Wert ändert. Der Abschnitt
  // im SettingsDialog erscheint ohnehin NUR bei bestehender Verbindung
  // (hasSettings, siehe dort) – der Erststart-Randfall von
  // handleProvidersChange (Provider bleiben ohne Verbindung nur im
  // Dialog-State) entfällt hier dadurch von vornherein.
  const handleAutocorrectChange = (cfg) => {
    setAutocorrect(sanitizeAutocorrectConfig(cfg));
  };

  // Gedächtnis-Speichern-Knopf im SettingsDialog (v7.16): eigener, vom
  // "Speichern & Verbinden"-Formular UNABHÄNGIGER Schreibpfad (Muster
  // v7.9/v7.13, siehe handleProvidersChange oben) – sofortiges Persistieren
  // bei Klick, X-Schließen des Dialogs verwirft höchstens eine ungespeicherte
  // Textarea-Eingabe (siehe Hinweistext am Knopf in SettingsDialog.jsx).
  // Nutzt DENSELBEN Schreibpfad wie modellgetriebene memory-Ops (siehe
  // commitMemory): eine einzelne memory_replace-Op ersetzt den kompletten
  // Text, SHA-Konflikte werden dort einheitlich behandelt.
  const handleMemorySave = async (text) => {
    if (!connectedRef.current || !settingsRef.current) return;
    await commitMemory(settingsRef.current, [{ type: "memory_replace", content: text }]);
  };

  /* ---------- state.json speichern (debounced, Konflikt = Neuversuch) ---------- */
  const flushState = useCallback(async (cfg, payload) => {
    stateFlushing.current += 1;
    try {
      try {
        const put = await ghPutFile(cfg, STATE_PATH, utf8ToB64(payload), "Chat & Einstellungen aktualisiert", stateSha.current || undefined);
        stateSha.current = put.sha;
      } catch (e) {
        if (e instanceof ShaConflictError) {
          // Parallel geändert (z. B. am Handy): neu lesen, lokalen Stand erneut schreiben.
          const cur = await ghGetFile(cfg, STATE_PATH);
          const put2 = await ghPutFile(cfg, STATE_PATH, utf8ToB64(payload), "Chat & Einstellungen aktualisiert", cur ? cur.sha : undefined);
          stateSha.current = put2.sha;
        } else throw e;
      }
      lastSavedState.current = payload;
      setSaveState("saved");
      setStorageError(null);
    } catch (e) {
      setSaveState("error");
      setStorageError(e && e.message ? e.message : String(e));
    } finally {
      stateFlushing.current -= 1;
    }
  }, []);

  useEffect(() => {
    if (!connected || !settingsRef.current) return;
    const payload = serializeState(chat, model, collapsedAll, activeNb, notebooks.map((n) => n.id), quickNotesAll, autocorrect);
    if (payload === lastSavedState.current) {
      // Zurück auf dem letzten gespeicherten Stand: geplanten Write verwerfen,
      // sonst schriebe der laufende Timer einen inzwischen veralteten Zustand.
      if (stateTimer.current) { clearTimeout(stateTimer.current); stateTimer.current = null; }
      setSaveState("saved");
      return;
    }
    setSaveState("saving");
    if (stateTimer.current) clearTimeout(stateTimer.current);
    const cfg = settingsRef.current;
    stateTimer.current = setTimeout(() => {
      stateTimer.current = null;
      flushState(cfg, payload);
    }, 2500);
  }, [chat, model, collapsedAll, activeNb, notebooks, quickNotesAll, autocorrect, connected, flushState]);

  /* ---------- Notizbuch committen (genau 1 Commit pro Änderung) ---------- */
  // Liefert true bei Erfolg. Bei SHA-Konflikt: Remote-Stand laden, Nutzer
  // informieren, nichts überschreiben (Eingabe bleibt beim Aufrufer erhalten).
  const commitDocNb = useCallback(async (cfg, nbId, newText, message) => {
    const nb = notebooksRef.current.find((n) => n.id === nbId);
    if (!nb) return false;
    setSaveState("saving");
    try {
      const put = await ghPutFile(cfg, nb.path, utf8ToB64(newText), message, docShas.current[nbId] || undefined);
      docShas.current[nbId] = put.sha;
      docCache.current[nbId] = newText;
      if (nbId === activeNbRef.current) {
        setMeta((m) => ({ count: (m.count || 0) + 1, lastTs: Date.now() }));
      }
      setSaveState("saved");
      setStorageError(null);
      return true;
    } catch (e) {
      if (e instanceof ShaConflictError) {
        try {
          const f = await ghGetFile(cfg, nb.path);
          if (f) {
            docShas.current[nbId] = f.sha;
            docCache.current[nbId] = f.text;
            if (nbId === activeNbRef.current) setDoc(f.text);
          }
          refreshMeta(cfg, nb.path);
        } catch (e2) { /* Reload fehlgeschlagen – Banner reicht */ }
        setSaveState("saved");
        setBanner({
          kind: "warn",
          text: "Das Notizbuch „" + nb.name + "“ wurde zwischenzeitlich auf einem anderen Gerät geändert. " +
            "Der neue Stand wurde geladen, deine Änderung wurde NICHT gespeichert – bitte noch einmal auslösen.",
        });
        return false;
      }
      setSaveState("error");
      setStorageError(e && e.message ? e.message : String(e));
      return false;
    }
  }, [refreshMeta]);

  /* ---------- Globales Gedächtnis committen (v7.16) ---------- */
  // ops-basiert statt Text-basiert (anders als commitDocNb): bei einem
  // SHA-Konflikt (paralleles Gerät oder ein zeitgleicher Speichern-Klick im
  // Einstellungen-Dialog) wird NICHT einfach der alte lokale Stand
  // überschrieben (stiller Verlust der fremden Änderung) – stattdessen wird
  // frisch gelesen und DIESELBEN ops erneut auf den frischen Stand
  // angewendet, dann EINMAL retry-committet. memory_replace ist dabei
  // bewusst basis-unabhängig (siehe lib/memory.js): der "Gedächtnis
  // speichern"-Knopf im SettingsDialog ruft diese Funktion mit genau einem
  // memory_replace-Op auf und nutzt so DENSELBEN Schreibpfad wie
  // Modell-Ops – ein Konflikt dort führt zum selben deterministischen
  // Ergebnis (die volle Retry-Anwendung überschreibt ohnehin alles).
  // Restrisiko (LWW, siehe DECISIONS): gewinnt der Konflikt ein zweites Mal
  // in Folge (zwei fast zeitgleiche Schreiber auf zwei Geräten), wird NICHT
  // endlos weiterversucht – der zweite Schreiber verliert seine Änderung
  // mit einem Banner-Hinweis.
  // Rückgabewert (v7.21, Ops-Zuverlässigkeit – siehe DECISIONS #63): jetzt
  // {committed, notApplied} statt nur eines booleans. "committed" ist true
  // nur bei einem TATSÄCHLICH ausgelösten Commit (für das 🧠-Badge im Chat) –
  // false sowohl bei einem wirkungslosen No-op (ops ergaben keine
  // inhaltliche Änderung) als auch bei einem Fehlschlag (dann steht bereits
  // ein Banner). "notApplied" listet einzelne NICHT angewendete Ops
  // (unbekannter memory_*-Typ, leerer content – siehe lib/memory.js#
  // applyMemoryOpsDetailed) für die ⚠️-Warn-Pille in send(), UNABHÄNGIG vom
  // Gesamt-Ausgang: auch wenn ANDERE Ops im selben Aufruf erfolgreich
  // committet wurden, sollen die wirkungslosen einzelnen Ops nicht
  // stillschweigend untergehen. notApplied hängt bei Gedächtnis-Ops NIE vom
  // Basistext ab (siehe applyMemoryOpsDetailed/applyOne: memory_append/
  // memory_replace werten NUR op.type/op.content aus) – beim SHA-Konflikt-
  // Retry unten auf frischem Text bleibt die Liste deshalb bewusst
  // unverändert gültig, statt ein zweites Mal berechnet zu werden.
  const commitMemory = useCallback(async (cfg, ops) => {
    const before = memoryRef.current;
    const detailed = applyMemoryOpsDetailed(before, ops);
    const notApplied = detailed.results
      .filter((r) => !r.applied)
      .map((r) => ({ type: r.type, reason: r.reason }));
    const applied = detailed.text;
    if (applied === before) return { committed: false, notApplied };
    try {
      const put = await ghPutFile(cfg, MEMORY_PATH, utf8ToB64(applied), "Gedächtnis aktualisiert", memorySha.current || undefined);
      memorySha.current = put.sha;
      memoryRef.current = applied;
      setMemory(applied);
      return { committed: true, notApplied };
    } catch (e) {
      if (e instanceof ShaConflictError) {
        try {
          const fresh = await ghGetFile(cfg, MEMORY_PATH);
          const reapplied = applyMemoryOps(fresh ? fresh.text : "", ops);
          const put2 = await ghPutFile(cfg, MEMORY_PATH, utf8ToB64(reapplied), "Gedächtnis aktualisiert", fresh ? fresh.sha : undefined);
          memorySha.current = put2.sha;
          memoryRef.current = reapplied;
          setMemory(reapplied);
          return { committed: true, notApplied };
        } catch (e2) {
          setBanner({
            kind: "warn",
            text: "Gedächtnis konnte nicht gespeichert werden (zweimal in Folge ein Konflikt): " +
              (e2 && e2.message ? e2.message : e2),
          });
          return { committed: false, notApplied };
        }
      }
      setBanner({ kind: "warn", text: "Gedächtnis konnte nicht gespeichert werden: " + (e && e.message ? e.message : e) });
      return { committed: false, notApplied };
    }
  }, []);

  /* ---------- Bilder nachladen (aus dem Daten-Repo) ---------- */
  useEffect(() => {
    if (!loaded || !connected) return;
    const cfg = settingsRef.current;
    const ids = new Set();
    let m;
    IMG_REF_RE.lastIndex = 0;
    while ((m = IMG_REF_RE.exec(doc))) ids.add(m[1]);
    chat.forEach((c) => { if (c.imgId) ids.add(c.imgId); });
    const missing = [...ids].filter((id) => !imgMap[id] && !failedImgs.current.has(id));
    if (!missing.length) return;
    (async () => {
      const updates = {};
      for (const id of missing) {
        const path = imgIndex.current[id];
        if (!path) { failedImgs.current.add(id); continue; }
        try {
          const blob = await ghGetBlob(cfg, path);
          if (blob) updates[id] = await blobToDataURL(blob.slice(0, blob.size, mimeForName(path)));
          else failedImgs.current.add(id);
        } catch (e) { failedImgs.current.add(id); }
      }
      if (Object.keys(updates).length) setImgMap((prev) => ({ ...prev, ...updates }));
    })();
  }, [doc, chat, loaded, connected]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Beim Fokuswechsel Remote-Stand nachziehen ---------- */
  useEffect(() => {
    const maybeRefresh = async () => {
      const cfg = settingsRef.current;
      if (!cfg || !connectedRef.current) return;
      if (busyRef.current || editingRef.current) return;
      if (Date.now() - lastRefresh.current < 15000) return;
      lastRefresh.current = Date.now();
      try {
        // Alle Notizbuch-Dateien nachziehen: neue entdecken, geänderte laden.
        // Die Root-SHA kommt aus dem Wurzel-Listing – so lädt der Poll das
        // Root-Dokument nur bei echter Änderung statt bei jedem Durchgang.
        const rootList = await ghListDir(cfg, "");
        const rootEntry = rootList.find((f) => f.name === "wissensbasis.md");
        const entries = [{ id: ROOT_NB_ID, path: "wissensbasis.md", sha: rootEntry ? rootEntry.sha : null }];
        const nbFiles = await ghListDir(cfg, "notizbuecher");
        for (const f of nbFiles) {
          const m = /^([a-z0-9-]+)\.md$/i.exec(f.name);
          if (m && m[1].toLowerCase() !== ROOT_NB_ID) {
            entries.push({ id: m[1].toLowerCase(), path: f.path, sha: f.sha });
          }
        }
        // Seit dem ghListDir-await kann ein send()/edit gestartet sein –
        // dann docCache/aktives Notizbuch nicht mehr anfassen.
        if (busyRef.current || editingRef.current) return;
        let nbsChanged = false;
        let nbs = [...notebooksRef.current];
        // Auf einem anderen Gerät gelöschte Notizbücher auch hier entfernen
        // (Root nur, wenn andere existieren – sonst legt connect sie neu an).
        const known = new Set(entries.map((e) => e.id));
        if (nbs.some((n) => !known.has(n.id))) {
          const removed = nbs.filter((n) => !known.has(n.id));
          nbs = nbs.filter((n) => known.has(n.id));
          if (nbs.length) {
            nbsChanged = true;
            for (const r of removed) {
              delete docCache.current[r.id];
              delete docShas.current[r.id];
            }
            setCollapsedAll((prev) => {
              const next = { ...prev };
              for (const r of removed) delete next[r.id];
              return next;
            });
            setQuickNotesAll((prev) => {
              const next = { ...prev };
              for (const r of removed) delete next[r.id];
              return next;
            });
            if (removed.some((r) => r.id === activeNbRef.current)) {
              const first = nbs[0];
              setActiveNb(first.id);
              activeNbRef.current = first.id;
              setDoc(docCache.current[first.id] ?? INITIAL_DOC);
              setActiveSec(0);
              refreshMeta(cfg, first.path);
            }
          } else {
            nbs = [...notebooksRef.current]; // nichts übrig – lieber nichts tun
          }
        }
        for (const en of entries) {
          // Läuft gerade ein Senden/Bearbeiten los, mitten im Refresh abbrechen,
          // damit docCache/docShas nicht unter einem laufenden Commit mutieren.
          if (busyRef.current || editingRef.current) return;
          const cur = docShas.current[en.id];
          if (en.sha && en.sha === cur) continue; // Blob-SHA unverändert
          const f = await ghGetFile(cfg, en.path);
          if (!f || f.sha === cur) continue;
          docShas.current[en.id] = f.sha;
          docCache.current[en.id] = f.text;
          const name = nameFromDoc(f.text, en.id);
          const i = nbs.findIndex((n) => n.id === en.id);
          if (i === -1) { nbs.push({ id: en.id, path: en.path, name }); nbsChanged = true; }
          else if (nbs[i].name !== name) { nbs[i] = { ...nbs[i], name }; nbsChanged = true; }
          if (en.id === activeNbRef.current) {
            setDoc(f.text);
            refreshMeta(cfg, en.path);
          }
        }
        if (nbsChanged) { setNotebooks(nbs); notebooksRef.current = nbs; }

        // Chat/Modell/Klappzustände nur übernehmen, wenn lokal weder eine
        // Speicherung geplant ist noch gerade eine läuft. Das aktive
        // Notizbuch bleibt lokal (kein Überraschungs-Wechsel beim Fokus).
        if (!stateTimer.current && !stateFlushing.current) {
          const st = await ghGetFile(cfg, STATE_PATH);
          if (st && st.sha !== stateSha.current) {
            stateSha.current = st.sha;
            try {
              const data = JSON.parse(st.text);
              const nChat = Array.isArray(data.chat) && data.chat.length ? data.chat : [WELCOME];
              const nModel = typeof data.model === "string" && MODELS.some((x) => x.id === data.model)
                ? data.model : stateRef.current.model;
              let nCollapsedAll = {};
              if (data.collapsed && typeof data.collapsed === "object") {
                const keys = Object.keys(data.collapsed);
                nCollapsedAll = keys.length && keys.every((k) => k.startsWith("s:"))
                  ? { [ROOT_NB_ID]: data.collapsed }
                  : data.collapsed;
              }
              // Auch die Dropdown-Reihenfolge vom anderen Gerät übernehmen,
              // sonst überschreibt der nächste lokale Write sie wieder.
              if (Array.isArray(data.order)) {
                const ord = data.order.filter((x) => typeof x === "string");
                const pos2 = new Map(ord.map((oid, oi) => [oid, oi]));
                const sorted = [...notebooksRef.current].sort((a, b) =>
                  (pos2.has(a.id) ? pos2.get(a.id) : 1e9) - (pos2.has(b.id) ? pos2.get(b.id) : 1e9));
                if (sorted.some((n, si) => n.id !== notebooksRef.current[si].id)) {
                  setNotebooks(sorted);
                  notebooksRef.current = sorted;
                }
              }
              // Schnellnotizen vom anderen Gerät übernehmen: Merge, Remote
              // gewinnt pro Notizbuch. Fehlt das Feld im Remote-Stand (altes
              // Gerät), lokale behalten – sie migrieren beim nächsten Write.
              const nQuick =
                data.quicknotes && typeof data.quicknotes === "object" && !Array.isArray(data.quicknotes)
                  ? Object.fromEntries(Object.entries(data.quicknotes).filter(([, v]) => Array.isArray(v)))
                  : null;
              // AutoKorrektur (v7.25): fehlt das Feld im Remote-Stand (altes
              // Gerät/state.json vor v7.25), lokalen Stand behalten – wie bei
              // Schnellnotizen oben (kein Zurücksetzen auf die Defaults nur
              // weil ein anderes Gerät noch nicht auf v7.25 aktualisiert ist).
              const nAutocorrect = data.autocorrect !== undefined
                ? sanitizeAutocorrectConfig(data.autocorrect)
                : stateRef.current.autocorrect;
              lastSavedState.current = serializeState(nChat, nModel, nCollapsedAll, activeNbRef.current,
                notebooksRef.current.map((n) => n.id), nQuick || stateRef.current.quickNotesAll, nAutocorrect);
              setChat(nChat);
              setModel(nModel);
              setCollapsedAll(nCollapsedAll);
              if (nQuick) setQuickNotesAll((loc) => ({ ...loc, ...nQuick }));
              setAutocorrect(nAutocorrect);
            } catch (e) { /* defekter State – ignorieren */ }
          }
        }
      } catch (e) { /* stiller Hintergrund-Refresh */ }
    };
    const onVis = () => { if (document.visibilityState === "visible") maybeRefresh(); };
    window.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    // Zusätzlich aktives Polling: Fokus-Events feuern nicht, wenn die Seite
    // durchgehend sichtbar bleibt (z. B. PC-Monitor, während am Handy
    // gearbeitet wird). GitHub bietet keinen Browser-Push (WebSocket) –
    // Polling alle 25 s ist der ehrlichste Ersatz; die 15-s-Drossel und die
    // busy/editing-Guards in maybeRefresh gelten weiter.
    const poll = setInterval(onVis, 25000);
    return () => {
      window.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      clearInterval(poll);
    };
  }, [refreshMeta]);

  /* ---------- Chat-Autoscroll ---------- */
  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [chat, busy]);

  /* ---------- Aufblitzen bei Dokument-Änderung ---------- */
  useEffect(() => {
    if (firstDoc.current) { firstDoc.current = false; return; }
    if (editing) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1400);
    return () => clearTimeout(t);
  }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Bild anhängen ---------- */
  const attachImage = async (file) => {
    if (!file) return;
    setImgError(null);
    try {
      const p = await prepareImage(file);
      setPendingImg(p);
    } catch (e) {
      setImgError(e && e.message ? e.message : "Bild konnte nicht übernommen werden");
    }
  };

  // Anhang beliebigen Typs: Bilder gehen den Bild-Weg (Analyse + Ablage im
  // Dokument), alles andere wird als Datei-Anhang mitgeschickt und im
  // Daten-Repo archiviert (nicht im Dokument verlinkt).
  const attachAny = (file) => {
    if (!file) return;
    if (file.type && file.type.startsWith("image/")) { attachImage(file); return; }
    setImgError(null);
    if (file.size > 25 * 1024 * 1024) {
      setImgError("Datei ist größer als 25 MB");
      return;
    }
    setPendingFile({ file, name: safeFileName(file.name) });
  };

  const handlePaste = (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.type && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) { e.preventDefault(); attachImage(f); }
        return;
      }
    }
  };

  /* ---------- Senden ---------- */
  const send = async () => {
    const text = input.trim();
    // archiving-Guard: sonst könnte eine während des Archivierens gesendete
    // Nachricht vom anschließenden setChat([WELCOME]) verschluckt werden.
    if ((!text && !pendingImg && !pendingFile) || busy || archiving) return;
    if (!connected || !settingsRef.current) { setShowSettings(true); return; }
    const cfg = settingsRef.current;

    const img = pendingImg;
    const pf = pendingFile;
    let imgId = null;

    const userMsg = { role: "user", text, ts: Date.now(), imgId: null };
    if (img) {
      imgId = newImgId();
      userMsg.imgId = imgId;
      setImgMap((prev) => ({ ...prev, [imgId]: img.dataUrl }));
    }
    if (pf) userMsg.fileName = pf.name;
    const chatWithUser = [...chat, userMsg].slice(-80);
    setChat(chatWithUser);
    setInput("");
    setPendingImg(null);
    setPendingFile(null);
    setImgError(null);
    setBusy(true);

    try {
      // Formatprüfung vor dem (bezahlten) API-Call; hochgeladen wird erst danach.
      const imgParts = img ? dataUrlParts(img.dataUrl) : null;
      if (img && !imgParts) throw new Error("Bilddaten unlesbar");

      // Dateianhang: Text best effort extrahieren (nicht extrahierbare
      // Formate werden trotzdem archiviert, das Modell erfährt nur den Namen).
      let fileInfo = null;
      let fileB64 = null;
      if (pf) {
        let ftext = null;
        try { ftext = await extractText(pf.file); } catch (e) { /* Format ohne Textextrakt */ }
        fileInfo = { name: pf.name, text: ftext };
        fileB64 = await fileToBase64(pf.file);
      }

      const nbCtx = await buildNbCtx();
      const res = await callClaude(cfg.apiKey, text, nbCtx, chat, model, img, imgId, fileInfo);

      // Bild erst nach erfolgreicher Antwort als Datei ins Daten-Repo legen
      // (keine verwaisten Dateien bei API-Fehlern), aber vor dem Dokument-
      // Commit, damit die Referenz auf allen Geräten auflösbar ist.
      if (img && imgId) {
        const path = "bilder/" + imgId + "." + extForMime(imgParts.mime);
        await ghPutFile(cfg, path, imgParts.base64, "Bild " + imgId + " hinzugefügt");
        imgIndex.current[imgId] = path;
      }

      // Dateianhang archivieren: eigener Ordner dateien/, Namenskonflikte
      // bekommen einen Zähler-Suffix. Fehler hier brechen den Turn nicht ab.
      if (pf && fileB64 !== null) {
        try {
          let name = pf.name;
          for (let i = 2; await ghGetFile(cfg, "dateien/" + name); i++) {
            const dot = pf.name.lastIndexOf(".");
            name = dot > 0
              ? pf.name.slice(0, dot) + "-" + i + pf.name.slice(dot)
              : pf.name + "-" + i;
          }
          await ghPutFile(cfg, "dateien/" + name, fileB64, "Datei „" + name + "“ aus dem Chat abgelegt");
        } catch (e) {
          setBanner({ kind: "warn", text: "Datei konnte nicht im Daten-Repo abgelegt werden: " + (e && e.message ? e.message : e) });
        }
      }

      let commit = null;
      let memoryUpdated = false;
      // v7.21 (Ops-Zuverlässigkeit, Live-Befund – siehe DECISIONS #63):
      // sammelt ALLE nicht angewendeten Ops dieses Turns (Notizbuch UND
      // Gedächtnis, über alle Ziel-Notizbücher hinweg) für EINE gebündelte
      // ⚠️-Warn-Pille (siehe buildOpsWarning), statt sie wie bisher
      // kommentarlos verschwinden zu lassen.
      const notApplied = [];

      // Ops splitten (v7.16): memory_* wirken auf das globale, notizbuch-
      // übergreifende Gedächtnis (eigene Datei/eigener Commit, siehe
      // commitMemory) – UNABHÄNGIG von einem etwaigen SHA-Konflikt beim
      // Notizbuch weiter unten (anderes Ziel, anderer Commit). Reihenfolge
      // bleibt je Gruppe erhalten (siehe splitOps).
      const { memoryOps, notebookOps } = splitOps(res.ops);
      if (memoryOps.length) {
        const memResult = await commitMemory(cfg, memoryOps);
        memoryUpdated = memResult.committed;
        for (const na of memResult.notApplied) notApplied.push(na);
      }

      if (notebookOps.length) {
        // Auto-Titel-Auflösung (v7.12 Teil B, Auftrag "automatische
        // Titel-Ermittlung überall"): NUR das neue op.content-Fragment läuft
        // durch resolveProviderLinkTitles, NIE das Bestandsdokument – Chat-
        // Änderungen bleiben minimal-invasiv (applyOps wendet das Fragment
        // ohnehin gezielt auf einen Abschnitt an). resolveProviderLinkTitles
        // wirft laut eigenem Vertrag nie; ein Fetch-Fehler lässt content
        // unverändert.
        const resolvedOps = await Promise.all(
          notebookOps.map(async (op) =>
            op && typeof op.content === "string"
              ? { ...op, content: await resolveProviderLinkTitles(op.content) }
              : op
          )
        );

        // Ops nach Ziel-Notizbuch gruppieren (Default und unbekannte Namen → aktives)
        const byName = new Map(notebooksRef.current.map((n) => [n.name.trim().toLowerCase(), n]));
        const groups = new Map();
        for (const op of resolvedOps) {
          const target =
            (op && typeof op.notebook === "string" && byName.get(op.notebook.trim().toLowerCase())) ||
            activeNotebook();
          if (!groups.has(target.id)) groups.set(target.id, []);
          groups.get(target.id).push(op);
        }

        const changed = []; // { id, name, ops }
        let conflict = false;
        for (const [nbId, ops] of groups) {
          const before = docCache.current[nbId] || "";
          const nb = notebooksRef.current.find((n) => n.id === nbId);
          // v7.21: applyOpsDetailed statt applyOps – liefert zusätzlich pro
          // Op einen Grund, falls sie NICHTS verändert hat (unbekannter Typ,
          // Abschnitt/Kapitel nicht gefunden, leerer content). Text-Ausgabe
          // ist BYTE-IDENTISCH zu applyOps (reiner Wrapper, siehe ops.js).
          const detailed = applyOpsDetailed(before, ops);
          for (const r of detailed.results) {
            if (!r.applied) notApplied.push({ type: r.type, heading: r.heading, notebook: nb ? nb.name : nbId, reason: r.reason });
          }
          // Nach dem Anwenden dokumentweit durchnummerieren: neue Quellen-
          // Fußnoten kommen als [0](url)-Platzhalter aus den ops.
          const applied = renumberCitations(detailed.text);
          if (applied === before) continue;
          // v7.22 (Review-Fund 🟡): Anlage-Platzhalter erst NACH einer
          // bereits feststehenden echten Änderung entfernen (siehe "applied
          // === before"-Ausstieg oben) – ein reiner Platzhalter-Wegfall OHNE
          // jede sonstige Änderung wird NIE für sich allein committet (kein
          // ungefragter Commit). stripInboxPlaceholder ist idempotent, kostet
          // bei fehlendem Platzhalter also nichts.
          const toCommit = stripInboxPlaceholder(applied);
          const ok = await commitDocNb(cfg, nbId, toCommit, res.commit || "Aktualisierung");
          if (!ok) { conflict = true; break; }
          changed.push({ id: nbId, name: nb ? nb.name : nbId, ops });
        }
        // v7.21: Das Modell kündigte per commit-Feld eine Änderung an, aber
        // KEIN Notizbuch wurde tatsächlich verändert (alle Ops in dieser
        // Gruppe waren wirkungslos) – genau der Live-Befund ("mehrfach als
        // erledigt angekündigt, nichts passiert"). NUR relevant außerhalb
        // eines SHA-Konflikts (der hat seine eigene, bereits aussagekräftige
        // Fehlermeldung, siehe unten).
        if (!conflict && res.commit && !changed.length) {
          notApplied.push({ reason: "Commit angekündigt, aber keine Änderung wirksam geworden" });
        }
        if (conflict) {
          // SHA-Konflikt. Achtung: vorherige Notizbücher der Schleife können
          // bereits committet sein – Teilerfolg ehrlich abbilden, damit ein
          // erneutes Senden keine Dubletten erzeugt.
          if (changed.some((c) => c.id === activeNbRef.current)) {
            setDoc(docCache.current[activeNbRef.current]);
          }
          if (!changed.length) {
            setInput((prev) => (prev.trim() ? prev : text));
            if (img) setPendingImg((prev) => prev || img);
          }
          const saved = changed.map((c) => c.name);
          const aMsg = {
            role: "assistant",
            error: true,
            ts: Date.now(),
            // Ein bereits erfolgreich geschriebenes Gedächtnis bleibt gültig,
            // auch wenn der Notizbuch-Teil dieses Turns konfliktet – beide
            // Ziele sind unabhängige Dateien/Commits (siehe oben).
            memory: memoryUpdated || undefined,
            // v7.21: bereits gesammelte notApplied-Funde (z. B. aus den
            // Gedächtnis-Ops oder aus VOR dem Konflikt erfolgreich
            // durchlaufenen Notizbuch-Gruppen) bleiben auch im Konflikt-Fall
            // sichtbar – teilweiser Erfolg soll ehrlich abgebildet werden.
            warning: buildOpsWarning(notApplied) || undefined,
            text: saved.length
              ? "Teilweise gespeichert (" + saved.join(", ") + "). Ein weiteres Notizbuch wurde " +
                "parallel geändert und NICHT gespeichert – bitte nur den fehlenden Teil neu erfassen " +
                "(nicht die ganze Nachricht erneut senden, sonst entstehen Dubletten)."
              : "Ein Notizbuch wurde zwischenzeitlich auf einem anderen Gerät geändert – " +
                "ich habe den neuen Stand geladen und nichts überschrieben. " +
                "Deine Nachricht steht wieder im Eingabefeld, bitte einfach noch einmal senden.",
          };
          setChat([...chatWithUser, aMsg].slice(-80));
          return;
        }

        if (changed.length) {
          const msg = res.commit || "Aktualisierung";
          commit = changed.length === 1 && changed[0].id === activeNbRef.current
            ? msg
            : changed.map((c) => c.name).join(", ") + " · " + msg;

          // Betroffene Abschnitte je Notizbuch automatisch aufklappen
          for (const ch of changed) {
            const touched = ch.ops.map((o) => dispHead(o.heading)).filter(Boolean);
            if (!touched.length) continue;
            setCollapsedAll((prev) => {
              const cur = prev[ch.id];
              if (!cur || !Object.keys(cur).length) return prev;
              const nc = { ...cur };
              let hit = false;
              Object.keys(nc).forEach((k) => {
                const path = k.slice(2); // "s:" abschneiden
                if (touched.some((t) => path === t || path.startsWith(t + "/"))) {
                  delete nc[k];
                  hit = true;
                }
              });
              return hit ? { ...prev, [ch.id]: nc } : prev;
            });
          }

          // Auto-Wechsel (Nutzerwunsch): Landet der Inhalt in einem anderen
          // Notizbuch und nicht auch im aktiven, dorthin springen.
          const activeChanged = changed.some((c) => c.id === activeNbRef.current);
          const others = changed.filter((c) => c.id !== activeNbRef.current);
          if (others.length && !activeChanged) {
            switchNotebook(others[0].id);
          } else if (activeChanged) {
            setDoc(docCache.current[activeNbRef.current]);
          }
        }
      }

      const aMsg = {
        role: "assistant",
        text: res.reply,
        ts: Date.now(),
        commit,
        memory: memoryUpdated || undefined,
        // v7.21 (Ops-Zuverlässigkeit, siehe DECISIONS #63): gebündelte
        // ⚠️-Warnung über nicht angewendete Ops dieses Turns – hängt als
        // Feld an DERSELBEN Assistent-Nachricht (kein eigener Chat-Eintrag),
        // bewusst NICHT als separate user-Pille wie requestFeedbacks
        // Info-Pillen: eine zusätzliche, nachträglich angehängte user-Rolle
        // OHNE folgende Assistent-Antwort würde beim NÄCHSTEN Senden zwei
        // aufeinanderfolgende user-Nachrichten in die API-Historie bringen
        // (Anthropic verlangt strikt alternierende Rollen – 400-Fehler).
        // Die Warnung erreicht das Modell trotzdem im nächsten Turn, siehe
        // lib/anthropic.js#callClaude (History-Mapping hängt sie an den
        // content-String DIESER Assistent-Nachricht an).
        warning: buildOpsWarning(notApplied) || undefined,
        sources: res.sources && res.sources.length ? res.sources : undefined,
      };
      const finalChat = [...chatWithUser, aMsg].slice(-80);
      setChat(finalChat);
      if (commit && view === "chat") setNotesDirty(true);
    } catch (e) {
      // Eingabe wie im Konfliktpfad zurückgeben, ohne Neueres zu überschreiben.
      setInput((prev) => (prev.trim() ? prev : text));
      if (img) setPendingImg((prev) => prev || img);
      // Datei-Anhang analog restaurieren – er wurde weder verarbeitet noch
      // archiviert und soll mit dem nächsten Senden wieder mitkommen.
      if (pf) setPendingFile((prev) => prev || pf);
      // Wurde das Bild nicht hochgeladen, die img-Referenz aus der Nachricht
      // nehmen (kein unauflösbares img:… nach Reload/Sync); den Datei-Chip
      // ebenso, sonst verweist er auf eine nie archivierte Datei.
      const cleaned = (img && imgId && !imgIndex.current[imgId]) || pf
        ? chatWithUser.map((m) =>
            m === userMsg
              ? {
                  ...m,
                  imgId: img && imgId && !imgIndex.current[imgId] ? null : m.imgId,
                  fileName: pf ? undefined : m.fileName,
                }
              : m)
        : chatWithUser;
      const aMsg = {
        role: "assistant",
        error: true,
        ts: Date.now(),
        text:
          "Anfrage fehlgeschlagen: " + (e && e.message ? e.message : "unbekannter Fehler") +
          ". Deine Nachricht steht wieder im Eingabefeld – sende sie einfach noch einmal.",
      };
      setChat([...cleaned, aMsg].slice(-80));
    } finally {
      setBusy(false);
    }
  };

  /* ---------- Chat archivieren (Markdown ins Daten-Repo, dann leeren) ---------- */
  const archiveChat = async () => {
    if (busy || archiving || !connected || !settingsRef.current) return;
    const cfg = settingsRef.current;
    setArchiving(true);
    try {
      // Frischen Remote-Stand dazuholen: state.json kann Nachrichten anderer
      // Geräte enthalten, die das 25s-Polling hier noch nicht geholt hat –
      // sie gehören mit ins Archiv, bevor der Chat geleert wird.
      let remoteChat = [];
      try {
        const st = await ghGetFile(cfg, STATE_PATH);
        const data = st ? JSON.parse(st.text) : null;
        if (data && Array.isArray(data.chat)) remoteChat = data.chat;
      } catch (e) { /* best effort – lokaler Stand genügt dann */ }
      const msgs = mergeChats(chat, remoteChat); // Begrüßung (ts 0) fällt raus
      if (!msgs.length) { setConfirmArchive(false); return; }
      const d = new Date();
      const md = chatToMarkdown(msgs, {
        resolveImg: (id) => imgIndex.current[id] || null,
        now: d,
      });
      const base = archiveBaseName(d);
      let path = "chats/" + base + ".md";
      for (let i = 2; await ghGetFile(cfg, path); i++) {
        path = "chats/" + base + "-" + i + ".md";
      }
      await ghPutFile(cfg, path, utf8ToB64(md), "Chat archiviert (" + msgs.length + " Nachrichten)");
      // Erst nach erfolgreichem Schreiben leeren; der Save-Effect bringt
      // den geleerten Chat debounced nach state.json (alle Geräte).
      setChat([WELCOME]);
      setConfirmArchive(false);
      setBanner({ kind: "ok", text: "Chat archiviert: " + msgs.length + " Nachrichten → " + path });
    } catch (e) {
      setBanner({
        kind: "warn",
        text: "Archivieren fehlgeschlagen: " + (e && e.message ? e.message : e) +
          " – der Chat wurde nicht geleert.",
      });
    } finally {
      setArchiving(false);
    }
  };

  /* ---------- Zuklappen (pro Notizbuch) ---------- */
  const toggleCollapse = (key) => {
    setCollapsedAll((prev) => {
      const id = activeNbRef.current;
      const cur = { ...(prev[id] || {}) };
      if (cur[key]) delete cur[key];
      else cur[key] = true;
      return { ...prev, [id]: cur };
    });
  };

  /* ---------- Hintergrundwissen (Dateien pro Notizbuch) ---------- */
  // Extrahierte Texte des Notizbuchs laden (mit Cache).
  const ensureKnowledge = async (nbId) => {
    const cfg = settingsRef.current;
    if (!cfg || !connectedRef.current) return [];
    const items = knowledgeIndex.current[nbId] || [];
    await Promise.all(items.map(async (it) => {
      if (knowledgeTexts.current[it.extractPath] !== undefined) return;
      try {
        const f = await ghGetFile(cfg, it.extractPath);
        knowledgeTexts.current[it.extractPath] = f ? f.text : "";
      } catch (e) {
        knowledgeTexts.current[it.extractPath] = "";
      }
    }));
    return items
      .map((it) => ({ name: it.name, text: knowledgeTexts.current[it.extractPath] }))
      .filter((f) => f.text);
  };

  // Kompletter KI-Kontext: alle Notizbücher + Wissen des aktiven.
  const buildNbCtx = async () => {
    const activeId = activeNbRef.current;
    const activeFiles = await ensureKnowledge(activeId);
    const others = notebooksRef.current
      .filter((n) => n.id !== activeId)
      .map((n) => ({
        notebook: n.name,
        files: (knowledgeIndex.current[n.id] || []).map((i) => i.name),
      }))
      .filter((o) => o.files.length);
    return {
      notebooks: notebooksRef.current.map((n) => ({ name: n.name, doc: docCache.current[n.id] || "" })),
      activeName: activeNotebook().name,
      knowledge: { activeFiles, others },
      memory: memoryRef.current, // globales Gedächtnis (v7.16), siehe lib/anthropic.js#buildSystem
    };
  };

  const uploadKnowledge = async (ev) => {
    const files = [...(ev.target.files || [])];
    ev.target.value = "";
    if (!files.length) return;
    if (!connectedRef.current || !settingsRef.current) { setShowSettings(true); return; }
    const cfg = settingsRef.current;
    const nbId = activeNbRef.current;
    const errors = [];
    const notes = []; // Erfolgs-Hinweise (z. B. „nur Extrakt gespeichert“)
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const step = `(${i + 1}/${files.length})`;
      try {
        if (file.size > 80 * 1024 * 1024) throw new Error("größer als 80 MB");
        // Über 25 MB wird nur der Text-Extrakt gespeichert: ein so großes
        // Original per Base64-PUT ist browserseitig fragil, und in Prompts
        // geht ohnehin nie das Original, nur der Extrakt.
        const extractOnly = file.size > 25 * 1024 * 1024;
        const name = safeFileName(file.name);
        if ((knowledgeIndex.current[nbId] || []).some((it) => it.name === name)) {
          throw new Error("Datei mit diesem Namen existiert bereits – erst löschen");
        }
        setKnowledgeBusy(`${file.name}: Text wird extrahiert … ${step}`);
        const text = await extractText(file);
        const path = knowledgeDir(nbId) + "/" + name;
        const extractPath = extractPathFor(path);
        if (extractOnly) {
          setKnowledgeBusy(`${file.name}: Extrakt wird hochgeladen … ${step}`);
          await ghPutFile(cfg, extractPath, utf8ToB64(text),
            "Wissen: Extrakt zu " + name + " (Original über 25 MB, nicht gespeichert)");
          notes.push(file.name + ": nur der Text-Extrakt wurde gespeichert (Original über 25 MB)");
        } else {
          setKnowledgeBusy(`${file.name}: Original wird hochgeladen … ${step}`);
          const putOrig = await ghPutFile(cfg, path, await fileToBase64(file), "Wissen: " + name + " hinzugefügt");
          setKnowledgeBusy(`${file.name}: Extrakt wird hochgeladen … ${step}`);
          try {
            await ghPutFile(cfg, extractPath, utf8ToB64(text), "Wissen: Extrakt zu " + name);
          } catch (e) {
            // Kein Original ohne Extrakt zurücklassen (wäre eine stumme Waise)
            try { await ghDeleteFile(cfg, path, "Wissen: Upload zurückgerollt (" + name + ")", putOrig.sha); } catch (e2) { /* best effort */ }
            throw e;
          }
        }
        knowledgeTexts.current[extractPath] = text;
        knowledgeIndex.current = {
          ...knowledgeIndex.current,
          [nbId]: [...(knowledgeIndex.current[nbId] || []), { name, path: extractOnly ? null : path, extractPath }],
        };
      } catch (e) {
        errors.push(file.name + ": " + (e && e.message ? e.message : e));
      }
    }
    setKnowledgeBusy(null);
    setKnowledgeVersion((v) => v + 1);
    if (errors.length) {
      setBanner({ kind: "warn", text: "Wissen-Upload teilweise fehlgeschlagen – " + errors.join("; ") });
    } else if (notes.length) {
      setBanner({ kind: "ok", text: notes.join("; ") });
    }
  };

  const deleteKnowledge = async (item) => {
    if (!connectedRef.current || !settingsRef.current) return;
    const cfg = settingsRef.current;
    const nbId = activeNbRef.current;
    setKnowledgeBusy(item.name + " wird gelöscht …");
    try {
      // Aktuelle Blob-SHAs holen (DELETE verlangt die SHA)
      const files = await ghListDir(cfg, knowledgeDir(nbId));
      const shaFor = (p) => { const f = files.find((x) => x.path === p); return f ? f.sha : null; };
      // Extrakt ZUERST löschen: scheitert danach das Original, bleibt ein
      // sichtbarer Eintrag zum erneuten Löschen (statt unsichtbarer Waise).
      const exSha = shaFor(item.extractPath);
      if (exSha) {
        await ghDeleteFile(cfg, item.extractPath, "Wissen: Extrakt zu " + item.name + " gelöscht", exSha);
        delete knowledgeTexts.current[item.extractPath];
      }
      const sha = item.path ? shaFor(item.path) : null; // Extrakt-only: kein Original
      if (sha) await ghDeleteFile(cfg, item.path, "Wissen: " + item.name + " gelöscht", sha);
      knowledgeIndex.current = {
        ...knowledgeIndex.current,
        [nbId]: (knowledgeIndex.current[nbId] || []).filter((it) => it.extractPath !== item.extractPath),
      };
      delete knowledgeTexts.current[item.extractPath];
    } catch (e) {
      setBanner({ kind: "warn", text: "Löschen fehlgeschlagen: " + (e && e.message ? e.message : e) });
    } finally {
      setKnowledgeBusy(null);
      setKnowledgeVersion((v) => v + 1);
    }
  };

  /* ---------- Notizbuch wechseln / anlegen ---------- */
  const switchNotebook = (id) => {
    if (editingRef.current || id === activeNbRef.current) return;
    const nb = notebooksRef.current.find((n) => n.id === id);
    if (!nb) return;
    setActiveNb(id);
    activeNbRef.current = id;
    setDoc(docCache.current[id] ?? INITIAL_DOC);
    setActiveSec(0);
    setExpanded(null);
    setExpandedData(null);
    if (settingsRef.current && connectedRef.current) refreshMeta(settingsRef.current, nb.path);
  };

  const createNotebook = async (rawName) => {
    const name = String(rawName || "").trim();
    if (!name) { setNbError("Bitte einen Namen eingeben."); return; }
    if (!connectedRef.current || !settingsRef.current) {
      setNbError("Bitte zuerst in den Einstellungen verbinden.");
      return;
    }
    if (notebooksRef.current.some((n) => n.name.trim().toLowerCase() === name.toLowerCase())) {
      setNbError("Es gibt bereits ein Notizbuch mit diesem Namen.");
      return;
    }
    let id = slugify(name);
    while (id === ROOT_NB_ID || notebooksRef.current.some((n) => n.id === id)) id += "-2";
    const path = "notizbuecher/" + id + ".md";
    setCreatingNb(true);
    setNbError(null);
    try {
      const init = initialDocFor(name);
      const put = await ghPutFile(settingsRef.current, path, utf8ToB64(init), "Notizbuch „" + name + "“ angelegt");
      docCache.current[id] = init;
      docShas.current[id] = put.sha;
      const nbs = [...notebooksRef.current, { id, path, name }];
      setNotebooks(nbs);
      notebooksRef.current = nbs;
      setActiveNb(id);
      activeNbRef.current = id;
      setDoc(init);
      setActiveSec(0);
      setMeta({ count: 1, lastTs: Date.now() });
      setShowNewNb(false);
      setNewNbName("");
    } catch (e) {
      setNbError(e && e.message ? e.message : String(e));
    } finally {
      setCreatingNb(false);
    }
  };

  /* ---------- Notizbuch-Verwaltung (Admin-Seite) ---------- */
  // Reihenfolge im Dropdown: wandert über state.json (order) mit.
  const moveNotebook = (id, delta) => {
    const nbs = [...notebooksRef.current];
    const i = nbs.findIndex((n) => n.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= nbs.length) return;
    [nbs[i], nbs[j]] = [nbs[j], nbs[i]];
    setNotebooks(nbs);
    notebooksRef.current = nbs;
  };

  // Umbenennen = H1-Titelzeile der Datei ändern (die Datei ist die einzige
  // Wahrheit für den Namen); Pfad/Slug bleiben stabil.
  const renameNotebook = async (id, rawName) => {
    if (busyRef.current) { setNbAdminError("Bitte warten – es läuft gerade eine Anfrage."); return; }
    const name = String(rawName || "").trim();
    const nb = notebooksRef.current.find((n) => n.id === id);
    if (!nb || !name || name === nb.name) { setNbRenameId(null); return; }
    if (notebooksRef.current.some((n) => n.id !== id && n.name.trim().toLowerCase() === name.toLowerCase())) {
      setNbAdminError("Es gibt bereits ein Notizbuch mit diesem Namen.");
      return;
    }
    if (!connectedRef.current || !settingsRef.current) {
      setNbAdminError("Bitte zuerst in den Einstellungen verbinden.");
      return;
    }
    setNbAdminBusy(id);
    setNbAdminError(null);
    try {
      const lines = (docCache.current[id] ?? "").split("\n");
      if (/^#\s+/.test(lines[0] || "")) lines[0] = "# " + name;
      else lines.unshift("# " + name);
      const newText = lines.join("\n");
      const ok = await commitDocNb(settingsRef.current, id, newText,
        "Notizbuch umbenannt: „" + nb.name + "“ → „" + name + "“");
      if (!ok) return; // Konflikt: commitDocNb hat Banner gesetzt
      const nbs = notebooksRef.current.map((n) => (n.id === id ? { ...n, name } : n));
      setNotebooks(nbs);
      notebooksRef.current = nbs;
      if (id === activeNbRef.current) setDoc(newText);
      setNbRenameId(null);
    } catch (e) {
      setNbAdminError(e && e.message ? e.message : String(e));
    } finally {
      setNbAdminBusy(null);
    }
  };

  // „Smart Icon“ setzen: Bild wird quadratisch aufbereitet (mittig
  // beschnitten bzw. stark Längliches eingepasst) und als icons/<id>.png
  // im Daten-Repo abgelegt; die SHA erlaubt spätere Ersetzung.
  const setNotebookIcon = async (id, file) => {
    if (!file) return;
    if (!connectedRef.current || !settingsRef.current) {
      setNbAdminError("Bitte zuerst in den Einstellungen verbinden.");
      return;
    }
    const nb = notebooksRef.current.find((n) => n.id === id);
    if (!nb) return;
    setNbAdminBusy(id);
    setNbAdminError(null);
    try {
      const { dataUrl, base64 } = await makeNotebookIcon(file);
      const msg = "Icon für Notizbuch „" + nb.name + "“";
      const doPut = (sha) =>
        ghPutFile(settingsRef.current, "icons/" + id + ".png", base64, msg, sha || undefined);
      let put;
      try {
        put = await doPut(iconShas.current[id]);
      } catch (e) {
        if (!(e instanceof ShaConflictError)) throw e;
        // Anderes Gerät hat das Icon geändert: aktuelle SHA holen, einmal
        // erneut versuchen (Icon-Ersetzen ist gewollt Last-Writer-Wins).
        const files = await ghListDir(settingsRef.current, "icons");
        const cur = files.find((f) => f.name.toLowerCase() === id + ".png");
        put = await doPut(cur ? cur.sha : undefined);
      }
      iconShas.current[id] = put.sha;
      setNbIcons((prev) => ({ ...prev, [id]: dataUrl }));
    } catch (e) {
      setNbAdminError(e && e.message ? e.message : String(e));
    } finally {
      setNbAdminBusy(null);
    }
  };

  const removeNotebookIcon = async (id) => {
    if (!connectedRef.current || !settingsRef.current || !iconShas.current[id]) return;
    setNbAdminBusy(id);
    setNbAdminError(null);
    try {
      const nb = notebooksRef.current.find((n) => n.id === id);
      await ghDeleteFile(settingsRef.current, "icons/" + id + ".png",
        "Icon für Notizbuch „" + (nb ? nb.name : id) + "“ entfernt", iconShas.current[id]);
      delete iconShas.current[id];
      setNbIcons((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (e) {
      setNbAdminError(e && e.message ? e.message : String(e));
    } finally {
      setNbAdminBusy(null);
    }
  };

  // Löschen entfernt die Notizbuch-Datei und ihr Hintergrundwissen aus dem
  // Daten-Repo (Bilder bleiben – sie sind repo-weit abgelegt). Das letzte
  // Notizbuch ist nicht löschbar.
  const deleteNotebook = async (id) => {
    if (busyRef.current) { setNbAdminError("Bitte warten – es läuft gerade eine Anfrage."); return; }
    const nb = notebooksRef.current.find((n) => n.id === id);
    if (!nb || notebooksRef.current.length <= 1) return;
    if (!connectedRef.current || !settingsRef.current) {
      setNbAdminError("Bitte zuerst in den Einstellungen verbinden.");
      return;
    }
    const cfg = settingsRef.current;
    setNbAdminBusy(id);
    setNbAdminError(null);
    try {
      // Hintergrundwissen zuerst (frische SHAs übers Listing)
      const kFiles = await ghListDir(cfg, knowledgeDir(id));
      for (const f of kFiles) {
        await ghDeleteFile(cfg, f.path, "Notizbuch „" + nb.name + "“ gelöscht: Wissensdatei entfernt", f.sha);
      }
      await ghDeleteFile(cfg, nb.path, "Notizbuch „" + nb.name + "“ gelöscht", docShas.current[id]);
      if (iconShas.current[id]) {
        try {
          await ghDeleteFile(cfg, "icons/" + id + ".png", "Notizbuch „" + nb.name + "“ gelöscht: Icon entfernt", iconShas.current[id]);
        } catch (e2) { /* best effort – verwaistes Icon stört nicht */ }
        delete iconShas.current[id];
        setNbIcons((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
      const nbs = notebooksRef.current.filter((n) => n.id !== id);
      setNotebooks(nbs);
      notebooksRef.current = nbs;
      delete docCache.current[id];
      delete docShas.current[id];
      delete knowledgeIndex.current[id];
      setCollapsedAll((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setQuickNotesAll((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (id === activeNbRef.current) {
        const first = nbs[0];
        setActiveNb(first.id);
        activeNbRef.current = first.id;
        setDoc(docCache.current[first.id] ?? INITIAL_DOC);
        setActiveSec(0);
        refreshMeta(cfg, first.path);
      }
      setNbDeleteId(null);
    } catch (e) {
      setNbAdminError(e && e.message ? e.message : String(e));
    } finally {
      setNbAdminBusy(null);
    }
  };

  /* ---------- Checklisten: Abhaken direkt in der Ansicht ---------- */
  // Ändert genau die betroffene Zeile im Markdown und committet sie.
  // Schnelle Folge-Klicks werden über eine Kette serialisiert, damit
  // jeder Commit mit der dann aktuellen SHA läuft.
  const toggleTask = (lineIdx, checked) => {
    const nbId = activeNbRef.current;
    const lines = (docCache.current[nbId] ?? docRef.current).split("\n");
    const m = TASK_RE.exec(lines[lineIdx] || "");
    if (!m) return;
    lines[lineIdx] = m[1] + (checked ? "x" : " ") + m[3] + m[4];
    const newText = lines.join("\n");
    docCache.current[nbId] = newText;
    docRef.current = newText;
    if (nbId === activeNbRef.current) setDoc(newText);
    if (connected && settingsRef.current) {
      const label = m[4].replace(/<[^>]+>/g, "").replace(/[*_~`]/g, "").trim().slice(0, 40);
      const msg = (checked ? "Erledigt: " : "Wieder offen: ") + (label || "Aufgabe");
      const cfg = settingsRef.current;
      const epoch = taskEpoch.current;
      taskChain.current = taskChain.current
        .then(async () => {
          // Nach einem SHA-Konflikt basieren bereits eingereihte Commits auf
          // einem verworfenen Stand – nicht mehr schreiben (Schutz bleibt intakt).
          if (taskEpoch.current !== epoch) return;
          const ok = await commitDocNb(cfg, nbId, newText, msg);
          if (!ok) taskEpoch.current++;
        })
        .catch(() => {});
    }
  };

  /* ---------- Layout (Splitter) & Schnellnotizen: pro Gerät merken ---------- */
  // Debounced: beim Ziehen/Tippen ändert sich der State bis zu 60×/s.
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch (e) { /* egal */ }
    }, 300);
    return () => clearTimeout(t);
  }, [layout]);
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(QUICKNOTES_KEY, JSON.stringify(quickNotesAll)); } catch (e) { /* egal */ }
    }, 300);
    return () => clearTimeout(t);
  }, [quickNotesAll]);

  // Splitter: kind "chat" = Grenze Chat/Dokument (Prozent),
  // kind "nav" = Grenze Dokument/Abschnittsleiste (Pixel von rechts).
  const startSplit = (e, kind) => {
    e.preventDefault();
    const handle = e.currentTarget;
    const rect = mainRef.current ? mainRef.current.getBoundingClientRect() : null;
    if (!rect) return;
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ohne Capture weiter */ }
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
    };
    const move = (ev) => {
      if (ev.buttons === 0) { up(); return; } // Taste außerhalb losgelassen
      if (kind === "chat") {
        const pct = ((ev.clientX - rect.left) / rect.width) * 100;
        setLayout((l) => ({ ...l, chatPct: Math.min(80, Math.max(20, pct)) }));
      } else {
        const w = rect.right - ev.clientX;
        setLayout((l) => ({ ...l, navW: Math.min(360, Math.max(96, w)) }));
      }
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  /* ---------- Schnellnotizen (Post-its, pro Notizbuch) ---------- */
  const addQuickNote = () => {
    const nbId = activeNbRef.current;
    setQuickNotesAll((prev) => {
      const cur = prev[nbId] || [];
      const n = cur.length;
      return {
        ...prev,
        [nbId]: [...cur, {
          id: newImgId(),
          text: "",
          x: 90 + (n % 5) * 32,
          y: 90 + (n % 5) * 32,
          w: 260,
          h: 200,
        }],
      };
    });
  };

  const updateQuickNote = (id, patch) => {
    const nbId = activeNbRef.current;
    setQuickNotesAll((prev) => ({
      ...prev,
      [nbId]: (prev[nbId] || []).map((q) => (q.id === id ? { ...q, ...patch } : q)),
    }));
  };

  const removeQuickNote = (id) => {
    const nbId = activeNbRef.current;
    setQuickNotesAll((prev) => ({
      ...prev,
      [nbId]: (prev[nbId] || []).filter((q) => q.id !== id),
    }));
  };

  // OK: Inhalt in den Prompt übernehmen, Notiz löschen.
  const submitQuickNote = (id) => {
    const n = quickNotes.find((q) => q.id === id);
    if (!n) return;
    const text = n.text.trim();
    if (text) {
      setInput((prev) => (prev.trim() ? prev + "\n\n" : "") + "Neue Schnellnotiz:\n" + text);
      setView("chat");
    }
    removeQuickNote(id);
  };

  /* ---------- Abschnitts-Navigation (Tabs rechts / mobiler Drawer) ---------- */
  // v7.14: parseTree liefert zusätzlich "chapters" (##-Abschnitte, die von
  // einer "# "-Zeile gruppiert werden); "sections" bleibt unverändert die
  // flache Liste mit globalem Index (jede Section trägt jetzt "chapter").
  const { sections, chapters } = useMemo(() => {
    const t = parseTree(doc);
    return { sections: t.sections, chapters: t.chapters };
  }, [doc]);

  // Leisten-Klappzustand der Kapitel-Gruppen (v7.14): rein UI-lokaler
  // State, NICHT persistiert (kein state.json/localStorage) – klappt in der
  // Leiste NUR die Liste der H2-Reiter unter einem Kapitel ein/aus. Das ist
  // ein GETRENNTES Konzept vom Klapp-Zustand des Kapitels IM DOKUMENT
  // (collapsedAll, Schlüssel "c:"+Titel, synct über state.json): ein
  // Kapitel kann in der Leiste eingeklappt sein, während es im Dokument
  // aufgeklappt bleibt, und umgekehrt. Schlüssel enthält die Notizbuch-Id,
  // damit ein Wechsel des Notizbuchs die Klappzustände nicht vermischt
  // (aber eben ohne Persistenz – Default nach Neuladen ist immer
  // aufgeklappt).
  const [navChapCollapsed, setNavChapCollapsed] = useState({});
  const navChapKey = (title) => activeNb + "::" + title;
  const toggleNavChap = (title) => {
    const key = navChapKey(title);
    setNavChapCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Scroll-Spy (onDocScroll unten) setzt activeSec; liegt der aktive
  // Abschnitt in einem Kapitel, das in der LEISTE gerade eingeklappt ist,
  // klappt es automatisch auf (sonst wäre die Hervorhebung unsichtbar).
  useEffect(() => {
    if (!chapters.length) return;
    const sec = sections[activeSec];
    const chap = sec ? chapters[sec.chapter] : null;
    if (!chap || chap.title === null) return;
    const key = navChapKey(chap.title);
    setNavChapCollapsed((prev) => (prev[key] ? { ...prev, [key]: false } : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSec, chapters, sections, activeNb]);

  // Drawer per Escape schließen
  useEffect(() => {
    if (!navDrawer) return;
    const onKey = (e) => { if (e.key === "Escape") setNavDrawer(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navDrawer]);

  // Ein einzelner H2-Reiter – unverändertes Aussehen, jetzt als Helfer, weil
  // er sowohl flach (kein Kapitel) als auch eingerückt unter einem
  // Kapitel-Kopf gebraucht wird.
  const renderSecTab = (sec, si) => (
    <button
      key={si + sec.title}
      onClick={() => { gotoSection(si, sec.title); setNavDrawer(false); }}
      title={decodeBasicEntities(sec.title)}
      className={"w-full text-left text-xs pl-2.5 pr-2 py-1.5 mb-1.5 truncate rounded-r-xl border border-l-0 shadow-sm transition-colors " +
        (activeSec === si
          ? "bg-white border-indigo-300 text-indigo-900 font-medium shadow"
          : "bg-gradient-to-r from-slate-50 to-slate-100 border-slate-200 text-slate-600 hover:from-indigo-50 hover:to-indigo-100 hover:text-slate-900")}
    >
      {decodeBasicEntities(sec.title)}
    </button>
  );

  // Gemeinsamer Inhalt für die Desktop-Leiste und den mobilen Drawer;
  // das Schließen des Drawers ist am Desktop ein No-op.
  const sectionNavContent = (
    <>
      <button
        onClick={() => { addQuickNote(); setNavDrawer(false); }}
        className="w-full flex items-center gap-1.5 text-left text-xs font-medium pl-2.5 pr-2 py-2 mb-2 rounded-r-xl border border-l-0 border-amber-300 bg-gradient-to-r from-amber-50 to-amber-100 text-amber-900 shadow-sm hover:to-amber-200"
        title="Neue Schnellnotiz (Post-it)"
      >
        <StickyNote size={13} className="shrink-0" />
        Schnellnotiz
      </button>
      {!chapters.length
        ? sections.map((sec, si) => renderSecTab(sec, si))
        : chapters.map((chap, ci) => {
            const secsInChap = [];
            sections.forEach((sec, si) => { if (sec.chapter === ci) secsInChap.push([sec, si]); });
            // Implizites titelloses Kapitel ("H2 vor dem ersten H1"): flach
            // wie ohne Kapitel, kein Gruppen-Kopf.
            if (chap.title === null) return secsInChap.map(([sec, si]) => renderSecTab(sec, si));
            const navClosed = !!navChapCollapsed[navChapKey(chap.title)];
            const chapActive = sections[activeSec] && sections[activeSec].chapter === ci;
            return (
              <div key={"navchap" + ci} className="mb-1.5">
                <div
                  className={"flex items-stretch rounded-r-xl border border-l-0 shadow-sm mb-1 " +
                    (chapActive
                      ? "border-indigo-300 bg-gradient-to-r from-indigo-100 to-indigo-200"
                      : "border-slate-300 bg-gradient-to-r from-slate-100 to-slate-200")}
                >
                  {/* Chevron klappt NUR die Liste in der Leiste ein/aus
                      (lokaler UI-State, s. o.) – Klick auf den TITEL
                      navigiert stattdessen und klappt das Kapitel im
                      DOKUMENT auf (siehe gotoChapter). Getrennte Buttons +
                      stopPropagation, damit sich beide Gesten nicht
                      gegenseitig auslösen. */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleNavChap(chap.title); }}
                    title={navClosed ? "Abschnitte einblenden" : "Abschnitte ausblenden"}
                    className="px-1.5 py-1.5 shrink-0 text-slate-500 hover:text-slate-800"
                  >
                    <ChevronDown size={13} className={navClosed ? "-rotate-90" : ""} />
                  </button>
                  <button
                    onClick={() => { gotoChapter(ci, chap.title); setNavDrawer(false); }}
                    title={decodeBasicEntities(chap.title)}
                    className={"flex-1 min-w-0 text-left text-xs font-semibold py-1.5 pr-2 truncate " +
                      (chapActive ? "text-indigo-900" : "text-slate-800")}
                  >
                    {decodeBasicEntities(chap.title)}
                  </button>
                </div>
                {!navClosed && (
                  <div className="pl-3">
                    {secsInChap.map(([sec, si]) => renderSecTab(sec, si))}
                  </div>
                )}
              </div>
            );
          })}
    </>
  );

  const gotoSection = (si, title) => {
    const sec = sections[si];
    const chap = sec && chapters.length ? chapters[sec.chapter] : null;
    const chapKey = chap && chap.title !== null ? "c:" + chap.title : null;
    // Snapshot AUS DEM AKTUELLEN Render lesen (nicht im Updater unten): der
    // synchrone Scroll direkt danach muss wissen, ob das Kapitel gerade
    // erst aufklappt (siehe scrollToTarget unten).
    const wasChapCollapsed = !!(chapKey && collapsed[chapKey]);
    setCollapsedAll((prev) => {
      const id = activeNbRef.current;
      const cur = prev[id];
      const hasSec = cur && cur["s:" + title];
      const hasChap = chapKey && cur && cur[chapKey];
      if (!hasSec && !hasChap) return prev;
      const n = { ...cur };
      delete n["s:" + title];
      if (chapKey) delete n[chapKey];
      return { ...prev, [id]: n };
    });
    setActiveSec(si);
    const scrollToTarget = () => {
      const root = docScrollRef.current;
      const el = document.getElementById("sec-" + si);
      if (!root || !el) return;
      root.scrollTop =
        el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 4;
    };
    if (wasChapCollapsed) {
      // War das ENTHALTENDE Kapitel im Dokument eingeklappt, existiert der
      // Abschnitts-Anker ("sec-"+si) im DOM noch gar nicht (ein
      // eingeklapptes Kapitel verbirgt seine Abschnitte VOLLSTÄNDIG, siehe
      // DocView) – anders als ein einzelner eingeklappter ##-Abschnitt, der
      // seine Kopfzeile immer behält. Der Anker entsteht erst mit dem
      // nächsten Render; ein Tick später reicht (React hat den State-Update
      // aus diesem Klick-Handler dann längst gerendert).
      setTimeout(scrollToTarget, 0);
    } else {
      // Synchron scrollen: Das Aufklappen des Ziel-Abschnitts verschiebt
      // dessen Kopfzeile nicht, und RAF/Smooth-Scroll laufen in
      // eingebetteten Browsern (Hintergrund-Tabs) nicht zuverlässig.
      scrollToTarget();
    }
  };

  // Klick auf einen Kapitel-TITEL in der Leiste (v7.14): navigiert zum
  // Kapitel-Anker und klappt es IM DOKUMENT auf, falls zu (der Anker selbst
  // bleibt bei einem eingeklappten Kapitel immer im DOM, siehe DocView – nur
  // seine Abschnitte verschwinden -, daher hier IMMER synchron scrollbar).
  const gotoChapter = (ci, title) => {
    setCollapsedAll((prev) => {
      const id = activeNbRef.current;
      const cur = prev[id];
      const ck = "c:" + title;
      if (!cur || !cur[ck]) return prev;
      const n = { ...cur };
      delete n[ck];
      return { ...prev, [id]: n };
    });
    const chap = chapters[ci];
    if (chap && chap.secFrom < chap.secTo) setActiveSec(chap.secFrom);
    const root = docScrollRef.current;
    const el = document.getElementById("chap-" + ci);
    if (!root || !el) return;
    root.scrollTop =
      el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 4;
  };

  const onDocScroll = () => {
    const root = docScrollRef.current;
    if (!root) return;
    let act = 0;
    if (root.scrollTop + root.clientHeight >= root.scrollHeight - 2) {
      // Ganz unten: letzter Abschnitt gilt als aktiv, auch wenn seine
      // Überschrift die Oberkante nie erreicht.
      act = sections.length - 1;
    } else {
      const rootTop = root.getBoundingClientRect().top;
      for (let i = 0; i < sections.length; i++) {
        const el = document.getElementById("sec-" + i);
        if (el && el.getBoundingClientRect().top - rootTop <= 24) act = i;
      }
    }
    setActiveSec(act);
  };

  /* ---------- Feedback nach manuellen Änderungen ---------- */
  // Gleiche Behandlung wie Chat-Eingaben (Nutzerwunsch): Nach einer manuellen
  // Bearbeitung schaut das Modell einmal über die Änderung. Meldet es nichts
  // („OK“), bleibt der Chat unberührt – kein erzwungenes Feedback.
  // v7.16: res.ops (inkl. etwaiger memory_*-Ops) wird hier bewusst NIE
  // ausgewertet/angewendet – siehe den Kommentar unten ("ops werden hier
  // bewusst NIE angewendet"). Das gilt explizit AUCH fürs globale
  // Gedächtnis: der Feedback-Trigger verlangt laut feedback.js ohnehin
  // "ops":[], das Modell kann sich in diesem Pfad also nichts merken –
  // eine bewusste, dokumentierte Einschränkung, keine vergessene Ausnahme.
  const requestFeedback = async (oldDoc, newDoc) => {
    const cfg = settingsRef.current;
    if (!connectedRef.current || !cfg || !cfg.apiKey) return;
    let diffText = "";
    try {
      const d = diffLines(oldDoc, newDoc);
      if (d) {
        diffText = contextize(d)
          .map((r) =>
            r.t === "gap" ? "···"
            : r.t === "info" ? r.l
            : (r.t === "a" ? "+ " : r.t === "d" ? "− " : "  ") + r.l)
          .join("\n");
      }
    } catch (e) { /* Diff ist optional */ }
    const nb = activeNotebook();
    const trigger = buildFeedbackTrigger(nb.name, diffText);
    setBusy(true);
    setBusyLabel("prüft die Änderung …");
    try {
      const nbCtx = await buildNbCtx();
      const res = await callClaude(cfg.apiKey, trigger, nbCtx, stateRef.current.chat, model, null, null);
      const reply = (res.reply || "").trim();
      if (!isNoFeedback(reply)) {
        // ops werden hier bewusst NIE angewendet – reine Rückmeldung.
        // v7.11: nur im Feedback-Pfad (best effort, siehe feedback.js)
        // beinahe-identische Absätze innerhalb der Antwort selbst entfernen.
        const dedupedReply = dedupeFeedbackParagraphs(reply);
        setChat((prev) => [...prev,
          { role: "user", info: true, ts: Date.now(), text: "Notizbuch „" + nb.name + "“ manuell bearbeitet" },
          {
            role: "assistant",
            ts: Date.now(),
            text: dedupedReply,
            sources: res.sources && res.sources.length ? res.sources : undefined,
          },
        ].slice(-80));
        if (viewRef.current !== "chat") setChatDirty(true);
      }
    } catch (e) {
      /* Feedback ist best effort – kein Fehler-Spam im Chat */
    } finally {
      setBusy(false);
      setBusyLabel("strukturiert …");
    }
  };

  /* ---------- Manuelles Bearbeiten (WYSIWYG) ---------- */
  const startEdit = () => setEditing(true);
  const cancelEdit = () => setEditing(false);
  // Bekommt das fertige Markdown aus dem WYSIWYG-Editor.
  const saveEdit = async (md) => {
    if (busy) return; // keine parallelen Prüf-/Sendeläufe
    const oldDoc = doc;
    const nbId = activeNbRef.current;
    setSavingEdit(true);
    let cleaned;
    let conflict = false;
    try {
      // Auto-Titel-Auflösung (v7.12 Teil B, Auftrag "automatische Titel-
      // Ermittlung überall"): läuft über das GANZE Dokument, VOR der
      // übrigen Bereinigung/renumberCitations – deckt sowohl frisch
      // eingefügte/eingetippte Provider-Links ab (Paste beim Editieren,
      // vom Link-Popover-Auto-Fetch evtl. schon aufgelöst, aber z. B. auch
      // per Markdown-Paste möglich) ALS AUCH alte, noch unaufgelöste Links
      // (Titel===URL, z. B. vor v7.12 gespeichert) – Letzteres bewusst
      // gewollt (siehe Auftrag), auch wenn dadurch ein Speichern OHNE
      // sonstige inhaltliche Änderung einen Commit auslösen kann.
      // resolveProviderLinkTitles wirft laut eigenem Vertrag nie – ein
      // Fetch-Fehler lässt den Text einfach unaufgelöst, das Speichern
      // läuft ungehindert weiter (Await hier im vorhandenen
      // Speicher-Busy-Zustand savingEdit, siehe oben). Defensiver
      // .catch()-Fallback auf das UNAUFGELÖSTE md (Review-Fix 🔵, vor dem
      // Commit gemeldet): bräche der "wirft nie"-Vertrag doch einmal, wäre
      // `cleaned` sonst nie zugewiesen und die manuelle Bearbeitung ginge
      // beim Schließen des Editors STILL verloren (kein Commit, kein
      // Fehler-Banner) – der Fallback stellt sicher, dass mindestens der
      // unaufgelöste Text gespeichert wird.
      const resolvedMd = await resolveProviderLinkTitles(md).catch(() => md);
      // v7.22 (Review-Fund 🟡): stripInboxPlaceholder läuft HIER
      // bedingungslos (anders als in send(), siehe dort) – der Editor-Save
      // schreibt ohnehin nur, wenn sich "cleaned" unten von oldDoc
      // unterscheidet; ist der Platzhalter der EINZIGE Unterschied, ist das
      // GENAU der gewünschte Effekt ("verschwindet bei Bestands-
      // Notizbüchern beim nächsten Speichern automatisch"). Der leer-
      // geräumte Editor (unten, INITIAL_DOC-Zweig) bleibt bewusst
      // unangetastet – das frische Template darf den Platzhalter behalten.
      cleaned = resolvedMd.trim()
        ? stripInboxPlaceholder(renumberCitations(resolvedMd.replace(/\n{3,}/g, "\n\n").trim() + "\n"))
        : INITIAL_DOC;
      if (cleaned !== oldDoc) {
        if (connected && settingsRef.current) {
          const ok = await commitDocNb(settingsRef.current, nbId, cleaned, "Manuelle Bearbeitung");
          conflict = !ok;
        }
        if (!conflict) {
          docCache.current[nbId] = cleaned;
          setDoc(cleaned);
        }
      }
    } finally {
      setSavingEdit(false);
    }
    if (conflict) return;
    setEditing(false);
    if (cleaned !== oldDoc) requestFeedback(oldDoc, cleaned); // bewusst nicht awaited
  };

  /* ---------- Historie (echte Git-Commits) ---------- */
  const openHistory = () => {
    setShowHistory(true);
    setExpanded(null);
    setExpandedData(null);
    setHistoryError(null);
    if (!connected || !settingsRef.current) { setHistory([]); return; }
    setHistoryLoading(true);
    ghListCommits(settingsRef.current, activeNotebook().path, 30)
      .then((list) => setHistory(list))
      .catch((e) => setHistoryError(e && e.message ? e.message : String(e)))
      .finally(() => setHistoryLoading(false));
  };

  const loadVersion = async (sha) => {
    const path = activeNotebook().path;
    const key = path + "@" + sha;
    if (versionCache.current.has(key)) return versionCache.current.get(key);
    const f = await ghGetFile(settingsRef.current, path, sha);
    const text = f ? f.text : null; // null: Datei existierte in diesem Stand noch nicht
    versionCache.current.set(key, text);
    return text;
  };

  const toggleExpand = async (entry) => {
    if (expanded === entry.sha) { setExpanded(null); setExpandedData(null); return; }
    setExpanded(entry.sha);
    setExpandedData(null);
    try {
      const text = await loadVersion(entry.sha);
      const parentText = entry.parent ? await loadVersion(entry.parent) : null;
      setExpandedData({ sha: entry.sha, text, parentText });
    } catch (e) {
      setExpandedData({ sha: entry.sha, error: e && e.message ? e.message : String(e) });
    }
  };

  // Wiederherstellen = alten Stand als NEUEN Commit schreiben (kein Force-Push)
  const restore = async (entry) => {
    const nb = activeNotebook();
    const text = versionCache.current.get(nb.path + "@" + entry.sha);
    if (typeof text !== "string" || text === doc) return;
    const ok = await commitDocNb(settingsRef.current, nb.id, text, "Wiederhergestellt: Stand " + fmtStamp(entry.ts));
    if (ok) {
      setDoc(text);
      setShowHistory(false);
      setExpanded(null);
      setExpandedData(null);
    }
  };

  /* ---------- Export / Kopieren / Backup ---------- */
  const downloadBlob = (content, mime, filename) => {
    try {
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { /* Download nicht möglich */ }
  };

  // Dateiname nach aktivem Notizbuch (QA-Finding G2: war fix „wissensbasis-…“)
  const exportMd = () =>
    downloadBlob(doc, "text/markdown",
      slugify(activeName) + "-" + new Date().toISOString().slice(0, 10) + ".md");

  const exportBackup = async () => {
    const images = { ...imgMap };
    const cfg = settingsRef.current;
    if (connected && cfg) {
      for (const [id, path] of Object.entries(imgIndex.current)) {
        if (images[id]) continue;
        try {
          const blob = await ghGetBlob(cfg, path);
          if (blob) images[id] = await blobToDataURL(blob.slice(0, blob.size, mimeForName(path)));
        } catch (e) { /* Bild überspringen */ }
      }
    }
    downloadBlob(
      JSON.stringify({
        v: 2,
        notebooks: notebooksRef.current.map((n) => ({ name: n.name, doc: docCache.current[n.id] || "" })),
        active: activeNbRef.current,
        doc, // Kompatibilität zum v1-Format: das aktive Notizbuch
        history: [],
        chat,
        model,
        collapsed: collapsedAll,
        images,
      }, null, 2),
      "application/json",
      "notizbuch-backup-" + new Date().toISOString().slice(0, 10) + ".json"
    );
  };

  const copyMd = async () => {
    try {
      await navigator.clipboard.writeText(doc);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) { /* Zwischenablage nicht verfügbar */ }
  };

  /* ---------- Import des Artifact-Backups ---------- */
  const importBackup = (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        runImport(data);
      } catch (e) {
        setBanner({ kind: "warn", text: "Import fehlgeschlagen: Datei ist kein gültiges JSON." });
      }
    };
    reader.readAsText(file);
    ev.target.value = "";
  };

  const runImport = async (data) => {
    const isV2 = data && Array.isArray(data.notebooks) && data.notebooks.length;
    if (!isV2 && (!data || typeof data.doc !== "string" || !data.doc.trim())) {
      setBanner({ kind: "warn", text: "Import fehlgeschlagen: Datei enthält kein gültiges Notizbuch-Backup." });
      return;
    }
    if (!connected || !settingsRef.current) {
      setShowSettings(true);
      return;
    }
    const cfg = settingsRef.current;

    const nh = Array.isArray(data.history) ? data.history : [];
    const nc = Array.isArray(data.chat) && data.chat.length ? data.chat.slice(-80) : [WELCOME];
    const nm = typeof data.model === "string" && MODELS.some((x) => x.id === data.model)
      ? data.model : model;
    // Klappzustände: v2 = Map pro Notizbuch, v1 = flach → Root-Notizbuch
    // (dorthin geht auch das v1-Dokument)
    let ncolAll = stateRef.current.collapsedAll || {};
    if (data.collapsed && typeof data.collapsed === "object") {
      const keys = Object.keys(data.collapsed);
      ncolAll = keys.length && keys.every((k) => k.startsWith("s:"))
        ? { ...ncolAll, [ROOT_NB_ID]: data.collapsed }
        : data.collapsed;
    }
    const imgs = data.images && typeof data.images === "object"
      ? Object.entries(data.images).filter(([id, url]) =>
          typeof url === "string" && /^[a-zA-Z0-9]+$/.test(id) && url.startsWith("data:image/"))
      : [];

    try {
      // 1. Bilder als Dateien anlegen (bereits vorhandene überspringen)
      let done = 0;
      for (const [id, url] of imgs) {
        done++;
        setImporting(`Bild ${done}/${imgs.length} wird übertragen …`);
        if (imgIndex.current[id]) continue;
        const parts = dataUrlParts(url);
        if (!parts) continue;
        const path = "bilder/" + id + "." + extForMime(parts.mime);
        await ghPutFile(cfg, path, parts.base64, "Import: Bild " + id);
        imgIndex.current[id] = path;
      }

      // 2. Notizbücher übernehmen
      if (isV2) {
        for (const item of data.notebooks) {
          if (!item || typeof item.doc !== "string" || !item.doc.trim()) continue;
          const nm2 = typeof item.name === "string" && item.name.trim() ? item.name.trim() : "Wissensbasis";
          setImporting("Notizbuch „" + nm2 + "“ wird übertragen …");
          let nb = notebooksRef.current.find((n) => n.name.trim().toLowerCase() === nm2.toLowerCase());
          if (!nb) {
            let id = slugify(nm2);
            while (id === ROOT_NB_ID || notebooksRef.current.some((n) => n.id === id)) id += "-2";
            nb = { id, path: "notizbuecher/" + id + ".md", name: nm2 };
            const nbs = [...notebooksRef.current, nb];
            setNotebooks(nbs);
            notebooksRef.current = nbs;
          }
          const ok = await commitDocNb(cfg, nb.id, item.doc, "Import: Notizbuch „" + nm2 + "“");
          if (!ok) throw new Error("Notizbuch „" + nm2 + "“ wurde parallel geändert – Import bitte erneut starten.");
        }
      } else {
        // v1 (Artifact-Backup): immer ins Root-Notizbuch – das ist die
        // Fortsetzung der alten Ein-Notizbuch-App, nicht das zufällig aktive.
        const nb = notebooksRef.current.find((n) => n.id === ROOT_NB_ID) || activeNotebook();
        setImporting("Notizbuch „" + nb.name + "“ wird übertragen …");
        const ok = await commitDocNb(cfg, nb.id, data.doc, "Import aus Artifact-Backup");
        if (!ok) {
          setImporting(null);
          setBanner({
            kind: "warn",
            text: "Import abgebrochen: Das Notizbuch wurde parallel geändert. Bitte den Import einfach noch einmal starten (bereits übertragene Bilder werden übersprungen).",
          });
          return;
        }
      }

      // 3. Alte Artifact-Historie einmalig archivieren
      if (nh.length) {
        setImporting("Alte Historie wird archiviert …");
        const cur = await ghGetFile(cfg, OLD_HISTORY_PATH);
        await ghPutFile(cfg, OLD_HISTORY_PATH,
          utf8ToB64(JSON.stringify(nh, null, 2)),
          "Import: alte Artifact-Historie archiviert",
          cur ? cur.sha : undefined);
      }

      // 4. Chat, Modell, Klappzustände nach state.json (Reihenfolge,
      // Schnellnotizen UND AutoKorrektur-Konfiguration des Geräts dabei
      // nicht verwerfen – ein Backup-Import betrifft nur Chat/Notizbücher).
      setImporting("Chat & Einstellungen werden übertragen …");
      const payload = serializeState(nc, nm, ncolAll, activeNbRef.current,
        notebooksRef.current.map((n) => n.id), stateRef.current.quickNotesAll, stateRef.current.autocorrect);
      const curSt = await ghGetFile(cfg, STATE_PATH);
      const putSt = await ghPutFile(cfg, STATE_PATH, utf8ToB64(payload),
        "Import: Chat & Einstellungen", curSt ? curSt.sha : undefined);
      stateSha.current = putSt.sha;
      lastSavedState.current = payload;

      // Lokalen Zustand nachziehen
      failedImgs.current = new Set();
      setDoc(docCache.current[activeNbRef.current] ?? INITIAL_DOC);
      setChat(nc);
      setModel(nm);
      setCollapsedAll(ncolAll);
      setImgMap((prev) => ({ ...prev, ...Object.fromEntries(imgs) }));
      setImporting(null);
      setShowHistory(false);
      setExpanded(null);
      setBanner({
        kind: "info",
        text: `Import abgeschlossen: ${isV2 ? data.notebooks.length + " Notizbuch/-bücher" : "Wissensbasis"}, ${imgs.length} Bild(er), Chat und Einstellungen übertragen` +
          (nh.length ? ", alte Historie archiviert." : "."),
      });
    } catch (e) {
      setImporting(null);
      setBanner({ kind: "warn", text: "Import fehlgeschlagen: " + (e && e.message ? e.message : "unbekannter Fehler") });
    }
  };

  const changeModel = (id) => setModel(id);

  /* ---------- Ladebildschirm ---------- */
  if (!loaded) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-slate-100">
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-sm">Wissensbasis wird geladen …</span>
        </div>
      </div>
    );
  }

  const lastStand = meta.lastTs ? fmtStamp(meta.lastTs) : "neu";
  const activeName = (notebooks.find((n) => n.id === activeNb) || { name: "Wissensbasis" }).name;
  const dotClass =
    saveState === "saving" ? "bg-amber-500 animate-pulse"
    : saveState === "saved" ? "bg-emerald-500"
    : saveState === "error" ? "bg-rose-600"
    : "bg-slate-300";

  /* ================================================================ */

  return (
    <div className="h-screen w-full flex flex-col bg-slate-100 text-slate-900 font-sans">

      {/* Kopfzeile */}
      <header className="flex items-center gap-2 px-2 sm:px-3 h-14 bg-white border-b border-slate-200">
        <img
          src={nbIcons[activeNb] || "icons/logo.png"}
          alt="Notizbuch"
          className={"w-7 h-7 " + (nbIcons[activeNb] ? "rounded-md border border-slate-200" : "")}
        />
        {notebooks.length ? (
          <NotebookMenu
            notebooks={notebooks}
            activeNb={activeNb}
            nbIcons={nbIcons}
            disabled={editing}
            onSelect={switchNotebook}
            onNew={() => { setNbError(null); setNewNbName(""); setShowNewNb(true); }}
            onAdmin={() => { setNbAdminError(null); setNbRenameId(null); setNbDeleteId(null); setShowNbAdmin(true); }}
          />
        ) : (
          <span className="font-semibold tracking-tight">Notizbuch</span>
        )}
        {/* Version auf sehr schmalen Screens ausblenden – der Header muss
            samt Historie/Einstellungen in 360 px passen (QA-Finding A3). */}
        <span className="hidden sm:inline font-mono text-xs text-slate-400">v7.25</span>
        <span className={"w-2 h-2 rounded-full ml-1 " + dotClass}
          title={
            saveState === "saved" ? "Gespeichert (im Daten-Repo)"
            : saveState === "saving" ? "Speichert …"
            : saveState === "error" ? "Speicherfehler"
            : "Nicht verbunden"
          }
        />
        <div className="flex-1" />
        <div className="relative">
          <select
            value={model}
            onChange={(e) => changeModel(e.target.value)}
            className="appearance-none text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg pl-2 pr-6 py-1 text-slate-700 max-w-24 sm:max-w-none"
            title="Modell für die Strukturierung"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-1 top-2 text-slate-500 pointer-events-none" />
        </div>
        <button
          onClick={openHistory}
          className="p-2 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
          title="Historie & Backup"
        >
          <History size={16} />
        </button>
        <button
          onClick={() => { setConnectError(null); setShowSettings(true); }}
          className="p-2 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
          title="Einstellungen"
        >
          <Settings size={16} />
        </button>
      </header>

      {saveState === "off" && !showSettings && (
        <div className="px-3 py-1.5 text-xs bg-amber-50 border-b border-amber-200 text-amber-800">
          Nicht verbunden – bitte über das Zahnrad die Einstellungen ausfüllen.
          Änderungen gelten bis dahin nur für diese Sitzung.
        </div>
      )}

      {saveState === "error" && (
        <div className="px-3 py-1.5 text-xs bg-rose-50 border-b border-rose-200 text-rose-800">
          Speichern fehlgeschlagen{storageError ? " – Meldung: „" + storageError + "“" : ""}.
          Deine Daten dieser Sitzung bleiben im Fenster erhalten; sichere sie notfalls über
          Historie → Backup exportieren.
        </div>
      )}

      {banner && (
        <div className={"flex items-start gap-2 px-3 py-1.5 text-xs border-b " +
          (banner.kind === "warn"
            ? "bg-amber-50 border-amber-200 text-amber-800"
            : "bg-emerald-50 border-emerald-200 text-emerald-800")}>
          {banner.kind === "warn" && <AlertTriangle size={14} className="shrink-0 mt-0.5" />}
          <span className="flex-1">{banner.text}</span>
          <button onClick={() => setBanner(null)} className="shrink-0 p-0.5 rounded hover:bg-black/5">
            <X size={13} />
          </button>
        </div>
      )}

      {/* Mobiler Umschalter */}
      <div className="md:hidden flex gap-1 m-2 p-1 bg-white border border-slate-200 rounded-xl">
        <button
          onClick={() => { setView("chat"); setChatDirty(false); }}
          className={"relative flex-1 py-1.5 rounded-lg text-sm font-medium " +
            (view === "chat" ? "bg-slate-900 text-white" : "text-slate-600")}
        >
          Chat
          {chatDirty && view !== "chat" && (
            <span className="absolute top-1 right-3 w-2 h-2 bg-indigo-600 rounded-full" />
          )}
        </button>
        <button
          onClick={() => { setView("notes"); setNotesDirty(false); }}
          className={"relative flex-1 py-1.5 rounded-lg text-sm font-medium " +
            (view === "notes" ? "bg-slate-900 text-white" : "text-slate-600")}
        >
          {activeName}
          {notesDirty && view !== "notes" && (
            <span className="absolute top-1 right-3 w-2 h-2 bg-indigo-600 rounded-full" />
          )}
        </button>
      </div>

      {/* Hauptbereich */}
      <main ref={mainRef} className="flex-1 min-h-0 flex">

        {/* ---------------- Chat (links, Breite per Splitter) ---------------- */}
        <section
          style={{ "--chat-w": layout.chatPct + "%" }}
          className={(view === "chat" ? "flex" : "hidden") +
            " md:flex flex-col flex-1 md:flex-none md:w-[var(--chat-w)] min-w-0 bg-slate-50"}
        >
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 py-3 space-y-3">
            {chat.map((m, i) => m.info ? (
              <div key={i} className="flex justify-center">
                <span className="inline-flex items-center gap-1 text-xs text-slate-400 bg-slate-100 border border-slate-200 rounded-full px-2.5 py-0.5">
                  <Pencil size={10} />
                  {m.text}
                </span>
              </div>
            ) : (
              <div key={i} className={"flex flex-col " + (m.role === "user" ? "items-end" : "items-start")}>
                <div
                  className={
                    // Prozentbreite auf Mobil: die festen 28rem waren breiter
                    // als der Bildschirm – seit overflow-x-hidden wurde Text
                    // dann abgeschnitten statt gescrollt (QA-Finding).
                    "max-w-[88%] sm:max-w-md min-w-0 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words " +
                    (m.role === "user"
                      ? "bg-slate-800 text-slate-50 rounded-2xl rounded-br-sm"
                      : m.error
                        ? "bg-rose-50 border border-rose-300 text-rose-800 rounded-2xl rounded-bl-sm"
                        : "bg-white border border-slate-200 text-slate-800 rounded-2xl rounded-bl-sm shadow-sm")
                  }
                >
                  {m.imgId && (
                    imgMap[m.imgId] ? (
                      <img
                        src={imgMap[m.imgId]}
                        alt="Angehängtes Bild"
                        onClick={() => setLightbox(imgMap[m.imgId])}
                        className={"max-h-40 max-w-full rounded-lg border border-slate-300 cursor-pointer " + (m.text ? "mb-2" : "")}
                      />
                    ) : (
                      <span className="block text-xs opacity-70 mb-1">[Bild]</span>
                    )
                  )}
                  {m.fileName && (
                    <span className={"inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs border " +
                      (m.text ? "mb-2 " : "") +
                      (m.role === "user" ? "bg-white/15 border-white/30" : "bg-slate-100 border-slate-200 text-slate-700")}>
                      <Paperclip size={12} />
                      {m.fileName}
                    </span>
                  )}
                  {(() => {
                    // Fehlermeldungen sind Technik-Text der App, kein Modell-
                    // oder Nutzerinhalt – dort bleiben $-Zeichen unangetastet.
                    if (m.error) return m.text;
                    // Nutzer-Nachrichten haben keine Zitate, aber $/$$ darf
                    // auch dort gerendert werden (Nutzerwunsch), ebenso
                    // ```-Codeblöcke/`Inline-Code` (v7.7). Fences kommen
                    // ZUERST dran, Formeln laufen nur auf den verbleibenden
                    // Nicht-Code-Segmenten (expandFencedCodeInNodes).
                    if (m.role !== "assistant") {
                      return expandFencedCodeInNodes([m.text], (t) => renderMathText(t));
                    }
                    // cite-Tags der Websuche → klickbare Fußnoten. Wurde
                    // recherchiert, aber nichts inline zitiert, die
                    // konsultierten Quellen trotzdem auflisten. Codeblöcke/
                    // Formeln werden NACH den Zitaten aufgelöst
                    // (expandFencedCodeInNodes → expandMathInNodes je
                    // Nicht-Code-Segment), damit ein <cite>…$x$…</cite>-
                    // Segment beides bekommt, ohne dass sich die
                    // Ersetzungen ins Gehege kommen.
                    const { nodes, footnotes } = renderWithCites(m.text, m.sources || []);
                    const list = footnotes.length
                      ? footnotes
                      : (m.sources || [])
                          .filter((s) => /^https?:\/\//i.test(s.url)) // wie resolveSources
                          .map((s, i) => ({ num: i + 1, url: s.url, title: s.title || s.url }));
                    return (
                      <>
                        {expandFencedCodeInNodes(nodes, (t) => expandMathInNodes([t]))}
                        {list.length > 0 && (
                          <span className="block mt-2 pt-1.5 border-t border-slate-200 whitespace-normal">
                            {list.map((f) => (
                              <span key={f.num} className="block text-xs text-slate-400 truncate">
                                [{f.num}]{" "}
                                <a
                                  href={f.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-indigo-600 hover:underline"
                                >
                                  {f.title}
                                </a>
                              </span>
                            ))}
                          </span>
                        )}
                      </>
                    );
                  })()}
                </div>
                {m.commit && (
                  <div className="mt-1 inline-flex items-center gap-1 font-mono text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-2 py-1">
                    <GitCommit size={12} />
                    <span>{fmtTime(m.ts)} · {m.commit}</span>
                  </div>
                )}
                {/* Gedächtnis-Badge (v7.16), gleiche Optik-Familie wie die
                    Commit-Badge oben – ein Turn kann beide gleichzeitig
                    auslösen (Notizbuch-Commit UND Gedächtnis-Update). */}
                {m.memory && (
                  <div className="mt-1 inline-flex items-center gap-1 font-mono text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-2 py-1">
                    <span aria-hidden="true">🧠</span>
                    <span>Gedächtnis aktualisiert</span>
                  </div>
                )}
                {/* ⚠️-Warn-Badge (v7.21, Ops-Zuverlässigkeit): gleiche Optik-
                    Familie wie Commit-/Gedächtnis-Badge, aber amber statt
                    indigo – meldet Ops, die das Modell angekündigt, aber die
                    NICHTS am Notizbuch/Gedächtnis verändert haben (siehe
                    DECISIONS #63). m.warning kann mehrzeilig sein (mehrere
                    gebündelte Ops, siehe buildOpsWarning) – whitespace-pre-
                    wrap erhält die Zeilenumbrüche. */}
                {m.warning && (
                  <div className="mt-1 inline-flex items-start gap-1.5 max-w-[88%] sm:max-w-md text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-2.5 py-1.5 whitespace-pre-wrap break-words">
                    <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                    <span>{m.warning}</span>
                  </div>
                )}
                {/* Dezenter Zeitstempel für alle übrigen Nachrichten (C4, v7.4).
                    WELCOME hat ts:0 (falsy) und bleibt bewusst ohne Zeit; bei
                    einer Commit-/Gedächtnis-/Warn-Badge keinen doppelten
                    Stempel (die Commit-Badge zeigt die Zeit schon).
                    Ausrichtung folgt items-end/items-start des umgebenden
                    flex-col-Containers automatisch. */}
                {!m.commit && !m.memory && !m.warning && m.ts ? (
                  <div className="mt-0.5 px-1 text-[10px] text-slate-400">{fmtTime(m.ts)}</div>
                ) : null}
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-slate-400 text-sm px-1">
                <Loader2 size={14} className="animate-spin" />
                <span>{busyLabel}</span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Eingabe */}
          <div className="p-2 border-t border-slate-200 bg-white">
            {imgError && (
              <div className="mb-1 text-xs text-rose-700">{imgError}</div>
            )}
            {pendingImg && (
              <div className="mb-2 flex items-center gap-2">
                <img src={pendingImg.dataUrl} alt="Vorschau"
                  className="h-16 rounded-lg border border-slate-300" />
                <span className="text-xs text-slate-500">
                  Bild wird mit der nächsten Nachricht analysiert und abgelegt.
                </span>
                <button onClick={() => setPendingImg(null)}
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" title="Bild entfernen">
                  <X size={14} />
                </button>
              </div>
            )}
            {pendingFile && (
              <div className="mb-2 flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 border border-slate-300 text-xs text-slate-700">
                  <Paperclip size={13} />
                  {pendingFile.name}
                </span>
                <span className="text-xs text-slate-500">
                  Wird mitgeschickt und im Daten-Repo abgelegt.
                </span>
                <button onClick={() => setPendingFile(null)}
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" title="Datei entfernen">
                  <X size={14} />
                </button>
              </div>
            )}
            {confirmArchive && (
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span>
                  Gesamten Chat als Markdown im Daten-Repo (chats/) ablegen und hier leeren?
                </span>
                <button
                  onClick={archiveChat}
                  disabled={archiving || busy}
                  className={"px-2.5 py-1 rounded-lg bg-slate-800 text-white font-medium " +
                    (archiving || busy ? "opacity-50" : "hover:bg-slate-900")}
                >
                  {archiving ? "Archiviert …" : "Archivieren"}
                </button>
                <button
                  onClick={() => setConfirmArchive(false)}
                  className="px-2.5 py-1 rounded-lg border border-slate-300 hover:bg-slate-50"
                >
                  Abbrechen
                </button>
              </div>
            )}
            <div className="flex items-end gap-2">
              <button
                onClick={() => setConfirmArchive((v) => !v)}
                disabled={!chat.some((m) => m.ts)}
                className={"p-3 rounded-xl border border-slate-300 bg-white text-slate-600 " +
                  (chat.some((m) => m.ts) ? "hover:bg-slate-50" : "opacity-40")}
                title="Chat archivieren: als Markdown im Daten-Repo ablegen und leeren"
              >
                <Archive size={18} />
              </button>
              <button
                onClick={() => imgInputRef.current && imgInputRef.current.click()}
                className="p-3 rounded-xl border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                title="Bild oder Datei anhängen"
              >
                <ImagePlus size={18} />
              </button>
              <input
                ref={imgInputRef}
                type="file"
                onChange={(e) => { attachAny(e.target.files && e.target.files[0]); e.target.value = ""; }}
                className="hidden"
              />
              <div className="relative flex-1 min-w-0">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onPaste={handlePaste}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                  }}
                  rows={inputExpanded ? 10 : 2}
                  placeholder="Notiz eintippen, diktieren oder Screenshot einfügen …"
                  className={"w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 pr-9 text-base text-slate-800 " +
                    // rows=10 wäre auf schmalen Bildschirmen zu hoch (sprengt den
                    // sichtbaren Bereich) – max-h deckelt dort auf ~6 Zeilen,
                    // ab sm auf die vollen ~10 Zeilen; überschüssiger Text scrollt.
                    (inputExpanded ? "max-h-40 sm:max-h-64 overflow-y-auto" : "")}
                />
                <button
                  type="button"
                  onClick={() => setInputExpanded((v) => !v)}
                  className="absolute top-1.5 right-1.5 p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                  title={inputExpanded ? "Eingabefeld verkleinern" : "Eingabefeld vergrößern"}
                >
                  {inputExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
              </div>
              <button
                onClick={send}
                className={"p-3 rounded-xl bg-indigo-700 text-white " +
                  (busy || archiving || (!input.trim() && !pendingImg && !pendingFile) ? "opacity-40" : "hover:bg-indigo-800")}
                title="Senden"
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </section>

        {/* Splitter Chat ↔ Dokument */}
        <div
          onPointerDown={(e) => startSplit(e, "chat")}
          className="hidden md:block w-1.5 shrink-0 cursor-col-resize bg-slate-200 hover:bg-indigo-400 active:bg-indigo-500 transition-colors touch-none"
          title="Breite anpassen"
        />

        {/* ---------------- Wissensbasis (rechts) ---------------- */}
        <section
          className={(view === "notes" ? "flex" : "hidden") +
            " md:flex flex-col flex-1 min-w-0 bg-white " +
            (flash ? "ring-2 ring-inset ring-indigo-300" : "")}
        >
          {/* Aktenkopf */}
          <div className="flex items-center gap-2 px-4 pt-4 pb-2">
            <div className="flex flex-col">
              <span className="text-xs tracking-widest uppercase text-slate-500 truncate max-w-56">{activeName}</span>
              <span className="font-mono text-xs text-slate-400">Stand {lastStand} · {meta.count} Versionen</span>
            </div>
            <div className="flex-1" />
            {!editing && (
              <>
                <button onClick={() => setNavDrawer(true)} title="Abschnitte"
                  className="md:hidden p-2 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50">
                  <ListTree size={15} />
                </button>
                <button onClick={() => setShowKnowledge(true)} title="Hintergrundwissen (Dateien für dieses Notizbuch)"
                  className="relative p-2 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50">
                  <Paperclip size={15} />
                  {(knowledgeIndex.current[activeNb] || []).length > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-3.5 h-3.5 px-0.5 text-[9px] leading-none bg-indigo-600 text-white rounded-full flex items-center justify-center">
                      {(knowledgeIndex.current[activeNb] || []).length}
                    </span>
                  )}
                </button>
                <button onClick={copyMd} title="Markdown kopieren"
                  className="p-2 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50">
                  {copied ? <Check size={15} className="text-emerald-600" /> : <Copy size={15} />}
                </button>
                <button onClick={exportMd} title="Als .md exportieren"
                  className="p-2 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50">
                  <Download size={15} />
                </button>
                <button onClick={startEdit} title="Selbst bearbeiten"
                  className="p-2 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50">
                  <Pencil size={15} />
                </button>
              </>
            )}
          </div>

          {editing ? (
            <DocEditor
              initialDoc={doc}
              imgMap={imgMap}
              onSave={saveEdit}
              onCancel={cancelEdit}
              saving={savingEdit || busy}
              navWidth={layout.navW}
              autocorrect={autocorrect}
            />
          ) : (
            <div className="flex-1 min-h-0 flex">
              <div
                ref={docScrollRef}
                onScroll={onDocScroll}
                className="flex-1 min-h-0 overflow-y-auto px-4 pb-8"
              >
                <DocView
                  text={doc}
                  collapsed={collapsed}
                  onToggle={toggleCollapse}
                  imgMap={imgMap}
                  onImgClick={(src) => setLightbox(src)}
                  onToggleTask={toggleTask}
                  anchorPrefix="sec-"
                />
              </div>
              {/* Splitter Dokument ↔ Abschnittsleiste */}
              <div
                onPointerDown={(e) => startSplit(e, "nav")}
                className="hidden md:block w-1 shrink-0 cursor-col-resize bg-slate-100 hover:bg-indigo-400 active:bg-indigo-500 transition-colors touch-none"
                title="Breite anpassen"
              />

              {/* Abschnitts-Tabs (wie OneNote-Seitenleiste): alle ##-Überschriften.
                  Mobil ausgeblendet – dort übernimmt der Drawer (volle
                  Dokumentbreite, Öffnen per Knopf oder Randwischen). */}
              <nav
                style={{ "--nav-w": layout.navW + "px" }}
                className="hidden md:block md:w-[var(--nav-w)] shrink-0 overflow-y-auto py-2 pr-2 bg-slate-50/60"
              >
                {sectionNavContent}
              </nav>

              {/* Unsichtbarer Wisch-Streifen am rechten Rand (nur mobil).
                  Leicht vom Rand abgerückt (OS-Back-Geste liegt direkt an der
                  Kante); touch-pan-y lässt vertikales Scrollen durch. */}
              <div
                className="md:hidden fixed top-14 bottom-0 right-1.5 w-4 z-30 touch-pan-y"
                onTouchStart={(e) => {
                  const t = e.touches[0];
                  edgeSwipe.current = { x: t.clientX, y: t.clientY };
                }}
                onTouchMove={(e) => {
                  if (!edgeSwipe.current) return;
                  const t = e.touches[0];
                  const dx = t.clientX - edgeSwipe.current.x;
                  const dy = t.clientY - edgeSwipe.current.y;
                  if (dx < -24 && Math.abs(dx) > Math.abs(dy)) {
                    setNavDrawer(true);
                    edgeSwipe.current = null;
                  }
                }}
                onTouchEnd={() => { edgeSwipe.current = null; }}
              />

              {/* Abschnitts-Drawer (nur mobil): von rechts, wie in OneNote/Docs */}
              {/* z-[45]: über den Post-its (z-40), unter echten Modals (z-50) */}
              {navDrawer && (
                <div className="md:hidden fixed inset-0 z-[45]" onClick={() => setNavDrawer(false)}>
                  <div className="absolute inset-0" style={{ backgroundColor: "rgba(15,23,42,0.35)" }} />
                  <nav
                    className="drawer-in absolute inset-y-0 right-0 w-60 max-w-[75vw] bg-slate-50 border-l border-slate-200 shadow-2xl overflow-y-auto py-3 pr-2 pl-1"
                    onClick={(e) => e.stopPropagation()}
                    onTouchStart={(e) => {
                      const t = e.touches[0];
                      edgeSwipe.current = { x: t.clientX, y: t.clientY };
                    }}
                    onTouchMove={(e) => {
                      if (!edgeSwipe.current) return;
                      const t = e.touches[0];
                      const dx = t.clientX - edgeSwipe.current.x;
                      const dy = t.clientY - edgeSwipe.current.y;
                      if (dx > 32 && Math.abs(dx) > Math.abs(dy)) {
                        setNavDrawer(false);
                        edgeSwipe.current = null;
                      }
                    }}
                    onTouchEnd={() => { edgeSwipe.current = null; }}
                  >
                    <div className="px-2.5 pb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">
                      Abschnitte
                    </div>
                    {sectionNavContent}
                  </nav>
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      {/* ---------------- Lightbox ---------------- */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(15,23,42,0.85)" }}
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="Bild" className="max-h-full max-w-full rounded-lg shadow-xl" />
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 p-2 rounded-lg bg-white text-slate-700"
            title="Schließen"
          >
            <X size={18} />
          </button>
        </div>
      )}

      {/* ---------------- Historie & Backup ---------------- */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <div
            className="absolute inset-0"
            style={{ backgroundColor: "rgba(15,23,42,0.45)" }}
            onClick={() => setShowHistory(false)}
          />
          <div className="relative bg-white w-full md:max-w-2xl max-h-full rounded-t-2xl md:rounded-2xl shadow-xl flex flex-col" style={{ maxHeight: "85vh" }}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
              <History size={16} className="text-indigo-700" />
              <span className="font-semibold">Historie</span>
              <span className="font-mono text-xs text-slate-400">
                {meta.count} Versionen · Git-Commits in {settings ? settings.owner + "/" + settings.repo : "–"}
              </span>
              <div className="flex-1" />
              <button onClick={() => setShowHistory(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
              {historyLoading && (
                <div className="p-6 flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 size={14} className="animate-spin" />
                  Commits werden geladen …
                </div>
              )}
              {historyError && (
                <div className="p-6 text-sm text-rose-700">{historyError}</div>
              )}
              {!historyLoading && !historyError && history.length === 0 && (
                <div className="p-6 text-sm text-slate-500">
                  {connected
                    ? "Noch keine Versionen – die erste Änderung legt automatisch eine an."
                    : "Nicht verbunden – die Historie kommt aus den Git-Commits des Daten-Repos."}
                </div>
              )}
              {history.map((entry, idx) => {
                const isOpen = expanded === entry.sha;
                const isCurrent = idx === 0;
                const data = isOpen && expandedData && expandedData.sha === entry.sha ? expandedData : null;
                return (
                  <div key={entry.sha}>
                    <button
                      onClick={() => toggleExpand(entry)}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-slate-50"
                    >
                      <GitCommit size={14} className="text-indigo-600" />
                      <span className="font-mono text-xs text-slate-500">{fmtStamp(entry.ts)}</span>
                      <span className="text-sm text-slate-800 flex-1 truncate">{entry.msg}</span>
                      {isCurrent && (
                        <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                          aktuell
                        </span>
                      )}
                      <ChevronDown size={14}
                        className={"text-slate-400 " + (isOpen ? "rotate-180" : "")} />
                    </button>

                    {isOpen && (
                      <div className="px-4 pb-3">
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 max-h-64 overflow-y-auto overflow-x-auto">
                          {!data ? (
                            <div className="flex items-center gap-2 text-xs text-slate-400">
                              <Loader2 size={12} className="animate-spin" />
                              Stand wird geladen …
                            </div>
                          ) : data.error ? (
                            <div className="font-mono text-xs text-rose-700">{data.error}</div>
                          ) : data.parentText == null ? (
                            <pre className="font-mono text-xs text-slate-600 whitespace-pre-wrap">{data.text}</pre>
                          ) : (() => {
                            const d = diffLines(data.parentText, data.text || "");
                            if (!d) return <pre className="font-mono text-xs text-slate-600 whitespace-pre-wrap">{data.text}</pre>;
                            return contextize(d).map((row, i) => {
                              if (row.t === "gap") return <div key={i} className="font-mono text-xs text-slate-300 px-1">···</div>;
                              if (row.t === "info") return <div key={i} className="font-mono text-xs text-slate-400 px-1">{row.l}</div>;
                              const cls =
                                row.t === "a" ? "bg-emerald-50 text-emerald-800"
                                : row.t === "d" ? "bg-rose-50 text-rose-700"
                                : "text-slate-400";
                              const sign = row.t === "a" ? "+ " : row.t === "d" ? "− " : "  ";
                              return (
                                <div key={i} className={"font-mono text-xs whitespace-pre-wrap px-1 " + cls}>
                                  {sign}{row.l}
                                </div>
                              );
                            });
                          })()}
                        </div>
                        {!isCurrent && data && typeof data.text === "string" && (
                          <button
                            onClick={() => restore(entry)}
                            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-300 text-indigo-700 text-sm font-medium hover:bg-indigo-50"
                          >
                            <RotateCcw size={14} />
                            Diesen Stand wiederherstellen
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Backup-Leiste */}
            <div className="flex items-center gap-2 px-4 py-3 border-t border-slate-200">
              <button
                onClick={exportBackup}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50"
              >
                <Download size={14} />
                Backup exportieren
              </button>
              <button
                onClick={() => fileInputRef.current && fileInputRef.current.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50"
              >
                <Upload size={14} />
                Backup importieren
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={importBackup}
                className="hidden"
              />
              <span className="hidden md:inline text-xs text-slate-400">
                Import versteht das Backup der alten Artifact-App (Migration).
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Import-Fortschritt ---------------- */}
      {importing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(15,23,42,0.6)" }}
        >
          <div className="bg-white rounded-2xl shadow-xl px-6 py-5 flex items-center gap-3">
            <Loader2 size={18} className="animate-spin text-indigo-700" />
            <span className="text-sm text-slate-700">{importing}</span>
          </div>
        </div>
      )}

      {/* ---------------- Hintergrundwissen ---------------- */}
      {showKnowledge && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <div
            className="absolute inset-0"
            style={{ backgroundColor: "rgba(15,23,42,0.45)" }}
            onClick={() => !knowledgeBusy && setShowKnowledge(false)}
          />
          <div className="relative bg-white w-full md:max-w-lg max-h-full rounded-t-2xl md:rounded-2xl shadow-xl flex flex-col" style={{ maxHeight: "85vh" }}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
              <Paperclip size={16} className="text-indigo-700" />
              <span className="font-semibold">Hintergrundwissen</span>
              <span className="font-mono text-xs text-slate-400 truncate">{activeName}</span>
              <div className="flex-1" />
              <button onClick={() => !knowledgeBusy && setShowKnowledge(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
              {!connected && (
                <div className="p-6 text-sm text-slate-500">
                  Nicht verbunden – Wissensdateien liegen im Daten-Repo.
                </div>
              )}
              {connected && !(knowledgeIndex.current[activeNb] || []).length && (
                <div className="p-6 text-sm text-slate-500">
                  Noch keine Dateien. Hinterlege hier Hintergrundwissen zu diesem
                  Notizbuch (z. B. ein Handbuch als PDF) – es wird bei jedem Prompt
                  in diesem Notizbuch berücksichtigt.
                </div>
              )}
              {(knowledgeIndex.current[activeNb] || []).map((item) => (
                <div key={item.extractPath} className="flex items-center gap-2 px-4 py-2.5">
                  <Paperclip size={14} className="text-slate-400 shrink-0" />
                  <span className="text-sm text-slate-800 flex-1 truncate">{item.name}</span>
                  <button
                    onClick={() => deleteKnowledge(item)}
                    disabled={!!knowledgeBusy}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                    title="Datei und Extrakt löschen"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            {knowledgeBusy && (
              <div className="flex items-center gap-2 px-4 py-2 border-t border-slate-200 text-xs text-slate-500">
                <Loader2 size={13} className="animate-spin text-indigo-700" />
                {knowledgeBusy}
              </div>
            )}

            <div className="flex items-center gap-2 px-4 py-3 border-t border-slate-200">
              <button
                onClick={() => knowledgeFileRef.current && knowledgeFileRef.current.click()}
                disabled={!connected || !!knowledgeBusy}
                className={"inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 text-sm " +
                  (!connected || knowledgeBusy ? "opacity-40" : "hover:bg-slate-50")}
              >
                <FileUp size={14} />
                Dateien hinzufügen
              </button>
              <input
                ref={knowledgeFileRef}
                type="file"
                multiple
                accept={KNOWLEDGE_EXTS.map((e) => "." + e).join(",")}
                onChange={uploadKnowledge}
                className="hidden"
              />
              <span className="hidden md:inline text-xs text-slate-400">
                {KNOWLEDGE_EXTS.join(", ")} · Text wird beim Upload extrahiert
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Neues Notizbuch ---------------- */}
      {showNewNb && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0"
            style={{ backgroundColor: "rgba(15,23,42,0.45)" }}
            onClick={() => setShowNewNb(false)}
          />
          <div className="relative bg-white w-full max-w-sm rounded-2xl shadow-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen size={16} className="text-indigo-700" />
              <span className="font-semibold">Neues Notizbuch</span>
              <div className="flex-1" />
              <button onClick={() => setShowNewNb(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); createNotebook(newNbName); }}>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Eindeutiger Name
              </label>
              <input
                autoFocus
                value={newNbName}
                onChange={(e) => setNewNbName(e.target.value)}
                placeholder="z. B. Kochrezepte"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
              />
              {nbError && (
                <div className="mt-2 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
                  {nbError}
                </div>
              )}
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="submit"
                  disabled={creatingNb || !newNbName.trim()}
                  className={"inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-700 text-white text-sm font-medium " +
                    (creatingNb || !newNbName.trim() ? "opacity-40" : "hover:bg-indigo-800")}
                >
                  {creatingNb ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  {creatingNb ? "Lege an …" : "Anlegen"}
                </button>
                <button type="button" onClick={() => setShowNewNb(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 text-sm hover:bg-slate-50">
                  Abbrechen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showNbAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0"
            style={{ backgroundColor: "rgba(15,23,42,0.45)" }}
            onClick={() => setShowNbAdmin(false)}
          />
          <div className="relative bg-white w-full max-w-md rounded-2xl shadow-xl p-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen size={16} className="text-indigo-700" />
              <span className="font-semibold">Notizbücher verwalten</span>
              <div className="flex-1" />
              <button onClick={() => setShowNbAdmin(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100">
                <X size={16} />
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              {notebooks.map((n, i) => (
                <div key={n.id}
                  className={"rounded-xl border px-2.5 py-2 " +
                    (n.id === activeNb ? "border-indigo-300 bg-indigo-50/50" : "border-slate-200 bg-white")}>
                  <div className="flex items-center gap-1.5">
                    <img
                      src={nbIcons[n.id] || "icons/logo.png"}
                      alt=""
                      className={"w-6 h-6 shrink-0 " + (nbIcons[n.id] ? "rounded-md border border-slate-200" : "opacity-70")}
                    />
                    {nbRenameId === n.id ? (
                      <form className="flex-1 flex items-center gap-1.5"
                        onSubmit={(e) => { e.preventDefault(); renameNotebook(n.id, nbRenameValue); }}>
                        <input
                          autoFocus
                          value={nbRenameValue}
                          onChange={(e) => setNbRenameValue(e.target.value)}
                          className="flex-1 min-w-0 rounded-lg border border-indigo-300 px-2 py-1 text-sm"
                        />
                        <button type="submit" disabled={nbAdminBusy === n.id}
                          className="p-1.5 rounded-lg bg-indigo-700 text-white hover:bg-indigo-800"
                          title="Umbenennen">
                          {nbAdminBusy === n.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                        </button>
                        <button type="button" onClick={() => { setNbRenameId(null); setNbAdminError(null); }}
                          className="p-1.5 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50">
                          <X size={13} />
                        </button>
                      </form>
                    ) : (
                      <>
                        <span className="flex-1 min-w-0 truncate text-sm font-medium text-slate-800">
                          {n.name}
                          {n.id === activeNb && <span className="ml-1.5 text-xs font-normal text-indigo-600">(aktiv)</span>}
                        </span>
                        <button onClick={() => moveNotebook(n.id, -1)} disabled={i === 0}
                          className={"p-1.5 rounded-lg border border-slate-300 text-slate-500 " + (i === 0 ? "opacity-30" : "hover:bg-slate-50")}
                          title="Nach oben">
                          <ArrowUp size={13} />
                        </button>
                        <button onClick={() => moveNotebook(n.id, 1)} disabled={i === notebooks.length - 1}
                          className={"p-1.5 rounded-lg border border-slate-300 text-slate-500 " + (i === notebooks.length - 1 ? "opacity-30" : "hover:bg-slate-50")}
                          title="Nach unten">
                          <ArrowDown size={13} />
                        </button>
                        <button
                          onClick={() => { setNbRenameId(n.id); setNbRenameValue(n.name); setNbDeleteId(null); setNbAdminError(null); }}
                          className="p-1.5 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50"
                          title="Umbenennen">
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => {
                            iconTargetNb.current = n.id;
                            setNbAdminError(null);
                            if (iconInputRef.current) iconInputRef.current.click();
                          }}
                          disabled={nbAdminBusy === n.id}
                          className="p-1.5 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50"
                          title="Eigenes Icon hochladen (wird quadratisch zugeschnitten)">
                          {nbAdminBusy === n.id ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
                        </button>
                        {nbIcons[n.id] && (
                          <button
                            onClick={() => removeNotebookIcon(n.id)}
                            disabled={nbAdminBusy === n.id}
                            className="p-1.5 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50"
                            title="Icon entfernen (zurück zum Standard)">
                            <RotateCcw size={13} />
                          </button>
                        )}
                        <button
                          onClick={() => { setNbDeleteId(nbDeleteId === n.id ? null : n.id); setNbRenameId(null); setNbAdminError(null); }}
                          disabled={notebooks.length <= 1}
                          className={"p-1.5 rounded-lg border " + (notebooks.length <= 1
                            ? "border-slate-200 text-slate-300"
                            : "border-rose-200 text-rose-600 hover:bg-rose-50")}
                          title={notebooks.length <= 1 ? "Das letzte Notizbuch kann nicht gelöscht werden" : "Löschen"}>
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                  </div>
                  {nbDeleteId === n.id && (
                    <div className="mt-2 flex items-center gap-2 px-2 py-1.5 rounded-lg bg-rose-50 border border-rose-200">
                      <AlertTriangle size={13} className="text-rose-600 shrink-0" />
                      <span className="flex-1 text-xs text-rose-800">
                        „{n.name}“ samt Hintergrundwissen endgültig löschen? Alte Stände bleiben in der Git-Historie.
                      </span>
                      <button onClick={() => deleteNotebook(n.id)} disabled={nbAdminBusy === n.id}
                        className="px-2 py-1 rounded-lg bg-rose-600 text-white text-xs font-medium hover:bg-rose-700">
                        {nbAdminBusy === n.id ? "Lösche …" : "Löschen"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {nbAdminError && (
              <div className="mt-2 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
                {nbAdminError}
              </div>
            )}

            <input
              ref={iconInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                e.target.value = "";
                if (f && iconTargetNb.current) setNotebookIcon(iconTargetNb.current, f);
              }}
            />
            <form className="mt-3 pt-3 border-t border-slate-200 flex items-center gap-2"
              onSubmit={(e) => { e.preventDefault(); createNotebook(newNbName); }}>
              <input
                value={newNbName}
                onChange={(e) => setNewNbName(e.target.value)}
                placeholder="Neues Notizbuch – Name"
                className="flex-1 min-w-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
              />
              <button type="submit" disabled={creatingNb || !newNbName.trim()}
                className={"inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-700 text-white text-sm font-medium " +
                  (creatingNb || !newNbName.trim() ? "opacity-40" : "hover:bg-indigo-800")}>
                {creatingNb ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                Anlegen
              </button>
            </form>
            {nbError && showNbAdmin && (
              <div className="mt-2 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
                {nbError}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------------- Schnellnotizen (Post-its) ---------------- */}
      <QuickNotes
        notes={quickNotes}
        onChange={updateQuickNote}
        onRemove={removeQuickNote}
        onSubmit={submitQuickNote}
      />

      {/* ---------------- Einstellungen ---------------- */}
      {showSettings && (
        <SettingsDialog
          initial={settings}
          model={model}
          onModelChange={changeModel}
          onSave={handleSaveSettings}
          onProvidersChange={handleProvidersChange}
          onLogout={handleLogout}
          onClose={() => setShowSettings(false)}
          connecting={connecting}
          error={connectError}
          hasSettings={!!settings}
          memory={memory}
          onMemorySave={handleMemorySave}
          autocorrect={autocorrect}
          onAutocorrectChange={handleAutocorrectChange}
        />
      )}
    </div>
  );
}
