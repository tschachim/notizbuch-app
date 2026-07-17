// @vitest-environment jsdom
//
// Echter TipTap-Roundtrip-Test für generische Links (v7.8, wie
// tests/docEditorCode.test.jsx / tests/docEditorMath.test.jsx): Statt nur
// String-Helfer zu prüfen, läuft hier ein vollständiger markdown-it/TipTap-
// Zyklus über die ECHTE Link-Konfiguration und das LinkDecorations-Plugin
// aus DocEditor.jsx. Editor.view.dom ist auch OHNE explizites element:
// (siehe @tiptap/core-Default: document.createElement('div')) ein echtes,
// von jsdom gerendertes DOM-Element – damit lassen sich auch die
// Decoration-Klassen (cite-link/doc-link) prüfen, nicht nur die
// Markdown-Serialisierung. Nur DIESE Datei braucht jsdom (per-Datei-
// Override), der Rest der Suite bleibt bei environment:"node"
// (vitest.config.js).
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { Markdown } from "tiptap-markdown";
import {
  FencedCodeBlock, MdTable, MathInline, MathBlock, LinkDecorations,
  unescapeMd, validateLinkTitle, normalizeLinkUrl,
} from "../src/components/DocEditor.jsx";
import { mathToPlaceholders } from "../src/lib/math.jsx";
import { setLinkProviders } from "../src/lib/linkProviders.jsx";

// Exakt die Link-Konfiguration aus DocEditor.jsx (v7.8, inkl. isAllowedUri
// aus der Finding-2-Nachbesserung) – ein Test mit abweichender Konfiguration
// (z. B. autolink:false oder ohne isAllowedUri) würde die eigentliche
// Änderung dieser Version nicht abdecken.
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
// laden, sofort wieder speichern, ohne irgendetwas zu ändern.
function roundtrip(md) {
  const editor = buildEditor(md);
  const out = unescapeMd(editor.storage.markdown.getMarkdown());
  editor.destroy();
  return out;
}

// Simuliert applyLink() aus DocEditor.jsx (Titel/URL zuerst durch die ECHTEN
// Validierungsfunktionen, dann als Textknoten mit Link-Mark eingefügt) und
// prüft danach den vollen Editor-Roundtrip inkl. eines ZWEITEN Lade+Speicher-
// Zyklus (Nachbesserung Finding 1: eine von normalizeLinkUrl transformierte
// URL muss ab dem ERSTEN Speichern stabil bleiben, nicht erst nach mehreren
// Zyklen "einschwingen").
function roundtripViaDialog(rawUrl, title = "Titel") {
  const t = validateLinkTitle(title);
  const u = normalizeLinkUrl(rawUrl);
  if (t.error || u.error) throw new Error("Testfehler: unerwarteter Validierungsfehler " + (t.error || u.error));
  const editor = buildEditor("# T\n\n## A\n\nAlt");
  editor.commands.focus("end");
  editor.chain().focus().insertContent({
    type: "text",
    text: t.title,
    marks: [{ type: "link", attrs: { href: u.url } }],
  }).run();
  const out = unescapeMd(editor.storage.markdown.getMarkdown());
  editor.destroy();
  const editor2 = buildEditor(out);
  const out2 = unescapeMd(editor2.storage.markdown.getMarkdown());
  editor2.destroy();
  return { url: u.url, out, out2 };
}

