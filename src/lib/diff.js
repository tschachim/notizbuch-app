/* ------------------------------------------------------------------ */
/* Zeilen-Diff (LCS) & Kontext-Ansicht                                 */
/* 1:1 aus der Referenz-App (Artifact v3.1) übernommen.                */
/* ------------------------------------------------------------------ */

export function diffLines(oldT, newT) {
  const A = oldT.split("\n");
  const B = newT.split("\n");
  if (A.length * B.length > 400000) return null;
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ t: "s", l: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: "d", l: A[i] }); i++; }
    else { out.push({ t: "a", l: B[j] }); j++; }
  }
  while (i < n) out.push({ t: "d", l: A[i++] });
  while (j < m) out.push({ t: "a", l: B[j++] });
  return out;
}

export function contextize(diff, ctx = 1) {
  const changed = diff.map((d) => d.t !== "s");
  if (!changed.some(Boolean)) return [{ t: "info", l: "Keine inhaltliche Änderung." }];
  const keep = diff.map((_, i) => {
    for (let k = Math.max(0, i - ctx); k <= Math.min(diff.length - 1, i + ctx); k++) {
      if (changed[k]) return true;
    }
    return false;
  });
  const out = [];
  let gap = false;
  diff.forEach((d, i) => {
    if (keep[i]) { out.push(d); gap = false; }
    else if (!gap) { out.push({ t: "gap" }); gap = true; }
  });
  return out;
}
