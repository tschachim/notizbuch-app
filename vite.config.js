import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// base = Repo-Name, weil die App als GitHub-Pages-Projektseite
// unter https://<owner>.github.io/notizbuch-app/ läuft.
//
// v7.54 (Vorschlag B Stufe 1, DECISIONS #112): evals/ (Replay-Korpus,
// evals/corpus/*.json + zugehörige Test-Fixtures) liegt bewusst NEBEN src/
// im Repo-Root - Vite bündelt ohnehin nur, was index.html transitiv
// importiert, evals/ wird von KEINER Quelldatei importiert und landet daher
// nie im Produktions-Bundle. Kein rollupOptions.external nötig (es gibt
// nichts zu externalisieren); optimizeDeps.entries grenzt den Dev-Server-
// Vorab-Scan zusätzlich explizit auf index.html ein, damit ein künftiges
// Tool (z. B. ein Node-Skript unter evals/) den Scan nicht versehentlich
// mit einbezieht.
export default defineConfig({
  base: "/notizbuch-app/",
  plugins: [react(), tailwindcss()],
  optimizeDeps: { entries: ["index.html"] },
});