describe("Editor-Roundtrip: generische Links bleiben No-op-stabil (v7.8)", () => {
  it("[Titel](url) bleibt über Laden+Speichern byte-identisch", () => {
    const md = "# T\n\n## A\n\n[Titel](https://example.org/pfad)";
    expect(roundtrip(md)).toBe(md);
  });

  it("[Titel](url) mitten in einem Satz bleibt byte-identisch", () => {
    const md = "# T\n\n## A\n\nSiehe [Titel](https://example.org/pfad) dazu.";
    expect(roundtrip(md)).toBe(md);
  });

  it("Fußnote [3](url) bleibt nach Roundtrip weiterhin numerisch (keine Titel-Mutation)", () => {
    const md = "# T\n\n## A\n\nFakt[3](https://example.org/x) hier.";
    expect(roundtrip(md)).toBe(md);
  });

  it("Titel mit Umlauten und & bleibt erhalten", () => {
    const md = "# T\n\n## A\n\n[Über uns & Söhne](https://example.org/ueber)";
    expect(roundtrip(md)).toBe(md);
  });

  it("Link in einer Tabellenzelle bleibt stabil", () => {
    // Absichtlich NICHT als letzter Block im Dokument: eine Tabelle am
    // Dokumentende bekommt beim Serialisieren unabhängig von Links einen
    // zusätzlichen Zeilenumbruch angehängt (bestehende, von den Links hier
    // unabhängige MdTable-Eigenheit – siehe auch die toContain-Assertions
    // für Tabellen in tests/docEditorMath.test.jsx). Ein Folge-Absatz hält
    // diesen Test auf die eigentliche Link-Frage fokussiert.
    const md = "# T\n\n## A\n\n| A | B |\n| --- | --- |\n| [Titel](https://example.org/x) | y |\n\nEnde.";
    expect(roundtrip(md)).toBe(md);
  });

  it("Link in einem Listen-Eintrag bleibt stabil", () => {
    const md = "# T\n\n## A\n\n- [Titel](https://example.org/x)\n- zweiter Punkt";
    expect(roundtrip(md)).toBe(md);
  });

  it("Link unmittelbar neben einer $x$-Formel bleibt stabil (beides je eigener Node-Typ)", () => {
    const md = "# T\n\n## A\n\n[Titel](https://example.org/x) und $x$ Text.";
    expect(roundtrip(md)).toBe(md);
  });

  it("Link unmittelbar neben einem Codespan bleibt stabil", () => {
    const md = "# T\n\n## A\n\n`code` und [Titel](https://example.org/x) hier.";
    expect(roundtrip(md)).toBe(md);
  });

  it("mehrere generische Links UND eine Fußnote im selben Dokument bleiben unabhängig stabil", () => {
    const md =
      "# T\n\n## A\n\n- [Erster Link](https://a.example/1)\n" +
      "- Fakt[2](https://b.example/2) dazu\n" +
      "- [2024-Bericht](https://c.example/3)";
    expect(roundtrip(md)).toBe(md);
  });
});

describe("Editor-Ladepfad: CommonMark-Autolink <url> (v7.8)", () => {
  it("<https://example.org/x> wird geladen und ergibt einen Link-Mark mit Text==href", () => {
    const md = "# T\n\n## A\n\n<https://example.org/x>";
    const editor = buildEditor(md);
    let linkText = null;
    let href = null;
    editor.state.doc.descendants((node) => {
      const mark = node.isText && node.marks.find((m) => m.type.name === "link");
      if (mark) { linkText = node.text; href = mark.attrs.href; }
    });
    editor.destroy();
    expect(href).toBe("https://example.org/x");
    expect(linkText).toBe("https://example.org/x");
  });

  it("<https://example.org/x> bleibt über ZWEI Roundtrips stabil (idempotent, autolink-Form)", () => {
    const md = "# T\n\n## A\n\n<https://example.org/x>";
    const once = roundtrip(md);
    expect(once).toBe("# T\n\n## A\n\n<https://example.org/x>");
    const twice = roundtrip(once);
    expect(twice).toBe(once);
  });
});

