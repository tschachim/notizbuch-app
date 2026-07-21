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

// v7.27 Kontext (Nutzer-Befund/🟡, HEAD e0102c9): Dieser Block hier prüft
// weiterhin den ROHEN tiptap-markdown-Serialisierungs-Mechanismus – WENN
// der Platzhalter den Editor erreicht, kommt er als "*…*" wieder heraus
// (die Tatsache, die v7.22.1 überhaupt erst zur Zwei-Formen-Regel in
// stripInboxPlaceholder zwang). buildEditor/roundtrip HIER bilden bewusst
// NICHT den echten App-Ladepfad nach (kein Pre-Load-Strip) – seit v7.27
// wendet DocEditor.jsx stripInboxPlaceholder VOR dem Laden an, wodurch der
// Editor den Platzhalter in der Praxis nie mehr zu Gesicht bekommt (Grund:
// ein Klick mitten in die Zeile + Tippen verschmolz Nutzertext mit dem
// Hinweissatz, und der entstandene Murks matchte den exakten
// Zeilenvergleich danach nicht mehr – blieb für immer stehen). Der ECHTE
// v7.27-Ladepfad wird im Block "v7.27: Pre-Load-Strip" weiter unten
// geprüft (buildEditorLikeApp).
describe("Editor-Roundtrip: Anlage-Platzhalter wird vom ECHTEN Editor als '*…*' serialisiert (v7.22.1, roher Editor-Pfad OHNE Pre-Load-Strip)", () => {
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

// v7.27 (Nutzer-Befund/🟡, HEAD e0102c9): buildEditorLikeApp bildet GENAU
// die Ladepfad-Komposition aus DocEditor.jsx nach ("content:", siehe
// dortiger Kommentar) – stripInboxPlaceholder VOR mathToPlaceholders.
// resolveImgs (privat in DocEditor.jsx) bleibt hier bewusst weg: keines
// dieser Testdokumente enthält Bildreferenzen, der Aufruf wäre ein reiner
// No-op (gleiche Vereinfachung wie in tests/docEditorOutline.test.jsx &
// Co., die ebenfalls ohne resolveImgs auskommen).
function buildEditorLikeApp(md) {
  return buildEditor(stripInboxPlaceholder(md));
}
function roundtripLikeApp(md) {
  const editor = buildEditorLikeApp(md);
  const out = unescapeMd(editor.storage.markdown.getMarkdown());
  editor.destroy();
  return out;
}

describe("v7.27: Pre-Load-Strip verhindert, dass der Platzhalter den Editor je erreicht (Fix des Verschmelzungs-Findings)", () => {
  it("frisches Anlage-Template: das geladene Editor-Markdown enthält den Platzhalter in KEINER Form (weder Unterstrich- noch Asterisk-Form)", () => {
    const fresh = initialDocFor("QA-Test");
    const out = roundtripLikeApp(fresh);
    expect(out).not.toContain("Noch nichts erfasst");
    expect(out).not.toMatch(/[_*]Noch nichts erfasst/);
  });

  it("Öffnen+sofort-Speichern OHNE jede Änderung: Editor-Markdown zum Save-Zeitpunkt ist BYTE-IDENTISCH zur Baseline (onCreate) – genau die Bedingung, unter der DocEditor.jsx#save() onCancel() statt onSave() aufruft, also KEIN Commit-Pfad", () => {
    const fresh = initialDocFor("QA-Test");
    const editor = buildEditorLikeApp(fresh);
    const baseline = editor.storage.markdown.getMarkdown(); // wie DocEditor.jsx onCreate
    const mdAtSave = editor.storage.markdown.getMarkdown(); // wie DocEditor.jsx save(), ohne jede Bearbeitung dazwischen
    editor.destroy();
    expect(mdAtSave).toBe(baseline);
  });

  it("eine ECHTE Änderung führt zu einem von der Baseline abweichenden Ergebnis, weiterhin OHNE Platzhalter", () => {
    const fresh = initialDocFor("QA-Test");
    const editor = buildEditorLikeApp(fresh);
    const baseline = editor.storage.markdown.getMarkdown();
    editor.commands.focus("end");
    editor.commands.insertContent("Erste echte Notiz.");
    const mdAtSave = editor.storage.markdown.getMarkdown();
    editor.destroy();
    expect(mdAtSave).not.toBe(baseline);
    const out = unescapeMd(mdAtSave);
    expect(out).not.toContain("Noch nichts erfasst");
    expect(out).toContain("Erste echte Notiz.");
  });

  it("ein Dokument OHNE Platzhalter bleibt byte-identisch (Pre-Load-Strip ist für normale Dokumente ein No-op)", () => {
    const md = "# T\n\n## A\n\n- x\n\n# Kapitel Zwei\n\n## B\n\n- y";
    expect(roundtripLikeApp(md)).toBe(md);
  });

  it("BEIDE Kursiv-Formen werden bereits VOR dem Laden entfernt (Unterstrich-Form aus dem Anlage-Template UND Asterisk-Form aus einem bereits einmal per Editor gespeicherten Bestand, v7.22-Zwei-Formen-Regel wiederverwendet)", () => {
    const underscoreForm = "# QA-Test\n\n## Inbox\n\n" + PLACEHOLDER_LINE + "\n";
    const asteriskForm = "# QA-Test\n\n## Inbox\n\n*Noch nichts erfasst. Die erste Notiz im Chat legt hier los.*\n";
    expect(roundtripLikeApp(underscoreForm)).not.toContain("Noch nichts erfasst");
    expect(roundtripLikeApp(asteriskForm)).not.toContain("Noch nichts erfasst");
  });

  it("Randfall: Inbox enthält NUR den Platzhalter → der Editor zeigt eine leere Inbox-Überschrift (dokumentiertes Verhalten, kein Bug) statt eines editierbaren Platzhalter-Absatzes", () => {
    const fresh = initialDocFor("QA-Test");
    const editor = buildEditorLikeApp(fresh);
    const headingTexts = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "heading") headingTexts.push(node.textContent);
    });
    editor.destroy();
    expect(headingTexts).toContain("Inbox"); // Überschrift bleibt erhalten
    expect(headingTexts.join(" | ")).not.toContain("Noch nichts erfasst"); // aber ohne Platzhalter-Inhalt
  });
});
