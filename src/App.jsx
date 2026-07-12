import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  BookOpen, Send, Pencil, X, Check, History, Download, Copy,
  RotateCcw, GitCommit, ChevronDown, Loader2, Upload, ImagePlus,
  Settings, AlertTriangle, StickyNote, Paperclip, Trash2, FileUp,
} from "lucide-react";

import { applyOps, dispHead } from "./lib/ops.js";
import { diffLines, contextize } from "./lib/diff.js";
import { DocView, IMG_REF_RE, TASK_RE, parseTree } from "./lib/markdown.jsx";
import {
  prepareImage, newImgId, extForMime, mimeForName, dataUrlParts, blobToDataURL,
} from "./lib/images.js";
import { MODELS, callClaude } from "./lib/anthropic.js";
import {
  ShaConflictError, utf8ToB64, ghGetFile, ghGetBlob, ghListDir, ghPutFile,
  ghDeleteFile, ghListCommits, ghCommitMeta, ghCheckRepo,
} from "./lib/github.js";
import {
  KNOWLEDGE_EXTS, knowledgeDir, safeFileName, extractPathFor, isExtractPath,
  extractText, fileToBase64,
} from "./lib/knowledge.js";
import { loadSettings, saveSettings, clearSettings } from "./lib/settings.js";
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

const initialDocFor = (name) =>
  "# " + name + "\n\n## Inbox\n\n_Noch nichts erfasst. Die erste Notiz im Chat legt hier los._\n";

/* ------------------------------------------------------------------ */
/* Konstanten (aus der Referenz-App übernommen)                        */
/* ------------------------------------------------------------------ */

const DOC_PATH = "wissensbasis.md";
const STATE_PATH = "data/state.json";
const OLD_HISTORY_PATH = "data/alt-historie.json";