describe("Editor: Autolink beim Tippen (Link.configure autolink:true)", () => {
  it("eine getippte URL gefolgt von einem Leerzeichen wird automatisch zu einem Link-Mark", () => {
    const editor = buildEditor("# T\n\n## A\n\nAlt");
    editor.commands.focus("end");
    editor.commands.insertContent("Neu: https://example.org ");
    let hasLink = false;
    let href = null;
    editor.state.doc.descendants((node) => {
      const mark = node.isText && node.marks.find((m) => m.type.name === "link");
      if (mark) { hasLink = true; href = mark.attrs.href; }
    });
    editor.destroy();
    expect(hasLink).toBe(true);
    expect(href).toBe("https://example.org");
  });

  // Nachbesserung Finding 2 (Re-Review 2026-07-17): @tiptap/extension-link
  // 2.27.2 erlaubt per Default auch mailto:/tel:/ftp:/… (isAllowedUri() in
  // node_modules/@tiptap/extension-link/dist/index.js) – eine getippte
  // E-Mail-Adresse würde ohne die isAllowedUri-Einschränkung in
  // DocEditor.jsx OHNE jede Nutzeraktion einen mailto:-Link-Mark erzeugen,
  // den der Viewer (nur http(s), LINK_URL_RE) danach als Klartext zeigt –
  // Editor und Viewer liefen auseinander.
  it("eine getippte E-Mail-Adresse gefolgt von einem Leerzeichen erzeugt KEINEN Link-Mark (nur http/https erlaubt)", () => {
    const editor = buildEditor("# T\n\n## A\n\nAlt");
    editor.commands.focus("end");
    editor.commands.insertContent("Kontakt: max@example.com ");
    let hasLink = false;
    editor.state.doc.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === "link")) hasLink = true;
    });
    editor.destroy();
    expect(hasLink).toBe(false);
  });

  // Kein echtes Clipboard-Event (jsdom bildet das nicht zuverlässig ab) –
  // stattdessen der setLink-Befehl, der GENAU dieselbe isAllowedUri-Prüfung
  // durchläuft wie die markPasteRule von linkOnPaste (siehe addPasteRules()
  // UND addCommands() in node_modules/@tiptap/extension-link/dist/index.js:
  // beide rufen this.options.isAllowedUri(...) auf). Zeigt, dass die
  // Einschränkung nicht nur für das Autolink-Plugin, sondern für ALLE
  // Konsumenten der Option greift.
  it("der setLink-Befehl (derselbe Validierungspfad wie linkOnPaste) lehnt mailto: ebenfalls ab", () => {
    const editor = buildEditor("# T\n\n## A\n\nAlt");
    editor.commands.focus("end");
    const ok = editor.chain().focus().setLink({ href: "mailto:max@example.com" }).run();
    editor.destroy();
    expect(ok).toBe(false);
  });
});

describe("Editor: Decorations unterscheiden Fußnote (cite-link) und generischen Link (doc-link)", () => {
  it("ein numerischer Link-Titel bekommt die Klasse 'cite-link', ein sprechender 'doc-link'", () => {
    const md =
      "# T\n\n## A\n\nFakt[3](https://example.org/x) und [Sprechender Titel](https://example.org/y) hier.";
    const editor = buildEditor(md);
    const html = editor.view.dom.innerHTML;
    editor.destroy();
    expect(html).toContain("cite-link");
    expect(html).toContain("doc-link");
  });

  it("ein Autolink (Text==href) bekommt ebenfalls die Klasse 'doc-link' (kein numerischer Text)", () => {
    const md = "# T\n\n## A\n\n<https://example.org/x>";
    const editor = buildEditor(md);
    const html = editor.view.dom.innerHTML;
    editor.destroy();
    expect(html).toContain("doc-link");
    expect(html).not.toContain("cite-link");
  });

  it("Decorations werden nach einer echten Doc-Änderung neu berechnet (nicht stehen gelassen)", () => {
    const md = "# T\n\n## A\n\n[Sprechender Titel](https://example.org/y) Text.";
    const editor = buildEditor(md);
    expect(editor.view.dom.innerHTML).toContain("doc-link");
    // Den Link-Text komplett löschen -> keine Link-Decoration mehr übrig.
    let from = null;
    let to = null;
    editor.state.doc.descendants((node, pos) => {
      if (from === null && node.isText && node.marks.some((m) => m.type.name === "link")) {
        from = pos;
        to = pos + node.nodeSize;
      }
    });
    editor.chain().command(({ tr }) => { tr.delete(from, to); return true; }).run();
    const html = editor.view.dom.innerHTML;
    editor.destroy();
    expect(html).not.toContain("doc-link");
    expect(html).not.toContain("cite-link");
  });
});

