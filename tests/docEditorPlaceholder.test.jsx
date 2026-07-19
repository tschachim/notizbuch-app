// @vitest-environment jsdom
//
// Echter TipTap-Roundtrip-Test für den Anlage-Platzhalter (v7.22.1,
// Re-Review 🟡): tests/ops.test.js prüft stripInboxPlaceholder() nur gegen
// von Hand nachgebaute "*…*"-Zeichenketten – das pinnt NICHT, dass der
// ECHTE WYSIWYG-Editor (tiptap-markdown) beim Speichern tatsächlich genau
// diese Form erzeugt. Hier läuft ein vollständiger markdown-it/TipTap-
// Zyklus über dieselbe Extensions-Konfiguration wie
// tests/docEditorLinks.test.jsx (die ihrerseits "exakt die Konfiguration
// aus DocEditor.jsx" nachbildet) – genau der Pfad, an dem der Review-Fund
// empirisch belegt wurde: ein frisches Anlage-Template, einmal im Editor
// geladen und ohne jede Änderung wieder gespeichert, trägt danach
// dauerhaft "*…*" statt "_..._". Nur DIESE Datei braucht jsdom
// (per-Datei-Override), der Rest der Suite bleibt bei environment:"node"
// (vitest.config.js).
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { Markdown } from "tiptap-markdown";
import {
  FencedCodeBlock, MdTable, MathInline, MathBlock, LinkDecorations, unescapeMd,
} from "../src/components/DocEditor.jsx";
import { mathToPlaceholders } from "../src/lib/math.jsx";
import { initialDocFor } from "../src/App.jsx";
import { PLACEHOLDER_LINE, stripInboxPlaceholder } from "../src/lib/ops.js";

// Identisch zu tests/docEditorLinks.test.jsx#buildEditor (siehe dort für die
// Begründung der einzelnen Extensions).
const LinkExt = Link.configure({
  openOnClick: false,
  autolink: true,
  linkOnPaste: true,
  isAllowedUri: (url, ctx) => ctx.defaultValidate(url) && /^https?:/i.test(url),
});

function buildEditor(md) {
  return new Editor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, blockquote: false }),
      FencedCodeBlock,
      LinkExt,
      LinkDecorations,
      MdTable.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      MathInline,
      MathBlock,
      Markdown.configure({ html: true, bulletListMarker: "-", tightLists: true }),
    ],
    content: mathToPlaceholders(md),
  });
}

// Simuliert genau das, was der No-op-Vergleich in DocEditor.jsx prüft:
// laden, sofort wieder speichern, ohne irgendetwas zu ändern (siehe
// tests/docEditorLinks.test.jsx#roundtrip).
function roundtrip(md) {
  const editor = buildEditor(md);
  const out = unescapeMd(editor.storage.markdown.getMarkdown());
  editor.destroy();
  return out;
}

describe("Editor-Roundtrip: Anlage-Platzhalter wird vom ECHTEN Editor als '*…*' serialisiert (v7.22.1)", () => {
  it("frisches Anlage-Template → Editor laden+speichern OHNE Änderung → Ergebnis trägt die Asterisk-Form (Beleg für den Review-Fund)", () => {
    const fresh = initialDocFor("QA-Test");
    expect(fresh).toContain(PLACEHOLDER_LINE); // Ausgangslage: Template nutzt die Unterstrich-Form
    const afterEditor = roundtrip(fresh);
    expect(afterEditor).not.toContain(PLACEHOLDER_LINE); // Unterstrich-Form ist weg …
    expect(afterEditor).toContain("*Noch nichts erfasst. Die erste Notiz im Chat legt hier los.*"); // … Asterisk-Form dafür da
  });

  it("stripInboxPlaceholder entfernt GENAU die vom echten Editor erzeugte Asterisk-Form vollständig", () => {
    const fresh = initialDocFor("QA-Test");
    const afterEditor = roundtrip(fresh);
    const cleaned = stripInboxPlaceholder(afterEditor);
    expect(cleaned).not.toContain("Noch nichts erfasst");
    expect(cleaned).not.toMatch(/[_*]Noch nichts/);
  });

  it("zweiter Editor-Zyklus NACH der Bereinigung bleibt stabil (kein Wiederauftauchen des Platzhalters)", () => {
    const fresh = initialDocFor("QA-Test");
    const cleaned = stripInboxPlaceholder(roundtrip(fresh));
    const again = roundtrip(cleaned || "# QA-Test\n\n## Inbox\n");
    expect(again).not.toContain("Noch nichts erfasst");
  });
});