const INITIAL_DOC = `# Wissensbasis

## Inbox

_Noch nichts erfasst. Die erste Notiz im Chat legt hier los._
`;

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
const serializeState = (chat, model, collapsedAll, active) =>
  JSON.stringify(
    { v: 2, active: active || ROOT_NB_ID, chat, model, collapsed: collapsedAll || {} },
    null, 2
  );

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
  const [collapsedAll, setCollapsedAll] = useState({}); // nbId -> Klappzustände
  const [meta, setMeta] = useState({ count: 0, lastTs: null });
  const [showNewNb, setShowNewNb] = useState(false);
  const [newNbName, setNewNbName] = useState("");
  const [creatingNb, setCreatingNb] = useState(false);
  const [nbError, setNbError] = useState(null);
  const [showKnowledge, setShowKnowledge] = useState(false);
  const [knowledgeBusy, setKnowledgeBusy] = useState(null); // Fortschrittstext
  const [, setKnowledgeVersion] = useState(0); // Render-Trigger für Ref-Änderungen

  const collapsed = collapsedAll[activeNb] || {};

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("strukturiert …");
  const [view, setView] = useState("chat");
  const [notesDirty, setNotesDirty] = useState(false);
  const [chatDirty, setChatDirty] = useState(false);
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
  const knowledgeIndex = useRef({}); // nbId -> [{ name, path, extractPath }]
  const knowledgeTexts = useRef({}); // extractPath -> extrahierter Text
  const knowledgeFileRef = useRef(null);
  const taskChain = useRef(Promise.resolve());
  const taskEpoch = useRef(0);
  const connectedRef = useRef(false);
  const busyRef = useRef(false);
  const editingRef = useRef(false);
  const viewRef = useRef("chat");
  const stateRef = useRef({ chat: [], model: MODELS[0].id, collapsedAll: {} });
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
  useEffect(() => { stateRef.current = { chat, model, collapsedAll }; }, [chat, model, collapsedAll]);

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
        } catch (e) { /* defekter State → Defaults */ }
      }

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

      // Hintergrundwissen entdecken: wissen/<nbId>/ pro Notizbuch (parallel)
      const kIdx = {};
      await Promise.all(nbs.map(async (nb) => {
        const kFiles = await ghListDir(cfg, knowledgeDir(nb.id));
        const items = kFiles
          .filter((f) => !isExtractPath(f.name))
          .map((f) => ({ name: f.name, path: f.path, extractPath: extractPathFor(f.path) }));
        if (items.length) kIdx[nb.id] = items;
      }));
      knowledgeIndex.current = kIdx;
      knowledgeTexts.current = {};

      lastSavedState.current = serializeState(nChat, nModel, nCollapsedAll, active);
      setNotebooks(nbs);
      notebooksRef.current = nbs;
      setActiveNb(active);
      activeNbRef.current = active;
      setDoc(cache[active]);
      setChat(nChat);
      setModel(nModel);
      setCollapsedAll(nCollapsedAll);
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
    if (ok) saveSettings(cfg);
  };

  const handleLogout = () => {
    clearSettings();
    window.location.reload();
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
    const payload = serializeState(chat, model, collapsedAll, activeNb);
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
  }, [chat, model, collapsedAll, activeNb, connected, flushState]);

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
        const entries = [{ id: ROOT_NB_ID, path: "wissensbasis.md", sha: null }];
        const nbFiles = await ghListDir(cfg, "notizbuecher");
        for (const f of nbFiles) {
          const m = /^([a-z0-9-]+)\.md$/i.exec(f.name);
          if (m && m[1].toLowerCase() !== ROOT_NB_ID) {
            entries.push({ id: m[1].toLowerCase(), path: f.path, sha: f.sha });
          }
        }
        let nbsChanged = false;
        const nbs = [...notebooksRef.current];
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
              lastSavedState.current = serializeState(nChat, nModel, nCollapsedAll, activeNbRef.current);
              setChat(nChat);
              setModel(nModel);
              setCollapsedAll(nCollapsedAll);
            } catch (e) { /* defekter State – ignorieren */ }
          }
        }
      } catch (e) { /* stiller Hintergrund-Refresh */ }
    };
    const onVis = () => { if (document.visibilityState === "visible") maybeRefresh(); };
    window.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      window.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
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
    if ((!text && !pendingImg) || busy) return;
    if (!connected || !settingsRef.current) { setShowSettings(true); return; }
    const cfg = settingsRef.current;

    const img = pendingImg;
    let imgId = null;

    const userMsg = { role: "user", text, ts: Date.now(), imgId: null };
    if (img) {
      imgId = newImgId();
      userMsg.imgId = imgId;
      setImgMap((prev) => ({ ...prev, [imgId]: img.dataUrl }));
    }
    const chatWithUser = [...chat, userMsg].slice(-80);
    setChat(chatWithUser);
    setInput("");
    setPendingImg(null);
    setImgError(null);
    setBusy(true);

    try {
      // Formatprüfung vor dem (bezahlten) API-Call; hochgeladen wird erst danach.
      const imgParts = img ? dataUrlParts(img.dataUrl) : null;
      if (img && !imgParts) throw new Error("Bilddaten unlesbar");

      const nbCtx = await buildNbCtx();
      const res = await callClaude(cfg.apiKey, text, nbCtx, chat, model, img, imgId);

      // Bild erst nach erfolgreicher Antwort als Datei ins Daten-Repo legen
      // (keine verwaisten Dateien bei API-Fehlern), aber vor dem Dokument-
      // Commit, damit die Referenz auf allen Geräten auflösbar ist.
      if (img && imgId) {
        const path = "bilder/" + imgId + "." + extForMime(imgParts.mime);
        await ghPutFile(cfg, path, imgParts.base64, "Bild " + imgId + " hinzugefügt");
        imgIndex.current[imgId] = path;
      }

      let commit = null;

      if (res.ops.length) {
        // Ops nach Ziel-Notizbuch gruppieren (Default und unbekannte Namen → aktives)
        const byName = new Map(notebooksRef.current.map((n) => [n.name.trim().toLowerCase(), n]));
        const groups = new Map();
        for (const op of res.ops) {
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
          const applied = applyOps(before, ops);
          if (applied === before) continue;
          const nb = notebooksRef.current.find((n) => n.id === nbId);
          const ok = await commitDocNb(cfg, nbId, applied, res.commit || "Aktualisierung");
          if (!ok) { conflict = true; break; }
          changed.push({ id: nbId, name: nb ? nb.name : nbId, ops });
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

      const aMsg = { role: "assistant", text: res.reply, ts: Date.now(), commit };
      const finalChat = [...chatWithUser, aMsg].slice(-80);
      setChat(finalChat);
      if (commit && view === "chat") setNotesDirty(true);
    } catch (e) {
      // Eingabe wie im Konfliktpfad zurückgeben, ohne Neueres zu überschreiben.
      setInput((prev) => (prev.trim() ? prev : text));
      if (img) setPendingImg((prev) => prev || img);
      // Wurde das Bild nicht hochgeladen, die img-Referenz aus der Nachricht
      // nehmen, damit nach Reload/Sync kein unauflösbares img:… zurückbleibt.
      const cleaned = img && imgId && !imgIndex.current[imgId]
        ? chatWithUser.map((m) => (m === userMsg ? { ...m, imgId: null } : m))
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
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const step = `(${i + 1}/${files.length})`;
      try {
        if (file.size > 25 * 1024 * 1024) throw new Error("größer als 25 MB");
        const name = safeFileName(file.name);
        if ((knowledgeIndex.current[nbId] || []).some((it) => it.name === name)) {
          throw new Error("Datei mit diesem Namen existiert bereits – erst löschen");
        }
        setKnowledgeBusy(`${file.name}: Text wird extrahiert … ${step}`);
        const text = await extractText(file);
        const path = knowledgeDir(nbId) + "/" + name;
        const extractPath = extractPathFor(path);
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
        knowledgeTexts.current[extractPath] = text;
        knowledgeIndex.current = {
          ...knowledgeIndex.current,
          [nbId]: [...(knowledgeIndex.current[nbId] || []), { name, path, extractPath }],
        };
      } catch (e) {
        errors.push(file.name + ": " + (e && e.message ? e.message : e));
      }
    }
    setKnowledgeBusy(null);
    setKnowledgeVersion((v) => v + 1);
    if (errors.length) {
      setBanner({ kind: "warn", text: "Wissen-Upload teilweise fehlgeschlagen – " + errors.join("; ") });
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
      const sha = shaFor(item.path);
      if (sha) await ghDeleteFile(cfg, item.path, "Wissen: " + item.name + " gelöscht", sha);
      knowledgeIndex.current = {
        ...knowledgeIndex.current,
        [nbId]: (knowledgeIndex.current[nbId] || []).filter((it) => it.path !== item.path),
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

  /* ---------- Abschnitts-Navigation (Tabs rechts) ---------- */
  const sections = useMemo(() => parseTree(doc).sections, [doc]);

  const gotoSection = (si, title) => {
    setCollapsedAll((prev) => {
      const id = activeNbRef.current;
      const cur = prev[id];
      if (!cur || !cur["s:" + title]) return prev;
      const n = { ...cur };
      delete n["s:" + title];
      return { ...prev, [id]: n };
    });
    setActiveSec(si);
    // Synchron scrollen: Das Aufklappen des Ziel-Abschnitts verschiebt dessen
    // Kopfzeile nicht, und RAF/Smooth-Scroll laufen in eingebetteten
    // Browsern (Hintergrund-Tabs) nicht zuverlässig.
    const root = docScrollRef.current;
    const el = document.getElementById("sec-" + si);
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
    if (diffText.length > 8000) diffText = ""; // Token-Deckel bei Großumbauten
    const nb = activeNotebook();
    const trigger =
      "[Systemhinweis: Der Nutzer hat das Notizbuch „" + nb.name + "“ soeben MANUELL bearbeitet, " +
      "nicht über den Chat. Der neue Stand steht bereits oben im Dokument und ist so gewollt.\n" +
      (diffText
        ? "Diff der Änderung:\n" + diffText + "\n\n"
        : "Die Änderung ist umfangreich (kein kompakter Diff verfügbar) – prüfe das Gesamtdokument.\n\n") +
      "Prüfe die Änderung im Kontext ALLER Notizbücher gemäß deiner Aufgabe 3 " +
      "(Verbindungen, Widersprüche, Dubletten, Lücken, nächste Schritte, verletzte Konventionen). " +
      "Fällt dir etwas Nennenswertes auf, melde es kurz in reply. " +
      "Fällt dir NICHTS Nennenswertes auf, antworte in reply exakt mit \"##OK##\" und sonst nichts. " +
      "Lass ops in jedem Fall leer und commit null – kein Notizbuch darf durch diese Prüfung verändert werden.]";
    setBusy(true);
    setBusyLabel("prüft die Änderung …");
    try {
      const nbCtx = await buildNbCtx();
      const res = await callClaude(cfg.apiKey, trigger, nbCtx, stateRef.current.chat, model, null, null);
      const reply = (res.reply || "").trim();
      // Sentinel bevorzugt; zusätzlich häufige „nichts zu melden“-Floskeln abfangen.
      const norm = reply.toLowerCase().replace(/[#.!,\s]/g, "");
      const nothing = !reply || norm === "ok" || norm === "okay" || reply === "Notiert." ||
        /^(alles (konsistent|in ordnung|klar|gut)|keine auffälligkeiten|nichts auffälliges|passt so)/i.test(reply);
      if (!nothing) {
        // ops werden hier bewusst NIE angewendet – reine Rückmeldung.
        setChat((prev) => [...prev,
          { role: "user", info: true, ts: Date.now(), text: "Notizbuch „" + nb.name + "“ manuell bearbeitet" },
          { role: "assistant", ts: Date.now(), text: reply },
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
    const cleaned = md.trim() ? md.replace(/\n{3,}/g, "\n\n").trim() + "\n" : INITIAL_DOC;
    if (cleaned !== doc) {
      const oldDoc = doc;
      const nbId = activeNbRef.current;
      setSavingEdit(true);
      try {
        if (connected && settingsRef.current) {
          const ok = await commitDocNb(settingsRef.current, nbId, cleaned, "Manuelle Bearbeitung");
          if (!ok) return; // Konflikt: Editor offen lassen, Inhalt bleibt erhalten
        }
        docCache.current[nbId] = cleaned;
        setDoc(cleaned);
      } finally {
        setSavingEdit(false);
      }
      setEditing(false);
      requestFeedback(oldDoc, cleaned); // bewusst nicht awaited
      return;
    }
    setEditing(false);
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

  const exportMd = () =>
    downloadBlob(doc, "text/markdown",
      "wissensbasis-" + new Date().toISOString().slice(0, 10) + ".md");

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

      // 4. Chat, Modell, Klappzustände nach state.json
      setImporting("Chat & Einstellungen werden übertragen …");
      const payload = serializeState(nc, nm, ncolAll, activeNbRef.current);
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
      <header className="flex items-center gap-2 px-3 h-14 bg-white border-b border-slate-200">
        <BookOpen size={20} className="text-indigo-700" />
        {notebooks.length ? (
          <div className="relative">
            <select
              value={activeNb}
              disabled={editing}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__new__") { setNbError(null); setNewNbName(""); setShowNewNb(true); }
                else switchNotebook(v);
              }}
              className="appearance-none font-semibold tracking-tight bg-transparent hover:bg-slate-50 rounded-lg pl-1 pr-6 py-1 max-w-44 truncate"
              title="Notizbuch wählen"
            >
              {notebooks.map((n) => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
              <option value="__new__">＋ Neues Notizbuch …</option>
            </select>
            <ChevronDown size={14} className="absolute right-1 top-2.5 text-slate-500 pointer-events-none" />
          </div>
        ) : (
          <span className="font-semibold tracking-tight">Notizbuch</span>
        )}
        <span className="font-mono text-xs text-slate-400">v5.1</span>
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
            className="appearance-none text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg pl-2 pr-6 py-1 text-slate-700"
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
          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
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
                    "max-w-md px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words " +
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
                        className={"max-h-40 rounded-lg border border-slate-300 cursor-pointer " + (m.text ? "mb-2" : "")}
                      />
                    ) : (
                      <span className="block text-xs opacity-70 mb-1">[Bild]</span>
                    )
                  )}
                  {m.text}
                </div>
                {m.commit && (
                  <div className="mt-1 inline-flex items-center gap-1 font-mono text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-2 py-1">
                    <GitCommit size={12} />
                    <span>{fmtTime(m.ts)} · {m.commit}</span>
                  </div>
                )}
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
            <div className="flex items-end gap-2">
              <button
                onClick={() => imgInputRef.current && imgInputRef.current.click()}
                className="p-3 rounded-xl border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                title="Bild anhängen"
              >
                <ImagePlus size={18} />
              </button>
              <input
                ref={imgInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => { attachImage(e.target.files && e.target.files[0]); e.target.value = ""; }}
                className="hidden"
              />
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPaste={handlePaste}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                }}
                rows={2}
                placeholder="Notiz eintippen, diktieren oder Screenshot einfügen …"
                className="flex-1 min-w-0 resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-800"
              />
              <button
                onClick={send}
                className={"p-3 rounded-xl bg-indigo-700 text-white " +
                  (busy || (!input.trim() && !pendingImg) ? "opacity-40" : "hover:bg-indigo-800")}
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

              {/* Abschnitts-Tabs (wie OneNote-Seitenleiste): alle ##-Überschriften */}
              <nav
                style={{ "--nav-w": layout.navW + "px" }}
                className="w-28 md:w-[var(--nav-w)] shrink-0 overflow-y-auto py-2 pr-2 bg-slate-50/60"
              >
                <button
                  onClick={addQuickNote}
                  className="w-full flex items-center gap-1.5 text-left text-xs font-medium pl-2.5 pr-2 py-2 mb-2 rounded-r-xl border border-l-0 border-amber-300 bg-gradient-to-r from-amber-50 to-amber-100 text-amber-900 shadow-sm hover:to-amber-200"
                  title="Neue Schnellnotiz (Post-it)"
                >
                  <StickyNote size={13} className="shrink-0" />
                  Schnellnotiz
                </button>
                {sections.map((sec, si) => (
                  <button
                    key={si + sec.title}
                    onClick={() => gotoSection(si, sec.title)}
                    title={sec.title}
                    className={"w-full text-left text-xs pl-2.5 pr-2 py-1.5 mb-1.5 truncate rounded-r-xl border border-l-0 shadow-sm transition-colors " +
                      (activeSec === si
                        ? "bg-white border-indigo-300 text-indigo-900 font-medium shadow"
                        : "bg-gradient-to-r from-slate-50 to-slate-100 border-slate-200 text-slate-600 hover:from-indigo-50 hover:to-indigo-100 hover:text-slate-900")}
                  >
                    {sec.title}
                  </button>
                ))}
              </nav>
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
                <div key={item.path} className="flex items-center gap-2 px-4 py-2.5">
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
          onLogout={handleLogout}
          onClose={() => setShowSettings(false)}
          connecting={connecting}
          error={connectError}
          hasSettings={!!settings}
        />
      )}
    </div>
  );
}