describe("validateLinkTitle (Link-Dialog, DocEditor.jsx)", () => {
  it("akzeptiert einen normalen Titel unverändert", () => {
    expect(validateLinkTitle("Azure Work Item")).toEqual({ title: "Azure Work Item" });
  });

  it("blockiert reine Ziffern (für Quellen-Fußnoten reserviert)", () => {
    const r = validateLinkTitle("42");
    expect(r.title).toBeUndefined();
    expect(r.error).toMatch(/Quellen-Fußnoten reserviert/);
  });

  it("blockiert auch bei umgebendem Whitespace reine Ziffern", () => {
    expect(validateLinkTitle("  7  ").error).toBeDefined();
  });

  it("ein Titel mit führenden Nullen ('007') zählt ebenfalls als reine Zahl", () => {
    expect(validateLinkTitle("007").error).toBeDefined();
  });

  it("ein gemischter Titel ('42 Fragen') ist erlaubt (keine REINE Zahl)", () => {
    expect(validateLinkTitle("42 Fragen")).toEqual({ title: "42 Fragen" });
  });

  it("ersetzt eckige Klammern im Titel still durch runde", () => {
    expect(validateLinkTitle("Report [DRAFT]")).toEqual({ title: "Report (DRAFT)" });
  });

  it("lehnt einen leeren/nur-Whitespace-Titel ab", () => {
    expect(validateLinkTitle("   ").error).toBeDefined();
    expect(validateLinkTitle("").error).toBeDefined();
  });
});

describe("normalizeLinkUrl (Link-Dialog, DocEditor.jsx)", () => {
  it("lässt eine vollständige https-URL unverändert", () => {
    expect(normalizeLinkUrl("https://example.org/a")).toEqual({ url: "https://example.org/a" });
  });

  it("akzeptiert http:// (nicht nur https)", () => {
    expect(normalizeLinkUrl("http://example.org/a")).toEqual({ url: "http://example.org/a" });
  });

  it("stellt https:// voran, wenn kein Schema angegeben ist", () => {
    expect(normalizeLinkUrl("example.org/a")).toEqual({ url: "https://example.org/a" });
  });

  it("lehnt javascript:-Schema ab", () => {
    expect(normalizeLinkUrl("javascript:alert(1)").error).toBeDefined();
  });

  it("lehnt data:-Schema ab", () => {
    expect(normalizeLinkUrl("data:text/html,x").error).toBeDefined();
  });

  it("lehnt ftp:// ab (nur http/https erlaubt)", () => {
    expect(normalizeLinkUrl("ftp://example.org/a").error).toBeDefined();
  });

  it("lehnt eine leere URL ab", () => {
    expect(normalizeLinkUrl("   ").error).toBeDefined();
  });
});

// Nachbesserung Finding 1 (Re-Review 2026-07-17): normalizeLinkUrl akzeptierte
// bisher URLs, die der Editor→Markdown→Viewer-Roundtrip NICHT trägt (siehe
// ausführlicher Kommentar bei normalizeLinkUrl in DocEditor.jsx). Statt
// abzulehnen werden die betroffenen Zeichen prozent-encodiert.
describe("normalizeLinkUrl: Zeichen-Encoding statt Ablehnung (Nachbesserung Finding 1)", () => {
  it("encodiert ein Leerzeichen in der URL zu %20", () => {
    expect(normalizeLinkUrl("https://x.de/a b")).toEqual({ url: "https://x.de/a%20b" });
  });

  it("encodiert mehrere/verschiedene Whitespace-Zeichen", () => {
    expect(normalizeLinkUrl("https://x.de/a\tb c")).toEqual({ url: "https://x.de/a%20b%20c" });
  });

  it("lässt EINE Ebene balancierter Klammern unverändert (Wikipedia-Fall)", () => {
    expect(normalizeLinkUrl("https://de.wikipedia.org/wiki/Steak_(Fleisch)")).toEqual({
      url: "https://de.wikipedia.org/wiki/Steak_(Fleisch)",
    });
  });

  it("encodiert eine unbalancierte schließende Klammer", () => {
    expect(normalizeLinkUrl("https://x.de/a)b")).toEqual({ url: "https://x.de/a%29b" });
  });

  it("encodiert eine unbalancierte öffnende Klammer", () => {
    expect(normalizeLinkUrl("https://x.de/a(b")).toEqual({ url: "https://x.de/a%28b" });
  });

  it("encodiert verschachtelte Klammern (mehr als eine Ebene)", () => {
    expect(normalizeLinkUrl("https://x.de/a(b(c)d)e")).toEqual({ url: "https://x.de/a%28b%28c%29d%29e" });
  });

  it('encodiert ein Anführungszeichen (") in der URL', () => {
    expect(normalizeLinkUrl('https://x.de/a"b')).toEqual({ url: "https://x.de/a%22b" });
  });

  it("encodiert spitze Klammern (</>) in der URL", () => {
    expect(normalizeLinkUrl("https://x.de/a<b>c")).toEqual({ url: "https://x.de/a%3Cb%3Ec" });
  });

  it("kombiniert Leerzeichen + unbalancierte Klammer + Anführungszeichen korrekt", () => {
    expect(normalizeLinkUrl('https://x.de/a b)c"d')).toEqual({ url: "https://x.de/a%20b%29c%22d" });
  });
});

