import { defineConfig } from "vitest/config";

// Unit-Tests decken die Logik-Schicht (src/lib) ab; die UI (App.jsx,
// Komponenten) wird über die End-to-End-Testfälle (docs/TESTFAELLE.md,
// Tester-Agent gegen die deployte App) geprüft. Coverage-Gate: 60 %.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{js,jsx}"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**"],
      reporter: ["text", "text-summary"],
      thresholds: {
        lines: 60,
        statements: 60,
        functions: 60,
        branches: 60,
      },
    },
  },
});
