/* ------------------------------------------------------------------ */
/* GitHub Contents API als Speicher-Schicht                            */
/*                                                                     */
/* - Lesen/Schreiben über GET/PUT /repos/{owner}/{repo}/contents/{p}   */
/* - SHA des zuletzt gelesenen Stands wird vom Aufrufer mitgeführt;    */
/*   bei SHA-Konflikt wirft ghPutFile einen ShaConflictError.          */
/* - Alle Schreibzugriffe laufen durch eine Warteschlange, weil jeder  */
/*   Contents-PUT einen Commit auf main erzeugt und parallele Commits  */
/*   auf denselben Branch kollidieren würden.                          */
/* ------------------------------------------------------------------ */

const GH_API = "https://api.github.com";

export class ShaConflictError extends Error {
  constructor(message) {
    super(message || "SHA-Konflikt: Datei wurde zwischenzeitlich geändert");
    this.name = "ShaConflictError";
  }
}

function baseHeaders(cfg) {
  return {
    Authorization: "Bearer " + cfg.pat,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function contentsUrl(cfg, path, ref) {
  return (
    `${GH_API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}` +
    `/contents/${path}` +
    (ref ? `?ref=${encodeURIComponent(ref)}` : "")
  );
}

async function ghFetch(url, opts) {
  try {
    return await fetch(url, opts);
  } catch (e) {
    throw new Error("Keine Verbindung zu GitHub – bitte Netzwerk prüfen");
  }
}

function errorFor(res, detail) {
  if (res.status === 401) return new Error("GitHub-PAT ungültig oder abgelaufen (401) – bitte in den Einstellungen prüfen");
  if (res.status === 403) return new Error("GitHub-Zugriff verweigert (403) – hat der PAT die Berechtigung „Contents: Read and write“ für das Daten-Repo?");
  if (res.status === 404) return new Error("Nicht gefunden (404) – GitHub-Owner, Repo-Name und PAT-Repo-Zugriff prüfen");
  return new Error("GitHub-Fehler " + res.status + (detail ? ": " + detail : ""));
}

/* --- Base64 mit UTF-8 --- */

export function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function b64ToUtf8(b64) {
  const bin = atob(String(b64).replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* --- Lesen --- */

// Textdatei lesen: { text, sha } oder null bei 404.
export async function ghGetFile(cfg, path, ref) {
  const res = await ghFetch(contentsUrl(cfg, path, ref), { headers: baseHeaders(cfg) });
  if (res.status === 404) return null;
  if (!res.ok) throw errorFor(res);
  const data = await res.json();
  // Ab ~1 MB liefert die Contents API encoding "none" und leeren content.
  // Dann den Inhalt über den raw-Medientyp nachladen, statt still leeren
  // Text zurückzugeben (der beim nächsten Commit den Inhalt überschriebe).
  if (data.encoding !== "base64" || (!data.content && data.size > 0)) {
    const raw = await ghFetch(contentsUrl(cfg, path, ref), {
      headers: { ...baseHeaders(cfg), Accept: "application/vnd.github.raw+json" },
    });
    if (!raw.ok) throw errorFor(raw);
    // sha stammt aus dem ersten GET; ändert sich die Datei zwischen den beiden
    // Requests, fängt der reguläre ShaConflictError das beim nächsten PUT ab.
    return { text: await raw.text(), sha: data.sha };
  }
  return { text: b64ToUtf8(data.content || ""), sha: data.sha };
}

// Binärdatei (z. B. Bild) als Blob lesen – funktioniert auch über 1 MB,
// weil der raw-Medientyp den Inhalt direkt liefert.
export async function ghGetBlob(cfg, path, ref) {
  const res = await ghFetch(contentsUrl(cfg, path, ref), {
    headers: { ...baseHeaders(cfg), Accept: "application/vnd.github.raw+json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw errorFor(res);
  return await res.blob();
}

// Verzeichnis listen: [{ name, path, sha }], [] bei 404.
export async function ghListDir(cfg, path) {
  const res = await ghFetch(contentsUrl(cfg, path), { headers: baseHeaders(cfg) });
  if (res.status === 404) return [];
  if (!res.ok) throw errorFor(res);
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.filter((f) => f.type === "file").map((f) => ({ name: f.name, path: f.path, sha: f.sha }));
}

/* --- Schreiben (serialisiert) --- */

let writeQueue = Promise.resolve();
function enqueue(job) {
  const run = writeQueue.then(job, job);
  writeQueue = run.then(() => undefined, () => undefined);
  return run;
}

// Datei schreiben/anlegen. content ist bereits Base64.
// sha weglassen = Datei neu anlegen; sonst Update mit Konfliktschutz.
// Liefert { sha, commitSha }.
export function ghPutFile(cfg, path, base64Content, message, sha) {
  return enqueue(async () => {
    const res = await ghFetch(contentsUrl(cfg, path), {
      method: "PUT",
      headers: { ...baseHeaders(cfg), "Content-Type": "application/json" },
      body: JSON.stringify({
        message: message || "Aktualisierung",
        content: base64Content,
        ...(sha ? { sha } : {}),
      }),
    });
    if (res.status === 409) throw new ShaConflictError();
    if (res.status === 422) {
      const detail = await res.text().catch(() => "");
      if (/sha/i.test(detail)) throw new ShaConflictError();
      throw errorFor(res, detail.slice(0, 200));
    }
    if (!res.ok) throw errorFor(res);
    const data = await res.json();
    return {
      sha: data.content && data.content.sha,
      commitSha: data.commit && data.commit.sha,
    };
  });
}

/* --- Historie (echte Git-Commits) --- */

// Commits, die eine Datei berührt haben – neueste zuerst.
// [{ sha, msg, ts, parent }]
export async function ghListCommits(cfg, path, perPage = 30) {
  const url =
    `${GH_API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}` +
    `/commits?path=${encodeURIComponent(path)}&per_page=${perPage}`;
  const res = await ghFetch(url, { headers: baseHeaders(cfg) });
  if (!res.ok) throw errorFor(res);
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.map((c) => ({
    sha: c.sha,
    msg: ((c.commit && c.commit.message) || "").split("\n")[0],
    ts: new Date((c.commit && c.commit.committer && c.commit.committer.date) || 0).getTime(),
    parent: c.parents && c.parents[0] ? c.parents[0].sha : null,
  }));
}

// Anzahl der Commits einer Datei + Zeitstempel des jüngsten.
// Der Trick: per_page=1 und die letzte Seitennummer aus dem Link-Header lesen.
export async function ghCommitMeta(cfg, path) {
  const url =
    `${GH_API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}` +
    `/commits?path=${encodeURIComponent(path)}&per_page=1`;
  const res = await ghFetch(url, { headers: baseHeaders(cfg) });
  if (!res.ok) throw errorFor(res);
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) return { count: 0, lastTs: null };
  let count = 1;
  const link = res.headers.get("Link") || "";
  const m = /[?&]page=(\d+)>;\s*rel="last"/.exec(link);
  if (m) count = parseInt(m[1], 10);
  const lastTs = new Date(
    (data[0].commit && data[0].commit.committer && data[0].commit.committer.date) || 0
  ).getTime();
  return { count, lastTs };
}

/* --- Verbindungscheck für den Settings-Dialog --- */

export async function ghCheckRepo(cfg) {
  const res = await ghFetch(
    `${GH_API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`,
    { headers: baseHeaders(cfg) }
  );
  if (!res.ok) throw errorFor(res);
  return true;
}
