import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// base = Repo-Name, weil die App als GitHub-Pages-Projektseite
// unter https://<owner>.github.io/notizbuch-app/ läuft.
export default defineConfig({
  base: "/notizbuch-app/",
  plugins: [react(), tailwindcss()],
});
