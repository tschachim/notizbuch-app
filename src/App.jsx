import { useState, useEffect, useRef, useCallback } from "react";
import {
  BookOpen, Send, Pencil, X, Check, History, Download, Copy,
  RotateCcw, GitCommit, ChevronDown, Loader2, Upload, ImagePlus,
  Settings, AlertTriangle,
} from "lucide-react";

import { applyOps, dispHead } from "./lib/ops.js";
import { diffLines, contextize } from "./lib/diff.js";
import { DocView, IMG_REF_RE } from "./lib/markdown.jsx";
import {
  prepareImage, newImgId, extForMime, mimeForName, dataUrlParts, blobToDataURL,
} from "./lib/images.js";
import { MODELS, callClaude } from "./lib/anthropic.js";
import {
  ShaConflictError, utf8ToB64, ghGetFile, ghGetBlob, ghListDir, ghPutFile,
  ghListCommits, ghCommitMeta, ghCheckRepo,
} from "./lib/github.js";
import { loadSettings, saveSettings, clearSettings } from "./lib/settings.js";
import SettingsDialog from "./components/SettingsDialog.jsx";

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

const serializeState = (chat, model, collapsed) =>
  JSON.stringify({ v: 1, chat, model, collapsed: collapsed || {} }, null, 2);

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

  const [doc, setDoc] = useState(INITIAL_DOC);
  const [chat, setChat] = useState([]);
  const [model, setModel] = useState(MODELS[0].id);
  const [collapsed, setCollapsed] = useState({});
  const [meta, setMeta] = useState({ count: 0, lastTs: null });

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState("chat");
  const [notesDirty, setNotesDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
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

  const settingsRef = useRef(null);
  const connectedRef = useRef(false);
  const busyRef = useRef(false);
  const editingRef = useRef(false);
  const stateRef = useRef({ chat: [], model: MODELS[0].id, collapsed: {} });
  const docSha = useRef(null);
  const stateSha = useRef(null);
  const stateTimer = useRef(null);
  const lastSavedState = useRef(null);
  const lastRefresh = useRef(0);
  const imgIndex = useRef({}); // id -> Pfad im Daten-Repo
  const versionCache = useRef(new Map()); // Commit-SHA -> Dokumenttext

  useEffect(() => { connectedRef.current = connected; }, [connected]);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => { editingRef.current = editing; }, [editing]);
  useEffect(() => { stateRef.current = { chat, model, collapsed }; }, [chat, model, collapsed]);

  /* ---------- Metadaten (Stand & Versionszahl) ---------- */
  const refreshMeta = useCallback(async (cfg) => {
    try { setMeta(await ghCommitMeta(cfg, DOC_PATH)); } catch (e) { /* unkritisch */ }
  }, []);

  /* ---------- Verbinden & Laden ---------- */
  const connect = useCallback(async (cfg) => {
    setConnecting(true);
    setConnectError(null);
    try {
      await ghCheckRepo(cfg);

      let file = await ghGetFile(cfg, DOC_PATH);
      if (!file) {
        const put = await ghPutFile(cfg, DOC_PATH, utf8ToB64(INITIAL_DOC), "Initiale Wissensbasis");
        file = { text: INITIAL_DOC, sha: put.sha };
      }

      let nChat = [WELCOME];
      let nModel = MODELS[0].id;
      let nCollapsed = {};
      const st = await ghGetFile(cfg, STATE_PATH);
      stateSha.current = st ? st.sha : null;
      if (st) {
        try {
          const data = JSON.parse(st.text);
          if (Array.isArray(data.chat) && data.chat.length) nChat = data.chat;
          if (typeof data.model === "string" && MODELS.some((m) => m.id === data.model)) nModel = data.model;
          if (data.collapsed && typeof data.collapsed === "object") nCollapsed = data.collapsed;
        } catch (e) { /* defekter State → Defaults */ }
      }

      const files = await ghListDir(cfg, "bilder");
      const idx = {};
      for (const f of files) {
        const m = /^([a-zA-Z0-9]+)\.(jpg|jpeg|png|webp|gif)$/i.exec(f.name);
        if (m) idx[m[1]] = f.path;
      }
      imgIndex.current = idx;
      failedImgs.current = new Set();
      versionCache.current = new Map();

      docSha.current = file.sha;
      lastSavedState.current = serializeState(nChat, nModel, nCollapsed);
      setDoc(file.text);
      setChat(nChat);
      setModel(nModel);
      setCollapsed(nCollapsed);
      setSettings(cfg);
      settingsRef.current = cfg;
      setConnected(true);
      setShowSettings(false);
      setSaveState("saved");
      setStorageError(null);
      setBanner(null);
      refreshMeta(cfg);
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
    }
  }, []);

  useEffect(() => {
    if (!connected || !settingsRef.current) return;
    const payload = serializeState(chat, model, collapsed);
    if (payload === lastSavedState.current) return;
    setSaveState("saving");
    if (stateTimer.current) clearTimeout(stateTimer.current);
    const cfg = settingsRef.current;
    stateTimer.current = setTimeout(() => {
      stateTimer.current = null;
      flushState(cfg, payload);
    }, 2500);
  }, [chat, model, collapsed, connected, flushState]);

  /* ---------- Dokument committen (genau 1 Commit pro Änderung) ---------- */
  // Liefert true bei Erfolg. Bei SHA-Konflikt: Remote-Stand laden, Nutzer
  // informieren, nichts überschreiben (Eingabe bleibt beim Aufrufer erhalten).
  const commitDoc = useCallback(async (cfg, newText, message) => {
    setSaveState("saving");
    try {
      const put = await ghPutFile(cfg, DOC_PATH, utf8ToB64(newText), message, docSha.current || undefined);
      docSha.current = put.sha;
      setMeta((m) => ({ count: (m.count || 0) + 1, lastTs: Date.now() }));
      setSaveState("saved");
      setStorageError(null);
      return true;
    } catch (e) {
      if (e instanceof ShaConflictError) {
        try {
          const f = await ghGetFile(cfg, DOC_PATH);
          if (f) { docSha.current = f.sha; setDoc(f.text); }
          refreshMeta(cfg);
        } catch (e2) { /* Reload fehlgeschlagen – Banner reicht */ }
        setSaveState("saved");
        setBanner({
          kind: "warn",
          text: "Die Wissensbasis wurde zwischenzeitlich auf einem anderen Gerät geändert. " +
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
        const f = await ghGetFile(cfg, DOC_PATH);
        if (f && f.sha !== docSha.current) {
          docSha.current = f.sha;
          setDoc(f.text);
          refreshMeta(cfg);
        }
        // Chat/Modell/Klappzustände nur übernehmen, wenn lokal nichts aussteht
        if (!stateTimer.current) {
          const st = await ghGetFile(cfg, STATE_PATH);
          if (st && st.sha !== stateSha.current) {
            stateSha.current = st.sha;
            try {
              const data = JSON.parse(st.text);
              const nChat = Array.isArray(data.chat) && data.chat.length ? data.chat : [WELCOME];
              const nModel = typeof data.model === "string" && MODELS.some((x) => x.id === data.model)
                ? data.model : stateRef.current.model;
              const nCollapsed = data.collapsed && typeof data.collapsed === "object" ? data.collapsed : {};
              lastSavedState.current = serializeState(nChat, nModel, nCollapsed);
              setChat(nChat);
              setModel(nModel);
              setCollapsed(nCollapsed);
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
      // Bild zuerst als Datei ins Daten-Repo, damit die Dokument-Referenz
      // auf allen Geräten auflösbar ist.
      if (img && imgId) {
        const parts = dataUrlParts(img.dataUrl);
        if (!parts) throw new Error("Bilddaten unlesbar");
        const path = "bilder/" + imgId + "." + extForMime(parts.mime);
        await ghPutFile(cfg, path, parts.base64, "Bild " + imgId + " hinzugefügt");
        imgIndex.current[imgId] = path;
      }

      const res = await callClaude(cfg.apiKey, text, doc, chat, model, img, imgId);

      let newDoc = doc;
      let commit = null;
      let newCollapsed = collapsed;

      if (res.ops.length) {
        const applied = applyOps(doc, res.ops);
        if (applied !== doc) {
          commit = res.commit || "Aktualisierung";
          const ok = await commitDoc(cfg, applied, commit);
          if (!ok) {
            // SHA-Konflikt: Remote-Stand ist bereits geladen, Eingabe zurückgeben.
            setInput(text);
            if (img) setPendingImg(img);
            const aMsg = {
              role: "assistant",
              error: true,
              ts: Date.now(),
              text:
                "Die Wissensbasis wurde zwischenzeitlich auf einem anderen Gerät geändert – " +
                "ich habe den neuen Stand geladen und nichts überschrieben. " +
                "Deine Nachricht steht wieder im Eingabefeld, bitte einfach noch einmal senden.",
            };
            setChat([...chatWithUser, aMsg].slice(-80));
            return;
          }
          newDoc = applied;

          // Betroffene Abschnitte automatisch aufklappen
          const touched = res.ops.map((o) => dispHead(o.heading)).filter(Boolean);
          if (touched.length && Object.keys(collapsed).length) {
            const nc = { ...collapsed };
            let hit = false;
            Object.keys(nc).forEach((k) => {
              const path = k.slice(2); // "s:" abschneiden
              if (touched.some((t) => path === t || path.startsWith(t + "/"))) {
                delete nc[k];
                hit = true;
              }
            });
            if (hit) { newCollapsed = nc; setCollapsed(nc); }
          }
        }
      }

      const aMsg = { role: "assistant", text: res.reply, ts: Date.now(), commit };
      const finalChat = [...chatWithUser, aMsg].slice(-80);

      setDoc(newDoc);
      setChat(finalChat);
      if (commit && view === "chat") setNotesDirty(true);
    } catch (e) {
      const aMsg = {
        role: "assistant",
        error: true,
        ts: Date.now(),
        text:
          "Anfrage fehlgeschlagen: " + (e && e.message ? e.message : "unbekannter Fehler") +
          ". Deine Nachricht ist nicht verloren – sende sie einfach noch einmal.",
      };
      setChat([...chatWithUser, aMsg].slice(-80));
    } finally {
      setBusy(false);
    }
  };

  /* ---------- Zuklappen ---------- */
  const toggleCollapse = (key) => {
    setCollapsed((prev) => {
      const n = { ...prev };
      if (n[key]) delete n[key];
      else n[key] = true;
      return n;
    });
  };

  /* ---------- Manuelles Bearbeiten ---------- */
  const startEdit = () => { setDraft(doc); setEditing(true); };
  const cancelEdit = () => setEditing(false);
  const saveEdit = async () => {
    if (draft !== doc) {
      const cleaned = draft.trim() ? draft.replace(/\n{3,}/g, "\n\n") : INITIAL_DOC;
      if (connected && settingsRef.current) {
        const ok = await commitDoc(settingsRef.current, cleaned, "Manuelle Bearbeitung");
        if (!ok) return; // Konflikt: Editor offen lassen, Entwurf bleibt erhalten
      }
      setDoc(cleaned);
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
    ghListCommits(settingsRef.current, DOC_PATH, 30)
      .then((list) => setHistory(list))
      .catch((e) => setHistoryError(e && e.message ? e.message : String(e)))
      .finally(() => setHistoryLoading(false));
  };

  const loadVersion = async (sha) => {
    if (versionCache.current.has(sha)) return versionCache.current.get(sha);
    const f = await ghGetFile(settingsRef.current, DOC_PATH, sha);
    const text = f ? f.text : null; // null: Datei existierte in diesem Stand noch nicht
    versionCache.current.set(sha, text);
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
    const text = versionCache.current.get(entry.sha);
    if (typeof text !== "string" || text === doc) return;
    const ok = await commitDoc(settingsRef.current, text, "Wiederhergestellt: Stand " + fmtStamp(entry.ts));
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
      JSON.stringify({ v: 1, doc, history: [], chat, model, collapsed, images }, null, 2),
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
    if (!data || typeof data.doc !== "string" || !data.doc.trim()) {
      setBanner({ kind: "warn", text: "Import fehlgeschlagen: Datei enthält kein gültiges Notizbuch-Backup." });
      return;
    }
    if (!connected || !settingsRef.current) {
      setShowSettings(true);
      return;
    }
    const cfg = settingsRef.current;

    const nd = data.doc;
    const nh = Array.isArray(data.history) ? data.history : [];
    const nc = Array.isArray(data.chat) && data.chat.length ? data.chat.slice(-80) : [WELCOME];
    const nm = typeof data.model === "string" && MODELS.some((x) => x.id === data.model)
      ? data.model : model;
    const ncol = data.collapsed && typeof data.collapsed === "object" ? data.collapsed : {};
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

      // 2. Wissensbasis übernehmen
      setImporting("Wissensbasis wird übertragen …");
      const ok = await commitDoc(cfg, nd, "Import aus Artifact-Backup");
      if (!ok) {
        setImporting(null);
        setBanner({
          kind: "warn",
          text: "Import abgebrochen: Die Wissensbasis wurde parallel geändert. Bitte den Import einfach noch einmal starten (bereits übertragene Bilder werden übersprungen).",
        });
        return;
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
      const payload = serializeState(nc, nm, ncol);
      const curSt = await ghGetFile(cfg, STATE_PATH);
      const putSt = await ghPutFile(cfg, STATE_PATH, utf8ToB64(payload),
        "Import: Chat & Einstellungen", curSt ? curSt.sha : undefined);
      stateSha.current = putSt.sha;
      lastSavedState.current = payload;

      // Lokalen Zustand nachziehen
      failedImgs.current = new Set();
      setDoc(nd);
      setChat(nc);
      setModel(nm);
      setCollapsed(ncol);
      setImgMap((prev) => ({ ...prev, ...Object.fromEntries(imgs) }));
      setImporting(null);
      setShowHistory(false);
      setExpanded(null);
      setBanner({
        kind: "info",
        text: `Import abgeschlossen: Wissensbasis, ${imgs.length} Bild(er), Chat und Einstellungen übertragen` +
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
        <span className="font-semibold tracking-tight">Notizbuch</span>
        <span className="font-mono text-xs text-slate-400">v4.0</span>
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
          onClick={() => setView("chat")}
          className={"flex-1 py-1.5 rounded-lg text-sm font-medium " +
            (view === "chat" ? "bg-slate-900 text-white" : "text-slate-600")}
        >
          Chat
        </button>
        <button
          onClick={() => { setView("notes"); setNotesDirty(false); }}
          className={"relative flex-1 py-1.5 rounded-lg text-sm font-medium " +
            (view === "notes" ? "bg-slate-900 text-white" : "text-slate-600")}
        >
          Wissensbasis
          {notesDirty && view !== "notes" && (
            <span className="absolute top-1 right-3 w-2 h-2 bg-indigo-600 rounded-full" />
          )}
        </button>
      </div>

      {/* Hauptbereich */}
      <main className="flex-1 min-h-0 flex">

        {/* ---------------- Chat (links, 50 %) ---------------- */}
        <section
          className={(view === "chat" ? "flex" : "hidden") +
            " md:flex flex-col flex-1 min-w-0 bg-slate-50"}
        >
          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
            {chat.map((m, i) => (
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
                <span>strukturiert …</span>
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

        {/* ---------------- Wissensbasis (rechts, 50 %) ---------------- */}
        <section
          className={(view === "notes" ? "flex" : "hidden") +
            " md:flex flex-col flex-1 min-w-0 bg-white md:border-l border-slate-200 " +
            (flash ? "ring-2 ring-inset ring-indigo-300" : "")}
        >
          {/* Aktenkopf */}
          <div className="flex items-center gap-2 px-4 pt-4 pb-2">
            <div className="flex flex-col">
              <span className="text-xs tracking-widest uppercase text-slate-500">Wissensbasis</span>
              <span className="font-mono text-xs text-slate-400">Stand {lastStand} · {meta.count} Versionen</span>
            </div>
            <div className="flex-1" />
            {!editing && (
              <>
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
            <div className="flex-1 min-h-0 flex flex-col px-4 pb-4 gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="flex-1 min-h-0 w-full resize-none rounded-lg border border-indigo-300 bg-white p-3 font-mono text-sm text-slate-800"
              />
              <div className="flex items-center gap-2">
                <button onClick={saveEdit}
                  className="px-3 py-1.5 rounded-lg bg-indigo-700 text-white text-sm font-medium hover:bg-indigo-800">
                  Speichern
                </button>
                <button onClick={cancelEdit}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 text-sm hover:bg-slate-50">
                  Abbrechen
                </button>
                <span className="text-xs text-slate-400">Speichern legt eine neue Version an. Bildreferenzen ![…](img:…) nicht verändern.</span>
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-8">
              <DocView
                text={doc}
                collapsed={collapsed}
                onToggle={toggleCollapse}
                imgMap={imgMap}
                onImgClick={(src) => setLightbox(src)}
              />
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