describe("Editor-Roundtrip: durch normalizeLinkUrl transformierte URLs bleiben von Anfang an stabil (Finding 1)", () => {
  it("Leerzeichen: das Markdown trägt die %20-kodierte Form, danach idempotent", () => {
    const { url, out, out2 } = roundtripViaDialog("https://x.de/a b");
    expect(url).toBe("https://x.de/a%20b");
    expect(out).toBe("# T\n\n## A\n\nAlt[Titel](https://x.de/a%20b)");
    expect(out2).toBe(out);
  });

  it("unbalancierte Klammer: das Markdown trägt die %29-kodierte Form, danach idempotent", () => {
    const { url, out, out2 } = roundtripViaDialog("https://x.de/a)b");
    expect(url).toBe("https://x.de/a%29b");
    expect(out).toBe("# T\n\n## A\n\nAlt[Titel](https://x.de/a%29b)");
    expect(out2).toBe(out);
  });

  it("verschachtelte Klammern: das Markdown trägt die vollständig kodierte Form, danach idempotent", () => {
    const { url, out, out2 } = roundtripViaDialog("https://x.de/a(b(c)d)e");
    expect(url).toBe("https://x.de/a%28b%28c%29d%29e");
    expect(out).toBe("# T\n\n## A\n\nAlt[Titel](https://x.de/a%28b%28c%29d%29e)");
    expect(out2).toBe(out);
  });

  it('Anführungszeichen: das Markdown trägt die %22-kodierte Form, danach idempotent', () => {
    const { url, out, out2 } = roundtripViaDialog('https://x.de/a"b');
    expect(url).toBe("https://x.de/a%22b");
    expect(out).toBe("# T\n\n## A\n\nAlt[Titel](https://x.de/a%22b)");
    expect(out2).toBe(out);
  });

  it("spitze Klammern: das Markdown trägt die kodierte Form, danach idempotent", () => {
    const { url, out, out2 } = roundtripViaDialog("https://x.de/a<b>c");
    expect(url).toBe("https://x.de/a%3Cb%3Ec");
    expect(out).toBe("# T\n\n## A\n\nAlt[Titel](https://x.de/a%3Cb%3Ec)");
    expect(out2).toBe(out);
  });

  it("EINE Ebene balancierter Klammern (Wikipedia) bleibt unkodiert UND von Anfang an stabil", () => {
    const { url, out, out2 } = roundtripViaDialog("https://de.wikipedia.org/wiki/Steak_(Fleisch)");
    expect(url).toBe("https://de.wikipedia.org/wiki/Steak_(Fleisch)");
    expect(out).toBe("# T\n\n## A\n\nAlt[Titel](https://de.wikipedia.org/wiki/Steak_(Fleisch))");
    expect(out2).toBe(out);
  });
});

describe("Editor: applyLink-Pfad (per insertContent simuliert, wie im Link-Popover)", () => {
  it("ein neuer Link wird an der Cursor-Position eingefügt und übersteht den Roundtrip", () => {
    const editor = buildEditor("# T\n\n## A\n\nAlt");
    editor.commands.focus("end");
    const t = validateLinkTitle("Azure-Ticket");
    const u = normalizeLinkUrl("dev.azure.com/x/33487");
    expect(t.error).toBeUndefined();
    expect(u.error).toBeUndefined();
    editor.chain().focus().insertContent({
      type: "text",
      text: t.title,
      marks: [{ type: "link", attrs: { href: u.url } }],
    }).run();
    const out = unescapeMd(editor.storage.markdown.getMarkdown());
    editor.destroy();
    expect(out).toBe("# T\n\n## A\n\nAlt[Azure-Ticket](https://dev.azure.com/x/33487)");
  });

  it("ein bestehender Link wird über extendMarkRange komplett ersetzt, nicht nur teilweise", () => {
    const md = "# T\n\n## A\n\n[Alter Titel](https://example.org/alt)";
    const editor = buildEditor(md);
    // Cursor mitten in den Link-Text setzen (simuliert "Klick in den Link").
    let from = null;
    editor.state.doc.descendants((node, pos) => {
      if (from === null && node.isText && node.marks.some((m) => m.type.name === "link")) from = pos + 2;
    });
    editor.commands.setTextSelection(from);
    editor.chain().focus().extendMarkRange("link").insertContent({
      type: "text",
      text: "Neuer Titel",
      marks: [{ type: "link", attrs: { href: "https://example.org/neu" } }],
    }).run();
    const out = unescapeMd(editor.storage.markdown.getMarkdown());
    editor.destroy();
    expect(out).toBe("# T\n\n## A\n\n[Neuer Titel](https://example.org/neu)");
  });
});

// v7.9 (Nutzerwunsch "DevOps/Confluence-Icons"): LinkDecorations bekommt
// zusätzlich zur Klassenvergabe (cite-link/doc-link, siehe oben) eine
// Widget-Decoration mit dem Provider-Icon VOR einem generischen Link mit
// Provider-Match – NIE vor einer Quellen-Fußnote. setLinkProviders()
// befüllt dieselbe Modul-Registry, die computeLinkDecorations über
// providerFor/getLinkProviders liest (DocEditor.jsx importiert aus
// lib/linkProviders.jsx) – afterEach räumt sie wieder auf.
describe("Editor: Provider-Icon-Decoration vor generischen Links (v7.9)", () => {
  afterEach(() => setLinkProviders([]));

  it("ein dev.azure.com-Link bekommt eine Icon-Widget-Decoration (Klasse 'provider-link-icon'), ganz ohne Konfiguration", () => {
    const md = "# T\n\n## A\n\n[Ticket](https://dev.azure.com/acme/Proj/_workitems/edit/1)";
    const editor = buildEditor(md);
    const html = editor.view.dom.innerHTML;
    editor.destroy();
    expect(html).toContain("provider-link-icon");
    expect(html).toContain("<svg");
  });

  it("ein Confluence-Link (eingebauter Provider über das Host-Muster *.atlassian.net) bekommt ebenfalls ein Icon-Widget", () => {
    const md = "# T\n\n## A\n\n[Handbuch](https://acme.atlassian.net/wiki/spaces/TEAM/pages/1)";
    const editor = buildEditor(md);
    const html = editor.view.dom.innerHTML;
    editor.destroy();
    expect(html).toContain("provider-link-icon");
    expect(html).toContain("<svg");
  });

  it("eine Fußnote mit DERSELBEN dev.azure.com-URL bekommt KEIN Icon-Widget", () => {
    const md = "# T\n\n## A\n\nFakt[3](https://dev.azure.com/acme/Proj/_workitems/edit/1) hier.";
    const editor = buildEditor(md);
    const html = editor.view.dom.innerHTML;
    editor.destroy();
    expect(html).not.toContain("provider-link-icon");
  });

  it("ein konfigurierter custom-Provider zeigt sein Emoji im Widget statt eines SVGs", () => {
    setLinkProviders([{ id: "c1", type: "custom", name: "Intranet", prefix: "https://intranet.example/", icon: "🏠" }]);
    const md = "# T\n\n## A\n\n[Seite](https://intranet.example/x)";
    const editor = buildEditor(md);
    const html = editor.view.dom.innerHTML;
    editor.destroy();
    expect(html).toContain("provider-link-icon");
    expect(html).toContain("🏠");
    expect(html).not.toContain("<svg");
  });

  it("ohne passenden Provider erscheint kein Icon-Widget", () => {
    const md = "# T\n\n## A\n\n[Extern](https://example.org/x)";
    const editor = buildEditor(md);
    const html = editor.view.dom.innerHTML;
    editor.destroy();
    expect(html).not.toContain("provider-link-icon");
  });

  it("die Icon-Decoration ist eine reine View-Decoration und beeinflusst die Markdown-Serialisierung NICHT (No-op-Roundtrip bleibt stabil)", () => {
    const md = "# T\n\n## A\n\nSiehe [Ticket](https://dev.azure.com/acme/Proj/_workitems/edit/1) dazu.";
    expect(roundtrip(md)).toBe(md);
  });
});
